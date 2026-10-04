/// <reference types="vite/client" />
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Pond } from './components/Pond';
import { ControlBar } from './components/ControlBar';
import { ShopModal } from './components/ShopModal';
import { PondInfoModal } from './components/PondInfoModal';
import { SaveLoadModal } from './components/SaveLoadModal';
import { AccountModal } from './components/AccountModal';
import { CommunityModal } from './components/CommunityModal';
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
import { readLocalSave, writeLocalSave, acceptCloudSave, acknowledgeLocalSave, archiveLocalSave, chooseSaveSource } from './services/saveJournal';
import { SavePolicy, progressKey } from './services/savePolicy';

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

    if (savedData) return readLocalSave(uid)?.gameState ?? null;

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
  const [isCommunityOpen, setIsCommunityOpen] = useState(false);

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
  const [localSaveIssue, setLocalSaveIssue] = useState(false);
  const [localSavedAt, setLocalSavedAt] = useState<number | null>(null);
  const [cloudSavedAt, setCloudSavedAt] = useState<number | null>(null);
  const [isCloudSaving, setIsCloudSaving] = useState(false);
  const [hasPendingCloudSave, setHasPendingCloudSave] = useState(false);
  const [isAccountRestoring, setIsAccountRestoring] = useState(true);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [saveChoice, setSaveChoice] = useState<{ uid: string; local: SavedGameState; cloud: SavedGameState; revision: number } | null>(null);
  const [isChoosingSave, setIsChoosingSave] = useState(false);
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
  const saveGenerationRef = useRef(0);
  const serverMutationInProgressRef = useRef(false);
  const savePolicyRef = useRef(new SavePolicy());
  const localProgressKeyRef = useRef<string | null>(null);
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
      writeLocalSave(uid, state, uid ? cloudGameStateRevisionRef.current : null);
      lastLocalSavePayloadRef.current = payload;
      setLocalSavedAt(Date.now());
      setLocalSaveIssue(false);
      if (uid) setHasPendingCloudSave(payload !== lastCloudSavePayloadRef.current);
    } catch (error) {
      setLocalSaveIssue(true);
      throw error;
    }
    return payload;
  }, []);

  // 중요한 변화는 React 상태 반영 직후 기기에 남깁니다. 연속 변화 때문에
  // 정기 타이머가 밀리거나 앱 종료 이벤트가 생략되어도 마지막 진행도를 보호합니다.
  useEffect(() => {
    const state = gameStateRef.current;
    if (!state || authLoading || isAccountRestoring || !achievementsLoaded || isDuplicateTabPaused
        || isLocalGameSaveSuppressed() || serverMutationInProgressRef.current
        || localHydratedScopeRef.current !== (localSaveScope ?? 'guest')) return;
    savePolicyRef.current.observe(state, Date.now());
    const key = progressKey(state);
    if (key === localProgressKeyRef.current) return;
    try {
      persistLocalGameState(state, localSaveScope);
      localProgressKeyRef.current = key;
    } catch { /* 정기 저장과 사용자 재시도에서 다시 확인합니다. */ }
  }, [ponds, activePondId, zenPoints, foodCount, cornCount, honorPoints, achievementScore,
      unlockedIds, claimedIds, koiNameCounter, localSaveScope, authLoading, isAccountRestoring,
      achievementsLoaded, isDuplicateTabPaused, persistLocalGameState]);

  const enqueueCloudSave = useCallback((uid: string, state: SavedGameState) => {
    const generation = saveGenerationRef.current;
    const payload = JSON.stringify(state);
    if (pendingCloudPayloadRef.current === payload) return cloudSaveQueueRef.current;
    pendingCloudPayloadRef.current = payload;
    setIsCloudSaving(true);

    const nextSave = cloudSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== saveGenerationRef.current) throw new Error('Save session changed.');
        if (isLocalGameSaveSuppressed() || cloudSaveBlockedRef.current) {
          if (pendingCloudPayloadRef.current === payload) {
            pendingCloudPayloadRef.current = null;
            setIsCloudSaving(false);
          }
          throw new Error('Cloud saving is paused.');
        }

        try {
          const expectedRevision = cloudGameStateRevisionRef.current;
          if (expectedRevision === null) {
            throw new Error('Cloud save was attempted before the account state was hydrated.');
          }
          const saved = await saveGameToCloud(uid, state, expectedRevision, 'auto');
          if (generation !== saveGenerationRef.current) throw new Error('Save session changed.');
          cloudGameStateRevisionRef.current = saved.revision;
          lastCloudSavePayloadRef.current = payload;
          savePolicyRef.current.confirmed(state, Date.now());
          setCloudSavedAt(Date.now());
          setHasPendingCloudSave(JSON.stringify(gameStateRef.current) !== payload);
          // 서버 쓰기가 성공했다면 기기 저장 실패와 구분합니다. 이전 리비전으로
          // 같은 요청을 재전송하면 불필요한 충돌이 생길 수 있습니다.
          try { acknowledgeLocalSave(uid, state, saved.revision); }
          catch { setLocalSaveIssue(true); }
          setCloudSaveIssue(null);
        } catch (error) {
          if (generation !== saveGenerationRef.current) throw error;
          savePolicyRef.current.failed(Date.now());
          setHasPendingCloudSave(true);
          if (error instanceof GameStateRevisionConflictError) {
            cloudSaveBlockedRef.current = true;
            setIsCloudSyncReady(false);
            setCloudSaveIssue('다른 기기의 저장본이 확인되었습니다. 이 기기의 진행도도 보관하고 있어요. 다시 확인을 눌러 이어갈 저장본을 선택해주세요.');
          } else {
            setCloudSaveIssue('클라우드 저장이 완료되지 않았습니다. 네트워크를 확인하면 자동으로 다시 시도합니다. 로그아웃 전에는 반드시 저장 상태를 확인해주세요.');
          }
          throw error;
        } finally {
          if (generation === saveGenerationRef.current && pendingCloudPayloadRef.current === payload) {
            pendingCloudPayloadRef.current = null;
            setIsCloudSaving(false);
          }
        }
      });

    cloudSaveQueueRef.current = nextSave;
    return nextSave;
  }, []);

  const flushCurrentGameState = useCallback(async () => {
    const currentState = gameStateRef.current;
    if (!currentState || isDuplicateTabPaused || isLocalGameSaveSuppressed()
        || localHydratedScopeRef.current !== (localSaveScope ?? 'guest')) {
      if (user && !user.isAnonymous) throw new Error('Account save is not ready.');
      return;
    }
    const payload = persistLocalGameState(currentState, localSaveScope);
    if (!user || user.isAnonymous) return;
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
    }

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

  // 계정별 미전송 기록을 확인한 뒤 클라우드 쓰기와 플레이를 허용합니다.
  useEffect(() => {
    let cancelled = false;
    saveGenerationRef.current += 1;
    const initSession = async () => {
      setIsAccountRestoring(true);
      setSaveChoice(null);
      setCloudSaveIssue(null);
      setLocalSaveIssue(false);
      setLocalSavedAt(null);
      setCloudSavedAt(null);
      setIsCloudSaving(false);
      setHasPendingCloudSave(false);
      savePolicyRef.current = new SavePolicy();
      localProgressKeyRef.current = null;
      lastLocalSavePayloadRef.current = null;
      cloudHydratedUserIdRef.current = null;
      cloudGameStateRevisionRef.current = null;
      cloudSaveBlockedRef.current = false;
      pendingCloudPayloadRef.current = null;
      lastCloudSavePayloadRef.current = null;
      localHydratedScopeRef.current = null;
      setIsCloudSyncReady(false);
      suppressLocalGameSave();
      if (authLoading) return;
      try {
        if (!user || user.isAnonymous) {
          handleLoadGame(loadGameState(null) ?? createInitialGameState(), { silent: true, hydrateAchievements: true });
          localHydratedScopeRef.current = 'guest';
          setIsAccountRestoring(false);
          return;
        }
        const local = readLocalSave(user.uid);
        const fallbackState = local?.gameState ?? loadGameState(null) ?? createInitialGameState();
        const existing = await loadUserDataOnce(user.uid);
        if (cancelled) return;
        let state: SavedGameState;
        let revision: number;
        if (existing === null || existing.canInitializeGameState) {
          // 첫 게임 저장을 먼저 완료합니다. 프로필만 남은 구버전의 실패도
          // 서버가 빈 계정임을 확인한 경우에 한해 재시도합니다.
          writeLocalSave(user.uid, fallbackState, 0);
          const saved = await saveGameToCloud(user.uid, fallbackState, existing?.gameDataRevision ?? 0, 'new-account');
          revision = saved.revision;
          state = saved.gameState;
        } else if (existing.gameData) {
          revision = existing.gameDataRevision;
          const source = chooseSaveSource(local, existing.gameData, revision);
          if (source === 'choose') {
            setSaveChoice({ uid: user.uid, local: local!.gameState, cloud: existing.gameData, revision });
            return;
          }
          state = source === 'local' ? local!.gameState : existing.gameData;
          if (source === 'local') {
            const saved = await saveGameToCloud(user.uid, state, revision, 'auto');
            revision = saved.revision;
            state = saved.gameState;
          }
          if (existing.gameDataSource === 'backup') {
            setNotification({ message: '최근 클라우드 백업으로 저장 데이터를 복구했습니다.', type: 'info' });
          }
        } else {
          throw new Error('이 계정의 저장본을 복구하지 못했습니다. 기존 데이터는 보존되어 있습니다.');
        }
        if (cancelled) return;
        // 프로필 연결이 실패해도 완료된 게임 저장은 다음 시도에서 복구할 수 있습니다.
        acceptCloudSave(user.uid, state, revision);
        const [nickname] = await Promise.all([
          ensureUserProfileNickname(user.uid, user.displayName, user.email, user.photoURL),
          startSession(user.uid),
        ]);
        if (cancelled) return;
        cloudGameStateRevisionRef.current = revision;
        handleLoadGame(state, { silent: true, markAsSynced: true, hydrateAchievements: true });
        setUserNickname(nickname);
        setUserPhotoURL(existing?.photoURL ?? user.photoURL ?? null);
        cloudHydratedUserIdRef.current = user.uid;
        localHydratedScopeRef.current = user.uid;
        setIsCloudSyncReady(true);
        setIsAccountRestoring(false);
      } catch (error) {
        if (!cancelled) {
          console.error('Account restore failed:', error);
          setCloudSaveIssue('저장 데이터를 확인하지 못했습니다. 진행 상황을 안전하게 불러온 뒤 계속할 수 있어요. 인터넷 연결을 확인하고 다시 시도해주세요.');
        }
      } finally {
        if (!cancelled) resumeLocalGameSave();
      }
    };
    void initSession();
    return () => { cancelled = true; };
  }, [user?.uid, user?.isAnonymous, authLoading, restoreAttempt]);

  const retryAccountRestore = () => {
    if (isCloudSyncReady && !cloudSaveBlockedRef.current) {
      void flushCurrentGameState().catch(() => undefined);
      return;
    }
    if (!user || user.isAnonymous) {
      void flushCurrentGameState().then(() => setCloudSaveIssue(null)).catch(() => undefined);
      return;
    }
    if (gameStateRef.current && localHydratedScopeRef.current === localSaveScope && !isLocalGameSaveSuppressed()) {
      try { persistLocalGameState(gameStateRef.current, localSaveScope); } catch { return; }
    }
    setRestoreAttempt(attempt => attempt + 1);
  };

  const resolveSaveChoice = async (source: 'local' | 'cloud') => {
    if (!saveChoice || isChoosingSave || saveChoice.uid !== user?.uid) return;
    setIsChoosingSave(true);
    try {
      archiveLocalSave(saveChoice.uid);
      let revision = saveChoice.revision;
      let state = source === 'local' ? saveChoice.local : saveChoice.cloud;
      // 양쪽 원본은 기기 복구 사본과 서버 백업에 보관됩니다. 선택 이후
      // 다른 기기가 저장했다면 서버 리비전 검사가 덮어쓰기를 거부합니다.
      if (source === 'local') {
        const saved = await saveGameToCloud(saveChoice.uid, state, revision, 'backup-recovery');
        revision = saved.revision;
        state = saved.gameState;
      }
      acceptCloudSave(saveChoice.uid, state, revision);
      setSaveChoice(null);
      setRestoreAttempt(attempt => attempt + 1);
    } catch (error) {
      setCloudSaveIssue('저장본을 적용하지 못했습니다. 두 진행도는 보관되어 있습니다. 다시 확인해주세요.');
      if (error instanceof GameStateRevisionConflictError) setRestoreAttempt(attempt => attempt + 1);
    } finally { setIsChoosingSave(false); }
  };

  // 기기에는 2초 간격으로 기록하고, 서버에는 중요한 변화 또는 60초 주기로 저장합니다.
  // 통신이 느릴 때는 요청을 쌓지 않고 다음 차례에 최신 상태 한 건만 전송합니다.
  useEffect(() => {
    const saveInterval = setInterval(() => {
      const state = gameStateRef.current;
      if (!state || authLoading || isAccountRestoring || !achievementsLoaded
          || isDuplicateTabPaused || isLocalGameSaveSuppressed() || serverMutationInProgressRef.current
          || localHydratedScopeRef.current !== (localSaveScope ?? 'guest')) return;
      const payload = JSON.stringify(state);
      try {
        if (payload !== lastLocalSavePayloadRef.current || localSaveIssue) persistLocalGameState(state, localSaveScope);
      } catch { /* 기기 저장 오류가 나도 서버 저장을 시도해 진행도를 보호합니다. */ }
      if (!user || user.isAnonymous || !isCloudSyncReady || cloudSaveBlockedRef.current
          || cloudHydratedUserIdRef.current !== user.uid) return;
      savePolicyRef.current.observe(state, Date.now());
      if (!navigator.onLine || pendingCloudPayloadRef.current || payload === lastCloudSavePayloadRef.current
          || !savePolicyRef.current.due(Date.now())) return;
      void enqueueCloudSave(user.uid, state).catch(() => undefined);
    }, 2000);
    return () => clearInterval(saveInterval);
  }, [user?.uid, user?.isAnonymous, localSaveScope, authLoading, isAccountRestoring, localSaveIssue,
      isCloudSyncReady, achievementsLoaded, isDuplicateTabPaused, enqueueCloudSave, persistLocalGameState]);

  // 이미 불러온 계정은 연결 복구/앱 복귀 시 미전송 진행도를 전송합니다.
  // 첫 실행에서 서버 확인에 실패했다면 먼저 계정 복구를 재시도합니다.
  useEffect(() => {
    const reconnect = () => {
      if (!navigator.onLine || isDuplicateTabPaused || saveChoice || serverMutationInProgressRef.current) return;
      if (isAccountRestoring) {
        if (cloudSaveIssue) setRestoreAttempt(attempt => attempt + 1);
        return;
      }
      if (!isCloudSyncReady || cloudSaveBlockedRef.current || pendingCloudPayloadRef.current) return;
      void flushCurrentGameStateRef.current().catch(() => undefined);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reconnect(); };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAccountRestoring, cloudSaveIssue, isCloudSyncReady, isDuplicateTabPaused, saveChoice]);

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
        serverMutationInProgressRef.current = true;
        await flushCurrentGameState();
        suppressLocalGameSave();
        const expectedRevision = cloudGameStateRevisionRef.current;
        if (expectedRevision === null) {
          throw new Error('Cloud reset was attempted before the account state was hydrated.');
        }
        const saved = await saveGameToCloud(user.uid, initialState, expectedRevision, 'explicit-reset');
        cloudGameStateRevisionRef.current = saved.revision;
        Object.assign(initialState, saved.gameState);
      } catch (error) {
        console.error("Failed to reset cloud game state:", error);
        resumeLocalGameSave();
        serverMutationInProgressRef.current = false;
        setNotification({ message: '새 게임을 저장하지 못했습니다. 기존 진행도는 유지됩니다.', type: 'error' });
        return false;
      }
    }

    suppressLocalGameSave();
    try {
      if (localSaveScope) acceptCloudSave(localSaveScope, initialState, cloudGameStateRevisionRef.current!);
      else writeLocalSave(null, initialState, null);
      localStorage.removeItem('zenPoints');
    } catch {
      resumeLocalGameSave();
      serverMutationInProgressRef.current = false;
      setNotification({ message: '기기 저장 공간을 확인해주세요. 저장 상태를 다시 확인합니다.', type: 'error' });
      setRestoreAttempt(attempt => attempt + 1);
      return false;
    }

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
        if (localSaveScope && cloudGameStateRevisionRef.current !== null) {
          acceptCloudSave(localSaveScope, mergedState, cloudGameStateRevisionRef.current);
        }
        lastLocalSavePayloadRef.current = payload;
        setLocalSavedAt(Date.now());
        setLocalSaveIssue(false);
      } catch (error) {
        setLocalSaveIssue(true);
        console.error("Failed to persist synced game state locally:", error);
      }
      lastCloudSavePayloadRef.current = payload;
      savePolicyRef.current.confirmed(mergedState, Date.now());
      setCloudSavedAt(Date.now());
      setHasPendingCloudSave(false);
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
      if (serverMutationInProgressRef.current || revision <= (cloudGameStateRevisionRef.current ?? -1)) return;
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

      if (currentState && currentPayload !== lastCloudSavePayloadRef.current) {
        try { persistLocalGameState(currentState, user.uid); } catch { return; }
        localHydratedScopeRef.current = null;
        setIsCloudSyncReady(false);
        setIsAccountRestoring(true);
        setSaveChoice({ uid: user.uid, local: currentState, cloud: cloudState, revision });
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

  const saveStatusLabel = localSaveIssue ? '기기 저장 오류'
    : isAccountRestoring ? '저장 확인 중'
    : isDuplicateTabPaused ? '저장 일시 중지'
    : !localSaveScope ? (localSavedAt ? '기기에 저장됨' : '기기 저장 중')
    : isCloudSaving ? '서버 저장 중'
    : cloudSaveIssue || hasPendingCloudSave ? '동기화 대기' : '서버 저장 완료';

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

      {(isAccountRestoring || saveChoice) && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-slate-800 shadow-xl">
            <h2 id="restore-title" className="text-lg font-semibold">{saveChoice ? '어떤 진행도로 이어갈까요?' : cloudSaveIssue ? '저장 확인이 필요해요' : '연못을 불러오고 있어요'}</h2>
            {saveChoice ? <>
              <p className="mt-3 text-sm leading-6 text-slate-500">기기와 클라우드에 서로 다른 진행도가 있어요. 계속할 저장본을 선택해주세요. 선택 전의 저장본도 복구용으로 보관합니다.</p>
              <div className="mt-5 grid gap-3">
                {(['local', 'cloud'] as const).map(source => {
                  const state = saveChoice[source];
                  return <button key={source} type="button" disabled={isChoosingSave} onClick={() => void resolveSaveChoice(source)} className="rounded-xl border border-slate-200 p-4 text-left hover:border-orange-400 disabled:opacity-50">
                    <span className="block font-semibold">{source === 'local' ? '이 기기의 진행도' : '클라우드 진행도'}</span>
                    <span className="mt-1 block text-sm text-slate-500">코이 {Object.values(state.ponds).reduce((sum, pond) => sum + pond.kois.length, 0)}마리 · {state.zenPoints.toLocaleString()} ZP</span>
                  </button>;
                })}
              </div>
              {cloudSaveIssue && <p className="mt-3 text-sm text-amber-700" role="alert">{cloudSaveIssue}</p>}
            </> : cloudSaveIssue ? <>
              <p className="mt-3 text-sm leading-6 text-slate-500" role="alert">{cloudSaveIssue}</p>
              <button type="button" onClick={retryAccountRestore} className="mt-5 w-full rounded-xl bg-orange-500 py-3 font-semibold text-white">다시 시도</button>
            </> : <LoaderCircle className="mt-5 animate-spin text-orange-500" aria-label="불러오는 중" />}
          </div>
        </div>
      )}

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

      {(cloudSaveIssue || localSaveIssue) && !isAccountRestoring && !saveChoice && (
        <div
          className="absolute top-[calc(5rem+env(safe-area-inset-top))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-center text-sm leading-5 text-amber-950 shadow-xl"
          role="alert"
        >
          <p>{localSaveIssue ? '기기 임시 저장에 실패했습니다. 저장 공간을 확인하고 다시 시도해주세요.' : cloudSaveIssue}</p>
          <button
            type="button"
            onClick={retryAccountRestore}
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
        saveStatusLabel={saveStatusLabel}
        localSavedAt={localSavedAt}
        cloudSavedAt={cloudSavedAt}
        isCloudSaving={isCloudSaving}
        onSaveNow={() => { void flushCurrentGameState().catch(() => undefined); }}
        onCommunityClick={() => { setIsSaveLoadModalOpen(false); setIsCommunityOpen(true); }}
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

      <CommunityModal isOpen={isCommunityOpen} onClose={() => setIsCommunityOpen(false)} />
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
