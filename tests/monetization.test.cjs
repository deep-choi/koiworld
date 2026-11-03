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

// 소스 글자 비교는 줄바꿈(CRLF/LF)·들여쓰기와 관계없이 합니다(Windows core.autocrlf=true에서도 같은 결과).
const { normalizeNewlines, readSource: read, sourcePattern } = require('./helpers/source-text.cjs');
/** 그림·동영상 파일을 불러오는 import 문(여러 줄로 나눠도 import부터 세미콜론까지 봅니다) */
const MEDIA_IMPORT = /^\s*import\b[^;]*?['"][^'"]*\.(png|jpe?g|svg|webp|gif|mp4|webm)(\?[^'"]*)?['"]/m;

test('source text checks ignore CRLF, wrapped lines and indentation but still catch real changes', () => {
    assert.equal(normalizeNewlines('a\r\nb\rc\nd'), 'a\nb\nc\nd');
    const pattern = sourcePattern("mode === 'device' ? <MockDeviceShell /> : <>{game}</>");
    assert.match("mode === 'device' ? <MockDeviceShell /> : <>{game}</>", pattern);
    assert.match("mode === 'device'\r\n        ? <MockDeviceShell />\r\n        : <>{game}</>", pattern);
    assert.doesNotMatch("mode === 'phone' ? <MockDeviceShell /> : <>{game}</>", pattern);
    // 단어 사이 공백은 없어지면 안 됩니다(const pondError ≠ constpondError).
    assert.match('const pondError =\n    pondAllowanceError(', sourcePattern('const pondError = pondAllowanceError('));
    assert.doesNotMatch('constpondError = pondAllowanceError(', sourcePattern('const pondError = pondAllowanceError('));
    // 결제 시트 "구매" 버튼 글자와 미디어 import 검사도 CRLF·들여쓰기와 관계없이 맞습니다.
    assert.match('<button>\r\n\t\t구매\r\n</button>', />\s*구매\s*</);
    assert.match("import appIcon\r\n    from '../../icon.png?url';", MEDIA_IMPORT);
    assert.match("  import clip from './ad.mp4';", MEDIA_IMPORT);
    assert.doesNotMatch("// import로 불러오면 빌드에 복사됩니다.\nconst APP_ICON_URL = '/a/ic_launcher.png';", MEDIA_IMPORT);
    assert.doesNotMatch("import React from 'react';\nconst icon = '/icon.png';", MEDIA_IMPORT);
});

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
        assert.match(server, new RegExp(`\\b${productId}:\\s*\\{`), productId);
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
    assert.match(hook, sourcePattern('onShow: () => audioManager.pauseForAd()'));
    assert.match(hook, sourcePattern('onClose: () => audioManager.resumeAfterAd()'));
});

