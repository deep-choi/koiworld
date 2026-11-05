import { useCallback, useEffect, useRef, useState } from 'react';
import { PLAY_PRODUCT_IDS, type PlayProductId } from '../config/monetization';
import { ABSOLUTE_MAX_POND_COUNT, DEFAULT_ENTITLEMENTS, pondCapacityUsed, type AccountEntitlements } from '../functions/src/saveValidation';
import { BillingError } from '../services/billing';
import { monetizationBackend as backend } from '../services/monetizationBackend';
import { trackEvent } from '../services/analytics';
import { refreshAdPrivacyStatus, showAdPrivacyOptions, subscribeToAdPrivacyOptions } from '../services/ads';

type Notify = (message: string, type: 'success' | 'info' | 'error') => void;

type MonetizationOptions = {
    /** 로그인한(익명이 아닌) 계정의 UID. 게스트면 null */
    accountUid: string | null;
    /** 계정 저장본을 다 불러와 저장해도 되는 상태인지(결제 복원·연못 추가는 이 뒤에만 합니다) */
    isAccountReady: boolean;
    pondIds: string[];
    notify: Notify;
    /** 로그인이 필요할 때 로그인 창을 엽니다. */
    onLoginRequired: () => void;
};

const BANNER_HEIGHT_CSS_VAR = '--ad-banner-height';

const BILLING_MESSAGES: Record<string, string> = {
    'login-required': '구매하려면 로그인이 필요해요. 로그인한 계정에 혜택이 저장되어 재설치해도 복원돼요.',
    'not-native': '앱에서 구매할 수 있어요.',
};

/**
 * 유료화 상태를 한곳에서 관리합니다.
 * - 계정 혜택(연못 확장권 수, 광고 제거)을 Firestore에서 실시간으로 받습니다. 웹·앱 공통.
 * - Android: Google Play 결제, 재설치 후 자동 복원, 하단 배너. 동영상 광고는 hooks/useVideoAds.ts가 맡습니다.
 * - 웹: 결제 버튼 대신 "앱에서 구매할 수 있어요" 안내만 보여 주고, 산 혜택은 그대로 적용합니다. 광고는 없습니다.
 * 결제·광고를 실제로 부르는 쪽은 services/monetizationBackend.ts입니다(로컬 미리보기에서는 가짜로 바뀜).
 */
