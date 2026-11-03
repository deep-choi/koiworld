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
// config/monetizationMock.ts reads import.meta.env, which CommonJS cannot run; tests always use the real (non-mock) game.
const mockConfigPath = require('node:path').join(__dirname, '../config/monetizationMock.ts');
require.cache[mockConfigPath] = {
    id: mockConfigPath, filename: mockConfigPath, loaded: true,
    exports: { isMonetizationMock: false, MONETIZATION_MOCK_SCOPE: 'monetization-mock' },
};
// 소스 글자 비교는 줄바꿈(CRLF/LF)·들여쓰기와 관계없이 합니다(Windows core.autocrlf=true에서도 같은 결과).
const { readSource, sourcePattern } = require('./helpers/source-text.cjs');
const journal = require('../services/saveJournal.ts');
const { SavePolicy, progressKey } = require('../services/savePolicy.ts');
const { getScopedSaveGameKey } = require('../services/localSave.ts');
const { normalizeSavedGameState } = require('../utils/savedGameState.ts');
const { isValidGameStateCore } = require('../functions/src/saveValidation.ts');
const state = (points = 2000) => normalizeSavedGameState({
    ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [], decorations: [], waterQuality: 100, theme: '기본 (맑은 물)' } },
    activePondId: 'pond-1', zenPoints: points, foodCount: 20, koiNameCounter: 3,
});
const resetStorage = () => {
    const items = new Map();
    global.localStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
};
test.beforeEach(resetStorage);

test('reopening restores unsent local progress from the same cloud revision', () => {
    journal.acceptCloudSave('u', state(), 5);
    journal.writeLocalSave('u', state(5000), 5);
    const pending = journal.readLocalSave('u');
    assert.equal(journal.chooseSaveSource(pending, state(), 5), 'local');
    assert.equal(pending.gameState.zenPoints, 5000);
});
test('a newer remote save is used automatically and retains the local recovery copy', () => {
    journal.writeLocalSave('u', state(5000), 5);
    assert.equal(journal.chooseSaveSource(journal.readLocalSave('u'), state(3000), 6), 'cloud');
    journal.archiveLocalSave('u');
    journal.acceptCloudSave('u', state(3000), 6);
    assert.equal(JSON.parse(localStorage.getItem(`${getScopedSaveGameKey('u')}_recovery`)).gameState.zenPoints, 5000);
});
test('late acknowledgement never marks newer local play as already uploaded', () => {
    journal.writeLocalSave('u', state(3000), 5);
    journal.writeLocalSave('u', state(5000), 5);
    journal.acknowledgeLocalSave('u', state(3000), 6);
    const pending = journal.readLocalSave('u');
    assert.equal(pending.dirty, true);
    assert.equal(pending.baseRevision, 6);
    assert.equal(pending.gameState.zenPoints, 5000);
    journal.acknowledgeLocalSave('u', state(5000), 7);
    assert.equal(journal.readLocalSave('u').dirty, false);
});
test('legacy unversioned saves cannot replace the cloud save', () => {
    localStorage.setItem(getScopedSaveGameKey('u'), JSON.stringify(state(7000)));
    assert.equal(journal.chooseSaveSource(journal.readLocalSave('u'), state(), 2), 'cloud');
});
test('storage failure is reported and leaves the existing save intact', () => {
    journal.writeLocalSave('u', state(), 4);
    localStorage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => journal.writeLocalSave('u', state(4000), 4), /quota/);
    assert.equal(journal.readLocalSave('u').gameState.zenPoints, 2000);
});

test('rollback to 1.0.4 can read the plain save and old-client changes invalidate sync metadata', () => {
    journal.acceptCloudSave('u', state(), 5);
    const key = getScopedSaveGameKey('u');
    const plain = JSON.parse(localStorage.getItem(key));
    assert.equal(plain.zenPoints, 2000);
    assert.ok(plain.ponds['pond-1']);
    assert.equal(plain.gameState, undefined);
    localStorage.setItem(key, JSON.stringify(state(4000)));
    const restored = journal.readLocalSave('u');
    assert.equal(restored.gameState.zenPoints, 4000);
    assert.equal(restored.baseRevision, null);
    assert.equal(journal.chooseSaveSource(restored, state(), 5), 'cloud');
});

test('interrupted metadata write retains newest progress and never assumes it was uploaded', () => {
    journal.acceptCloudSave('u', state(), 5);
    const setItem = localStorage.setItem;
    localStorage.setItem = (key, value) => {
        if (key.endsWith('_journal_v1')) throw new Error('quota');
        setItem(key, value);
    };
    assert.throws(() => journal.writeLocalSave('u', state(9000), 5), /quota/);
    const restored = journal.readLocalSave('u');
    assert.equal(restored.gameState.zenPoints, 9000);
    assert.equal(restored.dirty, true);
    assert.equal(restored.baseRevision, null);
});

test('earlier 1.0.5 wrapped save migrates to a rollback-compatible body without loss', () => {
    localStorage.setItem(getScopedSaveGameKey('u'), JSON.stringify({
        localSaveVersion: 1, gameState: state(7000), baseRevision: 9, dirty: true, savedAt: 123,
    }));
    const original = journal.readLocalSave('u');
    assert.equal(original.baseRevision, 9);
    journal.writeLocalSave('u', original.gameState, original.baseRevision);
    assert.equal(JSON.parse(localStorage.getItem(getScopedSaveGameKey('u'))).zenPoints, 7000);
    assert.equal(journal.readLocalSave('u').dirty, true);
});

test('simulation saves every minute; continuous purchases are sent promptly without debounce starvation', () => {
    const policy = new SavePolicy();
    policy.confirmed(state(), 0);
    const simulation = state();
    simulation.ponds['pond-1'].waterQuality = 80;
    assert.equal(progressKey(simulation), progressKey(state()));
    policy.observe(simulation, 1000);
    assert.equal(policy.due(59000), false);
    assert.equal(policy.due(60000), true);
    policy.confirmed(simulation, 60000);
    for (let time = 61000; time <= 62500; time += 500) policy.observe(state(time), time);
    assert.equal(policy.due(62999), false);
    assert.equal(policy.due(63000), true);
});

