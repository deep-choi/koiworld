import { createHash } from 'node:crypto';
import {
    MAX_PAID_POND_SLOTS,
    ABSOLUTE_MAX_POND_COUNT,
    normalizeEntitlements,
    pondCapacityUsed,
    type AccountEntitlements,
} from './saveValidation.js';

// Google Play 인앱 결제를 계정 혜택으로 바꾸는 판단 로직입니다.
// Firestore나 네트워크에 의존하지 않는 순수 함수로만 이루어져 있어, 서버 함수(index.ts)는
// "Play에서 구매 정보를 읽고 → 여기서 판단하고 → 결과를 저장"만 합니다. 테스트도 이 파일을 대상으로 합니다.

/** Play Console에 등록된 Android 앱 패키지 이름 (capacitor.config.ts의 appId와 같아야 합니다) */
export const PLAY_PACKAGE_NAME = 'com.zenkoigarden.game';

/**
 * 판매하는 인앱 상품. 키가 Play Console의 "제품 ID"입니다.
 * - pond_slot: 소모성 상품(상점 이름 "연못 확장권"). 살 때마다 연못 슬롯이 1개 늘고, 서버가 확인 후 소비 처리해 다시 살 수 있게 합니다.
 * - remove_ads: 비소모성 상품. 한 번 사면 배너 광고가 사라집니다. 서버가 확인 후 승인(acknowledge)합니다.
 */
export const PLAY_PRODUCTS = {
    pond_slot: { type: 'consumable', benefit: 'pondSlot' },
    remove_ads: { type: 'nonConsumable', benefit: 'adFree' },
} as const;

export type PlayProductId = keyof typeof PLAY_PRODUCTS;

export const isPlayProductId = (value: unknown): value is PlayProductId =>
    typeof value === 'string' && Object.hasOwn(PLAY_PRODUCTS, value);

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * 구매에 붙이는 계정 식별값(Google Play의 obfuscatedAccountId).
 * Firebase UID를 그대로 보내지 않고 SHA-256 해시(64자, Play 허용 최대 길이)로 보냅니다.
 * 앱(services/billing.ts)도 같은 방식으로 계산하므로 두 값이 같아야 합니다.
 */
export const accountTokenForUid = (uid: string): string => sha256Hex(`koiworld:${uid}`);

/** 구매 토큰은 길고 민감하므로 문서 ID에는 해시만 씁니다. 같은 토큰은 언제나 같은 문서로 모입니다. */
export const purchaseRecordId = (purchaseToken: string): string => sha256Hex(purchaseToken);

/** 구매 토큰 형식만 가볍게 확인합니다. 진짜 여부는 Google Play Developer API가 판단합니다. */
export const isPlausiblePurchaseToken = (value: unknown): value is string =>
    typeof value === 'string' && value.length >= 10 && value.length <= 4096 && /^[A-Za-z0-9._\-:]+$/.test(value);

/**
 * Google Play Developer API `purchases.products.get` 응답 중 이 게임이 쓰는 필드.
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products
 */
export type PlayProductPurchase = {
    /** 0 구매 완료, 1 취소됨, 2 대기 중(현금 결제 등) */
    purchaseState?: number;
    /** 0 아직 소비 안 됨, 1 소비됨 */
    consumptionState?: number;
    /** 0 승인 전, 1 승인됨 */
    acknowledgementState?: number;
    orderId?: string;
    purchaseTimeMillis?: string;
    /** 0 테스트 구매(라이선스 테스터), 1 프로모션 코드, 2 보상형. 일반 구매는 필드가 없습니다. */
    purchaseType?: number;
    quantity?: number;
    obfuscatedExternalAccountId?: string;
    productId?: string;
};

/** Firestore `playPurchases/{purchaseRecordId}`에 남기는 구매 기록 */
export type PurchaseRecord = {
    uid: string;
    productId: PlayProductId;
    status: 'granted';
    quantity: number;
    orderId: string | null;
    purchaseTimeMillis: string | null;
    isTest: boolean;
    /** Google Play에 소비/승인까지 끝냈는지. false면 다음 확인 요청 때 다시 시도합니다. */
    finished: boolean;
};

export type FinishAction = 'consume' | 'acknowledge';

export type RejectReason =
    | 'canceled'
    | 'account-mismatch'
    | 'owned-by-other-account'
    | 'already-consumed'
    | 'product-mismatch'
    | 'invalid-quantity'
    | 'slot-limit';

export type GrantDecision =
    | { kind: 'grant'; entitlements: AccountEntitlements; record: PurchaseRecord; finish: FinishAction | null }
    | { kind: 'already-granted'; entitlements: AccountEntitlements; finish: FinishAction | null }
    | { kind: 'pending'; entitlements: AccountEntitlements }
    | { kind: 'reject'; reason: RejectReason; message: string; entitlements: AccountEntitlements };

const REJECT_MESSAGES: Record<RejectReason, string> = {
    'canceled': '취소되었거나 환불된 구매입니다.',
    'account-mismatch': '다른 계정으로 진행한 구매입니다. 구매한 계정으로 로그인해 주세요.',
    'owned-by-other-account': '이미 다른 계정에 적용된 구매입니다. 구매한 계정으로 로그인해 주세요.',
    'already-consumed': '이미 사용된 구매입니다.',
    'product-mismatch': '구매한 상품 정보가 맞지 않습니다.',
    'invalid-quantity': '구매 수량을 확인할 수 없습니다.',
    'slot-limit': `연못은 총 ${ABSOLUTE_MAX_POND_COUNT}개까지 보유할 수 있어요. 이 구매는 적용되지 않으며 Google Play에서 자동으로 환불됩니다.`,
};

