// 로컬 미리보기(npm run dev:mock) 전용: 휴대폰 화면 바깥의 미리보기 패널과 게임을 잇는 다리입니다.
// 배포 빌드에는 들어가지 않습니다(isMonetizationMock이 false라 아래 코드가 모두 빠집니다).
//
// 데스크톱 브라우저에서는 게임이 기기 테두리 안의 iframe(같은 주소, 같은 출처)에서 돌고, 패널은 바깥 문서에 있습니다.
// 바깥 패널은 iframe 창의 window[MOCK_BRIDGE_KEY]로 이 다리를 찾아 게임 쪽 함수(광고 보기, 혜택 바꾸기 등)를 부릅니다.
// 휴대폰 크기 브라우저에서는 iframe 없이 같은 창의 다리를 바로 씁니다.
// 패널은 이 다리만 거쳐 게임을 바꿉니다. 바깥 문서의 모듈 사본(가짜 혜택, 결제 상태)은 쓰지 않습니다.
import { isMonetizationMock } from '../config/monetizationMock';
import type { VideoAdTrigger } from '../config/monetization';
import { MAX_PAID_POND_SLOTS, type AccountEntitlements } from '../functions/src/saveValidation';
import {
    cancelMockPurchase,
    dismissMockNotice,
    mockUiStore,
    setMockEntitlements,
    setMockPurchaseOutcome,
    type MockPurchaseOutcome,
    type MockUiState,
} from './mockMonetization';

/** 게임 화면이 알려 주는 지금 상태 */
export type MockGameSnapshot = {
    adsEnabled: boolean;
    entitlements: AccountEntitlements;
    /** 다음 동영상 광고를 띄울 수 있는 가장 이른 시각 */
    nextAdAt: number;
    pendingTrigger: VideoAdTrigger | null;
    isVideoAdShowing: boolean;
    /** 지금 있는 유료 연못(pond-paid-N) 수와 그중 코이가 있는 연못 수 */
    paidPondCount: number;
    paidPondsWithKoi: number;
};

/** 게임 화면이 맡기는 동작 */
export type MockGameActions = {
    showVideoAdNow: () => void;
    resetAdTimers: () => void;
    /** 미리보기 저장에서 유료 연못을 지웁니다(구매 내역 초기화). */
    removePaidPonds: () => void;
};

export type MockPreviewSnapshot = { ui: MockUiState; game: MockGameSnapshot | null };

export type MockPreviewBridge = {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => MockPreviewSnapshot;
    actions: {
        showVideoAdNow: () => void;
        resetAdTimers: () => void;
        setAdFree: (adFree: boolean) => void;
        setPaidPondSlots: (slots: number) => void;
        /** 가짜 혜택과 유료 연못을 모두 지웁니다. 코이가 있는지 묻는 확인은 패널이 먼저 합니다. */
        resetPurchases: () => void;
        setPurchaseOutcome: (outcome: MockPurchaseOutcome) => void;
        /** 열린 결제 시트를 사용자가 닫은 것처럼 끝냅니다. */
        cancelPurchase: () => void;
        dismissNotice: () => void;
    };
};

/** iframe 창에서 바깥 패널이 찾는 이름 */
export const MOCK_BRIDGE_KEY = '__koiworldMonetizationMockBridge';

let game: MockGameSnapshot | null = null;
let gameActions: MockGameActions | null = null;
const gameListeners = new Set<() => void>();
let snapshot: MockPreviewSnapshot = { ui: mockUiStore.getSnapshot(), game };

const sameGame = (a: MockGameSnapshot | null, b: MockGameSnapshot) => !!a
    && a.adsEnabled === b.adsEnabled
    && a.entitlements.adFree === b.entitlements.adFree
    && a.entitlements.paidPondSlots === b.entitlements.paidPondSlots
    && a.nextAdAt === b.nextAdAt
    && a.pendingTrigger === b.pendingTrigger
    && a.isVideoAdShowing === b.isVideoAdShowing
    && a.paidPondCount === b.paidPondCount
    && a.paidPondsWithKoi === b.paidPondsWithKoi;