// ── 로컬 미리보기(npm run dev:mock) ────────────────────────────────────────
test('the monetization mock can only turn on in the local dev server', () => {
    assert.match(read('config/monetizationMock.ts'),
        sourcePattern("export const isMonetizationMock: boolean = import.meta.env.DEV && import.meta.env.MODE === 'monetization-mock';"));
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['dev:mock'], 'vite --mode monetization-mock');
    assert.match(pkg.scripts.build, /^vite build && node scripts\/check-production-build\.cjs$/);
    // 미리보기 스위치는 한 곳에만 있습니다.
    const sources = ['App.tsx', 'contexts/AuthContext.tsx', 'services/firebase.ts', 'services/analytics.ts', 'services/localSave.ts',
        'services/monetizationBackend.ts', 'hooks/useAchievements.ts'];
    for (const file of sources) assert.doesNotMatch(read(file), sourcePattern("MODE === 'monetization-mock'"), file);
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

    const waitFor = async predicate => { for (let i = 0; i < 400 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); };

    // 실제 앱처럼 가격만 보여 줍니다("예시" 같은 설명은 휴대폰 화면 바깥 패널에만).
    // 출시 예정 가격: 연못 확장권 ₩1,900, 광고 제거 ₩2,500
    assert.deepEqual(await backend.loadProductPrices(), { pond_slot: '₩1,900', remove_ads: '₩2,500' });

    const bought = backend.purchase('monetization-mock', 'pond_slot');
    assert.deepEqual(mock.mockUiStore.getSnapshot().purchase, { productId: 'pond_slot', phase: 'choose', outcome: 'approve' });
    // 시트의 "구매": 처리 중 → 결제 완료(체크) → 시트가 내려간 뒤 혜택
    mock.confirmMockPurchase();
    await waitFor(() => mock.mockUiStore.getSnapshot().purchase?.phase === 'processing');
    assert.equal(mock.mockUiStore.getSnapshot().purchase?.phase, 'processing');
    await waitFor(() => mock.mockUiStore.getSnapshot().purchase?.phase === 'done');
    assert.equal(mock.mockUiStore.getSnapshot().purchase?.phase, 'done');
    const granted = await bought;
    assert.equal(granted.status, 'granted');
    assert.deepEqual(granted.entitlements, { paidPondSlots: 1, adFree: false });
    assert.equal(mock.mockUiStore.getSnapshot().purchase, null);
    assert.deepEqual(updates.at(-1), { paidPondSlots: 1, adFree: false });
    assert.deepEqual(JSON.parse(global.localStorage.getItem('koiworld:monetization-mock:entitlements')), { paidPondSlots: 1, adFree: false });

    // 시트 바깥을 누르거나 바깥 패널의 "열린 결제 창 닫기"
    const cancelled = backend.purchase('monetization-mock', 'remove_ads');
    mock.cancelMockPurchase();
    assert.equal(await cancelled, null);
    assert.equal(mock.mockUiStore.getSnapshot().purchase, null);

    // 바깥 패널에서 "취소"를 고르면 "구매"를 눌러도 취소로 끝납니다.
    mock.setMockPurchaseOutcome('cancel');
    const cancelledByOutcome = backend.purchase('monetization-mock', 'remove_ads');
    mock.confirmMockPurchase();
    assert.equal(await cancelledByOutcome, null);

    // 바깥 패널에서 "결제 대기"를 고르면 열린 시트의 결제 수단도 느린 테스트 카드로 바뀌고, 혜택은 생기지 않습니다.
    mock.setMockPurchaseOutcome('approve');
    const pending = backend.purchase('monetization-mock', 'remove_ads');
    mock.setMockPurchaseOutcome('pending');
    assert.equal(mock.mockUiStore.getSnapshot().purchase.outcome, 'pending');
    mock.confirmMockPurchase();
    assert.equal((await pending).status, 'pending');
    assert.equal(mock.readMockEntitlements().adFree, false);
    mock.setMockPurchaseOutcome('approve');

    // 실제 앱 화면에 없는 안내는 바깥 패널로 보냅니다.
    mock.showMockNotice('로그인 꺼짐');
    assert.equal(mock.mockUiStore.getSnapshot().notice.message, '로그인 꺼짐');
    mock.dismissMockNotice();
    assert.equal(mock.mockUiStore.getSnapshot().notice, null);

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

test('the outside preview panel drives the game only through the bridge', () => {
    global.localStorage = memoryStorage();
    const mock = require('../services/mockMonetization.ts');
    const { mockPreviewBridge, publishMockGame, findMockBridge, MOCK_BRIDGE_KEY } = require('../services/mockPreviewBridge.ts');
    const calls = [];
    const gameState = {
        adsEnabled: true, entitlements: { paidPondSlots: 0, adFree: false }, nextAdAt: 0, pendingTrigger: null,
        isVideoAdShowing: false, paidPondCount: 0, paidPondsWithKoi: 0,
    };
    const actions = { showVideoAdNow: () => calls.push('show'), resetAdTimers: () => calls.push('reset'), removePaidPonds: () => calls.push('remove') };
    let notified = 0;
    const stop = mockPreviewBridge.subscribe(() => notified++);
    publishMockGame(gameState, actions);
    const first = mockPreviewBridge.getSnapshot();
    assert.deepEqual(first.game, gameState);
    // 같은 값을 다시 알려도 패널을 다시 그리지 않습니다.
    publishMockGame({ ...gameState, entitlements: { ...gameState.entitlements } }, actions);
    assert.equal(mockPreviewBridge.getSnapshot(), first);
    const afterPublish = notified;

    mockPreviewBridge.actions.showVideoAdNow();
    mockPreviewBridge.actions.resetAdTimers();
    mockPreviewBridge.actions.setAdFree(true);
    assert.equal(mock.readMockEntitlements().adFree, true);
    mockPreviewBridge.actions.setPaidPondSlots(9);
    assert.equal(mock.readMockEntitlements().paidPondSlots, 4);
    mockPreviewBridge.actions.resetPurchases();
    assert.deepEqual(mock.readMockEntitlements(), { paidPondSlots: 0, adFree: false });
    assert.deepEqual(calls, ['show', 'reset', 'remove']);
    mockPreviewBridge.actions.setPurchaseOutcome('pending');
    assert.equal(mockPreviewBridge.getSnapshot().ui.purchaseOutcome, 'pending');
    assert.ok(notified > afterPublish);
    mockPreviewBridge.actions.setPurchaseOutcome('approve');
    stop();

    // 기기 테두리 안 iframe 창에 걸린 다리를 찾습니다. 없거나 읽을 수 없는 창이면 null입니다.
    const found = findMockBridge({ [MOCK_BRIDGE_KEY]: mockPreviewBridge });
    assert.equal(found.getSnapshot(), mockPreviewBridge.getSnapshot());
    found.actions.setAdFree(true);
    assert.equal(mock.readMockEntitlements().adFree, true);
    found.actions.setAdFree(false);
    // iframe이 새로 고쳐져 옛 창의 함수를 부를 수 없게 되어도 패널은 멈추지 않고 마지막 상태를 씁니다.
    const dead = () => { throw new TypeError("can't access dead object"); };
    const gone = findMockBridge({ [MOCK_BRIDGE_KEY]: { subscribe: () => dead, getSnapshot: mockPreviewBridge.getSnapshot, actions: { ...mockPreviewBridge.actions } } });
    const lastSnapshot = gone.getSnapshot();
    const unsubscribe = gone.subscribe(() => {});
    const broken = findMockBridge({ [MOCK_BRIDGE_KEY]: { subscribe: dead, getSnapshot: dead, actions: { showVideoAdNow: dead } } });
    assert.doesNotThrow(() => unsubscribe());
    assert.doesNotThrow(() => broken.subscribe(() => {})());
    assert.doesNotThrow(() => broken.actions.showVideoAdNow());
    assert.deepEqual(broken.getSnapshot().game, null);
    assert.ok(lastSnapshot.ui);
    assert.equal(findMockBridge({}), null);
    assert.equal(findMockBridge(null), null);
    assert.equal(findMockBridge(new Proxy({}, { get: () => { throw new Error('cross-origin'); } })), null);
});

test('inside the phone screen there is no preview badge, explanation or tool button', () => {
    // 휴대폰 화면 안에 그리는 것: 배너, 동영상 광고, 결제 시트(실제 앱에 있는 것). 주석은 빼고 화면에 나오는 코드만 봅니다.
    const withoutComments = file => ts.transpileModule(read(file), {
        compilerOptions: { removeComments: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const inside = ['components/mock/MockTestBanner.tsx', 'components/mock/MockVideoAd.tsx', 'components/mock/MockPlaySheet.tsx'].map(withoutComments).join('\n');
    assert.doesNotMatch(inside, /미리보기|가짜|자리|예시|청구 없음|실제 광고가 아니/);
    assert.match(read('components/mock/MockTestBanner.tsx'), />\s*Test Ad\s*</);
    assert.match(read('components/mock/MockTestBanner.tsx'), /h-\[50px\] w-\[320px\]/);
    // 동영상 광고: 캔버스로 재생(외부 동영상 파일 없음), 15초 길이, 5초 뒤 건너뛰기, 끝나면 닫기
    const video = read('components/mock/MockVideoAd.tsx');
    assert.match(video, sourcePattern('MOCK_VIDEO_LENGTH_SECONDS = 15;'));
    assert.match(video, sourcePattern('MOCK_VIDEO_SKIP_AFTER_SECONDS = 5;'));
    assert.match(video, /<canvas/);
    assert.match(video, /requestAnimationFrame/);
    assert.doesNotMatch(video, /<video|\.mp4|\.webm|https?:\/\//);
    assert.match(video, /광고 건너뛰기/);
    assert.match(video, /aria-label="광고 닫기"/);
    // 결제 시트: 앱 아이콘, 상품 이름, 가격, 테스트 카드, 구매 버튼, 처리 중, 결제 완료
    const sheet = read('components/mock/MockPlaySheet.tsx');
    for (const part of ['mipmap-xxxhdpi/ic_launcher.png', 'src={APP_ICON_URL}', 'MOCK_PRODUCT_NAMES[productId]', 'MOCK_SAMPLE_PRICES[productId]', 'MOCK_TEST_INSTRUMENTS.approve', '결제 처리 중', '결제 완료']) {
        assert.ok(sheet.includes(part), part);
    }
    // "구매" 버튼 글자: 버튼 태그와의 사이 줄바꿈·들여쓰기는 상관없습니다.
    assert.match(sheet, />\s*구매\s*</);
    assert.equal(require('../services/mockMonetization.ts').MOCK_TEST_INSTRUMENTS.approve, '테스트 카드, 항상 승인');
    // 미리보기 소스는 그림·동영상 파일을 import하지 않습니다(import하면 Vite가 배포 빌드에 파일을 복사함).
    for (const file of fs.readdirSync(path.join(__dirname, '../components/mock'))) {
        assert.doesNotMatch(read(`components/mock/${file}`), MEDIA_IMPORT, file);
    }
    // 게임 안 레이어는 휴대폰 크기 브라우저에서만 구석 버튼을 그리고, 배지는 바깥 패널에만 있습니다.
    const layer = read('components/mock/MonetizationMockLayer.tsx');
    assert.match(layer, sourcePattern('{!insideDeviceFrame && <CornerTools'));
    assert.doesNotMatch(layer, /미리보기 모드/);
    assert.match(read('components/mock/MockPreviewPanel.tsx'), sourcePattern("MOCK_PREVIEW_BADGE = '미리보기 모드 · 실제 청구 없음'"));
    // 로그인 버튼의 안내도 게임 화면 토스트가 아니라 바깥 패널로 보냅니다.
    assert.match(read('App.tsx'), sourcePattern('showMockNotice(MONETIZATION_MOCK_LOGIN_MESSAGE)'));
    assert.doesNotMatch(read('App.tsx'), sourcePattern('setNotification({ message: MONETIZATION_MOCK_LOGIN_MESSAGE'));
});

test('the desktop preview runs the game inside a 412x915 phone frame and only there', () => {
    const env = read('components/mock/mockPreviewEnv.ts');
    assert.match(env, sourcePattern('PHONE_SCREEN = { width: 412, height: 915 }'));
    const root = read('components/mock/MockPreviewRoot.tsx');
    assert.match(root, /<iframe/);
    assert.match(root, sourcePattern("mode === 'device' ? <MockDeviceShell /> : <>{game}</>"));
    // 바깥 문서(데스크톱)는 게임을 그리지 않고 기기 테두리와 패널만 그립니다.
    assert.doesNotMatch(root, /<App\b/);
    // 미리보기 껍데기는 미리보기 모드에서만 씁니다.
    assert.match(read('index.tsx'), sourcePattern('root.render(isMonetizationMock ? <MockPreviewRoot game={game} /> : game);'));
});

test('the production build check finds mock markers, including escaped ones', () => {
    assert.deepEqual(buildCheck.markersMissingFromSources(), []);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koiworld-build-check-'));
    try {
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>');
        fs.writeFileSync(path.join(dir, 'assets', 'index.js'), 'const shop = "연못 확장권";');
        assert.deepEqual(buildCheck.findMockMarkers(dir), []);
        // "미리보기 도구"를 \uXXXX로 바꿔 쓴 경우도 찾습니다.
        fs.writeFileSync(path.join(dir, 'assets', 'leak.js'), 'const a = "\\ubbf8\\ub9ac\\ubcf4\\uae30 \\ub3c4\\uad6c"; const b = "monetization-mock";');
        assert.deepEqual(buildCheck.findMockMarkers(dir).map(item => item.marker).sort(), ['monetization-mock', '미리보기 도구'].sort());
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
    const { tree } = renderShop({ monetization: { isNativeStore: true, prices: { pond_slot: '₩1,900' }, paidPondSlots: 1 } });
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
        monetization: { isNativeStore: true, prices: { pond_slot: '₩1,900', remove_ads: '₩2,500' } },
    });
    const all = text(tree);
    assert.match(all, /₩1,900/);
    assert.match(all, /₩2,500/);
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
        assert.doesNotMatch(button.props.className, /sm:w-auto/, text(button));
    }
    const lists = flatten(tree).filter(node => node.type === 'ul');
    assert.ok(lists.length >= 4);
    assert.ok(lists.every(list => /divide-y/.test(list.props.className)));
    // 목록 안의 줄에는 배경 상자를 두지 않습니다.
    const rows = flatten(tree).filter(node => node.type === 'li');
    const boxed = rows.flatMap(flatten).filter(node => node.type !== 'button' && /\bbg-(slate|white|gray)-/.test(node.props?.className ?? ''));
    assert.deepEqual(boxed.map(node => node.props.className), []);
});

test('Google Play buy buttons use the same brand orange as the other buy buttons', () => {
    const { tree } = renderShop({ monetization: { isNativeStore: true } });
    const zpButton = byLabel(tree, '기본 사료 (50개) 1개 구매하기');
    const pondButton = byLabel(tree, '연못 확장권 Google Play로 구매하기');
    const adsButton = byLabel(tree, '광고 제거 Google Play로 구매하기');
    assert.ok(zpButton && pondButton && adsButton);
    assert.match(zpButton.props.className, /\bbg-orange-500\b/);
    assert.equal(pondButton.props.className, zpButton.props.className);
    assert.equal(adsButton.props.className, zpButton.props.className);
    // 상점에는 초록 강조가 남아 있지 않습니다(버튼, 아이콘, 안내 문구).
    assert.doesNotMatch(read('components/ShopModal.tsx'), /\b(?:bg|text|border|ring)-(?:emerald|green|teal|lime)-/);
});

test('the quantity stepper spans the full width like the buy button below it', () => {
    const { tree } = renderShop();
    const minus = byLabel(tree, '기본 사료 (50개) 수량 줄이기');
    const plus = byLabel(tree, '기본 사료 (50개) 수량 늘리기');
    const stepper = flatten(tree).find(node => node.type === 'div' && node.children.includes(minus) && node.children.includes(plus));
    assert.ok(stepper, 'minus and plus share one row');
    assert.match(stepper.props.className, /(^|\s)w-full(\s|$)/);
    assert.doesNotMatch(stepper.props.className, /sm:mr-auto|inline-flex/);
    // −는 왼쪽 끝, 숫자는 가운데(남는 폭을 모두 차지), +는 오른쪽 끝입니다.
    assert.equal(stepper.children[0], minus);
    assert.equal(stepper.children.at(-1), plus);
    assert.equal(stepper.children.length, 3);
    assert.match(stepper.children[1].props.className, /\bflex-1\b/);
    assert.match(stepper.children[1].props.className, /\btext-center\b/);
    assert.equal(text(stepper.children[1]), '1');
    // 수량 선택과 구매 버튼은 한 열에 위아래로 놓여 같은 폭입니다.
    const column = flatten(tree).find(node => node.type === 'div' && node.children.includes(stepper));
    assert.match(column.props.className, /\bflex-col\b/);
    assert.doesNotMatch(column.props.className, /sm:flex-row/);
});
