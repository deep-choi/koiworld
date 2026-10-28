import { getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, type Analytics } from 'firebase/analytics';
import { firebaseApp } from './firebase';

// 사용자 식별자(UID·이메일 등)는 전송하지 않습니다. 이벤트 이름과 단순 수치만 보냅니다.
// 개발 서버에서는 수집하지 않아 실제 지표가 오염되지 않습니다.
const ONCE_KEY_PREFIX = 'koiworld:analytics:once:';

type AnalyticsParams = Record<string, string | number | boolean>;

let analyticsPromise: Promise<Analytics | null> | null = null;

const loadAnalytics = (): Promise<Analytics | null> => {
    if (import.meta.env.DEV || typeof window === 'undefined') return Promise.resolve(null);
    if (!analyticsPromise) {
        analyticsPromise = isSupported()
            .then(supported => {
                if (!supported) return null;
                const instance = getAnalytics(firebaseApp);
                setAnalyticsCollectionEnabled(instance, true);
                return instance;
            })
            .catch(() => null);
    }
    return analyticsPromise;
};

export const initAnalytics = () => {
    void loadAnalytics();
};

export const trackEvent = (name: string, params?: AnalyticsParams) => {
    void loadAnalytics().then(instance => {
        if (instance) logEvent(instance, name, params);
    }).catch(() => undefined);
};

// 기기당 한 번만 보내는 이벤트(첫 먹이, 첫 교배처럼 초반 이탈 지점을 보기 위한 용도)
export const trackOnce = (name: string, params?: AnalyticsParams) => {
    try {
        const key = ONCE_KEY_PREFIX + name;
        if (window.localStorage.getItem(key)) return;
        window.localStorage.setItem(key, '1');
    } catch {
        // 저장소를 쓸 수 없으면 중복 전송을 감수하고 그대로 보냅니다.
    }
    trackEvent(name, params);
};
