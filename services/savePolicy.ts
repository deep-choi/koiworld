import type { SavedGameState } from '../types';

// 수질·이동처럼 계속 변하는 값은 정기 저장에 포함하고, 사용자의 진행 변화는
// 별도로 감지합니다. 먹이 연속 사용도 첫 변화 이후 2초 안에 전송 대상이 됩니다.
export function progressKey(state: SavedGameState): string {
    return JSON.stringify({
        zenPoints: state.zenPoints, foodCount: state.foodCount, cornCount: state.cornCount,
        honorPoints: state.honorPoints, achievementPoints: state.achievementPoints,
        achievements: state.achievements, koiNameCounter: state.koiNameCounter,
        activePondId: state.activePondId,
        ponds: Object.values(state.ponds).map(pond => ({
            id: pond.id, name: pond.name, theme: pond.theme, decorations: pond.decorations,
            kois: pond.kois.map(koi => ({
                id: koi.id, name: koi.name, genetics: koi.genetics,
                growthStage: koi.growthStage, timesFed: koi.timesFed,
            })),
        })),
    });
}

export class SavePolicy {
    private confirmedKey: string | null = null;
    private importantSince: number | null = null;
    private lastSuccess = 0;
    private retryAt = 0;
    private failures = 0;

    observe(state: SavedGameState, now: number): void {
        if (progressKey(state) !== this.confirmedKey && this.importantSince === null) this.importantSince = now;
    }

    due(now: number): boolean {
        return now >= this.retryAt && (
            (this.importantSince !== null && now - this.importantSince >= 2000)
            || now - this.lastSuccess >= 60000
        );
    }

    confirmed(state: SavedGameState, now: number): void {
        this.confirmedKey = progressKey(state);
        this.importantSince = null;
        this.lastSuccess = now;
        this.retryAt = 0;
        this.failures = 0;
    }

    failed(now: number): void {
        this.failures += 1;
        this.retryAt = now + Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4));
    }
}
