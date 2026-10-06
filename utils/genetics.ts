import { KoiGenetics, GeneType, Spot, Koi, GrowthStage, SpotShape, DominanceType, Allele, GeneAlleles, SpotPhenotypeGenes, SpotPhenotype } from '../types';

const ALL_SPOT_COLORS = [GeneType.RED, GeneType.ORANGE, GeneType.YELLOW, GeneType.WHITE, GeneType.BLACK];

const RECESSIVE_COLORS = [
    GeneType.ORANGE, GeneType.YELLOW, GeneType.BLACK, GeneType.RED
];

const SPECIAL_COLORS: GeneType[] = [
    // Disabled per request
];

export const GENE_COLOR_MAP: Record<GeneType, string> = {
    [GeneType.BLACK]: '#2B211F', // Warm brown-black
    [GeneType.RED]: '#E4472F', // Warm vermilion
    [GeneType.YELLOW]: '#F4CC3B', // Golden yellow
    [GeneType.WHITE]: '#FBFAF6', // Spot pattern color only
    [GeneType.ORANGE]: '#F08A2C',
    [GeneType.CREAM]: '#FEFDE7',
};

export const GENE_RARITY: Record<GeneType, number> = {
    [GeneType.BLACK]: 3, // Now a mutation (was 2)
    [GeneType.WHITE]: 3, // Spot pattern rarity only
    [GeneType.YELLOW]: 3,
    [GeneType.ORANGE]: 3,
    [GeneType.RED]: 3,
    [GeneType.CREAM]: 1, // Basic Type (Most Common, was 6)
};

const KOI_SELL_PRICE_MULTIPLIER = 2.0;

// Determines the expressed phenotype
const getRandomTraitWithRarity = <T extends string | number | symbol>(allTraits: T[], rarityMap: Record<T, number>): T => {
    // Filter out traits with rarity 0 (disabled)
    const validTraits = allTraits.filter(trait => rarityMap[trait] > 0);
    const weights = validTraits.map(trait => 1 / rarityMap[trait]);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    for (let i = 0; i < validTraits.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return validTraits[i];
        }
    }
    return validTraits[0];
};

const DOMINANCE_ORDER = [
    // Dark/Deep colors Dominant
    GeneType.BLACK,
    GeneType.RED,
    GeneType.ORANGE,

    // Medium/Metallic
    // All Recessive now

    // Light Recessive
    GeneType.YELLOW,
    GeneType.CREAM,
];

// Determines the expressed phenotype from an arbitrary number of genes
export const getPhenotype = (genes: GeneType[]): GeneType => {
    if (!genes || genes.length === 0) return GeneType.CREAM;

    // Filter out undefined/null
    // White is retained for spot patterns and legacy saves, but is no longer
    // a valid base-color phenotype. Old white base genes fall back to cream.
    const validGenes = genes.filter(g => g && g !== GeneType.WHITE);
    if (validGenes.length === 0) return GeneType.CREAM;

    // Strict Recessive Logic:
    // 1. A gene must be expressed at least TWICE to show up.
    // 2. If no gene appears >= 2 times, the fish is Cream.

    const geneCounts: Record<string, number> = {};
    validGenes.forEach(g => {
        geneCounts[g] = (geneCounts[g] || 0) + 1;
    });

    // Find all genes with count >= 2
    const expressedGenes: GeneType[] = [];
    for (const [gene, count] of Object.entries(geneCounts)) {
        if (count >= 2) {
            expressedGenes.push(gene as GeneType);
        }
    }

    if (expressedGenes.length === 0) {
        return GeneType.CREAM;
    }

    let bestGene = expressedGenes[0];
    let bestRank = 999;

    expressedGenes.forEach(gene => {
        const rank = DOMINANCE_ORDER.indexOf(gene);
        const effectiveRank = rank === -1 ? 999 : rank;

        if (effectiveRank < bestRank) {
            bestRank = effectiveRank;
            bestGene = gene;
        }
    });

    return bestGene;
}

