import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const db = getFirestore();
const REGION = 'asia-northeast1';
const TROPHY_PRICE = 100_000;
const MAX_TROPHY_QUANTITY = 99;
const MAX_EVENT_ID_LENGTH = 80;

setGlobalOptions({
    region: REGION,
    maxInstances: 10,
    memory: '256MiB',
    timeoutSeconds: 30,
});

type Profile = {
    nickname: string;
    photoURL: string | null;
};

type RankingState = {
    uid: string;
    honorPoints: number;
    achievementPoints: number;
    claimedAchievementIds: string[];
};

type GameState = {
    zenPoints?: unknown;
    cornCount?: unknown;
    honorPoints?: unknown;
    achievementPoints?: unknown;
    achievements?: {
        unlockedIds?: unknown;
        claimedIds?: unknown;
    };
    ponds?: Record<string, {
        kois?: unknown;
    }>;
    [key: string]: unknown;
};

type RankingResult = {
    honorPoints: number;
    achievementPoints: number;
    zenPoints?: number;
    acceptedQuantity?: number;
};

const usersRef = (uid: string) => db.collection('users').doc(uid);
const rankingStateRef = (uid: string) => db.collection('rankingState').doc(uid);
const rankingRef = (uid: string) => db.collection('rankings').doc(uid);
const eventRef = (uid: string, eventId: string) => db.collection('rankingEvents').doc(`${uid}_${eventId}`);

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

const asGameState = (value: unknown): GameState => asRecord(value) as GameState;

const finiteInteger = (value: unknown, fallback = 0): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
};

const uniqueStrings = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === 'string')));
};

const normalizeProfile = (value: unknown): Profile => {
    const data = asRecord(value);
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 40) : '';
    const photoURL = typeof data.photoURL === 'string' && data.photoURL.trim()
        ? data.photoURL.trim().replace(/^http:\/\//i, 'https://').slice(0, 500)
        : null;

    if (!nickname) {
        throw new HttpsError('invalid-argument', '닉네임이 필요합니다.');
    }

    return { nickname, photoURL };
};

const requireAuth = (uid: string | undefined): string => {
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    return uid;
};

const requireEventId = (value: unknown): string => {
    if (typeof value !== 'string' || value.length < 8 || value.length > MAX_EVENT_ID_LENGTH) {
        throw new HttpsError('invalid-argument', '유효하지 않은 랭킹 이벤트입니다.');
    }
    return value;
};

const readRankingState = (data: DocumentData | undefined, uid: string, legacyUserData?: DocumentData): RankingState => {
    const legacyGameState = asGameState(legacyUserData?.gameState);
    return {
        uid,
        honorPoints: finiteInteger(data?.honorPoints ?? legacyUserData?.honorPoints ?? legacyGameState.honorPoints),
        achievementPoints: finiteInteger(data?.achievementPoints ?? legacyUserData?.achievementPoints ?? legacyGameState.achievementPoints),
        claimedAchievementIds: uniqueStrings(data?.claimedAchievementIds),
    };
};

