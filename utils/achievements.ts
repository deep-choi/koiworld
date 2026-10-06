import { Achievement, Koi, GeneType } from '../types';
import { GENE_COLOR_MAP, getPhenotype, getKoiTraits, getTraitCopies, getBodyColorName } from './genetics';

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
// 몸 색 이름은 코이 이름·유전자형 표기와 같은 이름(순백, 황금, 주황, 진홍, 칠흑)을 씁니다.
const COLORS = [GeneType.RED, GeneType.ORANGE, GeneType.YELLOW, GeneType.CREAM, GeneType.BLACK]
    .map(type => ({ type, name: getBodyColorName(type), color: GENE_COLOR_MAP[type] }));

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
            title: `${color.name}잉어`,
            description: `몸 색이 ${color.name}인 코이를 획득하세요.`,
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

// ==========================================
// 6. TRAIT ACHIEVEMENTS (bred traits, checked the same way on the server)
// ==========================================
const TRAIT_ACHIEVEMENT_LIST: Array<Pick<Achievement, 'id' | 'title' | 'description' | 'tier' | 'condition'> & { points: number }> = [
    {
        id: 'trait_motoguro', title: '모토구로', tier: 'intermediate', points: 200,
        description: '지느러미 뿌리가 무늬 색으로 물든 모토구로 코이를 획득하세요.',
        condition: (koi: Koi) => getKoiTraits(koi.genetics).motoguro !== null,
    },
    {
        id: 'trait_hirenaga', title: '긴 지느러미', tier: 'intermediate', points: 200,
        description: '지느러미가 길게 늘어진 히레나가 코이를 획득하세요.',
        condition: (koi: Koi) => getTraitCopies(koi.genetics, 'hirenagaGenes') >= 1,
    },
    {
        id: 'trait_hirenaga_full', title: '나비 잉어', tier: 'advanced', points: 300,
        description: '히레나가 유전자를 2개 가진, 지느러미가 아주 긴 코이를 획득하세요.',
        condition: (koi: Koi) => getTraitCopies(koi.genetics, 'hirenagaGenes') === 2,
    },
    {
        id: 'trait_ginrin', title: '은빛 비늘', tier: 'intermediate', points: 200,
        description: '긴린 유전자를 가진, 비늘이 반짝이는 코이를 획득하세요.',
        condition: (koi: Koi) => getTraitCopies(koi.genetics, 'ginrinGenes') >= 1,
    },
    {
        id: 'trait_ginrin_100', title: '완전한 은린', tier: 'advanced', points: 300,
        description: '긴린 유전자를 2개 가진, 비늘이 아주 많이 반짝이는 코이를 획득하세요.',
        condition: (koi: Koi) => getTraitCopies(koi.genetics, 'ginrinGenes') === 2,
    },
    {
        id: 'trait_koromo', title: '고로모', tier: 'advanced', points: 300,
        description: '무늬 위에 비늘 그물이 덮인 고로모 코이를 획득하세요.',
        condition: (koi: Koi) => getKoiTraits(koi.genetics).koromo,
    },
    {
        id: 'trait_doitsu', title: '도이츠', tier: 'advanced', points: 300,
        description: '등줄기를 따라 육각 비늘이 붙은 도이츠 코이를 획득하세요.',
        condition: (koi: Koi) => getKoiTraits(koi.genetics).doitsu,
    },
    {
        id: 'trait_tancho', title: '탄초', tier: 'legend', points: 500,
        description: '정수리에 둥근 점 하나만 남은 탄초 코이를 획득하세요.',
        condition: (koi: Koi) => getKoiTraits(koi.genetics).tancho !== null,
    },
];

TRAIT_ACHIEVEMENT_LIST.forEach(({ points, ...achievement }) => {
    ACHIEVEMENTS.push({
        ...achievement,
        icon: achievement.tier === 'advanced' || achievement.tier === 'legend' ? 'trophy' : 'medal',
        displayColor: getTierColor(achievement.tier, '#ffd700'),
        category: 'mutation',
        reward: { achievementPoints: points },
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