export const calculateKoiValue = (koi: Koi): number => {
    let value = 0;
    const { genetics, growthStage } = koi;

    const phenotype = getPhenotype(genetics.baseColorGenes);

    // 1. Base value
    value += 200;

    // 2. Value from Phenotype Rarity
    value += (GENE_RARITY[phenotype] || 1) * 10;

    // 2.5 Bonus for Non-Cream Body Color (User Request)
    if (phenotype !== GeneType.CREAM) {
        value += 35;
    }

    // 3. Value from Hidden Genes (Carriers) (Reduced multiplier)
    genetics.baseColorGenes.forEach(gene => {
        if (gene !== GeneType.CREAM) {
            value += (GENE_RARITY[gene] || 1);
        }
    });

    // 4. Value from Lightness. Extremes remain valuable without dominating price.
    const lightnessDifference = Math.abs(genetics.lightness - 50);
    value += Math.pow(lightnessDifference, 1.5) * 0.8;

    // 5. Value from Body Saturation (Extremes are better)
    // abs(sat - 50) (Max at 50 diff is 50)
    const saturationDifference = Math.abs((genetics.saturation ?? 50) - 50);
    value += saturationDifference;

    // 6. Value from Spots
    // Tiered bonus based on count (Multiples of 4)
    const spotCount = genetics.spots.length;
    let spotTierBonus = 0;
    if (spotCount >= 12) spotTierBonus = 175;
    else if (spotCount >= 8) spotTierBonus = 75;
    else if (spotCount >= 4) spotTierBonus = 25;

    // Base spot value and color rarity
    const spotColorValue = genetics.spots.reduce((sum, spot) => sum + (GENE_RARITY[spot.color] || 1), 0);
    value += spotTierBonus + spotColorValue;

    // 7. 점 채도는 화면에 보여주지 않는 값이라 판매가에도 반영하지 않습니다. (라인브리딩 대상이 되지 않도록)

    // 7.5 Trait genes: traits that show are worth the most, hidden recessive carriers a little.
    const traits = getKoiTraits(genetics);
    if (traits.motoguro) value += 40;
    value += [0, 40, 100][traits.hirenaga];
    if (traits.koromo) value += 120;
    if (traits.doitsu) value += 120;
    if (traits.tancho) value += 250;
    value += [0, 40, 100][traits.ginrin];
    for (const trait of ['koromoGenes', 'tanchoGenes', 'doitsuGenes'] as const) {
        if (getTraitCopies(genetics, trait) === 1) value += 15;
    }

    // 8. Multiplier for growth stage
    if (growthStage === GrowthStage.ADULT) {
        value *= 1.0;
    } else if (growthStage === GrowthStage.JUVENILE) {
        value *= 0.6;
    } else {
        value *= 0.4;
    }

    // 9. Stamina/Health Penalties
    const stamina = koi.stamina ?? 0;
    if (stamina <= 10) {
        return 0;
    }
    else if (stamina <= 40) {
        value *= 0.25;
    }
    else if (stamina <= 60) {
        value *= 0.5;
    }

    return Math.floor(value * KOI_SELL_PRICE_MULTIPLIER);
};

const SPOT_COLOR_MUTATION_CHANCE = 0.04;
const SIZE_MUTATION_AMOUNT = 5; // Variation in spot size during breeding (Not related to koi size)
const LIGHTNESS_MUTATION_CHANCE = 0.2;
const LIGHTNESS_MUTATION_AMOUNT = 5;
const BASE_COLOR_MUTATION_CHANCE = 0.01;
const SPECIAL_MUTATION_CHANCE = 0;

const getSpotSizeRange = (shape: SpotShape): { min: number, max: number } => {
    if (shape === SpotShape.CIRCLE || shape === SpotShape.HEXAGON) {
        return { min: 30, max: 80 };
    }
    return { min: 30, max: 60 };
};

const createNewRandomSpot = (preferredColor?: GeneType): Spot => {
    const shapeValues = Object.values(SpotShape);
    const shape = shapeValues[Math.floor(Math.random() * shapeValues.length)] as SpotShape;

    let color = preferredColor;
    if (!color) {
        color = getRandomTraitWithRarity(ALL_SPOT_COLORS, GENE_RARITY);
    }

    const { min, max } = getSpotSizeRange(shape);

    return {
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * (max - min) + min,
        color: color,
        shape: shape,
    };
};

// Two-allele traits: each parent passes one of its two alleles, and a breeding mutation turns one
// plain allele into the trait allele.
export type AlleleTrait = 'motoguroGenes' | 'hirenagaGenes' | 'ginrinGenes' | 'koromoGenes' | 'tanchoGenes' | 'doitsuGenes';
export const ALLELE_TRAITS: AlleleTrait[] = ['motoguroGenes', 'hirenagaGenes', 'ginrinGenes', 'koromoGenes', 'tanchoGenes', 'doitsuGenes'];
const ALLELE_TRAIT_MUTATION_CHANCE: Record<AlleleTrait, number> = {
    motoguroGenes: 0.02,
    hirenagaGenes: 0.02,
    ginrinGenes: 0.02,
    koromoGenes: 0.015,
    tanchoGenes: 0.005,
    doitsuGenes: 0.015,
};

/**
 * 예전 긴린은 0~100 수치였습니다. 대립유전자로 바뀌면서 수치의 절반을 기준으로 개수로 옮깁니다.
 * 0 → 0개, 1~49 → 1개, 50~100 → 2개. (functions/src/progression.ts에도 같은 규칙이 있습니다.)
 */
export const legacyGinrinToCopies = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? (value >= 50 ? 2 : 1) : 0;

export const getTraitCopies = (genetics: KoiGenetics, trait: AlleleTrait): number => {
    // 아직 옮기지 않은 예전 저장본도 같은 개수로 읽히도록, ginrinGenes가 없으면 예전 수치에서 계산합니다.
    const raw = trait === 'ginrinGenes' && genetics.ginrinGenes === undefined
        ? legacyGinrinToCopies(genetics.ginrin)
        : genetics[trait] ?? 0;
    return Math.max(0, Math.min(2, Math.round(raw)));
};

