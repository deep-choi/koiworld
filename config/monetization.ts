// 유료화(인앱 결제·광고) 설정을 한곳에 모았습니다.
//
// ● 인앱 상품 ID는 Play Console에 같은 ID로 만들어야 합니다(서버 functions/src/playBilling.ts와도 같아야 함).
// ● AdMob 광고 단위 ID는 지금은 Google이 공개한 "테스트 광고 ID"만 씁니다.
//   실제 ID는 아래 환경 변수로만 넣으며, 비어 있으면 자동으로 테스트 ID가 쓰입니다.
//   (.env.local 또는 빌드 환경에 VITE_ADMOB_BANNER_ID, VITE_ADMOB_REWARDED_ID 설정)
//   Android 앱 ID(ca-app-pub-…~…)는 android/app/build.gradle의 KOIWORLD_ADMOB_APP_ID로 넣습니다.

export const PLAY_PRODUCT_IDS = {
    /** 소모성: 살 때마다 연못 슬롯 +1 */
    pondSlot: 'pond_slot',
    /** 비소모성: 배너 광고 제거 */
    removeAds: 'remove_ads',
} as const;

export type PlayProductKey = keyof typeof PLAY_PRODUCT_IDS;
export type PlayProductId = (typeof PLAY_PRODUCT_IDS)[PlayProductKey];

/** Google이 공개한 AdMob 테스트 광고 단위 ID. 실제 광고가 아니므로 눌러도 정책 위반이 아닙니다. */
export const ADMOB_TEST_AD_UNITS = {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
} as const;

export type AdUnitKind = keyof typeof ADMOB_TEST_AD_UNITS;

/**
 * 실제 광고 단위 ID가 비어 있으면 테스트 ID와 테스트 모드를 씁니다.
 * 실제 ID는 services/ads.ts가 환경 변수(VITE_ADMOB_*)에서 읽어 넘깁니다. 기본값은 비어 있습니다.
 */
export const resolveAdUnit = (
    kind: AdUnitKind,
    production: Partial<Record<AdUnitKind, string>> = {},
): { adId: string; isTesting: boolean } => {
    const productionId = (production[kind] ?? '').trim();
    return productionId
        ? { adId: productionId, isTesting: false }
        : { adId: ADMOB_TEST_AD_UNITS[kind], isTesting: true };
};

/** 보상형 광고 1회 시청 보상. 기본 사료 50개 팩이 200 ZP이므로 둘의 가치가 비슷하게 맞춰져 있습니다. */
export const REWARDED_AD_REWARDS = {
    food: { amount: 30, label: '기본 사료 30개' },
    zen: { amount: 150, label: '150 ZP' },
} as const;

export type RewardedAdRewardKind = keyof typeof REWARDED_AD_REWARDS;

/** 하루에 받을 수 있는 보상형 광고 보상 횟수(먹이·ZP 합산) */
export const REWARDED_ADS_PER_DAY = 5;
