import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { SavedGameState } from '../types';
import {
    CloudUserDocument,
    UserGameData,
    UserProfile,
} from '../types/online';
import { auth, db, functions } from './firebase';
import { deleteAccountData } from './ranking';
import { isValidSavedGameState } from '../utils/savedGameState';

export interface CloudUserSnapshot {
    userId: string;
    nickname: string | null;
    photoURL: string | null;
    activeDeviceId: string | null;
    gameState: SavedGameState | null;
    gameStateRevision: number;
    gameStateSource: GameStateSource;
    honorPoints: number;
    achievementPoints: number;
}

export type GameStateSource = 'primary' | 'backup' | 'missing' | 'invalid';

export class GameStateRevisionConflictError extends Error {
    readonly code = 'game-state-revision-conflict';

    constructor(
        public readonly expectedRevision: number,
        public readonly actualRevision: number,
    ) {
        super('A newer cloud save exists for this account.');
        this.name = 'GameStateRevisionConflictError';
    }
}

export interface ProfileSnapshot {
    nickname: string | null;
    activeDeviceId: string | null;
    lastLoginAt: unknown;
}

const createPlaceholderTimestamp = () => new Date().toISOString();
const userDocRef = (userId: string) => doc(db, 'users', userId);
const gameStateBackupDocRef = (userId: string) => doc(db, 'users', userId, 'gameStateBackups', 'latest');
const rankingDocRef = (userId: string) => doc(db, 'rankings', userId);

const normalizeGameStateRevision = (value: unknown): number => {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
};

const assertCurrentUser = (userId: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== userId) {
        throw new Error('Authenticated Firebase user does not match the requested profile.');
    }
    return currentUser;
};

const buildDefaultNickname = (userId: string, displayName?: string | null, email?: string | null) => {
    const name = displayName?.trim();
    if (name) return name;

    const emailPrefix = email?.split('@')?.[0]?.trim();
    if (emailPrefix) return emailPrefix;

    return `Koi_${userId.slice(0, 6)}`;
};