/** 예전 긴린 수치(ginrin)를 유전자 개수(ginrinGenes)로 옮기고 예전 필드는 지웁니다. */
export const migrateLegacyGinrin = (genetics: KoiGenetics): KoiGenetics => {
    if (genetics.ginrin === undefined) return genetics;
    const { ginrin: _legacy, ...rest } = genetics;
    const copies = getTraitCopies(genetics, 'ginrinGenes');
    return copies > 0 ? { ...rest, ginrinGenes: copies } : rest;
};

const breedAlleleTrait = (genetics1: KoiGenetics, genetics2: KoiGenetics, trait: AlleleTrait): number => {
    const gamete = (genetics: KoiGenetics) => Math.random() < getTraitCopies(genetics, trait) / 2 ? 1 : 0;
    let copies = gamete(genetics1) + gamete(genetics2);
    if (Math.random() < ALLELE_TRAIT_MUTATION_CHANCE[trait]) copies = Math.min(2, copies + 1);
    return copies;
};

export const hasMotoguroGene = (genetics: KoiGenetics): boolean => getTraitCopies(genetics, 'motoguroGenes') > 0;

/** The spot colour that appears most often (ties go to the larger total spot size); null without spots. */
export const getDominantSpotColor = (genetics: KoiGenetics): GeneType | null => {
    const tally = new Map<GeneType, { count: number, size: number }>();
    for (const spot of genetics.spots) {
        const entry = tally.get(spot.color) ?? { count: 0, size: 0 };
        entry.count++;
        entry.size += spot.size;
        tally.set(spot.color, entry);
    }
    let best: GeneType | null = null;
    let bestEntry = { count: 0, size: 0 };
    for (const [color, entry] of tally) {
        if (entry.count > bestEntry.count || (entry.count === bestEntry.count && entry.size > bestEntry.size)) {
            best = color;
            bestEntry = entry;
        }
    }
    return best;
};

/** Colour of the motoguro fin roots; null when the koi has no motoguro allele or no spots. */
export const getMotoguroColor = (genetics: KoiGenetics): GeneType | null =>
    hasMotoguroGene(genetics) ? getDominantSpotColor(genetics) : null;

/** What the trait genes show on this koi (the genes themselves are in KoiGenetics). */
export interface KoiTraits {
    motoguro: GeneType | null;   // fin-root colour, null when not shown
    hirenaga: number;            // 0 normal, 1 long, 2 very long fins
    koromo: boolean;             // scale net over the patterns
    tancho: GeneType | null;     // colour of the single crown spot that replaces every pattern, null when not shown
    ginrin: number;              // 0 none, 1 some sparkling scales, 2 many (incomplete dominant)
    doitsu: boolean;             // hexagonal scale rows instead of small scales
}

export const getKoiTraits = (genetics: KoiGenetics): KoiTraits => {
    return {
        motoguro: getMotoguroColor(genetics),
        hirenaga: getTraitCopies(genetics, 'hirenagaGenes'),
        koromo: getTraitCopies(genetics, 'koromoGenes') === 2 && genetics.spots.length > 0,
        tancho: getTraitCopies(genetics, 'tanchoGenes') === 2 ? getDominantSpotColor(genetics) : null,
        ginrin: getTraitCopies(genetics, 'ginrinGenes'),
        doitsu: getTraitCopies(genetics, 'doitsuGenes') === 2,
    };
};

/**
 * 화면에 보여주는 몸 색 유전자 이름. 코이 이름(예: 진홍잉어)과 유전자형 표기(예: 진홍/진홍/긴린)에 씁니다.
 * 저장 데이터와 점 색은 원래 유전자 이름(빨강, 검정…)을 그대로 씁니다.
 * 하양은 몸 색으로 드러나지 않고 예전 저장본에만 남아 있어 '하양'으로 둡니다.
 */
const BODY_COLOR_NAMES: Record<GeneType, string> = {
    [GeneType.CREAM]: '순백',
    [GeneType.YELLOW]: '황금',
    [GeneType.ORANGE]: '주황',
    [GeneType.RED]: '진홍',
    [GeneType.BLACK]: '칠흑',
    [GeneType.WHITE]: '하양',
};
export const getBodyColorName = (gene: GeneType): string => BODY_COLOR_NAMES[gene] ?? gene;

// 목록에 쓰는 유전자형 표기 순서와 이름
const GENOTYPE_TRAIT_NAMES: [AlleleTrait, string][] = [
    ['motoguroGenes', '모토구로'],
    ['hirenagaGenes', '히레나가'],
    ['ginrinGenes', '긴린'],
    ['koromoGenes', '고로모'],
    ['tanchoGenes', '탄초'],
    ['doitsuGenes', '도이츠'],
];

/**
 * 유전자형을 기본 색 유전자처럼 나열합니다. 형질 유전자는 가진 개수만큼 이름을 붙입니다.
 * 예) 크림/크림 + 고로모 1개 → ['순백', '순백', '고로모'], 2개 → ['순백', '순백', '고로모', '고로모']
 */
