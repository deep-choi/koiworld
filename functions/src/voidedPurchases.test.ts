import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlayDeveloperApi } from './googlePlay.js';
import { scanVoidedPurchases, voidedEventId, type VoidedPurchase } from './voidedPurchases.js';

test('페이지를 빠짐없이 읽고 같은 취소는 같은 검토 ID를 사용한다', async () => {
    const first = { purchaseToken: 'test-token-one', voidedTimeMillis: '123', voidedReason: 1 };
    const second = { purchaseToken: 'test-token-two', voidedTimeMillis: '124', voidedQuantity: 1 };
    const tokens: (string | undefined)[] = [];
    const recorded: VoidedPurchase[] = [];
    const count = await scanVoidedPurchases(async token => {
        tokens.push(token);
        return token ? { voidedPurchases: [second] } : { voidedPurchases: [first], tokenPagination: { nextPageToken: 'next' } };
    }, async event => { recorded.push(event); });
    assert.equal(count, 2);
    assert.deepEqual(tokens, [undefined, 'next']);
    assert.deepEqual(recorded, [first, second]);
    assert.equal(voidedEventId(first), voidedEventId({ ...first }));
    assert.notEqual(voidedEventId(first), voidedEventId(second));
    assert.equal(voidedEventId(first).includes(first.purchaseToken), false);
});

test('잘못된 응답이나 페이지 반복을 성공으로 처리하지 않는다', async () => {
    await assert.rejects(() => scanVoidedPurchases(async () => ({ tokenPagination: { nextPageToken: 'same' } }), async () => {}), /Repeated/);
    await assert.rejects(() => scanVoidedPurchases(async () => ({ voidedPurchases: [{} as VoidedPurchase] }), async () => {}), /missing/);
    await assert.rejects(() => scanVoidedPurchases(async () => { throw new Error('offline'); }, async () => {}), /offline/);
});

test('Play 목록 조회는 부분 환불과 페이지 토큰을 요청한다', async () => {
    let actualUrl = '';
    const api = createPlayDeveloperApi({
        packageName: 'com.example.game', getAccessToken: async () => 'test-access-token',
        fetchImpl: async (url, init) => {
            actualUrl = url;
            assert.equal(init.method, 'GET');
            return { ok: true, status: 200, text: async () => '{"voidedPurchases":[]}' };
        },
    });
    await api.listVoidedPurchases('page+token');
    const url = new URL(actualUrl);
    assert.equal(url.pathname.endsWith('/purchases/voidedpurchases'), true);
    assert.equal(url.searchParams.get('includeQuantityBasedPartialRefund'), 'true');
    assert.equal(url.searchParams.get('token'), 'page+token');
});
