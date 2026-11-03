const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 새 테스트 의존성 없이 실제 TypeScript 모듈을 실행합니다.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const monetization = require('../config/monetization.ts');
const policy = require('../utils/videoAdPolicy.ts');
const saveValidation = require('../functions/src/saveValidation.ts');
const buildCheck = require('../scripts/check-production-build.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('ads use Google test ad units until a production id is configured', () => {
    assert.deepEqual(monetization.resolveAdUnit('banner'), {
        adId: 'ca-app-pub-3940256099942544/6300978111', isTesting: true,
    });
    // Google AdMob 테스트 광고 문서(Android)의 Interstitial 테스트 ID
    assert.deepEqual(monetization.resolveAdUnit('interstitial', { interstitial: '   ' }), {
        adId: 'ca-app-pub-3940256099942544/1033173712', isTesting: true,
    });
    assert.deepEqual(monetization.resolveAdUnit('interstitial', { interstitial: 'ca-app-pub-1/2' }), { adId: 'ca-app-pub-1/2', isTesting: false });
    // 저장소에 실제 광고 ID가 들어가지 않았는지 확인합니다.
    const source = read('config/monetization.ts') + read('services/ads.ts');
    const adIds = source.match(/ca-app-pub-\d+[/~]\d+/g) ?? [];
    assert.ok(adIds.length > 0);
    assert.ok(adIds.every(id => id.startsWith('ca-app-pub-3940256099942544')), adIds.join(', '));
    assert.match(read('services/ads.ts'), /VITE_ADMOB_INTERSTITIAL_ID/);
    assert.match(read('.env.example'), /^VITE_ADMOB_INTERSTITIAL_ID=$/m);
});

test('the Android manifest falls back to the AdMob test app id', () => {
    const gradle = read('android/app/build.gradle');
    assert.match(gradle, /ca-app-pub-3940256099942544~3347511713/);
    assert.match(read('android/app/src/main/AndroidManifest.xml'), /\$\{admobAppId\}/);
});

test('product ids match the server catalog', () => {
    const server = read('functions/src/playBilling.ts');
    for (const productId of Object.values(monetization.PLAY_PRODUCT_IDS)) {
        assert.match(server, new RegExp(`\\b${productId}: \\{`), productId);
    }
});

test('rewarded ads are gone from the code', () => {
    const files = ['config/monetization.ts', 'services/ads.ts', 'hooks/useMonetization.ts', 'components/ShopModal.tsx', 'App.tsx', '.env.example'];
    for (const file of files) {
        assert.doesNotMatch(read(file), /RewardVideo|REWARDED_|rewardedAd|onRewardEarned|VITE_ADMOB_REWARDED_ID/, file);
    }
    assert.equal(fs.existsSync(path.join(__dirname, '../utils/rewardedAdQuota.ts')), false);
});

// ── 동영상 광고 시점 ────────────────────────────────────────────────────────
const MINUTE = 60_000;
const launchedAt = Date.UTC(2026, 10, 3, 9, 0);

test('video ads wait 3 minutes after launch and 5 minutes between ads by default', () => {
    assert.equal(monetization.VIDEO_AD_LIMITS.launchGraceMs, 3 * MINUTE);
    assert.equal(monetization.VIDEO_AD_LIMITS.minIntervalMs, 5 * MINUTE);
    const fresh = { launchedAt, lastShownAt: null };
    const ask = (clock, now, extra = {}) => policy.videoAdRequestBlocker({ enabled: true, trigger: 'sell', showing: false, clock, now, ...extra });

    assert.equal(ask(fresh, launchedAt), 'launch-grace');
    assert.equal(ask(fresh, launchedAt + 3 * MINUTE - 1), 'launch-grace');
    assert.equal(ask(fresh, launchedAt + 3 * MINUTE), null);
    assert.equal(policy.nextVideoAdAt(fresh), launchedAt + 3 * MINUTE);

    const afterAd = { launchedAt, lastShownAt: launchedAt + 10 * MINUTE };
    assert.equal(ask(afterAd, launchedAt + 14 * MINUTE), 'interval');
    assert.equal(ask(afterAd, launchedAt + 15 * MINUTE), null);
    assert.equal(policy.nextVideoAdAt(afterAd), launchedAt + 15 * MINUTE);
    assert.equal(policy.formatWait(2 * MINUTE + 5_000), '2:05');
});