export const getGenotypeLabels = (genetics: KoiGenetics): string[] => {
    const labels: string[] = genetics.baseColorGenes.map(getBodyColorName);
    for (const [trait, name] of GENOTYPE_TRAIT_NAMES) {
        for (let i = 0; i < getTraitCopies(genetics, trait); i++) labels.push(name);
    }
    return labels;
};

/**
 * 몸에 드러난 유전자로 짓는 코이 이름. `[1개짜리 수식어] [몸 색] [형질 이름]잉어` 순서로 붙여 씁니다.
 * 예) 크림/크림 → 순백잉어, 크림/크림/긴린 → 은빛 순백잉어, 크림/크림/긴린/긴린 → 순백 긴린잉어
 * - 불완전 우성(긴린·히레나가)은 1개면 앞에 수식어, 2개면 형질 이름이 붙습니다.
 * - 모토구로(우성)는 드러나면, 고로모·탄초·도이츠(열성)는 2개가 모여 드러날 때만 형질 이름이 붙습니다.
 * - 보인자이거나 무늬가 없어 숨은 형질은 이름에 넣지 않습니다. (유전자형 표기에는 그대로 보입니다.)
 */
export const getKoiBreedName = (genetics: KoiGenetics): string => {
    const traits = getKoiTraits(genetics);
    const modifiers: string[] = [];
    if (traits.ginrin === 1) modifiers.push('은빛');
    if (traits.hirenaga === 1) modifiers.push('긴지느러미');
    const traitNames: string[] = [];
    if (traits.doitsu) traitNames.push('도이츠');
    if (traits.ginrin === 2) traitNames.push('긴린');
    if (traits.hirenaga === 2) traitNames.push('히레나가');
    if (traits.motoguro) traitNames.push('모토구로');
    if (traits.koromo) traitNames.push('고로모');
    if (traits.tancho) traitNames.push('탄초');
    return [...modifiers, getBodyColorName(getPhenotype(genetics.baseColorGenes)), ...traitNames].join(' ') + '잉어';
};

/** 새로 태어나거나 산 코이에 저장되는 기본 이름. 이 이름이면 화면에는 유전자로 지은 이름을 보여줍니다. */
export const DEFAULT_KOI_NAME = '코이';

/** 화면에 보여줄 코이 이름: 따로 지어 준 이름이 있으면 그 이름, 없으면 유전자로 지은 이름. */
export const getKoiDisplayName = (koi: Koi): string =>
    koi.name && koi.name !== DEFAULT_KOI_NAME ? koi.name : getKoiBreedName(koi.genetics);

const GENE_EXPANSION_CHANCE = 0;
const GENE_DELETION_CHANCE = 0.02;

const getGamete = (genes: GeneType[]): GeneType[] => {
    const gameteSize = Math.max(1, Math.floor(genes.length / 2));
    const shuffled = [...genes].sort(() => 0.5 - Math.random());
    const gamete = shuffled.slice(0, gameteSize);

    if (Math.random() < GENE_EXPANSION_CHANCE) {
        gamete.push(genes[Math.floor(Math.random() * genes.length)]);
    }

    return gamete;
};

