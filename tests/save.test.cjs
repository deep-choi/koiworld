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
let initializer, enqueueInitializer, cloudUpdateInitializer;
function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'initSession') initializer = node.initializer.getText(app);
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'enqueueCloudSave') enqueueInitializer = node.initializer.arguments[0].getText(app);
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'listenToGameData') cloudUpdateInitializer = node.arguments[1].getText(app);
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
        setIsAccountRestoring: () => {}, setRestoreAttempt: () => {}, setCloudSaveIssue: () => {},
        setIsCloudSyncReady: () => {}, suppressLocalGameSave: () => {}, resumeLocalGameSave: () => {},
        loadGameState: () => state(), createInitialGameState: () => state(), handleLoadGame: () => {},
        ensureUserProfileNickname: async () => 'user', startSession: async () => {},
        setUserNickname: () => {}, setUserPhotoURL: () => {}, setNotification: () => {},
        GameStateRevisionConflictError: class extends Error {},
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

test('saves with one pond get the second default pond; more ponds stay as they are', () => {
    const loaded = state();
    assert.deepEqual(Object.keys(loaded.ponds), ['pond-1', 'pond-2']);
    assert.deepEqual(loaded.ponds['pond-2'], { id: 'pond-2', name: '연못 2', kois: [], decorations: [], theme: '기본 (맑은 물)', waterQuality: 100 });
    assert.equal(loaded.activePondId, 'pond-1');
    const threePonds = normalizeSavedGameState({ ...loaded, ponds: { ...loaded.ponds, 'pond-3': { ...loaded.ponds['pond-2'], id: 'pond-3', name: '연못 3' } } });
    assert.deepEqual(Object.keys(threePonds.ponds), ['pond-1', 'pond-2', 'pond-3']);
    assert.deepEqual(normalizeSavedGameState(loaded).ponds, loaded.ponds);
});

test('saves may hold up to four ponds; a fifth is rejected', () => {
    const withPonds = count => {
        const base = state();
        const ponds = {};
        for (let n = 1; n <= count; n++) ponds[`pond-${n}`] = { ...base.ponds['pond-1'], id: `pond-${n}`, name: `연못 ${n}`, kois: [] };
        return { ...base, ponds };
    };
    assert.equal(isValidGameStateCore(withPonds(4)), true);
    assert.equal(isValidGameStateCore(withPonds(5)), false);
    assert.equal(normalizeSavedGameState(withPonds(5)), null);
});

// ── 연못 확장권(Google Play)과 예전 젠 포인트 연못: 계정 기준 연못 수 검사 ─────────
const {
    pondAllowanceError, allowedRegularPondCount, maxPondCountFor, normalizeEntitlements, MAX_PAID_POND_SLOTS, ABSOLUTE_MAX_POND_COUNT,
} = require('../functions/src/saveValidation.ts');
const {
    createEmptyPond, withPaidPonds, hasMissingPaidPonds, nextPondDisplayNumber, pondsForNewGame, withDefaultPonds,
} = require('../utils/savedGameState.ts');

const withPondIds = ids => {
    const base = state();
    const ponds = {};
    for (const id of ids) ponds[id] = { ...base.ponds['pond-1'], id, name: id, kois: [] };
    return { ...base, ponds };
};

