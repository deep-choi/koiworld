import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { VIDEO_AD_TRIGGERS } from '../../config/monetization';
import { MAX_PAID_POND_SLOTS } from '../../functions/src/saveValidation';
import type { MockPurchaseOutcome } from '../../services/mockMonetization';
import type { MockPreviewBridge } from '../../services/mockPreviewBridge';
import { formatWait } from '../../utils/videoAdPolicy';

// 로컬 미리보기(npm run dev:mock) 전용 도구 패널. 휴대폰 화면 바깥에 그립니다.
// 데스크톱: 기기 테두리 옆에 늘 펼쳐 둡니다. 휴대폰 크기 브라우저: 구석의 작은 버튼을 누르면 펼쳐집니다.
// 게임은 다리(bridge)로만 바꿉니다. 데스크톱에서는 그 다리가 기기 테두리 안 iframe 창에 있습니다.

export const MOCK_PREVIEW_BADGE = '미리보기 모드 · 실제 청구 없음';

const PANEL_BUTTON = 'w-full h-10 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const OUTCOMES: Array<{ value: MockPurchaseOutcome; label: string; detail: string }> = [
    { value: 'approve', label: '승인', detail: '테스트 카드, 항상 승인: 처리 중 → 결제 완료 → 혜택이 바로 생겨요.' },
    { value: 'pending', label: '결제 대기', detail: '느린 테스트 카드: 시트가 닫히고 "결제가 아직 처리 중이에요" 알림만 나와요. 혜택은 생기지 않아요.' },
    { value: 'cancel', label: '취소', detail: '"구매"를 누르면 사용자가 결제 창을 닫은 것처럼 끝나요. 시트 바깥을 눌러도 취소돼요.' },
];

const useNow = (intervalMs: number) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(timer);
    }, [intervalMs]);
    return now;
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="px-4 py-3">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500">{title}</h3>
        {children}
    </div>
);

type Props = {
    bridge: MockPreviewBridge | null;
    /** 휴대폰 크기 브라우저에서 접는 버튼(없으면 닫기 버튼을 그리지 않음) */
    onClose?: () => void;
    className?: string;
    style?: React.CSSProperties;
};

export const MockPreviewPanel: React.FC<Props> = ({ bridge, onClose, className = '', style }) => (
    <section
        className={`light-modal flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-xl ${className}`}
        style={style}
        aria-labelledby="mock-panel-title"
    >
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
            <div className="min-w-0">
                <p className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900" role="status">
                    {MOCK_PREVIEW_BADGE}
                </p>
                <h2 id="mock-panel-title" className="mt-2 text-base font-medium text-slate-900">미리보기 도구</h2>
            </div>
            {onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    aria-label="미리보기 도구 접기"
                >
                    <X size={16} />
                </button>
            )}
        </div>
        {bridge ? <PanelBody bridge={bridge} /> : (
            <p className="border-t border-slate-200 px-4 py-4 text-sm text-slate-500" role="status">게임을 불러오는 중…</p>
        )}
    </section>
);

