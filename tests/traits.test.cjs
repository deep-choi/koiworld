const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const { breedKoi, getKoiTraits, getGenotypeLabels, getTraitCopies, migrateLegacyGinrin, getKoiBreedName, getKoiDisplayName } = require('../utils/genetics.ts');
const { normalizeSavedGameState } = require('../utils/savedGameState.ts');
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

test('hirenaga and ginrin show more with each copy', () => {
    assert.equal(buildKoiRenderStyle(koi(genetics())).colors.finLength, undefined);
    assert.equal(buildKoiRenderStyle(koi(genetics({ hirenagaGenes: 1 }))).colors.finLength, 1.3);
    assert.equal(buildKoiRenderStyle(koi(genetics({ hirenagaGenes: 2 }))).colors.finLength, 1.6);
    assert.equal(buildKoiRenderStyle(koi(genetics())).colors.ginrin, undefined);
    assert.equal(buildKoiRenderStyle(koi(genetics({ ginrinGenes: 1 }))).colors.ginrin, 0.5);
    assert.equal(buildKoiRenderStyle(koi(genetics({ ginrinGenes: 2 }))).colors.ginrin, 1);
});

test('breeding passes trait alleles and stores only what is present', () => {
    const parent = genetics({ hirenagaGenes: 2, koromoGenes: 2, tanchoGenes: 2, ginrinGenes: 2 });
    // Random 0.5: a two-copy parent always passes the allele, a one-copy parent does not.
    const child = withRandom(0.5, () => breedKoi(parent, genetics({ hirenagaGenes: 2, koromoGenes: 2, tanchoGenes: 2, ginrinGenes: 1 }))).genetics;
    assert.deepEqual([child.hirenagaGenes, child.koromoGenes, child.tanchoGenes, child.ginrinGenes], [2, 2, 2, 1]);
    const plain = withRandom(0.5, () => breedKoi(genetics(), genetics())).genetics;
    for (const key of ['motoguroGenes', 'hirenagaGenes', 'ginrinGenes', 'koromoGenes', 'tanchoGenes', 'doitsuGenes', 'ginrin']) assert.equal(key in plain, false, key);
    // A breeding mutation can start ginrin in a line that has none; the old blended value is never stored.
    const mutated = withRandom(0.001, () => breedKoi(genetics(), genetics())).genetics;
    assert.equal(mutated.ginrinGenes, 1);
    assert.equal('ginrin' in mutated, false);
});

test('1.0.6 ginrin values become copies: 1-49 one, 50-100 two', () => {
    const copies = value => migrateLegacyGinrin(genetics({ ginrin: value }));
    assert.deepEqual(copies(0), genetics());
    assert.equal(copies(1).ginrinGenes, 1);
    assert.equal(copies(49).ginrinGenes, 1);
    assert.equal(copies(50).ginrinGenes, 2);
    assert.equal(copies(100).ginrinGenes, 2);
    assert.equal('ginrin' in copies(100), false);
    // Not yet migrated koi read the same.
    assert.equal(getTraitCopies(genetics({ ginrin: 30 }), 'ginrinGenes'), 1);
    assert.equal(getKoiTraits(genetics({ ginrin: 80 })).ginrin, 2);
    // Loading a save migrates every koi.
    const state = {
        ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(genetics({ ginrin: 60 }))], decorations: [], waterQuality: 100 } },
        activePondId: 'pond-1', zenPoints: 0, foodCount: 0, koiNameCounter: 1,
    };
    const loaded = normalizeSavedGameState(state).ponds['pond-1'].kois[0].genetics;
    assert.equal(loaded.ginrinGenes, 2);
    assert.equal('ginrin' in loaded, false);
});

test('saves accept trait genes in range and reject anything else', () => {
    const state = traits => ({
        ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(genetics(traits, [spot('빨강')]))], decorations: [], waterQuality: 100 } },
        activePondId: 'pond-1', zenPoints: 0, foodCount: 0, koiNameCounter: 1,
    });
    assert.equal(isValidGameStateCore(state({ hirenagaGenes: 2, koromoGenes: 0, tanchoGenes: 1, ginrinGenes: 2 })), true);
    // 1.0.6 saves with the blended ginrin value still load (and are migrated afterwards).
    assert.equal(isValidGameStateCore(state({ ginrin: 100 })), true);
    for (const bad of [{ hirenagaGenes: 3 }, { doitsuGenes: 2.5 }, { koromoGenes: 1.5 }, { tanchoGenes: -1 }, { ginrinGenes: 3 }, { ginrin: 101 }, { ginrin: '50' }]) {
        assert.equal(isValidGameStateCore(state(bad)), false, JSON.stringify(bad));
    }
});

