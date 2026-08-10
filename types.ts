
export enum GeneType {
  BLACK = '검정',
  RED = '빨강', // Represents the 'standard' color gene
  YELLOW = '노랑',
  // White remains available for spot patterns; it is not a base koi color.
  WHITE = '하양',
  ORANGE = '주황',
  CREAM = '크림',
}

export enum GrowthStage {
  FRY = 'fry',
  JUVENILE = 'juvenile',
  ADULT = 'adult',
}

export enum SpotShape {
  CIRCLE = 'circle',
  HEXAGON = 'hexagon',
  POLYGON = 'polygon', // Renamed from BLOTCH
  OVAL_H = 'oval_h', // Horizontal Oval
}

export interface Spot {
  x: number; // 0-100%
  y: number; // 0-100%
  size: number; // percentage of body width
  color: GeneType; // Each spot has its own color
  shape: SpotShape;
}

// ============================================
// Spot Phenotype Genetics System (10-Gene)
// ============================================

// 우성 유형
export enum DominanceType {
  COMPLETE = 'complete',           // 완전 우성
  INCOMPLETE = 'incomplete',       // 불완전 우성
  RECESSIVE = 'recessive',         // 열성
  CODOMINANCE = 'codominance',     // 공우성
}

// 대립유전자
export interface Allele {
  value: number;                   // 0 ~ 100 (정수)
  origin: 'maternal' | 'paternal';
}

// 유전자 쌍
export interface GeneAlleles {
  allele1: Allele;
  allele2: Allele;
  dominanceType: DominanceType;
}

// 1개 유전자 시스템 (간소화)
export interface SpotPhenotypeGenes {
  CS: GeneAlleles;  // Color Saturation - 색상 채도
}

// 표현형 (발현된 값)
export interface SpotPhenotype {
  colorSaturation: number;  // 0.0 ~ 1.0
  activeTraits?: string[];
}

export interface KoiGenetics {
  baseColorGenes: GeneType[]; // Changed to array for unlimited polygenic system
  spots: Spot[];
  lightness: number; // For standard color variation (0-100), represents HSL lightness. 50 is standard red.
  saturation: number; // For standard color variation (0-100), represents HSL saturation. 50 is standard.

  spotPhenotypeGenes?: SpotPhenotypeGenes;
}

export interface Koi {
  id: string;
  name: string;
  description: string;
  genetics: KoiGenetics;
  position: { x: number; y: number };
  velocity: { vx: number; vy: number };
  age: number; // 0 to 100+
  growthStage: GrowthStage;
  timesFed: number;
  foodTargetId: number | null;
  feedCooldownUntil: number | null;
  stamina?: number; // 0-100
}

export enum DecorationType {
  LILY_PAD = '연꽃잎',
  ROCK = '바위',
  LANTERN = '등불',
  DUCKWEED = '개구리밥',
}

// ============================================
// Achievement System
// ============================================

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string; // Lucide icon name or emoji
  tier: 'novice' | 'intermediate' | 'advanced' | 'master' | 'legend';
  displayColor?: string; // Hex color for the badge icon
  condition: (koi: any) => boolean; // Using any to avoid circular dependency issues if Koi is not fully defined here, but ideally Koi
  reward: {
    achievementPoints: number;
    items?: { type: 'corn', count: number }[];
  };
  category: 'spots' | 'color' | 'mutation' | 'collection';
  isHidden?: boolean; // If true, details are hidden until unlocked
}

export interface AchievementState {
  unlockedIds: string[];
  claimedIds: string[];
  totalPoints: number;
  lastChecked: number;
}

export interface Decoration {
  id: string;
  type: DecorationType;
  position: { x: number; y: number };
  scale: number;
  rotation: number;
  velocity?: { x: number; y: number }; // For moving decorations
  leafCount?: number; // For plant clusters
}

export enum PondTheme {
  DEFAULT = '기본 (맑은 물)',
  MUD = '진흙 바닥',
  MOSS = '이끼 낀 연못',
  NIGHT = '밤 (달빛)',
}

export interface PondData {
  id: string;
  name: string;
  kois: Koi[];
  decorations: Decoration[];
  theme: PondTheme;
  waterQuality: number; // 0-100
}

export interface SavedGameState {
  ponds: Ponds;
  activePondId: string;
  zenPoints: number;
  foodCount: number;
  cornCount?: number; // Premium food
  honorPoints?: number; // Honor Trophies
  achievementPoints?: number; // Achievement score for rankings
  achievements?: {
    unlockedIds: string[];
    claimedIds: string[];
  };
  koiNameCounter: number;
  timestamp?: number; // Added for display
}

export type Ponds = Record<string, PondData>;
