import { createHash } from 'node:crypto';

/** Play 취소 목록의 토큰은 장부 조회에만 쓰고 로그나 새 문서에 남기지 않습니다. */
export type VoidedPurchase = {
    purchaseToken: string;
    orderId?: string;
    voidedTimeMillis?: string;
    voidedSource?: number;
    voidedReason?: number;
    voidedQuantity?: number;
};

export type VoidedPurchasePage = {
    voidedPurchases?: VoidedPurchase[];
    tokenPagination?: { nextPageToken?: string };
};

/** 같은 취소가 다음 조회에서 다시 나와도 하나의 검토 항목으로 모읍니다. */
export const voidedEventId = (event: VoidedPurchase): string => createHash('sha256')
    .update(JSON.stringify([event.purchaseToken, event.orderId ?? null, event.voidedTimeMillis ?? null,
        event.voidedSource ?? null, event.voidedReason ?? null, event.voidedQuantity ?? null]))
    .digest('hex');

/** 페이지 하나라도 실패하면 성공으로 표시하지 않아 다음 실행에서 전체를 다시 확인합니다. */
export const scanVoidedPurchases = async (
    getPage: (pageToken?: string) => Promise<VoidedPurchasePage>,
    recordEvent: (event: VoidedPurchase) => Promise<void>,
): Promise<number> => {
    let token: string | undefined;
    const seenTokens = new Set<string>();
    let count = 0;
    do {
        const page = await getPage(token);
        if (!page || (page.voidedPurchases !== undefined && !Array.isArray(page.voidedPurchases))) {
            throw new Error('Invalid voided purchases response');
        }
        for (const event of page.voidedPurchases ?? []) {
            if (!event || typeof event.purchaseToken !== 'string' || !event.purchaseToken) {
                throw new Error('Voided purchase is missing its token');
            }
            await recordEvent(event);
            count++;
        }
        token = page.tokenPagination?.nextPageToken;
        if (token) {
            if (seenTokens.has(token)) throw new Error('Repeated voided purchases page token');
            seenTokens.add(token);
        }
    } while (token);
    return count;
};