const PanelBody: React.FC<{ bridge: MockPreviewBridge }> = ({ bridge }) => {
    const { ui, game } = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
    const now = useNow(1000);
    const { actions } = bridge;

    if (!game) {
        return <p className="border-t border-slate-200 px-4 py-4 text-sm text-slate-500" role="status">게임을 불러오는 중…</p>;
    }

    const wait = game.nextAdAt - now;
    const adStatus = !game.adsEnabled
        ? '광고 제거가 켜져 있어 배너와 동영상 광고가 나오지 않아요.'
        : game.isVideoAdShowing
            ? '지금 동영상 광고가 재생 중이에요.'
            : wait > 0
                ? `다음 동영상 광고까지 ${formatWait(wait)} 남았어요.`
                : '지금은 쉬는 지점에서 동영상 광고가 나와요.';
    const outcome = OUTCOMES.find(item => item.value === ui.purchaseOutcome) ?? OUTCOMES[0];
    const sheetOpen = ui.purchase?.phase === 'choose';

    const resetPurchases = () => {
        if (game.paidPondsWithKoi > 0
            && !window.confirm(`유료 연못 ${game.paidPondsWithKoi}곳에 코이가 있어요. 미리보기 저장에서 함께 지울까요?`)) return;
        actions.resetPurchases();
    };

    return (
        <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto border-t border-slate-200 light-scrollbar">
            {ui.notice && (
                <div className="flex items-start gap-3 bg-amber-50 px-4 py-3" role="alert">
                    <p className="min-w-0 flex-1 text-sm leading-relaxed text-amber-950 break-keep">{ui.notice.message}</p>
                    <button type="button" onClick={actions.dismissNotice} className="shrink-0 text-xs font-medium text-amber-800 hover:underline">
                        확인
                    </button>
                </div>
            )}

            <Section title="Google Play 결제">
                <p className="mt-1 text-sm leading-relaxed break-keep">시트의 "구매"를 누르면</p>
                <div className="mt-2 grid grid-cols-3 rounded-lg border border-slate-300 p-0.5" role="radiogroup" aria-label="결제 결과">
                    {OUTCOMES.map(item => (
                        <button
                            key={item.value}
                            type="button"
                            role="radio"
                            aria-checked={ui.purchaseOutcome === item.value}
                            onClick={() => actions.setPurchaseOutcome(item.value)}
                            className={`h-9 rounded-md text-sm font-medium transition-colors ${ui.purchaseOutcome === item.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500 break-keep">{outcome.detail}</p>
                <button
                    type="button"
                    onClick={actions.cancelPurchase}
                    disabled={!sheetOpen}
                    className={`${PANEL_BUTTON} mt-3 border border-slate-300 text-slate-700 enabled:hover:bg-slate-100`}
                >
                    열린 결제 창 닫기(취소)
                </button>
                <p className="mt-2 text-xs leading-relaxed text-slate-500 break-keep">가격(₩2,500, ₩5,500)은 예시예요. 실제 가격은 Play Console에서 정해요.</p>
            </Section>

            <Section title="동영상 광고">
                <p className="mt-1 text-sm leading-relaxed break-keep" aria-live="polite">{adStatus}</p>
                {game.pendingTrigger && (
                    <p className="mt-1 text-xs leading-relaxed text-amber-700 break-keep">
                        대기 중: {VIDEO_AD_TRIGGERS[game.pendingTrigger].label}. 열린 창을 닫고 잠시 기다리면 나와요.
                    </p>
                )}
                <p className="mt-1 text-xs leading-relaxed text-slate-500 break-keep">
                    쉬는 지점: {Object.values(VIDEO_AD_TRIGGERS).filter(trigger => trigger.enabled).map(trigger => trigger.label).join(' · ')}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={actions.showVideoAdNow}
                        disabled={!game.adsEnabled || game.isVideoAdShowing}
                        className={`${PANEL_BUTTON} bg-slate-900 text-white enabled:hover:bg-slate-700`}
                    >
                        지금 동영상 광고 보기
                    </button>
                    <button type="button" onClick={actions.resetAdTimers} className={`${PANEL_BUTTON} border border-slate-300 text-slate-700 enabled:hover:bg-slate-100`}>
                        광고 타이머 초기화
                    </button>
                </div>
            </Section>

            <Section title="가짜 혜택">
                <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-sm">광고 제거</span>
                    <button
                        type="button"
                        onClick={() => actions.setAdFree(!game.entitlements.adFree)}
                        aria-pressed={game.entitlements.adFree}
                        className={`h-8 min-w-[4.5rem] rounded-full px-3 text-xs font-semibold transition-colors ${game.entitlements.adFree ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                    >
                        {game.entitlements.adFree ? '켜짐' : '꺼짐'}
                    </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-sm">연못 확장권 {game.entitlements.paidPondSlots}/{MAX_PAID_POND_SLOTS}</span>
                    <div className="inline-flex items-center rounded-full border border-slate-300">
                        <button
                            type="button"
                            onClick={() => actions.setPaidPondSlots(game.entitlements.paidPondSlots - 1)}
                            disabled={game.entitlements.paidPondSlots <= 0}
                            className="flex h-8 w-8 items-center justify-center text-slate-500 disabled:opacity-40"
                            aria-label="연못 확장권 하나 줄이기"
                        >
                            <Minus size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => actions.setPaidPondSlots(game.entitlements.paidPondSlots + 1)}
                            disabled={game.entitlements.paidPondSlots >= MAX_PAID_POND_SLOTS}
                            className="flex h-8 w-8 items-center justify-center text-slate-500 disabled:opacity-40"
                            aria-label="연못 확장권 하나 늘리기"
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500 break-keep">
                    수를 줄여도 이미 생긴 연못은 실제처럼 남아요(지금 유료 연못 {game.paidPondCount}개). 연못까지 지우려면 구매 내역을 초기화하세요.
                </p>
                <button type="button" onClick={resetPurchases} className={`${PANEL_BUTTON} mt-3 border border-rose-300 text-rose-700 enabled:hover:bg-rose-50`}>
                    구매 내역 초기화
                </button>
            </Section>

            <p className="px-4 py-3 text-xs leading-relaxed text-slate-500 break-keep">
                미리보기 모드에서는 로그인, 클라우드 저장, Cloud Functions, 통계가 모두 꺼져 있어요. 이 브라우저의 미리보기 저장 칸(monetization-mock)만 써요.
            </p>
        </div>
    );
};
