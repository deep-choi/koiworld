// 유료화(인앱 결제·광고) 설정을 한곳에 모았습니다.
//
// ● 인앱 상품 ID는 Play Console에 같은 ID로 만들어야 합니다(서버 functions/src/playBilling.ts와도 같아야 함).
// ● AdMob 광고 단위 ID는 지금은 Google이 공개한 "테스트 광고 ID"만 씁니다.
//   실제 ID는 아래 환경 변수로만 넣으며, 비어 있으면 자동으로 테스트 ID가 쓰입니다.
//   (.env.local 또는 빌드 환경에 VITE_ADMOB_BANNER_ID, VITE_ADMOB_INTERSTITIAL_ID 설정)
//   Android 앱 ID(ca-app-pub-…~…)는 android/app/build.gradle의 KOIWORLD_ADMOB_APP_ID로 넣습니다.

export const PLAY_PRODUCT_IDS = {
    /** 소모성: 살 때마다 연못 +1 (상점 이름 "연못 확장권") */
    pondSlot: 'pond_slot',
    /** 비소모성: 배너 광고와 동영상 광고 제거 */
    removeAds: 'remove_ads',
} as const;

export type PlayProductKey = keyof typeof PLAY_PRODUCT_IDS;
export type PlayProductId = (typeof PLAY_PRODUCT_IDS)[PlayProductKey];

/**
 * Google이 공개한 AdMob 테스트 광고 단위 ID(https://developers.google.com/admob/android/test-ads).
 * 실제 광고가 아니므로 눌러도 정책 위반이 아닙니다.
 * 전면 광고는 Google 문서에 남아 있는 "Interstitial" 테스트 ID를 씁니다. 예전 문서의 "Interstitial Video"
 * (…/8691691433)는 지금 문서에서 빠져 쓰지 않습니다. 실제 광고 단위는 AdMob 콘솔에서 동영상만 나오게 설정합니다.
 */
export const ADMOB_TEST_AD_UNITS = {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
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

// ── 동영상 광고(AdMob 전면 광고) ─────────────────────────────────────────
// Google 전면 광고 정책에 맞춰 "하던 일이 끝나고 잠시 쉬는 지점"에서만 띄웁니다.
// 앱을 켤 때·끌 때, 결제·로그인 중, 무언가를 하는 도중에는 띄우지 않습니다.
// 실제 길이는 AdMob이 정합니다(보통 15~30초, 약 5초 뒤 건너뛰기 가능).

export const VIDEO_AD_LIMITS = {
    /** 앱을 켠 뒤 이 시간 동안은 동영상 광고를 띄우지 않습니다. */
    launchGraceMs: 3 * 60_000,
    /** 동영상 광고가 끝난 뒤 다음 광고까지 최소 간격 */
    minIntervalMs: 5 * 60_000,
    /** 쉬는 지점이 생긴 뒤 열린 창이 닫히길 기다리는 최대 시간. 지나면 이번 광고는 건너뜁니다. */
    breakMaxWaitMs: 2 * 60_000,
    /** 미리 받아 둔 광고를 버리고 새로 받는 시간(AdMob 광고는 1시간 뒤 만료) */
    preloadExpiryMs: 55 * 60_000,
    /** 광고를 받지 못했을 때 다시 요청하기까지 기다리는 시간 */
    loadRetryMs: 60_000,
} as const;

/**
 * 동영상 광고를 띄울 수 있는 쉬는 지점.
 * - enabled: false로 바꾸면 그 지점에서는 띄우지 않습니다.
 * - settleMs: 쉬는 지점이 생기고 화면이 비어 있는 상태로 이만큼 지나야 띄웁니다.
 *   그사이 화면을 누르면 플레이어가 다른 일을 시작한 것이므로 이번 광고는 건너뜁니다.
 * 연못 현황 창 안에서 교배·판매했다면 그 창을 닫은 뒤에 같은 규칙으로 띄웁니다.
 */
export const VIDEO_AD_TRIGGERS = {
    breed: { enabled: true, settleMs: 2000, label: '교배가 끝나고 새 코이가 나온 뒤' },
    sell: { enabled: true, settleMs: 1500, label: '코이를 판 뒤' },
    pondSwitch: { enabled: true, settleMs: 600, label: '화살표로 다른 연못에 넘어갈 때' },
} as const satisfies Record<string, { enabled: boolean; settleMs: number; label: string }>;

export type VideoAdTrigger = keyof typeof VIDEO_AD_TRIGGERS;
