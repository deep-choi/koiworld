// 로컬 미리보기(npm run dev:mock) 화면 배치 값입니다. 배포 빌드에는 들어가지 않습니다.

/** 기기 테두리 안의 iframe 주소에 붙는 표시. 이 표시가 있는 창은 "휴대폰 화면"으로 게임만 그립니다. */
export const MOCK_SCREEN_PARAM = 'mock-screen';

/**
 * 데스크톱 배치(가운데 휴대폰 + 옆 패널)를 쓸 만큼 넓은 브라우저인지.
 * 이보다 작으면(휴대폰 크기, 개발자 도구의 기기 화면 등) 테두리 없이 전체 화면으로 게임을 그립니다.
 */
export const DESKTOP_PREVIEW_QUERY = '(min-width: 760px) and (min-height: 560px)';

/** 휴대폰 화면 크기(CSS 픽셀). 흔한 Android 기기(412×915)와 같은 비율입니다. */
export const PHONE_SCREEN = { width: 412, height: 915 } as const;
/** Android 상태 표시줄과 제스처 막대 높이 */
export const PHONE_STATUS_BAR_HEIGHT = 28;
export const PHONE_NAV_BAR_HEIGHT = 20;
/** 기기 테두리 두께 */
export const PHONE_BEZEL = 12;

/** 지금 창이 기기 테두리 안의 iframe(휴대폰 화면)인지 */
export const isMockScreenFrame = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return window.parent !== window && new URLSearchParams(window.location.search).has(MOCK_SCREEN_PARAM);
    } catch {
        return false;
    }
};

/** 기기 테두리 안 iframe에 넣을 주소(지금 주소에 표시만 더합니다) */
export const mockScreenUrl = (): string => {
    const url = new URL(window.location.href);
    url.searchParams.set(MOCK_SCREEN_PARAM, '1');
    return `${url.pathname}${url.search}${url.hash}`;
};