test('network failures back off while newer play stays eligible after the retry deadline', () => {
    const policy = new SavePolicy();
    policy.confirmed(state(), 0);
    policy.observe(state(3000), 1000);
    policy.failed(3000);
    policy.observe(state(4000), 4000);
    assert.equal(policy.due(7999), false);
    assert.equal(policy.due(8000), true);
    policy.failed(8000);
    assert.equal(policy.due(17999), false);
    assert.equal(policy.due(18000), true);
    policy.confirmed(state(3000), 18000);
    policy.observe(state(4000), 18001);
    assert.equal(policy.due(20001), true);
});
test('client and server reject missing koi arrays, malformed genetics and invalid numbers', () => {
    for (const mutate of [
        s => { delete s.ponds['pond-1'].kois; },
        s => { s.ponds['pond-1'].kois = [{ id: 'koi', genetics: {} }]; },
        s => { s.zenPoints = NaN; },
        s => { s.ponds['pond-1'].decorations = {}; },
    ]) {
        const value = state(); mutate(value);
        assert.equal(isValidGameStateCore(value), false);
        assert.equal(normalizeSavedGameState(value), null);
    }
});
test('valid legacy koi are upgraded without changing extreme genetic traits', () => {
    const value = state();
    value.ponds['pond-1'].kois = [{ id: 'legacy', genetics: { baseColorGenes: ['크림'], spots: [], lightness: 100, saturation: 0 } }];
    const koi = normalizeSavedGameState(value).ponds['pond-1'].kois[0];
    assert.equal(koi.genetics.lightness, 100);
    assert.equal(koi.genetics.saturation, 0);
    assert.equal(koi.position.x, 50);
});