const readProfileFromUser = (userData: DocumentData | undefined): Profile => {
    const profile = asRecord(userData?.profile);
    const nickname = typeof profile.nickname === 'string' && profile.nickname.trim()
        ? profile.nickname.trim().slice(0, 40)
        : 'User';
    const photoURL = typeof profile.photoURL === 'string' && profile.photoURL.trim()
        ? profile.photoURL.trim().replace(/^http:\/\//i, 'https://').slice(0, 500)
        : null;
    return { nickname, photoURL };
};

const rankingDocument = (
    uid: string,
    profile: Profile,
    state: RankingState,
) => ({
    uid,
    nickname: profile.nickname,
    photoURL: profile.photoURL,
    honorPoints: state.honorPoints,
    achievementPoints: state.achievementPoints,
    updatedAt: FieldValue.serverTimestamp(),
});

const gameStateWithRanking = (
    gameState: GameState,
    state: RankingState,
    extra: Record<string, unknown> = {},
): GameState => ({
    ...gameState,
    ...extra,
    honorPoints: state.honorPoints,
    achievementPoints: state.achievementPoints,
    achievements: {
        ...asRecord(gameState.achievements),
        unlockedIds: Array.from(new Set([
            ...uniqueStrings(asRecord(gameState.achievements).unlockedIds),
            ...state.claimedAchievementIds,
        ])),
        claimedIds: state.claimedAchievementIds,
    },
});

const achievementReward = (achievementId: string): { points: number; corn: number } | null => {
    const spotCountRewards: Record<number, { points: number; corn: number }> = {
        4: { points: 100, corn: 10 },
        8: { points: 200, corn: 25 },
        12: { points: 300, corn: 50 },
        16: { points: 400, corn: 90 },
        20: { points: 500, corn: 150 },
    };
    const spotCountMatch = /^spot_count_(4|8|12|16|20)$/.exec(achievementId);
    if (spotCountMatch) return spotCountRewards[Number(spotCountMatch[1])];
    if (/^spot_color_(주황|노랑|하양|검정)$/.test(achievementId)) return { points: 100, corn: 5 };
    if (achievementId === 'special_five_color') return { points: 200, corn: 30 };
    if (/^color_(빨강|주황|노랑|크림|검정)_basic$/.test(achievementId)) return { points: 200, corn: 15 };
    if (/^color_(빨강|주황|노랑|크림|검정)_(sat_high|sat_low|light_high|light_low)$/.test(achievementId)) {
        return { points: 300, corn: 45 };
    }
    if (/^master_(빨강|주황|노랑|크림|검정)_(void|brilliant|abyssal_flame|pure)$/.test(achievementId)) {
        return { points: 400, corn: 90 };
    }
    if (/^legend_spot_(주황|노랑|하양|검정)$/.test(achievementId)) return { points: 500, corn: 150 };
    return null;
};

const basePhenotype = (genes: unknown): string => {
    const validGenes = (Array.isArray(genes)
        ? genes.filter((gene): gene is string => typeof gene === 'string')
        : []).filter(gene => gene !== '하양');
    if (validGenes.length === 0) return '크림';
    const counts = new Map<string, number>();
    validGenes.forEach(gene => counts.set(gene, (counts.get(gene) ?? 0) + 1));
    const dominantOrder = ['검정', '빨강', '주황', '노랑', '크림'];
    const expressed = dominantOrder.filter(gene => (counts.get(gene) ?? 0) >= 2);
    return expressed[0] ?? '크림';
};

const allKois = (gameState: GameState): Array<Record<string, unknown>> => {
    const ponds = asRecord(gameState.ponds);
    return Object.values(ponds).flatMap(pond => {
        const kois = asRecord(pond).kois;
        return Array.isArray(kois) ? kois.map(asRecord) : [];
    });
};

const achievementConditionMet = (achievementId: string, gameState: GameState): boolean => {
    const kois = allKois(gameState);
    const hasKoi = (condition: (koi: Record<string, unknown>) => boolean) => kois.some(condition);

    const spotCountMatch = /^spot_count_(4|8|12|16|20)$/.exec(achievementId);
    if (spotCountMatch) {
        const count = Number(spotCountMatch[1]);
        return hasKoi(koi => {
            const spots = asRecord(koi.genetics).spots;
            return Array.isArray(spots) && spots.length >= count;
        });
    }

    const spotColorMatch = /^spot_color_(주황|노랑|하양|검정)$/.exec(achievementId);
    if (spotColorMatch) {
        const color = spotColorMatch[1];
        return hasKoi(koi => {
            const spots = asRecord(koi.genetics).spots;
            return Array.isArray(spots) && spots.some(spot => asRecord(spot).color === color);
        });
    }

    if (achievementId === 'special_five_color') {
        return hasKoi(koi => {
            const genetics = asRecord(koi.genetics);
            const spots = Array.isArray(genetics.spots) ? genetics.spots : [];
            const colors = new Set<string>([
                basePhenotype(genetics.baseColorGenes),
                ...spots.map(spot => String(asRecord(spot).color ?? '')),
            ]);
            return ['빨강', '주황', '노랑', '하양', '검정'].every(color => colors.has(color));
        });
    }

    const colorMatch = /^color_(빨강|주황|노랑|크림|검정)_(basic|sat_high|sat_low|light_high|light_low)$/.exec(achievementId);
    if (colorMatch) {
        const [, color, variant] = colorMatch;
        return hasKoi(koi => {
            const genetics = asRecord(koi.genetics);
            if (basePhenotype(genetics.baseColorGenes) !== color) return false;
            if (variant === 'basic') return true;
            const value = variant.startsWith('sat') ? genetics.saturation : genetics.lightness;
            if (typeof value !== 'number') return false;
            return variant.endsWith('high') ? value >= 100 : value <= 0;
        });
    }

    const masterMatch = /^master_(빨강|주황|노랑|크림|검정)_(void|brilliant|abyssal_flame|pure)$/.exec(achievementId);
    if (masterMatch) {
        const [, color, variant] = masterMatch;
        return hasKoi(koi => {
            const genetics = asRecord(koi.genetics);
            const cs = asRecord(asRecord(genetics.spotPhenotypeGenes).CS);
            const allele1 = asRecord(cs.allele1).value;
            const allele2 = asRecord(cs.allele2).value;
            const lightness = genetics.lightness;
            const saturation = genetics.saturation;
            if (typeof allele1 !== 'number' || typeof allele2 !== 'number'
                || typeof lightness !== 'number' || typeof saturation !== 'number') return false;
            const extremeSpots = variant === 'void' || variant === 'pure'
                ? allele1 <= 0 && allele2 <= 0
                : allele1 >= 100 && allele2 >= 100;
            const extremeLight = variant === 'void' || variant === 'abyssal_flame'
                ? lightness <= 0
                : lightness >= 100;
            const extremeSaturation = variant === 'void' || variant === 'pure'
                ? saturation <= 0
                : saturation >= 100;
            return basePhenotype(genetics.baseColorGenes) === color
                && extremeSpots
                && extremeLight
                && extremeSaturation;
        });
    }

    const legendMatch = /^legend_spot_(주황|노랑|하양|검정)$/.exec(achievementId);
    if (legendMatch) {
        const color = legendMatch[1];
        return hasKoi(koi => {
            const spots = asRecord(koi.genetics).spots;
            return Array.isArray(spots)
                && spots.length >= 16
                && spots.every(spot => asRecord(spot).color === color);
        });
    }

    return false;
};

const writeRankingState = (
    transaction: Transaction,
    uid: string,
    userData: DocumentData,
    state: RankingState,
) => {
    const profile = readProfileFromUser(userData);
    transaction.set(rankingStateRef(uid), {
        ...state,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(rankingRef(uid), rankingDocument(uid, profile, state), { merge: true });
};

export const initializeRankingProfile = onCall(async request => {
    const uid = requireAuth(request.auth?.uid);
    const profile = normalizeProfile(request.data);
    const userReference = usersRef(uid);
    const stateReference = rankingStateRef(uid);

    return db.runTransaction(async transaction => {
        const userSnapshot = await transaction.get(userReference);
        const stateSnapshot = await transaction.get(stateReference);
        const userData = userSnapshot.exists ? userSnapshot.data() ?? {} : {};
        const state = readRankingState(stateSnapshot.exists ? stateSnapshot.data() : undefined, uid, userData);
        const gameState = asGameState(userData.gameState);

        transaction.set(userReference, {
            profile: { nickname: profile.nickname, photoURL: profile.photoURL },
            honorPoints: state.honorPoints,
            achievementPoints: state.achievementPoints,
            gameState: {
                ...gameState,
                honorPoints: state.honorPoints,
                achievementPoints: state.achievementPoints,
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writeRankingState(transaction, uid, { ...userData, profile }, state);
        return {
            honorPoints: state.honorPoints,
            achievementPoints: state.achievementPoints,
        };
    });
});

export const updateRankingProfile = initializeRankingProfile;

export const purchaseHonorTrophies = onCall(async request => {
    const uid = requireAuth(request.auth?.uid);
    const quantity = finiteInteger(asRecord(request.data).quantity, -1);
    if (quantity < 1 || quantity > MAX_TROPHY_QUANTITY) {
        throw new HttpsError('invalid-argument', '구매 수량이 유효하지 않습니다.');
    }
    const id = requireEventId(asRecord(request.data).eventId);
    const userReference = usersRef(uid);
    const stateReference = rankingStateRef(uid);
    const eventReference = eventRef(uid, id);

    return db.runTransaction(async transaction => {
        const userSnapshot = await transaction.get(userReference);
        const stateSnapshot = await transaction.get(stateReference);
        const eventSnapshot = await transaction.get(eventReference);
        if (!userSnapshot.exists) throw new HttpsError('failed-precondition', '사용자 저장 데이터가 없습니다.');
        if (eventSnapshot.exists) return eventSnapshot.data()?.result as RankingResult;

        const userData = userSnapshot.data() ?? {};
        const state = readRankingState(stateSnapshot.exists ? stateSnapshot.data() : undefined, uid, userData);
        const gameState = asGameState(userData.gameState);
        const zenPoints = finiteInteger(gameState.zenPoints, -1);
        const totalCost = TROPHY_PRICE * quantity;
        if (zenPoints < totalCost) {
            throw new HttpsError('failed-precondition', '젠 포인트가 부족합니다.');
        }

        const nextState: RankingState = {
            ...state,
            honorPoints: state.honorPoints + quantity,
        };
        const result: RankingResult = {
            acceptedQuantity: quantity,
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            zenPoints: zenPoints - totalCost,
        };

        transaction.set(userReference, {
            gameState: gameStateWithRanking(gameState, nextState, { zenPoints: result.zenPoints }),
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writeRankingState(transaction, uid, userData, nextState);
        transaction.create(eventReference, {
            uid,
            type: 'purchaseHonorTrophies',
            result,
            createdAt: FieldValue.serverTimestamp(),
        });

        return result;
    });
});

export const claimAchievement = onCall(async request => {
    const uid = requireAuth(request.auth?.uid);
    const data = asRecord(request.data);
    const achievementId = typeof data.achievementId === 'string' ? data.achievementId : '';
    const reward = achievementReward(achievementId);
    if (!reward) throw new HttpsError('invalid-argument', '존재하지 않는 업적입니다.');
    const id = requireEventId(data.eventId);
    const userReference = usersRef(uid);
    const stateReference = rankingStateRef(uid);
    const eventReference = eventRef(uid, id);

    return db.runTransaction(async transaction => {
        const userSnapshot = await transaction.get(userReference);
        const stateSnapshot = await transaction.get(stateReference);
        const eventSnapshot = await transaction.get(eventReference);
        if (!userSnapshot.exists) throw new HttpsError('failed-precondition', '사용자 저장 데이터가 없습니다.');
        if (eventSnapshot.exists) return eventSnapshot.data()?.result as AchievementClaimResult;

        const userData = userSnapshot.data() ?? {};
        const state = readRankingState(stateSnapshot.exists ? stateSnapshot.data() : undefined, uid, userData);
        if (state.claimedAchievementIds.includes(achievementId)) {
            return {
                achievementId,
                achievementReward: 0,
                cornReward: 0,
                honorPoints: state.honorPoints,
                achievementPoints: state.achievementPoints,
                claimedIds: state.claimedAchievementIds,
                unlockedIds: state.claimedAchievementIds,
            } satisfies AchievementClaimResult;
        }

        const gameState = asGameState(userData.gameState);
        if (!achievementConditionMet(achievementId, gameState)) {
            throw new HttpsError('failed-precondition', '현재 서버 저장 상태에서 업적 조건을 확인할 수 없습니다.');
        }

        const nextState: RankingState = {
            ...state,
            achievementPoints: state.achievementPoints + reward.points,
            claimedAchievementIds: [...state.claimedAchievementIds, achievementId],
        };
        const currentCorn = finiteInteger(gameState.cornCount);
        const result: AchievementClaimResult = {
            achievementId,
            achievementReward: reward.points,
            cornReward: reward.corn,
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            claimedIds: nextState.claimedAchievementIds,
            unlockedIds: nextState.claimedAchievementIds,
        };

        transaction.set(userReference, {
            gameState: gameStateWithRanking(gameState, nextState, {
                cornCount: currentCorn + reward.corn,
            }),
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writeRankingState(transaction, uid, userData, nextState);
        transaction.create(eventReference, {
            uid,
            type: 'claimAchievement',
            achievementId,
            result,
            createdAt: FieldValue.serverTimestamp(),
        });

        return result;
    });
});

export const deleteAccountData = onCall(async request => {
    const uid = requireAuth(request.auth?.uid);
    const userReference = usersRef(uid);
    const stateReference = rankingStateRef(uid);
    const publicRankingReference = rankingRef(uid);
    const events = await db.collection('rankingEvents').where('uid', '==', uid).get();
    const references = [userReference, stateReference, publicRankingReference, ...events.docs.map(snapshot => snapshot.ref)];

    for (let offset = 0; offset < references.length; offset += 400) {
        const batch = db.batch();
        references.slice(offset, offset + 400).forEach(reference => batch.delete(reference));
        await batch.commit();
    }

    return { deleted: true };
});

type AchievementClaimResult = RankingResult & {
    achievementId: string;
    achievementReward: number;
    cornReward: number;
    claimedIds: string[];
    unlockedIds: string[];
};
