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

export interface CloudUserSnapshot {
    userId: string;
    nickname: string | null;
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
        medicine: 0,
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
    const safePhotoURL = normalizePhotoURL(photoURL);

    await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(privateRef);
        const data = snapshot.exists() ? snapshot.data() : null;
        const profile = (data?.profile ?? {}) as { nickname?: string };
        resolvedNickname = profile.nickname?.trim() || fallbackNickname;

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
    const profile = (data.profile ?? {}) as { nickname?: string };
    const gameState = (data.gameState ?? null) as SavedGameState | null;

    return {
        userId,
        nickname: profile.nickname ?? null,
        activeDeviceId: typeof data.activeDeviceId === 'string' ? data.activeDeviceId : null,
        gameState,
        honorPoints: Number(data.honorPoints ?? gameState?.honorPoints ?? 0),
        achievementPoints: Number(data.achievementPoints ?? gameState?.achievementPoints ?? 0),
    };
}

export async function updateUserProfile(userId: string, nickname: string): Promise<void> {
    const currentUser = assertCurrentUser(userId);
    const trimmed = nickname.trim();
    const safePhotoURL = normalizePhotoURL(currentUser.photoURL);
    const rankingSnapshot = await getDoc(rankingDocRef(userId));
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

    const sanitizedGameState = sanitizeForFirestore(gameState);
    const scores = extractGameScores(sanitizedGameState);

    await Promise.all([
        setDoc(userDocRef(userId), {
            gameState: sanitizedGameState,
            ...scores,
            updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(rankingDocRef(userId), {
            uid: userId,
            ...scores,
            updatedAt: serverTimestamp(),
        }, { merge: true }),
    ]);
}

export async function updateUserGameData(
    userId: string,
    gameData: Partial<UserGameData>
): Promise<void> {
    const snapshot = await fetchUserSnapshot(userId);
    const baseState = (snapshot?.gameState ?? {}) as Record<string, unknown>;
    const mergedState = {
        ...baseState,
        ...gameData,
    } as SavedGameState & Record<string, unknown>;

    if (typeof gameData.honorPoints === 'number') {
        mergedState.honorPoints = gameData.honorPoints;
    }
    if (typeof gameData.achievementPoints !== 'number') {
        mergedState.achievementPoints = snapshot?.achievementPoints ?? 0;
    }

    await saveGameState(userId, mergedState as SavedGameState);
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
