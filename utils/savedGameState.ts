import { SavedGameState, GrowthStage, PondData, Ponds, PondTheme } from '../types';
import {
    LEGACY_FREE_POND_COUNT,
    NEW_FREE_POND_COUNT,
    countPonds,
    freePondCountForAccount,
    isPaidPondId,
    isValidGameStateCore,
    paidPondId,
    paidPondNumber,
    savedFreePondCount,
    type FreePondCount,
} from '../functions/src/saveValidation';
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
 * 새 버전에서 처음 시작한 게임의 무료 연못 수(1개). 더 늘리려면 Google Play의 연못 확장권을 삽니다(유료 연못 pond-paid-N).
 * 이번 업데이트 전부터 있던 저장본(freePondCount 없음)은 기존 유저로 보고 무료 연못 2개를 그대로 줍니다(LEGACY_FREE_POND_COUNT).
 * 예전에 젠 포인트 확장권으로 산 일반 연못(pond-3, pond-4)은 그대로 남습니다.
 */
export const DEFAULT_POND_COUNT: FreePondCount = NEW_FREE_POND_COUNT;
export { LEGACY_FREE_POND_COUNT };

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
 * 일반 연못이 무료 연못 수(freePondCount)보다 적으면 비어 있는 번호로 빈 연못을 채워 넣습니다.
 * 기존 유저(무료 2개)의 연못이 1개뿐인 예전 저장본은 1.0.7~1.0.8처럼 연못 2를 받고, 신규 유저(무료 1개)는 받지 않습니다.
 * 이미 있는 연못(연못 2, 예전에 산 연못)은 지우거나 숨기지 않습니다.
 */
export const withDefaultPonds = (ponds: Ponds, freePondCount: FreePondCount = DEFAULT_POND_COUNT): Ponds => {
    const result = { ...ponds };
    for (let n = 1; regularPondCount(result) < freePondCount; n++) {
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

/**
 * 로그인한 계정의 무료 연못 수를 가입 시각에 맞춰 올립니다. 기준일 전에 가입한 계정(기존 유저)은 무료 2개입니다.
 * 예: 기존 계정에 처음 로그인하면서 새 버전에서 시작한 게스트 진행도(무료 1개)를 옮기는 경우.
 * 내리지는 않고, 가입 시각을 모르거나 바꿀 것이 없으면 받은 객체를 그대로 돌려줍니다(불필요한 저장을 막음).
 * 서버(saveGameState)도 같은 가입 시각과 기준일로 검사하므로 올린 연못은 저장이 거절되지 않습니다.
 */
export const withAccountFreePonds = (state: SavedGameState, accountCreatedAt: number | null): SavedGameState => {
    if (accountCreatedAt === null) return state;
    const normalized = normalizeSavedGameState(state);
    if (!normalized) return state;
    const accountFree = freePondCountForAccount(accountCreatedAt);
    if ((normalized.freePondCount ?? LEGACY_FREE_POND_COUNT) >= accountFree) return state;
    return { ...normalized, freePondCount: accountFree, ponds: withDefaultPonds(normalized.ponds, accountFree) };
};

/** Upgrades a valid legacy payload; the server still decides progression authority. */
export const normalizeSavedGameState = (value: unknown): SavedGameState | null => {
    if (!isValidSavedGameState(value)) return null;
    const state = value as SavedGameState;
    // 무료 연못 수가 적혀 있지 않은 저장본은 이번 업데이트 전의 저장(기존 유저)이므로 2개입니다.
    const freePondCount = savedFreePondCount(state) ?? LEGACY_FREE_POND_COUNT;
    return {
        ...state,
        freePondCount,
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
        }])), freePondCount),
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
