import React, { useEffect, useRef, useState } from 'react';
import { SkipForward, Star, X } from 'lucide-react';
import { closeMockVideoAd } from '../../services/mockMonetization';
import { SampleAppIcon, TestAdLabel } from './MockTestBanner';

// 로컬 미리보기(npm run dev:mock) 전용. AdMob 전면 동영상 광고처럼 보이는 전체 화면 광고입니다.
// 동영상 파일이나 실제 광고 소재를 불러오지 않고 캔버스 애니메이션으로 "재생"합니다.
// 광고 내용은 가상의 퍼즐 앱("Sample App")이며 실제 회사나 브랜드를 흉내 내지 않습니다.

/** 동영상 길이와 건너뛰기까지의 시간. 실제 AdMob 전면 동영상 광고와 비슷하게 맞췄습니다. */
export const MOCK_VIDEO_LENGTH_SECONDS = 15;
export const MOCK_VIDEO_SKIP_AFTER_SECONDS = 5;

/** 장면마다 바뀌는 자막 */
const SCENES = [
    { until: 5, title: 'Sample App', subtitle: '오늘의 퍼즐이 도착했어요' },
    { until: 10, title: '블록을 맞춰 보세요', subtitle: '한 줄을 채우면 반짝!' },
    { until: Infinity, title: '지금 무료로 플레이', subtitle: '매일 새로운 스테이지' },
];

const BLOCK_COLORS = ['#fbbf24', '#38bdf8', '#f472b6', '#a3e635', '#ffffff'];
/** 떨어지는 블록: 매번 같은 모양이 나오도록 고정된 값으로 만듭니다. */
const FALLING_BLOCKS = Array.from({ length: 16 }, (_, i) => ({
    x: ((i * 37) % 100) / 100,
    size: 14 + ((i * 13) % 22),
    speed: 40 + ((i * 29) % 70),
    offset: (i * 97) % 600,
    spin: ((i % 2 === 0 ? 1 : -1) * (0.4 + (i % 5) * 0.15)),
    color: BLOCK_COLORS[i % BLOCK_COLORS.length],
}));

const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
};

