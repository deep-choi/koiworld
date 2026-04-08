import { SavedGameState } from '../types';
import { fetchMyUserSnapshot, saveGameState, subscribeToMyGameState } from './supabase';

// 클라우드에 게임 데이터 저장
export const saveGameToCloud = async (_userId: string, gameState: SavedGameState) => {
    const sanitizedGameState = JSON.parse(JSON.stringify(gameState));
    await saveGameState(sanitizedGameState);
};

// 클라우드에서 게임 데이터 불러오기
export const loadGameFromCloud = async (_userId: string): Promise<SavedGameState | null> => {
    const snapshot = await fetchMyUserSnapshot();
    return snapshot?.gameState ?? null;
};

// 실시간 데이터 동기화 리스너 (선택 사항)
// 다른 기기에서 저장했을 때 내 기기에 반영하려면 사용
export const listenToGameData = (userId: string, onUpdate: (data: SavedGameState) => void) => {
    let unsubscribe = () => {};
    void subscribeToMyGameState(userId, (state) => {
        if (state) {
            onUpdate(state);
        }
    }).then((cleanup) => {
        unsubscribe = cleanup;
    }).catch((error) => {
        console.error('Failed to subscribe to Supabase game state:', error);
    });

    return () => unsubscribe();
};

// 사용자 데이터 통합 로드 (로그인 시 1회 호출하여 모든 데이터를 한번에 가져옴)
export interface UserDataSnapshot {
    gameData: SavedGameState | null;
    nickname: string | null;
    ap: number;
    activeDeviceId: string | null;
    achievements?: {
        unlockedIds: string[];
        claimedIds: string[];
    };
}

export const loadUserDataOnce = async (_userId: string): Promise<UserDataSnapshot | null> => {
    const data = await fetchMyUserSnapshot();
    if (!data) return null;

    const state = data.gameState as (SavedGameState & {
        achievements?: {
            unlockedIds: string[];
            claimedIds: string[];
        };
    }) | null;

    return {
        gameData: state || null,
        nickname: data.nickname || null,
        ap: typeof data.ap === 'number' ? data.ap : 0,
        activeDeviceId: data.activeDeviceId || null,
        achievements: state?.achievements || null,
    };
};