test('backup codes keep every trait gene', async () => {
    const roundTrip = async traits => {
        const state = {
            ponds: { 'pond-1': { id: 'pond-1', name: '연못', kois: [koi(genetics(traits, [spot('빨강')]))], decorations: [], waterQuality: 100, theme: '기본 (맑은 물)' } },
            activePondId: 'pond-1', zenPoints: 10, foodCount: 2, cornCount: 0, koiNameCounter: 1,
        };
        return (await decompressGameStateAsync(await compressGameStateAsync(state))).ponds['pond-1'].kois[0].genetics;
    };
    const g = await roundTrip({ motoguroGenes: 1, hirenagaGenes: 0, koromoGenes: 2, tanchoGenes: 0, doitsuGenes: 2, ginrinGenes: 2 });
    assert.deepEqual([g.motoguroGenes, g.hirenagaGenes, g.koromoGenes, g.tanchoGenes, g.doitsuGenes, g.ginrinGenes], [1, undefined, 2, undefined, 2, 2]);
    // A 1.0.6 code with the blended ginrin value decodes into copies.
    const legacy = await roundTrip({ ginrin: 45 });
    assert.deepEqual([legacy.ginrinGenes, 'ginrin' in legacy], [1, false]);
});

test('doitsu needs both alleles and shows with or without spots', () => {
    assert.equal(buildKoiRenderStyle(koi(genetics({ doitsuGenes: 1 }, [spot('빨강')]))).colors.doitsu, undefined);
    assert.equal(buildKoiRenderStyle(koi(genetics({ doitsuGenes: 2 }, [spot('빨강')]))).colors.doitsu, true);
    assert.equal(buildKoiRenderStyle(koi(genetics({ doitsuGenes: 2 }))).colors.doitsu, true);
});

test('genotype labels list each trait allele after the base colour genes', () => {
    const labels = traits => getGenotypeLabels(genetics(traits)).join('/');
    assert.equal(labels({}), '순백/순백');
    assert.equal(getGenotypeLabels({ ...genetics(), baseColorGenes: ['빨강', '검정', '크림'] }).join('/'), '진홍/칠흑/순백');
    assert.equal(labels({ koromoGenes: 1 }), '순백/순백/고로모');
    assert.equal(labels({ koromoGenes: 2 }), '순백/순백/고로모/고로모');
    assert.equal(labels({ motoguroGenes: 1, tanchoGenes: 2 }), '순백/순백/모토구로/탄초/탄초');
    assert.equal(labels({ ginrinGenes: 1 }), '순백/순백/긴린');
    assert.equal(labels({ ginrinGenes: 2, koromoGenes: 1 }), '순백/순백/긴린/긴린/고로모');
    // 1.0.6 koi not yet migrated read the same.
    assert.equal(labels({ ginrin: 80 }), '순백/순백/긴린/긴린');
});

test('koi are named after the genes that show', () => {
    const red = [spot('빨강')];
    const name = (traits, spots = red, base) => getKoiBreedName({ ...genetics(traits, spots), ...(base && { baseColorGenes: base }) });
    assert.equal(name({}), '순백잉어');
    assert.equal(name({ ginrinGenes: 1 }), '은빛 순백잉어');
    assert.equal(name({ ginrinGenes: 2 }), '순백 긴린잉어');
    assert.equal(name({ hirenagaGenes: 1 }), '긴지느러미 순백잉어');
    assert.equal(name({ hirenagaGenes: 2 }), '순백 히레나가잉어');
    assert.equal(name({ motoguroGenes: 1 }), '순백 모토구로잉어');
    // Hidden traits stay out of the name: a recessive carrier, or motoguro without spots.
    assert.equal(name({ koromoGenes: 1 }), '순백잉어');
    assert.equal(name({ motoguroGenes: 1 }, []), '순백잉어');
    assert.equal(name({ koromoGenes: 2 }), '순백 고로모잉어');
    assert.equal(name({}, red, ['빨강', '빨강', '크림']), '진홍잉어');
    assert.deepEqual(['노랑', '주황', '검정'].map(c => name({}, red, [c, c])), ['황금잉어', '주황잉어', '칠흑잉어']);
    assert.equal(name({ ginrinGenes: 1, doitsuGenes: 2, koromoGenes: 2 }), '은빛 순백 도이츠 고로모잉어');
    // A name given by hand wins over the gene name.
    assert.equal(getKoiDisplayName(koi(genetics({ ginrinGenes: 2 }))), '순백 긴린잉어');
    assert.equal(getKoiDisplayName({ ...koi(genetics()), name: '두부' }), '두부');
});
