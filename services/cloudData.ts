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
import { deleteAccountData } from './ranking';
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
const maxProgressValue = (...values: unknown[]): number => values.reduce<number>((highest, value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0
        ? Math.max(highest, numericValue)
        : highest;
}, 0);
const normalizeAchievementIds = (value: unknown): string[] => Array.isArray(value)
    ? Array.from(new Set(value.filter((id): id is string => typeof id === 'string')))
    : [];
const mergeSavedAchievements = (
    ...snapshots: Array<SavedGameState['achievements'] | null | undefined>
): NonNullable<SavedGameState['achievements']> => {
    const unlockedIds = normalizeAchievementIds(snapshots.flatMap(snapshot => snapshot?.unlockedIds ?? []));
    const claimedIds = normalizeAchievementIds(snapshots.flatMap(snapshot => snapshot?.claimedIds ?? []));
    return {
        unlockedIds: normalizeAchievementIds([...unlockedIds, ...claimedIds]),
        claimedIds,
    };
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
        const rankingSnapshot = await transaction.get(publicRef);
        const data = snapshot.exists() ? snapshot.data() : null;
        const rankingData = rankingSnapshot.exists() ? rankingSnapshot.data() : null;
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

        const honorPoints = maxProgressValue(
            rankingData?.honorPoints,
            data?.honorPoints,
            data?.gameState?.honorPoints,
        );
        const achievementPoints = maxProgressValue(
            rankingData?.achievementPoints,
            data?.achievementPoints,
            data?.gameState?.achievementPoints,
        );

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

    const [snapshot, rankingSnapshot] = await Promise.all([
        getDoc(userDocRef(userId)),
        getDoc(rankingDocRef(userId)),
    ]);
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    const rankingData = rankingSnapshot.exists() ? rankingSnapshot.data() : {};
    const profile = (data.profile ?? {}) as { nickname?: string; photoURL?: string | null };
    const savedGameState = (data.gameState ?? null) as SavedGameState | null;
    const honorPoints = maxProgressValue(
        rankingData.honorPoints,
        data.honorPoints,
        savedGameState?.honorPoints,
    );
    const achievementPoints = maxProgressValue(
        rankingData.achievementPoints,
        data.achievementPoints,
        savedGameState?.achievementPoints,
    );
    const gameState = savedGameState ? {
        ...savedGameState,
        honorPoints,
        achievementPoints,
    } : null;

    return {
        userId,
        nickname: profile.nickname ?? null,
        photoURL: normalizePhotoURL(profile.photoURL),
        activeDeviceId: typeof data.activeDeviceId === 'string' ? data.activeDeviceId : null,
        gameState,
        honorPoints,
        achievementPoints,
    };
}

export async function updateUserProfile(userId: string, nickname: string, photoURL?: string | null): Promise<void> {
    const currentUser = assertCurrentUser(userId);
    const trimmed = nickname.trim();
    const [profileSnapshot, rankingSnapshot] = await Promise.all([
        getDoc(userDocRef(userId)),
        getDoc(rankingDocRef(userId)),
    ]);
    const profileData = profileSnapshot.exists() ? profileSnapshot.data() : {};
    const existingPhotoURL = profileSnapshot.exists()
        ? (profileData.profile?.photoURL as string | null | undefined)
        : undefined;
    const resolvedPhotoURL = photoURL === undefined ? (existingPhotoURL ?? currentUser.photoURL) : photoURL;
    const safePhotoURL = normalizePhotoURL(resolvedPhotoURL);
    const rankingData = rankingSnapshot.exists() ? rankingSnapshot.data() : {};
    const honorPoints = maxProgressValue(
        rankingData.honorPoints,
        profileData.honorPoints,
        profileData.gameState?.honorPoints,
    );
    const achievementPoints = maxProgressValue(
        rankingData.achievementPoints,
        profileData.achievementPoints,
        profileData.gameState?.achievementPoints,
    );

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
    onUpdate: (state: SavedGameState | null) => void,
): () => void {
    assertCurrentUser(userId);

    return onSnapshot(userDocRef(userId), (snapshot) => {
        if (!snapshot.exists()) {
            onUpdate(null);
            return;
        }
        const data = snapshot.data();
        const gameState = (data.gameState ?? null) as SavedGameState | null;
        if (!gameState) {
            onUpdate(null);
            return;
        }
        onUpdate({
            ...gameState,
            honorPoints: maxProgressValue(data.honorPoints, gameState.honorPoints),
            achievementPoints: maxProgressValue(data.achievementPoints, gameState.achievementPoints),
        });
    });
}

export async function saveGameState(userId: string, gameState: SavedGameState): Promise<void> {
    assertCurrentUser(userId);
    if (!isValidSavedGameState(gameState)) {
        throw new Error('Invalid game state cannot be saved.');
    }

    const sanitizedGameState = sanitizeForFirestore(gameState);
    const privateRef = userDocRef(userId);
    const publicRef = rankingDocRef(userId);

    await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(privateRef);
        const rankingSnapshot = await transaction.get(publicRef);
        const data = snapshot.exists() ? snapshot.data() : {};
        const rankingData = rankingSnapshot.exists() ? rankingSnapshot.data() : {};
        const profile = (data.profile ?? {}) as { nickname?: string; photoURL?: string | null };
        const existingGameState = (data.gameState ?? null) as SavedGameState | null;
        const honorPoints = maxProgressValue(
            sanitizedGameState.honorPoints,
            existingGameState?.honorPoints,
            data.honorPoints,
            rankingData.honorPoints,
        );
        const achievementPoints = maxProgressValue(
            sanitizedGameState.achievementPoints,
            existingGameState?.achievementPoints,
            data.achievementPoints,
            rankingData.achievementPoints,
        );
        const nextGameState: SavedGameState = {
            ...sanitizedGameState,
            honorPoints,
            achievementPoints,
            achievements: mergeSavedAchievements(
                existingGameState?.achievements,
                sanitizedGameState.achievements,
            ),
        };

        transaction.set(privateRef, {
            gameState: nextGameState,
            honorPoints,
            achievementPoints,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.set(publicRef, {
            uid: userId,
            nickname: profile.nickname || `Koi_${userId.slice(0, 6)}`,
            photoURL: normalizePhotoURL(profile.photoURL),
            honorPoints,
            achievementPoints,
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
