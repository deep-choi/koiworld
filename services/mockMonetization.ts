// 로컬 미리보기(npm run dev:mock) 전용 결제·광고 흉내입니다. 배포 빌드에는 들어가지 않습니다.
//
// ● Google Play, AdMob, Firebase(Firestore·Functions)를 전혀 부르지 않습니다.
// ● 가짜 혜택(연못 확장권 수, 광고 제거)은 이 브라우저 localStorage의 미리보기 칸에만 저장합니다.
// ● 화면(components/mock/MonetizationMockLayer.tsx)은 mockUiStore를 구독해 배너 자리, 동영상 광고 자리,
//   가짜 결제창을 그립니다. 결제 성공 뒤의 처리(연못 생성, 광고 끄기, 알림)는 실제 결제와 같은 코드가 맡습니다.
import { PLAY_PRODUCT_IDS, type PlayProductId } from '../config/monetization';
import { MONETIZATION_MOCK_SCOPE } from '../config/monetizationMock';
import { DEFAULT_ENTITLEMENTS, MAX_PAID_POND_SLOTS, normalizeEntitlements, type AccountEntitlements } from '../functions/src/saveValidation';
import type { PurchaseVerification } from './billing';
import type { VideoAdHandlers } from './ads';
import type { MonetizationBackend } from './monetizationBackend';

/** AdMob 작은 배너(320x50)가 차지하는 높이. 실제 배너와 같은 만큼 게임 화면을 올립니다. */
export const MOCK_BANNER_HEIGHT = 50;
/** 미리보기 결제창에 보여 줄 예시 가격. 실제 가격은 Play Console에서 정합니다. */
export const MOCK_SAMPLE_PRICES: Record<PlayProductId, string> = {
    [PLAY_PRODUCT_IDS.pondSlot]: '₩2,500',
    [PLAY_PRODUCT_IDS.removeAds]: '₩5,500',
};
export const MOCK_PRODUCT_NAMES: Record<PlayProductId, string> = {
    [PLAY_PRODUCT_IDS.pondSlot]: '연못 확장권',
    [PLAY_PRODUCT_IDS.removeAds]: '광고 제거',
};
/** "구매"를 누른 뒤 결제 처리 중 화면을 보여 주는 시간 */
const MOCK_PROCESSING_MS = 1200;

const ENTITLEMENTS_KEY = `koiworld:${MONETIZATION_MOCK_SCOPE}:entitlements`;

export type MockPurchaseChoice = 'buy' | 'cancel' | 'pending';
export type MockUiState = {
    banner: boolean;
    videoAd: { startedAt: number } | null;
    purchase: { productId: PlayProductId; phase: 'choose' | 'processing' } | null;
};

// ── 화면 상태 ───────────────────────────────────────────────────────────
let ui: MockUiState = { banner: false, videoAd: null, purchase: null };
const uiListeners = new Set<() => void>();
const setUi = (patch: Partial<MockUiState>) => {
    ui = { ...ui, ...patch };
    uiListeners.forEach(listener => listener());
};

/** React의 useSyncExternalStore로 구독합니다. */
export const mockUiStore = {
    subscribe: (listener: () => void) => {
        uiListeners.add(listener);
        return () => { uiListeners.delete(listener); };
    },
    getSnapshot: (): MockUiState => ui,
};

// ── 가짜 혜택 ───────────────────────────────────────────────────────────
let entitlements: AccountEntitlements | null = null;
const entitlementListeners = new Set<(value: AccountEntitlements) => void>();

export const readMockEntitlements = (): AccountEntitlements => {
    if (entitlements) return entitlements;
    try {
        entitlements = normalizeEntitlements(JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY) ?? 'null'));
    } catch {
        entitlements = { ...DEFAULT_ENTITLEMENTS };
    }
    return entitlements;
};

