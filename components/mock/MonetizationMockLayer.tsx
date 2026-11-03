import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { LoaderCircle, Minus, Plus, Wrench, X } from 'lucide-react';
import { VIDEO_AD_TRIGGERS, type PlayProductId, type VideoAdTrigger } from '../../config/monetization';
import { MAX_PAID_POND_SLOTS, isPaidPondId, type AccountEntitlements } from '../../functions/src/saveValidation';
import {
    MOCK_PRODUCT_NAMES,
    MOCK_SAMPLE_PRICES,
    answerMockPurchase,
    closeMockVideoAd,
    mockUiStore,
    setMockEntitlements,
} from '../../services/mockMonetization';
import { formatWait } from '../../utils/videoAdPolicy';
import type { Ponds } from '../../types';

// 로컬 미리보기(npm run dev:mock) 전용 화면입니다. App.tsx가 isMonetizationMock일 때만 그리므로 배포 빌드에는 없습니다.
// 배지·배너 자리·동영상 광고 자리·가짜 Google Play 결제창·미리보기 도구를 그립니다.

/** 실제 동영상 광고와 비슷하게 15초를 세고, 5초 뒤부터 건너뛸 수 있게 합니다. */
const MOCK_VIDEO_LENGTH_SECONDS = 15;
const MOCK_VIDEO_SKIP_AFTER_SECONDS = 5;

