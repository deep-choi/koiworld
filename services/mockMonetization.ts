// 로컬 미리보기(npm run dev:mock) 전용 결제·광고 흉내입니다. 배포 빌드에는 들어가지 않습니다.
//
// ● Google Play, AdMob, Firebase(Firestore·Functions)를 전혀 부르지 않습니다.
// ● 가짜 혜택(연못 확장권 수, 광고 제거)은 이 브라우저 localStorage의 미리보기 칸에만 저장합니다.
// ● 화면(components/mock/*)은 mockUiStore를 구독해 테스트 배너, 전면 동영상 광고, Google Play 결제 시트를 그립니다.
//   결제 성공 뒤의 처리(연못 생성, 광고 끄기, 알림)는 실제 결제와 같은 코드가 맡습니다.
// ● 결제 결과(승인·결제 대기·취소)는 휴대폰 화면 바깥의 미리보기 패널에서 고릅니다(setMockPurchaseOutcome).
import { PLAY_PRODUCT_IDS, type PlayProductId } from '../config/monetization';
import { MONETIZATION_MOCK_SCOPE } from '../config/monetizationMock';
import { DEFAULT_ENTITLEMENTS, MAX_PAID_POND_SLOTS, normalizeEntitlements, type AccountEntitlements } from '../functions/src/saveValidation';
import type { PurchaseVerification } from './billing';
import type { VideoAdHandlers } from './ads';
import type { MonetizationBackend } from './monetizationBackend';

/** AdMob 작은 배너(320x50)가 차지하는 높이. 실제 배너와 같은 만큼 게임 화면을 올립니다. */
export const MOCK_BANNER_HEIGHT = 50;
/** 미리보기 결제 시트에 보여 줄 가격. 실제 가격은 Play Console에서 정합니다(바깥 패널에 안내). */
export const MOCK_SAMPLE_PRICES: Record<PlayProductId, string> = {
    [PLAY_PRODUCT_IDS.pondSlot]: '₩2,500',
    [PLAY_PRODUCT_IDS.removeAds]: '₩5,500',
};
export const MOCK_PRODUCT_NAMES: Record<PlayProductId, string> = {
    [PLAY_PRODUCT_IDS.pondSlot]: '연못 확장권',
    [PLAY_PRODUCT_IDS.removeAds]: '광고 제거',
};
/** 라이선스 테스터에게 Google Play가 보여 주는 테스트 결제 수단 이름 */
export const MOCK_TEST_INSTRUMENTS = {
    approve: '테스트 카드, 항상 승인',
    pending: '느린 테스트 카드, 몇 분 후 승인',
} as const;
/** "구매"를 누른 뒤 처리 중 표시 시간 */
const MOCK_PROCESSING_MS = 1200;
/** 결제 완료 체크 표시를 보여 주는 시간(그 뒤 시트가 내려갑니다) */
const MOCK_DONE_MS = 1100;

const ENTITLEMENTS_KEY = `koiworld:${MONETIZATION_MOCK_SCOPE}:entitlements`;

/** 결제 시트가 끝나는 방법. buy=승인, pending=결제 대기, cancel=사용자가 시트를 닫음 */
export type MockPurchaseChoice = 'buy' | 'cancel' | 'pending';
/** 바깥 패널에서 고르는 "구매를 누르면 어떻게 끝날지" */
export type MockPurchaseOutcome = 'approve' | 'pending' | 'cancel';
export type MockPurchasePhase = 'choose' | 'processing' | 'done';
export type MockUiState = {
    banner: boolean;
    videoAd: { startedAt: number } | null;
    purchase: { productId: PlayProductId; phase: MockPurchasePhase; outcome: MockPurchaseOutcome } | null;
    purchaseOutcome: MockPurchaseOutcome;
    /** 휴대폰 화면 바깥(미리보기 패널)에 보여 줄 안내. 예: 로그인 버튼을 눌렀을 때 */
    notice: { id: number; message: string } | null;
};

// ── 화면 상태 ───────────────────────────────────────────────────────────
let ui: MockUiState = { banner: false, videoAd: null, purchase: null, purchaseOutcome: 'approve', notice: null };
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

