import { SavedGameState } from '../types';
import {
    fetchUserSnapshot,
    GameStateRevisionConflictError,
    type GameStateSource,
    saveGameState,
    subscribeToUserGameState,
} from './cloudData';
import { isValidSavedGameState } from '../utils/savedGameState';

export { GameStateRevisionConflictError };

export const saveGameToCloud = async (
    userId: string,
    gameState: SavedGameState,
    expectedRevision: number,
    reason: 'auto' | 'new-account' | 'backup-recovery' | 'explicit-reset' = 'auto',
) => {
    return saveGameState(userId, gameState, expectedRevision, reason);
};

export const loadGameFromCloud = async (userId: string): Promise<SavedGameState | null> => {
    const snapshot = await fetchUserSnapshot(userId);
    return isValidSavedGameState(snapshot?.gameState) ? snapshot.gameState : null;
};

export const listenToGameData = (userId: string, onUpdate: (data: SavedGameState, revision: number) => void) => {
    return subscribeToUserGameState(userId, (state, revision) => {
        if (isValidSavedGameState(state)) {
            onUpdate(state, revision);
        }
    });
};

export interface UserDataSnapshot {
    gameData: SavedGameState | null;
    gameDataRevision: number;
    gameDataSource: GameStateSource;
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
        gameDataRevision: data.gameStateRevision,
        gameDataSource: data.gameStateSource,
        nickname: data.nickname || null,
        photoURL: data.photoURL || null,
        activeDeviceId: data.activeDeviceId || null,
        achievements: state?.achievements ? {
            ...state.achievements,
            totalPoints: Number(state.achievementPoints ?? 0),
        } : null,
    };
};