// 실제 App의 계정 복구 함수를 실행하고 외부 통신 및 화면 갱신만 대체합니다.
const app = ts.createSourceFile('App.tsx', fs.readFileSync(require.resolve('../App.tsx'), 'utf8'), 99, true, ts.ScriptKind.TSX);
let initializer, enqueueInitializer, cloudUpdateInitializer, accountCreatedAtInitializer;
function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'initSession') initializer = node.initializer.getText(app);
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'accountCreatedAtOf') accountCreatedAtInitializer = node.initializer.getText(app);
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'enqueueCloudSave') enqueueInitializer = node.initializer.arguments[0].getText(app);
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'listenToGameData') cloudUpdateInitializer = node.arguments[1].getText(app);
    ts.forEachChild(node, walk);
}
walk(app);
// App의 실제 가입 시각 함수(Firebase Auth metadata.creationTime → ms)
const accountCreatedAtOf = vm.runInNewContext(ts.transpileModule(`(${accountCreatedAtInitializer})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, { Date, Number });
const { withAccountFreePonds } = require('../utils/savedGameState.ts');
class PondAllowanceRejectedError extends Error {}
function sessionContext(overrides = {}) {
    return {
        ...journal, cancelled: false, authLoading: false, user: { uid: 'u', isAnonymous: false },
        cloudHydratedUserIdRef: { current: null }, cloudGameStateRevisionRef: { current: null },
        cloudSaveBlockedRef: { current: false }, pendingCloudPayloadRef: { current: null },
        lastCloudSavePayloadRef: { current: null }, localHydratedScopeRef: { current: null },
        lastLocalSavePayloadRef: { current: null }, localProgressKeyRef: { current: null },
        savePolicyRef: { current: new SavePolicy() }, SavePolicy,
        setLocalSaveIssue: () => {}, setLocalSavedAt: () => {}, setCloudSavedAt: () => {},
        setIsCloudSaving: () => {}, setHasPendingCloudSave: () => {},
        setIsAccountRestoring: () => {}, setRestoreAttempt: () => {}, setCloudSaveIssue: () => {},
        setIsCloudSyncReady: () => {}, suppressLocalGameSave: () => {}, resumeLocalGameSave: () => {},
        loadGameState: () => state(), createInitialGameState: () => state(), handleLoadGame: () => {},
        ensureUserProfileNickname: async () => 'user', startSession: async () => {},
        setUserNickname: () => {}, setUserPhotoURL: () => {}, setNotification: () => {},
        GameStateRevisionConflictError: class extends Error {},
        PondAllowanceRejectedError, accountCreatedAtOf, withAccountFreePonds,
        console: { error: () => {} }, ...overrides,
    };
}
function restore(context) {
    return vm.runInNewContext(ts.transpileModule(`(${initializer})()`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
}

function cloudContext(overrides = {}) {
    return {
        ...sessionContext(), saveGenerationRef: { current: 1 },
        cloudGameStateRevisionRef: { current: 5 }, cloudSaveQueueRef: { current: Promise.resolve() },
        gameStateRef: { current: state(3000) }, isLocalGameSaveSuppressed: () => false,
        GameStateRevisionConflictError: class extends Error {}, ...overrides,
    };
}
function enqueue(context) {
    return vm.runInNewContext(ts.transpileModule(`(${enqueueInitializer})`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
}

test('slow cloud request deduplicates the same snapshot and keeps subsequent local play pending', async () => {
    journal.writeLocalSave('u', state(3000), 5);
    let resolveRequest, calls = 0;
    const context = cloudContext({ saveGameToCloud: () => {
        calls++;
        return new Promise(resolve => { resolveRequest = resolve; });
    } });
    const save = enqueue(context);
    const first = save('u', state(3000));
    const second = save('u', state(3000));
    await new Promise(resolve => setImmediate(resolve));
    journal.writeLocalSave('u', state(4000), 5);
    context.gameStateRef.current = state(4000);
    resolveRequest({ revision: 6, gameState: state(3000) });
    await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(journal.readLocalSave('u').gameState.zenPoints, 4000);
    assert.equal(journal.readLocalSave('u').dirty, true);
    assert.equal(journal.readLocalSave('u').baseRevision, 6);
});

test('failed upload preserves confirmed payload and retry sends the latest local progress', async () => {
    const context = cloudContext({ saveGameToCloud: async () => { throw new Error('offline'); } });
    const save = enqueue(context);
    journal.writeLocalSave('u', state(3000), 5);
    await assert.rejects(save('u', state(3000)), /offline/);
    assert.equal(context.lastCloudSavePayloadRef.current, null);
    assert.equal(context.pendingCloudPayloadRef.current, null);
    journal.writeLocalSave('u', state(4000), 5);
    context.gameStateRef.current = state(4000);
    context.saveGameToCloud = async (uid, incoming, revision) => {
        assert.equal(incoming.zenPoints, 4000);
        assert.equal(revision, 5);
        return { revision: 6, gameState: incoming };
    };
    await save('u', state(4000));
    assert.equal(journal.readLocalSave('u').dirty, false);
});

test('local acknowledgement failure does not roll back a successful cloud revision', async () => {
    let localError = false;
    const context = cloudContext({
        saveGameToCloud: async (uid, incoming) => ({ revision: 6, gameState: incoming }),
        acknowledgeLocalSave: () => { throw new Error('quota'); },
        setLocalSaveIssue: value => localError = value,
    });
    await enqueue(context)('u', state(3000));
    assert.equal(context.cloudGameStateRevisionRef.current, 6);
    assert.equal(JSON.parse(context.lastCloudSavePayloadRef.current).zenPoints, 3000);
    assert.equal(localError, true);
});

test('late network completion after account change cannot update the new account', async () => {
    let resolveRequest;
    const context = cloudContext({ saveGameToCloud: () => new Promise(resolve => { resolveRequest = resolve; }) });
    const saving = enqueue(context)('u', state(3000));
    await new Promise(resolve => setImmediate(resolve));
    context.saveGenerationRef.current++;
    context.cloudGameStateRevisionRef.current = 20;
    resolveRequest({ revision: 6, gameState: state(3000) });
    await assert.rejects(saving, /session changed/);
    assert.equal(context.cloudGameStateRevisionRef.current, 20);
});
test('offline startup keeps gameplay blocked and preserves saved progress until retry succeeds', async () => {
    journal.writeLocalSave('u', state(5000), 5);
    let blocked = false, hydrated = false;
    const context = sessionContext({
        setIsAccountRestoring: value => blocked = value,
        handleLoadGame: () => hydrated = true,
        loadUserDataOnce: async () => { throw new Error('offline'); },
    });
    await restore(context);
    assert.equal(blocked, true); assert.equal(hydrated, false);
    assert.equal(journal.readLocalSave('u').gameState.zenPoints, 5000);
    context.loadUserDataOnce = async () => ({ gameData: state(), gameDataRevision: 5 });
    context.saveGameToCloud = async (uid, saved, revision) => { assert.equal(saved.zenPoints, 5000); assert.equal(revision, 5); return { revision: 6, gameState: saved }; };
    await restore(context);
    assert.equal(blocked, false); assert.equal(hydrated, true);
    assert.equal(journal.readLocalSave('u').baseRevision, 6);
});
test('first-save failure never creates a profile and can retry with the preserved local seed', async () => {
    let profiles = 0;
    const context = sessionContext({
        loadUserDataOnce: async () => null,
        ensureUserProfileNickname: async () => { profiles++; return 'user'; },
        saveGameToCloud: async () => { throw new Error('offline'); },
    });
    await restore(context);
    assert.equal(profiles, 0); assert.equal(journal.readLocalSave('u').dirty, true);
    context.saveGameToCloud = async (uid, saved) => ({ revision: 1, gameState: saved });
    await restore(context);
    assert.equal(profiles, 1); assert.equal(journal.readLocalSave('u').dirty, false);
});
test('restoring pending progress uses the server-confirmed achievement totals', async () => {
    journal.writeLocalSave('u', state(5000), 5);
    let displayed;
    const context = sessionContext({
        loadUserDataOnce: async () => ({ gameData: state(), gameDataRevision: 5 }),
        saveGameToCloud: async (uid, pending) => ({ revision: 6, gameState: { ...pending, honorPoints: 9, achievementPoints: 700 } }),
        handleLoadGame: restored => displayed = restored,
    });
    await restore(context);
    assert.equal(displayed.zenPoints, 5000);
    assert.equal(displayed.honorPoints, 9);
    assert.equal(displayed.achievementPoints, 700);
});
test('a server-confirmed profile-only account retries initialization; a damaged existing account cannot', async () => {
    let writes = 0;
    const context = sessionContext({
        loadUserDataOnce: async () => ({ gameData: null, gameDataRevision: 0, canInitializeGameState: true }),
        saveGameToCloud: async (uid, saved) => { writes++; return { revision: 1, gameState: saved }; },
    });
    await restore(context); assert.equal(writes, 1);
    context.loadUserDataOnce = async () => ({ gameData: null, gameDataRevision: 4, canInitializeGameState: false });
    await restore(context); assert.equal(writes, 1);
});

test('startup applies a newer cloud revision without uploading the stale device save', async () => {
    journal.writeLocalSave('u', state(5000), 5);
    let displayed, writes = 0, blocked = true;
    const context = sessionContext({
        loadUserDataOnce: async () => ({ gameData: state(3000), gameDataRevision: 6 }),
        saveGameToCloud: async () => { writes++; throw new Error('unexpected upload'); },
        handleLoadGame: restored => displayed = restored,
        setIsAccountRestoring: value => blocked = value,
    });
    await restore(context);
    assert.equal(displayed.zenPoints, 3000);
    assert.equal(writes, 0);
    assert.equal(blocked, false);
    assert.equal(journal.readLocalSave('u').dirty, false);
    assert.equal(JSON.parse(localStorage.getItem(`${getScopedSaveGameKey('u')}_recovery`)).gameState.zenPoints, 5000);
});

test('startup applies the cloud save when the device record has no trusted revision', async () => {
    localStorage.setItem(getScopedSaveGameKey('u'), JSON.stringify(state(7000)));
    let displayed;
    await restore(sessionContext({
        loadUserDataOnce: async () => ({ gameData: state(3000), gameDataRevision: 6 }),
        handleLoadGame: restored => displayed = restored,
    }));
    assert.equal(displayed.zenPoints, 3000);
    assert.equal(journal.readLocalSave('u').baseRevision, 6);
});

test('device storage failure does not block restoring the cloud save', async () => {
    journal.writeLocalSave('u', state(5000), 5);
    localStorage.setItem = () => { throw new Error('quota'); };
    let displayed, blocked = true, localError = false;
    await restore(sessionContext({
        loadUserDataOnce: async () => ({ gameData: state(3000), gameDataRevision: 6 }),
        handleLoadGame: restored => displayed = restored,
        setIsAccountRestoring: value => blocked = value,
        setLocalSaveIssue: value => localError = value,
    }));
    assert.equal(displayed.zenPoints, 3000);
    assert.equal(blocked, false);
    assert.equal(localError, true);
});

test('upload revision conflict pauses stale writes and automatically reloads the account', async () => {
    let retries = 0, restoring = false;
    const context = cloudContext({
        localHydratedScopeRef: { current: 'u' },
        setRestoreAttempt: update => retries = update(retries),
        setIsAccountRestoring: value => restoring = value,
    });
    context.saveGameToCloud = async () => { throw new context.GameStateRevisionConflictError(); };
    await assert.rejects(enqueue(context)('u', state(5000)));
    assert.equal(context.cloudSaveBlockedRef.current, true);
    assert.equal(context.localHydratedScopeRef.current, null);
    assert.equal(restoring, true);
    assert.equal(retries, 1);
});

test('a remote write during startup upload automatically retries and then restores the cloud', async () => {
    journal.writeLocalSave('u', state(5000), 5);
    let retries = 0, displayed;
    const context = sessionContext({
        loadUserDataOnce: async () => ({ gameData: state(3000), gameDataRevision: 5 }),
        setRestoreAttempt: update => retries = update(retries),
        handleLoadGame: restored => displayed = restored,
    });
    context.saveGameToCloud = async () => { throw new context.GameStateRevisionConflictError(); };
    await restore(context);
    assert.equal(retries, 1);
    assert.equal(displayed, undefined);
    context.loadUserDataOnce = async () => ({ gameData: state(4000), gameDataRevision: 6 });
    await restore(context);
    assert.equal(displayed.zenPoints, 4000);
});

test('live cloud updates replace pending device progress even if device storage fails', () => {
    for (const failStorage of [false, true]) {
        let displayed;
        const context = cloudContext({
            lastCloudSavePayloadRef: { current: JSON.stringify(state()) },
            gameStateRef: { current: state(5000) },
            serverMutationInProgressRef: { current: false },
            persistLocalGameState: saved => {
                if (failStorage) throw new Error('quota');
                journal.writeLocalSave('u', saved, 5);
            },
            handleLoadGame: restored => displayed = restored,
        });
        const update = vm.runInNewContext(ts.transpileModule(`(${cloudUpdateInitializer})`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText, context);
        update(state(3000), 6);
        assert.equal(displayed.zenPoints, 3000);
        assert.equal(context.cloudGameStateRevisionRef.current, 6);
    }
});

// ── 무료 연못 수: 신규 유저 1개, 기존 유저 2개 ───────────────────────────────
// state()는 freePondCount가 없는 예전(1.0.8 이하) 저장본을 정규화한 것이라 무료 연못 2개입니다.
const {
    pondAllowanceError, allowedRegularPondCount, maxPondCountFor, normalizeEntitlements, MAX_PAID_POND_SLOTS, ABSOLUTE_MAX_POND_COUNT,
    FREE_POND_POLICY_START, FREE_POND_POLICY_START_MS, NEW_FREE_POND_COUNT, LEGACY_FREE_POND_COUNT,
    freePondCountForAccount, needsAccountCreatedAt, keepFreePondCount, savedFreePondCount,
} = require('../functions/src/saveValidation.ts');
const {
    createEmptyPond, withPaidPonds, hasMissingPaidPonds, nextPondDisplayNumber, pondsForNewGame, withDefaultPonds, DEFAULT_POND_COUNT,
} = require('../utils/savedGameState.ts');

const BEFORE_CUTOFF = FREE_POND_POLICY_START_MS - 1;
const AFTER_CUTOFF = FREE_POND_POLICY_START_MS + 60_000;
/** 연못 id 목록으로 저장본을 만듭니다. freePondCount를 주면 새 형식, 주지 않으면 구버전 앱(1.0.8 이하) 형식입니다. */
const withPondIds = (ids, freePondCount) => {
    const { freePondCount: _legacyMark, ...base } = state();
    const ponds = {};
    for (const id of ids) ponds[id] = { ...base.ponds['pond-1'], id, name: id, kois: [] };
    return freePondCount === undefined ? { ...base, ponds } : { ...base, ponds, freePondCount };
};
const legacySave = ids => withPondIds(ids);
const newSave = (ids, freePondCount = 1) => withPondIds(ids, freePondCount);

test('the new-user cutoff is 2026-11-04 00:00 KST and only accounts created after it get one free pond', () => {
    assert.equal(FREE_POND_POLICY_START, '2026-11-04T00:00:00+09:00');
    assert.equal(FREE_POND_POLICY_START_MS, Date.parse('2026-11-03T15:00:00Z'));
    assert.equal(NEW_FREE_POND_COUNT, 1);
    assert.equal(LEGACY_FREE_POND_COUNT, 2);
    assert.equal(freePondCountForAccount(BEFORE_CUTOFF), 2);
    assert.equal(freePondCountForAccount(FREE_POND_POLICY_START_MS), 1);
    assert.equal(freePondCountForAccount(AFTER_CUTOFF), 1);
    // 가입 시각을 읽지 못하면 저장을 막지 않도록 기존 계정처럼 봅니다.
    assert.equal(freePondCountForAccount(null), 2);
    assert.equal(freePondCountForAccount(undefined), 2);
    assert.equal(freePondCountForAccount(Number.NaN), 2);
    // 앱(App.tsx)은 같은 Firebase Auth 가입 시각을 ms로 읽습니다.
    assert.equal(accountCreatedAtOf({ rawUser: { metadata: { creationTime: 'Tue, 03 Nov 2026 14:59:59 GMT' } } }), FREE_POND_POLICY_START_MS - 1000);
    assert.equal(accountCreatedAtOf({ rawUser: null }), null);
    assert.equal(accountCreatedAtOf(null), null);
});

test('a new game starts with one free pond; saves from before the update keep two', () => {
    const { createInitialPonds } = require('../hooks/useKoiPond.ts');
    assert.equal(DEFAULT_POND_COUNT, 1);
    const fresh = createInitialPonds();
    assert.deepEqual(Object.keys(fresh), ['pond-1']);
    assert.ok(fresh['pond-1'].kois.length > 0, 'the starter koi live in pond 1');
    assert.match(readSource('App.tsx'), sourcePattern('freePondCount: DEFAULT_POND_COUNT, ponds: createInitialPonds(),'));
    // 예전 저장본(freePondCount 없음)은 기존 유저: 연못이 1개뿐이면 1.0.7~1.0.8처럼 빈 연못 2를 채웁니다.
    const legacy = normalizeSavedGameState(legacySave(['pond-1']));
    assert.equal(legacy.freePondCount, 2);
    assert.deepEqual(Object.keys(legacy.ponds), ['pond-1', 'pond-2']);
    assert.deepEqual(legacy.ponds['pond-2'], { id: 'pond-2', name: '연못 2', kois: [], decorations: [], theme: '기본 (맑은 물)', waterQuality: 100 });
    // 새 버전에서 시작한 게임(무료 1개)은 연못 2를 받지 않습니다.
    const fresh1 = normalizeSavedGameState(newSave(['pond-1'], 1));
    assert.equal(fresh1.freePondCount, 1);
    assert.deepEqual(Object.keys(fresh1.ponds), ['pond-1']);
    assert.deepEqual(normalizeSavedGameState(fresh1), fresh1);
    // 무료 2개로 적힌 새 형식 저장본은 연못 2를 채웁니다.
    assert.deepEqual(Object.keys(normalizeSavedGameState(newSave(['pond-1'], 2)).ponds), ['pond-1', 'pond-2']);
    // 무료 연못 수는 1 또는 2만 받습니다.
    for (const bad of [0, 3, '2', null, 1.5]) {
        assert.equal(isValidGameStateCore({ ...newSave(['pond-1']), freePondCount: bad }), false, String(bad));
        assert.equal(normalizeSavedGameState({ ...newSave(['pond-1']), freePondCount: bad }), null, String(bad));
    }
});

test('guests follow the same rule: an older guest save has two free ponds, a new guest game one', () => {
    journal.writeLocalSave(null, legacySave(['pond-1']), null);
    const older = journal.readLocalSave(null).gameState;
    assert.equal(older.freePondCount, 2);
    assert.deepEqual(Object.keys(older.ponds), ['pond-1', 'pond-2']);
    journal.writeLocalSave(null, newSave(['pond-1'], 1), null);
    const newer = journal.readLocalSave(null).gameState;
    assert.equal(newer.freePondCount, 1);
    assert.deepEqual(Object.keys(newer.ponds), ['pond-1']);
});

test('a pond 2 already saved is never removed or hidden', () => {
    const pond2 = { id: 'pond-2', name: '연못 2', kois: [], decorations: [], theme: '기본 (맑은 물)', waterQuality: 100 };
    // 무료 1개인 게임에 연못 2가 저장되어 있어도(예: 구버전 앱이 채운 뒤 새 버전으로 옮김) 그대로 둡니다.
    const kept = normalizeSavedGameState({ ...newSave(['pond-1'], 1), activePondId: 'pond-2', ponds: { ...newSave(['pond-1']).ponds, 'pond-2': pond2 } });
    assert.deepEqual(Object.keys(kept.ponds), ['pond-1', 'pond-2']);
    assert.equal(kept.activePondId, 'pond-2');
    const threePonds = normalizeSavedGameState({ ...kept, ponds: { ...kept.ponds, 'pond-3': { ...pond2, id: 'pond-3', name: '연못 3' } } });
    assert.deepEqual(Object.keys(threePonds.ponds), ['pond-1', 'pond-2', 'pond-3']);
    // 화면 상태(useKoiPond)도 저장된 연못을 그대로 씁니다.
    assert.match(readSource('hooks/useKoiPond.ts'), sourcePattern('withDefaultPonds(initialState?.ponds ?? createInitialPonds())'));
    // 일반 연못이 하나도 없는 저장본만 연못 1을 받고, 있던 연못은 지우지 않습니다.
    assert.deepEqual(Object.keys(withDefaultPonds({ 'pond-2': pond2 })), ['pond-2']);
    const paidOnly = { 'pond-paid-1': { ...pond2, id: 'pond-paid-1' } };
    assert.deepEqual(Object.keys(withDefaultPonds(paidOnly)).sort(), ['pond-1', 'pond-paid-1']);
});

test('the free pond count travels with every save the app writes', () => {
    // App.tsx에서 저장본을 만드는 모든 객체(koiNameCounter가 있는 객체)에 freePondCount가 함께 있습니다.
    const literals = [];
    const visit = node => {
        if (ts.isObjectLiteralExpression(node)) {
            const names = node.properties.map(property => property.name?.getText(app) ?? (ts.isShorthandPropertyAssignment(property) ? property.name.getText(app) : ''));
            if (names.includes('koiNameCounter')) literals.push(names);
        }
        ts.forEachChild(node, visit);
    };
    visit(app);
    assert.ok(literals.length >= 3, `found ${literals.length} save objects`);
    for (const names of literals) assert.ok(names.includes('freePondCount'), names.join(', '));
    // 불러오기는 그 값을 화면 상태에 넣고, 새 게임은 지금 값을 그대로 둡니다.
    assert.match(readSource('App.tsx'), sourcePattern('setFreePondCount(mergedState.freePondCount ?? LEGACY_FREE_POND_COUNT);'));
});

test('backup codes keep the free pond count; older codes without it count as an existing user', async () => {
    const { compressGameStateAsync, decompressGameStateAsync } = require('../utils/serializer.ts');
    const fresh = normalizeSavedGameState(newSave(['pond-1'], 1));
    const restored = normalizeSavedGameState(await decompressGameStateAsync(await compressGameStateAsync(fresh)));
    assert.equal(restored.freePondCount, 1);
    assert.deepEqual(Object.keys(restored.ponds), ['pond-1']);
    const { freePondCount: _mark, ...withoutMark } = fresh;
    const older = normalizeSavedGameState(await decompressGameStateAsync(await compressGameStateAsync(withoutMark)));
    assert.equal(older.freePondCount, 2);
    assert.deepEqual(Object.keys(older.ponds), ['pond-1', 'pond-2']);
});

test('saves may hold up to four regular ponds; a fifth is rejected', () => {
    assert.equal(isValidGameStateCore(legacySave(['pond-1', 'pond-2', 'pond-3', 'pond-4'])), true);
    assert.equal(isValidGameStateCore(legacySave(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-5'])), false);
    assert.equal(normalizeSavedGameState(legacySave(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-5'])), null);
});

test('paid ponds live beside the four regular ponds and cannot exceed the slot catalog', () => {
    const full = legacySave(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-paid-1', 'pond-paid-2', 'pond-paid-3', 'pond-paid-4']);
    assert.equal(Object.keys(full.ponds).length, ABSOLUTE_MAX_POND_COUNT);
    assert.equal(isValidGameStateCore(full), true);
    assert.equal(isValidGameStateCore(legacySave(['pond-1', 'pond-2', `pond-paid-${MAX_PAID_POND_SLOTS + 1}`])), false);
    // 유료 연못이 있어도 일반 연못 5개는 여전히 거절합니다.
    assert.equal(isValidGameStateCore(legacySave(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-5', 'pond-paid-1'])), false);
    assert.equal(isValidGameStateCore(legacySave(['pond-1', 'pond-paid-0'])), true, 'pond-paid-0 is just an unusual regular id');
});

// ── 서버(saveGameState) 연못 검사 ────────────────────────────────────────────
test('accounts that never saved in the new format accept old-app ponds, including ZP ponds, up to four', () => {
    // 저장본이 없는 계정(첫 저장), 구버전 앱만 쓴 계정: 가입 시각과 관계없이 일반 연못 4개까지 받습니다.
    for (const previous of [undefined, null, legacySave(['pond-1']), legacySave(['pond-1', 'pond-2'])]) {
        assert.equal(allowedRegularPondCount(previous, { accountCreatedAt: AFTER_CUTOFF }), 4);
        for (const ids of [['pond-1'], ['pond-1', 'pond-2'], ['pond-1', 'pond-2', 'pond-3'], ['pond-1', 'pond-2', 'pond-3', 'pond-4']]) {
            // 구버전 앱의 무료 연못 2와 20,000 ZP 확장권 연못(구버전 형식 저장)
            assert.equal(pondAllowanceError(legacySave(ids), undefined, previous, { accountCreatedAt: AFTER_CUTOFF }), null, ids.join());
            // 그 기기가 새 버전으로 업데이트한 뒤 처음 올리는 저장(새 형식)도 멈추지 않습니다.
            assert.equal(pondAllowanceError(newSave(ids, 2), undefined, previous, { accountCreatedAt: AFTER_CUTOFF }), null, ids.join());
            assert.equal(needsAccountCreatedAt(legacySave(ids), previous), false);
        }
    }
    // 게스트 시절 진행도를 계정의 첫 저장으로 옮기는 경우도 같습니다.
    assert.equal(pondAllowanceError(newSave(['pond-1', 'pond-2', 'pond-3', 'pond-4'], 2), undefined, undefined), null);
    // 유료 연못은 첫 저장에서도 혜택이 있어야 합니다.
    assert.notEqual(pondAllowanceError(newSave(['pond-1', 'pond-paid-1']), undefined, undefined), null);
});

test('once an account saved in the new format, regular ponds can only come from the free pond rule', () => {
    // 기존 유저(기준일 전 가입, 무료 2개): 구버전 앱으로 ZP 연못 3을 사도, 새 버전 저장으로도 늘릴 수 없습니다.
    const existing = newSave(['pond-1', 'pond-2'], 2);
    for (const incoming of [legacySave(['pond-1', 'pond-2', 'pond-3']), newSave(['pond-1', 'pond-2', 'pond-3'], 2)]) {
        assert.match(pondAllowanceError(incoming, { paidPondSlots: 4 }, existing, { accountCreatedAt: BEFORE_CUTOFF }), /일반 연못은 더 늘릴 수 없습니다/);
    }
    // 신규 유저(기준일 뒤 가입, 무료 1개): 구버전 앱이 채우는 연못 2도 받지 않습니다.
    const newcomer = newSave(['pond-1'], 1);
    assert.equal(needsAccountCreatedAt(legacySave(['pond-1', 'pond-2']), newcomer), true);
    assert.notEqual(pondAllowanceError(legacySave(['pond-1', 'pond-2']), undefined, newcomer, { accountCreatedAt: AFTER_CUTOFF }), null);
    assert.notEqual(pondAllowanceError(newSave(['pond-1', 'pond-2'], 2), undefined, newcomer, { accountCreatedAt: AFTER_CUTOFF }), null);
    // 기준일 전에 가입한 계정이면 무료 연못 2를 받습니다(가입 시각을 모를 때도 막지 않음).
    assert.equal(pondAllowanceError(newSave(['pond-1', 'pond-2'], 2), undefined, newcomer, { accountCreatedAt: BEFORE_CUTOFF }), null);
    assert.equal(pondAllowanceError(newSave(['pond-1', 'pond-2'], 2), undefined, newcomer, { accountCreatedAt: null }), null);
    // 가입 시각과 관계없이 결과가 같으면 Firebase Auth를 읽지 않습니다.
    assert.equal(needsAccountCreatedAt(newcomer, newcomer), false);
    assert.equal(needsAccountCreatedAt(newSave(['pond-1', 'pond-2', 'pond-3'], 2), existing), false);
    assert.equal(needsAccountCreatedAt(newSave(['pond-1', 'pond-paid-1']), newcomer), false);
    // 이미 저장된 연못은 언제나 유지합니다(구버전 형식으로 다시 저장해도).
    const stored = newSave(['pond-1', 'pond-2', 'pond-3', 'pond-4'], 1);
    assert.equal(pondAllowanceError(stored, undefined, stored, { accountCreatedAt: AFTER_CUTOFF }), null);
    assert.equal(pondAllowanceError(legacySave(['pond-1', 'pond-2', 'pond-3', 'pond-4']), undefined, stored, { accountCreatedAt: AFTER_CUTOFF }), null);
    // 연못 확장권 연못은 여전히 살 수 있습니다.
    assert.equal(pondAllowanceError(newSave(['pond-1', 'pond-paid-1']), { paidPondSlots: 1 }, newcomer, { accountCreatedAt: AFTER_CUTOFF }), null);
});

test('old-app saves cannot erase the new-format mark, so the block holds on the next save too', () => {
    const newcomer = newSave(['pond-1', 'pond-paid-1'], 1);
    // 구버전 앱의 저장(연못을 늘리지 않음)은 받되, 서버가 이전 무료 연못 수를 이어 붙입니다.
    const oldAppSave = legacySave(['pond-1', 'pond-paid-1']);
    assert.equal(pondAllowanceError(oldAppSave, { paidPondSlots: 1 }, newcomer, { accountCreatedAt: AFTER_CUTOFF }), null);
    const stored = keepFreePondCount(oldAppSave, newcomer);
    assert.equal(savedFreePondCount(stored), 1);
    assert.equal(savedFreePondCount(oldAppSave), null, 'the incoming object itself is not changed');
    // 그다음 구버전 앱이 일반 연못을 늘리려 해도 계속 막힙니다.
    assert.notEqual(pondAllowanceError(legacySave(['pond-1', 'pond-2', 'pond-paid-1']), { paidPondSlots: 1 }, stored, { accountCreatedAt: AFTER_CUTOFF }), null);
    // 새 버전이 그 저장본을 다시 불러와도 무료 1개 그대로라 연못 2를 채우지 않습니다.
    assert.deepEqual(Object.keys(normalizeSavedGameState(stored).ponds), ['pond-1', 'pond-paid-1']);
    // 새 형식 저장과, 표시가 없던 계정의 구버전 저장은 그대로 둡니다.
    const fresh = newSave(['pond-1'], 1);
    assert.equal(keepFreePondCount(fresh, newcomer), fresh);
    const old = legacySave(['pond-1', 'pond-2']);
    assert.equal(keepFreePondCount(old, legacySave(['pond-1', 'pond-2'])), old);
    assert.equal(keepFreePondCount(old, undefined), old);
});

test('saveGameState wires the account creation time and the mark into its pond check', () => {
    const server = readSource('functions/src/index.ts');
    assert.match(server, sourcePattern('const pondError = pondAllowanceError('));
    assert.match(server, sourcePattern('if (needsAccountCreatedAt(incomingGameState, currentGameState) && accountCreatedAt === undefined) { accountCreatedAt = await readAccountCreatedAt(uid); }'));
    assert.match(server, sourcePattern('{ accountCreatedAt },'));
    assert.match(server, sourcePattern('(await getAuth().getUser(uid)).metadata.creationTime'));
    assert.match(server, sourcePattern('const gameState = keepFreePondCount(gameStateWithRanking(incomingGameState, nextState), currentGameState);'));
    assert.doesNotMatch(server, /carriesGuestProgress/);
});

test('paid ponds are still allowed by entitlement', () => {
    const previous = newSave(['pond-1'], 1);
    const oneSlot = newSave(['pond-1', 'pond-paid-1']);
    const twoSlots = newSave(['pond-1', 'pond-paid-1', 'pond-paid-2']);

    assert.notEqual(pondAllowanceError(oneSlot, undefined, previous), null);
    assert.notEqual(pondAllowanceError(oneSlot, { paidPondSlots: 0, adFree: true }, previous), null);
    assert.equal(pondAllowanceError(oneSlot, { paidPondSlots: 1 }, previous), null);
    assert.notEqual(pondAllowanceError(twoSlots, { paidPondSlots: 1 }, previous), null);
    assert.equal(pondAllowanceError(twoSlots, { paidPondSlots: 2 }, previous), null);
    assert.equal(pondAllowanceError(newSave(['pond-1', 'pond-paid-1', 'pond-paid-2', 'pond-paid-3', 'pond-paid-4']), { paidPondSlots: 4 }, previous), null);
    // 연못 2를 가진 기존 계정도 같은 규칙입니다.
    const legacyTwo = legacySave(['pond-1', 'pond-2']);
    assert.equal(pondAllowanceError(newSave(['pond-1', 'pond-2', 'pond-paid-1'], 2), { paidPondSlots: 1 }, legacyTwo), null);
    assert.notEqual(pondAllowanceError(newSave(['pond-1', 'pond-2', 'pond-paid-1'], 2), undefined, legacyTwo), null);
    // 혜택이 줄어도 이미 서버에 있던 연못은 저장을 막지 않아 코이를 잃지 않습니다.
    assert.equal(pondAllowanceError(twoSlots, { paidPondSlots: 1 }, twoSlots), null);
    // 첫 저장(이전 저장본 없음)도 같은 규칙입니다.
    assert.notEqual(pondAllowanceError(oneSlot, undefined, undefined), null);
    assert.equal(pondAllowanceError(oneSlot, { paidPondSlots: 1 }, undefined), null);
});

test('entitlements are clamped and turn into the account pond limit', () => {
    assert.deepEqual(normalizeEntitlements(undefined), { paidPondSlots: 0, adFree: false });
    assert.deepEqual(normalizeEntitlements({ paidPondSlots: 2.7, adFree: true }), { paidPondSlots: 2, adFree: true });
    assert.deepEqual(normalizeEntitlements({ paidPondSlots: -3, adFree: 1 }), { paidPondSlots: 0, adFree: false });
    assert.equal(maxPondCountFor(undefined), 4);
    assert.equal(maxPondCountFor({ paidPondSlots: 3 }), 7);
    assert.equal(maxPondCountFor({ paidPondSlots: 99 }), 4 + MAX_PAID_POND_SLOTS);
});

// ── 로그인: 기준일 전에 가입한 계정은 무료 연못 2개 ─────────────────────────────
test('logging into an account created before the cutoff raises the free ponds to two', () => {
    const { withAccountFreePonds: raise } = require('../utils/savedGameState.ts');
    const newGuest = normalizeSavedGameState(newSave(['pond-1'], 1));
    const raised = raise(newGuest, BEFORE_CUTOFF);
    assert.equal(raised.freePondCount, 2);
    assert.deepEqual(Object.keys(raised.ponds), ['pond-1', 'pond-2']);
    // 서버도 같은 가입 시각으로 이 저장을 받습니다.
    assert.equal(pondAllowanceError(raised, undefined, newGuest, { accountCreatedAt: BEFORE_CUTOFF }), null);
    // 기준일 뒤 가입, 가입 시각 모름, 이미 2개인 저장본은 바꾸지 않고 같은 객체를 돌려줍니다(저장도 다시 하지 않음).
    assert.equal(raise(newGuest, AFTER_CUTOFF), newGuest);
    assert.equal(raise(newGuest, null), newGuest);
    const older = legacySave(['pond-1', 'pond-2']);
    assert.equal(raise(older, BEFORE_CUTOFF), older);
});

test('first login: a new guest game moves to an older account with two free ponds, to a new account with one', async () => {
    for (const [createdAt, expectedPonds] of [[BEFORE_CUTOFF, ['pond-1', 'pond-2']], [AFTER_CUTOFF, ['pond-1']]]) {
        resetStorage();
        journal.writeLocalSave(null, newSave(['pond-1'], 1), null);
        let firstSave;
        await restore(sessionContext({
            user: { uid: 'u', isAnonymous: false, rawUser: { metadata: { creationTime: new Date(createdAt).toUTCString() } } },
            loadGameState: () => journal.readLocalSave(null).gameState,
            loadUserDataOnce: async () => null,
            saveGameToCloud: async (uid, saved, revision, reason) => { firstSave = { saved, reason }; return { revision: 1, gameState: saved }; },
        }));
        assert.equal(firstSave.reason, 'new-account');
        assert.deepEqual(Object.keys(firstSave.saved.ponds), expectedPonds, new Date(createdAt).toISOString());
        assert.equal(firstSave.saved.freePondCount, expectedPonds.length);
    }
});

test('a device record the server refuses for ponds never blocks startup', async () => {
    // 새 버전으로 저장한 계정(무료 1개)을 다른 기기의 구버전 앱이 연 뒤 업데이트한 경우: 기기 기록에 연못 2가 있습니다.
    const cloud = newSave(['pond-1'], 1);
    journal.writeLocalSave('u', legacySave(['pond-1', 'pond-2']), 5);
    let displayed, uploads = 0, issue = null, notice = null, blocked = true;
    await restore(sessionContext({
        loadUserDataOnce: async () => ({ gameData: cloud, gameDataRevision: 5 }),
        saveGameToCloud: async () => { uploads++; throw new PondAllowanceRejectedError('일반 연못은 더 늘릴 수 없습니다.'); },
        handleLoadGame: restored => displayed = restored,
        setCloudSaveIssue: value => issue = value,
        setNotification: value => notice = value,
        setIsAccountRestoring: value => blocked = value,
    }));
    assert.equal(uploads, 1);
    assert.equal(issue, null);
    assert.equal(blocked, false);
    assert.deepEqual(Object.keys(displayed.ponds), ['pond-1']);
    assert.match(notice.message, /클라우드 저장본을 불러왔어요/);
    // 기기 기록은 복구용으로 남깁니다.
    assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(`${getScopedSaveGameKey('u')}_recovery`)).gameState.ponds), ['pond-1', 'pond-2']);
    // 다른 오류는 그대로 알려 다시 시도하게 합니다.
    journal.writeLocalSave('u', legacySave(['pond-1', 'pond-2']), 5);
    await restore(sessionContext({
        loadUserDataOnce: async () => ({ gameData: cloud, gameDataRevision: 5 }),
        saveGameToCloud: async () => { throw new Error('offline'); },
        setCloudSaveIssue: value => issue = value,
    }));
    assert.match(issue, /저장 데이터를 확인하지 못했습니다/);
    // 저장 중 거절되면(드문 경우) 충돌처럼 계정을 다시 불러와 위 과정을 거칩니다.
    assert.match(readSource('App.tsx'), sourcePattern('if (error instanceof GameStateRevisionConflictError || error instanceof PondAllowanceRejectedError) {'));
});

// ── 유료 연못 이름과 새 게임 ───────────────────────────────────────────────
test('paid ponds continue the normal pond numbering and keep their koi', () => {
    const base = normalizeSavedGameState(newSave(['pond-1'], 1)).ponds;
    // 연못 1개로 시작한 신규 유저는 연못 확장권을 사면 "연못 2"부터 받습니다.
    const filled = withPaidPonds(base, 2);
    assert.deepEqual(Object.keys(filled), ['pond-1', 'pond-paid-1', 'pond-paid-2']);
    assert.equal(filled['pond-paid-1'].name, '연못 2');
    assert.equal(filled['pond-paid-2'].name, '연못 3');
    assert.equal(filled['pond-paid-1'].kois.length, 0);
    assert.equal(withPaidPonds(filled, 2), filled, 'nothing to add keeps the same object');
    assert.equal(hasMissingPaidPonds(filled, 2), false);
    assert.equal(hasMissingPaidPonds(filled, 3), true);
    // 이미 있는 유료 연못의 코이와 이름은 건드리지 않습니다.
    const withKoi = { ...filled, 'pond-paid-1': { ...filled['pond-paid-1'], name: '특별 연못 1', kois: [{ id: 'k' }] } };
    const more = withPaidPonds(withKoi, 3);
    assert.equal(more['pond-paid-1'].kois.length, 1);
    assert.equal(more['pond-paid-1'].name, '특별 연못 1');
    assert.equal(more['pond-paid-3'].name, '연못 4');
    // 기존 유저(무료 연못 2개)는 연못 3부터 이어집니다.
    const legacyTwo = state().ponds;
    assert.deepEqual(Object.keys(legacyTwo), ['pond-1', 'pond-2']);
    assert.equal(withPaidPonds(legacyTwo, 1)['pond-paid-1'].name, '연못 3');
    // 예전에 젠 포인트로 4개를 산 계정은 연못 5부터 이어집니다.
    const legacy = { ...legacyTwo, 'pond-3': createEmptyPond(3), 'pond-4': createEmptyPond(4) };
    assert.equal(nextPondDisplayNumber(legacy), 5);
    assert.equal(withPaidPonds(legacy, 1)['pond-paid-1'].name, '연못 5');
    // 이름 번호가 비어 있어도 겹치지 않게 가장 큰 번호 다음을 씁니다.
    assert.equal(nextPondDisplayNumber({ 'pond-1': createEmptyPond(1), 'pond-paid-1': { ...createEmptyPond(7), id: 'pond-paid-1' } }), 8);
    // 무료 1개인 게임은 유료 연못이 있어도 연못 2를 채우지 않습니다.
    const withPaid = { 'pond-1': base['pond-1'], 'pond-paid-1': filled['pond-paid-1'] };
    assert.equal(withDefaultPonds(withPaid, 1)['pond-2'], undefined);
    assert.deepEqual(Object.keys(withDefaultPonds(withPaid, 1)).sort(), ['pond-1', 'pond-paid-1']);
});

test('a new game keeps every pond the player owns, empty, and keeps the free pond count', () => {
    const owned = {
        ...state().ponds,
        'pond-1': { ...createEmptyPond(1), kois: [{ id: 'old' }], theme: '밤' },
        // 1.0.7~1.0.8에서 받은 연못 2
        'pond-2': { ...createEmptyPond(2), kois: [{ id: 'old-2' }] },
        'pond-3': { ...createEmptyPond(3), kois: [{ id: 'old-3' }] },
        'pond-4': createEmptyPond(4),
        'pond-paid-1': { ...createEmptyPond(5), id: 'pond-paid-1', kois: [{ id: 'old-paid' }] },
    };
    // 새 게임의 기본 연못은 연못 1 하나입니다.
    const fresh = { 'pond-1': { ...createEmptyPond(1), kois: [{ id: 'starter' }] } };
    const next = pondsForNewGame(owned, fresh);
    assert.deepEqual(Object.keys(next).sort(), ['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-paid-1']);
    assert.deepEqual(next['pond-1'].kois.map(koi => koi.id), ['starter']);
    assert.equal(next['pond-1'].theme, fresh['pond-1'].theme);
    assert.equal(next['pond-2'].kois.length, 0);
    assert.equal(next['pond-2'].name, '연못 2');
    assert.equal(next['pond-3'].kois.length, 0);
    assert.equal(next['pond-paid-1'].kois.length, 0);
    assert.equal(next['pond-paid-1'].name, '연못 5');
    assert.equal(next['pond-paid-1'].id, 'pond-paid-1');
    // 새 게임 저장본은 서버 연못 검사를 그대로 통과합니다(혜택이 없어도 이미 있던 연못).
    const before = { ...state(), ponds: owned };
    assert.equal(pondAllowanceError({ ...before, ponds: next }, undefined, before, { accountCreatedAt: AFTER_CUTOFF }), null);
    // 신규 유저(연못 1개)는 새 게임 뒤에도 1개, 기존 유저의 무료 연못 수는 새 게임에서도 그대로입니다.
    assert.deepEqual(Object.keys(pondsForNewGame(normalizeSavedGameState(newSave(['pond-1'], 1)).ponds, fresh)), ['pond-1']);
    // App의 새 게임 저장본은 지금 무료 연못 수를 그대로 씁니다(freePondCount 단축 속성).
    let newGameState;
    const findNewGame = node => {
        if (ts.isObjectLiteralExpression(node) && node.properties.some(property => property.name?.getText(app) === 'ponds'
            && /pondsForNewGame\(/.test(property.getText(app)))) newGameState = node;
        ts.forEachChild(node, findNewGame);
    };
    findNewGame(app);
    assert.ok(newGameState, 'the new game state object');
    assert.ok(newGameState.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.getText(app) === 'freePondCount'));
});
