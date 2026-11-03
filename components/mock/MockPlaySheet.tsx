import React from 'react';
import { Check, ChevronRight, CreditCard } from 'lucide-react';
import type { PlayProductId } from '../../config/monetization';
import {
    MOCK_PRODUCT_NAMES,
    MOCK_SAMPLE_PRICES,
    MOCK_TEST_INSTRUMENTS,
    cancelMockPurchase,
    confirmMockPurchase,
    type MockPurchaseOutcome,
    type MockPurchasePhase,
} from '../../services/mockMonetization';

/**
 * Google Play가 보여 주는 것과 같은 Android 앱 아이콘. 개발 서버가 저장소 파일을 그대로 내주는 주소입니다.
 * import로 불러오면 Vite가 배포 빌드(dist)에도 그림 파일을 복사하므로 문자열 주소만 씁니다.
 */
const APP_ICON_URL = '/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png';

// 로컬 미리보기(npm run dev:mock) 전용. Google Play 결제 창처럼 아래에서 올라오는 시트입니다.
// 시트 안은 Google Play 화면 모양(흰 바탕, 초록 구매 버튼)을 따르고, 앱의 브랜드 색을 쓰지 않습니다.
// 승인·결제 대기·취소 중 무엇으로 끝날지는 휴대폰 화면 바깥의 미리보기 패널에서 고릅니다.

/** Google Play 결제 화면의 초록색 */
const PLAY_GREEN = '#01875f';

const ANIMATIONS = `
@keyframes koi-mock-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes koi-mock-scrim { from { opacity: 0; } to { opacity: 1; } }
@keyframes koi-mock-check { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
`;

type Props = { productId: PlayProductId; phase: MockPurchasePhase; outcome: MockPurchaseOutcome };

export const MockPlaySheet: React.FC<Props> = ({ productId, phase, outcome }) => {
    const choosing = phase === 'choose';
    const instrument = outcome === 'pending' ? MOCK_TEST_INSTRUMENTS.pending : MOCK_TEST_INSTRUMENTS.approve;
    return (
        <div className="fixed inset-0 z-[1500] flex flex-col justify-end">
            <style>{ANIMATIONS}</style>
            {/* 시트 바깥을 누르면 Google Play처럼 결제를 취소합니다. */}
            <button
                type="button"
                className="absolute inset-0 h-full w-full cursor-default bg-black/45"
                style={{ animation: 'koi-mock-scrim 180ms ease-out both' }}
                onClick={cancelMockPurchase}
                aria-label="결제 취소"
                tabIndex={-1}
            />
            <div
                className="relative w-full rounded-t-[28px] bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] text-[#202124] shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
                style={{ animation: 'koi-mock-sheet-up 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both', fontFamily: 'Roboto, "Noto Sans KR", system-ui, sans-serif' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="mock-play-product"
            >
                <div className="flex justify-center pt-2.5" aria-hidden="true">
                    <span className="h-1 w-8 rounded-full bg-[#dadce0]" />
                </div>
                <p className="px-6 pt-3 text-[14px] font-medium text-[#5f6368]">Google Play</p>

                <div className="flex items-center gap-3 px-6 pb-4 pt-3">
                    <img src={APP_ICON_URL} alt="" className="h-10 w-10 shrink-0 rounded-[10px] bg-neutral-100 object-cover" />
                    <div className="min-w-0 flex-1">
                        <p id="mock-play-product" className="truncate text-[16px] font-medium leading-5">{MOCK_PRODUCT_NAMES[productId]}</p>
                        <p className="truncate text-[13px] leading-5 text-[#5f6368]">Koiworld</p>
                    </div>
                    <p className="shrink-0 text-[16px] font-medium">{MOCK_SAMPLE_PRICES[productId]}</p>
                </div>

                {phase === 'done' ? (
                    <div className="flex flex-col items-center gap-3 border-t border-[#e8eaed] px-6 pb-4 pt-8" role="status">
                        <span
                            className="flex h-14 w-14 items-center justify-center rounded-full text-white"
                            style={{ backgroundColor: PLAY_GREEN, animation: 'koi-mock-check 420ms ease-out both' }}
                            aria-hidden="true"
                        >
                            <Check size={30} strokeWidth={3} />
                        </span>
                        <p className="text-[16px] font-medium">결제 완료</p>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-4 border-t border-[#e8eaed] px-6 py-4">
                            <CreditCard size={22} className="shrink-0 text-[#5f6368]" aria-hidden="true" />
                            <p className="min-w-0 flex-1 text-[14px] leading-5">{instrument}</p>
                            <ChevronRight size={20} className="shrink-0 text-[#5f6368]" aria-hidden="true" />
                        </div>
                        <p className="px-6 text-[12px] leading-[18px] text-[#5f6368]">테스트 주문입니다. 요금이 청구되지 않습니다.</p>
                        <div className="px-6 pt-4">
                            {choosing ? (
                                <button
                                    type="button"
                                    onClick={confirmMockPurchase}
                                    className="flex h-12 w-full items-center justify-center rounded-full text-[15px] font-medium text-white transition-[filter] hover:brightness-110"
                                    style={{ backgroundColor: PLAY_GREEN }}
                                >
                                    구매
                                </button>
                            ) : (
                                <div className="flex h-12 w-full items-center justify-center" role="status" aria-label="결제 처리 중">
                                    <span
                                        className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#e8eaed]"
                                        style={{ borderTopColor: PLAY_GREEN }}
                                        aria-hidden="true"
                                    />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
