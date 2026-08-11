import { SavedGameState } from '../types';
import { fetchUserSnapshot, saveGameState, subscribeToUserGameState } from './cloudData';
import { isValidSavedGameState } from '../utils/savedGameState';

export const saveGameToCloud = async (userId: string, gameState: SavedGameState) => {
    await saveGameState(userId, gameState);
};

export const loadGameFromCloud = async (userId: string): Promise<SavedGameState | null> => {
    const snapshot = await fetchUserSnapshot(userId);
    return isValidSavedGameState(snapshot?.gameState) ? snapshot.gameState : null;
};

export const listenToGameData = (userId: string, onUpdate: (data: SavedGameState) => void) => {
    return subscribeToUserGameState(userId, (state) => {
        if (isValidSavedGameState(state)) {
            onUpdate(state);
        }
    });
};

export interface UserDataSnapshot {
    gameData: SavedGameState | null;
    nickname: string | null;
    photoURL: string | null;
    activeDeviceId: string | null;
    achievements?: {
        unlockedIds: string[];
        claimedIds: string[];
        totalPoints?: number;
    };
}

export const loadUserDataOnce = async (userId: string): Promise<UserDataSnapshot | null> => {
    const data = await fetchUserSnapshot(userId);
    if (!data) return null;

    const state = isValidSavedGameState(data.gameState)
        ? (data.gameState as SavedGameState & {
            achievements?: {
                unlockedIds: string[];
                claimedIds: string[];
            };
        })
        : null;

    return {
        gameData: state || null,
        nickname: data.nickname || null,
        photoURL: data.photoURL || null,
        activeDeviceId: data.activeDeviceId || null,
        achievements: state?.achievements ? {
            ...state.achievements,
            totalPoints: Math.max(
                Number(state.achievementPoints ?? 0),
                Number(data.achievementPoints ?? 0),
            ),
        } : null,
    };
};
