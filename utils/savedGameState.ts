import { SavedGameState, GrowthStage, PondData, Ponds, PondTheme } from '../types';
import { isValidGameStateCore } from '../functions/src/saveValidation';
import { migrateLegacyGinrin } from './genetics';

export const CURRENT_GAME_STATE_SCHEMA_VERSION = 3;

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const stringIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((id): id is string => typeof id === 'string')));
};

export const isValidSavedGameState = (value: unknown): value is SavedGameState => {
    return isValidGameStateCore(value);
};

export const isCompleteSavedGameState = (value: unknown): value is SavedGameState => {
    if (!isValidSavedGameState(value)) return false;
    const state = value as SavedGameState;
    return state.schemaVersion === CURRENT_GAME_STATE_SCHEMA_VERSION
        && isFiniteNumber(state.cornCount)
        && isFiniteNumber(state.honorPoints)
        && isFiniteNumber(state.achievementPoints)
        && Array.isArray(state.achievements?.unlockedIds)
        && Array.isArray(state.achievements?.claimedIds);
};

/** 연못은 기본으로 2개를 제공합니다. 상점의 연못 확장권으로 최대 4개까지 늘릴 수 있습니다. */
export const DEFAULT_POND_COUNT = 2;

/** n번째 빈 연못 (id: pond-n, 이름: 연못 n) */
export const createEmptyPond = (n: number): PondData => ({
    id: `pond-${n}`,
    name: `연못 ${n}`,
    kois: [],
    decorations: [],
    theme: PondTheme.DEFAULT,
    waterQuality: 100,
});

/**
 * 연못이 DEFAULT_POND_COUNT개보다 적으면 비어 있는 번호로 빈 연못을 채워 넣습니다.
 * 연못이 1개였던 예전 저장본도 불러오면 연못 2를 기본으로 받게 됩니다.
 */
export const withDefaultPonds = (ponds: Ponds): Ponds => {
    const result = { ...ponds };
    for (let n = 1; Object.keys(result).length < DEFAULT_POND_COUNT; n++) {
        if (!result[`pond-${n}`]) result[`pond-${n}`] = createEmptyPond(n);
    }
    return result;
};

/** Upgrades a valid legacy payload; the server still decides progression authority. */
export const normalizeSavedGameState = (value: unknown): SavedGameState | null => {
    if (!isValidSavedGameState(value)) return null;
    const state = value as SavedGameState;
    return {
        ...state,
        ponds: withDefaultPonds(Object.fromEntries(Object.entries(state.ponds).map(([id, pond]) => [id, {
            ...pond,
            decorations: pond.decorations ?? [],
            waterQuality: pond.waterQuality ?? 100,
            kois: pond.kois.map(koi => ({
                ...koi,
                name: koi.name ?? '코이', description: koi.description ?? '',
                position: koi.position ?? { x: 50, y: 50 },
                velocity: koi.velocity ?? { vx: 0, vy: 0 },
                age: koi.age ?? 0, growthStage: koi.growthStage ?? GrowthStage.FRY, timesFed: koi.timesFed ?? 0,
                stamina: koi.stamina ?? 100, foodTargetId: koi.foodTargetId ?? null, feedCooldownUntil: koi.feedCooldownUntil ?? null,
                // 1.0.6의 긴린 수치는 여기서 유전자 개수로 옮겨집니다.
                genetics: migrateLegacyGinrin({ ...koi.genetics, lightness: koi.genetics.lightness ?? 50, saturation: koi.genetics.saturation ?? 50 }),
            })),
        }]))),
        schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
        cornCount: isFiniteNumber(state.cornCount) ? Math.max(0, Math.floor(state.cornCount)) : 0,
        honorPoints: isFiniteNumber(state.honorPoints) ? Math.max(0, Math.floor(state.honorPoints)) : 0,
        achievementPoints: isFiniteNumber(state.achievementPoints)
            ? Math.max(0, Math.floor(state.achievementPoints))
            : 0,
        achievements: {
            unlockedIds: stringIds(state.achievements?.unlockedIds),
            claimedIds: stringIds(state.achievements?.claimedIds),
        },
    };
};
