import { Achievement, Koi, GeneType } from '../types';
import { GENE_COLOR_MAP, getPhenotype } from './genetics';

export const ACHIEVEMENTS: Achievement[] = [];

// ==========================================
// 1. SPOT COUNT ACHIEVEMENTS (5 Tiers)
// ==========================================
interface SpotTierConfig {
    count: number;
    title: string;
    tier: Achievement['tier'];
    color: string;
    reward: { achievementPoints: number; corn: number };
}

const SPOT_TIERS: SpotTierConfig[] = [
    { count: 4, title: '점박이 입문', tier: 'novice', color: '#cd7f32', reward: { achievementPoints: 100, corn: 10 } },
    { count: 8, title: '점박이 애호가', tier: 'intermediate', color: '#c0c0c0', reward: { achievementPoints: 200, corn: 25 } },
    { count: 12, title: '점박이 전문가', tier: 'advanced', color: '#ffd700', reward: { achievementPoints: 300, corn: 50 } },
    { count: 16, title: '점박이 마스터', tier: 'master', color: '#a855f7', reward: { achievementPoints: 400, corn: 90 } }, // Purple
    { count: 20, title: '점박이의 전설', tier: 'legend', color: '#b9f2ff', reward: { achievementPoints: 500, corn: 150 } },
];

SPOT_TIERS.forEach(tier => {
    ACHIEVEMENTS.push({
        id: `spot_count_${tier.count}`,
        title: tier.title,
        description: `점이 ${tier.count}개 이상인 코이를 획득하세요.`,
        icon: 'medal',
        tier: tier.tier,
        displayColor: tier.color,
        category: 'spots',
        reward: {
            achievementPoints: tier.reward.achievementPoints,
            items: [{ type: 'corn', count: tier.reward.corn }]
        },
        condition: (koi: Koi) => koi.genetics.spots.length >= tier.count,
    });
});

// ==========================================
// 2. SPOT COLOR ACHIEVEMENTS (Novice Only)
// ==========================================
const SPOT_ACHIEVEMENT_COLORS = [
    { type: GeneType.ORANGE, name: '주황' },
    { type: GeneType.YELLOW, name: '노랑' },
    { type: GeneType.WHITE, name: '하양' },
    { type: GeneType.BLACK, name: '검정' },
];

SPOT_ACHIEVEMENT_COLORS.forEach(color => {
    ACHIEVEMENTS.push({
        id: `spot_color_${color.type}`,
        title: `${color.name} 점박이`,
        description: `${color.name}색 점을 가진 코이를 획득하세요.`,
        icon: 'medal',
        tier: 'novice',
        displayColor: '#cd7f32', // Unified Bronze Color for Novice
        category: 'spots',
        reward: {
            achievementPoints: 100,
            items: [{ type: 'corn', count: 5 }]
        },
        condition: (koi: Koi) => koi.genetics.spots.some(spot => spot.color === color.type),
    });
});

// ==========================================
// 3. SPECIAL INTERMEDIATE ACHIEVEMENTS (Albino & 5-Color)
// ==========================================
ACHIEVEMENTS.push(
    {
        id: 'special_albino',
        title: '알비노 잉어',
        description: '알비노 유전자를 가진 잉어를 획득하세요.',
        icon: 'medal',
        tier: 'intermediate',
        displayColor: '#c0c0c0', // Silver
        category: 'mutation',
        reward: {
            achievementPoints: 200,
            items: [{ type: 'corn', count: 30 }]
        },
        condition: (koi: Koi) => {
            return !!(koi.genetics.albinoAlleles?.[0] && koi.genetics.albinoAlleles?.[1]);
        }
    },
    {
        id: 'special_five_color',
        title: '오색 잉어',
        description: '빨강, 주황, 노랑, 하양, 검정 5색이 모두 포함된 코이를 만드세요.',
        icon: 'trophy',
        tier: 'intermediate',
        displayColor: '#c0c0c0', // Silver
        category: 'mutation',
        reward: {
            achievementPoints: 200,
            items: [{ type: 'corn', count: 30 }]
        },
        condition: (koi: Koi) => {
            const baseColor = getPhenotype(koi.genetics.baseColorGenes);
            const spotColors = koi.genetics.spots.map(s => s.color);
            const allColors = new Set([baseColor, ...spotColors]);

            return allColors.has(GeneType.RED) &&
                allColors.has(GeneType.ORANGE) &&
                allColors.has(GeneType.YELLOW) &&
                allColors.has(GeneType.WHITE) &&
                allColors.has(GeneType.BLACK);
        }
    }
);