test('video ads never run for ad-free accounts, on the web, or while one is showing', () => {
    const ready = { launchedAt, lastShownAt: null };
    const now = launchedAt + 30 * MINUTE;
    // enabled=false: 광고 제거 계정, 웹(광고 미지원), 혜택을 아직 못 읽은 상태
    assert.equal(policy.videoAdRequestBlocker({ enabled: false, trigger: 'breed', showing: false, clock: ready, now }), 'ads-off');
    assert.equal(policy.videoAdRequestBlocker({ enabled: true, trigger: 'breed', showing: true, clock: ready, now }), 'showing');
    for (const trigger of Object.keys(monetization.VIDEO_AD_TRIGGERS)) {
        assert.equal(policy.videoAdRequestBlocker({ enabled: true, trigger, showing: false, clock: ready, now }), null, trigger);
    }
});

test('video ad break points are natural pauses and stale breaks are dropped', () => {
    assert.deepEqual(Object.keys(monetization.VIDEO_AD_TRIGGERS).sort(), ['breed', 'pondSwitch', 'sell']);
    for (const trigger of Object.values(monetization.VIDEO_AD_TRIGGERS)) {
        assert.ok(trigger.settleMs >= 0 && trigger.settleMs <= 5_000);
        assert.ok(trigger.label.length > 0);
    }
    const pending = { trigger: 'sell', requestedAt: launchedAt };
    assert.equal(policy.isBreakStillWanted(pending, launchedAt + 2 * MINUTE), true);
    assert.equal(policy.isBreakStillWanted(pending, launchedAt + 2 * MINUTE + 1), false);
    // 앱 시작·종료 때 띄우는 코드가 없습니다: 광고는 쉬는 지점 요청(requestBreak)으로만 시작합니다.
    const app = read('App.tsx');
    const requests = app.match(/requestVideoAdBreak\('(\w+)'\)/g) ?? [];
    assert.deepEqual([...new Set(requests)].sort(), ["requestVideoAdBreak('breed')", "requestVideoAdBreak('pondSwitch')", "requestVideoAdBreak('sell')"]);
    // 광고가 떠 있는 동안 게임 소리를 멈추고, 닫히면 다시 켭니다.
    const hook = read('hooks/useVideoAds.ts');
    assert.match(hook, /onShow: \(\) => audioManager\.pauseForAd\(\)/);
    assert.match(hook, /onClose: \(\) => audioManager\.resumeAfterAd\(\)/);
});

// ── 로컬 미리보기(npm run dev:mock) ────────────────────────────────────────
test('the monetization mock can only turn on in the local dev server', () => {
    assert.match(read('config/monetizationMock.ts'),
        /export const isMonetizationMock: boolean = import\.meta\.env\.DEV && import\.meta\.env\.MODE === 'monetization-mock';/);
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['dev:mock'], 'vite --mode monetization-mock');
    assert.match(pkg.scripts.build, /^vite build && node scripts\/check-production-build\.cjs$/);
    // 미리보기 스위치는 한 곳에만 있습니다.
    const sources = ['App.tsx', 'contexts/AuthContext.tsx', 'services/firebase.ts', 'services/analytics.ts', 'services/localSave.ts',
        'services/monetizationBackend.ts', 'hooks/useAchievements.ts'];
    for (const file of sources) assert.doesNotMatch(read(file), /MODE === 'monetization-mock'/, file);
});

// 아래 두 테스트는 미리보기 모드가 켜진 것처럼 실제 모듈을 불러옵니다(테스트 파일마다 따로 된 프로세스).
const mockConfigPath = path.join(__dirname, '../config/monetizationMock.ts');
require.cache[mockConfigPath] = {
    id: mockConfigPath, filename: mockConfigPath, loaded: true,
    exports: { isMonetizationMock: true, MONETIZATION_MOCK_SCOPE: 'monetization-mock' },
};
const memoryStorage = () => {
    const items = new Map();
    return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key), items };
};

test('mock mode keeps its own local save slot apart from the real guest and account saves', () => {
    const { getScopedSaveGameKey, GUEST_SAVE_GAME_KEY } = require('../services/localSave.ts');
    assert.equal(getScopedSaveGameKey(null), 'zenKoiGardenSaveData_monetization-mock_v1');
    assert.equal(getScopedSaveGameKey('real-user'), 'zenKoiGardenSaveData_monetization-mock_v1');
    assert.notEqual(getScopedSaveGameKey(null), GUEST_SAVE_GAME_KEY);
});