/** t초 장면을 그립니다. */
const drawFrame = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => {
    // 배경: 천천히 색이 도는 그라데이션
    const hue = 255 + Math.sin(t * 0.45) * 28;
    const bg = ctx.createLinearGradient(0, 0, w * 0.3, h);
    bg.addColorStop(0, `hsl(${hue}, 70%, 20%)`);
    bg.addColorStop(1, `hsl(${hue + 45}, 75%, 40%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 빛 번짐
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,0.18)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // 떨어지는 블록
    for (const block of FALLING_BLOCKS) {
        const travel = h + block.size * 4;
        const y = ((t * block.speed + block.offset) % travel) - block.size * 2;
        const x = block.x * w + Math.sin(t * 0.8 + block.offset) * 12;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * block.spin);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = block.color;
        roundedRect(ctx, -block.size / 2, -block.size / 2, block.size, block.size, block.size * 0.22);
        ctx.fill();
        ctx.restore();
    }

    // 가운데 퍼즐 판: 칸이 차례로 채워지고, 한 줄이 다 차면 반짝입니다.
    const board = Math.min(w * 0.62, h * 0.34);
    const cells = 4;
    const gap = board * 0.04;
    const cell = (board - gap * (cells + 1)) / cells;
    const bounce = 1 + Math.sin(t * 3.2) * 0.015;
    const bx = w / 2;
    const by = h * 0.42;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(bounce, bounce);
    ctx.rotate(Math.sin(t * 0.6) * 0.04);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    roundedRect(ctx, -board / 2, -board / 2, board, board, board * 0.08);
    ctx.fill();
    const filled = Math.floor((t * 2.4) % (cells * cells + 4));
    for (let row = 0; row < cells; row++) {
        const rowDone = filled >= (row + 1) * cells;
        for (let col = 0; col < cells; col++) {
            const index = row * cells + col;
            const x = -board / 2 + gap + col * (cell + gap);
            const y = -board / 2 + gap + row * (cell + gap);
            const on = index < filled;
            ctx.fillStyle = on ? BLOCK_COLORS[(index + row) % 4] : 'rgba(255,255,255,0.08)';
            if (on && rowDone) {
                ctx.shadowColor = 'rgba(255,255,255,0.9)';
                ctx.shadowBlur = 18 + Math.sin(t * 12) * 6;
            }
            roundedRect(ctx, x, y, cell, cell, cell * 0.2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
    ctx.restore();

    // 반짝이
    for (let i = 0; i < 24; i++) {
        const twinkle = (Math.sin(t * 2.5 + i * 1.7) + 1) / 2;
        ctx.globalAlpha = twinkle * 0.8;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(((i * 53) % 100) / 100 * w, ((i * 71) % 100) / 100 * h, 1 + twinkle * 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
};

/** 0:12처럼 남은 시간 */
const clock = (seconds: number) => `0:${String(Math.max(0, Math.ceil(seconds))).padStart(2, '0')}`;

const ANIMATIONS = `
@keyframes koi-mock-caption { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes koi-mock-pop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: none; } }
`;

/** 전면 동영상 광고. 5초 뒤 건너뛰기, 15초가 끝나면 마지막 화면과 닫기 버튼이 나옵니다. */
export const MockVideoAd: React.FC<{ startedAt: number }> = ({ startedAt }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [elapsed, setElapsed] = useState(0);

    // 캔버스 "동영상" 재생과 남은 시간 갱신
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        let frame = 0;
        let lastSecondTick = -1;
        const render = () => {
            const t = Math.min(MOCK_VIDEO_LENGTH_SECONDS, (Date.now() - startedAt) / 1000);
            const ratio = window.devicePixelRatio || 1;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
                canvas.width = Math.round(width * ratio);
                canvas.height = Math.round(height * ratio);
            }
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            drawFrame(ctx, t, width, height);
            // 화면 글자는 0.25초마다만 바꿔 React 렌더링을 줄입니다.
            const tick = Math.floor(t * 4);
            if (tick !== lastSecondTick) {
                lastSecondTick = tick;
                setElapsed(t);
            }
            if (t < MOCK_VIDEO_LENGTH_SECONDS) frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);
        return () => cancelAnimationFrame(frame);
    }, [startedAt]);

    const remaining = MOCK_VIDEO_LENGTH_SECONDS - elapsed;
    const canSkip = elapsed >= MOCK_VIDEO_SKIP_AFTER_SECONDS;
    const finished = elapsed >= MOCK_VIDEO_LENGTH_SECONDS;
    const progress = Math.min(100, (elapsed / MOCK_VIDEO_LENGTH_SECONDS) * 100);
    const sceneIndex = SCENES.findIndex(scene => elapsed < scene.until);
    const scene = SCENES[sceneIndex];
    const skipIn = Math.ceil(MOCK_VIDEO_SKIP_AFTER_SECONDS - elapsed);

    return (
        <div
            // 실제 AdMob 광고는 앱 화면 위에 뜨는 별도 화면이라 게임의 어떤 창보다도 위에 그립니다.
            className="fixed inset-0 z-[10000] select-none overflow-hidden bg-black text-white"
            role="dialog"
            aria-modal="true"
            aria-label="광고"
        >
            <style>{ANIMATIONS}</style>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

            {/* 자막 */}
            {!finished && (
                <div className="pointer-events-none absolute inset-x-0 top-[62%] px-6 text-center">
                    <div key={sceneIndex} style={{ animation: 'koi-mock-caption 500ms ease-out both' }}>
                        <p className="text-[28px] font-extrabold leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">{scene.title}</p>
                        <p className="mt-1 text-[15px] font-medium text-white/85 drop-shadow">{scene.subtitle}</p>
                    </div>
                </div>
            )}

            {/* 위쪽: Test Ad 표시·남은 시간 / 건너뛰기·닫기. 마지막 화면이 덮여도 닫기 버튼은 맨 위에 둡니다. */}
            <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
                <div className="flex items-center gap-2 rounded-full bg-black/45 py-1 pl-1.5 pr-2.5 text-[12px] font-medium">
                    <TestAdLabel />
                    {!finished && <span className="tabular-nums">광고 · {clock(remaining)}</span>}
                </div>
                {finished ? (
                    <button
                        type="button"
                        onClick={closeMockVideoAd}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                        aria-label="광고 닫기"
                    >
                        <X size={20} />
                    </button>
                ) : canSkip ? (
                    <button
                        type="button"
                        onClick={closeMockVideoAd}
                        className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 pl-3.5 pr-3 text-[13px] font-semibold text-white hover:bg-black/80"
                        style={{ animation: 'koi-mock-pop 200ms ease-out both' }}
                    >
                        광고 건너뛰기
                        <SkipForward size={15} aria-hidden="true" />
                    </button>
                ) : (
                    <span
                        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/70 bg-black/45 text-[13px] font-semibold tabular-nums"
                        aria-label={`${skipIn}초 뒤 건너뛸 수 있어요`}
                    >
                        {skipIn}
                    </span>
                )}
            </div>

            {/* 아래쪽: 앱 정보와 설치 버튼, 재생 막대 */}
            {!finished && (
                <div className="absolute inset-x-0 bottom-0">
                    <div className="mx-3 mb-3 flex items-center gap-3 rounded-2xl bg-black/45 p-2.5 backdrop-blur-sm">
                        <SampleAppIcon size={40} />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-semibold">Sample App</p>
                            <p className="flex items-center gap-1 text-[11px] text-white/75">
                                4.5 <Star size={10} className="fill-amber-300 text-amber-300" aria-hidden="true" /> · 무료 · 퍼즐
                            </p>
                        </div>
                        <span className="flex h-9 shrink-0 items-center rounded-full bg-sky-500 px-4 text-[13px] font-semibold text-white">설치</span>
                    </div>
                    <div className="h-1 w-full bg-white/25" aria-hidden="true">
                        <div className="h-full bg-amber-300" style={{ width: `${progress}%` }} />
                    </div>
                </div>
            )}

            {/* 동영상이 끝나면 나오는 마지막 화면 */}
            {finished && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-6" style={{ animation: 'koi-mock-pop 250ms ease-out both' }}>
                    <div className="flex w-full max-w-[18rem] flex-col items-center rounded-3xl bg-white px-6 pb-6 pt-7 text-center text-neutral-900 shadow-2xl">
                        <SampleAppIcon size={72} />
                        <p className="mt-4 text-[20px] font-bold">Sample App</p>
                        <p className="mt-1 text-[13px] text-neutral-500">매일 새로운 퍼즐 스테이지</p>
                        <p className="mt-2 flex items-center gap-0.5 text-[13px] text-neutral-600" aria-label="별점 4.5">
                            {[0, 1, 2, 3].map(i => <Star key={i} size={14} className="fill-amber-400 text-amber-400" aria-hidden="true" />)}
                            <Star size={14} className="text-amber-400" aria-hidden="true" />
                            <span className="ml-1">4.5</span>
                        </p>
                        <span className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-sky-600 text-[15px] font-semibold text-white">설치</span>
                    </div>
                </div>
            )}
        </div>
    );
};