export const breedKoi = (genetics1: KoiGenetics, genetics2: KoiGenetics): { genetics: KoiGenetics, mutations: GeneType[] } => {
    const mutations: GeneType[] = [];

    // 0. Breed spot phenotype genes (10-gene system)
    let childSpotPhenotypeGenes: SpotPhenotypeGenes | undefined;
    if (genetics1.spotPhenotypeGenes && genetics2.spotPhenotypeGenes) {
        childSpotPhenotypeGenes = breedSpotPhenotypeGenes(genetics1.spotPhenotypeGenes, genetics2.spotPhenotypeGenes);
    } else if (genetics1.spotPhenotypeGenes) {
        childSpotPhenotypeGenes = genetics1.spotPhenotypeGenes;
    } else if (genetics2.spotPhenotypeGenes) {
        childSpotPhenotypeGenes = genetics2.spotPhenotypeGenes;
    } else {
        childSpotPhenotypeGenes = createRandomSpotPhenotypeGenes();
    }

    // 1. Breed base color genes
    let gamete1 = getGamete(genetics1.baseColorGenes);
    let gamete2 = getGamete(genetics2.baseColorGenes);

    // Default inheritance
    let childGenes = [...gamete1, ...gamete2].filter(g => g);

    // Mutation Logic: Force Expression
    // User Request: "Mutations should be visible immediately (e.g. Orange/Orange)"
    if (Math.random() < BASE_COLOR_MUTATION_CHANCE) {
        const mutationColor = getRandomTraitWithRarity(RECESSIVE_COLORS, GENE_RARITY);
        // Force Homozygous to ensure expression (overrides inheritance)
        childGenes = [mutationColor, mutationColor];
        mutations.push(mutationColor);
    }

    // Check Special Mutation (if enabled)
    if (Math.random() < SPECIAL_MUTATION_CHANCE) {
        // ... existing logic if kept, but generally overriding is better for mutations
        // For now, let's keep the base mutation as the primary "visible mutation" mechanism.
    }

    if (childGenes.length > 6 && Math.random() < GENE_DELETION_CHANCE) {
        childGenes.pop();
    }

    if (childGenes.length === 0) {
        childGenes.push(GeneType.CREAM);
    }

    // 2. Breed lightness
    const avgLightness = (genetics1.lightness + genetics2.lightness) / 2;
    let childLightness = avgLightness;
    if (Math.random() < LIGHTNESS_MUTATION_CHANCE) {
        const mutation = (Math.random() - 0.5) * 2 * LIGHTNESS_MUTATION_AMOUNT;
        childLightness += mutation;
    }
    childLightness = Math.max(0, Math.min(100, Math.round(childLightness)));

    // 2.5 Breed saturation (Similar to lightness)
    const avgSaturation = (genetics1.saturation + genetics2.saturation) / 2;
    let childSaturation = avgSaturation;
    if (Math.random() < LIGHTNESS_MUTATION_CHANCE) { // Use same chance for now
        const mutation = (Math.random() - 0.5) * 2 * LIGHTNESS_MUTATION_AMOUNT;
        childSaturation += mutation;
    }
    childSaturation = Math.max(0, Math.min(100, Math.round(childSaturation)));

    // 3. Breed spots
    const parent1Spots = genetics1.spots;
    const parent2Spots = genetics2.spots;
    const combinedSpots = [...parent1Spots, ...parent2Spots];

    const maxSpots = Math.max(parent1Spots.length, parent2Spots.length);
    const minSpots = Math.min(parent1Spots.length, parent2Spots.length);

    const blendedCount = Math.floor((maxSpots + minSpots) / 2);
    const baseCount = Math.random() < 0.5 ? maxSpots : blendedCount;

    const n = baseCount;

    // Keep early spot growth brisk, then taper without turning high-spot breeding into a wall.

    // Tier calculation: n / 4
    // 0-3 (T0) -> Base Chance
    // 4-7 (T1) -> 50% chance
    // 8-11 (T2) -> 25% chance
    const tier = Math.floor(n / 4);

    let targetSpotsCount = baseCount;
    if (tier < 1) {
        const roll = Math.random();
        if (roll < 0.35) {
            targetSpotsCount = baseCount + 1;
        } else if (roll < 0.475) {
            targetSpotsCount = Math.max(0, baseCount - 1);
        }
    } else {
        const addWeight = Math.max(0.05, 0.3 * Math.pow(0.5, tier));
        const deleteWeight = 0.4;
        const keepWeight = 1.0;
        const totalWeight = addWeight + deleteWeight + keepWeight;
        const roll = Math.random() * totalWeight;

        if (roll < addWeight) {
            targetSpotsCount = baseCount + 1;
        } else if (roll < addWeight + deleteWeight) {
            targetSpotsCount = Math.max(0, baseCount - 1);
        }
    }

    // Helper: Fisher-Yates Shuffle
    const shuffleArray = <T>(array: T[]): T[] => {
        const newArr = [...array];
        for (let i = newArr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
        }
        return newArr;
    };

    const childSpots: Spot[] = [];
    if (combinedSpots.length > 0) {
        // Use Fisher-Yates shuffle instead of sort for unbiased randomness
        const shuffled = shuffleArray(combinedSpots);
        const maxParentSpots = Math.max(parent1Spots.length, parent2Spots.length);
        const inheritanceCount = Math.min(targetSpotsCount, maxParentSpots);
        const inheritedSpots = shuffled.slice(0, inheritanceCount);

        for (const spot of inheritedSpots) {
            let newColor = spot.color;
            if (Math.random() < SPOT_COLOR_MUTATION_CHANCE) {
                newColor = getRandomTraitWithRarity(ALL_SPOT_COLORS, GENE_RARITY);
            }
            let shape = spot.shape || Object.values(SpotShape)[Math.floor(Math.random() * 3)];
            const { min, max } = getSpotSizeRange(shape);

            // 점 위치: 완전 무작위 배치 (부모 위치 무시)
            const childX = Math.random() * 100;
            const childY = Math.random() * 100;

            childSpots.push({
                x: childX,
                y: childY,
                size: Math.max(min, Math.min(max, spot.size + (Math.random() - 0.5) * SIZE_MUTATION_AMOUNT * 2)),
                color: newColor,
                shape: shape,
            });
        }
    }

    // When creating new extra spots, sample from the entire population of parent spots
    // to reflect the actual frequency of colors (Weighted inheritance)
    const parentSpotPopulation = combinedSpots.length > 0
        ? combinedSpots.map(s => s.color)
        : [];

    while (childSpots.length < targetSpotsCount) {
        let nextColor: GeneType | undefined = undefined;
        // Use population-based sampling instead of unique-color sampling
        if (parentSpotPopulation.length > 0 && Math.random() > SPOT_COLOR_MUTATION_CHANCE) {
            nextColor = parentSpotPopulation[Math.floor(Math.random() * parentSpotPopulation.length)];
        }
        childSpots.push(createNewRandomSpot(nextColor));
    }

    // 4. Breed the trait genes (only stored when present, to keep saves small)
    const traits: Partial<KoiGenetics> = {};
    for (const trait of ALLELE_TRAITS) {
        const copies = breedAlleleTrait(genetics1, genetics2, trait);
        if (copies > 0) traits[trait] = copies;
    }

    return {
        genetics: {
            baseColorGenes: childGenes,
            spots: childSpots,
            lightness: childLightness,
            saturation: childSaturation,
            spotPhenotypeGenes: childSpotPhenotypeGenes,
            ...traits,
        },
        mutations
    };
};

