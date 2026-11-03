import { useCallback, useEffect, useRef, useState } from 'react';
import {
    PLAY_PRODUCT_IDS,
    REWARDED_AD_REWARDS,
    REWARDED_ADS_PER_DAY,
    type PlayProductId,
    type RewardedAdRewardKind,
} from '../config/monetization';
import { DEFAULT_ENTITLEMENTS, MAX_PAID_POND_SLOTS, type AccountEntitlements } from '../functions/src/saveValidation';
import {
    BillingError,
    isPlayBillingAvailable,
    loadProductPrices,
    purchasePlayProduct,
    restorePlayPurchases,
    subscribeToEntitlements,
} from '../services/billing';
import { isAdSupported, removeBanner, showBanner, showRewardedAd } from '../services/ads';
import { readRewardedAdLog, recordRewardedAd, remainingRewardedAds, type RewardedAdLog } from '../utils/rewardedAdQuota';
import { trackEvent } from '../services/analytics';

type Notify = (message: string, type: 'success' | 'info' | 'error') => void;

type MonetizationOptions = {
    /** 로그인한(익명이 아닌) 계정의 UID. 게스트면 null */
    accountUid: string | null;
    /** 계정 저장본을 다 불러와 저장해도 되는 상태인지(결제 복원·연못 추가는 이 뒤에만 합니다) */
    isAccountReady: boolean;
    notify: Notify;
    /** 보상형 광고를 끝까지 봤을 때 게임 재화를 지급합니다. */
    onRewardEarned: (kind: RewardedAdRewardKind) => void;
    /** 로그인이 필요할 때 로그인 창을 엽니다. */
    onLoginRequired: () => void;
};

const BANNER_HEIGHT_CSS_VAR = '--ad-banner-height';
const rewardedLogKey = (uid: string | null) => `koiworld:rewarded-ads:${uid ?? 'guest'}`;

const readRewardedLog = (uid: string | null): RewardedAdLog => {
    try {
        return readRewardedAdLog(JSON.parse(localStorage.getItem(rewardedLogKey(uid)) ?? 'null'), Date.now());
    } catch {
        return readRewardedAdLog(null, Date.now());
    }
};

const BILLING_MESSAGES: Record<string, string> = {
    'login-required': '구매하려면 로그인이 필요해요. 로그인한 계정에 혜택이 저장되어 재설치해도 복원돼요.',
    'not-native': '앱에서 구매할 수 있어요.',
};

/**
 * 유료화 상태를 한곳에서 관리합니다.
 * - 계정 혜택(연못 슬롯, 광고 제거)을 Firestore에서 실시간으로 받습니다. 웹·앱 공통.
 * - Android: Google Play 결제, 재설치 후 자동 복원, 배너·보상형 광고.
 * - 웹: 결제 버튼 대신 "앱에서 구매할 수 있어요" 안내만 보여 주고, 산 혜택은 그대로 적용합니다.
 */