test('the mock Google Play sheet runs the buy, cancel and pending paths', async () => {
    global.localStorage = memoryStorage();
    const mock = require('../services/mockMonetization.ts');
    const backend = mock.mockMonetizationBackend;
    const updates = [];
    const stop = backend.subscribeToEntitlements('monetization-mock', value => updates.push(value));
    assert.deepEqual(updates[0], { paidPondSlots: 0, adFree: false });

    const waitFor = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); };

    const bought = backend.purchase('monetization-mock', 'pond_slot');
    assert.deepEqual(mock.mockUiStore.getSnapshot().purchase, { productId: 'pond_slot', phase: 'choose' });
    mock.answerMockPurchase('buy');
    await waitFor(() => mock.mockUiStore.getSnapshot().purchase?.phase === 'processing');
    const granted = await bought;
    assert.equal(granted.status, 'granted');
    assert.deepEqual(granted.entitlements, { paidPondSlots: 1, adFree: false });
    assert.equal(mock.mockUiStore.getSnapshot().purchase, null);
    assert.deepEqual(updates.at(-1), { paidPondSlots: 1, adFree: false });
    assert.deepEqual(JSON.parse(global.localStorage.getItem('koiworld:monetization-mock:entitlements')), { paidPondSlots: 1, adFree: false });

    const cancelled = backend.purchase('monetization-mock', 'remove_ads');
    mock.answerMockPurchase('cancel');
    assert.equal(await cancelled, null);

    const pending = backend.purchase('monetization-mock', 'remove_ads');
    mock.answerMockPurchase('pending');
    assert.equal((await pending).status, 'pending');
    assert.equal(mock.readMockEntitlements().adFree, false);

    // 가짜 동영상 광고: 닫을 때까지 기다리고, 소리 멈춤·재개 신호를 한 번씩 보냅니다.
    const sound = [];
    const shown = backend.showVideoAd({ onShow: () => sound.push('pause'), onClose: () => sound.push('resume') });
    assert.ok(mock.mockUiStore.getSnapshot().videoAd);
    mock.closeMockVideoAd();
    assert.equal(await shown, true);
    assert.deepEqual(sound, ['pause', 'resume']);
    assert.equal(mock.mockUiStore.getSnapshot().videoAd, null);
    stop();
});

