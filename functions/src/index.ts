import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import {
    PROGRESSION_PROTOCOL_VERSION,
    achievementReward,
    asRecord,
    calculateAchievementPoints,
    currentAchievementIds,
    finiteInteger,
    normalizeAchievementIds,
    reconcileProgression,
    uniqueStrings,
    type CanonicalProgression,
} from './progression.js';

initializeApp();

const db = getFirestore();
const REGION = 'asia-northeast1';
const TROPHY_PRICE = 100_000;
const MAX_TROPHY_QUANTITY = 99;
const MAX_EVENT_ID_LENGTH = 80;
const MAX_PROFILE_DATA_URL_LENGTH = 120_000;
const MAX_GAME_STATE_BYTES = 850_000;
const SAVE_PROTOCOL_VERSION = 2;
const GAME_STATE_SCHEMA_VERSION = 3;
const DAILY_BACKUP_SLOT_COUNT = 14;
const SAVE_REASONS = new Set(['auto', 'new-account', 'backup-recovery', 'explicit-reset']);
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

type RankingState = CanonicalProgression & {
    uid: string;
    progressionProtocolVersion: number;
};

type GameState = {
    schemaVersion?: unknown;
    zenPoints?: unknown;
    foodCount?: unknown;
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
    revision?: number;
};

const usersRef = (uid: string) => db.collection('users').doc(uid);
const gameStateBackupsRef = (uid: string) => usersRef(uid).collection('gameStateBackups');
const gameStateBackupRef = (uid: string, backupId = 'latest') => gameStateBackupsRef(uid).doc(backupId);
const rankingStateRef = (uid: string) => db.collection('rankingState').doc(uid);
const rankingRef = (uid: string) => db.collection('rankings').doc(uid);
const eventRef = (uid: string, eventId: string) => db.collection('rankingEvents').doc(`${uid}_${eventId}`);

const asGameState = (value: unknown): GameState => asRecord(value) as GameState;

const isValidGameState = (value: unknown): value is GameState => {
    const gameState = asRecord(value);
    const ponds = asRecord(gameState.ponds);
    const activePondId = gameState.activePondId;

    return typeof activePondId === 'string'
        && Object.prototype.hasOwnProperty.call(ponds, activePondId)
        && typeof gameState.zenPoints === 'number'
        && Number.isFinite(gameState.zenPoints)
        && typeof gameState.foodCount === 'number'
        && Number.isFinite(gameState.foodCount)
        && typeof gameState.koiNameCounter === 'number'
        && Number.isFinite(gameState.koiNameCounter);
};

const normalizeGameStateForSave = (value: unknown): GameState => {
    if (!isValidGameState(value)) {
        throw new HttpsError('invalid-argument', '유효하지 않은 게임 저장 데이터입니다.');
    }

    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_GAME_STATE_BYTES) {
        throw new HttpsError('invalid-argument', '게임 저장 데이터가 허용 크기를 초과했습니다.');
    }

    return JSON.parse(serialized) as GameState;
};

const requireSaveRevision = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new HttpsError('invalid-argument', '유효한 저장 리비전이 필요합니다.');
    }
    return value;
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
        const code = typeof error === 'object' && error && 'code' in error
            ? String((error as { code?: string }).code ?? '')
            : '';
        const isClientTokenError = [
            'auth/argument-error',
            'auth/id-token-expired',
            'auth/id-token-revoked',
            'auth/invalid-id-token',
        ].includes(code);
        response.status(isClientTokenError ? 401 : 503).json({
            error: isClientTokenError
                ? 'Play Games 인증이 만료되었습니다. 다시 로그인해주세요.'
                : 'Play Games 저장 계정 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.',
        });
    }
});

/**
 * Persists the complete game snapshot under a server-enforced revision.
 *
 * Once an account is migrated to protocol 2, Firestore Rules reject legacy
 * clients that try to write gameState directly. This prevents an older app or
 * stale device from silently replacing a newer snapshot for the same UID.
 */
