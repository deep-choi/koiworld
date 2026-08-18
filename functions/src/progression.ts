export const PROGRESSION_PROTOCOL_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

export type CanonicalProgression = {
    honorPoints: number;
    achievementPoints: number;
    legacyAchievementPointsBase: number;
    claimedAchievementIds: string[];
    unlockedAchievementIds: string[];
};

export type ProgressionSources = {
    userData?: unknown;
    rankingStateData?: unknown;
    publicRankingData?: unknown;
    currentGameState?: unknown;
    incomingGameState?: unknown;
    backupGameStates?: unknown[];
    historicalAchievementIds?: unknown[];
    allowIncomingProgression?: boolean;
};

export const asRecord = (value: unknown): UnknownRecord =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : {};

export const finiteInteger = (value: unknown, fallback = 0): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
};

export const uniqueStrings = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === 'string')));
};

export const achievementReward = (achievementId: string): { points: number } | null => {
    const spotCountRewards: Record<number, { points: number }> = {
        4: { points: 100 },
        8: { points: 200 },
        12: { points: 300 },
        16: { points: 400 },
        20: { points: 500 },
    };
    const spotCountMatch = /^spot_count_(4|8|12|16|20)$/.exec(achievementId);
    if (spotCountMatch) return spotCountRewards[Number(spotCountMatch[1])];
    if (/^spot_color_(주황|노랑|하양|검정)$/.test(achievementId)) return { points: 100 };
    if (achievementId === 'special_five_color') return { points: 200 };
    if (/^color_(빨강|주황|노랑|크림|검정)_basic$/.test(achievementId)) return { points: 200 };
    if (/^(saturation_100|saturation_0|lightness_100|lightness_0)$/.test(achievementId)) {
        return { points: 300 };
    }
    if (/^master_(빨강|주황|노랑|크림|검정)_(void|brilliant|abyssal_flame|pure)$/.test(achievementId)) {
        return { points: 400 };
    }
    if (/^legend_spot_(주황|노랑|하양|검정)$/.test(achievementId)) return { points: 500 };
    return null;
};

export const migrateAchievementId = (achievementId: string): string | null => {
    if (achievementReward(achievementId)) return achievementId;

    // Older clients created one extreme-value achievement for every base
    // color. The current catalog has one global achievement for each value.
    const legacyColorVariant = /^color_(빨강|주황|노랑|크림|검정)_(sat_high|sat_low|light_high|light_low)$/.exec(achievementId);
    if (legacyColorVariant) {
        const variant = legacyColorVariant[2];
        if (variant === 'sat_high') return 'saturation_100';
        if (variant === 'sat_low') return 'saturation_0';
        if (variant === 'light_high') return 'lightness_100';
        if (variant === 'light_low') return 'lightness_0';
    }

    return null;
};

export const normalizeAchievementIds = (value: unknown): string[] =>
    Array.from(new Set(uniqueStrings(value)
        .map(migrateAchievementId)
        .filter((achievementId): achievementId is string => achievementId !== null)));

export const calculateAchievementPoints = (achievementIds: string[]): number =>
    achievementIds.reduce((total, achievementId) => total + (achievementReward(achievementId)?.points ?? 0), 0);

export const isCurrentAchievementId = (achievementId: string): boolean =>
    /^spot_count_(4|8|12|20)$/.test(achievementId)
    || /^spot_color_(주황|노랑|하양|검정)$/.test(achievementId)
    || achievementId === 'special_five_color'
    || /^color_(빨강|주황|노랑|크림|검정)_basic$/.test(achievementId)
    || /^(saturation_100|saturation_0|lightness_100|lightness_0)$/.test(achievementId)
    || /^legend_spot_(주황|노랑|하양|검정)$/.test(achievementId);

export const currentAchievementIds = (value: unknown): string[] =>
    normalizeAchievementIds(value).filter(isCurrentAchievementId);

const achievementIdsFrom = (value: unknown, field: 'claimedIds' | 'unlockedIds'): string[] => {
    const record = asRecord(value);
    const achievements = asRecord(record.achievements);
    const directField = field === 'claimedIds' ? record.claimedAchievementIds : record.unlockedAchievementIds;
    return normalizeAchievementIds([
        ...uniqueStrings(achievements[field]),
        ...uniqueStrings(directField),
    ]);
};

const maximum = (values: unknown[]): number =>
    values.reduce<number>((highest, value) => Math.max(highest, finiteInteger(value)), 0);

/**
 * Builds one monotonic account progression from every server-side source.
 *
 * Once progressionProtocolVersion is present, incoming client totals and
 * claimed IDs are ignored. New unlock IDs can still be accepted because the
 * claim callable independently verifies the achievement condition.
 */
export const reconcileProgression = (sources: ProgressionSources): CanonicalProgression => {
    const userData = asRecord(sources.userData);
    const rankingState = asRecord(sources.rankingStateData);
    const publicRanking = asRecord(sources.publicRankingData);
    const currentGameState = asRecord(sources.currentGameState ?? userData.gameState);
    const incomingGameState = asRecord(sources.incomingGameState);
    const backupGameStates = (sources.backupGameStates ?? []).map(asRecord);
    const isMigrated = maximum([
        userData.progressionProtocolVersion,
        rankingState.progressionProtocolVersion,
    ]) >= PROGRESSION_PROTOCOL_VERSION;
    const allowIncomingProgression = sources.allowIncomingProgression === true || !isMigrated;

    const trustedClaimSources = [rankingState, currentGameState, ...backupGameStates];
    const claimedAchievementIds = normalizeAchievementIds([
        ...trustedClaimSources.flatMap(source => achievementIdsFrom(source, 'claimedIds')),
        ...normalizeAchievementIds(sources.historicalAchievementIds ?? []),
        ...(allowIncomingProgression ? achievementIdsFrom(incomingGameState, 'claimedIds') : []),
    ]);
    const unlockedAchievementIds = normalizeAchievementIds([
        ...trustedClaimSources.flatMap(source => achievementIdsFrom(source, 'unlockedIds')),
        ...achievementIdsFrom(incomingGameState, 'unlockedIds'),
        ...claimedAchievementIds,
    ]);

    const trustedHonorValues = [
        rankingState.honorPoints,
        userData.honorPoints,
        currentGameState.honorPoints,
        ...backupGameStates.map(state => state.honorPoints),
    ];
    if (allowIncomingProgression) {
        trustedHonorValues.push(incomingGameState.honorPoints, publicRanking.honorPoints);
    }
    const honorPoints = maximum(trustedHonorValues);

    const pointsFromClaims = calculateAchievementPoints(claimedAchievementIds);
    const trustedPointValues = [
        rankingState.achievementPoints,
        userData.achievementPoints,
        currentGameState.achievementPoints,
        ...backupGameStates.map(state => state.achievementPoints),
    ];
    if (allowIncomingProgression) {
        trustedPointValues.push(incomingGameState.achievementPoints, publicRanking.achievementPoints);
    }
    const observedTotal = maximum(trustedPointValues);
    const existingLegacyBase = maximum([
        rankingState.legacyAchievementPointsBase,
        userData.legacyAchievementPointsBase,
    ]);
    // A base preserves old scores whose claim IDs were never stored. Known
    // claim IDs are still counted exactly once after deduplication.
    const legacyAchievementPointsBase = Math.max(
        existingLegacyBase,
        observedTotal - pointsFromClaims,
        0,
    );

    return {
        honorPoints,
        achievementPoints: legacyAchievementPointsBase + pointsFromClaims,
        legacyAchievementPointsBase,
        claimedAchievementIds,
        unlockedAchievementIds,
    };
};