// ==========================================
// 4. COLOR VARIATION ACHIEVEMENTS
// ==========================================
const COLORS = [
    { type: GeneType.RED, name: '빨강', color: GENE_COLOR_MAP[GeneType.RED] },
    { type: GeneType.ORANGE, name: '주황', color: GENE_COLOR_MAP[GeneType.ORANGE] },
    { type: GeneType.YELLOW, name: '노랑', color: GENE_COLOR_MAP[GeneType.YELLOW] },
    { type: GeneType.CREAM, name: '크림', color: GENE_COLOR_MAP[GeneType.CREAM] },
    { type: GeneType.WHITE, name: '하양', color: GENE_COLOR_MAP[GeneType.WHITE] },
    { type: GeneType.BLACK, name: '검정', color: GENE_COLOR_MAP[GeneType.BLACK] },
];

interface VariationConfig {
    id: string;
    tier: Achievement['tier'];
    reward: { achievementPoints: number; corn: number };
    descPrefix?: string;
    getPrefix?: (colorName: string) => string;
    condition: (koi: Koi) => boolean;
}

const VARIATIONS: VariationConfig[] = [
    {
        id: 'basic',
        tier: 'intermediate',
        reward: { achievementPoints: 200, corn: 15 },
        descPrefix: '',
        condition: () => true
    },
    {
        id: 'sat_high',
        tier: 'advanced',
        reward: { achievementPoints: 300, corn: 45 },
        descPrefix: '선명한 ',
        condition: (koi: Koi) => koi.genetics.saturation >= 100
    },
    {
        id: 'sat_low',
        tier: 'advanced',
        reward: { achievementPoints: 300, corn: 45 },
        descPrefix: '파스텔 ',
        condition: (koi: Koi) => koi.genetics.saturation <= 0
    },
    {
        id: 'light_high',
        tier: 'advanced',
        reward: { achievementPoints: 300, corn: 45 },
        descPrefix: '눈부신 ',
        condition: (koi: Koi) => koi.genetics.lightness >= 100
    },
    {
        id: 'light_low',
        tier: 'advanced',
        reward: { achievementPoints: 300, corn: 45 },
        descPrefix: '검붉은 ',
        getPrefix: (colorName: string) => {
            if (colorName === '빨강') return '검붉은 ';
            if (colorName === '노랑' || colorName === '주황') return '구릿빛 ';
            if (colorName === '하양' || colorName === '크림') return '그림자 ';
            return '짙은 ';
        },
        condition: (koi: Koi) => koi.genetics.lightness <= 0
    },
];

// Helper to get display color for tier
const getTierColor = (tier: string, baseColor: string): string => {
    switch (tier) {
        case 'novice': return '#cd7f32'; // Bronze
        case 'intermediate': return '#c0c0c0'; // Silver
        case 'advanced': return '#ffd700'; // Gold
        case 'master': return '#e5e4e2'; // Platinum
        case 'legend': return '#b9f2ff'; // Diamond
        default: return baseColor;
    }
};

COLORS.forEach(color => {
    VARIATIONS.forEach(variant => {
        const isBasic = variant.id === 'basic';
        let title = '';
        if (isBasic) {
            title = `${color.name} 코이`;
        } else {
            let prefix = variant.descPrefix || '';
            if (variant.getPrefix) {
                prefix = variant.getPrefix(color.name);
            } else if (variant.id === 'light_high' && color.name === '검정') {
                prefix = '연한 ';
            }
            title = `${prefix}${color.name} 코이`;
        }

        ACHIEVEMENTS.push({
            id: `color_${color.type}_${variant.id}`,
            title: title,
            description: isBasic
                ? `${color.name} 색상의 코이를 획득하세요.`
                : variant.id === 'light_high' ? `명도가 100인 ${color.name} 색상 코이`
                    : variant.id === 'light_low' ? `명도가 0인 ${color.name} 색상 코이`
                        : variant.id === 'sat_high' ? `채도가 100인 ${color.name} 색상 코이`
                            : variant.id === 'sat_low' ? `채도가 0인 ${color.name} 색상 코이`
                                : `${title}를 획득하세요.`,
            icon: 'medal',
            tier: variant.tier,
            displayColor: getTierColor(variant.tier, color.color),
            category: 'color',
            reward: {
                achievementPoints: variant.reward.achievementPoints,
                items: [{ type: 'corn', count: variant.reward.corn }]
            },
            condition: (koi: Koi) => {
                const phenotype = getPhenotype(koi.genetics.baseColorGenes);
                if (phenotype !== color.type) return false;
                return variant.condition(koi);
            }
        });
    });
});

