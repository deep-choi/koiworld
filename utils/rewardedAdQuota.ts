// 보상형 광고 하루 횟수 계산. 저장소(localStorage)와 분리된 순수 함수라 테스트에서 그대로 씁니다.
// 날짜는 기기 현지 시간 기준으로 자정에 초기화됩니다.

export type RewardedAdLog = { day: string; count: number };

export const localDayKey = (now: number): string => {
    const date = new Date(now);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

/** 저장된 값이 깨졌거나 다른 날짜면 오늘 0회로 봅니다. */
export const readRewardedAdLog = (raw: unknown, now: number): RewardedAdLog => {
    const today = localDayKey(now);
    if (!raw || typeof raw !== 'object') return { day: today, count: 0 };
    const value = raw as Partial<RewardedAdLog>;
    if (value.day !== today || typeof value.count !== 'number' || !Number.isFinite(value.count)) {
        return { day: today, count: 0 };
    }
    return { day: today, count: Math.max(0, Math.floor(value.count)) };
};

export const remainingRewardedAds = (log: RewardedAdLog, dailyLimit: number, now: number): number =>
    Math.max(0, dailyLimit - readRewardedAdLog(log, now).count);

export const recordRewardedAd = (log: RewardedAdLog, now: number): RewardedAdLog => {
    const current = readRewardedAdLog(log, now);
    return { day: current.day, count: current.count + 1 };
};
