import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
    AdMob,
    AdmobConsentStatus,
    BannerAdPluginEvents,
    BannerAdPosition,
    BannerAdSize,
    InterstitialAdPluginEvents,
} from '@capacitor-community/admob';
import { VIDEO_AD_LIMITS, resolveAdUnit } from '../config/monetization';

// AdMob(Android 전용) 래퍼입니다. 웹에서는 모든 함수가 아무 일도 하지 않습니다.
// 이 게임은 화면 아래 작은 배너와, 쉬는 지점에서만 나오는 동영상 전면 광고만 씁니다.
// 언제 동영상 광고를 띄울지는 hooks/useVideoAds.ts와 utils/videoAdPolicy.ts가 정합니다.

/** 실제 광고 단위 ID. 기본은 비어 있어 테스트 광고가 나옵니다. 출시 때 VITE_ADMOB_* 환경 변수로만 채웁니다. */
const productionAdUnits = {
    banner: import.meta.env.VITE_ADMOB_BANNER_ID ?? '',
    interstitial: import.meta.env.VITE_ADMOB_INTERSTITIAL_ID ?? '',
};

export const isAdSupported = (): boolean => Capacitor.getPlatform() === 'android';

let initialization: Promise<boolean> | null = null;
let privacyOptionsRequired = false;
const privacyListeners = new Set<(required: boolean) => void>();
let consentUpdate: ReturnType<typeof AdMob.requestConsentInfo> | null = null;

const recordPrivacyOptions = (required: boolean) => {
    privacyOptionsRequired = required;
    privacyListeners.forEach(listener => listener(required));
};

/** UMP의 최신 지역별 설정을 공유해 중복 네트워크 요청을 피합니다. */
const updateConsentInfo = async () => {
    consentUpdate ??= AdMob.requestConsentInfo().finally(() => { consentUpdate = null; });
    const consent = await consentUpdate;
    recordPrivacyOptions(consent.privacyOptionsRequirementStatus === 'REQUIRED');
    return consent;
};

export const refreshAdPrivacyStatus = async (): Promise<void> => {
    if (!isAdSupported()) return;
    await updateConsentInfo();
};

export const subscribeToAdPrivacyOptions = (listener: (required: boolean) => void): (() => void) => {
    privacyListeners.add(listener);
    listener(privacyOptionsRequired);
    return () => { privacyListeners.delete(listener); };
};

/** 사용자가 Google의 개인정보 선택을 다시 열 수 있습니다. */
export const showAdPrivacyOptions = async (): Promise<void> => {
    if (!isAdSupported() || !privacyOptionsRequired) return;
    await AdMob.showPrivacyOptionsForm();
    // 변경한 선택을 반영한 새 광고를 다음 요청에 사용합니다.
    initialization = null;
    videoAdLoadedAt = null;
    await removeBanner();
    await refreshAdPrivacyStatus();
};

/**
 * AdMob을 한 번만 초기화합니다. 유럽 등 동의가 필요한 지역이면 Google UMP 동의 화면을 먼저 띄웁니다.
 * 광고를 요청할 수 없는 상태면 false를 돌려주고, 이때는 배너와 동영상 광고를 모두 건너뜁니다.
 */
export const initializeAds = (): Promise<boolean> => {
    if (!isAdSupported()) return Promise.resolve(false);
    initialization ??= (async () => {
        try {
            const usesTestAds = resolveAdUnit('banner', productionAdUnits).isTesting
                || resolveAdUnit('interstitial', productionAdUnits).isTesting;
            try {
                const consent = await updateConsentInfo();
                if (consent.status === AdmobConsentStatus.REQUIRED && consent.isConsentFormAvailable) {
                    const updated = await AdMob.showConsentForm();
                    recordPrivacyOptions(updated.privacyOptionsRequirementStatus === 'REQUIRED');
                    if (!updated.canRequestAds) return false;
                } else if (!consent.canRequestAds) {
                    return false;
                }
                await AdMob.initialize({ initializeForTesting: usesTestAds });
                return true;
            } catch (error) {
                // Do not request ads when consent eligibility is unknown.
                console.warn('AdMob consent check failed:', error);
                return false;
            }
        } catch (error) {
            console.warn('AdMob initialization failed:', error);
            initialization = null;
            return false;
        }
    })();
    return initialization;
};

// bannerWanted: 지금 배너가 있어야 하는지(마지막 요청 기준). bannerVisible: 실제로 띄웠는지.
// 초기화를 기다리는 사이 광고 제거를 사거나 로그아웃하면, 늦게 끝난 showBanner가 배너를 띄우지 않도록 확인합니다.
let bannerWanted = false;
let bannerVisible = false;
let bannerSizeListener: PluginListenerHandle | null = null;

/**
 * 화면 아래쪽에 작은 배너(320x50)를 띄웁니다. 배너 높이가 정해지면 onHeight로 알려
 * 게임 화면이 배너만큼 위로 올라가 하단 버튼을 가리지 않게 합니다.
 */
