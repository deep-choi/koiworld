import { isMonetizationMock } from '../config/monetizationMock';
import type { PlayProductId } from '../config/monetization';
import type { AccountEntitlements } from '../functions/src/saveValidation';
import {
    isPlayBillingAvailable,
    loadProductPrices,
    purchasePlayProduct,
    restorePlayPurchases,
    subscribeToEntitlements,
    type BillingError,
    type PurchaseVerification,
} from './billing';
import {
    isAdSupported,
    isVideoAdReady,
    prepareVideoAd,
    removeBanner,
    showBanner,
    showVideoAd,
    type VideoAdHandlers,
} from './ads';
import { mockMonetizationBackend } from './mockMonetization';

/**
 * 결제·광고를 실제로 처리하는 쪽. 게임 화면(hooks/useMonetization, hooks/useVideoAds)은 이 모양만 봅니다.
 * 평소에는 Google Play 결제와 AdMob, 로컬 미리보기(npm run dev:mock)에서만 가짜 결제창과 광고 자리입니다.
 */
export type MonetizationBackend = {
    /** 결제 버튼을 보여 줄 수 있는 환경인지(실제: Android 앱) */
    isStoreAvailable: () => boolean;
    /** 배너·동영상 광고를 띄울 수 있는 환경인지(실제: Android 앱) */
    isAdSupported: () => boolean;
    subscribeToEntitlements: (
        uid: string,
        onUpdate: (entitlements: AccountEntitlements) => void,
        onError?: (error: unknown) => void,
    ) => () => void;
    loadProductPrices: () => Promise<Partial<Record<PlayProductId, string>>>;
    /** 결제창에서 취소하면 null */
    purchase: (uid: string, productId: PlayProductId) => Promise<PurchaseVerification | null>;
    restorePurchases: (options?: { refresh?: boolean }) => Promise<{ restored: PurchaseVerification[]; failures: BillingError[] }>;
    showBanner: (onHeight: (height: number) => void) => Promise<void>;
    removeBanner: () => Promise<void>;
    prepareVideoAd: () => Promise<boolean>;
    isVideoAdReady: () => boolean;
    showVideoAd: (handlers?: VideoAdHandlers) => Promise<boolean>;
};

const realBackend: MonetizationBackend = {
    isStoreAvailable: isPlayBillingAvailable,
    isAdSupported,
    subscribeToEntitlements,
    loadProductPrices,
    purchase: purchasePlayProduct,
    restorePurchases: restorePlayPurchases,
    showBanner,
    removeBanner,
    prepareVideoAd,
    isVideoAdReady,
    showVideoAd,
};

/** 배포 빌드에서는 isMonetizationMock이 항상 false라 미리보기 쪽 코드는 빌드에 들어가지 않습니다. */
export const monetizationBackend: MonetizationBackend = isMonetizationMock ? mockMonetizationBackend : realBackend;
