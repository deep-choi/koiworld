const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const transpile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const achievements = [
    { id: 'a', title: '첫 업적', tier: 'novice', reward: { achievementPoints: 100 } },
    { id: 'b', title: '두 번째 업적', tier: 'novice', reward: { achievementPoints: 200 } },
];

function callbackFromFile(file, name) {
    const source = ts.createSourceFile(file, fs.readFileSync(require.resolve(file), 'utf8'), 99, true, ts.ScriptKind.TSX);
    let callback;
    function walk(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
            callback = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0].getText(source) : node.initializer.getText(source);
        }
        ts.forEachChild(node, walk);
    }
    walk(source);
    return callback;
}
const handleClaimSource = callbackFromFile('../App.tsx', 'handleClaimReward');
const claimRewardSource = callbackFromFile('../hooks/useAchievements.ts', 'claimReward');
const runCallback = (source, context) => vm.runInNewContext(transpile(`(${source})`), context);

function accountContext(overrides = {}) {
    return {
        achievements, achievementsLoaded: true, unlockedIds: ['a', 'b'], claimedIds: [],
        user: { uid: 'u', isAnonymous: false }, isCloudSyncReady: true,
        isAccountRestoring: false, isDuplicateTabPaused: false,
        cloudHydratedUserIdRef: { current: 'u' }, cloudSaveBlockedRef: { current: false },
        serverMutationInProgressRef: { current: false }, saveGenerationRef: { current: 1 },
        achievementClaimQueueRef: { current: Promise.resolve() }, pendingAchievementClaimsRef: { current: 0 },
        flushCurrentGameStateRef: { current: async () => {} }, claimReward: async () => {},
        setNotification: () => {}, audioManager: { playSFX: () => {} },
        console: { error: () => {} }, ...overrides,
    };
}

// 기존 React 외에 테스트 패키지를 추가하지 않고 실제 모달의 JSX와 이벤트를 실행합니다.
function modalHarness(props) {
    const slots = [];
    let cursor = 0;
    const react = {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        useState: initial => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef: initial => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = { current: initial };
            return slots[index];
        },
    };
    const exports = {};
    vm.runInNewContext(transpile(fs.readFileSync(require.resolve('../components/AchievementModal.tsx'), 'utf8')), {
        exports,
        require: name => name === 'react' ? { ...react, default: react } : { X: 'icon', Check: 'icon', Lock: 'icon', Star: 'icon' },
    });
    let currentProps = { isOpen: true, onClose: () => {}, achievements, unlockedIds: ['a', 'b'], claimedIds: [], totalPoints: 500, ...props };
    const render = updates => {
        currentProps = { ...currentProps, ...updates };
        cursor = 0;
        return exports.AchievementModal(currentProps);
    };
    return { render };
}
function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...tree.children.flatMap(nodes)];
}
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === label);
const points = tree => nodes(tree).find(node => node.type === 'span' && node.children.join('')?.endsWith(' Pts')).children.join('');

test('claim completes visually and reports the reward before delayed saving or server confirmation', async () => {
    const saving = deferred(), confirming = deferred();
    let calls = 0, notification;
    const context = accountContext({
        flushCurrentGameStateRef: { current: () => saving.promise },
        claimReward: () => { calls++; return confirming.promise; },
        setNotification: value => notification = value,
    });
    const modal = modalHarness({ onClaim: runCallback(handleClaimSource, context) });
    button(modal.render(), '첫 업적 보상 받기').props.onClick();
    const immediate = modal.render();
    assert.equal(button(immediate, '첫 업적 보상 획득 완료').props.disabled, true);
    assert.equal(points(immediate), '600 Pts');
    assert.equal(notification.type, 'success');
    assert.equal(calls, 0);
    await tick();
    saving.resolve();
    await tick();
    assert.equal(calls, 1);
    assert.equal(points(modal.render()), '600 Pts');
    confirming.resolve();
    await tick();
    const confirmed = modal.render({ claimedIds: ['a'], totalPoints: 600 });
    assert.equal(points(confirmed), '600 Pts');
    assert.ok(button(confirmed, '첫 업적 보상 획득 완료'));
});