const normalizePhotoURL = (photoURL?: string | null) => {
    const trimmed = photoURL?.trim();
    if (!trimmed) return null;
    return trimmed.replace(/^http:\/\//i, 'https://');
};

const toRankingDocument = (userId: string, data: Record<string, any>): CloudUserDocument => ({
    uid: userId,
    profile: {
        nickname: data.nickname || `Koi_${userId.slice(0, 6)}`,
        photoURL: normalizePhotoURL(data.photoURL),
        createdAt: createPlaceholderTimestamp() as UserProfile['createdAt'],
        lastLogin: createPlaceholderTimestamp() as UserProfile['lastLogin'],
    },
    gameData: {
        money: 0,
        food: 0,
        corn: 0,
        theme: '기본 (맑은 물)' as UserGameData['theme'],
        pondCapacity: 0,
        honorPoints: Number(data.honorPoints || 0),
        achievementPoints: Number(data.achievementPoints || 0),
    },
    kois: [],
});

export async function ensureUserDocument(
    userId: string,
    displayName?: string | null,
    email?: string | null,
    photoURL?: string | null,
): Promise<string> {
    assertCurrentUser(userId);

    const fallbackNickname = buildDefaultNickname(userId, displayName, email);
    const privateRef = userDocRef(userId);
    const publicRef = rankingDocRef(userId);
    let resolvedNickname = fallbackNickname;
    let safePhotoURL = normalizePhotoURL(photoURL);

    await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(privateRef);
        const data = snapshot.exists() ? snapshot.data() : null;
        const profile = (data?.profile ?? {}) as { nickname?: string; photoURL?: string | null };
        const existingPhotoURL = profile.photoURL ?? null;
        const existingNickname = profile.nickname?.trim();
        const displayNickname = displayName?.trim();
        const emailPrefix = email?.split('@')?.[0]?.trim();
        const shouldUseDisplayName =
            !!displayNickname &&
            !!existingNickname &&
            !!emailPrefix &&
            existingNickname === emailPrefix;

        resolvedNickname = shouldUseDisplayName
            ? displayNickname
            : existingNickname || fallbackNickname;

        // Keep a user-selected profile image across auth/session reinitialization.
        safePhotoURL = normalizePhotoURL(existingPhotoURL || photoURL);

        // The current client's saved game is authoritative. The public
        // ranking document is only a projection and must not resurrect an
        // older score during account initialization.
        const honorPoints = Number(data?.gameState?.honorPoints ?? data?.honorPoints ?? 0);
        const achievementPoints = Number(data?.gameState?.achievementPoints ?? data?.achievementPoints ?? 0);

        transaction.set(privateRef, {
            profile: {
                nickname: resolvedNickname,
                photoURL: safePhotoURL,
                createdAt: data?.profile?.createdAt ?? serverTimestamp(),
                lastLogin: serverTimestamp(),
            },
            updatedAt: serverTimestamp(),
        }, { merge: true });

        transaction.set(publicRef, {
            uid: userId,
            nickname: resolvedNickname,
            photoURL: safePhotoURL,
            honorPoints,
            achievementPoints,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });

    return resolvedNickname;
}

export async function fetchUserSnapshot(userId: string): Promise<CloudUserSnapshot | null> {
    assertCurrentUser(userId);

    const snapshot = await getDoc(userDocRef(userId));
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    const profile = (data.profile ?? {}) as { nickname?: string; photoURL?: string | null };
    const savedGameState = (data.gameState ?? null) as SavedGameState | null;
    const gameStateRevision = normalizeGameStateRevision(data.gameStateRevision);
    let gameState = isValidSavedGameState(savedGameState) ? savedGameState : null;
    let gameStateSource: GameStateSource = gameState
        ? 'primary'
        : savedGameState === null
            ? 'missing'
            : 'invalid';

    // A backup is intentionally read only when the primary snapshot cannot
    // be used. Normal login remains a single document read, while a corrupt
    // or missing primary can recover without treating the account as new.
    if (!gameState) {
        try {
            const backupSnapshot = await getDoc(gameStateBackupDocRef(userId));
            const backupGameState = backupSnapshot.exists()
                ? backupSnapshot.data().gameState
                : null;
            if (isValidSavedGameState(backupGameState)) {
                gameState = backupGameState;
                gameStateSource = 'backup';
            }
        } catch (error) {
            console.warn('Failed to read game state backup:', error);
        }
    }

    const honorPoints = Number(savedGameState?.honorPoints ?? data.honorPoints ?? 0);
    const achievementPoints = Number(savedGameState?.achievementPoints ?? data.achievementPoints ?? 0);

    return {
        userId,
        nickname: profile.nickname ?? null,
        photoURL: normalizePhotoURL(profile.photoURL),
        activeDeviceId: typeof data.activeDeviceId === 'string' ? data.activeDeviceId : null,
        gameState,
        gameStateRevision,
        gameStateSource,
        honorPoints,
        achievementPoints,
    };
}

export async function updateUserProfile(userId: string, nickname: string, photoURL?: string | null): Promise<void> {
    const currentUser = assertCurrentUser(userId);
    const trimmed = nickname.trim();
    const profileSnapshot = await getDoc(userDocRef(userId));
    const profileData = profileSnapshot.exists() ? profileSnapshot.data() : {};
    const existingPhotoURL = profileSnapshot.exists()
        ? (profileData.profile?.photoURL as string | null | undefined)
        : undefined;
    const resolvedPhotoURL = photoURL === undefined ? (existingPhotoURL ?? currentUser.photoURL) : photoURL;
    const safePhotoURL = normalizePhotoURL(resolvedPhotoURL);
    const honorPoints = Number(profileData.gameState?.honorPoints ?? profileData.honorPoints ?? 0);
    const achievementPoints = Number(profileData.gameState?.achievementPoints ?? profileData.achievementPoints ?? 0);

    await setDoc(userDocRef(userId), {
        profile: {
            nickname: trimmed,
            photoURL: safePhotoURL,
            lastLogin: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
    }, { merge: true });

    await setDoc(rankingDocRef(userId), {
        uid: userId,
        nickname: trimmed,
        photoURL: safePhotoURL,
        honorPoints,
        achievementPoints,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

export async function updateUserSession(userId: string, activeDeviceId: string, touchLastLogin = true): Promise<void> {
    assertCurrentUser(userId);

    await setDoc(userDocRef(userId), {
        activeDeviceId,
        ...(touchLastLogin ? { profile: { lastLogin: serverTimestamp() } } : {}),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

export async function deleteUserData(userId: string): Promise<void> {
    assertCurrentUser(userId);
    await deleteAccountData();
}

export function subscribeToUserProfile(
    userId: string,
    onUpdate: (profile: ProfileSnapshot | null) => void,
): () => void {
    assertCurrentUser(userId);

    return onSnapshot(userDocRef(userId), (snapshot) => {
        if (!snapshot.exists()) {
            onUpdate(null);
            return;
        }

        const data = snapshot.data();
        const profile = (data.profile ?? {}) as { nickname?: string; lastLogin?: unknown };
        onUpdate({
            nickname: profile.nickname ?? null,
            activeDeviceId: typeof data.activeDeviceId === 'string' ? data.activeDeviceId : null,
            lastLoginAt: profile.lastLogin ?? null,
        });
    });
}

export function subscribeToUserGameState(
    userId: string,
    onUpdate: (state: SavedGameState | null, revision: number) => void,
): () => void {
    assertCurrentUser(userId);

    return onSnapshot(userDocRef(userId), (snapshot) => {
        if (!snapshot.exists()) {
            onUpdate(null, 0);
            return;
        }
        const data = snapshot.data();
        const gameState = (data.gameState ?? null) as SavedGameState | null;
        if (!gameState) {
            onUpdate(null, normalizeGameStateRevision(data.gameStateRevision));
            return;
        }
        onUpdate(gameState, normalizeGameStateRevision(data.gameStateRevision));
    });
}

export async function saveGameState(
    userId: string,
    gameState: SavedGameState,
    expectedRevision: number,
    reason: 'auto' | 'new-account' | 'backup-recovery' | 'explicit-reset' = 'auto',
): Promise<number> {
    assertCurrentUser(userId);
    if (!isValidSavedGameState(gameState)) {
        throw new Error('Invalid game state cannot be saved.');
    }

    const callable = httpsCallable<{
        gameState: SavedGameState;
        expectedRevision: number;
        deviceId: string | null;
        reason: 'auto' | 'new-account' | 'backup-recovery' | 'explicit-reset';
    }, {
        revision: number;
        savedAt: number;
        protocolVersion: number;
    }>(functions, 'saveGameState');

    try {
        const result = await callable({
            gameState,
            expectedRevision,
            reason,
            deviceId: typeof window !== 'undefined'
                ? window.localStorage.getItem('koiworld_device_id')
                : null,
        });
        return normalizeGameStateRevision(result.data.revision);
    } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error
            ? String((error as { code?: string }).code ?? '')
            : '';
        const details = typeof error === 'object' && error && 'details' in error
            ? (error as { details?: { expectedRevision?: unknown; actualRevision?: unknown } }).details
            : undefined;

        if (code === 'functions/aborted') {
            throw new GameStateRevisionConflictError(
                normalizeGameStateRevision(details?.expectedRevision ?? expectedRevision),
                normalizeGameStateRevision(details?.actualRevision),
            );
        }
        throw error;
    }
}

export async function getRankings(
    sortBy: 'honorPoints' | 'achievementPoints' = 'honorPoints',
    limitCount = 20
): Promise<CloudUserDocument[]> {
    const rankingQuery = query(
        collection(db, 'rankings'),
        orderBy(sortBy, 'desc'),
        limit(limitCount),
    );
    const snapshot = await getDocs(rankingQuery);
    return snapshot.docs.map((ranking) => toRankingDocument(ranking.id, ranking.data()));
}

export async function getTopRankings(limitCount = 20): Promise<CloudUserDocument[]> {
    return getRankings('honorPoints', limitCount);
}