export const createRandomGenetics = (): KoiGenetics => {
    return {
        baseColorGenes: [GeneType.CREAM, GeneType.CREAM],
        spots: [],
        lightness: 50,
        saturation: 50,
        spotPhenotypeGenes: createRandomSpotPhenotypeGenes(),
    };
}



/**
 * spots 색상에 채도(colorSaturation)와 명도 변형을 반영하여 HSL 문자열로 반환
 * ctx.filter 없이 색상 자체에 채도 적용 (성능 최적화)
 * spotIndex를 사용하여 3가지 명도 타입 (밝은/보통/어두운) 중 하나를 랜덤 적용
 */
export const getSpotColorWithSaturation = (baseColor: string, colorSaturation: number, spotIndex: number = 0): string => {
    // #RRGGBB 형식인 경우 HSL로 변환
    if (baseColor.startsWith('#')) {
        const hsl = hexToHSL(baseColor);
        // colorSaturation: 0-1 범위, 0.2 + colorSaturation * 1.8 = 0.2 ~ 2.0 범위
        const saturationMultiplier = 0.2 + colorSaturation * 1.8;
        const adjustedS = Math.max(0, Math.min(100, hsl.s * saturationMultiplier));

        // 명도 변형: 3가지 타입 (밝은/보통/어두운)
        // spotIndex를 사용하여 일관된 랜덤 값 생성 (같은 spot은 항상 같은 명도)
        const lightnessVariation = spotIndex % 3; // 0, 1, 2
        let adjustedL = hsl.l;
        if (lightnessVariation === 0) {
            adjustedL = Math.min(95, hsl.l + 4); // 밝은 버전
        } else if (lightnessVariation === 2) {
            adjustedL = Math.max(15, hsl.l - 4); // 어두운 버전
        }
        // lightnessVariation === 1: 보통 버전 (원래 명도)

        return `hsl(${hsl.h}, ${adjustedS}%, ${adjustedL}%)`;
    }
    // 이미 hsl/hsla 형식이면 그대로 반환
    return baseColor;
};

export const calculateRarityScore = (koi: Koi): number => {
    let score = 0;
    koi.genetics.baseColorGenes.forEach(g => {
        score += (GENE_RARITY[g] || 1);
    });
    score += koi.genetics.spots.reduce((sum, spot) => sum + (GENE_RARITY[spot.color] || 1), 0);

    return score;
};

export const hexToHSL = (hex: string): { h: number, s: number, l: number } => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt("0x" + hex[1] + hex[1]);
        g = parseInt("0x" + hex[2] + hex[2]);
        b = parseInt("0x" + hex[3] + hex[3]);
    } else if (hex.length === 7) {
        r = parseInt("0x" + hex[1] + hex[2]);
        g = parseInt("0x" + hex[3] + hex[4]);
        b = parseInt("0x" + hex[5] + hex[6]);
    }
    r /= 255; g /= 255; b /= 255;
    const cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin;
    let h = 0, s = 0, l = (cmax + cmin) / 2;
    if (delta !== 0) {
        if (cmax === r) h = ((g - b) / delta) % 6;
        else if (cmax === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
        s = delta / (1 - Math.abs(2 * l - 1));
    }
    return { h, s: +(s * 100).toFixed(1), l: +(l * 100).toFixed(1) };
}

const getCreamDisplayHsl = (
    lightness: number,
    saturation: number
): { h: number, s: number, l: number } => {
    // Near-white cream has misleadingly high HSL saturation. Lowering its
    // lightness with the generic formula reveals a vivid yellow, so cream uses
    // a neutral warm palette and a narrower, beige-safe variation range.
    const saturationMultiplier = 0.5 + (saturation / 100);
    const finalS = Math.max(8, Math.min(28, 18 * saturationMultiplier));
    const finalL = Math.max(77, Math.min(96, 92 + (lightness - 50) * (lightness < 50 ? 0.3 : 0.4)));

    return { h: 48, s: finalS, l: finalL };
};

const getSafeDisplayLightness = (baseLightness: number, lightness: number): number => {
    const clampedLightness = Math.max(0, Math.min(100, lightness));
    const distanceFromCenter = clampedLightness - 50;

    // Preserve each gene's base color at the extremes. Dark values have less
    // influence than bright values so lightness 0 no longer turns every koi black.
    const shiftMultiplier = distanceFromCenter < 0 ? 0.35 : 0.5;
    const shiftedLightness = baseLightness + (distanceFromCenter * shiftMultiplier);

    return Math.max(12, Math.min(90, shiftedLightness));
};

