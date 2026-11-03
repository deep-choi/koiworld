import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Wrench } from 'lucide-react';
import type { VideoAdTrigger } from '../../config/monetization';
import { isPaidPondId, type AccountEntitlements } from '../../functions/src/saveValidation';
import { mockUiStore } from '../../services/mockMonetization';
import { mockPreviewBridge, publishMockGame } from '../../services/mockPreviewBridge';
import type { Ponds } from '../../types';
import { MockPlaySheet } from './MockPlaySheet';
import { MockPreviewPanel } from './MockPreviewPanel';
import { MockTestBanner } from './MockTestBanner';
import { MockVideoAd } from './MockVideoAd';
import { isMockScreenFrame } from './mockPreviewEnv';

// 로컬 미리보기(npm run dev:mock) 전용. 게임(App.tsx) 안에서 실제 앱에 있는 것만 그립니다:
// AdMob 테스트 배너, 전면 동영상 광고, Google Play 결제 시트. App.tsx가 isMonetizationMock일 때만 그리므로 배포 빌드에는 없습니다.
// 미리보기 배지와 도구는 휴대폰 화면 바깥(components/mock/MockPreviewRoot.tsx)에 있고, 이 화면과는 다리(services/mockPreviewBridge.ts)로 이어집니다.
// 휴대폰 크기 브라우저(기기 테두리 없음)에서만 구석의 작은 접이식 버튼으로 같은 도구를 엽니다.

type VideoAdControls = {
    showNow: () => void;
    resetTimers: () => void;
    nextAdAt: number;
    pendingTrigger: VideoAdTrigger | null;
    isShowing: boolean;
};

type Props = {
    videoAds: VideoAdControls;
    entitlements: AccountEntitlements;
    adsEnabled: boolean;
    ponds: Ponds;
    activePondId: string;
    setPonds: React.Dispatch<React.SetStateAction<Ponds>>;
    setActivePondId: (pondId: string) => void;
};

/** 게임 상태를 바깥 패널에 알리고, 패널이 부를 동작을 맡깁니다. */
const usePublishGame = ({ videoAds, entitlements, adsEnabled, ponds, activePondId, setPonds, setActivePondId }: Props) => {
    const latest = useRef({ videoAds, activePondId, setPonds, setActivePondId });
    latest.current = { videoAds, activePondId, setPonds, setActivePondId };
    const paidIds = Object.keys(ponds).filter(isPaidPondId);
    const paidPondsWithKoi = paidIds.filter(id => ponds[id].kois.length > 0).length;

    useEffect(() => {
        publishMockGame({
            adsEnabled,
            entitlements,
            nextAdAt: videoAds.nextAdAt,
            pendingTrigger: videoAds.pendingTrigger,
            isVideoAdShowing: videoAds.isShowing,
            paidPondCount: paidIds.length,
            paidPondsWithKoi,
        }, {
            showVideoAdNow: () => latest.current.videoAds.showNow(),
            resetAdTimers: () => latest.current.videoAds.resetTimers(),
            removePaidPonds: () => {
                const current = latest.current;
                if (isPaidPondId(current.activePondId)) current.setActivePondId('pond-1');
                current.setPonds(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !isPaidPondId(id))));
            },
        });
    });
};

/** 휴대폰 크기 브라우저 전용: 구석의 작은 버튼과 펼친 도구 패널 */
const CornerTools: React.FC<{ noticeId: number | null }> = ({ noticeId }) => {
    const [open, setOpen] = useState(false);
    // 로그인 버튼처럼 이유를 알려야 할 때는 패널을 펼쳐 안내를 보여 줍니다.
    useEffect(() => {
        if (noticeId !== null) setOpen(true);
    }, [noticeId]);
    return (
        <>
            {open && (
                <div className="fixed inset-x-2 bottom-[calc(3.25rem+var(--ad-banner-height,0px)+env(safe-area-inset-bottom))] z-[1400] flex max-h-[75svh]">
                    <MockPreviewPanel bridge={mockPreviewBridge} onClose={() => setOpen(false)} className="w-full" />
                </div>
            )}
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                aria-label={open ? '미리보기 도구 접기' : '미리보기 도구 열기'}
                className="fixed left-2 bottom-[calc(0.5rem+var(--ad-banner-height,0px)+env(safe-area-inset-bottom))] z-[1400] flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/90 text-amber-950 shadow-md hover:bg-amber-300"
            >
                <Wrench size={15} aria-hidden="true" />
            </button>
        </>
    );
};

export const MonetizationMockLayer: React.FC<Props> = props => {
    const ui = useSyncExternalStore(mockUiStore.subscribe, mockUiStore.getSnapshot);
    const [insideDeviceFrame] = useState(isMockScreenFrame);
    usePublishGame(props);
    return (
        <>
            {ui.banner && <MockTestBanner />}
            {!insideDeviceFrame && <CornerTools noticeId={ui.notice?.id ?? null} />}
            {ui.purchase && <MockPlaySheet productId={ui.purchase.productId} phase={ui.purchase.phase} outcome={ui.purchase.outcome} />}
            {ui.videoAd && <MockVideoAd startedAt={ui.videoAd.startedAt} />}
        </>
    );
};