export const useMonetization = ({ accountUid, isAccountReady, notify, onRewardEarned, onLoginRequired }: MonetizationOptions) => {
    const isNativeStore = isPlayBillingAvailable();
    const [entitlementState, setEntitlementState] = useState<{ uid: string | null; value: AccountEntitlements; loaded: boolean }>(
        { uid: null, value: DEFAULT_ENTITLEMENTS, loaded: true },
    );
    const [prices, setPrices] = useState<Partial<Record<PlayProductId, string>>>({});
    const [busyProductId, setBusyProductId] = useState<PlayProductId | 'restore' | null>(null);
    const [isWatchingAd, setIsWatchingAd] = useState(false);
    const [rewardedLog, setRewardedLog] = useState<RewardedAdLog>(() => readRewardedLog(accountUid));
    const notifyRef = useRef(notify);
    notifyRef.current = notify;
    const rewardRef = useRef(onRewardEarned);
    rewardRef.current = onRewardEarned;

    // 다른 계정으로 바뀌면 이전 계정 혜택을 즉시 버립니다.
    const entitlements = entitlementState.uid === accountUid ? entitlementState.value : DEFAULT_ENTITLEMENTS;
    const entitlementsLoaded = entitlementState.uid === accountUid && entitlementState.loaded;

    useEffect(() => {
        setRewardedLog(readRewardedLog(accountUid));
        if (!accountUid) {
            setEntitlementState({ uid: null, value: DEFAULT_ENTITLEMENTS, loaded: true });
            return;
        }
        setEntitlementState({ uid: accountUid, value: DEFAULT_ENTITLEMENTS, loaded: false });
        return subscribeToEntitlements(
            accountUid,
            value => setEntitlementState({ uid: accountUid, value, loaded: true }),
            error => {
                console.warn('Entitlement subscription failed:', error);
                // 읽기에 실패해도 게임은 계속합니다. 광고 표시 여부만 기본값을 따릅니다.
                setEntitlementState(current => current.uid === accountUid ? { ...current, loaded: true } : current);
            },
        );
    }, [accountUid]);

    useEffect(() => {
        if (!isNativeStore) return;
        let cancelled = false;
        void loadProductPrices().then(result => { if (!cancelled) setPrices(result); });
        return () => { cancelled = true; };
    }, [isNativeStore]);

    // 재설치 후 첫 실행처럼 마무리되지 않은 구매가 있으면 계정 저장본을 불러온 뒤 조용히 복원합니다.
    const restoredForUidRef = useRef<string | null>(null);
    useEffect(() => {
        if (!isNativeStore || !accountUid || !isAccountReady || restoredForUidRef.current === accountUid) return;
        restoredForUidRef.current = accountUid;
        void restorePlayPurchases()
            .then(({ restored }) => {
                const newlyGranted = restored.filter(result => result.status === 'granted');
                if (newlyGranted.length > 0) {
                    notifyRef.current('완료되지 않았던 구매를 계정에 반영했어요.', 'success');
                }
            })
            .catch(error => console.warn('Automatic purchase restore failed:', error));
    }, [isNativeStore, accountUid, isAccountReady]);

    // 배너: Android에서 광고 제거를 사지 않은 경우에만. 로그인 계정은 혜택을 읽은 뒤에 결정해 깜빡임을 막습니다.
    const shouldShowBanner = isAdSupported() && entitlementsLoaded && !entitlements.adFree;
    useEffect(() => {
        if (!isAdSupported()) return;
        const setHeight = (height: number) => {
            document.documentElement.style.setProperty(BANNER_HEIGHT_CSS_VAR, `${Math.max(0, Math.round(height))}px`);
        };
        if (!shouldShowBanner) {
            setHeight(0);
            void removeBanner();
            return;
        }
        void showBanner(setHeight);
        return () => {
            setHeight(0);
            void removeBanner();
        };
    }, [shouldShowBanner]);

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
        if (productId === PLAY_PRODUCT_IDS.pondSlot && entitlements.paidPondSlots >= MAX_PAID_POND_SLOTS) {
            notifyRef.current(`연못 슬롯은 계정당 ${MAX_PAID_POND_SLOTS}개까지 살 수 있어요.`, 'info');
            return;
        }
        if (productId === PLAY_PRODUCT_IDS.removeAds && entitlements.adFree) {
            notifyRef.current('이미 광고 제거가 적용된 계정이에요.', 'info');
            return;
        }
        setBusyProductId(productId);
        try {
            const result = await purchasePlayProduct(accountUid, productId);
            if (!result) return; // 사용자가 결제창을 닫았습니다.
            if (result.status === 'pending') {
                notifyRef.current('결제가 아직 처리 중이에요. 결제가 끝나면 앱을 다시 열었을 때 자동으로 반영돼요.', 'info');
                return;
            }
            setEntitlementState({ uid: accountUid, value: result.entitlements, loaded: true });
            trackEvent('iap_purchase', { product_id: productId });
            notifyRef.current(productId === PLAY_PRODUCT_IDS.pondSlot
                ? '특별 연못이 생겼어요! 연못 현황에서 코이를 옮길 수 있어요.'
                : '광고 제거가 적용되었어요. 보상형 광고는 원할 때만 볼 수 있어요.', 'success');
        } catch (error) {
            const reason = error instanceof BillingError ? error.reason : '';
            const message = BILLING_MESSAGES[reason]
                ?? (error instanceof BillingError ? error.message : '구매를 완료하지 못했습니다. 결제되었다면 "구매 복원"을 눌러 주세요.');
            notifyRef.current(message, 'error');
        } finally {
            setBusyProductId(null);
        }
    }, [busyProductId, canPurchase, accountUid, entitlements]);

    const restorePurchases = useCallback(async () => {
        if (busyProductId || !canPurchase()) return;
        setBusyProductId('restore');
        try {
            const { restored, failures } = await restorePlayPurchases({ refresh: true });
            const latest = restored[restored.length - 1];
            if (latest && accountUid) setEntitlementState({ uid: accountUid, value: latest.entitlements, loaded: true });
            if (failures.length > 0) notifyRef.current(failures[0].message, 'error');
            else if (restored.length > 0) notifyRef.current('구매 내역을 이 계정에 다시 적용했어요.', 'success');
            else notifyRef.current('복원할 구매가 없어요. 연못 슬롯은 같은 계정으로 로그인하면 자동으로 적용돼요.', 'info');
        } catch (error) {
            console.warn('Manual restore failed:', error);
            notifyRef.current('구매 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
        } finally {
            setBusyProductId(null);
        }
    }, [busyProductId, canPurchase, accountUid]);

    const rewardedAdsRemaining = remainingRewardedAds(rewardedLog, REWARDED_ADS_PER_DAY, Date.now());

    const watchRewardedAd = useCallback(async (kind: RewardedAdRewardKind) => {
        if (!isAdSupported()) {
            notifyRef.current('보상형 광고는 앱에서 볼 수 있어요.', 'info');
            return;
        }
        if (isWatchingAd) return;
        if (remainingRewardedAds(readRewardedLog(accountUid), REWARDED_ADS_PER_DAY, Date.now()) <= 0) {
            notifyRef.current('오늘 받을 수 있는 광고 보상을 모두 받았어요. 내일 다시 만나요!', 'info');
            return;
        }
        setIsWatchingAd(true);
        try {
            const earned = await showRewardedAd();
            if (!earned) {
                notifyRef.current('광고를 끝까지 보면 보상을 받을 수 있어요.', 'info');
                return;
            }
            const next = recordRewardedAd(readRewardedLog(accountUid), Date.now());
            try { localStorage.setItem(rewardedLogKey(accountUid), JSON.stringify(next)); } catch { /* 횟수 기록 실패는 무시합니다. */ }
            setRewardedLog(next);
            rewardRef.current(kind);
            trackEvent('rewarded_ad_reward', { reward: kind });
            notifyRef.current(`광고 보상으로 ${REWARDED_AD_REWARDS[kind].label}을(를) 받았어요!`, 'success');
        } finally {
            setIsWatchingAd(false);
        }
    }, [isWatchingAd, accountUid]);

    return {
        isNativeStore,
        entitlements,
        entitlementsLoaded,
        prices,
        busyProductId,
        purchase,
        restorePurchases,
        canWatchRewardedAds: isAdSupported(),
        isWatchingAd,
        rewardedAdsRemaining,
        watchRewardedAd,
    };
};