export const getDisplayColor = (phenotype: GeneType, lightness: number, saturation: number = 50): string => {
    if (phenotype === GeneType.CREAM) {
        const cream = getCreamDisplayHsl(lightness, saturation);
        return `hsla(${cream.h}, ${cream.s}%, ${cream.l}%, 1)`;
    }

    const hex = GENE_COLOR_MAP[phenotype] || '#000000';
    const hsl = hexToHSL(hex);

    let finalL = getSafeDisplayLightness(hsl.l, lightness);

    // Apply safe Saturation
    const saturationMultiplier = 0.5 + (saturation / 100);
    const finalS = Math.max(10, Math.min(95, hsl.s * saturationMultiplier));

    return `hsla(${hsl.h}, ${finalS}%, ${finalL}%, 1)`;
};

// ============================================
// SPOT PHENOTYPE GENETICS SYSTEM (4-Gene)
// ============================================

const GENE_DOMINANCE_CONFIG: Record<keyof SpotPhenotypeGenes, DominanceType> = {
    CS: DominanceType.INCOMPLETE,
};

const IMPRINTING_CONFIG: Record<keyof SpotPhenotypeGenes, { maternalBias: number; paternalBias: number }> = {
    CS: { maternalBias: 1.0, paternalBias: 1.0 },
};

interface ThresholdTrait {
    id: string;
    name: string;
    requirements: Partial<Record<keyof SpotPhenotypeGenes, number>>;
    description: string;
}

const THRESHOLD_TRAITS: ThresholdTrait[] = [
    { id: 'golden_sheen', name: '황금빛 채도', requirements: { CS: 80 }, description: '황금빛으로 빛나는 강렬한 채도' },
];

const GENE_INTERACTIONS: Record<keyof SpotPhenotypeGenes, { partner: keyof SpotPhenotypeGenes, type: 'synergy' | 'antagonism' | 'neutral', strength: number }[]> = {
    CS: [],
};

const HIDDEN_ACTIVATION_THRESHOLD = 3;

const applyImprinting = (allele: Allele, geneId: keyof SpotPhenotypeGenes): number => {
    const config = IMPRINTING_CONFIG[geneId];

    if (!config) return allele.value; // Safety fallback

    const bias = allele.origin === 'maternal' ? config.maternalBias : config.paternalBias;
    return allele.value * bias;
};

const applyGeneInteractions = (expressed: Record<keyof SpotPhenotypeGenes, number>): Record<keyof SpotPhenotypeGenes, number> => {
    const result = { ...expressed };
    for (const [geneId, interactions] of Object.entries(GENE_INTERACTIONS)) {
        const key = geneId as keyof SpotPhenotypeGenes;
        for (const interaction of interactions) {
            const partnerValue = expressed[interaction.partner];
            const ownValue = expressed[key];
            if (interaction.type === 'synergy' && partnerValue > 60 && ownValue > 60) {
                result[key] = Math.min(100, result[key] * (1 + interaction.strength));
            } else if (interaction.type === 'antagonism' && partnerValue > 70) {
                result[key] = Math.max(0, result[key] * (1 - interaction.strength));
            }
        }
    }
    return result;
};

const checkThresholdTraits = (expressed: Record<keyof SpotPhenotypeGenes, number>): string[] => {
    const activeTraits: string[] = [];
    for (const trait of THRESHOLD_TRAITS) {
        let allMet = true;
        for (const [geneId, threshold] of Object.entries(trait.requirements)) {
            if (geneId === 'invertES') continue;
            const currentVal = expressed[geneId as keyof SpotPhenotypeGenes];
            if ((trait.requirements as any).invertES && geneId === 'ES') {
                if (currentVal > (threshold as number)) { allMet = false; break; }
            } else {
                if (currentVal < (threshold as number)) { allMet = false; break; }
            }
        }
        if (allMet) activeTraits.push(trait.id);
    }
    return activeTraits;
};

const applyThresholdEffects = (phenotype: SpotPhenotype, activeTraits: string[]): SpotPhenotype => {
    const result = { ...phenotype };
    for (const traitId of activeTraits) {
        switch (traitId) {
            case 'golden_sheen': result.colorSaturation = Math.min(1, result.colorSaturation * 1.3); break;
        }
    }
    return result;
};

const checkHiddenRecessiveActivation = (genes: SpotPhenotypeGenes): boolean => {
    let recessiveCount = 0;
    for (const geneId of Object.keys(genes) as (keyof SpotPhenotypeGenes)[]) {
        // Lower values are generally more recessive/harder to maintain in this system
        if (genes[geneId].allele1.value < 35 && genes[geneId].allele2.value < 35) recessiveCount++;
    }
    return recessiveCount >= HIDDEN_ACTIVATION_THRESHOLD;
};

