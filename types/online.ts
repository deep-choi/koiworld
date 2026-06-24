/**
 * 온라인 시스템 관련 타입 정의
 * Firebase 전환 후에도 기존 UI 타입 호환을 위해 유지
 */

import { Koi, PondTheme } from '../types';

export type TimestampLike = string | number | Date | null;

// ============================================
// 1. 사용자 정보 (users/{userId})
// ============================================

/** 사용자 프로필 */
export interface UserProfile {
    nickname: string;
    photoURL?: string | null;
    createdAt: TimestampLike;
    lastLogin: TimestampLike;
}

/** 사용자 게임 데이터 (온라인 저장용) */
export interface UserGameData {
    money: number;           // ZP (인게임 재화)
    food: number;
    corn: number;
    medicine: number;
    theme: PondTheme;
    pondCapacity: number;
    honorPoints?: number;
    achievementPoints?: number; // New: Achievement Score for Ranking
    achievements?: {
        unlockedIds: string[];
        claimedIds: string[];
    };
}

/** 온라인 저장용 잉어 데이터 (Koi 타입에서 런타임 정보 제외) */
export interface SerializedKoi {
    id: string;
    name: string;
    description: string;
    genetics: Koi['genetics'];
    age: number;
    growthStage: 'fry' | 'juvenile' | 'adult';
    timesFed: number;
    stamina?: number;
}

/** 온라인 사용자 스냅샷 구조 */
export interface CloudUserDocument {
    uid?: string;            // 행 ID (식별용)
    profile: UserProfile;
    gameData: UserGameData;
    kois: SerializedKoi[];   // 잉어 배열
}

// ============================================
// 2. 세션 관리 (sessions/{userId})
// ============================================

/** 세션 정보 (동시접속 방지용) */
export interface SessionData {
    deviceId: string;
    lastActive: TimestampLike;
    isOnline: boolean;
}

// ============================================
// 프론트엔드 상태 타입
// ============================================

/** 온라인/오프라인 모드 */
export type GameMode = 'offline' | 'online';

/** 인증 상태 */
export interface AuthState {
    isAuthenticated: boolean;
    userId: string | null;
    displayName: string | null;
    photoURL: string | null;
    isLoading: boolean;
}

/** 온라인 상태 */
export interface OnlineState {
    mode: GameMode;
    isConnected: boolean;
    isSyncing: boolean;
    lastSyncTime: Date | null;
    sessionConflict: boolean;
}
