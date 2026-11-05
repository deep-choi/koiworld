import { Capacitor } from '@capacitor/core';
import { NativePurchases, PURCHASE_TYPE, type Transaction } from '@capgo/native-purchases';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable, type FunctionsError } from 'firebase/functions';
import { db, functions } from './firebase';
import { PLAY_PRODUCT_IDS, type PlayProductId } from '../config/monetization';
import { normalizeEntitlements, type AccountEntitlements } from '../functions/src/saveValidation';

// Google Play 인앱 결제(Android 전용)와 계정 혜택 읽기를 담당합니다.
//
// 결제 흐름
// 1. 앱이 Google Play 결제창을 띄움 (구매에 계정 해시를 붙임)
// 2. 받은 구매 토큰을 서버 함수 verifyPlayPurchase로 보냄
// 3. 서버가 Google Play Developer API로 확인 → Firestore entitlements/{uid}에 혜택 저장 → Play에 소비/승인
// 4. 앱과 웹은 entitlements/{uid}를 구독해 혜택을 적용
//
// 앱은 절대 직접 혜택을 주지 않습니다. 서버 확인 전에 소비/승인도 하지 않습니다.

export type PurchaseVerification = {
    status: 'granted' | 'already-granted' | 'pending';
    productId: PlayProductId;
    entitlements: AccountEntitlements;
    finished: boolean;
};

export class BillingError extends Error {
    constructor(message: string, readonly reason: string) {
        super(message);
        this.name = 'BillingError';
    }
}

export const isPlayBillingAvailable = (): boolean => Capacitor.getPlatform() === 'android';

const KNOWN_PRODUCT_IDS = new Set<string>(Object.values(PLAY_PRODUCT_IDS));
const isKnownProductId = (value: string): value is PlayProductId => KNOWN_PRODUCT_IDS.has(value);

/**
 * 구매에 붙이는 계정 식별값. 서버(functions/src/playBilling.ts의 accountTokenForUid)와 같은 규칙입니다.
 * Firebase UID를 그대로 Google에 보내지 않도록 SHA-256 해시(64자)를 씁니다.
 */
