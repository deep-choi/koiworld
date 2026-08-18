/// <reference types="vite/client" />
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Pond } from './components/Pond';
import { ControlBar } from './components/ControlBar';
import { ShopModal } from './components/ShopModal';
import { PondInfoModal } from './components/PondInfoModal';
import { SaveLoadModal } from './components/SaveLoadModal';
import { AccountModal } from './components/AccountModal';
// SettingsModal removed


import { breedKoi, calculateKoiValue, createFixedSpotPhenotypeGenes } from './utils/genetics';
import { useKoiPond, createInitialPonds } from './hooks/useKoiPond';
import { Koi, GeneType, KoiGenetics, GrowthStage, Ponds, Decoration, DecorationType, PondTheme, SavedGameState } from './types';
import { Wheat, DollarSign, ShoppingCart, Dna, Settings, User, X, LoaderCircle } from 'lucide-react';
import { audioManager } from './utils/audio';
import { ThemeModal } from './components/ThemeModal';
import { CleanConfirmModal } from './components/CleanConfirmModal';
import { SpotGeneticsDebugPanel } from './components/debug/SpotGeneticsDebugPanel';
import { KoiCSSPreview } from './components/KoiCSSPreview';

// --- New Feature Imports ---
import { useAuth } from './contexts/AuthContext';
import { AuthModal } from './components/AuthModal';
import { startSession } from './services/session';
import { GameStateRevisionConflictError, saveGameToCloud, loadUserDataOnce, listenToGameData } from './services/sync';
import { SessionConflictModal } from './components/SessionConflictModal';
import { FORCE_CLEAR_KEY, SAVE_GAME_KEY, clearLocalGameSaves, getScopedSaveGameKey, isLocalGameSaveSuppressed, resumeLocalGameSave, suppressLocalGameSave } from './services/localSave';
import { startTabLock, type TabLockController } from './services/tabLock';
import { ensureUserProfileNickname, updateUserProfileSettings } from './services/profile';
import { RankingModal } from './components/RankingModal';
import { useAchievements } from './hooks/useAchievements';
import { AchievementModal } from './components/AchievementModal';
import { CURRENT_GAME_STATE_SCHEMA_VERSION, normalizeSavedGameState } from './utils/savedGameState';
import { purchaseHonorTrophies } from './services/ranking';

interface Animation {
  id: number;
  value?: number;
  feedAmount?: number;
  position: { x: number; y: number };
}

const BREEDING_COST = 200;
const FOOD_PACK_PRICE = 200;
const FOOD_PACK_AMOUNT = 50;
const CORN_PACK_PRICE = 1000;
const CORN_PACK_AMOUNT = 50;
const CORN_FEED_AMOUNT = 2;
const CLEANING_COST = 500;
const FOOD_LARGE_PACK_PRICE = 1000;
const FOOD_LARGE_PACK_AMOUNT = 250;
const CORN_LARGE_PACK_PRICE = 5000;
const CORN_LARGE_PACK_AMOUNT = 250;

const createInitialGameState = (): SavedGameState => ({
  schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
  ponds: createInitialPonds(),
  activePondId: 'pond-1',
  zenPoints: import.meta.env.DEV ? 10000 : 2000,
  foodCount: 20,
  cornCount: 0,
  honorPoints: 0,
  achievementPoints: 0,
  achievements: {
    unlockedIds: [],
    claimedIds: [],
  },
  koiNameCounter: 3,
});

const loadGameState = (uid?: string | null): SavedGameState | null => {
  const scopedKey = getScopedSaveGameKey(uid);
  try {
    let savedData = localStorage.getItem(scopedKey);

    // Migrate the old unscoped save into the guest namespace only. It must
    // never be used as the initial state for an authenticated UID.
    if (!savedData && !uid) {
      savedData = localStorage.getItem(SAVE_GAME_KEY);
      if (savedData) localStorage.setItem(scopedKey, savedData);
    }

    if (savedData) {
      const parsed = normalizeSavedGameState(JSON.parse(savedData));
      if (parsed) {
        return parsed;
      }
      localStorage.removeItem(scopedKey);
      console.warn("Invalid saved game state removed.");
    }
  } catch (error) {
    console.error("Failed to load game state:", error);
  }
  return null;
}

