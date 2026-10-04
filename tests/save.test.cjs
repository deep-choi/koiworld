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
const journal = require('../services/saveJournal.ts');
const { SavePolicy, progressKey } = require('../services/savePolicy.ts');
const { getScopedSaveGameKey } = require('../services/localSave.ts');
const { normalizeSavedGameState } = require('../utils/savedGameState.ts');
const { isValidGameStateCore } = require('../functions/src/saveValidation.ts');
const state = (points = 2000) => normalizeSavedGameState({
    ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [], decorations: [], waterQuality: 100, theme: '기본 (맑은 물)' } },
    activePondId: 'pond-1', zenPoints: points, foodCount: 20, koiNameCounter: 3,
});
test.beforeEach(() => {
    const items = new Map();
    global.localStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
});

test('reopening restores unsent local progress from the same cloud revision', () => {
    journal.acceptCloudSave('u', state(), 5);
    journal.writeLocalSave('u', state(5000), 5);
    const pending = journal.readLocalSave('u');
    assert.equal(journal.chooseSaveSource(pending, state(), 5), 'local');
    assert.equal(pending.gameState.zenPoints, 5000);
});
test('a newer remote save requires an explicit choice and retains the local original', () => {
    journal.writeLocalSave('u', state(5000), 5);
    assert.equal(journal.chooseSaveSource(journal.readLocalSave('u'), state(3000), 6), 'choose');
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
test('legacy unversioned saves cannot silently replace or be replaced by a different cloud save', () => {
    localStorage.setItem(getScopedSaveGameKey('u'), JSON.stringify(state(7000)));
    assert.equal(journal.chooseSaveSource(journal.readLocalSave('u'), state(), 2), 'choose');
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
    assert.equal(journal.chooseSaveSource(restored, state(), 5), 'choose');
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
let initializer, enqueueInitializer;
function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'initSession') initializer = node.initializer.getText(app);
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'enqueueCloudSave') enqueueInitializer = node.initializer.arguments[0].getText(app);
    ts.forEachChild(node, walk);
}
walk(app);
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
        setIsAccountRestoring: () => {}, setSaveChoice: () => {}, setCloudSaveIssue: () => {},
        setIsCloudSyncReady: () => {}, suppressLocalGameSave: () => {}, resumeLocalGameSave: () => {},
        loadGameState: () => state(), createInitialGameState: () => state(), handleLoadGame: () => {},
        ensureUserProfileNickname: async () => 'user', startSession: async () => {},
        setUserNickname: () => {}, setUserPhotoURL: () => {}, setNotification: () => {},
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