// 모바일은 글 아래 전체 폭 버튼, 넓은 화면(sm 이상)은 한 줄 정렬입니다.
const BUTTON = 'w-full sm:w-auto h-11 px-4 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-emerald-600 text-white enabled:hover:bg-emerald-700`;
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700 enabled:hover:bg-slate-100`;
const PANEL_BUTTON = 'w-full h-10 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50';

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

const useNow = (active: boolean, intervalMs: number) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(timer);
    }, [active, intervalMs]);
    return now;
};

/** 동영상 광고 자리: 15초를 세는 전체 화면. 실제 광고처럼 5초 뒤부터 건너뛸 수 있습니다. */
const VideoAdPlaceholder: React.FC<{ startedAt: number }> = ({ startedAt }) => {
    const now = useNow(true, 200);
    const elapsed = Math.max(0, (now - startedAt) / 1000);
    const remaining = Math.max(0, Math.ceil(MOCK_VIDEO_LENGTH_SECONDS - elapsed));
    const canSkip = elapsed >= MOCK_VIDEO_SKIP_AFTER_SECONDS;
    const finished = elapsed >= MOCK_VIDEO_LENGTH_SECONDS;
    const progress = Math.min(100, (elapsed / MOCK_VIDEO_LENGTH_SECONDS) * 100);
    return (
        <div
            // 실제 AdMob 광고는 앱 화면 위에 뜨는 별도 화면이라 게임의 어떤 창보다도 위에 그립니다.
            className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-4 bg-slate-950 px-4 text-center text-white"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mock-video-ad-title"
        >
            <p className="text-xs font-medium tracking-wide text-amber-300">미리보기 · 실제 광고가 아니에요</p>
            <h2 id="mock-video-ad-title" className="text-2xl font-semibold">동영상 광고 자리</h2>
            <p className="max-w-sm text-sm leading-relaxed text-white/70 break-keep">
                실제 앱에서는 여기에 AdMob 동영상 광고가 나옵니다. 길이는 AdMob이 정하며 보통 15~30초예요. 게임 소리는 멈춰 있어요.
            </p>
            <p className="text-6xl font-semibold tabular-nums" aria-live="polite">{remaining}</p>
            <div className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-white/15" aria-hidden="true">
                <div className="h-full bg-amber-300 transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
            <div className="w-full max-w-sm">
                <button
                    type="button"
                    onClick={closeMockVideoAd}
                    disabled={!canSkip}
                    className={`${BUTTON} sm:w-full bg-white text-slate-900 enabled:hover:bg-slate-200`}
                >
                    {finished ? '광고 닫기' : canSkip ? '광고 건너뛰기' : `${Math.ceil(MOCK_VIDEO_SKIP_AFTER_SECONDS - elapsed)}초 뒤 건너뛸 수 있어요`}
                </button>
            </div>
        </div>
    );
};

/** Google Play 결제창 흉내. 아래쪽에 여백을 두고 붙는 창이며, 넓은 화면에서는 가운데에 뜹니다. */
const PurchaseSheet: React.FC<{ productId: PlayProductId; phase: 'choose' | 'processing' }> = ({ productId, phase }) => {
    const processing = phase === 'processing';
    return (
        <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/50 p-4 sm:items-center">
            <div
                className="light-modal w-full max-w-md rounded-2xl bg-white text-slate-900 shadow-2xl animate-fade-in-up"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mock-play-title"
            >
                <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
                    <h2 id="mock-play-title" className="text-sm font-medium text-slate-600">Google Play 결제 미리보기</h2>
                    <span className="shrink-0 text-xs font-medium text-amber-700">가짜 결제 · 청구 없음</span>
                </div>
                <div className="border-t border-slate-200 px-5 py-4">
                    <p className="text-base font-medium">{MOCK_PRODUCT_NAMES[productId]}</p>
                    <p className="text-sm text-slate-500">Koiworld</p>
                    <p className="mt-3 flex items-baseline gap-2">
                        <span className="text-lg font-semibold">{MOCK_SAMPLE_PRICES[productId]}</span>
                        <span className="text-xs text-slate-500">예시 가격(실제 가격은 Play Console에서 정해요)</span>
                    </p>
                </div>
                <div className="border-t border-slate-200 px-5 py-4">
                    {processing ? (
                        <p className="flex h-11 items-center justify-center gap-2 text-sm text-slate-600" role="status">
                            <LoaderCircle size={18} className="animate-spin text-emerald-600" aria-hidden="true" />
                            결제 처리 중…
                        </p>
                    ) : (
                        <div className="flex flex-col gap-2 sm:flex-row-reverse">
                            <button type="button" onClick={() => answerMockPurchase('buy')} className={PRIMARY}>구매</button>
                            <button type="button" onClick={() => answerMockPurchase('cancel')} className={SECONDARY}>취소</button>
                            <button
                                type="button"
                                onClick={() => answerMockPurchase('pending')}
                                className={`${BUTTON} text-slate-500 enabled:hover:bg-slate-100 sm:mr-auto`}
                            >
                                결제 대기로 끝내기
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/** 미리보기 도구: 시간 제한 없이 광고 보기, 타이머·구매 내역 초기화, 혜택 직접 바꾸기 */
const MockControlPanel: React.FC<Props> = ({ videoAds, entitlements, adsEnabled, ponds, activePondId, setPonds, setActivePondId }) => {
    const [open, setOpen] = useState(false);
    const now = useNow(open, 1000);
    const wait = videoAds.nextAdAt - now;

    const resetPurchases = () => {
        const paidIds = Object.keys(ponds).filter(isPaidPondId);
        const withKoi = paidIds.filter(id => ponds[id].kois.length > 0);
        if (withKoi.length > 0 && !window.confirm(`유료 연못 ${withKoi.length}곳에 코이가 있어요. 미리보기 저장에서 함께 지울까요?`)) return;
        setMockEntitlements({ paidPondSlots: 0, adFree: false });
        if (paidIds.length === 0) return;
        if (isPaidPondId(activePondId)) setActivePondId('pond-1');
        setPonds(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !isPaidPondId(id))));
    };

    const setSlots = (slots: number) => setMockEntitlements({ paidPondSlots: Math.max(0, Math.min(MAX_PAID_POND_SLOTS, slots)) });

    const adStatus = !adsEnabled
        ? '광고 제거가 켜져 있어 배너와 동영상 광고가 나오지 않아요.'
        : wait > 0
            ? `다음 동영상 광고까지 ${formatWait(wait)} 남았어요.`
            : '지금은 쉬는 지점에서 동영상 광고가 나와요.';

    return (
        <div className="fixed left-4 bottom-[calc(1rem+var(--ad-banner-height,0px)+env(safe-area-inset-bottom))] z-[1400] flex flex-col items-start gap-2">
            {open && (
                <section
                    className="light-modal fixed inset-x-4 bottom-[calc(4.5rem+var(--ad-banner-height,0px)+env(safe-area-inset-bottom))] max-h-[70svh] overflow-y-auto rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl light-scrollbar sm:inset-x-auto sm:left-4 sm:w-80"
                    aria-labelledby="mock-panel-title"
                >
                    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
                        <h2 id="mock-panel-title" className="text-base font-medium text-slate-900">미리보기 도구</h2>
                        <button type="button" onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 flex items-center justify-center" aria-label="미리보기 도구 닫기">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="divide-y divide-slate-200 border-t border-slate-200">
                        <div className="px-4 py-3">
                            <h3 className="text-xs font-semibold tracking-wide text-slate-500">동영상 광고</h3>
                            <p className="mt-1 text-sm leading-relaxed break-keep" aria-live="polite">{adStatus}</p>
                            {videoAds.pendingTrigger && (
                                <p className="mt-1 text-xs leading-relaxed text-amber-700 break-keep">
                                    대기 중: {VIDEO_AD_TRIGGERS[videoAds.pendingTrigger].label}. 열린 창을 닫고 잠시 기다리면 나와요.
                                </p>
                            )}
                            <p className="mt-1 text-xs leading-relaxed text-slate-500 break-keep">
                                쉬는 지점: {Object.values(VIDEO_AD_TRIGGERS).filter(trigger => trigger.enabled).map(trigger => trigger.label).join(' · ')}
                            </p>
                            <div className="mt-3 flex flex-col gap-2">
                                <button type="button" onClick={videoAds.showNow} disabled={!adsEnabled || videoAds.isShowing} className={`${PANEL_BUTTON} bg-slate-900 text-white enabled:hover:bg-slate-700`}>
                                    지금 동영상 광고 보기
                                </button>
                                <button type="button" onClick={videoAds.resetTimers} className={`${PANEL_BUTTON} border border-slate-300 text-slate-700 enabled:hover:bg-slate-100`}>
                                    광고 타이머 초기화
                                </button>
                            </div>
                        </div>

                        <div className="px-4 py-3">
                            <h3 className="text-xs font-semibold tracking-wide text-slate-500">가짜 혜택</h3>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-sm">광고 제거</span>
                                <button
                                    type="button"
                                    onClick={() => setMockEntitlements({ adFree: !entitlements.adFree })}
                                    aria-pressed={entitlements.adFree}
                                    className={`h-8 min-w-[4.5rem] rounded-full px-3 text-xs font-semibold transition-colors ${entitlements.adFree ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                                >
                                    {entitlements.adFree ? '켜짐' : '꺼짐'}
                                </button>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-sm">연못 확장권 {entitlements.paidPondSlots}/{MAX_PAID_POND_SLOTS}</span>
                                <div className="inline-flex items-center rounded-full border border-slate-300">
                                    <button type="button" onClick={() => setSlots(entitlements.paidPondSlots - 1)} disabled={entitlements.paidPondSlots <= 0} className="w-8 h-8 flex items-center justify-center text-slate-500 disabled:opacity-40" aria-label="연못 확장권 하나 줄이기">
                                        <Minus size={14} />
                                    </button>
                                    <button type="button" onClick={() => setSlots(entitlements.paidPondSlots + 1)} disabled={entitlements.paidPondSlots >= MAX_PAID_POND_SLOTS} className="w-8 h-8 flex items-center justify-center text-slate-500 disabled:opacity-40" aria-label="연못 확장권 하나 늘리기">
                                        <Plus size={14} />
                                    </button>
                                </div>
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-slate-500 break-keep">
                                수를 줄여도 이미 생긴 연못은 실제처럼 남아요. 연못까지 지우려면 구매 내역을 초기화하세요.
                            </p>
                            <button type="button" onClick={resetPurchases} className={`${PANEL_BUTTON} mt-3 border border-rose-300 text-rose-700 enabled:hover:bg-rose-50`}>
                                구매 내역 초기화
                            </button>
                        </div>

                        <p className="px-4 py-3 text-xs leading-relaxed text-slate-500 break-keep">
                            미리보기 모드에서는 로그인, 클라우드 저장, Cloud Functions, 통계가 모두 꺼져 있어요. 이 브라우저의 미리보기 저장 칸만 써요.
                        </p>
                    </div>
                </section>
            )}
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                className="flex h-10 items-center gap-2 rounded-full bg-amber-400 px-4 text-sm font-semibold text-amber-950 shadow-lg hover:bg-amber-300"
            >
                <Wrench size={16} aria-hidden="true" />
                미리보기 도구
            </button>
        </div>
    );
};

