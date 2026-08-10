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
const rankingDocRef = (userId: string) => doc(db, 'rankings', userId);
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

const extractGameScores = (gameState: SavedGameState) => ({
    honorPoints: Number(gameState.honorPoints || 0),
    achievementPoints: Number(gameState.achievementPoints || 0),
});

const mergeAchievementProgress = (
    existing: SavedGameState['achievements'] | undefined,
    incoming: SavedGameState['achievements'] | undefined,
): SavedGameState['achievements'] | undefined => {
    if (!existing && !incoming) return undefined;

    const unlockedIds = Array.from(new Set([
        ...(existing?.unlockedIds ?? []),
        ...(incoming?.unlockedIds ?? []),
    ]));
    const claimedIds = Array.from(new Set([
        ...(existing?.claimedIds ?? []),
        ...(incoming?.claimedIds ?? []),
    ]));

    return {
        // A claimed reward is also permanently unlocked.
        unlockedIds: Array.from(new Set([...unlockedIds, ...claimedIds])),
        claimedIds,
    };
};

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

        const honorPoints = Number(data?.honorPoints || data?.gameState?.honorPoints || 0);
        const achievementPoints = Number(data?.achievementPoints || data?.gameState?.achievementPoints || 0);

        transaction.set(privateRef, {
            profile: {
                nickname: resolvedNickname,
                photoURL: safePhotoURL,
                createdAt: data?.profile?.createdAt ?? serverTimestamp(),
                lastLogin: serverTimestamp(),
            },
            honorPoints,
            achievementPoints,
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
    const [profileSnapshot, rankingSnapshot] = await Promise.all([
        getDoc(userDocRef(userId)),
        getDoc(rankingDocRef(userId)),
    ]);
    const existingPhotoURL = profileSnapshot.exists()
        ? (profileSnapshot.data()?.profile?.photoURL as string | null | undefined)
        : undefined;
    const resolvedPhotoURL = photoURL === undefined ? (existingPhotoURL ?? currentUser.photoURL) : photoURL;
    const safePhotoURL = normalizePhotoURL(resolvedPhotoURL);
    const rankingData = rankingSnapshot.exists() ? rankingSnapshot.data() : {};
    const honorPoints = Number(rankingData.honorPoints || 0);
    const achievementPoints = Number(rankingData.achievementPoints || 0);

    await Promise.all([
        setDoc(userDocRef(userId), {
            profile: {
                nickname: trimmed,
                photoURL: safePhotoURL,
                lastLogin: serverTimestamp(),
            },
            updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(rankingDocRef(userId), {
            uid: userId,
            nickname: trimmed,
            photoURL: safePhotoURL,
            honorPoints,
            achievementPoints,
            updatedAt: serverTimestamp(),
        }, { merge: true }),
    ]);
}

export async function updateUserSession(userId: string, activeDeviceId: string, touchLastLogin = true): Promise<void> {
    assertCurrentUser(userId);

    await setDoc(userDocRef(userId), {
        activeDeviceId,
        ...(touchLastLogin ? { profile: { lastLogin: serverTimestamp() } } : {}),
        updatedAt: serverTimestamp(),
    }, { merge: true });
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

    const mergedGameState = await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(privateRef);
        const existingGameState = snapshot.exists()
            ? snapshot.data().gameState as SavedGameState | undefined
            : undefined;
        const mergedAchievements = mergeAchievementProgress(
            existingGameState?.achievements,
            sanitizedGameState.achievements,
        );
        const nextGameState: SavedGameState = mergedAchievements
            ? { ...sanitizedGameState, achievements: mergedAchievements }
            : sanitizedGameState;
        const scores = extractGameScores(nextGameState);

        transaction.set(privateRef, {
            gameState: nextGameState,
            ...scores,
            updatedAt: serverTimestamp(),
        }, { merge: true });

        return nextGameState;
    });

    const scores = extractGameScores(mergedGameState);
    await setDoc(rankingDocRef(userId), {
        uid: userId,
        ...scores,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

export async function updateUserGameData(
    userId: string,
    gameData: Partial<UserGameData>
): Promise<void> {
    const snapshot = await fetchUserSnapshot(userId);
    const currentState = isValidSavedGameState(snapshot?.gameState) ? snapshot.gameState : null;
    const honorPoints = typeof gameData.honorPoints === 'number'
        ? gameData.honorPoints
        : Number(snapshot?.honorPoints ?? currentState?.honorPoints ?? 0);
    const achievementPoints = typeof gameData.achievementPoints === 'number'
        ? gameData.achievementPoints
        : Number(snapshot?.achievementPoints ?? currentState?.achievementPoints ?? 0);

    if (currentState) {
        await saveGameState(userId, {
            ...currentState,
            honorPoints,
            achievementPoints,
            achievements: gameData.achievements ?? currentState.achievements,
        });
        return;
    }

    await Promise.all([
        setDoc(userDocRef(userId), {
            honorPoints,
            achievementPoints,
            updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(rankingDocRef(userId), {
            uid: userId,
            honorPoints,
            achievementPoints,
            updatedAt: serverTimestamp(),
        }, { merge: true }),
    ]);
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
