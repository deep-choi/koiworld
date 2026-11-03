import { SavedGameState, GrowthStage, PondData, Ponds, PondTheme } from '../types';
import { DEFAULT_FREE_POND_COUNT, countPonds, isPaidPondId, isValidGameStateCore, paidPondId, paidPondNumber } from '../functions/src/saveValidation';
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

/**
 * 새 게임은 연못 1개로 시작합니다. 더 늘리려면 Google Play의 연못 확장권을 삽니다(유료 연못 pond-paid-N).
 * 1.0.7~1.0.8에서 받은 연못 2와 예전에 젠 포인트 확장권으로 산 일반 연못(pond-3, pond-4)은 그대로 남습니다.
 */
export const DEFAULT_POND_COUNT = DEFAULT_FREE_POND_COUNT;

/** n번째 빈 일반 연못 (id: pond-n, 이름: 연못 n) */
export const createEmptyPond = (n: number): PondData => ({
    id: `pond-${n}`,
    name: `연못 ${n}`,
    kois: [],
    decorations: [],
    theme: PondTheme.DEFAULT,
    waterQuality: 100,
});

const POND_NUMBER_IN_NAME = /^연못\s*(\d+)$/;
const POND_NUMBER_IN_ID = /^pond-(\d+)$/;

/**
 * 새 연못에 붙일 화면 번호. 지금 가진 연못 다음 번호라 "연못 1, 연못 2, 연못 3 …"처럼 이어집니다.
 * 연못 수, 일반 연못 id 번호, "연못 N" 이름 중 가장 큰 번호의 다음 값이라 이름이 겹치지 않습니다.
 */
export const nextPondDisplayNumber = (ponds: Ponds): number => {
    let highest = Object.keys(ponds).length;
    for (const [id, pond] of Object.entries(ponds)) {
        const fromId = POND_NUMBER_IN_ID.exec(id);
        const fromName = typeof pond?.name === 'string' ? POND_NUMBER_IN_NAME.exec(pond.name.trim()) : null;
        for (const match of [fromId, fromName]) {
            if (match) highest = Math.max(highest, Number(match[1]));
        }
    }
    return highest + 1;
};

/**
 * Google Play 연못 확장권 slot번에 해당하는 빈 연못.
 * id는 pond-paid-slot으로 일반 연못과 구분하고, 화면 이름은 일반 연못 번호에 이어 "연못 N"으로 붙입니다.
 */
export const createPaidPond = (slot: number, displayNumber: number): PondData => ({
    ...createEmptyPond(displayNumber),
    id: paidPondId(slot),
});

const regularPondCount = (ponds: Ponds) => countPonds(Object.keys(ponds)).regular;

/**
 * 일반 연못이 DEFAULT_POND_COUNT개(1개)보다 적으면 비어 있는 번호로 빈 연못을 채워 넣습니다.
 * 일반 연못이 하나도 없는 이상한 저장본만 연못 1을 받습니다. 연못이 1개인 저장본에 연못 2를 더 채우지 않고,
 * 이미 있는 연못(연못 2, 예전에 산 연못)은 지우거나 숨기지 않습니다.
 */
export const withDefaultPonds = (ponds: Ponds): Ponds => {
    const result = { ...ponds };
    for (let n = 1; regularPondCount(result) < DEFAULT_POND_COUNT; n++) {
        if (!result[`pond-${n}`]) result[`pond-${n}`] = createEmptyPond(n);
    }
    return result;
};

/**
 * 산 연못 확장권 수만큼 유료 연못(pond-paid-1 …)이 있도록 채웁니다. 이미 있는 연못은 이름까지 그대로 둡니다.
 * 결제 직후, 재설치 후 복원, 새 게임 시작, 웹 로그인 때 모두 같은 방식으로 빠진 연못을 채웁니다.
 * 바뀐 것이 없으면 같은 객체를 돌려줘 불필요한 렌더링과 저장을 막습니다.
 */
export const withPaidPonds = (ponds: Ponds, paidPondSlots: number): Ponds => {
    let result = ponds;
    for (let slot = 1; slot <= paidPondSlots; slot++) {
        const id = paidPondId(slot);
        if (result[id]) continue;
        if (result === ponds) result = { ...ponds };
        result[id] = createPaidPond(slot, nextPondDisplayNumber(result));
    }
    return result;
};

/** 유료 연못 중 아직 만들어지지 않은 칸이 있는지 */
export const hasMissingPaidPonds = (ponds: Ponds, paidPondSlots: number): boolean =>
    withPaidPonds(ponds, paidPondSlots) !== ponds;

/**
 * 새 게임용 연못. 코이·장식·테마·수질은 처음으로 돌리지만, 가진 연못 칸(예전에 젠 포인트로 산 일반 연못,
 * Google Play로 산 연못)은 이름 그대로 빈 연못으로 남깁니다. 새 게임 때문에 산 연못이 사라지지 않게 합니다.
 */
export const pondsForNewGame = (current: Ponds, fresh: Ponds): Ponds => {
    const result: Ponds = { ...fresh };
    for (const [id, pond] of Object.entries(current)) {
        if (result[id]) continue;
        result[id] = { ...createEmptyPond(1), id, name: pond.name };
    }
    return result;
};

export { isPaidPondId, paidPondNumber };

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
