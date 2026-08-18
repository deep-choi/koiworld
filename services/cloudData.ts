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
import {
    deleteAccountData,
    initializeRankingProfile,
    updateRankingProfile,
} from './ranking';
import { normalizeSavedGameState } from '../utils/savedGameState';

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

        transaction.set(privateRef, {
            profile: {
                nickname: resolvedNickname,
                photoURL: safePhotoURL,
                createdAt: data?.profile?.createdAt ?? serverTimestamp(),
                lastLogin: serverTimestamp(),
            },
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });

    // Public ranking documents are server projections. Profile changes are
    // sent through a callable so clients cannot write ranking totals directly.
    await initializeRankingProfile({ nickname: resolvedNickname, photoURL: safePhotoURL });

    return resolvedNickname;
}

export async function fetchUserSnapshot(userId: string): Promise<CloudUserSnapshot | null> {
    assertCurrentUser(userId);
    const callable = httpsCallable<Record<string, never>, {
        exists: boolean;
        gameState?: SavedGameState | null;
        gameStateRevision?: number;
        gameStateSource?: GameStateSource;
        nickname?: string | null;
        photoURL?: string | null;
        activeDeviceId?: string | null;
        honorPoints?: number;
        achievementPoints?: number;
    }>(functions, 'loadAccountState');
    const result = await callable({});
    if (!result.data.exists) return null;
    const gameState = normalizeSavedGameState(result.data.gameState);

    return {
        userId,
        nickname: result.data.nickname ?? null,
        photoURL: normalizePhotoURL(result.data.photoURL),
        activeDeviceId: result.data.activeDeviceId ?? null,
        gameState,
        gameStateRevision: normalizeGameStateRevision(result.data.gameStateRevision),
        gameStateSource: result.data.gameStateSource ?? (gameState ? 'primary' : 'missing'),
        honorPoints: Number(result.data.honorPoints ?? gameState?.honorPoints ?? 0),
        achievementPoints: Number(result.data.achievementPoints ?? gameState?.achievementPoints ?? 0),
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
    await setDoc(userDocRef(userId), {
        profile: {
            nickname: trimmed,
            photoURL: safePhotoURL,
            lastLogin: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
    }, { merge: true });
    await updateRankingProfile({ nickname: trimmed, photoURL: safePhotoURL });
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
        const gameState = normalizeSavedGameState(data.gameState);
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
    const normalizedGameState = normalizeSavedGameState(gameState);
    if (!normalizedGameState) {
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
            gameState: normalizedGameState,
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
