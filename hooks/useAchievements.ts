import { useState, useEffect, useCallback, useRef } from 'react';
import { Achievement, AchievementState, Koi } from '../types';
import { ACHIEVEMENTS, checkUnlockableAchievements } from '../utils/achievements';

const createEmptyAchievementState = (): AchievementState => ({
    unlockedIds: [],
    claimedIds: [],
    totalPoints: 0,
    lastChecked: Date.now(),
});

type AchievementSnapshot = {
    unlockedIds?: string[];
    claimedIds?: string[];
    totalPoints?: number;
};

const knownAchievementIds = new Set(ACHIEVEMENTS.map(achievement => achievement.id));

const uniqueIds = (ids: unknown): string[] => {
    if (!Array.isArray(ids)) return [];
    return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string')))
        .filter(id => knownAchievementIds.has(id));
};

const mergeAchievementSnapshots = (...snapshots: Array<AchievementSnapshot | null | undefined>): AchievementState => {
    const unlockedIds = uniqueIds(snapshots.flatMap(snapshot => snapshot?.unlockedIds ?? []));
    const claimedIds = uniqueIds(snapshots.flatMap(snapshot => snapshot?.claimedIds ?? []));

    // A claimed reward always implies that the achievement was unlocked.
    const mergedUnlockedIds = uniqueIds([...unlockedIds, ...claimedIds]);
    const pointsFromKnownClaims = claimedIds.reduce((sum, id) => {
        const achievement = ACHIEVEMENTS.find(item => item.id === id);
        return sum + (achievement?.reward.achievementPoints || 0);
    }, 0);
    const savedTotalPoints = snapshots.reduce((highest, snapshot) => {
        const points = Number(snapshot?.totalPoints);
        return Number.isFinite(points) && points >= 0 ? Math.max(highest, points) : highest;
    }, 0);

    return {
        unlockedIds: mergedUnlockedIds,
        claimedIds,
        // Keep historical points even when an old achievement definition is
        // removed or renamed. Achievement progression must never go backwards.
        totalPoints: Math.max(pointsFromKnownClaims, savedTotalPoints),
        lastChecked: Date.now(),
    };
};

export const useAchievements = (
    userId: string | undefined,
    initialData?: { unlockedIds: string[]; claimedIds: string[]; totalPoints?: number; } | null
) => {
    const [state, setState] = useState<AchievementState>(() => createEmptyAchievementState());
    const stateRef = useRef<AchievementState>(state);
    const storageScopeRef = useRef(userId ?? 'guest');
    stateRef.current = state;

    const [isLoaded, setIsLoaded] = useState(false);

    const persistLocalState = useCallback((nextState: Pick<AchievementState, 'unlockedIds' | 'claimedIds' | 'totalPoints'>) => {
        try {
            const storageId = userId ?? 'guest';
            localStorage.setItem(`koi_garden_achievements_${storageId}`, JSON.stringify({
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
        const key = `koi_garden_achievements_${userId ?? 'guest'}`;

        let localData: AchievementSnapshot | null = null;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as AchievementSnapshot;
                localData = {
                    unlockedIds: uniqueIds(parsed.unlockedIds),
                    claimedIds: uniqueIds(parsed.claimedIds),
                    totalPoints: Number(parsed.totalPoints),
                };
            } catch (e) {
                console.error("Failed to load achievements", e);
            }
        }

        // Keep in-memory progress only within the same account. A delayed
        // cloud snapshot must not roll progress backwards or leak another
        // account's achievements into the current account.
        const storageScope = userId ?? 'guest';
        const inMemoryState = storageScopeRef.current === storageScope ? stateRef.current : null;
        storageScopeRef.current = storageScope;
        const nextState = mergeAchievementSnapshots(inMemoryState, localData, initialData);
        stateRef.current = nextState;
        setState(nextState);
        setIsLoaded(true);
        persistLocalState(nextState);
    }, [userId, initialData, persistLocalState]);

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

            return newUnlocks;
        }
        return [];
    }, [state, isLoaded, persistLocalState]);

    const claimReward = useCallback(async (achievementId: string, onRewardClaimed?: (reward: Achievement['reward']) => void) => {
        if (!isLoaded) return null;
        if (state.claimedIds.includes(achievementId)) return null;
        if (!state.unlockedIds.includes(achievementId)) return null;

        const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!achievement) return null;

        const nextClaimedIds = uniqueIds([...state.claimedIds, achievementId]);
        const nextUnlockedIds = uniqueIds([...state.unlockedIds, achievementId]);
        const nextState: AchievementState = {
            ...state,
            unlockedIds: nextUnlockedIds,
            claimedIds: nextClaimedIds,
            totalPoints: state.totalPoints + achievement.reward.achievementPoints,
        };

        setState(nextState);
        persistLocalState(nextState);
        onRewardClaimed?.(achievement.reward);
        return achievement.reward;
    }, [state, isLoaded, persistLocalState]);

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
