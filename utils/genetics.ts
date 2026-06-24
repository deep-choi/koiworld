import { KoiGenetics, GeneType, Spot, Koi, GrowthStage, SpotShape, DominanceType, Allele, GeneAlleles, SpotPhenotypeGenes, SpotPhenotype } from '../types';

const ALL_SPOT_COLORS = [GeneType.RED, GeneType.ORANGE, GeneType.YELLOW, GeneType.WHITE, GeneType.BLACK];

const RECESSIVE_COLORS = [
    GeneType.ORANGE, GeneType.YELLOW, GeneType.WHITE, GeneType.CREAM, GeneType.BLACK, GeneType.RED
];

const SPECIAL_COLORS: GeneType[] = [
    // Disabled per request
];

export const GENE_COLOR_MAP: Record<GeneType, string> = {
    [GeneType.BLACK]: '#252525', // Charcoal Black (Lighter per request)
    [GeneType.RED]: '#E53E3E',
    [GeneType.YELLOW]: '#F6E05E',
    [GeneType.WHITE]: '#ffffff', // Pure White (Desaturated)
    [GeneType.ORANGE]: '#ED8936',
    [GeneType.CREAM]: '#FEFDE7',
};

export const GENE_RARITY: Record<GeneType, number> = {
    [GeneType.BLACK]: 3, // Now a mutation (was 2)
    [GeneType.WHITE]: 3,
    [GeneType.YELLOW]: 3,
    [GeneType.ORANGE]: 3,
    [GeneType.RED]: 3,
    [GeneType.CREAM]: 1, // Basic Type (Most Common, was 6)
};

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
    GeneType.WHITE,
];

// Determines the expressed phenotype from an arbitrary number of genes
export const getPhenotype = (genes: GeneType[]): GeneType => {
    if (!genes || genes.length === 0) return GeneType.CREAM;

    // Filter out undefined/null
    const validGenes = genes.filter(g => g);
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
    value += 120;

    // 2. Value from Phenotype Rarity (Multiplier reduced 50 -> 15)
    value += (GENE_RARITY[phenotype] || 1) * 15;

    // 2.5 Bonus for Non-Cream Body Color (User Request)
    if (phenotype !== GeneType.CREAM) {
        value += 50;
    }

    // 3. Value from Hidden Genes (Carriers) (Reduced multiplier)
    genetics.baseColorGenes.forEach(gene => {
        if (gene !== GeneType.CREAM) {
            value += (GENE_RARITY[gene] || 1) * 2;
        }
    });

    // 4. Value from Lightness (More linear, less explosive)
    // pow(diff, 1.5) * 2.0 (Boosted per user request)
    const lightnessDifference = Math.abs(genetics.lightness - 50);
    value += Math.pow(lightnessDifference, 1.5) * 2.0;

    // 5. Value from Body Saturation (Extremes are better)
    // abs(sat - 50) * 2 (Max at 50 diff is 100)
    const saturationDifference = Math.abs((genetics.saturation ?? 50) - 50);
    value += saturationDifference * 2;

    // 6. Value from Spots
    // Tiered bonus based on count (Multiples of 4)
    const spotCount = genetics.spots.length;
    let spotTierBonus = 0;
    if (spotCount >= 12) spotTierBonus = 400;
    else if (spotCount >= 8) spotTierBonus = 150;
    else if (spotCount >= 4) spotTierBonus = 50;

    // Base spot value and color rarity
    const spotColorValue = genetics.spots.reduce((sum, spot) => sum + (GENE_RARITY[spot.color] || 1), 0);
    value += spotTierBonus + (spotColorValue * 2);

    // 7. Value from intrinsic spot saturation extremes.
    // calculateSpotPhenotype returns 0-1, so convert to 0-100 before scoring.
    const spotPheno = calculateSpotPhenotype(genetics.spotPhenotypeGenes);
    const spotSaturationPercent = spotPheno.colorSaturation * 100;
    const spotSatDiff = Math.abs(spotSaturationPercent - 50);
    value += spotSatDiff * 6;

    // 8. Multiplier for growth stage (Halved AGAIN per user request)
    // 8. Multiplier for growth stage
    if (growthStage === GrowthStage.ADULT) {
        value *= 1.0;
    } else if (growthStage === GrowthStage.JUVENILE) {
        value *= 0.4; // User Request: 0.4
    } else {
        value *= 0.2; // User Request: 0.2
    }

    // 9. Stamina/Health Penalties
    const stamina = koi.stamina ?? 0;
    if (stamina <= 10 || koi.sickTimestamp) {
        return 0;
    }
    else if (stamina <= 40) {
        value *= 0.25;
    }
    else if (stamina <= 60) {
        value *= 0.5;
    }

    return Math.floor(value);
};