export const expressGene = (geneAlleles: GeneAlleles, geneId?: keyof SpotPhenotypeGenes): number => {
    const { allele1, allele2, dominanceType } = geneAlleles;
    let val1 = geneId ? applyImprinting(allele1, geneId) : allele1.value;
    let val2 = geneId ? applyImprinting(allele2, geneId) : allele2.value;

    let expressed = 0.5;
    switch (dominanceType) {
        case DominanceType.COMPLETE:
            expressed = val1; // Assume allele1 is dominant if complete
            break;
        case DominanceType.INCOMPLETE:
            expressed = (val1 + val2) / 2;
            break;
        case DominanceType.RECESSIVE:
            expressed = Math.min(val1, val2);
            break;
        case DominanceType.CODOMINANCE:
            expressed = (val1 + val2) / 2;
            break;
    }
    return Math.round(expressed); // Return as integer 0-100
};

// Calculate final phenotype for rendering (converts internal 0-100 to 0-1)
export const calculateSpotPhenotype = (genes: SpotPhenotypeGenes | undefined, koi?: Koi): SpotPhenotype => {
    if (!genes) {
        return {
            colorSaturation: 0.5, // Default to 50%
            activeTraits: []
        };
    }
    const geneIds = Object.keys(genes);
    const expressed: Record<keyof SpotPhenotypeGenes, number> = {} as any;

    geneIds.forEach(id => {
        if (id === 'CS') {
            expressed[id as keyof SpotPhenotypeGenes] = expressGene(genes[id as keyof SpotPhenotypeGenes], id as keyof SpotPhenotypeGenes);
        }
        // ES/EB 는 더 이상 처리하지 않음
    });

    const afterInteractions = applyGeneInteractions(expressed);
    let CS = afterInteractions.CS ?? 50; // Default fallback

    if (checkHiddenRecessiveActivation(genes)) {
        CS = Math.min(100, CS * 1.2);
    }

    const effectiveCS = CS;

    let envModifier = 1.0;
    if (koi) {
        // Age factor: adult=1.0, juvenile=0.85, fry=0.7
        const ageFactor = koi.growthStage === GrowthStage.ADULT ? 1.0 : koi.growthStage === GrowthStage.JUVENILE ? 0.85 : 0.7;
        envModifier = ageFactor;
    }

    // Convert to 0-1 for renderer
    let phenotype: SpotPhenotype = {
        colorSaturation: Math.max(0, Math.min(1, (effectiveCS / 100) * envModifier)),
    };

    const activeTraits = checkThresholdTraits(afterInteractions);
    if (activeTraits.length > 0) {
        phenotype = applyThresholdEffects(phenotype, activeTraits);
        phenotype.activeTraits = activeTraits;
    }

    return phenotype;
};

export const createRandomSpotPhenotypeGenes = (): SpotPhenotypeGenes => {
    // Use defaults with small variance (CS=70±15) for line breeding
    const defaultCS = 70;
    const variance = 15;
    const randomVariance = () => Math.round((Math.random() - 0.5) * 2 * variance);

    return {
        CS: {
            allele1: { value: Math.max(0, Math.min(100, defaultCS + randomVariance())), origin: 'maternal' },
            allele2: { value: Math.max(0, Math.min(100, defaultCS + randomVariance())), origin: 'paternal' },
            dominanceType: GENE_DOMINANCE_CONFIG.CS,
        },
    };
};

export const breedSpotPhenotypeGenes = (parent1Genes: SpotPhenotypeGenes, parent2Genes: SpotPhenotypeGenes): SpotPhenotypeGenes => {
    const offspringGenes = {} as SpotPhenotypeGenes;
    const geneIds = Object.keys(parent1Genes) as (keyof SpotPhenotypeGenes)[];

    for (const geneId of geneIds) {
        // Calculate average from all 4 parent alleles (2 from each parent)
        const p1Avg = (parent1Genes[geneId].allele1.value + parent1Genes[geneId].allele2.value) / 2;
        const p2Avg = (parent2Genes[geneId].allele1.value + parent2Genes[geneId].allele2.value) / 2;
        const totalAvg = (p1Avg + p2Avg) / 2;

        // Mutation logic: Consistent with Lightness/Saturation inheritance
        const mutate = (val: number) => {
            if (Math.random() < LIGHTNESS_MUTATION_CHANCE) {
                const mutation = (Math.random() - 0.5) * 2 * LIGHTNESS_MUTATION_AMOUNT;
                return Math.max(0, Math.min(100, Math.round(val + mutation)));
            }
            return Math.round(val);
        };

        const finalValue = mutate(totalAvg);

        offspringGenes[geneId] = {
            allele1: { value: finalValue, origin: 'maternal' },
            allele2: { value: finalValue, origin: 'paternal' },
            dominanceType: GENE_DOMINANCE_CONFIG[geneId],
        };
    }
    return offspringGenes;
};

export const createDefaultSpotPhenotypeGenes = (): SpotPhenotypeGenes => ({
    CS: { allele1: { value: 70, origin: 'maternal' }, allele2: { value: 70, origin: 'paternal' }, dominanceType: GENE_DOMINANCE_CONFIG.CS },
});

export const createFixedSpotPhenotypeGenes = (value: number): SpotPhenotypeGenes => ({
    CS: {
        allele1: { value: value, origin: 'maternal' },
        allele2: { value: value, origin: 'paternal' },
        dominanceType: GENE_DOMINANCE_CONFIG.CS,
    },
});