export const saveGameState = onCall(async request => {
    const uid = requireAuth(request.auth?.uid);
    const data = asRecord(request.data);
    const incomingGameState = normalizeGameStateForSave(data.gameState);
    const expectedRevision = requireSaveRevision(data.expectedRevision);
    const saveReason = typeof data.reason === 'string' && SAVE_REASONS.has(data.reason)
        ? data.reason
        : 'auto';
    const deviceId = typeof data.deviceId === 'string'
        ? data.deviceId.trim().slice(0, 128)
        : '';
    const userReference = usersRef(uid);
    const stateReference = rankingStateRef(uid);
    const publicRankingReference = rankingRef(uid);
    const backupReference = gameStateBackupRef(uid);

    // Historical queries are only needed while an account is crossing the
    // canonical progression boundary. Normal 15-second saves remain a small
    // fixed transaction after the first successful migration.
    const preflightUserSnapshot = await userReference.get();
    const preflightUserData = preflightUserSnapshot.exists ? preflightUserSnapshot.data() ?? {} : {};
    const needsProgressionMigration = finiteInteger(preflightUserData.progressionProtocolVersion)
        < PROGRESSION_PROTOCOL_VERSION;
    const [historicalAchievementIds, recoveryGameStates, publicRankingSnapshot] = needsProgressionMigration
        ? await Promise.all([
            loadHistoricalAchievementIds(uid),
            loadRecoveryGameStates(uid),
            publicRankingReference.get(),
        ])
        : [[], [], null];

    return db.runTransaction(async transaction => {
        const [userSnapshot, stateSnapshot] = await Promise.all([
            transaction.get(userReference),
            transaction.get(stateReference),
        ]);
        const userData = userSnapshot.exists ? userSnapshot.data() ?? {} : {};
        const currentRevision = finiteInteger(userData.gameStateRevision);

        if (currentRevision !== expectedRevision) {
            throw new HttpsError(
                'aborted',
                '다른 기기에서 더 최신 저장본이 확인되었습니다.',
                { expectedRevision, actualRevision: currentRevision },
            );
        }

        const currentGameState = userData.gameState;
        const nextRevision = currentRevision + 1;
        const progression = reconcileProgression({
            userData,
            rankingStateData: stateSnapshot.exists ? stateSnapshot.data() : undefined,
            publicRankingData: publicRankingSnapshot?.exists ? publicRankingSnapshot.data() : undefined,
            currentGameState,
            incomingGameState,
            backupGameStates: recoveryGameStates,
            historicalAchievementIds,
            allowIncomingProgression: finiteInteger(userData.progressionProtocolVersion)
                < PROGRESSION_PROTOCOL_VERSION,
        });
        const nextState: RankingState = {
            uid,
            ...progression,
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
        };
        const gameState = gameStateWithRanking(incomingGameState, nextState);
        const currentPayload = isValidGameState(currentGameState) ? JSON.stringify(currentGameState) : null;
        const nextPayload = JSON.stringify(gameState);

        if (currentPayload && currentPayload !== nextPayload) {
            const backup = {
                gameState: currentGameState,
                gameStateRevision: currentRevision,
                savedAt: FieldValue.serverTimestamp(),
                replacedByDeviceId: deviceId || null,
                replacedByReason: saveReason,
            };
            transaction.set(backupReference, { ...backup, backupKind: 'latest' });

            const dayKey = new Date().toISOString().slice(0, 10);
            if (userData.lastDailyBackupDate !== dayKey) {
                const dayNumber = Math.floor(Date.now() / 86_400_000);
                const slot = String(dayNumber % DAILY_BACKUP_SLOT_COUNT).padStart(2, '0');
                transaction.set(gameStateBackupRef(uid, `daily-${slot}`), {
                    ...backup,
                    backupKind: 'daily',
                    dayKey,
                });
            }
        }

        transaction.set(userReference, {
            gameState,
            gameStateRevision: nextRevision,
            saveProtocolVersion: SAVE_PROTOCOL_VERSION,
            gameStateSavedAt: FieldValue.serverTimestamp(),
            lastSaveDeviceId: deviceId || null,
            lastSaveReason: saveReason,
            lastDailyBackupDate: new Date().toISOString().slice(0, 10),
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
            legacyAchievementPointsBase: nextState.legacyAchievementPointsBase,
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        writeRankingState(transaction, uid, userData, nextState);

        return {
            revision: nextRevision,
            savedAt: Date.now(),
            protocolVersion: SAVE_PROTOCOL_VERSION,
            schemaVersion: GAME_STATE_SCHEMA_VERSION,
            gameState,
        };
    });
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
    const progression = reconcileProgression({
        userData: legacyUserData,
        rankingStateData: data,
        currentGameState: legacyUserData?.gameState,
        historicalAchievementIds,
    });
    return {
        uid,
        ...progression,
        progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
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
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    honorPoints: state.honorPoints,
    achievementPoints: state.achievementPoints,
    achievements: {
        ...asRecord(gameState.achievements),
        unlockedIds: currentAchievementIds([
            ...uniqueStrings(asRecord(gameState.achievements).unlockedIds),
            ...state.unlockedAchievementIds,
            ...state.claimedAchievementIds,
        ]),
        claimedIds: currentAchievementIds(state.claimedAchievementIds),
    },
});

const loadHistoricalAchievementIds = async (uid: string): Promise<string[]> => {
    const snapshot = await db.collection('rankingEvents').where('uid', '==', uid).get();
    return snapshot.docs.flatMap(eventSnapshot => {
        const event = eventSnapshot.data();
        if (event.type !== 'claimAchievement') return [];

        const result = asRecord(event.result);
        return [event.achievementId, result.achievementId];
    });
};

type RecoverySnapshot = {
    gameState: GameState;
    gameStateRevision: number;
};

const loadRecoverySnapshots = async (uid: string): Promise<RecoverySnapshot[]> => {
    const snapshot = await gameStateBackupsRef(uid).get();
    return snapshot.docs
        .map(documentSnapshot => {
            const data = documentSnapshot.data();
            return {
                gameState: asGameState(data.gameState),
                gameStateRevision: finiteInteger(data.gameStateRevision),
            };
        })
        .filter(snapshotData => isValidGameState(snapshotData.gameState));
};

const loadRecoveryGameStates = async (uid: string): Promise<GameState[]> =>
    (await loadRecoverySnapshots(uid)).map(snapshot => snapshot.gameState);

/**
 * Reads and repairs an account before the client is allowed to render, check
 * achievements, or auto-save. This is the single restore entry point for the
 * schema-3 client.
 */
export const loadAccountState = onCall(async request => {
    const uid = requireAuth(request.auth?.uid);
    const userReference = usersRef(uid);
    const preflightUser = await userReference.get();
    if (!preflightUser.exists) {
        return { exists: false };
    }

    const preflightUserData = preflightUser.data() ?? {};
    const needsProgressionMigration = finiteInteger(preflightUserData.progressionProtocolVersion)
        < PROGRESSION_PROTOCOL_VERSION;
    const needsGameStateRecovery = !isValidGameState(preflightUserData.gameState);
    const [historicalAchievementIds, recoverySnapshots, publicRankingSnapshot] = await Promise.all([
        needsProgressionMigration ? loadHistoricalAchievementIds(uid) : Promise.resolve([]),
        needsProgressionMigration || needsGameStateRecovery
            ? loadRecoverySnapshots(uid)
            : Promise.resolve([]),
        needsProgressionMigration ? rankingRef(uid).get() : Promise.resolve(null),
    ]);
    const backupGameStates = recoverySnapshots.map(snapshot => snapshot.gameState);
    const newestValidBackup = [...recoverySnapshots]
        .sort((left, right) => right.gameStateRevision - left.gameStateRevision)[0];

    return db.runTransaction(async transaction => {
        const [userSnapshot, stateSnapshot] = await Promise.all([
            transaction.get(userReference),
            transaction.get(rankingStateRef(uid)),
        ]);
        if (!userSnapshot.exists) return { exists: false };

        const userData = userSnapshot.data() ?? {};
        const currentGameState = asGameState(userData.gameState);
        const hasPrimaryValue = userData.gameState !== null && userData.gameState !== undefined;
        const primaryIsValid = isValidGameState(currentGameState);
        const source = primaryIsValid
            ? 'primary'
            : newestValidBackup
                ? 'backup'
                : hasPrimaryValue
                    ? 'invalid'
                    : 'missing';
        const coreGameState = primaryIsValid
            ? currentGameState
            : newestValidBackup?.gameState ?? null;
        const progression = reconcileProgression({
            userData,
            rankingStateData: stateSnapshot.exists ? stateSnapshot.data() : undefined,
            publicRankingData: publicRankingSnapshot?.exists ? publicRankingSnapshot.data() : undefined,
            currentGameState,
            backupGameStates,
            historicalAchievementIds,
        });
        const canonicalState: RankingState = {
            uid,
            ...progression,
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
        };
        const currentRevision = finiteInteger(userData.gameStateRevision);
        const canonicalGameState = coreGameState
            ? gameStateWithRanking(coreGameState, canonicalState)
            : null;
        const didRepairGameState = canonicalGameState !== null
            && JSON.stringify(canonicalGameState) !== JSON.stringify(userData.gameState);
        const revision = currentRevision + (didRepairGameState ? 1 : 0);

        transaction.set(userReference, {
            ...(canonicalGameState ? {
                gameState: canonicalGameState,
                gameStateRevision: revision,
                gameStateSavedAt: didRepairGameState ? FieldValue.serverTimestamp() : userData.gameStateSavedAt ?? null,
            } : {}),
            saveProtocolVersion: SAVE_PROTOCOL_VERSION,
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
            legacyAchievementPointsBase: canonicalState.legacyAchievementPointsBase,
            honorPoints: canonicalState.honorPoints,
            achievementPoints: canonicalState.achievementPoints,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writeRankingState(transaction, uid, userData, canonicalState);

        const profile = readProfileFromUser(userData);
        return {
            exists: true,
            gameState: canonicalGameState,
            gameStateRevision: revision,
            gameStateSource: source,
            nickname: profile.nickname,
            photoURL: profile.photoURL,
            activeDeviceId: typeof userData.activeDeviceId === 'string' ? userData.activeDeviceId : null,
            honorPoints: canonicalState.honorPoints,
            achievementPoints: canonicalState.achievementPoints,
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
            schemaVersion: GAME_STATE_SCHEMA_VERSION,
        };
    });
});

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
    // The schema-3 client calls loadAccountState before profile projection, so
    // rankingState already contains any migrated event history here.
    const historicalAchievementIds: string[] = [];

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
        const hasProgressionEvidence = isValidGameState(gameState)
            || stateSnapshot.exists
            || historicalAchievementIds.length > 0
            || finiteInteger(userData.honorPoints) > 0
            || finiteInteger(userData.achievementPoints) > 0;

        transaction.set(userReference, {
            profile: { nickname: profile.nickname, photoURL: profile.photoURL },
            ...(hasProgressionEvidence ? {
                honorPoints: state.honorPoints,
                achievementPoints: state.achievementPoints,
                legacyAchievementPointsBase: state.legacyAchievementPointsBase,
                progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
                ...(isValidGameState(gameState) ? { gameState: gameStateWithRanking(gameState, state) } : {}),
            } : {}),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        if (hasProgressionEvidence) {
            writeRankingState(transaction, uid, { ...userData, profile }, state);
        } else {
            transaction.set(rankingRef(uid), rankingDocument(uid, profile, state), { merge: true });
        }
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
        const currentRevision = finiteInteger(userData.gameStateRevision);
        const nextRevision = currentRevision + 1;
        const result: RankingResult = {
            acceptedQuantity: quantity,
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            zenPoints: zenPoints - totalCost,
            revision: nextRevision,
        };

        transaction.set(gameStateBackupRef(uid), {
            gameState,
            gameStateRevision: currentRevision,
            savedAt: FieldValue.serverTimestamp(),
            replacedByDeviceId: null,
            replacedByReason: 'trophy-purchase',
            backupKind: 'latest',
        });
        transaction.set(userReference, {
            gameState: gameStateWithRanking(gameState, nextState, { zenPoints: result.zenPoints }),
            gameStateRevision: nextRevision,
            gameStateSavedAt: FieldValue.serverTimestamp(),
            saveProtocolVersion: SAVE_PROTOCOL_VERSION,
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
            legacyAchievementPointsBase: nextState.legacyAchievementPointsBase,
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
        const state = readRankingState(
            stateSnapshot.exists ? stateSnapshot.data() : undefined,
            uid,
            userData,
        );
        if (state.claimedAchievementIds.includes(achievementId)) {
            return {
                achievementId,
                achievementReward: 0,
                honorPoints: state.honorPoints,
                achievementPoints: state.achievementPoints,
                claimedIds: state.claimedAchievementIds,
                unlockedIds: state.unlockedAchievementIds,
            } satisfies AchievementClaimResult;
        }

        const gameState = asGameState(userData.gameState);
        if (!isValidGameState(gameState)) {
            throw new HttpsError('failed-precondition', '사용자 게임 저장 데이터를 확인할 수 없습니다.');
        }
        if (
            !state.unlockedAchievementIds.includes(achievementId)
            && !achievementConditionMet(achievementId, gameState)
        ) {
            throw new HttpsError('failed-precondition', '현재 서버 저장 상태에서 업적 조건을 확인할 수 없습니다.');
        }

        const claimedAchievementIds = normalizeAchievementIds([
            ...state.claimedAchievementIds,
            achievementId,
        ]);
        const unlockedAchievementIds = normalizeAchievementIds([
            ...state.unlockedAchievementIds,
            achievementId,
        ]);
        const nextState: RankingState = {
            ...state,
            achievementPoints: state.legacyAchievementPointsBase + calculateAchievementPoints(claimedAchievementIds),
            claimedAchievementIds,
            unlockedAchievementIds,
        };
        const result: AchievementClaimResult = {
            achievementId,
            achievementReward: reward.points,
            honorPoints: nextState.honorPoints,
            achievementPoints: nextState.achievementPoints,
            claimedIds: nextState.claimedAchievementIds,
            unlockedIds: nextState.unlockedAchievementIds,
        };

        transaction.set(userReference, {
            gameState: gameStateWithRanking(gameState, nextState),
            saveProtocolVersion: SAVE_PROTOCOL_VERSION,
            progressionProtocolVersion: PROGRESSION_PROTOCOL_VERSION,
            legacyAchievementPointsBase: nextState.legacyAchievementPointsBase,
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
    const [events, backups] = await Promise.all([
        db.collection('rankingEvents').where('uid', '==', uid).get(),
        gameStateBackupsRef(uid).get(),
    ]);
    const references = [
        userReference,
        stateReference,
        publicRankingReference,
        ...events.docs.map(snapshot => snapshot.ref),
        ...backups.docs.map(snapshot => snapshot.ref),
    ];

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