test('paid ponds live beside the four regular ponds and cannot exceed the slot catalog', () => {
    const full = withPondIds(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-paid-1', 'pond-paid-2', 'pond-paid-3', 'pond-paid-4']);
    assert.equal(Object.keys(full.ponds).length, ABSOLUTE_MAX_POND_COUNT);
    assert.equal(isValidGameStateCore(full), true);
    assert.equal(isValidGameStateCore(withPondIds(['pond-1', 'pond-2', `pond-paid-${MAX_PAID_POND_SLOTS + 1}`])), false);
    // 유료 연못이 있어도 일반 연못 5개는 여전히 거절합니다.
    assert.equal(isValidGameStateCore(withPondIds(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-5', 'pond-paid-1'])), false);
    assert.equal(isValidGameStateCore(withPondIds(['pond-1', 'pond-paid-0'])), true, 'pond-paid-0 is just an unusual regular id');
});

test('legacy accounts keep all four regular ponds they bought with ZP', () => {
    const legacy = withPondIds(['pond-1', 'pond-2', 'pond-3', 'pond-4']);
    assert.equal(allowedRegularPondCount(legacy), 4);
    // 저장된 4개를 그대로 다시 저장하는 것은 계속 허용합니다(혜택이 없어도).
    assert.equal(pondAllowanceError(legacy, undefined, legacy), null);
    // 예전 연못과 함께 연못 확장권 연못도 추가할 수 있습니다.
    assert.equal(pondAllowanceError(withPondIds(['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-paid-1']), { paidPondSlots: 1 }, legacy), null);
    // 3개였던 계정은 3개까지만 받습니다.
    const three = withPondIds(['pond-1', 'pond-2', 'pond-3']);
    assert.equal(pondAllowanceError(three, undefined, three), null);
    assert.notEqual(pondAllowanceError(legacy, undefined, three), null);
});

test('a new regular pond-3 is rejected for an account that only had two ponds', () => {
    const previous = withPondIds(['pond-1', 'pond-2']);
    const withPond3 = withPondIds(['pond-1', 'pond-2', 'pond-3']);
    assert.match(pondAllowanceError(withPond3, undefined, previous), /일반 연못은 더 늘릴 수 없습니다/);
    // 연못 확장권을 사 둔 계정도 일반 연못으로는 늘릴 수 없습니다(유료 연못 id로만).
    assert.notEqual(pondAllowanceError(withPond3, { paidPondSlots: 4 }, previous), null);
    assert.notEqual(pondAllowanceError(withPondIds(['pond-1', 'pond-2', 'pond-3', 'pond-4']), { paidPondSlots: 4 }, previous), null);
    // 연못이 1개였던 예전 저장본은 기본 2번째 연못을 받습니다.
    assert.equal(pondAllowanceError(previous, undefined, withPondIds(['pond-1'])), null);
    // 새 계정(저장본 없음)은 무료 연못 2개로 시작합니다.
    assert.equal(allowedRegularPondCount(undefined), 2);
    assert.equal(pondAllowanceError(previous, undefined, undefined), null);
    assert.notEqual(pondAllowanceError(withPond3, undefined, undefined), null);
});

test('a brand-new account may carry ZP ponds a guest bought before, once', () => {
    const guestWithFour = withPondIds(['pond-1', 'pond-2', 'pond-3', 'pond-4']);
    assert.equal(pondAllowanceError(guestWithFour, undefined, undefined, { carriesGuestProgress: true }), null);
    // 이미 저장본이 있는 계정에는 적용되지 않습니다.
    assert.notEqual(pondAllowanceError(guestWithFour, undefined, withPondIds(['pond-1', 'pond-2']), { carriesGuestProgress: true }), null);
    // 유료 연못은 첫 저장에서도 혜택이 있어야 합니다.
    assert.notEqual(pondAllowanceError(withPondIds(['pond-1', 'pond-2', 'pond-paid-1']), undefined, undefined, { carriesGuestProgress: true }), null);
    // 서버는 새 계정의 첫 저장(new-account)일 때만 이 옵션을 켭니다.
    assert.match(fs.readFileSync(require.resolve('../functions/src/index.ts'), 'utf8'),
        /carriesGuestProgress: saveReason === 'new-account' && currentGameState == null && currentRevision === 0/);
});

test('paid ponds are still allowed by entitlement', () => {
    const previous = withPondIds(['pond-1', 'pond-2']);
    const oneSlot = withPondIds(['pond-1', 'pond-2', 'pond-paid-1']);
    const twoSlots = withPondIds(['pond-1', 'pond-2', 'pond-paid-1', 'pond-paid-2']);

    assert.notEqual(pondAllowanceError(oneSlot, undefined, previous), null);
    assert.notEqual(pondAllowanceError(oneSlot, { paidPondSlots: 0, adFree: true }, previous), null);
    assert.equal(pondAllowanceError(oneSlot, { paidPondSlots: 1 }, previous), null);
    assert.notEqual(pondAllowanceError(twoSlots, { paidPondSlots: 1 }, previous), null);
    assert.equal(pondAllowanceError(twoSlots, { paidPondSlots: 2 }, previous), null);
    assert.equal(pondAllowanceError(withPondIds(['pond-1', 'pond-2', 'pond-paid-1', 'pond-paid-2', 'pond-paid-3', 'pond-paid-4']), { paidPondSlots: 4 }, previous), null);
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

test('paid ponds continue the normal pond numbering and keep their koi', () => {
    const base = state().ponds;
    const filled = withPaidPonds(base, 2);
    assert.deepEqual(Object.keys(filled), ['pond-1', 'pond-2', 'pond-paid-1', 'pond-paid-2']);
    assert.equal(filled['pond-paid-1'].name, '연못 3');
    assert.equal(filled['pond-paid-2'].name, '연못 4');
    assert.equal(filled['pond-paid-1'].kois.length, 0);
    assert.equal(withPaidPonds(filled, 2), filled, 'nothing to add keeps the same object');
    assert.equal(hasMissingPaidPonds(filled, 2), false);
    assert.equal(hasMissingPaidPonds(filled, 3), true);
    // 이미 있는 유료 연못의 코이와 이름은 건드리지 않습니다.
    const withKoi = { ...filled, 'pond-paid-1': { ...filled['pond-paid-1'], name: '특별 연못 1', kois: [{ id: 'k' }] } };
    const more = withPaidPonds(withKoi, 3);
    assert.equal(more['pond-paid-1'].kois.length, 1);
    assert.equal(more['pond-paid-1'].name, '특별 연못 1');
    assert.equal(more['pond-paid-3'].name, '연못 5');
    // 예전에 젠 포인트로 4개를 산 계정은 연못 5부터 이어집니다.
    const legacy = { ...base, 'pond-3': createEmptyPond(3), 'pond-4': createEmptyPond(4) };
    assert.equal(nextPondDisplayNumber(legacy), 5);
    assert.equal(withPaidPonds(legacy, 1)['pond-paid-1'].name, '연못 5');
    // 이름 번호가 비어 있어도 겹치지 않게 가장 큰 번호 다음을 씁니다.
    assert.equal(nextPondDisplayNumber({ 'pond-1': createEmptyPond(1), 'pond-paid-1': { ...createEmptyPond(7), id: 'pond-paid-1' } }), 8);
    // 일반 연못이 1개뿐이면 유료 연못이 있어도 기본 연못 2를 채웁니다.
    assert.deepEqual(Object.keys(withDefaultPonds({ 'pond-1': base['pond-1'], 'pond-paid-1': filled['pond-paid-1'] })).sort(),
        ['pond-1', 'pond-2', 'pond-paid-1']);
});

test('a new game keeps every pond the player owns, empty', () => {
    const owned = {
        ...state().ponds,
        'pond-1': { ...createEmptyPond(1), kois: [{ id: 'old' }], theme: '밤' },
        'pond-3': { ...createEmptyPond(3), kois: [{ id: 'old-3' }] },
        'pond-4': createEmptyPond(4),
        'pond-paid-1': { ...createEmptyPond(5), id: 'pond-paid-1', kois: [{ id: 'old-paid' }] },
    };
    const fresh = { 'pond-1': { ...createEmptyPond(1), kois: [{ id: 'starter' }] }, 'pond-2': createEmptyPond(2) };
    const next = pondsForNewGame(owned, fresh);
    assert.deepEqual(Object.keys(next).sort(), ['pond-1', 'pond-2', 'pond-3', 'pond-4', 'pond-paid-1']);
    assert.deepEqual(next['pond-1'].kois.map(koi => koi.id), ['starter']);
    assert.equal(next['pond-1'].theme, fresh['pond-1'].theme);
    assert.equal(next['pond-3'].kois.length, 0);
    assert.equal(next['pond-paid-1'].kois.length, 0);
    assert.equal(next['pond-paid-1'].name, '연못 5');
    assert.equal(next['pond-paid-1'].id, 'pond-paid-1');
    // 새 게임 저장본은 서버 연못 검사를 그대로 통과합니다(혜택이 없어도 이미 있던 연못).
    assert.equal(pondAllowanceError({ ...state(), ponds: next }, undefined, { ...state(), ponds: owned }), null);
});

