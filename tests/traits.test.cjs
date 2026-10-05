const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const { breedKoi, getKoiTraits } = require('../utils/genetics.ts');
const { buildKoiRenderStyle } = require('../utils/koiColors.ts');
const { isValidGameStateCore } = require('../functions/src/saveValidation.ts');
const { compressGameStateAsync, decompressGameStateAsync } = require('../utils/serializer.ts');

const spot = (color, size = 40) => ({ x: 30, y: 50, size, color, shape: 'circle' });
const genetics = (traits = {}, spots = []) => ({ baseColorGenes: ['크림', '크림'], spots, lightness: 50, saturation: 50, ...traits });
const koi = g => ({
    id: 'k1', name: '코이', description: '', genetics: g, position: { x: 50, y: 50 }, velocity: { vx: 0, vy: 0 },
    age: 0, growthStage: 'adult', timesFed: 0, foodTargetId: null, feedCooldownUntil: null, stamina: 100,
});
const withRandom = (value, run) => {
    const original = Math.random;
    Math.random = () => value;
    try { return run(); } finally { Math.random = original; }
};

test('koromo and tancho need both alleles and some spots, of any colour', () => {
    const yellow = [spot('노랑'), spot('노랑'), spot('검정')];
    assert.equal(getKoiTraits(genetics({ koromoGenes: 1 }, yellow)).koromo, false);
    assert.equal(getKoiTraits(genetics({ koromoGenes: 2 }, yellow)).koromo, true);
    assert.equal(getKoiTraits(genetics({ koromoGenes: 2 }, [])).koromo, false);
    assert.equal(getKoiTraits(genetics({ tanchoGenes: 1 }, yellow)).tancho, null);
    assert.equal(getKoiTraits(genetics({ tanchoGenes: 2 }, yellow)).tancho, '노랑');
    assert.equal(getKoiTraits(genetics({ tanchoGenes: 2 }, [])).tancho, null);
});

test('tancho leaves only one crown spot, in the most common spot colour', () => {
    const g = genetics({ tanchoGenes: 2 }, [spot('빨강'), spot('검정'), spot('빨강')]);
    const { spots } = buildKoiRenderStyle(koi(g));
    assert.equal(spots.length, 1);
    assert.deepEqual([spots[0].x, spots[0].y, spots[0].shape], [50, 5, 'circle']);
    assert.match(spots[0].color, /^hsl\(8, /);        // red
    assert.equal(g.spots.length, 3);                  // the spot genes are kept for breeding
});

test('koromo nets every pattern, lightening the net on dark spots', () => {
    const { spots } = buildKoiRenderStyle(koi(genetics({ koromoGenes: 2 }, [spot('노랑'), spot('검정')])));
    assert.ok(spots.every(s => s.koromo));
    const lightness = color => parseFloat(color.match(/,\s*([\d.]+)%,\s*[\d.]+\)$/)[1]);
    const spotLightness = color => parseFloat(color.match(/,\s*([\d.]+)%\)$/)[1]);
    assert.ok(lightness(spots[0].koromo) < spotLightness(spots[0].color));
    assert.ok(lightness(spots[1].koromo) > spotLightness(spots[1].color));
});

test('hirenaga lengthens fins by copies; ginrin shows from 10', () => {
    assert.equal(buildKoiRenderStyle(koi(genetics())).colors.finLength, undefined);
    assert.equal(buildKoiRenderStyle(koi(genetics({ hirenagaGenes: 1 }))).colors.finLength, 1.3);
    assert.equal(buildKoiRenderStyle(koi(genetics({ hirenagaGenes: 2 }))).colors.finLength, 1.6);
    assert.equal(buildKoiRenderStyle(koi(genetics({ ginrin: 9 }))).colors.ginrin, undefined);
    assert.equal(buildKoiRenderStyle(koi(genetics({ ginrin: 80 }))).colors.ginrin, 0.8);
});

test('breeding passes trait alleles, blends ginrin and stores only what is present', () => {
    const parent = genetics({ hirenagaGenes: 2, koromoGenes: 2, tanchoGenes: 2, ginrin: 60 });
    const child = withRandom(0.5, () => breedKoi(parent, genetics({ hirenagaGenes: 2, koromoGenes: 2, tanchoGenes: 2, ginrin: 20 }))).genetics;
    assert.deepEqual([child.hirenagaGenes, child.koromoGenes, child.tanchoGenes, child.ginrin], [2, 2, 2, 40]);
    const plain = withRandom(0.5, () => breedKoi(genetics(), genetics())).genetics;
    for (const key of ['motoguroGenes', 'hirenagaGenes', 'koromoGenes', 'tanchoGenes', 'doitsuGenes', 'ginrin']) assert.equal(key in plain, false, key);
    // A jump mutation can start ginrin in a line that has none.
    const jumped = withRandom(0.001, () => breedKoi(genetics(), genetics())).genetics;
    assert.ok(jumped.ginrin >= 25);
});

test('saves accept trait genes in range and reject anything else', () => {
    const state = traits => ({
        ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(genetics(traits, [spot('빨강')]))], decorations: [], waterQuality: 100 } },
        activePondId: 'pond-1', zenPoints: 0, foodCount: 0, koiNameCounter: 1,
    });
    assert.equal(isValidGameStateCore(state({ hirenagaGenes: 2, koromoGenes: 0, tanchoGenes: 1, ginrin: 100 })), true);
    for (const bad of [{ hirenagaGenes: 3 }, { doitsuGenes: 2.5 }, { koromoGenes: 1.5 }, { tanchoGenes: -1 }, { ginrin: 101 }, { ginrin: '50' }]) {
        assert.equal(isValidGameStateCore(state(bad)), false, JSON.stringify(bad));
    }
});

test('backup codes keep every trait gene', async () => {
    const traits = { motoguroGenes: 1, hirenagaGenes: 0, koromoGenes: 2, tanchoGenes: 0, ginrin: 45, doitsuGenes: 2 };
    const state = {
        ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(genetics(traits, [spot('빨강')]))], decorations: [], waterQuality: 100, theme: '기본 (맑은 물)' } },
        activePondId: 'pond-1', zenPoints: 10, foodCount: 2, cornCount: 0, koiNameCounter: 1,
    };
    const g = (await decompressGameStateAsync(await compressGameStateAsync(state))).ponds['pond-1'].kois[0].genetics;
    assert.deepEqual([g.motoguroGenes, g.hirenagaGenes, g.koromoGenes, g.tanchoGenes, g.ginrin, g.doitsuGenes], [1, undefined, 2, undefined, 45, 2]);
});

test('doitsu needs both alleles and shows with or without spots', () => {
    assert.equal(buildKoiRenderStyle(koi(genetics({ doitsuGenes: 1 }, [spot('빨강')]))).colors.doitsu, undefined);
    assert.equal(buildKoiRenderStyle(koi(genetics({ doitsuGenes: 2 }, [spot('빨강')]))).colors.doitsu, true);
    assert.equal(buildKoiRenderStyle(koi(genetics({ doitsuGenes: 2 }))).colors.doitsu, true);
});
