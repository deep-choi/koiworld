import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

initializeApp();

const db = getFirestore();
const REGION = 'asia-northeast1';
const TROPHY_PRICE = 100_000;
const MAX_TROPHY_QUANTITY = 99;
const MAX_EVENT_ID_LENGTH = 80;
const MAX_PROFILE_DATA_URL_LENGTH = 120_000;
const NATIVE_AUTH_SOURCE = 'playgames';

setGlobalOptions({
    region: REGION,
    maxInstances: 10,
    memory: '256MiB',
    timeoutSeconds: 30,
});

const setNativeAuthExchangeCors = (request: Request, response: Response): void => {
    const origin = request.header('origin');
    response.set('Access-Control-Allow-Origin', origin || '*');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Vary', 'Origin');
};

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

const normalizePhotoURL = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const photoURL = value.trim().replace(/^http:\/\//i, 'https://');
    if (!photoURL) return null;

    const isImageDataURL = /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(photoURL);
    const maxLength = isImageDataURL ? MAX_PROFILE_DATA_URL_LENGTH : 500;
    return photoURL.length <= maxLength ? photoURL : null;
};

const normalizeProfile = (value: unknown): Profile => {
    const data = asRecord(value);
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 40) : '';
    const photoURL = normalizePhotoURL(data.photoURL);

    if (!nickname) {
        throw new HttpsError('invalid-argument', '닉네임이 필요합니다.');
    }

    return { nickname, photoURL };
};

const requireAuth = (uid: string | undefined): string => {
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    return uid;
};

/**
 * Bridges a native Firebase Play Games session into the Firebase JS SDK.
 *
 * The native SDK can validate the Play Games server auth code and create the
 * correct `playgames.google.com` Firebase user. The JS SDK cannot consume
 * that native credential directly, so the verified native ID token is
 * exchanged for a custom token for the same UID.
 */
export const exchangeNativeFirebaseToken = onRequest(async (request, response) => {
    setNativeAuthExchangeCors(request, response);

    if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
    }

    if (request.method !== 'POST') {
        response.status(405).json({ error: 'Method not allowed.' });
        return;
    }

    const authorization = request.header('authorization') ?? '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
        response.status(401).json({ error: 'A Firebase ID token is required.' });
        return;
    }

    try {
        const decodedToken = await getAuth().verifyIdToken(tokenMatch[1]);
        if (decodedToken.firebase?.sign_in_provider !== 'playgames.google.com') {
            response.status(403).json({ error: 'Only a Play Games Firebase session can use this endpoint.' });
            return;
        }

        const token = await getAuth().createCustomToken(decodedToken.uid, {
            authSource: NATIVE_AUTH_SOURCE,
        });
        response.status(200).json({ token, uid: decodedToken.uid });
    } catch (error) {
        console.error('Native Firebase token exchange failed:', error);
        response.status(401).json({ error: 'The Firebase ID token is invalid or expired.' });
    }
});

const requireEventId = (value: unknown): string => {
    if (typeof value !== 'string' || value.length < 8 || value.length > MAX_EVENT_ID_LENGTH) {
        throw new HttpsError('invalid-argument', '유효하지 않은 랭킹 이벤트입니다.');
    }
    return value;
};

const readRankingState = (
    data: DocumentData | undefined,
    uid: string,
    legacyUserData?: DocumentData,
    historicalAchievementIds: unknown[] = [],
): RankingState => {
    const legacyGameState = asGameState(legacyUserData?.gameState);
    const legacyAchievements = asRecord(legacyGameState.achievements);
    const claimedAchievementIds = normalizeAchievementIds([
        ...uniqueStrings(data?.claimedAchievementIds),
        ...uniqueStrings(legacyAchievements.claimedIds),
        ...historicalAchievementIds,
    ]);
    const hasClaimHistory = Array.isArray(data?.claimedAchievementIds)
        || Array.isArray(legacyAchievements.claimedIds);

    return {
        uid,
        honorPoints: finiteInteger(data?.honorPoints ?? legacyUserData?.honorPoints ?? legacyGameState.honorPoints),
        // Keep the ranking total derived from server-owned claim history. This
        // repairs totals after an achievement definition is removed or changed.
        achievementPoints: hasClaimHistory
            ? calculateAchievementPoints(claimedAchievementIds)
            : finiteInteger(data?.achievementPoints ?? legacyUserData?.achievementPoints ?? legacyGameState.achievementPoints),
        claimedAchievementIds,
    };
};

const readProfileFromUser = (userData: DocumentData | undefined): Profile => {
    const profile = asRecord(userData?.profile);
    const nickname = typeof profile.nickname === 'string' && profile.nickname.trim()
        ? profile.nickname.trim().slice(0, 40)
        : 'User';
    const photoURL = normalizePhotoURL(profile.photoURL);
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
        unlockedIds: normalizeAchievementIds([
            ...uniqueStrings(asRecord(gameState.achievements).unlockedIds),
            ...state.claimedAchievementIds,
        ]),
        claimedIds: state.claimedAchievementIds,
    },
});

