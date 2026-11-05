import assert from 'node:assert/strict';
import test from 'node:test';
import {
    accountTokenForUid,
    decidePurchaseGrant,
    isPlausiblePurchaseToken,
    isPlayProductId,
    purchaseRecordId,
    type PlayProductPurchase,
} from './playBilling.js';
import { PlayApiError, createPlayDeveloperApi } from './googlePlay.js';
import { MAX_PAID_POND_SLOTS } from './saveValidation.js';

const uid = 'user-a';
const purchased = (overrides: PlayProductPurchase = {}): PlayProductPurchase => ({
    purchaseState: 0,
    consumptionState: 0,
    acknowledgementState: 0,
    orderId: 'GPA.1234-5678-9012-34567',
    purchaseTimeMillis: '1762128000000',
    obfuscatedExternalAccountId: accountTokenForUid(uid),
    ...overrides,
});

test('a new pond slot purchase adds one slot and asks the server to consume it', () => {
    const decision = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased(), entitlements: { paidPondSlots: 1 } });
    assert.equal(decision.kind, 'grant');
    if (decision.kind !== 'grant') return;
    assert.deepEqual(decision.entitlements, { paidPondSlots: 2, adFree: false });
    assert.equal(decision.finish, 'consume');
    assert.equal(decision.record.uid, uid);
    assert.equal(decision.record.quantity, 1);
    assert.equal(decision.record.finished, false);
    assert.equal(decision.record.isTest, false);
});

test('multi-quantity pond slot purchases add every slot', () => {
    const decision = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ quantity: 2 }) });
    assert.equal(decision.kind, 'grant');
    assert.equal(decision.entitlements.paidPondSlots, 2);
});

test('remove_ads turns on ad-free, keeps pond slots and is acknowledged rather than consumed', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'remove_ads', purchase: purchased(), entitlements: { paidPondSlots: 3, adFree: false },
    });
    assert.equal(decision.kind, 'grant');
    if (decision.kind !== 'grant') return;
    assert.deepEqual(decision.entitlements, { paidPondSlots: 3, adFree: true });
    assert.equal(decision.finish, 'acknowledge');
});

test('an already acknowledged remove_ads purchase needs no finishing step', () => {
    const decision = decidePurchaseGrant({ uid, productId: 'remove_ads', purchase: purchased({ acknowledgementState: 1 }) });
    assert.equal(decision.kind, 'grant');
    if (decision.kind !== 'grant') return;
    assert.equal(decision.finish, null);
    assert.equal(decision.record.finished, true);
});

test('sending the same token again (retry or restore after reinstall) never grants twice', () => {
    const first = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased(), entitlements: { paidPondSlots: 0 } });
    assert.equal(first.kind, 'grant');
    if (first.kind !== 'grant') return;

    const retry = decidePurchaseGrant({
        uid, productId: 'pond_slot', purchase: purchased(), existingRecord: first.record, entitlements: first.entitlements,
    });
    assert.equal(retry.kind, 'already-granted');
    assert.deepEqual(retry.entitlements, { paidPondSlots: 1, adFree: false });
    // 처음 소비가 실패했다면 재시도 때 다시 소비합니다.
    if (retry.kind === 'already-granted') assert.equal(retry.finish, 'consume');

    const afterFinish = decidePurchaseGrant({
        uid, productId: 'pond_slot', purchase: purchased({ consumptionState: 1 }),
        existingRecord: { ...first.record, finished: true }, entitlements: first.entitlements,
    });
    assert.equal(afterFinish.kind, 'already-granted');
    if (afterFinish.kind === 'already-granted') assert.equal(afterFinish.finish, null);
});

test('restoring remove_ads on a reinstall keeps the existing benefit', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'remove_ads', purchase: purchased({ acknowledgementState: 1 }),
        existingRecord: { uid, productId: 'remove_ads', status: 'granted', finished: true },
        entitlements: { paidPondSlots: 2, adFree: true },
    });
    assert.equal(decision.kind, 'already-granted');
    assert.deepEqual(decision.entitlements, { paidPondSlots: 2, adFree: true });
});

test('a token already recorded for another account is rejected', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'remove_ads', purchase: purchased(),
        existingRecord: { uid: 'user-b', productId: 'remove_ads', status: 'granted', finished: true },
    });
    assert.equal(decision.kind, 'reject');
    if (decision.kind === 'reject') assert.equal(decision.reason, 'owned-by-other-account');
});

test('a purchase made for another account cannot be claimed', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'pond_slot', purchase: purchased({ obfuscatedExternalAccountId: accountTokenForUid('user-b') }),
    });
    assert.equal(decision.kind, 'reject');
    if (decision.kind === 'reject') assert.equal(decision.reason, 'account-mismatch');
});

test('a promo-code purchase without an account id binds to the first account that confirms it', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'remove_ads', purchase: purchased({ obfuscatedExternalAccountId: undefined, purchaseType: 1 }),
    });
    assert.equal(decision.kind, 'grant');
});

test('canceled purchases are rejected and pending purchases wait without granting', () => {
    const canceled = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ purchaseState: 1 }) });
    assert.equal(canceled.kind, 'reject');
    if (canceled.kind === 'reject') assert.equal(canceled.reason, 'canceled');

    const pending = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ purchaseState: 2 }), entitlements: { paidPondSlots: 1 } });
    assert.equal(pending.kind, 'pending');
    assert.equal(pending.entitlements.paidPondSlots, 1);

    const unknownState = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ purchaseState: 7 }) });
    assert.equal(unknownState.kind, 'reject');
});