const SPOT_COLOR_MUTATION_CHANCE = 0.04;
const SIZE_MUTATION_AMOUNT = 5; // Variation in spot size during breeding (Not related to koi size)
const LIGHTNESS_MUTATION_CHANCE = 0.2;
const LIGHTNESS_MUTATION_AMOUNT = 5;
const BASE_COLOR_MUTATION_CHANCE = 0.005;
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

    const isEarlySpotCount = tier < 1;
    const addWeight = isEarlySpotCount ? 0.4 : Math.max(0.05, 0.3 * Math.pow(0.5, tier));
    const deleteWeight = isEarlySpotCount ? 0.2 : 0.4;

    // 유지 확률: 기본값
    const keepWeight = 1.0;

    const totalWeight = addWeight + deleteWeight + keepWeight;

    const roll = Math.random() * totalWeight;
    let targetSpotsCount = baseCount;
    if (roll < addWeight) {
        targetSpotsCount = baseCount + 1;
    } else if (roll < addWeight + deleteWeight) {
        targetSpotsCount = Math.max(0, baseCount - 1);
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

    // 6. Breed albino alleles (Recessive inheritance + Mutation)
    let childAlbinoAlleles: [boolean, boolean] | undefined;
    const parent1Alleles = genetics1.albinoAlleles || [false, false];
    const parent2Alleles = genetics2.albinoAlleles || [false, false];

    // Normal Inheritance
    const fromParent1 = parent1Alleles[Math.random() < 0.5 ? 0 : 1];
    const fromParent2 = parent2Alleles[Math.random() < 0.5 ? 0 : 1];
    childAlbinoAlleles = [fromParent1, fromParent2];

    // Albino Mutation (User Request: Add Albino to mutations)
    // Chance to spontaneously become Albino (Homozygous [true, true])
    if (Math.random() < BASE_COLOR_MUTATION_CHANCE) { // Use same chance as color mutation
        childAlbinoAlleles = [true, true];
        // Note: Albino overrides base color rendering visually, handled in renderer
    }

    return {
        genetics: {
            baseColorGenes: childGenes,
            spots: childSpots,
            lightness: childLightness,
            saturation: childSaturation,
            albinoAlleles: childAlbinoAlleles,
            spotPhenotypeGenes: childSpotPhenotypeGenes,
        },
        mutations
    };
};

export const createRandomGenetics = (): KoiGenetics => {
    return {
        baseColorGenes: [GeneType.WHITE, GeneType.WHITE],
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

export const getDisplayColor = (phenotype: GeneType, lightness: number, saturation: number = 50, isAlbino: boolean = false): string => {
    // White also goes through normal logic now to support saturation/lightness changes
    const hex = GENE_COLOR_MAP[phenotype] || '#000000';
    const hsl = hexToHSL(hex);

    // Apply safe Lightness (Expanded range per user request: 0.8 -> 1.2 multiplier, Min 10 -> 5)
    // Center is 50. Input 0 -> -60, Input 100 -> +60.
    // Max extended but clamped to 90 to prevent pure white, Min 5 to prevent pure black
    let safeLightnessShift = (lightness - 50) * 1.2;
    let finalL = Math.max(5, Math.min(90, hsl.l + safeLightnessShift));

    // ALBINO: Force max lightness (pastel/pale version of base color)
    if (isAlbino) {
        finalL = 90; // Maximum safe lightness
    }

    // Apply safe Saturation
    const saturationMultiplier = 0.5 + (saturation / 100);
    const finalS = Math.max(10, Math.min(95, hsl.s * saturationMultiplier));

    return `hsla(${hsl.h}, ${finalS}%, ${finalL}%, 1)`;
};

export const getSpineColor = (phenotype: GeneType, lightness: number, saturation: number = 50, isAlbino: boolean = false): string => {
    const hex = GENE_COLOR_MAP[phenotype] || '#000000';
    const hsl = hexToHSL(hex);

    // Apply saturation (same logic as getDisplayColor)
    const saturationMultiplier = 0.5 + (saturation / 100);
    const finalS = Math.max(10, Math.min(95, hsl.s * saturationMultiplier));

    // Apply safe Lightness (Match getDisplayColor logic)
    const safeLightnessShift = (lightness - 50) * 1.2;
    let finalL = Math.max(5, Math.min(90, hsl.l + safeLightnessShift));

    // ALBINO: Force max lightness
    if (isAlbino) {
        finalL = 85; // Slightly less than body for spine visibility
    }

    return `hsla(${hsl.h}, ${finalS}%, ${Math.max(0, finalL - 10)}%, 0.3)`;
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
