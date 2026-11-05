const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const ids = { pondSlot: 'pond_slot', removeAds: 'remove_ads' };
function loadBilling(plugin, verify) {
    const file = path.join(__dirname, '../services/billing.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
        exports, console, TextEncoder, crypto: webcrypto, Error,
        require: name => {
            if (name === '@capacitor/core') return { Capacitor: { getPlatform: () => 'android' } };
            if (name === '@capgo/native-purchases') return { NativePurchases: plugin, PURCHASE_TYPE: { INAPP: 'inapp' } };
            if (name === 'firebase/firestore') return {};
            if (name === 'firebase/functions') return { httpsCallable: () => verify };
            if (name === './firebase') return { db: {}, functions: {} };
            if (name === '../config/monetization') return { PLAY_PRODUCT_IDS: ids };
            if (name === '../functions/src/saveValidation') return { normalizeEntitlements: value => ({ paidPondSlots: value?.paidPondSlots ?? 0, adFree: value?.adFree === true }) };
            throw new Error(`unexpected import: ${name}`);
        },
    });
    return exports;
}

const transaction = { productIdentifier: 'pond_slot', purchaseToken: 'test-token-123', purchaseState: '1' };
const ownedError = () => Object.assign(new Error('Purchase is not purchased'), { code: 'ITEM_ALREADY_OWNED' });

test('already-owned consumable is verified and recovered without starting another purchase', async () => {
    let purchaseCalls = 0;
    let verifyCalls = 0;
    const billing = loadBilling({
        configure: async () => {},
        purchaseProduct: async () => { purchaseCalls++; throw ownedError(); },
        getPurchases: async () => ({ purchases: [transaction] }),
    }, async data => {
        verifyCalls++;
        assert.equal(data.productId, 'pond_slot');
        return { data: { status: 'granted', productId: 'pond_slot', entitlements: { paidPondSlots: 2 }, finished: true } };
    });
    const result = await billing.purchasePlayProduct('user-1', 'pond_slot');
    assert.equal(result.status, 'granted');
    assert.equal(result.entitlements.paidPondSlots, 2);
    assert.equal(purchaseCalls, 1);
    assert.equal(verifyCalls, 1);
});

test('an unavailable verification service tells the user not to pay again', async () => {
    const billing = loadBilling({
        configure: async () => {}, purchaseProduct: async () => transaction,
    }, async () => { throw Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }); });
    await assert.rejects(billing.purchasePlayProduct('user-1', 'pond_slot'), error =>
        error.reason === 'verify-temporary' && error.message.includes('다시 결제하지 말고'));
});

test('pending owned purchases are never granted before Play completes payment', async () => {
    let verified = false;
    const billing = loadBilling({
        configure: async () => {}, purchaseProduct: async () => { throw ownedError(); },
        getPurchases: async () => ({ purchases: [{ ...transaction, purchaseState: '2' }] }),
    }, async () => { verified = true; });
    const result = await billing.purchasePlayProduct('user-1', 'pond_slot');
    assert.equal(result.status, 'pending');
    assert.equal(verified, false);
});