test('a consumed pond slot token without a record is treated as a replay', () => {
    const decision = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ consumptionState: 1 }) });
    assert.equal(decision.kind, 'reject');
    if (decision.kind === 'reject') assert.equal(decision.reason, 'already-consumed');
});

test('pond slots stop at the account limit and the extra purchase is left unconsumed for a refund', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'pond_slot', purchase: purchased(), entitlements: { paidPondSlots: MAX_PAID_POND_SLOTS },
    });
    assert.equal(decision.kind, 'reject');
    if (decision.kind !== 'reject') return;
    assert.equal(decision.reason, 'slot-limit');
    assert.equal(decision.entitlements.paidPondSlots, MAX_PAID_POND_SLOTS);

    const tooMany = decidePurchaseGrant({
        uid, productId: 'pond_slot', purchase: purchased({ quantity: 2 }), entitlements: { paidPondSlots: MAX_PAID_POND_SLOTS - 1 },
    });
    assert.equal(tooMany.kind, 'reject');
});

test('the ten-pond limit includes legacy ponds and slots not yet saved in the game', () => {
    const pondIds = ['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-paid-1'];
    const ninth = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased(), pondIds, entitlements: { paidPondSlots: 5 } });
    assert.equal(ninth.kind, 'grant');
    const eleventh = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased(), pondIds, entitlements: { paidPondSlots: 6 } });
    assert.equal(eleventh.kind, 'reject');
    if (eleventh.kind === 'reject') assert.equal(eleventh.reason, 'slot-limit');
    const newcomerLast = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased(), pondIds: ['pond-1'], entitlements: { paidPondSlots: 8 } });
    assert.equal(newcomerLast.kind, 'grant');
});

test('product mismatches and broken quantities are rejected', () => {
    const mismatch = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ productId: 'remove_ads' }) });
    assert.equal(mismatch.kind, 'reject');
    for (const quantity of [0, -1, 1.5]) {
        const decision = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ quantity }) });
        assert.equal(decision.kind, 'reject', String(quantity));
    }
});

test('license tester purchases are granted but marked as tests', () => {
    const decision = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ purchaseType: 0 }) });
    assert.equal(decision.kind, 'grant');
    if (decision.kind === 'grant') assert.equal(decision.record.isTest, true);
});

test('broken stored entitlements are read as safe values', () => {
    const decision = decidePurchaseGrant({
        uid, productId: 'remove_ads', purchase: purchased(), entitlements: { paidPondSlots: 999, adFree: 'yes' },
    });
    assert.deepEqual(decision.entitlements, { paidPondSlots: MAX_PAID_POND_SLOTS, adFree: true });
});

test('ids, tokens and account hashes are stable and validated', () => {
    assert.equal(isPlayProductId('pond_slot'), true);
    assert.equal(isPlayProductId('remove_ads'), true);
    assert.equal(isPlayProductId('free_money'), false);
    assert.equal(isPlayProductId('toString'), false);
    assert.equal(accountTokenForUid('abc'), accountTokenForUid('abc'));
    assert.notEqual(accountTokenForUid('abc'), accountTokenForUid('abd'));
    assert.equal(accountTokenForUid('abc').length, 64);
    assert.equal(purchaseRecordId('token-1').length, 64);
    assert.equal(isPlausiblePurchaseToken('abcdefghij.klmn-opq_rs'), true);
    assert.equal(isPlausiblePurchaseToken('short'), false);
    assert.equal(isPlausiblePurchaseToken('has spaces in token'), false);
    assert.equal(isPlausiblePurchaseToken(123), false);
});

test('the Play API client calls the documented endpoints with a bearer token', async () => {
    const calls: Array<{ url: string; method: string; auth: string; body?: string }> = [];
    const api = createPlayDeveloperApi({
        packageName: 'com.zenkoigarden.game',
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, init) => {
            calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body });
            return { ok: true, status: 200, text: async () => (init.method === 'GET' ? JSON.stringify({ purchaseState: 0 }) : '') };
        },
    });
    assert.deepEqual(await api.getProductPurchase('pond_slot', 'tok/en+1'), { purchaseState: 0 });
    await api.consumeProductPurchase('pond_slot', 'tok/en+1');
    await api.acknowledgeProductPurchase('remove_ads', 'token-2');
    const root = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.zenkoigarden.game/purchases/products';
    assert.deepEqual(calls.map(call => [call.method, call.url]), [
        ['GET', `${root}/pond_slot/tokens/tok%2Fen%2B1`],
        ['POST', `${root}/pond_slot/tokens/tok%2Fen%2B1:consume`],
        ['POST', `${root}/remove_ads/tokens/token-2:acknowledge`],
    ]);
    assert.ok(calls.every(call => call.auth === 'Bearer access-token'));
});

test('Play API errors keep their status so invalid tokens are told apart from outages', async () => {
    const apiWith = (status: number) => createPlayDeveloperApi({
        packageName: 'com.zenkoigarden.game',
        getAccessToken: async () => 'access-token',
        fetchImpl: async () => ({ ok: false, status, text: async () => '{"error":{}}' }),
    });
    await assert.rejects(apiWith(404).getProductPurchase('pond_slot', 'token-123456'), (error: unknown) =>
        error instanceof PlayApiError && error.status === 404 && error.isInvalidPurchase);
    await assert.rejects(apiWith(503).getProductPurchase('pond_slot', 'token-123456'), (error: unknown) =>
        error instanceof PlayApiError && !error.isInvalidPurchase);
});

test('missing or unknown Play purchase state never grants a benefit', () => {
    for (const purchaseState of [undefined, 3]) {
        const result = decidePurchaseGrant({ uid, productId: 'pond_slot', purchase: purchased({ purchaseState }) });
        assert.equal(result.kind, 'reject');
    }
});
