const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// 새 테스트 의존성 없이 실제 TypeScript 모듈을 실행합니다.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const monetization = require('../config/monetization.ts');
const quota = require('../utils/rewardedAdQuota.ts');
const saveValidation = require('../functions/src/saveValidation.ts');

test('ads use Google test ad units until a production id is configured', () => {
    assert.deepEqual(monetization.resolveAdUnit('banner'), {
        adId: 'ca-app-pub-3940256099942544/6300978111', isTesting: true,
    });
    assert.deepEqual(monetization.resolveAdUnit('rewarded', { rewarded: '   ' }), {
        adId: 'ca-app-pub-3940256099942544/5224354917', isTesting: true,
    });
    assert.deepEqual(monetization.resolveAdUnit('banner', { banner: 'ca-app-pub-1/2' }), { adId: 'ca-app-pub-1/2', isTesting: false });
    // 저장소에 실제 광고 ID가 들어가지 않았는지 확인합니다.
    const source = fs.readFileSync(require.resolve('../config/monetization.ts'), 'utf8')
        + fs.readFileSync(require.resolve('../services/ads.ts'), 'utf8');
    const adIds = source.match(/ca-app-pub-\d+[/~]\d+/g) ?? [];
    assert.ok(adIds.length > 0);
    assert.ok(adIds.every(id => id.startsWith('ca-app-pub-3940256099942544')), adIds.join(', '));
});

test('the Android manifest falls back to the AdMob test app id', () => {
    const gradle = fs.readFileSync(require.resolve('../android/app/build.gradle'), 'utf8');
    assert.match(gradle, /ca-app-pub-3940256099942544~3347511713/);
    assert.match(fs.readFileSync(require.resolve('../android/app/src/main/AndroidManifest.xml'), 'utf8'), /\$\{admobAppId\}/);
});

test('product ids match the server catalog', () => {
    const server = fs.readFileSync(require.resolve('../functions/src/playBilling.ts'), 'utf8');
    for (const productId of Object.values(monetization.PLAY_PRODUCT_IDS)) {
        assert.match(server, new RegExp(`\\b${productId}: \\{`), productId);
    }
});

test('rewarded ads are limited per local day and reset the next day', () => {
    const morning = new Date(2026, 10, 3, 9, 0).getTime();
    const night = new Date(2026, 10, 3, 23, 59).getTime();
    const tomorrow = new Date(2026, 10, 4, 0, 1).getTime();
    let log = quota.readRewardedAdLog(null, morning);
    assert.equal(quota.remainingRewardedAds(log, 5, morning), 5);
    for (let i = 0; i < 5; i++) log = quota.recordRewardedAd(log, morning);
    assert.equal(quota.remainingRewardedAds(log, 5, night), 0);
    assert.equal(quota.remainingRewardedAds(log, 5, tomorrow), 5);
    assert.deepEqual(quota.readRewardedAdLog({ day: '2026-11-03', count: 'x' }, morning), { day: '2026-11-03', count: 0 });
    assert.deepEqual(quota.recordRewardedAd(log, tomorrow), { day: '2026-11-04', count: 1 });
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
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../components/ShopModal.tsx'), 'utf8'), {
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
        onBuyPond: () => calls.push('zen-pond'),
        regularPondCount: 2,
        ...overrides,
        monetization: {
            isNativeStore: false, prices: {}, busyProductId: null, paidPondSlots: 0, adFree: false,
            onPurchase: productId => calls.push(productId), onRestorePurchases: () => calls.push('restore'),
            canWatchRewardedAds: false, isWatchingAd: false, rewardedAdsRemaining: 5,
            onWatchRewardedAd: kind => calls.push(`ad:${kind}`),
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

test('web shows an app-purchase notice instead of Google Play buttons and still shows owned benefits', () => {
    const { tree } = renderShop({ monetization: { paidPondSlots: 2, adFree: true } });
    const all = text(tree);
    assert.match(all, /앱에서 구매할 수 있어요/);
    assert.match(all, /보유 2\/4/);
    assert.match(all, /적용됨/);
    assert.equal(byLabel(tree, '특별 연못 슬롯'), undefined);
    assert.equal(byLabel(tree, '광고 제거'), undefined);
    assert.equal(buttons(tree).some(node => text(node).includes('구매 복원')), false);
    // 웹에는 보상형 광고 줄이 없습니다.
    assert.doesNotMatch(all, /광고 보고 받기/);
});

test('the app shows Google Play buttons, restore, and opt-in rewarded ads', () => {
    const { tree, calls } = renderShop({
        monetization: { isNativeStore: true, prices: { pond_slot: '₩2,500' }, canWatchRewardedAds: true, rewardedAdsRemaining: 3 },
    });
    assert.match(text(tree), /₩2,500/);
    assert.match(text(tree), /오늘 3\/5회 남았어요/);
    byLabel(tree, '특별 연못 슬롯 Google Play로 구매하기').props.onClick();
    byLabel(tree, '광고 제거 Google Play로 구매하기').props.onClick();
    byLabel(tree, '광고 보고 기본 사료 30개 받기').props.onClick();
    buttons(tree).find(node => text(node).includes('구매 복원')).props.onClick();
    assert.deepEqual(calls, ['pond_slot', 'remove_ads', 'ad:food', 'restore']);
});

test('limits disable the right pond buttons', () => {
    const { tree } = renderShop({ regularPondCount: 4, monetization: { isNativeStore: true, paidPondSlots: 4, adFree: true } });
    assert.equal(byLabel(tree, '연못 확장권').props.disabled, true);
    assert.match(byLabel(tree, '연못 확장권').props['aria-label'], /최대 보유량 도달/);
    assert.equal(byLabel(tree, '특별 연못 슬롯').props.disabled, true);
    assert.equal(byLabel(tree, '광고 제거').props.disabled, true);
});

test('shop rows use full-width buttons on mobile and divider lines instead of nested boxes', () => {
    const { tree } = renderShop({ monetization: { isNativeStore: true, canWatchRewardedAds: true } });
    const actionButtons = buttons(tree).filter(node => /구매하기|광고 보기|ZP 부족/.test(text(node)));
    assert.ok(actionButtons.length >= 8);
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