test('a failed claim removes only its temporary completion and points and allows retry', async () => {
    const confirming = deferred();
    let notification;
    const context = accountContext({ claimReward: () => confirming.promise, setNotification: value => notification = value });
    const modal = modalHarness({ claimedIds: ['b'], onClaim: runCallback(handleClaimSource, context) });
    button(modal.render(), '첫 업적 보상 받기').props.onClick();
    assert.equal(points(modal.render()), '600 Pts');
    await tick();
    confirming.reject(new Error('offline'));
    await tick();
    const reverted = modal.render();
    assert.equal(points(reverted), '500 Pts');
    assert.ok(button(reverted, '첫 업적 보상 받기'));
    assert.ok(button(reverted, '두 번째 업적 보상 획득 완료'));
    assert.equal(notification.type, 'error');
    assert.equal(context.serverMutationInProgressRef.current, false);
});

test('rapid double taps request and count the same reward only once', async () => {
    const confirming = deferred();
    let calls = 0;
    const modal = modalHarness({ onClaim: () => { calls++; return confirming.promise; } });
    const claim = button(modal.render(), '첫 업적 보상 받기');
    claim.props.onClick(); claim.props.onClick();
    assert.equal(calls, 1);
    assert.equal(points(modal.render()), '600 Pts');
    confirming.resolve();
    await tick();
});

test('different rewards display immediately while their server writes remain serialized', async () => {
    const first = deferred(), second = deferred();
    const calls = [];
    const context = accountContext({ claimReward: id => { calls.push(id); return id === 'a' ? first.promise : second.promise; } });
    const modal = modalHarness({ onClaim: runCallback(handleClaimSource, context) });
    const initial = modal.render();
    button(initial, '첫 업적 보상 받기').props.onClick();
    button(initial, '두 번째 업적 보상 받기').props.onClick();
    assert.equal(points(modal.render()), '800 Pts');
    await tick();
    assert.deepEqual(calls, ['a']);
    first.resolve();
    await tick();
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(context.serverMutationInProgressRef.current, true);
    assert.equal(points(modal.render({ claimedIds: ['a'], totalPoints: 600 })), '800 Pts');
    second.resolve();
    await tick();
    assert.equal(context.serverMutationInProgressRef.current, false);
    assert.equal(points(modal.render({ claimedIds: ['a', 'b'], totalPoints: 800 })), '800 Pts');
});

function rewardContext(overrides = {}) {
    return {
        isLoaded: true, userId: 'u', scope: 'u', currentScopeRef: { current: 'u' },
        stateRef: { current: { unlockedIds: ['a'], claimedIds: [], totalPoints: 500 } },
        ACHIEVEMENTS: achievements, uniqueIds: ids => [...new Set(ids)],
        setState: () => {}, persistLocalState: () => {}, ...overrides,
    };
}
test('late confirmation preserves new unlocks discovered during the request', async () => {
    const confirming = deferred();
    const context = rewardContext({ claimAchievementOnServer: () => confirming.promise });
    const reward = runCallback(claimRewardSource, context)('a');
    context.stateRef.current.unlockedIds.push('b');
    confirming.resolve({ unlockedIds: ['a'], claimedIds: ['a'], achievementPoints: 600, achievementReward: 100 });
    await reward;
    assert.deepEqual(Array.from(context.stateRef.current.unlockedIds), ['a', 'b']);
    assert.equal(context.stateRef.current.totalPoints, 600);
});

test('an old account response cannot change achievements after the account switches', async () => {
    const confirming = deferred();
    let writes = 0;
    const context = rewardContext({ claimAchievementOnServer: () => confirming.promise, persistLocalState: () => writes++ });
    const reward = runCallback(claimRewardSource, context)('a');
    context.currentScopeRef.current = 'other';
    const otherState = { unlockedIds: [], claimedIds: [], totalPoints: 0 };
    context.stateRef.current = otherState;
    confirming.resolve({ unlockedIds: ['a'], claimedIds: ['a'], achievementPoints: 600, achievementReward: 100 });
    assert.equal(await reward, null);
    assert.equal(context.stateRef.current, otherState);
    assert.equal(writes, 0);
});
