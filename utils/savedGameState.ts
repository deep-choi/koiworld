import { SavedGameState, GrowthStage } from '../types';
import { isValidGameStateCore } from '../functions/src/saveValidation';

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

/** Upgrades a valid legacy payload; the server still decides progression authority. */
export const normalizeSavedGameState = (value: unknown): SavedGameState | null => {
    if (!isValidSavedGameState(value)) return null;
    const state = value as SavedGameState;
    return {
        ...state,
        ponds: Object.fromEntries(Object.entries(state.ponds).map(([id, pond]) => [id, {
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
                genetics: { ...koi.genetics, lightness: koi.genetics.lightness ?? 50, saturation: koi.genetics.saturation ?? 50 },
            })),
        }])),
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
