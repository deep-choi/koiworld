import { SavedGameState } from '../types';
import {
    CloudUserDocument,
    UserGameData,
    UserProfile,
} from '../types/online';
import {
    fetchMyUserSnapshot,
    fetchRankings as fetchSupabaseRankings,
    getCurrentUser,
    saveGameState,
} from './supabase';

const createPlaceholderTimestamp = () => new Date().toISOString();

const toRankingDocument = (row: {
    user_id: string;
    nickname: string;
    honor_points: number;
    achievement_points: number;
    ap_balance: number;
}): CloudUserDocument => ({
    uid: row.user_id,
    profile: {
        nickname: row.nickname,
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
        honorPoints: row.honor_points,
        achievementPoints: row.achievement_points,
    },
    ap: row.ap_balance,
    kois: [],
});

export async function updateUserGameData(
    userId: string,
    gameData: Partial<UserGameData>
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
        throw new Error('Authenticated Supabase user does not match the requested profile.');
    }

    const snapshot = await fetchMyUserSnapshot();
    const baseState = (snapshot?.gameState ?? {}) as Record<string, unknown>;
    const mergedState = {
        ...baseState,
        ...gameData,
    } as SavedGameState & Record<string, unknown>;

    if (typeof gameData.honorPoints === 'number') {
        mergedState.honorPoints = gameData.honorPoints;
    }

    await saveGameState(
        mergedState as SavedGameState,
        typeof gameData.achievementPoints === 'number'
            ? gameData.achievementPoints
            : (snapshot?.achievementPoints ?? 0)
    );
}

export async function getRankings(
    sortBy: 'honorPoints' | 'achievementPoints' = 'honorPoints',
    limitCount = 20
): Promise<CloudUserDocument[]> {
    const rows = await fetchSupabaseRankings(sortBy, limitCount);
    return rows.map(toRankingDocument);
}

export async function getTopRankings(limitCount = 20): Promise<CloudUserDocument[]> {
    return getRankings('honorPoints', limitCount);
}
