const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const { breedKoi, getMotoguroColor, hasMotoguroGene } = require('../utils/genetics.ts');
const { buildKoiRenderStyle } = require('../utils/koiColors.ts');
const { isValidGameStateCore } = require('../functions/src/saveValidation.ts');
const { compressGameStateAsync, decompressGameStateAsync } = require('../utils/serializer.ts');

const spot = (color, size = 40) => ({ x: 50, y: 50, size, color, shape: 'circle' });
const genetics = (motoguroGenes, spots = []) => ({
    baseColorGenes: ['크림', '크림'], spots, lightness: 50, saturation: 50,
    ...(motoguroGenes === undefined ? {} : { motoguroGenes }),
});
const koi = g => ({
    id: 'k1', name: '코이', description: '', genetics: g, position: { x: 50, y: 50 }, velocity: { vx: 0, vy: 0 },
    age: 0, growthStage: 'adult', timesFed: 0, foodTargetId: null, feedCooldownUntil: null, stamina: 100,
});
const withRandom = (value, run) => {
    const original = Math.random;
    Math.random = () => value;
    try { return run(); } finally { Math.random = original; }
};

test('motoguro takes the most common spot colour, ties going to the larger spots', () => {
    assert.equal(getMotoguroColor(genetics(1, [spot('빨강'), spot('검정'), spot('빨강')])), '빨강');
    assert.equal(getMotoguroColor(genetics(2, [spot('빨강', 30), spot('노랑', 70)])), '노랑');
});

test('motoguro stays hidden without spots or without the allele', () => {
    assert.equal(getMotoguroColor(genetics(2, [])), null);
    assert.equal(getMotoguroColor(genetics(undefined, [spot('빨강')])), null);
    assert.equal(hasMotoguroGene(genetics(1, [])), true);
    assert.equal(buildKoiRenderStyle(koi(genetics(1, []))).colors.motoguro, undefined);
});

test('expressed motoguro colours the fin roots with the spot hue', () => {
    const { colors } = buildKoiRenderStyle(koi(genetics(1, [spot('검정'), spot('빨강'), spot('빨강')])));
    assert.ok(colors.motoguro);
    // Red spots (#E4472F) have hue 8; the fade ends fully transparent.
    assert.match(colors.motoguro.root, /^hsla\(8, /);
    assert.match(colors.motoguro.edge, /, 0\)$/);
});

test('breeding passes the dominant allele and can mutate it in', () => {
    // Two homozygous parents always pass it on.
    const fromCarriers = withRandom(0.5, () => breedKoi(genetics(2), genetics(2))).genetics;
    assert.equal(fromCarriers.motoguroGenes, 2);
    // Plain parents give plain offspring unless the mutation roll hits.
    const plain = withRandom(0.5, () => breedKoi(genetics(undefined), genetics(0))).genetics;
    assert.equal(plain.motoguroGenes, undefined);
    const mutated = withRandom(0.001, () => breedKoi(genetics(undefined), genetics(undefined))).genetics;
    assert.equal(mutated.motoguroGenes, 1);
});

test('saves accept 0-2 motoguro copies and reject anything else', () => {
    const state = motoguroGenes => ({
        ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(genetics(motoguroGenes, [spot('빨강')]))], decorations: [], waterQuality: 100 } },
        activePondId: 'pond-1', zenPoints: 0, foodCount: 0, koiNameCounter: 1,
    });
    for (const value of [undefined, 0, 1, 2]) assert.equal(isValidGameStateCore(state(value)), true, String(value));
    for (const value of [3, -1, 1.5, '1']) assert.equal(isValidGameStateCore(state(value)), false, String(value));
});

test('backup codes keep motoguro and still read codes made before it existed', async () => {
    const state = g => ({
        ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(g)], decorations: [], waterQuality: 100, theme: '기본 (맑은 물)' } },
        activePondId: 'pond-1', zenPoints: 10, foodCount: 2, cornCount: 0, koiNameCounter: 1,
    });
    const restored = await decompressGameStateAsync(await compressGameStateAsync(state(genetics(2, [spot('빨강')]))));
    assert.equal(restored.ponds['pond-1'].kois[0].genetics.motoguroGenes, 2);
    const plain = await decompressGameStateAsync(await compressGameStateAsync(state(genetics(undefined, [spot('빨강')]))));
    assert.equal(plain.ponds['pond-1'].kois[0].genetics.motoguroGenes, undefined);
});
