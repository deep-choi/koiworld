import React from 'react';
import { Info, Star } from 'lucide-react';

// 로컬 미리보기(npm run dev:mock) 전용. AdMob 테스트 배너처럼 보이는 320×50 광고입니다.
// 실제 앱에서는 AdMob 배너(BannerAdSize.BANNER, 화면 맨 아래 가운데)가 이 자리에 붙습니다.
// 광고 내용은 가상의 앱("Sample App")이며 실제 회사나 브랜드를 흉내 내지 않습니다.

/** 배너 안의 앱 아이콘: CSS만으로 그린 가상의 아이콘 */
export const SampleAppIcon: React.FC<{ size: number; className?: string }> = ({ size, className = '' }) => (
    <span
        className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}
        style={{
            width: size,
            height: size,
            borderRadius: size * 0.24,
            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 55%, #ec4899 100%)',
        }}
        aria-hidden="true"
    >
        <span className="absolute rounded-full bg-white/25" style={{ width: size * 0.9, height: size * 0.9, left: -size * 0.3, top: -size * 0.35 }} />
        <span className="relative grid grid-cols-2 gap-[8%]" style={{ width: size * 0.5, height: size * 0.5 }}>
            <span className="rounded-[25%] bg-white" />
            <span className="rounded-full bg-amber-300" />
            <span className="rounded-full bg-sky-300" />
            <span className="rounded-[25%] bg-white/80" />
        </span>
    </span>
);

/** AdMob 테스트 광고의 "Test Ad" 표시 */
export const TestAdLabel: React.FC<{ className?: string }> = ({ className = '' }) => (
    <span className={`inline-flex items-center rounded-sm border border-neutral-400 bg-white px-1 text-[9px] font-medium leading-[13px] text-neutral-700 ${className}`}>
        Test Ad
    </span>
);

/** 화면 맨 아래에 붙는 320×50 테스트 배너. 높이는 실제 배너와 같은 50px입니다. */
export const MockTestBanner: React.FC = () => (
    <div
        // 실제 AdMob 배너는 앱 화면 위에 붙는 별도 보기라 게임의 창보다 위에 그립니다. 양옆은 앱 배경이 보입니다.
        className="fixed inset-x-0 bottom-0 z-[1300] flex justify-center"
        style={{ height: 'var(--ad-banner-height, 50px)' }}
    >
        <div
            className="relative flex h-[50px] w-[320px] items-center gap-2 overflow-hidden bg-white px-2 text-left text-neutral-900 shadow-[0_-1px_0_rgba(0,0,0,0.08)]"
            role="complementary"
            aria-label="광고"
        >
            <TestAdLabel className="absolute left-0 top-0 rounded-none rounded-br-sm border-l-0 border-t-0" />
            <span className="absolute right-0 top-0 flex h-[14px] w-[14px] items-center justify-center bg-white/90 text-sky-600" aria-hidden="true">
                <Info size={10} strokeWidth={2.5} />
            </span>
            <SampleAppIcon size={34} className="ml-1 mt-1" />
            <div className="min-w-0 flex-1 pt-1">
                <p className="truncate text-[13px] font-semibold leading-4">Sample App: 오늘의 퍼즐</p>
                <p className="mt-0.5 flex items-center gap-1 text-[10px] leading-3 text-neutral-500">
                    <span className="inline-flex items-center gap-0.5 text-neutral-600">
                        4.5 <Star size={9} className="fill-amber-400 text-amber-400" aria-hidden="true" />
                    </span>
                    <span>· 무료</span>
                </p>
            </div>
            <span className="mt-1 flex h-7 shrink-0 items-center rounded-full bg-sky-600 px-3 text-[12px] font-semibold text-white">
                설치
            </span>
        </div>
    </div>
);