/** 미리보기 패널과 가짜 결제가 혜택을 바꿉니다. 바뀐 값은 실제 혜택 구독과 같은 길로 게임에 전달됩니다. */
export const setMockEntitlements = (next: Partial<AccountEntitlements>): AccountEntitlements => {
    const value = normalizeEntitlements({ ...readMockEntitlements(), ...next });
    entitlements = value;
    try { localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify(value)); } catch { /* 저장 실패해도 이번 실행에는 반영됩니다. */ }
    entitlementListeners.forEach(listener => listener(value));
    return value;
};

// ── 가짜 결제창 ─────────────────────────────────────────────────────────
let answerPurchase: ((choice: MockPurchaseChoice) => void) | null = null;

/** 가짜 결제창의 구매·취소·결제 대기 버튼 */
export const answerMockPurchase = (choice: MockPurchaseChoice) => answerPurchase?.(choice);

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const mockPurchase = async (_uid: string, productId: PlayProductId): Promise<PurchaseVerification | null> => {
    if (ui.purchase) return null;
    setUi({ purchase: { productId, phase: 'choose' } });
    const choice = await new Promise<MockPurchaseChoice>(resolve => { answerPurchase = resolve; });
    answerPurchase = null;
    if (choice === 'cancel') {
        setUi({ purchase: null });
        return null;
    }
    setUi({ purchase: { productId, phase: 'processing' } });
    await wait(MOCK_PROCESSING_MS);
    setUi({ purchase: null });
    if (choice === 'pending') {
        return { status: 'pending', productId, entitlements: normalizeEntitlements(undefined), finished: false };
    }
    const current = readMockEntitlements();
    const granted = productId === PLAY_PRODUCT_IDS.pondSlot
        ? setMockEntitlements({ paidPondSlots: Math.min(MAX_PAID_POND_SLOTS, current.paidPondSlots + 1) })
        : setMockEntitlements({ adFree: true });
    return { status: 'granted', productId, entitlements: granted, finished: true };
};

// ── 가짜 동영상 광고 ────────────────────────────────────────────────────
let closeVideoAd: (() => void) | null = null;

/** 동영상 광고 자리의 건너뛰기·닫기 버튼 */
export const closeMockVideoAd = () => closeVideoAd?.();

const mockShowVideoAd = (handlers: VideoAdHandlers = {}): Promise<boolean> => {
    if (ui.videoAd) {
        handlers.onClose?.();
        return Promise.resolve(false);
    }
    return new Promise<boolean>(resolve => {
        handlers.onShow?.();
        setUi({ videoAd: { startedAt: Date.now() } });
        closeVideoAd = () => {
            closeVideoAd = null;
            setUi({ videoAd: null });
            handlers.onClose?.();
            resolve(true);
        };
    });
};

export const mockMonetizationBackend: MonetizationBackend = {
    isStoreAvailable: () => true,
    isAdSupported: () => true,
    subscribeToEntitlements: (_uid, onUpdate) => {
        onUpdate(readMockEntitlements());
        entitlementListeners.add(onUpdate);
        return () => { entitlementListeners.delete(onUpdate); };
    },
    loadProductPrices: async () => ({
        [PLAY_PRODUCT_IDS.pondSlot]: `${MOCK_SAMPLE_PRICES[PLAY_PRODUCT_IDS.pondSlot]} (예시)`,
        [PLAY_PRODUCT_IDS.removeAds]: `${MOCK_SAMPLE_PRICES[PLAY_PRODUCT_IDS.removeAds]} (예시)`,
    }),
    purchase: mockPurchase,
    // Google Play처럼 계속 보유하는 상품(광고 제거)만 돌려줍니다. 연못 확장권은 혜택 값에 이미 남아 있습니다.
    restorePurchases: async () => {
        const current = readMockEntitlements();
        return {
            restored: current.adFree
                ? [{ status: 'already-granted', productId: PLAY_PRODUCT_IDS.removeAds, entitlements: current, finished: true }]
                : [],
            failures: [],
        };
    },
    showBanner: async onHeight => {
        setUi({ banner: true });
        onHeight(MOCK_BANNER_HEIGHT);
    },
    removeBanner: async () => { setUi({ banner: false }); },
    prepareVideoAd: async () => true,
    isVideoAdReady: () => true,
    showVideoAd: mockShowVideoAd,
};
