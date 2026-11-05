import { GoogleAuth } from 'google-auth-library';
import type { PlayProductPurchase } from './playBilling.js';
import type { VoidedPurchasePage } from './voidedPurchases.js';

// Google Play Developer API(androidpublisher v3)의 인앱 상품 구매 엔드포인트만 감싼 작은 클라이언트입니다.
// 큰 googleapis 패키지 대신 firebase-admin이 이미 쓰는 google-auth-library로 토큰만 받고 fetch로 호출합니다.
// 토큰 공급자와 fetch를 바꿔 끼울 수 있어서 테스트에서는 실제 네트워크 없이 확인합니다.

export const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_ROOT = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

export class PlayApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'PlayApiError';
    }

    /** 토큰이 없거나 잘못된 경우처럼, 다시 시도해도 결과가 같은 오류인지 */
    get isInvalidPurchase(): boolean {
        return this.status === 400 || this.status === 404 || this.status === 410;
    }
}

export type PlayDeveloperApi = {
    getProductPurchase(productId: string, purchaseToken: string): Promise<PlayProductPurchase>;
    acknowledgeProductPurchase(productId: string, purchaseToken: string): Promise<void>;
    consumeProductPurchase(productId: string, purchaseToken: string): Promise<void>;
    listVoidedPurchases(pageToken?: string): Promise<VoidedPurchasePage>;
};

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;

export const createPlayDeveloperApi = (options: {
    packageName: string;
    getAccessToken: () => Promise<string>;
    fetchImpl?: FetchLike;
    /** 테스트에서는 실제 지연 없이 재시도를 확인합니다. */
    sleep?: (milliseconds: number) => Promise<void>;
}): PlayDeveloperApi => {
    const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const sleep = options.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
    const productUrl = (productId: string, purchaseToken: string, action = '') =>
        `${API_ROOT}/${encodeURIComponent(options.packageName)}/purchases/products/`
        + `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}${action}`;

    const request = async (url: string, method: 'GET' | 'POST'): Promise<string> => {
        const token = await options.getAccessToken();
        const response = await fetchImpl(url, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(method === 'POST' ? { body: '{}' } : {}),
        });
        const text = await response.text();
        if (!response.ok) {
            // 응답 본문에는 구매 토큰이 들어 있지 않지만, 로그가 길어지지 않도록 앞부분만 남깁니다.
            throw new PlayApiError(`Google Play API ${method} failed (${response.status}): ${text.slice(0, 300)}`, response.status);
        }
        return text;
    };

    return {
        async getProductPurchase(productId, purchaseToken) {
            for (let attempt = 0; ; attempt++) {
                try {
                    const text = await request(productUrl(productId, purchaseToken), 'GET');
                    return JSON.parse(text || '{}') as PlayProductPurchase;
                } catch (error) {
                    const transient = error instanceof PlayApiError
                        ? [429, 500, 502, 503, 504].includes(error.status)
                        : error instanceof TypeError;
                    if (!transient || attempt >= 2) throw error;
                    await sleep(attempt === 0 ? 300 : 900);
                }
            }
        },
        async acknowledgeProductPurchase(productId, purchaseToken) {
            await request(productUrl(productId, purchaseToken, ':acknowledge'), 'POST');
        },
        async consumeProductPurchase(productId, purchaseToken) {
            await request(productUrl(productId, purchaseToken, ':consume'), 'POST');
        },
        async listVoidedPurchases(pageToken) {
            const params = new URLSearchParams({ includeQuantityBasedPartialRefund: 'true', maxResults: '1000' });
            if (pageToken) params.set('token', pageToken);
            // startTime을 생략하면 Play가 제공하는 최근 30일 전체를 검사합니다.
            const url = `${API_ROOT}/${encodeURIComponent(options.packageName)}/purchases/voidedpurchases?${params}`;
            const text = await request(url, 'GET');
            return JSON.parse(text || '{}') as VoidedPurchasePage;
        },
    };
};

/**
 * Cloud Functions 기본 서비스 계정으로 androidpublisher 권한 토큰을 받습니다.
 * 이 서비스 계정은 Play Console의 "사용자 및 권한"에 초대되어 있어야 합니다(docs의 체크리스트 참고).
 */
export const createDefaultAccessTokenProvider = (): (() => Promise<string>) => {
    const auth = new GoogleAuth({ scopes: [ANDROID_PUBLISHER_SCOPE] });
    return async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new Error('Google Play API access token is unavailable.');
        return token;
    };
};