/**
 * 게임 화면(MonetizationMockLayer)이 렌더링될 때마다 부릅니다. 값이 그대로면 패널을 다시 그리지 않습니다.
 * 동작은 늘 최신 함수로 바꿔 둡니다.
 */
export const publishMockGame = (next: MockGameSnapshot, actions: MockGameActions) => {
    gameActions = actions;
    if (sameGame(game, next)) return;
    game = next;
    gameListeners.forEach(listener => listener());
};

export const mockPreviewBridge: MockPreviewBridge = {
    subscribe: listener => {
        const stopUi = mockUiStore.subscribe(listener);
        gameListeners.add(listener);
        return () => {
            stopUi();
            gameListeners.delete(listener);
        };
    },
    getSnapshot: () => {
        const ui = mockUiStore.getSnapshot();
        if (snapshot.ui !== ui || snapshot.game !== game) snapshot = { ui, game };
        return snapshot;
    },
    actions: {
        showVideoAdNow: () => gameActions?.showVideoAdNow(),
        resetAdTimers: () => gameActions?.resetAdTimers(),
        setAdFree: adFree => { setMockEntitlements({ adFree }); },
        setPaidPondSlots: slots => { setMockEntitlements({ paidPondSlots: Math.max(0, Math.min(MAX_PAID_POND_SLOTS, slots)) }); },
        resetPurchases: () => {
            setMockEntitlements({ paidPondSlots: 0, adFree: false });
            gameActions?.removePaidPonds();
        },
        setPurchaseOutcome: setMockPurchaseOutcome,
        cancelPurchase: cancelMockPurchase,
        dismissNotice: dismissMockNotice,
    },
};

/**
 * 다른 창의 다리를 감쌉니다. iframe이 새로 고쳐지면(새 게임 등) 옛 창의 함수는 브라우저에 따라 부를 수 없게 되므로,
 * 실패해도 패널이 멈추지 않도록 마지막 상태를 돌려주고 동작은 조용히 건너뜁니다. 새 창의 다리는 iframe load 때 다시 찾습니다.
 */
const guardBridge = (bridge: MockPreviewBridge): MockPreviewBridge => {
    let last: MockPreviewSnapshot | null = null;
    const guard = <A extends unknown[]>(run: (...args: A) => void) => (...args: A) => {
        try { run(...args); } catch { /* 이미 사라진 창 */ }
    };
    const actions = Object.fromEntries(Object.entries(bridge.actions).map(([name, run]) => [name, guard(run as (...args: unknown[]) => void)]));
    return {
        subscribe: listener => {
            try {
                const stop = bridge.subscribe(listener);
                return () => { try { stop(); } catch { /* 이미 사라진 창 */ } };
            } catch {
                return () => undefined;
            }
        },
        getSnapshot: () => {
            try {
                last = bridge.getSnapshot();
            } catch { /* 이미 사라진 창: 마지막 상태를 그대로 씁니다. */ }
            return last ?? { ui: mockUiStore.getSnapshot(), game: null };
        },
        actions: actions as MockPreviewBridge['actions'],
    };
};

/** 다른 창(기기 테두리 안의 iframe)에 있는 다리를 찾습니다. 아직 게임이 뜨지 않았으면 null */
export const findMockBridge = (target: Window | null | undefined): MockPreviewBridge | null => {
    try {
        const found = (target as (Window & { [MOCK_BRIDGE_KEY]?: MockPreviewBridge }) | null | undefined)?.[MOCK_BRIDGE_KEY];
        return found && typeof found.getSnapshot === 'function' ? guardBridge(found) : null;
    } catch {
        return null; // 다른 출처의 창이면 읽을 수 없습니다.
    }
};

// 미리보기 모드의 창마다 자기 다리를 걸어 둡니다. 배포 빌드에서는 조건이 false라 이 줄이 빠집니다.
if (isMonetizationMock && typeof window !== 'undefined') {
    (window as Window & { [MOCK_BRIDGE_KEY]?: MockPreviewBridge })[MOCK_BRIDGE_KEY] = mockPreviewBridge;
}