export const showBanner = async (onHeight: (height: number) => void): Promise<void> => {
    bannerWanted = true;
    if (!(await initializeAds()) || !bannerWanted || bannerVisible) return;
    bannerVisible = true;
    try {
        bannerSizeListener ??= await AdMob.addListener(BannerAdPluginEvents.SizeChanged, size => {
            if (bannerVisible) onHeight(size.height);
        });
        await AdMob.showBanner({
            ...resolveAdUnit('banner', productionAdUnits),
            adSize: BannerAdSize.BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: 0,
        });
        if (!bannerWanted) {
            // 띄우는 도중에 제거 요청이 왔습니다. 그 요청은 아직 없는 배너를 지웠을 수 있으니 여기서 한 번 더 지웁니다.
            bannerVisible = false;
            await AdMob.removeBanner().catch(() => undefined);
        }
    } catch (error) {
        bannerVisible = false;
        onHeight(0);
        console.warn('Banner ad failed:', error);
    }
};

/** 배너를 완전히 없앱니다(광고 제거 구매, 로그아웃, 화면 종료 때). */
export const removeBanner = async (): Promise<void> => {
    bannerWanted = false;
    if (!isAdSupported() || !bannerVisible) return;
    bannerVisible = false;
    try {
        await AdMob.removeBanner();
    } catch (error) {
        console.warn('Banner removal failed:', error);
    }
    await bannerSizeListener?.remove().catch(() => undefined);
    bannerSizeListener = null;
};

// ── 동영상 전면 광고 ────────────────────────────────────────────────────────
// 쉬는 지점에서 바로 띄울 수 있도록 미리 한 편을 받아 둡니다. 준비되지 않았으면 그 지점은 건너뜁니다
// (늦게 받은 광고를 나중에 갑자기 띄우지 않습니다). 한 번 보여 준 광고는 다시 쓰지 않고 새로 받습니다.

let videoAdLoadedAt: number | null = null;
let videoAdLoading: Promise<boolean> | null = null;
let lastVideoAdLoadFailureAt = Number.NEGATIVE_INFINITY;
let videoAdShowing = false;

/** 바로 띄울 수 있는 동영상 광고가 있는지(받은 지 1시간 가까이 지난 광고는 만료로 봅니다) */
export const isVideoAdReady = (): boolean =>
    videoAdLoadedAt !== null && Date.now() - videoAdLoadedAt < VIDEO_AD_LIMITS.preloadExpiryMs;

/** 동영상 광고를 미리 받습니다. 이미 받았거나 받는 중이면 그대로 둡니다. */
export const prepareVideoAd = (): Promise<boolean> => {
    if (!isAdSupported()) return Promise.resolve(false);
    if (isVideoAdReady()) return Promise.resolve(true);
    if (videoAdLoading) return videoAdLoading;
    if (Date.now() - lastVideoAdLoadFailureAt < VIDEO_AD_LIMITS.loadRetryMs) return Promise.resolve(false);
    videoAdLoading = (async () => {
        try {
            if (!(await initializeAds())) return false;
            videoAdLoadedAt = null;
            await AdMob.prepareInterstitial(resolveAdUnit('interstitial', productionAdUnits));
            videoAdLoadedAt = Date.now();
            return true;
        } catch (error) {
            videoAdLoadedAt = null;
            lastVideoAdLoadFailureAt = Date.now();
            console.warn('Video ad could not be loaded:', error);
            return false;
        } finally {
            videoAdLoading = null;
        }
    })();
    return videoAdLoading;
};

export type VideoAdHandlers = {
    /** 광고 화면이 실제로 나타났을 때(게임 소리를 멈춥니다) */
    onShow?: () => void;
    /** 광고가 닫히거나 띄우지 못했을 때. 항상 한 번 불립니다(게임 소리를 다시 켭니다) */
    onClose?: () => void;
};

/** 닫힘 이벤트가 오지 않아도 게임이 계속 조용하지 않도록 정리하는 시간 */
const VIDEO_AD_SAFETY_TIMEOUT_MS = 3 * 60_000;

/**
 * 미리 받아 둔 동영상 광고를 띄우고, 닫힐 때까지 기다립니다. 실제로 보여 줬으면 true입니다.
 * 플러그인의 showInterstitial은 광고를 띄우자마자 끝나므로, 닫힘·실패 이벤트로 마무리를 알아냅니다.
 */
export const showVideoAd = async (handlers: VideoAdHandlers = {}): Promise<boolean> => {
    if (!isAdSupported() || videoAdShowing || !isVideoAdReady()) {
        handlers.onClose?.();
        return false;
    }
    videoAdShowing = true;
    videoAdLoadedAt = null;
    const listeners: PluginListenerHandle[] = [];
    try {
        return await new Promise<boolean>(resolve => {
            let shown = false;
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(safetyTimer);
                resolve(value);
            };
            const safetyTimer = setTimeout(() => finish(shown), VIDEO_AD_SAFETY_TIMEOUT_MS);
            void Promise.all([
                AdMob.addListener(InterstitialAdPluginEvents.Showed, () => {
                    shown = true;
                    handlers.onShow?.();
                }),
                AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finish(true)),
                AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => finish(shown)),
            ]).then(handles => {
                listeners.push(...handles);
                if (settled) return undefined;
                return AdMob.showInterstitial();
            }).catch(error => {
                console.warn('Video ad failed to show:', error);
                finish(false);
            });
        });
    } finally {
        videoAdShowing = false;
        handlers.onClose?.();
        await Promise.all(listeners.map(handle => handle.remove().catch(() => undefined)));
    }
};