const achievementReward = (achievementId: string): { points: number } | null => {
    const spotCountRewards: Record<number, { points: number }> = {
        4: { points: 100 },
        8: { points: 200 },
        12: { points: 300 },
        20: { points: 500 },
    };
    const spotCountMatch = /^spot_count_(4|8|12|20)$/.exec(achievementId);
    if (spotCountMatch) return spotCountRewards[Number(spotCountMatch[1])];
    if (/^spot_color_(주황|노랑|하양|검정)$/.test(achievementId)) return { points: 100 };
    if (achievementId === 'special_five_color') return { points: 200 };
    if (/^color_(빨강|주황|노랑|크림|검정)_basic$/.test(achievementId)) return { points: 200 };
    if (/^(saturation_100|saturation_0|lightness_100|lightness_0)$/.test(achievementId)) {
        return { points: 300 };
    }
    if (/^legend_spot_(주황|노랑|하양|검정)$/.test(achievementId)) return { points: 500 };
    return null;
};

const migrateAchievementId = (achievementId: string): string | null => {
    if (achievementReward(achievementId)) return achievementId;

    // The old client created one achievement per color for these conditions.
    // They are now global achievements, so preserve one claim for each global
    // condition when rebuilding the server-owned ranking state.
    const legacyColorVariant = /^color_(빨강|주황|노랑|크림|검정)_(sat_high|sat_low|light_high|light_low)$/.exec(achievementId);
    if (legacyColorVariant) {
        const [, , variant] = legacyColorVariant;
        if (variant === 'sat_high') return 'saturation_100';
        if (variant === 'sat_low') return 'saturation_0';
        if (variant === 'light_high') return 'lightness_100';
        if (variant === 'light_low') return 'lightness_0';
    }

    // Removed spot-count and master achievements have no current equivalent.
    return null;
};

const normalizeAchievementIds = (value: unknown): string[] =>
    Array.from(new Set(uniqueStrings(value)
        .map(migrateAchievementId)
        .filter((achievementId): achievementId is string => achievementId !== null)));

const calculateAchievementPoints = (achievementIds: string[]): number =>
    achievementIds.reduce((total, achievementId) => total + (achievementReward(achievementId)?.points ?? 0), 0);

const loadHistoricalAchievementIds = async (uid: string): Promise<string[]> => {
    const snapshot = await db.collection('rankingEvents').where('uid', '==', uid).get();
    return snapshot.docs.flatMap(eventSnapshot => {
        const event = eventSnapshot.data();
        if (event.type !== 'claimAchievement') return [];

        const result = asRecord(event.result);
        return [event.achievementId, result.achievementId];
    });
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

    const spotCountMatch = /^spot_count_(4|8|12|20)$/.exec(achievementId);
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

    const colorMatch = /^color_(빨강|주황|노랑|크림|검정)_basic$/.exec(achievementId);
    if (colorMatch) {
        const color = colorMatch[1];
        return hasKoi(koi => {
            const genetics = asRecord(koi.genetics);
            return basePhenotype(genetics.baseColorGenes) === color;
        });
    }

    const extremeMatch = /^(saturation_100|saturation_0|lightness_100|lightness_0)$/.exec(achievementId);
    if (extremeMatch) {
        const isSaturation = extremeMatch[1].startsWith('saturation');
        const isMaximum = extremeMatch[1].endsWith('_100');
        return hasKoi(koi => {
            const genetics = asRecord(koi.genetics);
            const value = isSaturation ? genetics.saturation : genetics.lightness;
            if (typeof value !== 'number') return false;
            return isMaximum ? value >= 100 : value <= 0;
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
    const historicalAchievementIds = await loadHistoricalAchievementIds(uid);

    return db.runTransaction(async transaction => {
        const userSnapshot = await transaction.get(userReference);
        const stateSnapshot = await transaction.get(stateReference);
        const userData = userSnapshot.exists ? userSnapshot.data() ?? {} : {};
        const state = readRankingState(
            stateSnapshot.exists ? stateSnapshot.data() : undefined,
            uid,
            userData,
            historicalAchievementIds,
        );
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
    const historicalAchievementIds = await loadHistoricalAchievementIds(uid);

    return db.runTransaction(async transaction => {
        const userSnapshot = await transaction.get(userReference);
        const stateSnapshot = await transaction.get(stateReference);
        const eventSnapshot = await transaction.get(eventReference);
        if (!userSnapshot.exists) throw new HttpsError('failed-precondition', '사용자 저장 데이터가 없습니다.');
        if (eventSnapshot.exists) return eventSnapshot.data()?.result as AchievementClaimResult;

        const userData = userSnapshot.data() ?? {};
        const state = readRankingState(
            stateSnapshot.exists ? stateSnapshot.data() : undefined,
            uid,
            userData,
            historicalAchievementIds,
        );
        if (state.claimedAchievementIds.includes(achievementId)) {
            return {
                achievementId,
                achievementReward: 0,
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
        const result: AchievementClaimResult = {
            achievementId,
            achievementReward: reward.points,
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            claimedIds: nextState.claimedAchievementIds,
            unlockedIds: nextState.claimedAchievementIds,
        };

        transaction.set(userReference, {
            gameState: gameStateWithRanking(gameState, nextState, {
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
    claimedIds: string[];
    unlockedIds: string[];
};