test('the production build check finds mock markers, including escaped ones', () => {
    assert.deepEqual(buildCheck.markersMissingFromSources(), []);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koiworld-build-check-'));
    try {
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>');
        fs.writeFileSync(path.join(dir, 'assets', 'index.js'), 'const shop = "연못 확장권";');
        assert.deepEqual(buildCheck.findMockMarkers(dir), []);
        fs.writeFileSync(path.join(dir, 'assets', 'leak.js'), 'const a = "\\ubc30\\ub108 \\uad11\\uace0 \\uc790\\ub9ac"; const b = "monetization-mock";');
        assert.deepEqual(buildCheck.findMockMarkers(dir).map(item => item.marker).sort(), ['monetization-mock', '배너 광고 자리']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ── 상점 화면: 실제 ShopModal JSX를 아주 작은 렌더러로 실행해 확인합니다 ─────────────
function renderShop(overrides = {}) {
    const slots = [];
    let cursor = 0;
    const react = {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        useState: initial => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
    };
    const icon = name => () => ({ type: 'svg', props: { 'data-icon': name }, children: [] });
    const exports = {};
    vm.runInNewContext(ts.transpileModule(read('components/ShopModal.tsx'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText, {
        exports,
        require: name => {
            if (name === 'react') return { ...react, default: react };
            if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => icon(String(key)) });
            if (name === './FoodIcons') return { CornIcon: icon('corn'), FeedIcon: icon('feed') };
            if (name === './menuStyles') return { MODAL_CLOSE: '' };
            if (name === '../config/monetization') return monetization;
            if (name === '../functions/src/saveValidation') return saveValidation;
            throw new Error(`unexpected import ${name}`);
        },
    });
    const calls = [];
    const props = {
        onClose: () => {}, zenPoints: 50000,
        onBuyFood: () => {}, onBuyFoodLarge: () => {}, onBuyCorn: () => {}, onBuyCornLarge: () => {}, onBuyTrophy: () => {},
        ...overrides,
        monetization: {
            isNativeStore: false, prices: {}, busyProductId: null, paidPondSlots: 0, adFree: false,
            onPurchase: productId => calls.push(productId), onRestorePurchases: () => calls.push('restore'),
            ...overrides.monetization,
        },
    };
    // 함수 컴포넌트를 펼쳐 DOM 요소만 남깁니다.
    const expand = node => {
        if (Array.isArray(node)) return node.flatMap(expand);
        if (!node || typeof node !== 'object') return node === false || node == null ? [] : [node];
        if (typeof node.type === 'function') {
            return expand(node.type({ ...node.props, children: node.children.length <= 1 ? node.children[0] : node.children }));
        }
        return [{ ...node, children: node.children.flatMap(expand) }];
    };
    cursor = 0;
    const tree = expand(exports.ShopModal(props))[0];
    return { tree, calls };
}
const flatten = node => (node && typeof node === 'object' ? [node, ...node.children.flatMap(flatten)] : []);
const text = node => (typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children ?? []).map(text).join(''));
const buttons = tree => flatten(tree).filter(node => node.type === 'button');
const byLabel = (tree, label) => buttons(tree).find(node => (node.props['aria-label'] ?? '').startsWith(label));
const rowTitles = tree => flatten(tree).filter(node => node.type === 'h4').map(text);

test('the shop sells ponds only as one Google Play item, never for ZP', () => {
    const { tree } = renderShop({ monetization: { isNativeStore: true, prices: { pond_slot: '₩2,500' }, paidPondSlots: 1 } });
    const titles = rowTitles(tree);
    assert.equal(titles.filter(title => title.includes('연못')).length, 1);
    assert.ok(titles.includes('연못 확장권'));
    assert.doesNotMatch(text(tree), /20,000 ZP|특별 연못|젠 포인트로 최대/);
    assert.match(text(tree), /보유 1\/4/);
    assert.ok(byLabel(tree, '연못 확장권 Google Play로 구매하기'));
});

test('web shows an app-purchase notice instead of Google Play buttons and still shows owned benefits', () => {
    const { tree } = renderShop({ monetization: { paidPondSlots: 2, adFree: true } });
    const all = text(tree);
    assert.match(all, /앱에서 구매할 수 있어요/);
    assert.match(all, /보유 2\/4/);
    assert.match(all, /적용됨/);
    assert.equal(byLabel(tree, '연못 확장권'), undefined);
    assert.equal(byLabel(tree, '광고 제거'), undefined);
    assert.equal(buttons(tree).some(node => text(node).includes('구매 복원')), false);
    assert.match(all, /연못 확장권과 광고 제거는 Android 앱에서 구매할 수 있어요/);
});

test('the app shows Google Play buttons and restore; ad removal covers banner and video ads', () => {
    const { tree, calls } = renderShop({
        monetization: { isNativeStore: true, prices: { pond_slot: '₩2,500', remove_ads: '₩5,500' } },
    });
    const all = text(tree);
    assert.match(all, /₩2,500/);
    assert.match(all, /₩5,500/);
    assert.match(all, /배너와 동영상 광고가 모두 사라져요/);
    assert.doesNotMatch(all, /보상형|광고 보고 받기/);
    byLabel(tree, '연못 확장권 Google Play로 구매하기').props.onClick();
    byLabel(tree, '광고 제거 Google Play로 구매하기').props.onClick();
    buttons(tree).find(node => text(node).includes('구매 복원')).props.onClick();
    assert.deepEqual(calls, ['pond_slot', 'remove_ads', 'restore']);
});

test('limits disable the right Google Play buttons', () => {
    const { tree } = renderShop({ monetization: { isNativeStore: true, paidPondSlots: 4, adFree: true } });
    assert.equal(byLabel(tree, '연못 확장권').props.disabled, true);
    assert.match(byLabel(tree, '연못 확장권').props['aria-label'], /최대 보유량 도달/);
    assert.equal(byLabel(tree, '광고 제거').props.disabled, true);
});

test('shop rows use full-width buttons on mobile and divider lines instead of nested boxes', () => {
    const { tree } = renderShop({ monetization: { isNativeStore: true } });
    const actionButtons = buttons(tree).filter(node => /구매하기|ZP 부족/.test(text(node)));
    assert.ok(actionButtons.length >= 7);
    for (const button of actionButtons) {
        assert.match(button.props.className, /(^|\s)w-full(\s|$)/, text(button));
        assert.match(button.props.className, /sm:w-auto/, text(button));
    }
    const lists = flatten(tree).filter(node => node.type === 'ul');
    assert.ok(lists.length >= 4);
    assert.ok(lists.every(list => /divide-y/.test(list.props.className)));
    // 목록 안의 줄에는 배경 상자를 두지 않습니다.
    const rows = flatten(tree).filter(node => node.type === 'li');
    const boxed = rows.flatMap(flatten).filter(node => node.type !== 'button' && /\bbg-(slate|white|gray)-/.test(node.props?.className ?? ''));
    assert.deepEqual(boxed.map(node => node.props.className), []);
});
