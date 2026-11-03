import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';
import { findMockBridge, type MockPreviewBridge } from '../../services/mockPreviewBridge';
import { MockPreviewPanel } from './MockPreviewPanel';
import {
    DESKTOP_PREVIEW_QUERY,
    PHONE_BEZEL,
    PHONE_NAV_BAR_HEIGHT,
    PHONE_SCREEN,
    PHONE_STATUS_BAR_HEIGHT,
    isMockScreenFrame,
    mockScreenUrl,
} from './mockPreviewEnv';

// 로컬 미리보기(npm run dev:mock)의 맨 바깥 화면입니다. index.tsx가 isMonetizationMock일 때만 그리므로 배포 빌드에는 없습니다.
//
// ● 데스크톱 브라우저: 가운데에 세로 휴대폰(412×915, 상태 표시줄, 둥근 모서리 기기 테두리)을 두고,
//   그 안의 iframe에서 게임을 돌립니다. iframe은 진짜 휴대폰처럼 폭 412px 화면이라 게임의 모바일 배치가 그대로 나옵니다.
//   미리보기 배지와 도구 패널은 휴대폰 바깥 옆에 둡니다. 바깥 문서는 게임을 돌리지 않습니다(저장·탭 잠금이 겹치지 않음).
// ● 휴대폰 크기 브라우저: 테두리 없이 전체 화면 게임. 도구는 구석의 작은 접이식 버튼 하나(MonetizationMockLayer)뿐입니다.
// ● 기기 테두리 안 iframe(주소에 mock-screen 표시): 게임만 그립니다.

type Mode = 'screen' | 'device' | 'phone';

const PHONE_APP_HEIGHT = PHONE_SCREEN.height - PHONE_STATUS_BAR_HEIGHT - PHONE_NAV_BAR_HEIGHT;
const FRAME = { width: PHONE_SCREEN.width + PHONE_BEZEL * 2, height: PHONE_SCREEN.height + PHONE_BEZEL * 2 };
const PANEL_WIDTH = 320;
const LAYOUT_GAP = 40;
const PAGE_PADDING = 24;
/** 작은 노트북 화면에서도 휴대폰 전체가 보이도록 줄이되, 이보다 작게는 줄이지 않습니다(그때는 스크롤). */
const MIN_SCALE = 0.55;

const pickMode = (): Mode => {
    if (isMockScreenFrame()) return 'screen';
    return window.matchMedia(DESKTOP_PREVIEW_QUERY).matches ? 'device' : 'phone';
};

const fitScale = () => {
    const byHeight = (window.innerHeight - PAGE_PADDING * 2) / FRAME.height;
    const byWidth = (window.innerWidth - PAGE_PADDING * 2 - PANEL_WIDTH - LAYOUT_GAP) / FRAME.width;
    return Math.max(MIN_SCALE, Math.min(1, byHeight, byWidth));
};

const useClock = () => {
    const format = () => new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: false });
    const [time, setTime] = useState(format);
    useEffect(() => {
        const timer = window.setInterval(() => setTime(format()), 15_000);
        return () => window.clearInterval(timer);
    }, []);
    return time;
};

/** 게임 다리를 구독해 광고가 떠 있는지 봅니다(그동안 상태 표시줄을 검게). 다리가 없으면 false */
const noop = () => () => undefined;
const useVideoAdShowing = (bridge: MockPreviewBridge | null) => useSyncExternalStore(
    bridge?.subscribe ?? noop,
    () => !!bridge?.getSnapshot().ui.videoAd,
);

/** Android 상태 표시줄: 시간, 가운데 카메라 구멍, 신호·와이파이·배터리 */
const StatusBar: React.FC<{ dark: boolean }> = ({ dark }) => {
    const time = useClock();
    return (
        <div
            className={`relative flex shrink-0 items-center justify-between px-6 text-[13px] font-medium text-white transition-colors ${dark ? 'bg-black' : 'bg-gray-900'}`}
            style={{ height: PHONE_STATUS_BAR_HEIGHT }}
            aria-hidden="true"
        >
            <span className="tabular-nums">{time}</span>
            <span className="absolute left-1/2 top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black ring-1 ring-neutral-800" />
            <span className="flex items-center gap-1">
                <Signal size={13} strokeWidth={2.5} />
                <Wifi size={13} strokeWidth={2.5} />
                <BatteryFull size={16} strokeWidth={2} />
            </span>
        </div>
    );
};

/** Android 제스처 막대 */
const NavBar: React.FC<{ dark: boolean }> = ({ dark }) => (
    <div className={`flex shrink-0 items-center justify-center transition-colors ${dark ? 'bg-black' : 'bg-gray-900'}`} style={{ height: PHONE_NAV_BAR_HEIGHT }} aria-hidden="true">
        <span className="h-1 w-[108px] rounded-full bg-white/70" />
    </div>
);

