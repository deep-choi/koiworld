import { useCallback, useEffect, useRef, useState } from 'react';
import { VIDEO_AD_LIMITS, VIDEO_AD_TRIGGERS, type VideoAdTrigger } from '../config/monetization';
import { monetizationBackend as backend } from '../services/monetizationBackend';
import { trackEvent } from '../services/analytics';
import { audioManager } from '../utils/audio';
import {
    isBreakStillWanted,
    nextVideoAdAt,
    videoAdRequestBlocker,
    type VideoAdBreak,
    type VideoAdClock,
} from '../utils/videoAdPolicy';

type VideoAdOptions = {
    /** 광고를 띄워도 되는 계정·환경인지(Android, 광고 제거 안 함, 혜택을 읽음). useMonetization의 adsEnabled */
    enabled: boolean;
    /** 열린 창·먹이 주기·코이 선택이 없어 화면이 쉬는 중인지 */
    isIdle: boolean;
    /** 결제창, 로그인 창, 저장 복구 화면처럼 광고를 절대 띄우면 안 되는 상태인지 */
    isBlocked: boolean;
};

/**
 * 쉬는 지점에서만 동영상 광고(전면 광고)를 띄웁니다. 실제 AdMob과 로컬 미리보기가 같은 순서를 따릅니다.
 *
 * 1. 교배·판매·연못 넘기기가 끝나면 requestBreak로 "쉬는 지점"을 알립니다.
 * 2. 앱을 켠 지 3분 안이거나 직전 광고 뒤 5분이 안 지났으면 요청을 버립니다(config/monetization.ts).
 * 3. 화면에 열린 창이 없어질 때까지 기다린 뒤(최대 2분), 지점별 잠깐(settleMs) 동안 아무것도 누르지 않으면 띄웁니다.
 *    그사이 화면을 누르거나 앱을 내리면 하던 일을 방해하지 않도록 이번 광고는 건너뜁니다.
 * 4. 광고가 떠 있는 동안 게임 소리를 멈추고, 닫히면 다시 켠 뒤 다음 광고를 미리 받습니다.
 */
export const useVideoAds = ({ enabled, isIdle, isBlocked }: VideoAdOptions) => {
    const [clock, setClock] = useState<VideoAdClock>(() => ({ launchedAt: Date.now(), lastShownAt: null }));
    const [pending, setPending] = useState<VideoAdBreak | null>(null);
    const [isShowing, setIsShowing] = useState(false);
    const clockRef = useRef(clock);
    clockRef.current = clock;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const showingRef = useRef(false);

    // 쉬는 지점에서 바로 띄울 수 있도록 미리 받아 둡니다.
    useEffect(() => {
        if (enabled) void backend.prepareVideoAd();
    }, [enabled]);

    const show = useCallback(async (trigger: VideoAdTrigger | 'preview'): Promise<boolean> => {
        if (showingRef.current) return false;
        showingRef.current = true;
        setIsShowing(true);
        try {
            const shown = await backend.showVideoAd({
                onShow: () => audioManager.pauseForAd(),
                onClose: () => audioManager.resumeAfterAd(),
            });
            if (shown) {
                // 간격은 광고가 끝난 때부터 셉니다.
                setClock(current => ({ ...current, lastShownAt: Date.now() }));
                trackEvent('video_ad_show', { trigger });
            }
            return shown;
        } finally {
            showingRef.current = false;
            setIsShowing(false);
            if (enabledRef.current) void backend.prepareVideoAd();
        }
    }, []);

    /** 쉬는 지점을 알립니다. 지금 띄울 수 없으면 아무 일도 하지 않습니다. */
    const requestBreak = useCallback((trigger: VideoAdTrigger) => {
        const now = Date.now();
        if (videoAdRequestBlocker({ enabled: enabledRef.current, trigger, showing: showingRef.current, clock: clockRef.current, now })) return;
        if (!backend.isVideoAdReady()) {
            // 준비된 광고가 없으면 이번 지점은 건너뛰고 다음을 위해 받아 둡니다.
            void backend.prepareVideoAd();
            return;
        }
        setPending({ trigger, requestedAt: now });
    }, []);

    useEffect(() => {
        if (!pending) return;
        if (!enabled || isBlocked) {
            setPending(null);
            return;
        }
        if (!isIdle) return; // 연못 현황 같은 창이 닫힐 때까지 기다립니다.
        const now = Date.now();
        if (!isBreakStillWanted(pending, now) || now < nextVideoAdAt(clockRef.current)) {
            setPending(null);
            return;
        }
        // 화면을 누르거나 키를 누르면 플레이어가 다른 일을 시작한 것이므로 이번 광고는 건너뜁니다.
        const skip = () => setPending(null);
        const skipWhenHidden = () => { if (document.visibilityState !== 'visible') skip(); };
        window.addEventListener('pointerdown', skip, true);
        window.addEventListener('keydown', skip, true);
        document.addEventListener('visibilitychange', skipWhenHidden);
        const timer = window.setTimeout(() => {
            setPending(null);
            if (document.visibilityState !== 'visible' || !enabledRef.current || !backend.isVideoAdReady()) return;
            void show(pending.trigger);
        }, VIDEO_AD_TRIGGERS[pending.trigger].settleMs);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('pointerdown', skip, true);
            window.removeEventListener('keydown', skip, true);
            document.removeEventListener('visibilitychange', skipWhenHidden);
        };
    }, [pending, enabled, isIdle, isBlocked, show]);

    /** 시간 제한 없이 바로 띄웁니다(로컬 미리보기 패널 전용). */
    const showNow = useCallback(() => {
        setPending(null);
        if (enabledRef.current) void show('preview');
    }, [show]);

    /** 시작 대기와 광고 간격을 비워 다음 쉬는 지점에서 바로 광고가 나오게 합니다(로컬 미리보기 패널 전용). */
    const resetTimers = useCallback(() => {
        setPending(null);
        setClock({ launchedAt: Date.now() - VIDEO_AD_LIMITS.launchGraceMs, lastShownAt: null });
    }, []);

    return {
        requestBreak,
        showNow,
        resetTimers,
        isShowing,
        /** 다음 광고를 띄울 수 있는 가장 이른 시각 */
        nextAdAt: nextVideoAdAt(clock),
        /** 창이 닫히길 기다리는 쉬는 지점 */
        pendingTrigger: pending?.trigger ?? null,
    };
};
