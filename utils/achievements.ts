import { Achievement, Koi, GeneType } from '../types';
import { GENE_COLOR_MAP, getPhenotype } from './genetics';

export const ACHIEVEMENTS: Achievement[] = [];

// ==========================================
// 1. SPOT COUNT ACHIEVEMENTS (4 Tiers)
// ==========================================
interface SpotTierConfig {
    count: number;
    title: string;
    tier: Achievement['tier'];
    color: string;
    reward: { achievementPoints: number };
}

const SPOT_TIERS: SpotTierConfig[] = [
    { count: 4, title: '점박이 입문', tier: 'novice', color: '#cd7f32', reward: { achievementPoints: 100 } },
    { count: 8, title: '점박이 애호가', tier: 'intermediate', color: '#c0c0c0', reward: { achievementPoints: 200 } },
    { count: 12, title: '점박이 전문가', tier: 'advanced', color: '#ffd700', reward: { achievementPoints: 300 } },
    { count: 20, title: '점박이의 전설', tier: 'legend', color: '#b9f2ff', reward: { achievementPoints: 500 } },
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
        },
        condition: (koi: Koi) => koi.genetics.spots.some(spot => spot.color === color.type),
    });
});

// ==========================================
// 3. SPECIAL INTERMEDIATE ACHIEVEMENTS (5-Color)
// ==========================================
ACHIEVEMENTS.push(
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
    { type: GeneType.BLACK, name: '검정', color: GENE_COLOR_MAP[GeneType.BLACK] },
];

interface VariationConfig {
    id: string;
    tier: Achievement['tier'];
    reward: { achievementPoints: number };
    condition: (koi: Koi) => boolean;
}

const VARIATIONS: VariationConfig[] = [
    {
        id: 'basic',
        tier: 'intermediate',
        reward: { achievementPoints: 200 },
        condition: () => true
    },
];

// Helper to get display color for tier
const getTierColor = (tier: string, baseColor: string): string => {
    switch (tier) {
        case 'novice': return '#cd7f32'; // Bronze
        case 'intermediate': return '#c0c0c0'; // Silver
        case 'advanced': return '#ffd700'; // Gold
        case 'legend': return '#b9f2ff'; // Diamond
        default: return baseColor;
    }
};

COLORS.forEach(color => {
    VARIATIONS.forEach(variant => {
        // The game starts with a cream koi, so this achievement is the first
        // tutorial milestone rather than an intermediate challenge. Keep the
        // achievement ID unchanged so existing progress remains valid.
        const tier = color.type === GeneType.CREAM ? 'novice' : variant.tier;

        ACHIEVEMENTS.push({
            id: `color_${color.type}_${variant.id}`,
            title: `${color.name} 코이`,
            description: `${color.name} 색상의 코이를 획득하세요.`,
            icon: 'medal',
            tier,
            displayColor: getTierColor(tier, color.color),
            category: 'color',
            reward: {
                achievementPoints: variant.reward.achievementPoints,
            },
            condition: (koi: Koi) => {
                const phenotype = getPhenotype(koi.genetics.baseColorGenes);
                if (phenotype !== color.type) return false;
                return variant.condition(koi);
            }
        });
    });
});

const EXTREME_ACHIEVEMENTS = [
    {
        id: 'saturation_100',
        title: '채도 100인 코이',
        description: '채도가 100인 코이를 획득하세요.',
        condition: (koi: Koi) => koi.genetics.saturation >= 100,
    },
    {
        id: 'saturation_0',
        title: '채도 0인 코이',
        description: '채도가 0인 코이를 획득하세요.',
        condition: (koi: Koi) => koi.genetics.saturation <= 0,
    },
    {
        id: 'lightness_100',
        title: '명도 100인 코이',
        description: '명도가 100인 코이를 획득하세요.',
        condition: (koi: Koi) => koi.genetics.lightness >= 100,
    },
    {
        id: 'lightness_0',
        title: '명도 0인 코이',
        description: '명도가 0인 코이를 획득하세요.',
        condition: (koi: Koi) => koi.genetics.lightness <= 0,
    },
];

EXTREME_ACHIEVEMENTS.forEach(achievement => {
    ACHIEVEMENTS.push({
        ...achievement,
        icon: 'medal',
        tier: 'advanced',
        displayColor: getTierColor('advanced', '#ffd700'),
        category: 'color',
        reward: {
            achievementPoints: 300,
        },
    });
});

// ==========================================
// 5. LEGEND SPOT ACHIEVEMENTS (Legend Tier)
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
