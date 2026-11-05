const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 실기기에 요청을 보내지 않고 UMP 동의 확인 순서를 검증합니다.
function loadAds(plugin) {
    const file = path.join(__dirname, '../services/ads.ts');
    const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
        exports, console, setTimeout, clearTimeout, Date, Promise,
        require: name => {
            if (name === '@capacitor/core') return { Capacitor: { getPlatform: () => 'android' } };
            if (name === '@capacitor-community/admob') return {
                AdMob: plugin, AdmobConsentStatus: { REQUIRED: 'REQUIRED' },
                BannerAdPluginEvents: {}, BannerAdPosition: {}, BannerAdSize: {}, InterstitialAdPluginEvents: {},
            };
            if (name === '../config/monetization') return { resolveAdUnit: () => ({ isTesting: true }), VIDEO_AD_LIMITS: {} };
            throw new Error(`unexpected import: ${name}`);
        },
    });
    return exports;
}

test('ads initialize only after consent is gathered and ads are allowed', async () => {
    const calls = [];
    const plugin = {
        requestConsentInfo: async () => { calls.push('info'); return { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' }; },
        showConsentForm: async () => { calls.push('form'); return { canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' }; },
        initialize: async () => { calls.push('initialize'); },
    };
    const ads = loadAds(plugin);
    const values = [];
    ads.subscribeToAdPrivacyOptions(value => values.push(value));
    assert.equal(await ads.initializeAds(), true);
    assert.deepEqual(calls, ['info', 'form', 'initialize']);
    assert.equal(values.at(-1), true);
});

test('no ad SDK initialization occurs when consent is unavailable or refused', async () => {
    let initialized = false;
    const ads = loadAds({
        requestConsentInfo: async () => ({ status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' }),
        showConsentForm: async () => ({ canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' }),
        initialize: async () => { initialized = true; },
    });
    assert.equal(await ads.initializeAds(), false);
    assert.equal(initialized, false);
});

test('privacy changes clear the old initialization and refresh consent', async () => {
    let requests = 0;
    let forms = 0;
    const ads = loadAds({
        requestConsentInfo: async () => { requests++; return { status: 'OBTAINED', canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' }; },
        showPrivacyOptionsForm: async () => { forms++; },
        initialize: async () => {},
    });
    await ads.initializeAds();
    await ads.showAdPrivacyOptions();
    assert.equal(forms, 1);
    assert.equal(requests, 2);
});
