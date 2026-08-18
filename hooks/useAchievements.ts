import { useState, useEffect, useCallback, useRef } from 'react';
import { Achievement, AchievementState, Koi } from '../types';
import { claimAchievement as claimAchievementOnServer } from '../services/ranking';
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

const pointsFromClaims = (claimedIds: string[]) => claimedIds.reduce((sum, id) => {
    const achievement = ACHIEVEMENTS.find(item => item.id === id);
    return sum + (achievement?.reward.achievementPoints || 0);
}, 0);

const mergeAchievementSnapshots = (
    snapshots: Array<AchievementSnapshot | null | undefined>,
    canonicalTotal?: number,
): AchievementState => {
    const unlockedIds = uniqueIds(snapshots.flatMap(snapshot => snapshot?.unlockedIds ?? []));
    const claimedIds = uniqueIds(snapshots.flatMap(snapshot => snapshot?.claimedIds ?? []));
    const mergedUnlockedIds = uniqueIds([...unlockedIds, ...claimedIds]);
    const calculatedPoints = pointsFromClaims(claimedIds);
    const suppliedTotal = Number(canonicalTotal);

    return {
        unlockedIds: mergedUnlockedIds,
        claimedIds,
        // Canonical server totals may include retired legacy achievements
        // whose IDs are intentionally hidden from the current catalog.
        totalPoints: Number.isFinite(suppliedTotal) && suppliedTotal >= 0
            ? Math.max(calculatedPoints, Math.floor(suppliedTotal))
            : calculatedPoints,
        lastChecked: Date.now(),
    };
};

export const useAchievements = (
    userId: string | undefined,
    initialData?: { unlockedIds: string[]; claimedIds: string[]; totalPoints?: number; } | null,
) => {
    const scope = userId ?? 'guest';
    const [state, setState] = useState<AchievementState>(() => createEmptyAchievementState());
    const [loadedScope, setLoadedScope] = useState<string | null>(null);
    const stateRef = useRef<AchievementState>(state);
    const storageScopeRef = useRef(scope);
    stateRef.current = state;

    const isLoaded = loadedScope === scope && (!userId || initialData !== null);

    const persistLocalState = useCallback((nextState: Pick<AchievementState, 'unlockedIds' | 'claimedIds' | 'totalPoints'>) => {
        try {
            localStorage.setItem(`koi_garden_achievements_${scope}`, JSON.stringify({
                unlockedIds: nextState.unlockedIds,
                claimedIds: nextState.claimedIds,
                totalPoints: nextState.totalPoints,
            }));
        } catch (error) {
            console.error('Failed to persist achievements locally', error);
        }
    }, [scope]);

    useEffect(() => {
        // Authenticated accounts must wait for the canonical server snapshot.
        // Loading an empty localStorage value first was the reinstall race that
        // allowed restored koi to overwrite claimed achievement IDs.
        if (userId && !initialData) {
            if (storageScopeRef.current !== scope) {
                storageScopeRef.current = scope;
                const emptyState = createEmptyAchievementState();
                stateRef.current = emptyState;
                setState(emptyState);
            }
            setLoadedScope(null);
            return;
        }

        let localData: AchievementSnapshot | null = null;
        const saved = localStorage.getItem(`koi_garden_achievements_${scope}`);
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as AchievementSnapshot;
                localData = {
                    unlockedIds: uniqueIds(parsed.unlockedIds),
                    claimedIds: uniqueIds(parsed.claimedIds),
                    totalPoints: Number(parsed.totalPoints),
                };
            } catch (error) {
                console.error('Failed to load achievements', error);
            }
        }

        const sameScopeState = storageScopeRef.current === scope ? stateRef.current : null;
        storageScopeRef.current = scope;
        const nextState = userId
            ? mergeAchievementSnapshots([
                // Local/in-memory unlocks are harmless recovery hints. Claimed
                // rewards and the total always come from the server snapshot.
                { unlockedIds: localData?.unlockedIds },
                { unlockedIds: sameScopeState?.unlockedIds },
                initialData,
            ], initialData?.totalPoints)
            : mergeAchievementSnapshots(
                [sameScopeState, localData],
                Math.max(Number(localData?.totalPoints || 0), Number(sameScopeState?.totalPoints || 0)),
            );

        stateRef.current = nextState;
        setState(nextState);
        setLoadedScope(scope);
        persistLocalState(nextState);
    }, [userId, scope, initialData, persistLocalState]);

    const checkAchievements = useCallback((kois: Koi[]) => {
        if (!isLoaded) return [];
        const currentState = stateRef.current;
        const newUnlocks = checkUnlockableAchievements(kois, currentState.unlockedIds);
        if (newUnlocks.length === 0) return [];

        const nextState: AchievementState = {
            ...currentState,
            unlockedIds: uniqueIds([...currentState.unlockedIds, ...newUnlocks.map(achievement => achievement.id)]),
            lastChecked: Date.now(),
        };
        stateRef.current = nextState;
        setState(nextState);
        persistLocalState(nextState);
        return newUnlocks;
    }, [isLoaded, persistLocalState]);

    const claimReward = useCallback(async (
        achievementId: string,
        onRewardClaimed?: (reward: Achievement['reward']) => void,
    ) => {
        if (!isLoaded) return null;
        const currentState = stateRef.current;
        if (currentState.claimedIds.includes(achievementId)) return null;
        if (!currentState.unlockedIds.includes(achievementId)) return null;

        const achievement = ACHIEVEMENTS.find(item => item.id === achievementId);
        if (!achievement) return null;

        if (userId) {
            const result = await claimAchievementOnServer(achievementId);
            const nextState: AchievementState = {
                ...currentState,
                unlockedIds: uniqueIds([...currentState.unlockedIds, ...result.unlockedIds]),
                claimedIds: uniqueIds([...currentState.claimedIds, ...result.claimedIds]),
                totalPoints: result.achievementPoints,
                lastChecked: Date.now(),
            };
            stateRef.current = nextState;
            setState(nextState);
            persistLocalState(nextState);

            if (result.achievementReward <= 0) return null;
            const reward = { achievementPoints: result.achievementReward };
            onRewardClaimed?.(reward);
            return reward;
        }

        const nextState: AchievementState = {
            ...currentState,
            unlockedIds: uniqueIds([...currentState.unlockedIds, achievementId]),
            claimedIds: uniqueIds([...currentState.claimedIds, achievementId]),
            totalPoints: currentState.totalPoints + achievement.reward.achievementPoints,
            lastChecked: Date.now(),
        };
        stateRef.current = nextState;
        setState(nextState);
        persistLocalState(nextState);
        onRewardClaimed?.(achievement.reward);
        return achievement.reward;
    }, [userId, isLoaded, persistLocalState]);

    const getAchievementStatus = useCallback((id: string) => ({
        isUnlocked: state.unlockedIds.includes(id),
        isClaimed: state.claimedIds.includes(id),
    }), [state.unlockedIds, state.claimedIds]);

    return {
        achievements: ACHIEVEMENTS,
        unlockedIds: state.unlockedIds,
        claimedIds: state.claimedIds,
        checkAchievements,
        claimReward,
        getAchievementStatus,
        hasUnclaimedRewards: state.unlockedIds.some(id => !state.claimedIds.includes(id)),
        totalPoints: state.totalPoints || 0,
        isLoaded,
    };
};