/**
 * 미리보기 패널: 다음 결제를 어떻게 끝낼지 고릅니다.
 * 결제 시트가 열려 있으면 그 시트의 결제 수단 이름(테스트 카드)도 바로 바뀝니다.
 */
export const setMockPurchaseOutcome = (purchaseOutcome: MockPurchaseOutcome) => {
    const purchase = ui.purchase?.phase === 'choose' ? { ...ui.purchase, outcome: purchaseOutcome } : ui.purchase;
    setUi({ purchaseOutcome, purchase });
};

let noticeId = 0;
/** 휴대폰 화면 안에 띄우지 않고 바깥 패널에만 보여 줄 안내 */
export const showMockNotice = (message: string) => setUi({ notice: { id: ++noticeId, message } });
export const dismissMockNotice = () => setUi({ notice: null });

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

// ── 가짜 Google Play 결제 시트 ──────────────────────────────────────────
let answerPurchase: ((choice: MockPurchaseChoice) => void) | null = null;

/** 결제 시트를 원하는 방식으로 끝냅니다(테스트와 바깥 패널의 "결제 창 닫기"). */
export const answerMockPurchase = (choice: MockPurchaseChoice) => answerPurchase?.(choice);

const CHOICE_FOR_OUTCOME: Record<MockPurchaseOutcome, MockPurchaseChoice> = { approve: 'buy', pending: 'pending', cancel: 'cancel' };
/** 결제 시트의 "구매" 버튼. 바깥 패널에서 고른 결과대로 끝납니다. */
export const confirmMockPurchase = () => answerMockPurchase(CHOICE_FOR_OUTCOME[ui.purchase?.outcome ?? ui.purchaseOutcome]);
/** 시트 바깥(어두운 부분)을 누르거나 바깥 패널에서 닫으면 사용자가 취소한 것과 같습니다. */
export const cancelMockPurchase = () => {
    if (ui.purchase?.phase === 'choose') answerMockPurchase('cancel');
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const mockPurchase = async (_uid: string, productId: PlayProductId): Promise<PurchaseVerification | null> => {
    if (ui.purchase) return null;
    // 시트를 여는 순간의 설정으로 시작합니다(열린 뒤 패널에서 바꾸면 결제 수단 이름도 함께 바뀝니다).
    setUi({ purchase: { productId, phase: 'choose', outcome: ui.purchaseOutcome } });
    const choice = await new Promise<MockPurchaseChoice>(resolve => { answerPurchase = resolve; });
    answerPurchase = null;
    if (choice === 'cancel') {
        setUi({ purchase: null });
        return null;
    }
    const outcome: MockPurchaseOutcome = choice === 'pending' ? 'pending' : 'approve';
    setUi({ purchase: { productId, phase: 'processing', outcome } });
    await wait(MOCK_PROCESSING_MS);
    if (choice === 'pending') {
        // 느린 테스트 카드: Google Play는 결제를 받아 두고 시트를 닫습니다. 혜택은 아직 없습니다.
        setUi({ purchase: null });
        return { status: 'pending', productId, entitlements: normalizeEntitlements(undefined), finished: false };
    }
    setUi({ purchase: { productId, phase: 'done', outcome } });
    await wait(MOCK_DONE_MS);
    setUi({ purchase: null });
    const current = readMockEntitlements();
    const granted = productId === PLAY_PRODUCT_IDS.pondSlot
        ? setMockEntitlements({ paidPondSlots: Math.min(MAX_PAID_POND_SLOTS, current.paidPondSlots + 1) })
        : setMockEntitlements({ adFree: true });
    return { status: 'granted', productId, entitlements: granted, finished: true };
};

// ── 가짜 전면 동영상 광고 ───────────────────────────────────────────────
let closeVideoAd: (() => void) | null = null;

/** 동영상 광고의 건너뛰기·닫기 버튼 */
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
    // 실제 앱처럼 가격만 보여 줍니다. "예시 가격"이라는 안내는 휴대폰 화면 바깥 패널에 있습니다.
    loadProductPrices: async () => ({ ...MOCK_SAMPLE_PRICES }),
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