/** 미리보기 화면 전체: 배지, 배너 자리, 동영상 광고 자리, 가짜 결제창, 미리보기 도구 */
export const MonetizationMockLayer: React.FC<Props> = props => {
    const ui = useSyncExternalStore(mockUiStore.subscribe, mockUiStore.getSnapshot);
    return (
        <>
            <div
                className="pointer-events-none fixed left-1/2 top-[calc(0.25rem+env(safe-area-inset-top))] z-[10001] -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400 px-3 py-0.5 text-[11px] font-semibold text-amber-950 shadow"
                role="status"
            >
                미리보기 모드 (결제·광고 가짜)
            </div>

            {ui.banner && (
                <div
                    className="fixed inset-x-0 bottom-0 z-[1300] flex items-center justify-center border-t border-dashed border-slate-400 bg-slate-200 text-xs font-medium text-slate-600"
                    style={{ height: 'var(--ad-banner-height, 50px)' }}
                    aria-label="배너 광고 자리"
                >
                    배너 광고 자리 · 실제 앱에서는 AdMob 배너(320x50)
                </div>
            )}

            <MockControlPanel {...props} />

            {ui.purchase && <PurchaseSheet productId={ui.purchase.productId} phase={ui.purchase.phase} />}
            {ui.videoAd && <VideoAdPlaceholder startedAt={ui.videoAd.startedAt} />}
        </>
    );
};