const reject = (reason: RejectReason, entitlements: AccountEntitlements): GrantDecision =>
    ({ kind: 'reject', reason, message: REJECT_MESSAGES[reason], entitlements });

const finishActionFor = (productId: PlayProductId, purchase: PlayProductPurchase): FinishAction | null => {
    if (PLAY_PRODUCTS[productId].type === 'consumable') {
        return purchase.consumptionState === 1 ? null : 'consume';
    }
    return purchase.acknowledgementState === 1 ? null : 'acknowledge';
};

/** 혜택을 하나 더한 결과. 슬롯 한도를 넘으면 null입니다. */
export const applyBenefit = (
    current: AccountEntitlements,
    productId: PlayProductId,
    quantity: number,
): AccountEntitlements | null => {
    const entitlements = normalizeEntitlements(current);
    if (PLAY_PRODUCTS[productId].benefit === 'adFree') return { ...entitlements, adFree: true };
    const paidPondSlots = entitlements.paidPondSlots + quantity;
    return paidPondSlots > MAX_PAID_POND_SLOTS ? null : { ...entitlements, paidPondSlots };
};

/**
 * Google Play에서 읽어 온 구매 정보로 혜택을 줄지 결정합니다.
 *
 * 순서가 중요합니다.
 * 1. 이미 다른 계정이 쓴 토큰이면 거절 (토큰을 가로채 다른 계정에 쓰는 것 방지)
 * 2. 결제 상태 확인 (취소·대기)
 * 3. 구매 때 붙인 계정 식별값이 지금 계정과 다르면 거절
 * 4. 같은 계정이 같은 토큰을 다시 보내면 혜택을 또 주지 않고 현재 혜택만 돌려줌 (재시도·복원)
 * 5. 처음 보는 토큰이면 혜택을 더하고, Play에 소비/승인할 일을 함께 돌려줌
 */
export const decidePurchaseGrant = (input: {
    uid: string;
    productId: PlayProductId;
    purchase: PlayProductPurchase;
    existingRecord?: Partial<PurchaseRecord> | null;
    entitlements?: unknown;
    pondIds?: string[];
}): GrantDecision => {
    const { uid, productId, purchase } = input;
    const entitlements = normalizeEntitlements(input.entitlements);
    const existing = input.existingRecord ?? null;

    if (existing && existing.uid !== uid) return reject('owned-by-other-account', entitlements);
    if (purchase.productId !== undefined && purchase.productId !== productId) {
        return reject('product-mismatch', entitlements);
    }
    if (purchase.purchaseState === 1) return reject('canceled', entitlements);
    if (purchase.purchaseState === 2) return { kind: 'pending', entitlements };
    if (purchase.purchaseState !== 0) {
        return reject('canceled', entitlements);
    }
    // 프로모션 코드처럼 앱 밖에서 받은 구매에는 계정 식별값이 없습니다. 그때는 처음 확인한 계정에 묶습니다.
    if (purchase.obfuscatedExternalAccountId && purchase.obfuscatedExternalAccountId !== accountTokenForUid(uid)) {
        return reject('account-mismatch', entitlements);
    }

    if (existing?.status === 'granted') {
        const playReportsUnfinished = PLAY_PRODUCTS[productId].type === 'consumable'
            ? purchase.consumptionState === 0
            : purchase.acknowledgementState === 0;
        return {
            kind: 'already-granted',
            entitlements,
            // 장부가 완료로 기록돼 있어도 Play가 아직 미소비·미승인으로 응답하면 마무리를 다시 시도합니다.
            finish: existing.finished === true && !playReportsUnfinished ? null : finishActionFor(productId, purchase),
        };
    }

    // 기록이 없는데 이미 소비된 토큰은 예전에 쓴 토큰을 다시 보낸 것으로 봅니다.
    if (PLAY_PRODUCTS[productId].type === 'consumable' && purchase.consumptionState === 1) {
        return reject('already-consumed', entitlements);
    }

    const quantity = purchase.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1) return reject('invalid-quantity', entitlements);

    const nextEntitlements = applyBenefit(entitlements, productId, quantity);
    // 한도를 넘는 슬롯 구매는 승인하지 않습니다. Google Play는 3일 안에 승인되지 않은 구매를 자동 환불합니다.
    if (!nextEntitlements) return reject('slot-limit', entitlements);
    if (productId === 'pond_slot' && pondCapacityUsed(input.pondIds ?? [], nextEntitlements) > ABSOLUTE_MAX_POND_COUNT) {
        return reject('slot-limit', entitlements);
    }

    const finish = finishActionFor(productId, purchase);
    return {
        kind: 'grant',
        entitlements: nextEntitlements,
        finish,
        record: {
            uid,
            productId,
            status: 'granted',
            quantity,
            orderId: typeof purchase.orderId === 'string' ? purchase.orderId : null,
            purchaseTimeMillis: typeof purchase.purchaseTimeMillis === 'string' ? purchase.purchaseTimeMillis : null,
            isTest: purchase.purchaseType === 0,
            finished: finish === null,
        },
    };
};
