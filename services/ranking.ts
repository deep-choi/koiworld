import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

type RankingProfile = {
    nickname: string;
    photoURL: string | null;
};

export interface RankingTotals {
    honorPoints: number;
    achievementPoints: number;
    zenPoints?: number;
}

export interface AchievementClaimResult extends RankingTotals {
    achievementId: string;
    achievementReward: number;
    cornReward: number;
    claimedIds: string[];
    unlockedIds: string[];
}

const createEventId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const call = async <Input, Output>(name: string, data: Input): Promise<Output> => {
    const callable = httpsCallable<Input, Output>(functions, name);
    const result = await callable(data);
    return result.data;
};

export const initializeRankingProfile = async (profile: RankingProfile) =>
    call('initializeRankingProfile', profile);

export const updateRankingProfile = async (profile: RankingProfile) =>
    call('updateRankingProfile', profile);

export const purchaseHonorTrophies = async (quantity: number) =>
    call<{ quantity: number; eventId: string }, RankingTotals & { acceptedQuantity: number }>(
        'purchaseHonorTrophies',
        { quantity, eventId: createEventId() },
    );

export const claimAchievement = async (achievementId: string) =>
    call<{ achievementId: string; eventId: string }, AchievementClaimResult>(
        'claimAchievement',
        { achievementId, eventId: createEventId() },
    );

export const deleteAccountData = async () =>
    call<Record<string, never>, { deleted: true }>('deleteAccountData', {});