export const accountTokenForUid = async (uid: string): Promise<string> => {
    const bytes = new TextEncoder().encode(`koiworld:${uid}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

/** 계정 혜택을 실시간으로 받습니다. 앱에서 산 혜택이 같은 계정의 웹에도 바로 반영됩니다. */
export const subscribeToEntitlements = (
    uid: string,
    onUpdate: (entitlements: AccountEntitlements) => void,
    onError?: (error: unknown) => void,
): (() => void) => onSnapshot(
    doc(db, 'entitlements', uid),
    snapshot => onUpdate(normalizeEntitlements(snapshot.exists() ? snapshot.data() : undefined)),
    error => onError?.(error),
);

let configured: Promise<void> | null = null;
/** 서버 확인 전에 플러그인이 구매를 스스로 승인/소비하지 않도록 자동 마무리를 끕니다. */
const ensureConfigured = (): Promise<void> => {
    configured ??= NativePurchases.configure({ autoFinishTransactions: false }).catch(error => {
        configured = null;
        throw error;
    });
    return configured;
};

/** 상점에 보여 줄 현지 가격(예: ₩1,200). 상품을 못 읽으면 빈 객체를 돌려줍니다. */
export const loadProductPrices = async (): Promise<Partial<Record<PlayProductId, string>>> => {
    if (!isPlayBillingAvailable()) return {};
    try {
        await ensureConfigured();
        const { products } = await NativePurchases.getProducts({
            productIdentifiers: Object.values(PLAY_PRODUCT_IDS),
            productType: PURCHASE_TYPE.INAPP,
        });
        const prices: Partial<Record<PlayProductId, string>> = {};
        for (const product of products) {
            if (isKnownProductId(product.identifier) && product.priceString) prices[product.identifier] = product.priceString;
        }
        return prices;
    } catch (error) {
        console.warn('Failed to load Play products:', error);
        return {};
    }
};

const callVerify = async (productId: PlayProductId, purchaseToken: string): Promise<PurchaseVerification> => {
    const callable = httpsCallable<{ productId: string; purchaseToken: string }, PurchaseVerification>(
        functions,
        'verifyPlayPurchase',
    );
    try {
        const result = await callable({ productId, purchaseToken });
        return { ...result.data, entitlements: normalizeEntitlements(result.data.entitlements) };
    } catch (error) {
        const details = (error as FunctionsError | undefined)?.details as { reason?: string } | undefined;
        const message = error instanceof Error && error.message ? error.message : '구매를 확인하지 못했습니다.';
        throw new BillingError(message, details?.reason ?? 'verify-failed');
    }
};

/**
 * 서버가 Play에 소비/승인을 못 했을 때 앱이 대신 마무리합니다.
 * 혜택은 이미 서버에 저장된 뒤라 여기서 실패해도 혜택은 사라지지 않습니다.
 */
const finishLocally = async (transaction: Transaction, productId: PlayProductId): Promise<void> => {
    const purchaseToken = transaction.purchaseToken;
    if (!purchaseToken) return;
    try {
        if (productId === PLAY_PRODUCT_IDS.pondSlot) await NativePurchases.consumePurchase({ purchaseToken });
        else if (!transaction.isAcknowledged) await NativePurchases.acknowledgePurchase({ purchaseToken });
    } catch (error) {
        console.warn('Local purchase finish failed:', error);
    }
};

const verifyTransaction = async (transaction: Transaction): Promise<PurchaseVerification | null> => {
    const productId = transaction.productIdentifier;
    if (!isKnownProductId(productId) || !transaction.purchaseToken) return null;
    const result = await callVerify(productId, transaction.purchaseToken);
    if (result.status !== 'pending' && !result.finished) await finishLocally(transaction, productId);
    return result;
};

/** Android BillingClient PurchaseState: 1 = purchased, 2 = pending. */
const isPendingTransaction = (transaction: Transaction) => transaction.purchaseState === '2';

/**
 * 상품 하나를 삽니다. 결제창에서 사용자가 취소하면 null을 돌려줍니다.
 * 결제가 대기 중이면 status: 'pending'이고, 결제가 끝난 뒤 앱을 다시 열면 복원 흐름이 마무리합니다.
 */
export const purchasePlayProduct = async (uid: string, productId: PlayProductId): Promise<PurchaseVerification | null> => {
    if (!isPlayBillingAvailable()) throw new BillingError('앱에서 구매할 수 있어요.', 'not-native');
    await ensureConfigured();
    let transaction: Transaction;
    try {
        transaction = await NativePurchases.purchaseProduct({
            productIdentifier: productId,
            productType: PURCHASE_TYPE.INAPP,
            appAccountToken: await accountTokenForUid(uid),
            // 서버가 확인한 뒤에만 소비/승인합니다. 여기서 소비하면 서버가 구매를 확인할 수 없습니다.
            isConsumable: false,
            autoAcknowledgePurchases: false,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('cancel')) return null;
        if (message.includes('pending')) {
            return { status: 'pending', productId, entitlements: normalizeEntitlements(undefined), finished: false };
        }
        throw new BillingError('Google Play 결제를 완료하지 못했습니다.', 'purchase-failed');
    }
    if (isPendingTransaction(transaction)) {
        return { status: 'pending', productId, entitlements: normalizeEntitlements(undefined), finished: false };
    }
    const result = await verifyTransaction(transaction);
    if (!result) throw new BillingError('구매 정보를 확인하지 못했습니다.', 'invalid-transaction');
    return result;
};

/**
 * 재설치·기기 변경·앱 종료 등으로 마무리되지 않은 구매를 서버에 다시 확인합니다.
 * - remove_ads처럼 계속 보유하는 상품은 Google Play가 돌려주므로 같은 계정이면 혜택이 다시 연결됩니다.
 * - 소비되지 않은 pond_slot(결제 직후 앱이 꺼진 경우)도 여기서 혜택이 반영됩니다.
 * - 이미 반영된 연못 슬롯은 계정의 Firestore 혜택에 남아 있어 로그인만 하면 복원됩니다.
 * 다른 계정에서 산 구매는 서버가 거절하며, 조용한 자동 복원에서는 결과에서 뺍니다.
 */
export const restorePlayPurchases = async (options: { refresh?: boolean } = {}): Promise<{
    restored: PurchaseVerification[];
    failures: BillingError[];
}> => {
    if (!isPlayBillingAvailable()) return { restored: [], failures: [] };
    await ensureConfigured();
    if (options.refresh) await NativePurchases.restorePurchases().catch(() => undefined);
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    const restored: PurchaseVerification[] = [];
    const failures: BillingError[] = [];
    for (const transaction of purchases) {
        if (isPendingTransaction(transaction)) continue;
        try {
            const result = await verifyTransaction(transaction);
            if (result) restored.push(result);
        } catch (error) {
            failures.push(error instanceof BillingError ? error : new BillingError('구매를 확인하지 못했습니다.', 'verify-failed'));
        }
    }
    return { restored, failures };
};
