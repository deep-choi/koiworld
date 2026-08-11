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
import { SavedGameState } from '../types';
import {
    CloudUserDocument,
    UserGameData,
    UserProfile,
} from '../types/online';
import { auth, db } from './firebase';
import {
    deleteAccountData,
    initializeRankingProfile,
    updateRankingProfile,
} from './ranking';
import { isValidSavedGameState } from '../utils/savedGameState';

export interface CloudUserSnapshot {
    userId: string;
    nickname: string | null;
    photoURL: string | null;
    activeDeviceId: string | null;
    gameState: SavedGameState | null;
    honorPoints: number;
    achievementPoints: number;
}

export interface ProfileSnapshot {
    nickname: string | null;
    activeDeviceId: string | null;
    lastLoginAt: unknown;
}

const createPlaceholderTimestamp = () => new Date().toISOString();
const userDocRef = (userId: string) => doc(db, 'users', userId);
const sanitizeForFirestore = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

    // Ranking documents are server-owned. The callable creates or updates the
    // public document without exposing a client write path to score fields.
    try {
        await initializeRankingProfile({ nickname: resolvedNickname, photoURL: safePhotoURL });
    } catch (error) {
        console.warn('Ranking profile initialization is unavailable:', error);
    }

    return resolvedNickname;
}

export async function fetchUserSnapshot(userId: string): Promise<CloudUserSnapshot | null> {
    assertCurrentUser(userId);

    const snapshot = await getDoc(userDocRef(userId));
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    const profile = (data.profile ?? {}) as { nickname?: string; photoURL?: string | null };
    const gameState = (data.gameState ?? null) as SavedGameState | null;

    return {
        userId,
        nickname: profile.nickname ?? null,
        photoURL: normalizePhotoURL(profile.photoURL),
        activeDeviceId: typeof data.activeDeviceId === 'string' ? data.activeDeviceId : null,
        gameState,
        honorPoints: Number(data.honorPoints ?? gameState?.honorPoints ?? 0),
        achievementPoints: Number(data.achievementPoints ?? gameState?.achievementPoints ?? 0),
    };
}

export async function updateUserProfile(userId: string, nickname: string, photoURL?: string | null): Promise<void> {
    const currentUser = assertCurrentUser(userId);
    const trimmed = nickname.trim();
    const profileSnapshot = await getDoc(userDocRef(userId));
    const existingPhotoURL = profileSnapshot.exists()
        ? (profileSnapshot.data()?.profile?.photoURL as string | null | undefined)
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
    onUpdate: (state: SavedGameState | null) => void,
): () => void {
    assertCurrentUser(userId);

    return onSnapshot(userDocRef(userId), (snapshot) => {
        if (!snapshot.exists()) {
            onUpdate(null);
            return;
        }
        onUpdate((snapshot.data().gameState ?? null) as SavedGameState | null);
    });
}

export async function saveGameState(userId: string, gameState: SavedGameState): Promise<void> {
    assertCurrentUser(userId);
    if (!isValidSavedGameState(gameState)) {
        throw new Error('Invalid game state cannot be saved.');
    }

    const sanitizedGameState = sanitizeForFirestore(gameState);
    const privateRef = userDocRef(userId);

    await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(privateRef);
        const existingGameState = snapshot.exists()
            ? snapshot.data().gameState as SavedGameState | undefined
            : undefined;
        // Score and achievement fields are server-owned. Keep the client's
        // local copy for rendering, but never allow a normal game-state save to
        // change those fields in Firestore.
        const {
            honorPoints: _honorPoints,
            achievementPoints: _achievementPoints,
            achievements: _achievements,
            ...mutableGameState
        } = sanitizedGameState;
        const existingProtectedState = existingGameState ?? {} as SavedGameState;
        const nextGameState: SavedGameState = {
            ...mutableGameState,
            ...(typeof existingProtectedState.honorPoints === 'number'
                ? { honorPoints: existingProtectedState.honorPoints }
                : {}),
            ...(typeof existingProtectedState.achievementPoints === 'number'
                ? { achievementPoints: existingProtectedState.achievementPoints }
                : {}),
            ...(existingProtectedState.achievements
                ? { achievements: existingProtectedState.achievements }
                : {}),
        };

        transaction.set(privateRef, {
            gameState: nextGameState,
            updatedAt: serverTimestamp(),
        }, { merge: true });

    });
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