/** 데스크톱: 가운데 휴대폰 + 옆 미리보기 패널 */
const MockDeviceShell: React.FC = () => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [bridge, setBridge] = useState<MockPreviewBridge | null>(null);
    const [scale, setScale] = useState(fitScale);
    const [src] = useState(mockScreenUrl);
    const retryRef = useRef<number | undefined>(undefined);
    const adShowing = useVideoAdShowing(bridge);

    useEffect(() => {
        const onResize = () => setScale(fitScale());
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.clearTimeout(retryRef.current);
        };
    }, []);

    // iframe 안 게임이 다 뜨면 그 창의 다리를 잡습니다. 새 게임 등으로 iframe이 새로 고쳐지면 다시 잡습니다.
    const connect = useCallback(() => {
        window.clearTimeout(retryRef.current);
        setBridge(null);
        let tries = 0;
        const attempt = () => {
            const found = findMockBridge(iframeRef.current?.contentWindow);
            if (found) setBridge(() => found);
            else if (tries++ < 100) retryRef.current = window.setTimeout(attempt, 100);
        };
        attempt();
    }, []);

    return (
        <div
            className="flex min-h-full w-full items-center justify-center bg-neutral-300 text-slate-900"
            style={{ padding: PAGE_PADDING, gap: LAYOUT_GAP }}
        >
            {/* 줄인 크기만큼 자리를 잡고, 그 안에서 실제 크기의 휴대폰을 축소해 그립니다. */}
            <div className="shrink-0" style={{ width: FRAME.width * scale, height: FRAME.height * scale }}>
                <div
                    className="relative rounded-[56px] bg-neutral-950 shadow-[0_30px_60px_rgba(0,0,0,0.35),inset_0_0_0_2px_#3f3f46]"
                    style={{ width: FRAME.width, height: FRAME.height, padding: PHONE_BEZEL, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                >
                    {/* 옆면 버튼(전원, 음량) */}
                    <span className="absolute -right-[3px] top-[180px] h-[70px] w-[3px] rounded-r bg-neutral-700" aria-hidden="true" />
                    <span className="absolute -right-[3px] top-[280px] h-[110px] w-[3px] rounded-r bg-neutral-700" aria-hidden="true" />
                    <div
                        className="flex flex-col overflow-hidden rounded-[44px] bg-gray-900"
                        style={{ width: PHONE_SCREEN.width, height: PHONE_SCREEN.height }}
                    >
                        <StatusBar dark={adShowing} />
                        <iframe
                            ref={iframeRef}
                            src={src}
                            onLoad={connect}
                            title="Koiworld 휴대폰 화면"
                            className="block shrink-0 border-0 bg-gray-900"
                            style={{ width: PHONE_SCREEN.width, height: PHONE_APP_HEIGHT }}
                            allow="autoplay"
                        />
                        <NavBar dark={adShowing} />
                    </div>
                </div>
            </div>

            {/* 패널은 브라우저 높이에 맞추고, 내용이 길면 패널 안에서 스크롤합니다. */}
            <MockPreviewPanel
                bridge={bridge}
                className="shrink-0 self-center"
                style={{ width: PANEL_WIDTH, maxHeight: `calc(100svh - ${PAGE_PADDING * 2}px)` }}
            />
        </div>
    );
};

/** 미리보기 모드의 맨 바깥. 화면 크기에 따라 기기 테두리 또는 전체 화면 게임을 그립니다. */
export const MockPreviewRoot: React.FC<{ game: React.ReactNode }> = ({ game }) => {
    const [mode] = useState<Mode>(pickMode);

    // 브라우저 크기가 데스크톱 ↔ 휴대폰 크기 경계를 넘으면 새로 고쳐 알맞은 배치로 다시 엽니다.
    // (두 배치는 게임을 도는 창이 달라 그 자리에서 바꾸지 않습니다. 진행은 미리보기 저장 칸에 남아 있습니다.)
    useEffect(() => {
        if (mode === 'screen') return;
        const query = window.matchMedia(DESKTOP_PREVIEW_QUERY);
        let timer: number | undefined;
        const onChange = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                if ((query.matches ? 'device' : 'phone') !== mode) window.location.reload();
            }, 400);
        };
        query.addEventListener('change', onChange);
        return () => {
            window.clearTimeout(timer);
            query.removeEventListener('change', onChange);
        };
    }, [mode]);

    return mode === 'device' ? <MockDeviceShell /> : <>{game}</>;
};