export const useMonetization = ({ accountUid, isAccountReady, pondIds, notify, onLoginRequired }: MonetizationOptions) => {
    const isNativeStore = backend.isStoreAvailable();
    const [entitlementState, setEntitlementState] = useState<{ uid: string | null; value: AccountEntitlements; loaded: boolean }>(
        { uid: null, value: DEFAULT_ENTITLEMENTS, loaded: true },
    );
    const [prices, setPrices] = useState<Partial<Record<PlayProductId, string>>>({});
    const [busyProductId, setBusyProductId] = useState<PlayProductId | null>(null);
    const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);
    const [privacyOptionsVersion, setPrivacyOptionsVersion] = useState(0);
    const notifyRef = useRef(notify);
    notifyRef.current = notify;

    // 다른 계정으로 바뀌면 이전 계정 혜택을 즉시 버립니다.
    const entitlements = entitlementState.uid === accountUid ? entitlementState.value : DEFAULT_ENTITLEMENTS;
    const entitlementsLoaded = entitlementState.uid === accountUid && entitlementState.loaded;

    useEffect(() => {
        if (!backend.isAdSupported()) return;
        const unsubscribe = subscribeToAdPrivacyOptions(setPrivacyOptionsRequired);
        // 광고 제거를 샀어도 기존 광고 동의를 변경할 수 있어야 합니다.
        void refreshAdPrivacyStatus().catch(error => console.warn('Ad privacy status could not be refreshed:', error));
        return unsubscribe;
    }, []);

    const openAdPrivacyOptions = useCallback(async () => {
        try {
            await showAdPrivacyOptions();
            setPrivacyOptionsVersion(value => value + 1);
        } catch (error) {
            console.warn('Ad privacy options failed:', error);
            notifyRef.current('광고 개인정보 설정을 열지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
        }
    }, []);

    useEffect(() => {
        if (!accountUid) {
            setEntitlementState({ uid: null, value: DEFAULT_ENTITLEMENTS, loaded: true });
            return;
        }
        setEntitlementState({ uid: accountUid, value: DEFAULT_ENTITLEMENTS, loaded: false });
        return backend.subscribeToEntitlements(
            accountUid,
            value => setEntitlementState({ uid: accountUid, value, loaded: true }),
            error => {
                console.warn('Entitlement subscription failed:', error);
                // Keep ads and purchases disabled until entitlements can be read.
                setEntitlementState(current => current.uid === accountUid ? { ...current, loaded: false } : current);
            },
        );
    }, [accountUid]);

    useEffect(() => {
        if (!isNativeStore) return;
        let cancelled = false;
        void backend.loadProductPrices().then(result => { if (!cancelled) setPrices(result); });
        return () => { cancelled = true; };
    }, [isNativeStore]);

    // 재설치 후 첫 실행처럼 마무리되지 않은 구매가 있으면 계정 저장본을 불러온 뒤 조용히 복원합니다.
    const restoredForUidRef = useRef<string | null>(null);
    useEffect(() => {
        if (!isNativeStore || !accountUid || !isAccountReady || restoredForUidRef.current === accountUid) return;
        restoredForUidRef.current = accountUid;
        void backend.restorePurchases()
            .then(({ restored }) => {
                const newlyGranted = restored.filter(result => result.status === 'granted');
                if (newlyGranted.length > 0) {
                    notifyRef.current('완료되지 않았던 구매를 계정에 반영했어요.', 'success');
                }
            })
            .catch(error => console.warn('Automatic purchase restore failed:', error));
    }, [isNativeStore, accountUid, isAccountReady]);

    // 광고(배너·동영상): Android에서 광고 제거를 사지 않은 경우에만. 로그인 계정은 혜택을 읽은 뒤에 결정해 깜빡임을 막습니다.
    const adsEnabled = backend.isAdSupported() && entitlementsLoaded && !entitlements.adFree;
    useEffect(() => {
        if (!backend.isAdSupported()) return;
        const setHeight = (height: number) => {
            document.documentElement.style.setProperty(BANNER_HEIGHT_CSS_VAR, `${Math.max(0, Math.round(height))}px`);
        };
        if (!adsEnabled) {
            setHeight(0);
            void backend.removeBanner();
            return;
        }
        void backend.showBanner(setHeight);
        return () => {
            setHeight(0);
            void backend.removeBanner();
        };
    }, [adsEnabled, privacyOptionsVersion]);

    const canPurchase = useCallback((): boolean => {
        if (!isNativeStore) {
            notifyRef.current(BILLING_MESSAGES['not-native'], 'info');
            return false;
        }
        if (!accountUid) {
            notifyRef.current(BILLING_MESSAGES['login-required'], 'info');
            onLoginRequired();
            return false;
        }
        if (!isAccountReady || !entitlementsLoaded) {
            notifyRef.current('계정 정보를 불러오는 중이에요. 잠시 후 다시 시도해 주세요.', 'info');
            return false;
        }
        return true;
    }, [isNativeStore, accountUid, isAccountReady, entitlementsLoaded, onLoginRequired]);

    const purchase = useCallback(async (productId: PlayProductId) => {
        if (busyProductId || !canPurchase() || !accountUid) return;
        if (productId === PLAY_PRODUCT_IDS.pondSlot && pondCapacityUsed(pondIds, entitlements) >= ABSOLUTE_MAX_POND_COUNT) {
            notifyRef.current(`연못은 총 ${ABSOLUTE_MAX_POND_COUNT}개까지 보유할 수 있어요.`, 'info');
            return;
        }
        if (productId === PLAY_PRODUCT_IDS.removeAds && entitlements.adFree) {
            notifyRef.current('이미 광고 제거가 적용된 계정이에요.', 'info');
            return;
        }
        setBusyProductId(productId);
        try {
            const result = await backend.purchase(accountUid, productId);
            if (!result) return; // 사용자가 결제창을 닫았습니다.
            if (result.status === 'pending') {
                notifyRef.current('결제가 아직 처리 중이에요. 결제가 끝나면 앱을 다시 열었을 때 자동으로 반영돼요.', 'info');
                return;
            }
            setEntitlementState({ uid: accountUid, value: result.entitlements, loaded: true });
            trackEvent('iap_purchase', { product_id: productId });
            notifyRef.current(productId === PLAY_PRODUCT_IDS.pondSlot
                ? '연못이 하나 더 생겼어요! 연못 현황에서 코이를 옮길 수 있어요.'
                : '광고 제거가 적용되었어요. 이제 배너와 동영상 광고가 나오지 않아요.', 'success');
        } catch (error) {
            const reason = error instanceof BillingError ? error.reason : '';
            const message = BILLING_MESSAGES[reason]
                ?? (error instanceof BillingError ? error.message : '구매를 완료하지 못했습니다. 결제되었다면 앱을 다시 열고 같은 계정으로 로그인해 주세요.');
            notifyRef.current(message, 'error');
        } finally {
            setBusyProductId(null);
        }
    }, [busyProductId, canPurchase, accountUid, entitlements, pondIds]);

    return {
        isNativeStore,
        entitlements,
        entitlementsLoaded,
        /** 배너와 동영상 광고를 띄워도 되는 계정·환경인지 */
        adsEnabled,
        prices,
        busyProductId,
        privacyOptionsRequired,
        openAdPrivacyOptions,
        purchase,
    };
};