export const App: React.FC = () => {
  const [savedState] = useState(() => loadGameState(null));

  const {
    ponds,
    setPonds,
    activePondId,
    setActivePondId,
    koiList,
    addKois,
    removeKoi,
    updateKoiPositions,
    addPond,
    feedKoi,
    foodPellets,
    dropFood,
    feedAnimations,
    addDecoration,
    setPondTheme,
    resetPonds,
    handleFoodEaten,
    cleanPond,
    consumeStamina,
    reduceWaterQuality,
    renameKoi,
    moveKoi,
  } = useKoiPond(savedState ? { ponds: savedState.ponds, activePondId: savedState.activePondId } : undefined);

  const activePond = ponds[activePondId];
  const decorations = activePond?.decorations || [];
  const currentTheme = activePond?.theme || PondTheme.DEFAULT;
  const waterQuality = activePond?.waterQuality ?? 100;

  // ...

  // Modal States
  const [isShopModalOpen, setIsShopModalOpen] = useState(false);
  const [isPondInfoModalOpen, setIsPondInfoModalOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isSaveLoadModalOpen, setIsSaveLoadModalOpen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isCleanConfirmOpen, setIsCleanConfirmOpen] = useState(false);
  const [isRankingModalOpen, setIsRankingModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  // --- New Feature States ---
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { user, loading: authLoading, logout: logoutFromContext } = useAuth();
  const localSaveScope = user && !user.isAnonymous ? user.uid : null;

  // Session & Sync State
  const [isConflictOpen, setIsConflictOpen] = useState(false);
  const [userNickname, setUserNickname] = useState<string>('');
  const [userPhotoURL, setUserPhotoURL] = useState<string | null>(null);
  const [isCloudSyncReady, setIsCloudSyncReady] = useState(false);
  const [cloudSaveIssue, setCloudSaveIssue] = useState<string | null>(null);
  const [isDuplicateTabPaused, setIsDuplicateTabPaused] = useState(false);

  // Achievement System
  const [initialAchievementData, setInitialAchievementData] = useState<{
    unlockedIds: string[];
    claimedIds: string[];
    totalPoints?: number;
    scope: string;
  } | null>(null);
  const achievementScope = localSaveScope ?? 'guest';
  const scopedInitialAchievementData = initialAchievementData?.scope === achievementScope
    ? initialAchievementData
    : null;
  const {
    achievements,
    unlockedIds,
    claimedIds,
    checkAchievements,
    claimReward,
    hasUnclaimedRewards,
    totalPoints: achievementScore,
    isLoaded: achievementsLoaded,
  } = useAchievements(localSaveScope ?? undefined, scopedInitialAchievementData);
  const [isAchievementModalOpen, setIsAchievementModalOpen] = useState(false);
  const lastAchievementCheckKeyRef = useRef('');
  const achievementGeneticsSignatureCacheRef = useRef(new WeakMap<Koi['genetics'], string>());
  const flushCurrentGameStateRef = useRef<() => Promise<void>>(async () => undefined);

  // Show achievement unlock notification
  useEffect(() => {
    // Never evaluate the previous account's koi while the new local/cloud
    // namespace is still being hydrated.
    if (localHydratedScopeRef.current !== achievementScope || !achievementsLoaded || koiList.length === 0) return;

    // 업적 조건과 무관한 상태(예: 스태미나/수질 변화)로 재검사를 반복하지 않도록 키를 계산합니다.
    const achievementCheckKey = koiList
      .map((koi) => {
        let geneticsSignature = achievementGeneticsSignatureCacheRef.current.get(koi.genetics);
        if (!geneticsSignature) {
          const spotsSignature = koi.genetics.spots
            .map((spot) => `${spot.color}:${spot.shape ?? ''}:${Math.round(spot.x)}:${Math.round(spot.y)}:${Math.round(spot.size)}`)
            .join('|');

          geneticsSignature = [
            koi.genetics.baseColorGenes.join(','),
            koi.genetics.lightness ?? '',
            koi.genetics.saturation ?? '',
            spotsSignature,
          ].join(':');
          achievementGeneticsSignatureCacheRef.current.set(koi.genetics, geneticsSignature);
        }

        return [
          koi.id,
          koi.growthStage,
          geneticsSignature,
        ].join(':');
      })
      .sort()
      .join('||');

    if (lastAchievementCheckKeyRef.current === achievementCheckKey) return;
    lastAchievementCheckKeyRef.current = achievementCheckKey;

    const newUnlocks = checkAchievements(koiList);
    if (newUnlocks && newUnlocks.length > 0) {
      // Show notification for the first unlocked achievement in this batch
      setNotification({
        message: `🏆 업적 달성: ${newUnlocks[0].title}`,
        type: 'success'
      });
      audioManager.playSFX('success');
    }
  }, [koiList, achievementScope, achievementsLoaded, checkAchievements]);

  const handleClaimReward = async (id: string) => {
    try {
      if (user && !user.isAnonymous) {
        serverMutationInProgressRef.current = true;
        await flushCurrentGameStateRef.current();
      }
      const reward = await claimReward(id, (rewardContent) => {
        setNotification({
          message: `보상 획득! 업적 포인트 ${rewardContent.achievementPoints}점`,
          type: 'success'
        });
        audioManager.playSFX('coin');
      });
      if (!reward) return;
    } catch (error) {
      console.error('Achievement reward claim failed:', error);
      setNotification({ message: '업적 보상을 서버에서 확인하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해주세요.', type: 'error' });
    } finally {
      serverMutationInProgressRef.current = false;
    }
  };
  const feedingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const feedingDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPointerPosRef = useRef<{ x: number, y: number } | null>(null);
  const [zenPoints, setZenPoints] = useState(savedState?.zenPoints ?? (import.meta.env.DEV ? 10000 : 2000));
  const [isFeedModeActive, setIsFeedModeActive] = useState(false);
  const [breedingSelection, setBreedingSelection] = useState<string[]>([]);
  const [honorPoints, setHonorPoints] = useState(savedState?.honorPoints ?? 0);
  const [sellAnimations, setSellAnimations] = useState<Animation[]>([]);
  const [foodDropAnimations, setFoodDropAnimations] = useState<Animation[]>([]);

  // Item Counts
  const [foodCount, setFoodCount] = useState(savedState?.foodCount ?? 20);
  const [cornCount, setCornCount] = useState(savedState?.cornCount ?? 0);

  const [selectedFoodType, setSelectedFoodType] = useState<'normal' | 'corn'>('normal');
  const [koiNameCounter, setKoiNameCounter] = useState(savedState?.koiNameCounter ?? 3);
  const [isMuted, setIsMuted] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' | 'error' } | null>(null);

  // Latest state refs for interval access
  const latestFoodCountsRef = useRef({ food: foodCount, corn: cornCount, type: selectedFoodType });
  const lastLocalSavePayloadRef = useRef<string | null>(null);
  const lastCloudSavePayloadRef = useRef<string | null>(null);
  const cloudGameStateRevisionRef = useRef<number | null>(null);
  const cloudSaveBlockedRef = useRef(false);
  const cloudHydratedUserIdRef = useRef<string | null>(null);
  const localHydratedScopeRef = useRef<string | null>('guest');
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCloudPayloadRef = useRef<string | null>(null);
  const serverMutationInProgressRef = useRef(false);
  const rankingSyncKeyRef = useRef('');
  const tabLockRef = useRef<TabLockController | null>(null);

  useEffect(() => {
    latestFoodCountsRef.current = { food: foodCount, corn: cornCount, type: selectedFoodType };
  }, [foodCount, cornCount, selectedFoodType]);

  useEffect(() => {
    const scopeId = achievementScope;
    const lock = startTabLock(scopeId, {
      onActive: () => {
        resumeLocalGameSave();
        setIsDuplicateTabPaused(false);
      },
      onBlocked: () => {
        suppressLocalGameSave();
        setIsDuplicateTabPaused(true);
        setIsFeedModeActive(false);
        if (feedingIntervalRef.current) clearInterval(feedingIntervalRef.current);
        if (feedingDelayTimeoutRef.current) clearTimeout(feedingDelayTimeoutRef.current);
        feedingIntervalRef.current = null;
        feedingDelayTimeoutRef.current = null;
        lastPointerPosRef.current = null;
      },
    });

    tabLockRef.current = lock;

    return () => {
      lock.stop();
      if (tabLockRef.current === lock) {
        tabLockRef.current = null;
      }
    };
  }, [achievementScope]);

  // Clear notification after 3 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Clear feeding interval on unmount or mode change
  useEffect(() => {
    return () => {
      if (feedingIntervalRef.current) clearInterval(feedingIntervalRef.current);
      if (feedingDelayTimeoutRef.current) clearTimeout(feedingDelayTimeoutRef.current);
      feedingIntervalRef.current = null;
      feedingDelayTimeoutRef.current = null;
    };
  }, [isFeedModeActive]);

  // Initialize audio on first interaction
  useEffect(() => {
    const initAudio = () => {
      audioManager.init();
      audioManager.playBGM();
      window.removeEventListener('click', initAudio);
    };
    window.addEventListener('click', initAudio);

    // Handle background audio (Mobile/Tab switching)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        audioManager.suspend();
      } else {
        audioManager.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('click', initAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // --- Effects for New Features ---

  // Initialize web ads
  // Auth check
  useEffect(() => {
    if (!authLoading && !user) {
      setIsAuthModalOpen(true);
    }
  }, [user, authLoading]);

  // Handle cross-tab logout/clear
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== FORCE_CLEAR_KEY) return;
      if (!event.newValue) return;
      suppressLocalGameSave();
      clearLocalGameSaves();
      window.location.reload();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // 로그아웃 시 사용자별 상태만 초기화
  useEffect(() => {
    if (!user) {
      setUserNickname('');
      setUserPhotoURL(null);
      setCloudSaveIssue(null);
      lastCloudSavePayloadRef.current = null;
      cloudGameStateRevisionRef.current = null;
      cloudSaveBlockedRef.current = false;
      lastAchievementCheckKeyRef.current = '';
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setUserPhotoURL(user.photoURL ?? null);
    }
  }, [user?.uid, user?.photoURL]);

  useEffect(() => {
    // 사용자 전환 시 첫 클라우드 저장을 허용하도록 이전 저장 해시를 초기화합니다.
    setInitialAchievementData(null);
    lastCloudSavePayloadRef.current = null;
    cloudGameStateRevisionRef.current = null;
    cloudSaveBlockedRef.current = false;
    lastAchievementCheckKeyRef.current = '';
  }, [user?.uid]);

  const resolvedUserNickname = useMemo(() => {
    const fromProfile = userNickname.trim();
    if (fromProfile) return fromProfile;
    const fromAuthDisplayName = user?.displayName?.trim();
    if (fromAuthDisplayName) return fromAuthDisplayName;
    const fromEmail = user?.email?.split('@')?.[0]?.trim();
    if (fromEmail) return fromEmail;
    return 'User';
  }, [userNickname, user]);

  // Ref to hold latest state for periodic saving
  const gameStateRef = useRef<SavedGameState | null>(null);

  useEffect(() => {
    gameStateRef.current = {
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
      ponds,
      activePondId,
      zenPoints,
      foodCount,
      cornCount,
      honorPoints,
      achievementPoints: achievementScore,
      achievements: {
        unlockedIds,
        claimedIds,
      },
      koiNameCounter,
    };
  }, [ponds, activePondId, zenPoints, foodCount, cornCount, honorPoints, achievementScore, unlockedIds, claimedIds, koiNameCounter]);

  const persistLocalGameState = useCallback((state: SavedGameState, uid?: string | null) => {
    const payload = JSON.stringify(state);
    try {
      localStorage.setItem(getScopedSaveGameKey(uid), payload);
      lastLocalSavePayloadRef.current = payload;
    } catch (error) {
      console.error("Local save failed:", error);
    }
    return payload;
  }, []);

  const enqueueCloudSave = useCallback((uid: string, state: SavedGameState) => {
    const payload = JSON.stringify(state);
    const previousCloudPayload = lastCloudSavePayloadRef.current;
    lastCloudSavePayloadRef.current = payload;
    pendingCloudPayloadRef.current = payload;

    const nextSave = cloudSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (isLocalGameSaveSuppressed() || cloudSaveBlockedRef.current) {
          if (lastCloudSavePayloadRef.current === payload) {
            lastCloudSavePayloadRef.current = previousCloudPayload;
          }
          if (pendingCloudPayloadRef.current === payload) {
            pendingCloudPayloadRef.current = null;
          }
          return;
        }

        try {
          const expectedRevision = cloudGameStateRevisionRef.current;
          if (expectedRevision === null) {
            throw new Error('Cloud save was attempted before the account state was hydrated.');
          }
          const nextRevision = await saveGameToCloud(uid, state, expectedRevision, 'auto');
          cloudGameStateRevisionRef.current = nextRevision;
          setCloudSaveIssue(null);
        } catch (error) {
          if (error instanceof GameStateRevisionConflictError) {
            cloudSaveBlockedRef.current = true;
            setIsCloudSyncReady(false);
            setCloudSaveIssue('다른 기기에서 더 최신 저장본이 확인되었습니다. 기존 데이터를 덮어쓰지 않도록 이 기기의 클라우드 저장을 멈췄습니다. 앱을 다시 열어 최신 저장본을 불러오세요.');
          } else {
            setCloudSaveIssue('클라우드 저장이 완료되지 않았습니다. 네트워크를 확인하면 자동으로 다시 시도합니다. 로그아웃 전에는 반드시 저장 상태를 확인해주세요.');
          }
          if (lastCloudSavePayloadRef.current === payload) {
            lastCloudSavePayloadRef.current = previousCloudPayload;
          }
          throw error;
        } finally {
          if (pendingCloudPayloadRef.current === payload) {
            pendingCloudPayloadRef.current = null;
          }
        }
      });

    cloudSaveQueueRef.current = nextSave;
    return nextSave;
  }, []);

  const flushCurrentGameState = useCallback(async () => {
    const currentState = gameStateRef.current;
    if (!currentState) return;
    if (user && !user.isAnonymous) {
      if (
        isDuplicateTabPaused
        || isLocalGameSaveSuppressed()
        || !isCloudSyncReady
        || !achievementsLoaded
        || cloudHydratedUserIdRef.current !== user.uid
        || cloudSaveBlockedRef.current
      ) {
        throw new Error('Authenticated game state is not ready for a safe cloud flush.');
      }
    } else if (isDuplicateTabPaused || isLocalGameSaveSuppressed()) {
      return;
    }
    if (localHydratedScopeRef.current !== (localSaveScope ?? 'guest')) return;

    const payload = persistLocalGameState(currentState, localSaveScope);
    if (
      user
      && !user.isAnonymous
      && payload !== lastCloudSavePayloadRef.current
    ) {
      await enqueueCloudSave(user.uid, currentState);
    }
    await cloudSaveQueueRef.current;
  }, [
    user,
    localSaveScope,
    isCloudSyncReady,
    achievementsLoaded,
    isDuplicateTabPaused,
    enqueueCloudSave,
    persistLocalGameState,
  ]);
  flushCurrentGameStateRef.current = flushCurrentGameState;

  useEffect(() => {
    const saveBeforeBackground = () => {
      if (document.visibilityState !== 'hidden') return;
      void flushCurrentGameState().catch(error => {
        console.error('Background save failed:', error);
      });
    };
    const saveBeforePageHide = () => {
      void flushCurrentGameState().catch(error => {
        console.error('Page hide save failed:', error);
      });
    };
    document.addEventListener('visibilitychange', saveBeforeBackground);
    window.addEventListener('pagehide', saveBeforePageHide);
    return () => {
      document.removeEventListener('visibilitychange', saveBeforeBackground);
      window.removeEventListener('pagehide', saveBeforePageHide);
    };
  }, [flushCurrentGameState]);

  useEffect(() => {
    rankingSyncKeyRef.current = '';
  }, [achievementScope]);

  // Publish newly unlocked achievement IDs after canonical hydration. The
  // server preserves claimed rewards and trophy totals even if this snapshot
  // is stale or incomplete.
  useEffect(() => {
    if (!user || user.isAnonymous || !isCloudSyncReady || serverMutationInProgressRef.current || cloudHydratedUserIdRef.current !== user.uid || !achievementsLoaded || !gameStateRef.current) return;

    const syncKey = JSON.stringify({
      achievementScore,
      honorPoints,
      unlockedIds,
      claimedIds,
    });
    if (rankingSyncKeyRef.current === syncKey) return;
    rankingSyncKeyRef.current = syncKey;

    const currentState: SavedGameState = {
      ...gameStateRef.current,
      honorPoints,
      achievementPoints: achievementScore,
      achievements: { unlockedIds, claimedIds },
    };
    gameStateRef.current = currentState;
    void enqueueCloudSave(user.uid, currentState).catch((error) => {
      console.error('Ranking score sync failed:', error);
      if (rankingSyncKeyRef.current === syncKey) rankingSyncKeyRef.current = '';
    });
  }, [user, isCloudSyncReady, achievementsLoaded, achievementScore, honorPoints, unlockedIds, claimedIds, enqueueCloudSave]);

  // Session & Cloud Sync Logic
  useEffect(() => {
    let cancelled = false;

    const initSession = async () => {
      let cloudReady = false;
      cloudHydratedUserIdRef.current = null;
      cloudGameStateRevisionRef.current = null;
      cloudSaveBlockedRef.current = false;
      localHydratedScopeRef.current = null;
      if (!user || user.isAnonymous) {
        setIsCloudSyncReady(false);
        setCloudSaveIssue(null);
        suppressLocalGameSave();
        handleLoadGame(loadGameState(null) ?? createInitialGameState(), { silent: true, replace: true, hydrateAchievements: true });
        localHydratedScopeRef.current = 'guest';
        resumeLocalGameSave();
        return;
      }

      // Freeze local writes while switching namespaces. Otherwise the first
      // guest render could be written into the newly selected account key
      // before its own local/cloud state has been hydrated.
      suppressLocalGameSave();
      setIsCloudSyncReady(false);
      setCloudSaveIssue(null);
      try {
        const scopedLocalState = loadGameState(localSaveScope);
        const guestRecoveryState = loadGameState(null);
        // A user who was silently placed in the legacy anonymous fallback may
        // still have hours of valid progress under the guest key. Use it only
        // as the seed for a genuinely new cloud account; an existing cloud
        // snapshot still wins below and is never overwritten automatically.
        const fallbackState = scopedLocalState ?? guestRecoveryState ?? createInitialGameState();
        // This is only a temporary render state. Cloud saving remains frozen
        // until the account document has been classified below.
        handleLoadGame(fallbackState, { silent: true, replace: true, hydrateAchievements: false });

        // Read before creating/touching the profile document. A pre-existing
        // document with no usable gameState is a recovery case, not a new
        // game. Creating the profile first was what made both cases look the
        // same and allowed defaults to be uploaded later.
        const existingUserData = await loadUserDataOnce(user.uid);
        if (cancelled) return;

        const [verifiedNickname] = await Promise.all([
          ensureUserProfileNickname(user.uid, user.displayName, user.email, user.photoURL),
          startSession(user.uid),
        ]);
        if (cancelled) return;

        if (existingUserData === null) {
          // A successful read proved this is a truly new cloud account, so
          // the first state can be created explicitly rather than by the
          // periodic auto-save timer.
          const revision = await saveGameToCloud(user.uid, fallbackState, 0, 'new-account');
          if (cancelled) return;
          cloudGameStateRevisionRef.current = revision;
          handleLoadGame(fallbackState, { markAsSynced: true, replace: true, hydrateAchievements: true });
        } else if (existingUserData.gameData) {
          const revision = existingUserData.gameDataRevision;
          if (existingUserData.gameDataSource === 'backup') {
            // loadAccountState already repaired the primary transactionally.
            setNotification({ message: '최근 클라우드 백업으로 저장 데이터를 복구했습니다.', type: 'info' });
          }

          cloudGameStateRevisionRef.current = revision;
          handleLoadGame(existingUserData.gameData, { markAsSynced: true, replace: true, hydrateAchievements: true });
        } else {
          // The account existed before this session but neither its primary
          // state nor a validated backup is usable. Keep cloud writes off so
          // a fallback/default state cannot destroy any recoverable data.
          setUserNickname(verifiedNickname);
          setUserPhotoURL(existingUserData.photoURL ?? user.photoURL ?? null);
          setCloudSaveIssue('이 계정의 클라우드 저장본을 확인할 수 없습니다. 기존 데이터를 덮어쓰지 않도록 자동 저장을 멈췄습니다. 다시 확인하거나 설정에서 새 게임을 직접 시작할 수 있습니다.');
          setNotification({ message: '클라우드 저장본을 확인할 수 없어 자동 저장을 멈췄습니다.', type: 'error' });
          return;
        }

        // 서버에 저장된 닉네임으로 로컬 상태 업데이트
        setUserNickname(verifiedNickname);
        setUserPhotoURL(existingUserData?.photoURL ?? user.photoURL ?? null);

        cloudReady = true;
        cloudHydratedUserIdRef.current = user.uid;
        localHydratedScopeRef.current = localSaveScope;
      } catch (error) {
        if (!cancelled) {
          console.error("Session init failed:", error);
          setCloudSaveIssue('클라우드 저장본을 확인하지 못했습니다. 기존 데이터를 덮어쓰지 않도록 자동 저장을 멈췄습니다. 네트워크를 확인한 뒤 다시 시도하세요.');
          setNotification({ message: '클라우드 저장 확인에 실패해 자동 저장을 멈췄습니다.', type: 'error' });
        }
      } finally {
        if (!cancelled) {
          setIsCloudSyncReady(cloudReady);
          resumeLocalGameSave();
        }
      }
    };

    initSession();
    return () => {
      cancelled = true;
    };
  }, [user, localSaveScope]);

  // Periodic Save (Cloud + Local)
  useEffect(() => {
    const saveInterval = setInterval(async () => {
      const currentState = gameStateRef.current;
      if (!currentState) return;
      if (isDuplicateTabPaused || isLocalGameSaveSuppressed() || serverMutationInProgressRef.current) return;
      if (localHydratedScopeRef.current !== (localSaveScope ?? 'guest')) return;

      const payload = JSON.stringify(currentState);

      // Local save only when payload changes.
      if (payload !== lastLocalSavePayloadRef.current) {
        persistLocalGameState(currentState, localSaveScope);
      }

      // Cloud save only when payload changes.
      if (!user || user.isAnonymous || !isCloudSyncReady || !achievementsLoaded || cloudHydratedUserIdRef.current !== user.uid) return;
      if (payload === lastCloudSavePayloadRef.current) return;
      try {
        await enqueueCloudSave(user.uid, currentState);
      } catch (error: any) {
        if (error.code !== 'unavailable') {
          console.error("Cloud save failed:", error);
        }
      }
    }, 15000);

    return () => clearInterval(saveInterval);
  }, [user, localSaveScope, isCloudSyncReady, achievementsLoaded, isDuplicateTabPaused, enqueueCloudSave, persistLocalGameState]);

  const handleSaveProfile = useCallback(async (nickname: string, photoURL: string | null) => {
    if (!user) return;
    const trimmed = nickname.trim();
    if (user.isAnonymous) {
      setUserNickname(trimmed);
      setUserPhotoURL(photoURL);
      setNotification({ message: '게스트 프로필이 저장되었습니다.', type: 'success' });
      return;
    }
    await updateUserProfileSettings(user.uid, trimmed, photoURL);
    setUserNickname(trimmed);
    setUserPhotoURL(photoURL);
    setNotification({ message: '프로필이 저장되었습니다.', type: 'success' });
  }, [user]);

  const handleCleanPond = () => {
    const activePond = ponds[activePondId];
    if ((activePond?.waterQuality ?? 100) >= 100) {
      setNotification({ message: '수질이 이미 깨끗합니다!', type: 'error' });
      return;
    }
    setIsCleanConfirmOpen(true);
  };

  const confirmCleanPond = async () => {
    if (zenPoints < CLEANING_COST) {
      setNotification({ message: `젠 포인트가 부족합니다! (${CLEANING_COST.toLocaleString()} ZP 필요)`, type: 'error' });
      setIsCleanConfirmOpen(false);
      return;
    }

    setZenPoints(prev => Math.max(0, prev - CLEANING_COST));
    audioManager.playSFX('click');
    cleanPond();
    setNotification({ message: `연못을 청소했습니다! (-${CLEANING_COST.toLocaleString()} ZP)`, type: 'success' });
    setIsCleanConfirmOpen(false);
  };

  const handleNewGame = async (): Promise<boolean> => {
    if (!window.confirm("정말 새 게임을 시작하시겠습니까? 현재 진행 상황이 모두 사라집니다.")) return false;

    const initialState: SavedGameState = {
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
      ponds: createInitialPonds(),
      activePondId: 'pond-1',
      zenPoints: import.meta.env.DEV ? 10000 : 2000,
      foodCount: 20,
      cornCount: 0,
      // 업적과 트로피는 새 게임과 별개인 계정 누적 진행도입니다.
      honorPoints,
      achievementPoints: achievementScore,
      achievements: {
        unlockedIds,
        claimedIds,
      },
      koiNameCounter: 3,
    };

    if (user && !user.isAnonymous) {
      // 로그인 상태: 클라우드에 즉시 초기화 상태 저장
      try {
        const expectedRevision = cloudGameStateRevisionRef.current;
        if (expectedRevision === null) {
          throw new Error('Cloud reset was attempted before the account state was hydrated.');
        }
        const nextRevision = await saveGameToCloud(user.uid, initialState, expectedRevision, 'explicit-reset');
        cloudGameStateRevisionRef.current = nextRevision;
      } catch (error) {
        console.error("Failed to reset cloud game state:", error);
        if (!window.confirm("클라우드 초기화에 실패했습니다. 그래도 진행하시겠습니까? (다시 로드될 가능성이 있습니다)")) {
          return false;
        }
      }
    }

    localStorage.setItem(getScopedSaveGameKey(localSaveScope), JSON.stringify(initialState));
    localStorage.removeItem('zenPoints'); // legacy cleanup

    // 리로드하여 전체 상태를 깨끗하게 반영
    window.location.reload();
    return true;
  };

  const handleLogoutCleanup = () => {
    const guestState = loadGameState(null);
    if (guestState) {
      handleLoadGame(guestState, { silent: true, replace: true });
      return;
    }

    setPonds(createInitialPonds());
    setActivePondId('pond-1');
    setZenPoints(import.meta.env.DEV ? 10000 : 2000);
    setFoodCount(20);
    setCornCount(0);
    setHonorPoints(0);
    setKoiNameCounter(3);
    setInitialAchievementData(null);
  };

  const handleLoadGame = (
    loadedState: SavedGameState,
    options: { silent?: boolean; markAsSynced?: boolean; replace?: boolean; hydrateAchievements?: boolean } = {},
  ) => {
    const normalizedState = normalizeSavedGameState(loadedState);
    if (!normalizedState) {
      console.warn("Ignored invalid game state:", loadedState);
      return;
    }

    const mergedState: SavedGameState = {
      ...normalizedState,
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
    };

    if (options.markAsSynced) {
      const payload = JSON.stringify(mergedState);
      try {
        localStorage.setItem(getScopedSaveGameKey(localSaveScope), payload);
        lastLocalSavePayloadRef.current = payload;
      } catch (error) {
        console.error("Failed to persist synced game state locally:", error);
      }
      lastCloudSavePayloadRef.current = payload;
      gameStateRef.current = mergedState;
    }

    setPonds(mergedState.ponds);
    setActivePondId(mergedState.activePondId);
    setZenPoints(mergedState.zenPoints);
    setFoodCount(mergedState.foodCount);
    setCornCount(mergedState.cornCount || 0);
    setHonorPoints(mergedState.honorPoints);
    setKoiNameCounter(mergedState.koiNameCounter);
    if (options.hydrateAchievements !== false) {
      setInitialAchievementData({
        unlockedIds: mergedState.achievements?.unlockedIds ?? [],
        claimedIds: mergedState.achievements?.claimedIds ?? [],
        totalPoints: mergedState.achievementPoints,
        scope: achievementScope,
      });
    }
    if (!options.silent) {
      setNotification({ message: "게임을 불러왔습니다.", type: 'success' });
    }
  };

  useEffect(() => {
    if (!user || user.isAnonymous || !isCloudSyncReady || cloudHydratedUserIdRef.current !== user.uid || isDuplicateTabPaused) return;

    return listenToGameData(user.uid, (cloudState, revision) => {
      if (serverMutationInProgressRef.current) return;
      const cloudPayload = JSON.stringify(cloudState);
      if (cloudPayload === lastCloudSavePayloadRef.current) {
        cloudGameStateRevisionRef.current = revision;
        return;
      }
      if (pendingCloudPayloadRef.current) return;

      const currentState = gameStateRef.current;
      const currentPayload = currentState ? JSON.stringify(currentState) : null;
      if (cloudPayload === currentPayload) {
        lastCloudSavePayloadRef.current = cloudPayload;
        cloudGameStateRevisionRef.current = revision;
        return;
      }

      cloudGameStateRevisionRef.current = revision;
      handleLoadGame(cloudState, { silent: true, markAsSynced: true, replace: true });
    });
  }, [user?.uid, isCloudSyncReady, isDuplicateTabPaused, localSaveScope]);

  const handleUpdateKoi = (koiId: string, updates: { genetics?: Partial<KoiGenetics>; growthStage?: GrowthStage }) => {
    setPonds((prev: Ponds) => {
      const activePond = prev[activePondId];
      if (!activePond) return prev;

      const updatedKois = activePond.kois.map(k => {
        if (k.id === koiId) {
          return {
            ...k,
            genetics: updates.genetics ? { ...k.genetics, ...updates.genetics } : k.genetics,
            growthStage: updates.growthStage !== undefined ? updates.growthStage : k.growthStage,
            // Update size if growth stage changed
            size: updates.growthStage === GrowthStage.FRY ? 4 : (updates.growthStage === GrowthStage.JUVENILE ? 8 : 12),
          };
        }
        return k;
      });

      return {
        ...prev,
        [activePondId]: { ...activePond, kois: updatedKois }
      };
    });
    setNotification({ message: '코이 정보가 업데이트되었습니다.', type: 'success' });
  };

  const handleSell = useCallback((koi: Koi) => {
    if (koiList.length <= 2) {
      setNotification({ message: '연못에는 최소 두 마리의 코이가 있어야 합니다!', type: 'error' });
      return;
    }

    const value = calculateKoiValue(koi);
    setZenPoints(prev => prev + value);
    audioManager.playSFX('coin');

    const animId = Date.now();
    setSellAnimations(prev => [...prev, { id: animId, value, position: koi.position }]);
    setTimeout(() => {
      setSellAnimations(prev => prev.filter(a => a.id !== animId));
    }, 1500);

    removeKoi(koi.id);
  }, [removeKoi, koiList.length]);

  const handleSellSelected = useCallback((kois: Koi[]) => {
    // Restriction: Ensure at least 2 koi remain
    if (koiList.length - kois.length < 2) {
      setNotification({ message: '연못에는 최소 두 마리의 코이가 있어야 합니다!', type: 'error' });
      return;
    }

    let totalValue = 0;
    kois.forEach(koi => {
      totalValue += calculateKoiValue(koi);
      removeKoi(koi.id);
    });
    setZenPoints(prev => prev + totalValue);
    audioManager.playSFX('coin');
  }, [removeKoi, setZenPoints, koiList.length]);

  const handleBreedKois = useCallback((parents: Koi[]) => {
    if (parents.length !== 2) return;
    if (zenPoints < BREEDING_COST) {
      setNotification({ message: '젠 포인트가 부족합니다!', type: 'error' });
      return;
    }

    const hasNonAdult = parents.some(k => k.growthStage !== GrowthStage.ADULT);
    if (hasNonAdult) {
      setNotification({ message: '성체 코이만 교배할 수 있습니다.', type: 'error' });
      return;
    }

    // Check Pond Capacity
    const remainingCapacity = 30 - koiList.length;
    if (remainingCapacity < 2) {
      setNotification({ message: '교배하려면 연못에 최소 2칸의 여유가 필요합니다! (최대 30마리)', type: 'error' });
      return;
    }

    const parent1 = parents[0];
    const parent2 = parents[1];

    // Check Stamina
    if ((parent1.stamina ?? 0) < 40 || (parent2.stamina ?? 0) < 40) {
      setNotification({ message: '부모 코이의 체력이 부족합니다! (최소 40 필요)', type: 'error' });
      return;
    }

    const offspringCount = Math.min(Math.floor(Math.random() * 4) + 2, remainingCapacity); // 2 to 5

    setZenPoints(p => p - BREEDING_COST);
    activePond && consumeStamina([parent1.id, parent2.id], 40); // Consume 40 stamina from each parent
    reduceWaterQuality(4);
    audioManager.playSFX('breed');

    const newKois: Koi[] = [];
    let currentCounter = koiNameCounter;

    for (let i = 0; i < offspringCount; i++) {
      const breedResult = breedKoi(parent1.genetics, parent2.genetics);
      const newKoi: Koi = {
        id: crypto.randomUUID(),
        name: `코이`,
        description: `${parent1.name}와 ${parent2.name}의 자손`,
        genetics: breedResult.genetics,
        position: { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 },
        velocity: { vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2 },
        age: 0,
        growthStage: GrowthStage.FRY,
        timesFed: 0,
        foodTargetId: null,
        feedCooldownUntil: null,
        stamina: 100,
      };
      newKois.push(newKoi);
      currentCounter++;
    }

    setKoiNameCounter(currentCounter);
    addKois(newKois);
    // No notification
    audioManager.playSFX('purchase');
  }, [zenPoints, koiList.length, koiNameCounter, addKois, setZenPoints, setNotification, audioManager, setKoiNameCounter, consumeStamina, activePond]);

  const handleMultiParentBreed = () => {
    const selectedKois = koiList.filter(k => breedingSelection.includes(k.id));
    handleBreedKois(selectedKois);
    setBreedingSelection([]);
  };

  const handleBuyPondExpansion = () => {
    const cost = 20000;
    if (zenPoints < cost) return;
    setZenPoints(p => p - cost);
    audioManager.playSFX('purchase');
    addPond();
    setIsShopModalOpen(false);
  }

  const handleBuyFood = (quantity: number) => {
    const cost = FOOD_PACK_PRICE * quantity;
    if (zenPoints < cost) return;
    setZenPoints(p => prevZen(p, cost));
    audioManager.playSFX('purchase');
    setFoodCount(c => c + (FOOD_PACK_AMOUNT * quantity));
    setIsShopModalOpen(false);
  }

  const handleBuyFoodLarge = (quantity: number) => {
    const cost = FOOD_LARGE_PACK_PRICE * quantity;
    if (zenPoints < cost) return;
    setZenPoints(p => prevZen(p, cost));
    audioManager.playSFX('purchase');
    setFoodCount(c => c + (FOOD_LARGE_PACK_AMOUNT * quantity));
    setIsShopModalOpen(false);
  }

  const handleBuyCorn = (quantity: number) => {
    const cost = CORN_PACK_PRICE * quantity;
    if (zenPoints < cost) return;
    setZenPoints(p => prevZen(p, cost));
    audioManager.playSFX('purchase');
    setCornCount(c => c + (CORN_PACK_AMOUNT * quantity));
    setIsShopModalOpen(false);
  }

  const handleBuyCornLarge = (quantity: number) => {
    const cost = CORN_LARGE_PACK_PRICE * quantity;
    if (zenPoints < cost) return;
    setZenPoints(p => prevZen(p, cost));
    audioManager.playSFX('purchase');
    setCornCount(c => c + (CORN_LARGE_PACK_AMOUNT * quantity));
    setIsShopModalOpen(false);
  }

  // Helper for zen points deduction
  const prevZen = (p: number, cost: number) => Math.max(0, p - cost);

  const handleBuyTrophy = useCallback(async (quantity: number) => {
    const totalCost = 100000 * quantity;
    if (zenPoints < totalCost) {
      setNotification({ message: '젠 포인트가 부족합니다!', type: 'error' });
      return;
    }

    try {
      let nextZenPoints = zenPoints - totalCost;
      let nextHonorPoints = (honorPoints || 0) + quantity;

      if (user && !user.isAnonymous) {
        if (!isCloudSyncReady || !achievementsLoaded || cloudHydratedUserIdRef.current !== user.uid) {
          setNotification({ message: '계정 저장을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', type: 'error' });
          return;
        }
        serverMutationInProgressRef.current = true;
        await flushCurrentGameState();
        const result = await purchaseHonorTrophies(quantity);
        nextZenPoints = result.zenPoints;
        nextHonorPoints = result.honorPoints;
        cloudGameStateRevisionRef.current = result.revision;
      }

      const immediateState: SavedGameState = {
        ...(gameStateRef.current ?? createInitialGameState()),
        schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
        zenPoints: nextZenPoints,
        honorPoints: nextHonorPoints,
      };
      gameStateRef.current = immediateState;
      setZenPoints(nextZenPoints);
      setHonorPoints(nextHonorPoints);
      persistLocalGameState(immediateState, localSaveScope);
      if (user && !user.isAnonymous) {
        // Persist any simulation changes that occurred while the server
        // purchase transaction was running, now using its returned revision.
        await enqueueCloudSave(user.uid, immediateState);
      }
      audioManager.playSFX('purchase');
      setNotification({ message: `명예 트로피 ${quantity}개를 구매했습니다!`, type: 'success' });
    } catch (error) {
      console.error('Trophy purchase failed:', error);
      setNotification({ message: '트로피 구매를 서버에 저장하지 못했습니다. 포인트는 차감되지 않았습니다.', type: 'error' });
    } finally {
      serverMutationInProgressRef.current = false;
    }
  }, [
    zenPoints,
    honorPoints,
    user,
    isCloudSyncReady,
    achievementsLoaded,
    flushCurrentGameState,
    persistLocalGameState,
    localSaveScope,
  ]);

  const handlePondPointerDown = useCallback((event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, koi?: Koi) => {
    // Feed Mode Logic
    if (isFeedModeActive) {
      // Food Logic (Normal / Corn)
      if (!koi) {
          const stopFeeding = () => {
            if (feedingIntervalRef.current) {
              clearInterval(feedingIntervalRef.current);
              feedingIntervalRef.current = null;
            }
            if (feedingDelayTimeoutRef.current) {
              clearTimeout(feedingDelayTimeoutRef.current);
              feedingDelayTimeoutRef.current = null;
            }
          };

          const executeDrop = (x: number, y: number, feedAmount: number) => {
            audioManager.playSFX('plop');
            dropFood({ x, y }, feedAmount);
            const dropAnimId = Date.now();
            setFoodDropAnimations(p => [...p, { id: dropAnimId, position: { x, y } }]);
            setTimeout(() => {
              setFoodDropAnimations(p => p.filter(a => a.id !== dropAnimId));
            }, 1000);
          };

          const dropSingleFood = (x: number, y: number) => {
            const { food, corn, type } = latestFoodCountsRef.current;

            if (type === 'corn') {
              if (corn <= 0) {
                stopFeeding();
                return;
              }
              setCornCount(prev => prev - 1);
              // Update ref immediately for interval consistency
              latestFoodCountsRef.current.corn -= 1;
              executeDrop(x, y, CORN_FEED_AMOUNT);
            } else if (type === 'normal') {
              if (food <= 0) {
                stopFeeding();
                return;
              }
              setFoodCount(prev => prev - 1);
              // Update ref immediately for interval consistency
              latestFoodCountsRef.current.food -= 1;
              executeDrop(x, y, 1);
            }
          };

          const pondRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const x = ((event.clientX - pondRect.left) / pondRect.width) * 100;
          const y = ((event.clientY - pondRect.top) / pondRect.height) * 100;
          lastPointerPosRef.current = { x, y };

          // Drop first pellet immediately
          dropSingleFood(x, y);

          // Start continuous dropping after a short delay (long press detection)
          if (!feedingIntervalRef.current && !feedingDelayTimeoutRef.current) {
            feedingDelayTimeoutRef.current = setTimeout(() => {
              feedingIntervalRef.current = setInterval(() => {
                if (lastPointerPosRef.current) {
                  dropSingleFood(lastPointerPosRef.current.x, lastPointerPosRef.current.y);
                }
              }, 100); // 100ms interval for faster feeding
            }, 250); // 250ms delay before continuous feeding starts
          }
      } else {
        setIsFeedModeActive(false);
      }
    }

    // Selection Logic
    if (koi && !isFeedModeActive) {
      audioManager.playSFX('click');
      if (breedingSelection.includes(koi.id)) {
        setBreedingSelection(prev => prev.filter(id => id !== koi.id));
      } else {
        setBreedingSelection(prev => [...prev, koi.id]);
      }
    } else if (!koi) {
      setBreedingSelection([]);
    }
  }, [isFeedModeActive, breedingSelection, foodCount, cornCount, selectedFoodType, dropFood, audioManager, setFoodDropAnimations]);

  const handlePondPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (feedingIntervalRef.current) {
      const pondRect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - pondRect.left) / pondRect.width) * 100;
      const y = ((event.clientY - pondRect.top) / pondRect.height) * 100;
      lastPointerPosRef.current = { x, y };
    }
  }, []);

  const handlePondPointerUp = useCallback(() => {
    if (feedingIntervalRef.current) {
      clearInterval(feedingIntervalRef.current);
      feedingIntervalRef.current = null;
    }
    if (feedingDelayTimeoutRef.current) {
      clearTimeout(feedingDelayTimeoutRef.current);
      feedingDelayTimeoutRef.current = null;
    }
    lastPointerPosRef.current = null;
  }, []);

  const handleToggleFeedMode = () => {
    setBreedingSelection([]);
    setIsFeedModeActive(prev => !prev);
    audioManager.playSFX('click');
  }

  const handleToggleMute = () => {
    const muted = audioManager.toggleMute();
    setIsMuted(muted);
  }

  const selectedKoisForBreeding = useMemo(() =>
    koiList.filter(k => breedingSelection.includes(k.id)),
    [koiList, breedingSelection]
  );

  const canBreed = useMemo(() => {
    if (breedingSelection.length !== 2 || zenPoints < BREEDING_COST) return false;
    const hasNonAdult = selectedKoisForBreeding.some(k => k.growthStage !== GrowthStage.ADULT);
    const hasLowStamina = selectedKoisForBreeding.some(k => (k.stamina ?? 0) < 40);
    return !hasNonAdult && !hasLowStamina;
  }, [breedingSelection, selectedKoisForBreeding, zenPoints]);

  const totalSellValue = useMemo(() => {
    return selectedKoisForBreeding.reduce((sum, koi) => sum + calculateKoiValue(koi), 0);
  }, [selectedKoisForBreeding]);

  const handleContinueInThisTab = useCallback(() => {
    tabLockRef.current?.takeOver();
    setNotification({ message: '이 탭에서 게임을 계속합니다.', type: 'success' });
  }, []);

  return (
    <div className="relative w-full h-[100svh] bg-gray-900 overflow-hidden select-none flex flex-col">
      <main
        className="flex-grow relative overflow-hidden touch-none"
      >
        <div
          className="w-full h-full"
        >
          <Pond
            gameState={'playing'}
            koiList={koiList}
            decorations={decorations}
            theme={currentTheme}
            onKoiClick={(e, koi) => {
              handlePondPointerDown(e, koi);
            }}
            onBackgroundClick={(e) => {
              handlePondPointerDown(e);
            }}
            onPointerMove={handlePondPointerMove}
            onPointerUp={handlePondPointerUp}
            isFeedModeActive={isFeedModeActive}
            updateKoiPositions={updateKoiPositions}
            isSellModeActive={false} // No separate sell mode currently
            breedingSelection={breedingSelection}
            sellAnimations={sellAnimations}
            feedAnimations={feedAnimations}
            foodDropAnimations={foodDropAnimations}
            foodPellets={foodPellets}
            onFoodEaten={handleFoodEaten}
            isNight={false}
            waterQuality={waterQuality}
          />
        </div>
      </main>

      {isDuplicateTabPaused && (
        <div
          className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-tab-title"
          aria-describedby="duplicate-tab-description"
        >
          <div className="w-full max-w-sm rounded-xl border border-orange-500/40 bg-gray-900 p-5 shadow-2xl text-center">
            <h2 id="duplicate-tab-title" className="text-lg font-black text-orange-300 mb-3">
              다른 탭에서 게임이 실행 중입니다
            </h2>
            <p id="duplicate-tab-description" className="text-sm leading-6 text-gray-300">
              저장 충돌을 막기 위해 이 탭의 자동 저장을 잠시 멈췄습니다.
              이 탭에서 계속하면 다른 탭이 일시 중지됩니다.
            </p>
            <button
              onClick={handleContinueInThisTab}
              className="mt-5 w-full rounded-lg bg-orange-600 px-4 py-3 font-bold text-white transition-colors hover:bg-orange-500"
              aria-label="이 탭에서 게임 계속하기"
            >
              이 탭에서 계속하기
            </button>
          </div>
        </div>
      )}

      {cloudSaveIssue && user && !user.isAnonymous && (
        <div
          className="absolute top-[calc(5rem+env(safe-area-inset-top))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-center text-sm leading-5 text-amber-950 shadow-xl"
          role="alert"
        >
          <p>{cloudSaveIssue}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-800"
          >
            다시 확인
          </button>
        </div>
      )}

      {/* Notification Toast */}
      {
        notification && (
          <div
            className={`absolute top-10 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1rem)] max-w-[36rem] px-3 py-3 rounded-lg shadow-xl font-bold leading-relaxed text-center break-words transition-all duration-300 whitespace-normal ${notification.type === 'error'
              ? 'bg-white text-red-600 border-2 border-red-600'
              : 'bg-white text-black border border-gray-300'
              }`}
          >
            {notification.message}
          </div>
        )
      }

      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] left-4 z-20 flex flex-col gap-2">
        <div className="bg-white/10 backdrop-blur-sm p-3 rounded-lg border border-white/10 min-w-[140px]">
          <p className="text-lg font-bold text-orange-300">{zenPoints.toLocaleString()} ZP</p>
        </div>

        {/* Water Quality Indicator - Interactive */}
        <div className="bg-white/10 backdrop-blur-sm p-3 rounded-lg border border-white/10 flex items-center gap-2 min-w-[140px]">
          <div className="flex flex-col items-start leading-none">
            <span className="text-[10px] text-white/70">수질</span>
            <span className={`text-sm font-bold ${waterQuality < 50 ? 'text-red-400' : 'text-white'}`}>
              {Math.round(waterQuality)}%
            </span>
          </div>
          <button
            onClick={handleCleanPond}
            className="ml-auto text-xs bg-orange-600 hover:bg-orange-500 text-white font-bold px-2 py-1 rounded transition-colors"
            aria-label="연못 청소하기"
          >
            + 청소
          </button>
        </div>
      </div>

      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-20 flex items-center gap-2">
        <button
          onClick={() => setIsSaveLoadModalOpen(true)}
          className="bg-white/10 backdrop-blur-sm p-3 rounded-full border border-white/20 text-white hover:text-orange-400 transition-colors hover:bg-white/20 hover:border-white/30"
          aria-label="설정 메뉴"
          title="설정 메뉴 (저장/불러오기/새 게임)"
        >
          <Settings size={22} strokeWidth={1.5} />
        </button>

        {/* Profile Section - Unified Circular Icon Only */}
        <button
          onClick={() => {
            if (authLoading) return;
            // Anonymous Firebase auth is only the implementation detail for
            // the local guest namespace. Guests should see the auth choices,
            // not an account modal with a misleading "로그아웃" action.
            if (!user || user.isAnonymous) setIsAuthModalOpen(true);
            else setIsAccountModalOpen(true);
          }}
          disabled={authLoading}
          className="bg-white/10 backdrop-blur-sm p-0 rounded-full border border-white/20 text-white hover:text-orange-400 transition-colors hover:bg-white/20 hover:border-white/30 w-[46px] h-[46px] overflow-hidden flex items-center justify-center group disabled:cursor-wait disabled:hover:text-white disabled:hover:bg-white/10"
          title={authLoading ? '로그인 상태 확인 중' : user && !user.isAnonymous ? `${user.displayName || userNickname || '사용자'} 님` : '로그인 또는 회원가입'}
          aria-label={authLoading ? '로그인 상태 확인 중' : user && !user.isAnonymous ? '계정 정보 열기' : '로그인 창 열기'}
        >
          {authLoading ? (
            <LoaderCircle size={24} strokeWidth={1.7} className="animate-spin text-white/85" aria-hidden="true" />
          ) : user && (userPhotoURL ?? user.photoURL) ? (
            <img
              src={(userPhotoURL ?? user.photoURL)!.replace(/^http:\/\//i, 'https://')}
              alt="Profile"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/80 group-hover:text-orange-400">
              <User size={24} strokeWidth={1.5} />
            </div>
          )}
        </button>
      </div>

      {
        breedingSelection.length > 0 && (
          <div className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-3 w-full max-w-xs px-4">

            {/* Selection Indicators */}
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-full p-2 shadow-lg">
              {selectedKoisForBreeding.map(k => {
                return (
                  <KoiCSSPreview
                    key={k.id}
                    koi={k}
                    className="w-10 h-10 border border-white/70 shadow-sm"
                  />
                )
              })}
            </div>

            <div className="flex flex-col gap-2 w-full">
              {/* Breed Button - Only if exactly 2 selected */}
              {breedingSelection.length === 2 && (
                <button
                  onClick={handleMultiParentBreed}
                  disabled={!canBreed}
                  className="w-full h-10 flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-0 px-4 rounded-xl shadow-lg transition-all hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-sm"
                  aria-label={`${selectedKoisForBreeding.length}마리 코이 교배하기`}
                >
                  <Dna size={18} />
                  교배 ({BREEDING_COST} ZP)
                </button>
              )}

              {/* Sell Button - Always visible if selection > 0 */}
              <button
                onClick={() => handleSellSelected(selectedKoisForBreeding)}
                className="w-full h-10 flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-0 px-4 rounded-xl shadow-lg transition-all hover:bg-red-500 text-sm"
                aria-label={`${selectedKoisForBreeding.length}마리 코이 판매하기`}
              >
                <DollarSign size={18} />
                판매 (+{totalSellValue} ZP)
              </button>

              {/* Warning Message for disabled breeding - Below Sell Button */}
              {breedingSelection.length === 2 && !canBreed && (
                <div className="text-red-400 text-xs text-center font-bold bg-black/50 p-1 rounded">
                  {selectedKoisForBreeding.some(k => k.growthStage !== GrowthStage.ADULT)
                    ? "성체 코이만 교배 가능합니다."
                    : selectedKoisForBreeding.some(k => (k.stamina ?? 0) < 40)
                      ? "체력이 부족합니다. (최소 40)"
                      : "젠 포인트가 부족합니다."}
                </div>
              )}
            </div>
          </div>
        )
      }

      <ControlBar
        onShopClick={() => {
          audioManager.playSFX('click');
          setIsShopModalOpen(true);
        }}
        isFeedModeActive={isFeedModeActive}
        onToggleFeedMode={handleToggleFeedMode}
        foodCount={foodCount}
        cornCount={cornCount}
        selectedFoodType={selectedFoodType}
        onSelectFoodType={setSelectedFoodType}
        onPondInfoClick={() => {
          audioManager.playSFX('click');
          setIsPondInfoModalOpen(true);
        }}
        onThemeClick={() => {
          audioManager.playSFX('click');
          setIsThemeModalOpen(true);
        }}
        onRankingClick={() => {
          audioManager.playSFX('click');
          setIsRankingModalOpen(true);
        }}
        onAchievementClick={() => {
          audioManager.playSFX('click');
          setIsAchievementModalOpen(true);
        }}
        hasUnclaimedAchievements={hasUnclaimedRewards}
      />

      {
        isShopModalOpen && (
          <ShopModal
            onClose={() => setIsShopModalOpen(false)}
            zenPoints={zenPoints}
            onBuyFood={handleBuyFood}
            onBuyFoodLarge={handleBuyFoodLarge}
            onBuyCorn={handleBuyCorn}
            onBuyCornLarge={handleBuyCornLarge}
            onBuyTrophy={handleBuyTrophy}
            onBuyPond={handleBuyPondExpansion}
            pondCount={Object.keys(ponds).length}
          />
        )
      }
      {
        isThemeModalOpen && (
          <ThemeModal
            onClose={() => setIsThemeModalOpen(false)}
            zenPoints={zenPoints}
            currentTheme={currentTheme}
            onSelectTheme={(theme, cost) => {
              // Theme logic handles cost but here we assume free or handled
              setPondTheme(theme);
              setIsThemeModalOpen(false);
            }}
          />
        )
      }
      {
        isCleanConfirmOpen && (
          <CleanConfirmModal
            onClose={() => setIsCleanConfirmOpen(false)}
            onConfirm={confirmCleanPond}
            cost={CLEANING_COST}
            zenPoints={zenPoints}
          />
        )
      }
      {/* Settings Modal */}
      <SaveLoadModal
        isOpen={isSaveLoadModalOpen}
        onClose={() => setIsSaveLoadModalOpen(false)}
        onNewGame={handleNewGame}
        isNight={false} // Perpetual day by request
        onToggleDayNight={() => { }}
      />

      {/* Account Modal */}
      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        userNickname={userNickname}
        profilePhotoURL={userPhotoURL}
        onSaveProfile={handleSaveProfile}
        onBeforeAccountChange={flushCurrentGameState}
        onLogoutCleanup={handleLogoutCleanup}
      />
      {
        isPondInfoModalOpen && <PondInfoModal
          onClose={() => setIsPondInfoModalOpen(false)}
          ponds={ponds}
          activePondId={activePondId}
          onPondChange={setActivePondId}
          koiList={koiList}
          onSell={handleSellSelected}
          onBreed={handleBreedKois}
          onMove={(kois, targetPondId) => {
            moveKoi(kois.map(k => k.id), targetPondId);
            setIsPondInfoModalOpen(false);
            setNotification({ message: '코이들이 새로운 연못으로 이사했습니다!', type: 'success' });
          }}
        />
      }
      {
        isInfoModalOpen && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setIsInfoModalOpen(false)}>
            <div className="bg-gray-800 p-6 rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto border border-gray-700 shadow-xl custom-scrollbar glass-panel" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-orange-300">Koiworld</h2>
                <button onClick={() => setIsInfoModalOpen(false)} className="text-gray-400 hover:text-white" aria-label="게임 정보 닫기"><X /></button>
              </div>
              <p className="text-gray-300 mb-4">당신만의 평온한 코이 연못에 오신 것을 환영합니다. 아름다운 코이를 키우고, 교배하여 새로운 품종을 발견하세요.</p>
              <div className="space-y-3 text-gray-400">
                <p><strong className="text-white">교배:</strong> 연못의 코이를 클릭하여 교배할 부모를 선택하세요. 밝은 코이끼리 교배하면 크림색에, 어두운 코이끼리 교배하면 검은색에 가까운 자손을 얻을 수 있습니다. 성체 코이만 교배할 수 있습니다. 교배 후에도 부모는 사라지지 않습니다.</p>
                <p><strong className="text-white">성장:</strong> <Wheat size={16} className="inline-block" /> 먹이주기 모드를 활성화하고 연못 바닥을 클릭하여 먹이를 주세요. 치어는 성체로 성장합니다.</p>
                <p><strong className="text-white">판매:</strong> <DollarSign size={16} className="inline-block" /> 연못 현황 목록에서 코이를 선택하여 판매하고 젠 포인트를 얻으세요. 희귀한 색상이나 특별한 품종을 교배하고 더 많이 성장시킨 코이일수록 높은 가치를 가집니다.</p>
                <p><strong className="text-white">상점:</strong> <ShoppingCart size={16} className="inline-block" /> 상점에서 먹이를 구매하여 코이를 성장시키세요.</p>
                <p><strong className="text-white">저장:</strong> 게임 진행 상황은 당신의 브라우저에 자동으로 저장됩니다. 언제든지 다시 돌아와 연못을 돌보세요.</p>

                <div className="mt-4 pt-4 border-t border-gray-700">
                  <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                    <Dna size={18} className="text-orange-400" /> 열성 유전자 가이드
                  </h3>
                  <div className="text-sm space-y-3 bg-gray-900/50 p-3 rounded border border-gray-700 text-gray-300 glass-section">
                    <p>
                      <span className="text-orange-300 font-bold block mb-1">🔍 숨겨진 색상 (Recessive Genes)</span>
                      코이는 겉으로 보이는 색 외에도 <strong className="text-white">수많은 숨겨진 색상 유전자</strong>를 가질 수 있습니다.
                      상세 정보창에서 코이가 보유한 모든 유전자 목록을 확인할 수 있습니다.
                    </p>

                    <p>
                      <span className="text-orange-400 font-bold block mb-1">🎨 색상 발현 규칙</span>
                      특정 색상이 눈에 보이려면, 그 색상의 유전자를 <strong className="text-white">최소 2개 이상</strong> 가지고 있어야 합니다.
                      <br />
                      <span className="text-xs text-gray-500 mt-1 block">예: [빨강, 빨강] → 빨강 발현 / [빨강, 검정] → 크림색(기본)</span>
                    </p>

                    <p>
                      <span className="text-purple-400 font-bold block mb-1">🧬 유전과 변이</span>
                      자손은 부모의 유전자를 무작위로 물려받습니다.
                      가끔 <strong className="text-white">새로운 유전자가 추가</strong>되거나 돌연변이가 발생하여 유전자 풀이 점점 넓어집니다.
                      다양한 코이를 교배하여 숨겨진 희귀 색상을 찾아보세요!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      }

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <SessionConflictModal
        isOpen={isConflictOpen}
        onResolve={() => {
          if (user && !user.isAnonymous) {
            startSession(user.uid).then(() => {
              setIsConflictOpen(false);
              setNotification({ message: '세션이 복구되었습니다.', type: 'success' });
            });
          }
        }}
        onLogout={async () => {
          suppressLocalGameSave();
          try {
            await logoutFromContext();
          } finally {
            window.location.reload();
          }
        }}
      />

      {/* Spot Genetics Debug Panel - shows first selected koi's genes */}
      {/* Spot Genetics Debug Panel - shows first selected koi's genes */}
      {import.meta.env.DEV && (
        <SpotGeneticsDebugPanel
          koi={selectedKoisForBreeding[0] || null}
          zenPoints={zenPoints}
          onSetZenPoints={(points) => setZenPoints(points)}
          onSpawnKoi={(genetics, growthStage) => {
            // Create new koi with custom genetics and growth stage
            const newKoi: Koi = {
              id: crypto.randomUUID(),
              name: `코이`,
              description: '디버그 패널에서 생성된 코이입니다.',
              genetics: {
                baseColorGenes: genetics.baseColorGenes || [GeneType.CREAM, GeneType.CREAM],
                spots: genetics.spots || [],
                lightness: genetics.lightness ?? 50,
                saturation: genetics.saturation ?? 50,

                spotPhenotypeGenes: genetics.spotPhenotypeGenes,
              },
              position: { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 },
              velocity: { vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2 },
              age: growthStage === GrowthStage.FRY ? 0 : (growthStage === GrowthStage.JUVENILE ? 50 : 100),
              growthStage: growthStage || GrowthStage.FRY,
              timesFed: 0,
              foodTargetId: null,
              feedCooldownUntil: null,
              stamina: 100,
            };
            addKois([newKoi]);
            setNotification({ message: '새로운 코이가 생성되었습니다.', type: 'success' });
          }}
          onUpdateKoi={handleUpdateKoi}
        />
      )}

      <RankingModal
        isOpen={isRankingModalOpen}
        onClose={() => setIsRankingModalOpen(false)}
        userNickname={resolvedUserNickname}
        myHonorPoints={honorPoints}
        isLoggedIn={!!user && !user.isAnonymous}
        currUserId={localSaveScope ?? undefined}
        myAchievementPoints={achievementScore}
      />

      <AchievementModal
        isOpen={isAchievementModalOpen}
        onClose={() => setIsAchievementModalOpen(false)}
        achievements={achievements}
        unlockedIds={unlockedIds}
        claimedIds={claimedIds}
        totalPoints={achievementScore}
        onClaim={handleClaimReward}
      />

    </div >
  );
};
