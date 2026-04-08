import { useState, useEffect, useCallback } from 'react';
import { Achievement, AchievementState, Koi } from '../types';
import { ACHIEVEMENTS, checkUnlockableAchievements } from '../utils/achievements';
import { updateUserGameData } from '../services/cloudData';

export const useAchievements = (
    userId: string | undefined,
    initialData?: { unlockedIds: string[]; claimedIds: string[]; } | null
) => {
    const [state, setState] = useState<AchievementState>({
        unlockedIds: [],
        claimedIds: [],
        totalPoints: 0,
        lastChecked: Date.now(),
    });

    const [isLoaded, setIsLoaded] = useState(false);

    // Load initial data (Priority: cloud snapshot > localStorage)
    useEffect(() => {
        if (!userId) {
            setIsLoaded(false);
            return;
        }

        const key = `koi_garden_achievements_${userId}`;

        if (initialData) {
            // Load from cloud data passed from App.tsx
            const total = initialData.claimedIds.reduce((sum, id) => {
                const ach = ACHIEVEMENTS.find(a => a.id === id);
                return sum + (ach?.reward.achievementPoints || 0);
            }, 0);

            setState({
                unlockedIds: initialData.unlockedIds,
                claimedIds: initialData.claimedIds,
                totalPoints: total,
                lastChecked: Date.now(),
            });
            setIsLoaded(true);

            // Migration: Keep local storage in sync as secondary backup
            localStorage.setItem(key, JSON.stringify({
                unlockedIds: initialData.unlockedIds,
                claimedIds: initialData.claimedIds,
                totalPoints: total,
            }));
        } else {
            // Check localStorage if cloud data is unavailable
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    setState(prev => ({
                        ...prev,
                        unlockedIds: parsed.unlockedIds || [],
                        claimedIds: parsed.claimedIds || [],
                        totalPoints: parsed.totalPoints || 0,
                    }));
                } catch (e) {
                    console.error("Failed to load achievements", e);
                }
            }
            setIsLoaded(true);
        }
    }, [userId, initialData]);

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

            setState(prev => ({
                ...prev,
                unlockedIds: nextUnlockedIds,
                lastChecked: Date.now(),
            }));

            // Sync to cloud
            saveToCloud({ unlockedIds: nextUnlockedIds });

            return newUnlocks;
        }
        return [];
    }, [state.unlockedIds, isLoaded, saveToCloud]);

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

        setState(prev => ({
            ...prev,
            claimedIds: nextClaimedIds,
            totalPoints: newTotalPoints
        }));

        // Sync to cloud
        saveToCloud({ claimedIds: nextClaimedIds, totalPoints: newTotalPoints });
    }, [state.claimedIds, state.unlockedIds, state.totalPoints, userId, isLoaded, saveToCloud]);

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
