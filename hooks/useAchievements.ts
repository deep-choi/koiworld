import { useState, useEffect, useCallback } from 'react';
import { Achievement, AchievementState, Koi } from '../types';
import { ACHIEVEMENTS, checkUnlockableAchievements } from '../utils/achievements';
import { updateUserGameData } from '../services/cloudData';

const createEmptyAchievementState = (): AchievementState => ({
    unlockedIds: [],
    claimedIds: [],
    totalPoints: 0,
    lastChecked: Date.now(),
});

type AchievementSnapshot = {
    unlockedIds?: string[];
    claimedIds?: string[];
};

const uniqueIds = (ids: unknown): string[] => {
    if (!Array.isArray(ids)) return [];
    return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string')));
};

const mergeAchievementSnapshots = (...snapshots: Array<AchievementSnapshot | null | undefined>): AchievementState => {
    const unlockedIds = uniqueIds(snapshots.flatMap(snapshot => snapshot?.unlockedIds ?? []));
    const claimedIds = uniqueIds(snapshots.flatMap(snapshot => snapshot?.claimedIds ?? []));

    // A claimed reward always implies that the achievement was unlocked.
    const mergedUnlockedIds = uniqueIds([...unlockedIds, ...claimedIds]);
    const totalPoints = claimedIds.reduce((sum, id) => {
        const achievement = ACHIEVEMENTS.find(item => item.id === id);
        return sum + (achievement?.reward.achievementPoints || 0);
    }, 0);

    return {
        unlockedIds: mergedUnlockedIds,
        claimedIds,
        totalPoints,
        lastChecked: Date.now(),
    };
};

export const useAchievements = (
    userId: string | undefined,
    initialData?: { unlockedIds: string[]; claimedIds: string[]; } | null
) => {
    const [state, setState] = useState<AchievementState>(() => createEmptyAchievementState());

    const [isLoaded, setIsLoaded] = useState(false);

    const persistLocalState = useCallback((nextState: Pick<AchievementState, 'unlockedIds' | 'claimedIds' | 'totalPoints'>) => {
        if (!userId) return;

        try {
            localStorage.setItem(`koi_garden_achievements_${userId}`, JSON.stringify({
                unlockedIds: nextState.unlockedIds,
                claimedIds: nextState.claimedIds,
                totalPoints: nextState.totalPoints,
            }));
        } catch (e) {
            console.error("Failed to persist achievements locally", e);
        }
    }, [userId]);

    // Load and merge all available sources. Achievement progress is monotonic:
    // an older cloud snapshot must never erase a locally saved achievement.
    useEffect(() => {
        if (!userId) {
            setState(createEmptyAchievementState());
            setIsLoaded(false);
            return;
        }

        const key = `koi_garden_achievements_${userId}`;

        let localData: AchievementSnapshot | null = null;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as AchievementSnapshot;
                localData = {
                    unlockedIds: uniqueIds(parsed.unlockedIds),
                    claimedIds: uniqueIds(parsed.claimedIds),
                };
            } catch (e) {
                console.error("Failed to load achievements", e);
            }
        }

        const nextState = mergeAchievementSnapshots(localData, initialData);
        setState(nextState);
        setIsLoaded(true);
        persistLocalState(nextState);
    }, [userId, initialData, persistLocalState]);

    const saveToCloud = useCallback(async (newState: Partial<AchievementState>) => {
        if (!userId) return;
        try {
            await updateUserGameData(userId, {
                achievementPoints: newState.totalPoints ?? state.totalPoints,
                achievements: {
                    unlockedIds: newState.unlockedIds ?? state.unlockedIds,
                    claimedIds: newState.claimedIds ?? state.claimedIds,
                }
            });
        } catch (e) {
            console.error("Failed to sync achievements to cloud:", e);
        }
    }, [userId, state]);

    const checkAchievements = useCallback((kois: Koi[]) => {
        if (!isLoaded) return [];
        const newUnlocks = checkUnlockableAchievements(kois, state.unlockedIds);

        if (newUnlocks.length > 0) {
            const newIds = newUnlocks.map(a => a.id);
            const nextUnlockedIds = [...state.unlockedIds, ...newIds];
            const nextState = {
                ...state,
                unlockedIds: nextUnlockedIds,
                lastChecked: Date.now(),
            };

            setState(nextState);
            persistLocalState(nextState);

            // Sync to cloud
            void saveToCloud({ unlockedIds: nextUnlockedIds });

            return newUnlocks;
        }
        return [];
    }, [state, isLoaded, persistLocalState, saveToCloud]);

    const claimReward = useCallback(async (achievementId: string, onRewardClaimed?: (reward: Achievement['reward']) => void) => {
        if (!userId || !isLoaded) return;
        if (state.claimedIds.includes(achievementId)) return;
        if (!state.unlockedIds.includes(achievementId)) return;

        const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!achievement) return;

        if (onRewardClaimed) {
            onRewardClaimed(achievement.reward);
        }

        const newTotalPoints = (state.totalPoints || 0) + achievement.reward.achievementPoints;
        const nextClaimedIds = [...state.claimedIds, achievementId];
        const nextState = {
            ...state,
            claimedIds: nextClaimedIds,
            totalPoints: newTotalPoints
        };

        setState(nextState);
        persistLocalState(nextState);

        // Sync to cloud
        void saveToCloud({ claimedIds: nextClaimedIds, totalPoints: newTotalPoints });
    }, [state, userId, isLoaded, persistLocalState, saveToCloud]);

    const getAchievementStatus = useCallback((id: string) => {
        const isUnlocked = state.unlockedIds.includes(id);
        const isClaimed = state.claimedIds.includes(id);
        return { isUnlocked, isClaimed };
    }, [state.unlockedIds, state.claimedIds]);

    const hasUnclaimedRewards = state.unlockedIds.some(id => !state.claimedIds.includes(id));

    return {
        achievements: ACHIEVEMENTS,
        unlockedIds: state.unlockedIds,
        claimedIds: state.claimedIds,
        checkAchievements,
        claimReward,
        getAchievementStatus,
        hasUnclaimedRewards,
        totalPoints: state.totalPoints || 0,
        isLoaded
    };
};