// ==========================================
// 5. MASTER COMBINATION ACHIEVEMENTS (Master Tier)
// ==========================================
const MASTER_VARIATIONS = [
    {
        id: 'void', // L0, S0, SS0
        prefix: '공허의 ',
        descriptionTemplate: '명도 0, 채도 0, 점 채도 0',
        condition: (koi: Koi) => {
            const ss = koi.genetics.spotPhenotypeGenes?.CS;
            const isSS0 = ss ? (ss.allele1.value <= 0 && ss.allele2.value <= 0) : false;
            return koi.genetics.lightness <= 0 && koi.genetics.saturation <= 0 && isSS0;
        }
    },
    {
        id: 'brilliant', // L100, S100, SS100
        prefix: '찬란한 ',
        descriptionTemplate: '명도 100, 채도 100, 점 채도 100',
        condition: (koi: Koi) => {
            const ss = koi.genetics.spotPhenotypeGenes?.CS;
            const isSS100 = ss ? (ss.allele1.value >= 100 && ss.allele2.value >= 100) : false;
            return koi.genetics.lightness >= 100 && koi.genetics.saturation >= 100 && isSS100;
        }
    },
    {
        id: 'abyssal_flame', // L0, S100, SS100
        prefix: '심연의 불꽃 ',
        descriptionTemplate: '명도 0, 채도 100, 점 채도 100',
        condition: (koi: Koi) => {
            const ss = koi.genetics.spotPhenotypeGenes?.CS;
            const isSS100 = ss ? (ss.allele1.value >= 100 && ss.allele2.value >= 100) : false;
            return koi.genetics.lightness <= 0 && koi.genetics.saturation >= 100 && isSS100;
        }
    },
    {
        id: 'pure', // L100, S0, SS0
        prefix: '순수의 ',
        descriptionTemplate: '명도 100, 채도 0, 점 채도 0',
        condition: (koi: Koi) => {
            const ss = koi.genetics.spotPhenotypeGenes?.CS;
            const isSS0 = ss ? (ss.allele1.value <= 0 && ss.allele2.value <= 0) : false;
            return koi.genetics.lightness >= 100 && koi.genetics.saturation <= 0 && isSS0;
        }
    }
];

COLORS.forEach(color => {
    MASTER_VARIATIONS.forEach(variant => {
        ACHIEVEMENTS.push({
            id: `master_${color.type}_${variant.id}`,
            title: `${variant.prefix}${color.name} 코이`,
            description: `${variant.descriptionTemplate}인 ${color.name} 색상 코이를 획득하세요.`,
            icon: 'medal',
            tier: 'master',
            displayColor: '#e5e4e2', // Platinum
            category: 'mutation',
            reward: {
                achievementPoints: 400,
                items: [{ type: 'corn', count: 90 }]
            },
            condition: (koi: Koi) => {
                const phenotype = getPhenotype(koi.genetics.baseColorGenes);
                if (phenotype !== color.type) return false;
                return variant.condition(koi);
            }
        });
    });
});

// ==========================================
// 6. LEGEND SPOT ACHIEVEMENTS (Legend Tier)
// ==========================================
// 16+ spots of a SINGLE color (excluding Red)
SPOT_ACHIEVEMENT_COLORS.forEach(color => {
    ACHIEVEMENTS.push({
        id: `legend_spot_${color.type}`,
        title: `전설의 ${color.name} 점박이`,
        description: `${color.name}색 점만 16개 이상 가진 코이를 획득하세요.`,
        icon: 'trophy',
        tier: 'legend',
        displayColor: '#b9f2ff', // Diamond
        category: 'spots',
        reward: {
            achievementPoints: 500,
            items: [{ type: 'corn', count: 150 }]
        },
        condition: (koi: Koi) => {
            const spots = koi.genetics.spots;
            if (spots.length < 16) return false;
            // All spots must match the target color
            return spots.every(s => s.color === color.type);
        }
    });
});

export const checkUnlockableAchievements = (kois: Koi[], unlockedIds: string[]): Achievement[] => {
    const newUnlocks: Achievement[] = [];
    const lockedAchievements = ACHIEVEMENTS.filter(ach => !unlockedIds.includes(ach.id));

    lockedAchievements.forEach(ach => {
        const isMet = kois.some(koi => ach.condition(koi));
        if (isMet) {
            newUnlocks.push(ach);
        }
    });

    return newUnlocks;
};
