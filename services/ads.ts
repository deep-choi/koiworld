import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
    AdMob,
    AdmobConsentStatus,
    BannerAdPluginEvents,
    BannerAdPosition,
    BannerAdSize,
    RewardAdPluginEvents,
} from '@capacitor-community/admob';
import { resolveAdUnit } from '../config/monetization';

// AdMob(Android 전용) 래퍼입니다. 웹에서는 모든 함수가 아무 일도 하지 않습니다.
// 이 게임은 작은 배너와 사용자가 원할 때만 보는 보상형 광고만 씁니다. 전면 광고는 쓰지 않습니다.

/** 실제 광고 단위 ID. 기본은 비어 있어 테스트 광고가 나옵니다. 출시 때 VITE_ADMOB_* 환경 변수로만 채웁니다. */
const productionAdUnits = {
    banner: import.meta.env.VITE_ADMOB_BANNER_ID ?? '',
    rewarded: import.meta.env.VITE_ADMOB_REWARDED_ID ?? '',
};

export const isAdSupported = (): boolean => Capacitor.getPlatform() === 'android';

let initialization: Promise<boolean> | null = null;

/**
 * AdMob을 한 번만 초기화합니다. 유럽 등 동의가 필요한 지역이면 Google UMP 동의 화면을 먼저 띄웁니다.
 * 광고를 요청할 수 없는 상태면 false를 돌려주고, 이때는 배너와 보상형 광고를 모두 건너뜁니다.
 */
export const initializeAds = (): Promise<boolean> => {
    if (!isAdSupported()) return Promise.resolve(false);
    initialization ??= (async () => {
        try {
            const usesTestAds = resolveAdUnit('banner', productionAdUnits).isTesting
                || resolveAdUnit('rewarded', productionAdUnits).isTesting;
            await AdMob.initialize({ initializeForTesting: usesTestAds });
            try {
                const consent = await AdMob.requestConsentInfo();
                if (consent.status === AdmobConsentStatus.REQUIRED && consent.isConsentFormAvailable) {
                    const updated = await AdMob.showConsentForm();
                    return updated.canRequestAds;
                }
                return consent.canRequestAds;
            } catch (error) {
                // 동의 정보를 못 받아도(네트워크 등) 동의가 필요 없는 지역에서는 광고를 요청할 수 있습니다.
                console.warn('AdMob consent check failed:', error);
                return true;
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

/**
 * 보상형 광고를 보여 주고, 끝까지 봐서 보상을 받을 자격이 생겼는지 돌려줍니다.
 * 플러그인은 보상을 못 받고 닫으면 promise를 끝내지 않으므로, 닫힘·실패 이벤트로 직접 마무리합니다.
 */
export const showRewardedAd = async (): Promise<boolean> => {
    if (!(await initializeAds())) return false;
    const listeners: PluginListenerHandle[] = [];
    try {
        await AdMob.prepareRewardVideoAd(resolveAdUnit('rewarded', productionAdUnits));
        return await new Promise<boolean>(resolve => {
            let earned = false;
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            void Promise.all([
                AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; }),
                AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(earned)),
                AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)),
            ]).then(handles => {
                listeners.push(...handles);
                return AdMob.showRewardVideoAd();
            }).then(() => {
                // 보상 지급 시점에 resolve됩니다. 화면이 닫힌 뒤(Dismissed) 보상을 반영합니다.
                earned = true;
            }).catch(error => {
                console.warn('Rewarded ad failed:', error);
                finish(false);
            });
        });
    } catch (error) {
        console.warn('Rewarded ad could not be prepared:', error);
        return false;
    } finally {
        await Promise.all(listeners.map(handle => handle.remove().catch(() => undefined)));
    }
};
