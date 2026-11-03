// 동영상 광고(전면 광고)를 언제 띄울지 정하는 순수 함수. 화면·광고 SDK와 분리되어 테스트에서 그대로 씁니다.
// 실제 광고(Android)와 로컬 미리보기(npm run dev:mock)가 같은 규칙을 씁니다.
import { VIDEO_AD_LIMITS, VIDEO_AD_TRIGGERS, type VideoAdTrigger } from '../config/monetization';

export type VideoAdLimits = Pick<typeof VIDEO_AD_LIMITS, 'launchGraceMs' | 'minIntervalMs' | 'breakMaxWaitMs'>;

/** 앱을 켠 시각과 마지막 동영상 광고가 끝난 시각 */
export type VideoAdClock = { launchedAt: number; lastShownAt: number | null };

/** 아직 띄우지 않은 쉬는 지점 요청 */
export type VideoAdBreak = { trigger: VideoAdTrigger; requestedAt: number };

export type VideoAdRequestBlocker =
    | 'ads-off'       // 웹, 광고 제거 계정, 혜택을 아직 못 읽음
    | 'trigger-off'   // 설정에서 끈 쉬는 지점
    | 'showing'       // 이미 광고가 떠 있음
    | 'launch-grace'  // 앱을 켠 지 얼마 안 됨
    | 'interval';     // 직전 광고와 너무 가까움

/** 다음 동영상 광고를 띄울 수 있는 가장 이른 시각 */
export const nextVideoAdAt = (clock: VideoAdClock, limits: VideoAdLimits = VIDEO_AD_LIMITS): number => Math.max(
    clock.launchedAt + limits.launchGraceMs,
    clock.lastShownAt === null ? Number.NEGATIVE_INFINITY : clock.lastShownAt + limits.minIntervalMs,
);

/** 쉬는 지점 요청을 받아도 되는지. 안 되면 이유를 돌려줍니다. */
export const videoAdRequestBlocker = (input: {
    enabled: boolean;
    trigger: VideoAdTrigger;
    showing: boolean;
    clock: VideoAdClock;
    now: number;
    limits?: VideoAdLimits;
}): VideoAdRequestBlocker | null => {
    const limits = input.limits ?? VIDEO_AD_LIMITS;
    if (!input.enabled) return 'ads-off';
    if (!VIDEO_AD_TRIGGERS[input.trigger]?.enabled) return 'trigger-off';
    if (input.showing) return 'showing';
    if (input.now < input.clock.launchedAt + limits.launchGraceMs) return 'launch-grace';
    if (input.now < nextVideoAdAt(input.clock, limits)) return 'interval';
    return null;
};

/** 열린 창이 닫히길 너무 오래 기다린 요청은 버립니다. 한참 뒤에 갑자기 광고가 뜨지 않게 합니다. */
export const isBreakStillWanted = (pending: VideoAdBreak, now: number, limits: VideoAdLimits = VIDEO_AD_LIMITS): boolean =>
    now - pending.requestedAt <= limits.breakMaxWaitMs;

/** 미리보기 패널과 테스트에서 쓰는 "다음 광고까지 남은 시간" 표시(예: 2:05) */
export const formatWait = (ms: number): string => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
