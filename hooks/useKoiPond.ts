
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Koi, GeneType, Ponds, GrowthStage, Decoration, DecorationType, PondTheme, SpotShape } from '../types';
import { audioManager } from '../utils/audio';
import { createFixedSpotPhenotypeGenes } from '../utils/genetics';

const POINTS_TO_JUVENILE = 15;
const POINTS_TO_ADULT = 15;
const EATING_DISTANCE = 2;
const FEED_COOLDOWN_MS = 3000;

interface FoodPellet {
    id: number;
    position: { x: number; y: number };
    feedAmount: number; // 1 for normal, 3 for corn
}

interface FeedAnimation {
    id: number;
    position: { x: number; y: number };
    feedAmount: number;
}

interface UseKoiPondInitialState {
    ponds: Ponds;
    activePondId: string;
    foodCount?: number;
    cornCount?: number;
}

export const createInitialPonds = (): Ponds => {


    const createSpecificKoi = (id: string, name: string): Koi => {
        const spotCount = Math.floor(Math.random() * 2) + 1; // 1 or 2 spots
        const spots = [];
        for (let i = 0; i < spotCount; i++) {
            spots.push({
                x: Math.random() * 80 + 10,
                y: Math.random() * 80 + 10,
                size: Math.random() * 50 + 40, // 40-90% size range (User confirmed ranges)
                color: GeneType.RED,
                shape: Object.values(SpotShape)[Math.floor(Math.random() * (Object.values(SpotShape).length))] as SpotShape
            });
        }

        return {
            id,
            name,
            description: "연못의 초기 주민입니다.",
            genetics: {
                baseColorGenes: [GeneType.CREAM, GeneType.CREAM], // Cream Base (Homozygous)
                spots: spots,
                lightness: 50,
                saturation: 50,
                spotPhenotypeGenes: createFixedSpotPhenotypeGenes(50),
            },
            position: { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 },
            velocity: { vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2 },
            age: 100,
            growthStage: GrowthStage.ADULT,
            timesFed: 0,
            foodTargetId: null,
            feedCooldownUntil: null,
            stamina: 100,
        };
    };

    // Test Spawn: 6 Specific Koi for Spot Verification
    // Initial Spawn: 2 Koi with Circle spots as requested
    const shapes = [
        { shape: SpotShape.CIRCLE, name: 'Circle' },
        { shape: SpotShape.CIRCLE, name: 'Circle' }
    ];

    const initialKois: Koi[] = shapes.map((s, index) => {
        const id = `initial-${index + 1}`;
        const spots: any[] = [];

        // Add 1 random spot of the specific shape as requested
        const count = 1;
        for (let k = 0; k < count; k++) {
            spots.push({
                x: Math.random() * 80 + 10,
                y: Math.random() * 80 + 10,
                size: Math.random() * 50 + 40, // 40-90% size range
                color: GeneType.RED,
                shape: s.shape
            });
        }

        return {
            id: id,
            name: `코이`,
            description: `${s.name} 패턴을 가진 코이입니다.`,
            genetics: {
                baseColorGenes: [GeneType.CREAM, GeneType.CREAM],
                spots: spots,
                lightness: 50,
                saturation: 50,
                spotPhenotypeGenes: createFixedSpotPhenotypeGenes(50),
            },
            position: { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 },
            velocity: { vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2 },
            age: 100,
            growthStage: GrowthStage.ADULT,
            timesFed: 0,
            foodTargetId: null,
            feedCooldownUntil: null,
            stamina: 100,
        };
    });

    return {
        'pond-1': {
            id: 'pond-1',
            name: '연못 1',
            kois: initialKois,
            decorations: [
                // 개구리밥 설정 제거됨
            ],

            theme: PondTheme.DEFAULT,
            waterQuality: 100,
        }
    };
};

export const useKoiPond = (initialState?: UseKoiPondInitialState) => {
    const [ponds, setPonds] = useState<Ponds>(() => {
        const initial = initialState?.ponds ?? createInitialPonds();
        // Migration: ensure all ponds have decorations array
        Object.values(initial).forEach(pond => {
            if (!pond.decorations) pond.decorations = [];

            // 개구리밥 마이그레이션 로직 제거됨
            // 기존 개구리밥 제거
            const otherDecorations = pond.decorations.filter(d => d.type !== DecorationType.DUCKWEED);

            pond.decorations = [...otherDecorations];
            if (!Object.values(PondTheme).includes(pond.theme)) {
                pond.theme = PondTheme.DEFAULT;
            }
            if (pond.waterQuality === undefined) {
                pond.waterQuality = 100;
            }
            pond.kois.forEach(k => {
                if (k.stamina === undefined || k.stamina === null) k.stamina = 100;
                // Developer Fix: Reset stamina if 0 (likely due to fast decay bug)
                if (k.stamina <= 0) k.stamina = 100;
                // Migration: Fix old koi with missing/incorrect lightness and saturation
                if (k.genetics.lightness === undefined || k.genetics.lightness === 100) {
                    k.genetics.lightness = 50;
                }
                if (k.genetics.saturation === undefined || k.genetics.saturation === 100) {
                    k.genetics.saturation = 50;
                }
            });
            // pond.theme = PondTheme.NIGHT; // Removed forced override
        });
        return initial;
    });
    const [activePondId, setActivePondId] = useState<string>(() => initialState?.activePondId ?? 'pond-1');


    // ... (inside useKoiPond hook)
    const [foodPellets, setFoodPellets] = useState<FoodPellet[]>([]);
    const [feedAnimations, setFeedAnimations] = useState<FeedAnimation[]>([]);
    const [foodCount, setFoodCount] = useState(initialState?.foodCount ?? 20);
    const [cornCount, setCornCount] = useState(initialState?.cornCount ?? 0);
    // Night cycle removed based on user request

    useEffect(() => {
        // Day/Night Logic Removed

        const degradationInterval = setInterval(() => {
            setPonds((prev: Ponds) => {
                const activePond = prev[activePondId];
                if (!activePond) return prev;

                // degrade water quality: 0.002 per koi per second (Slower)
                const qualityLoss = Math.min(activePond.kois.length * 0.002, 0.5);
                const newWaterQuality = Math.max(0, (activePond.waterQuality ?? 100) - qualityLoss);

                // degrade stamina based on water quality
                // User Request: 
                // Quality <= 80: -2 per 4s (-0.5 per sec)
                // Quality <= 60: -3 per 4s (-0.75 per sec)
                const currentQuality = activePond.waterQuality ?? 100;
                let staminaDecay = 0;

                if (currentQuality <= 60) {
                    staminaDecay = 1 / 3; // 1 per 3 seconds
                } else if (currentQuality <= 70) {
                    staminaDecay = 1 / 6; // 1 per 6 seconds
                }

                const updatedKois = activePond.kois.map(k => ({
                    ...k,
                    stamina: Math.max(0, (k.stamina ?? 100) - staminaDecay),
                }));

                return {
                    ...prev,
                    [activePondId]: {
                        ...activePond,
                        waterQuality: newWaterQuality,
                        kois: updatedKois
                    }
                };
            });
        }, 1000);

        return () => {
            clearInterval(degradationInterval);
        };
    }, [activePondId]);

    // const isNight = dayNightCycle.phase === 'night'; // Removed
    const pondBounds = useRef({ width: 100, height: 100 });

    const koiList = useMemo(() => ponds[activePondId]?.kois || [], [ponds, activePondId]);

    const addPond = useCallback(() => {
        setPonds((prevPonds: Ponds) => {
            const currentCount = Object.keys(prevPonds).length;
            if (currentCount >= 4) return prevPonds;

            const newPondId = `pond-${currentCount + 1}`;
            const newPonds = {
                ...prevPonds,
                [newPondId]: {
                    id: newPondId,
                    name: `연못 ${currentCount + 1}`,
                    kois: [],
                    decorations: [],
                    theme: PondTheme.DEFAULT,
                    waterQuality: 100,
                }
            };
            setActivePondId(newPondId);
            return newPonds;
        });
    }, []);

    const addKois = useCallback((kois: Koi[]) => {
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) return prev;
            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    kois: [...activePond.kois, ...kois],
                }
            };
        });
    }, [activePondId]);

    const addDecoration = useCallback((decoration: Decoration) => {
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) return prev;
            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    decorations: [...(activePond.decorations || []), decoration],
                }
            };
        });
    }, [activePondId]);

    const spawnKoi = useCallback((color: GeneType) => {
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) return prev;

            const newId = `shop-koi-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const isBasicKoi = color === GeneType.CREAM;
            let initialSpots: any[] = [];

            if (isBasicKoi) {
                // Basic Koi: Exactly 2 spots (randomized) - Set to RED for visibility (Kohaku style)
                initialSpots = [
                    { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10, size: 25, color: GeneType.RED, shape: SpotShape.CIRCLE },
                    { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10, size: 25, color: GeneType.RED, shape: SpotShape.CIRCLE }
                ];
            } else {
                // Special Koi: 3 Fixed Spots (as before)
                initialSpots = [
                    { x: 50, y: 30, size: 20, color: color, shape: SpotShape.CIRCLE },
                    { x: 50, y: 60, size: 25, color: color, shape: SpotShape.HEXAGON },
                    { x: 50, y: 85, size: 15, color: color, shape: SpotShape.POLYGON }
                ];
            }

            const newKoi: Koi = {
                id: newId,
                name: `코이`,
                description: isBasicKoi ? "가장 기본적인 코이입니다." : "상점에서 온 특별한 코이입니다.",
                genetics: {
                    baseColorGenes: [color, color], // Homozygous to ensure expression
                    spots: initialSpots,
                    lightness: 50, // User Request: Force 50 (Standard)
                    saturation: 50, // User Request: Force 50 (Standard)
                    spotPhenotypeGenes: createFixedSpotPhenotypeGenes(50), // Standard Saturation
                },
                position: { x: 50, y: 50 }, // Center spawn
                velocity: { vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2 },
                age: 0,
                growthStage: GrowthStage.FRY,
                timesFed: 0,
                foodTargetId: null,
                feedCooldownUntil: null,
                stamina: 100,
            };

            // Randomize spot shapes for Basic Koi too?
            // User said "Basic Koi has 2 spots".
            // If I randomize shapes, it's fine.
            newKoi.genetics.spots.forEach(spot => {
                const shapes = Object.values(SpotShape);
                spot.shape = shapes[Math.floor(Math.random() * shapes.length)] as SpotShape;
                spot.size = Math.random() * 40 + 40; // 40-80 size
            });

            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    kois: [...activePond.kois, newKoi],
                }
            };
        });
    }, [activePondId]);

    const removeKoi = useCallback((koiId: string) => {
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) {
                return prev;
            }
            const updatedKois = activePond.kois.filter(k => k.id !== koiId);
            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    kois: updatedKois,
                }
            };
        });
    }, [activePondId]);

    const setPondTheme = useCallback((theme: PondTheme) => {
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) return prev;
            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    theme,
                }
            };
        });
    }, [activePondId]);

    const dropFood = useCallback((position: { x: number; y: number }, feedAmount: number = 1) => {
        const newPellets: FoodPellet[] = [];
        for (let i = 0; i < 3; i++) {
            newPellets.push({
                id: Date.now() + i + Math.floor(Math.random() * 1000000),
                position: {
                    x: position.x + (Math.random() - 0.5) * 4,
                    y: position.y + (Math.random() - 0.5) * 4,
                },
                feedAmount,
            });
        }
        setFoodPellets((prev: FoodPellet[]) => [...prev, ...newPellets]);
    }, []);

    const triggerFeedAnimation = useCallback((position: { x: number; y: number }, feedAmount: number = 1) => {
        const animId = Date.now() + Math.random();
        const newAnimation = { id: animId, position, feedAmount };
        setFeedAnimations((prev: FeedAnimation[]) => [...prev, newAnimation]);
        setTimeout(() => {
            setFeedAnimations((prev: FeedAnimation[]) => prev.filter(a => a.id !== animId));
        }, 1500);
    }, []);

    // This function is for direct feeding, which is not the primary mechanism anymore,
    // but we keep it for potential future use or debugging.
    const moveKoi = useCallback((koiIds: string[], targetPondId: string) => {
        setPonds((prev: Ponds) => {
            const sourcePond = prev[activePondId];
            const targetPond = prev[targetPondId];

            if (!sourcePond || !targetPond) return prev;
            if (activePondId === targetPondId) return prev;

            // Check capacity
            if (targetPond.kois.length + koiIds.length > 30) {
                // UI should check this, but safety catch
                return prev;
            }

            const koisToMove = sourcePond.kois.filter(k => koiIds.includes(k.id));
            const remainingKois = sourcePond.kois.filter(k => !koiIds.includes(k.id));

            const movedKois = koisToMove.map(k => ({
                ...k,
                position: { x: 50, y: 50 }, // Reset position to center
                vx: 0, vy: 0, // Reset velocity
                target: { x: 50, y: 50 } // Reset target
            }));

            return {
                ...prev,
                [activePondId]: {
                    ...sourcePond,
                    kois: remainingKois
                },
                [targetPondId]: {
                    ...targetPond,
                    kois: [...targetPond.kois, ...movedKois]
                }
            };
        });
    }, [activePondId]);

    // Original feedKoi...
    const feedKoi = useCallback((koiId: string, feedAmount: number = 1) => {
        let fedKoiPosition: { x: number; y: number } | null = null;
        const now = Date.now();
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) return prev;

            const updatedKois = activePond.kois.map(k => {
                if (k.id === koiId && (!k.feedCooldownUntil || now > k.feedCooldownUntil)) {
                    fedKoiPosition = k.position;
                    const newTimesFed = k.timesFed + feedAmount;
                    const newCooldown = { feedCooldownUntil: now + FEED_COOLDOWN_MS };
                    const newStamina = Math.min(100, (k.stamina ?? 0) + 30); // Restore 30 stamina

                    // Growth Logic (Legacy direct feed)
                    if (k.growthStage === GrowthStage.FRY && newTimesFed >= POINTS_TO_JUVENILE) {
                        return { ...k, timesFed: 0, growthStage: GrowthStage.JUVENILE, ...newCooldown, stamina: newStamina };
                    } else if (k.growthStage === GrowthStage.JUVENILE && newTimesFed >= POINTS_TO_ADULT) {
                        return { ...k, timesFed: 0, growthStage: GrowthStage.ADULT, ...newCooldown, stamina: newStamina };
                    }
                    return { ...k, timesFed: newTimesFed, ...newCooldown, stamina: newStamina };
                }
                return k;
            });

            if (fedKoiPosition === null) return prev;

            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    kois: updatedKois,
                }
            };
        });

        if (fedKoiPosition) {
            triggerFeedAnimation(fedKoiPosition, feedAmount);
        }
    }, [activePondId, triggerFeedAnimation]);

    const updateKoiPositions = useCallback(() => {
        // Legacy function - physics is now handled by GameEngine
        // We keep this structure if we ever need to revert or for reference
    }, []);

    const handleFoodEaten = useCallback((koiId: string, foodId: number, feedAmount: number, position: { x: number, y: number }) => {
        const now = Date.now();
        setPonds((prev: Ponds) => {
            const activePond = prev[activePondId];
            if (!activePond) return prev;

            const updatedKois = activePond.kois.map(k => {
                if (k.id === koiId) {
                    const newTimesFed = k.timesFed + feedAmount;
                    const newCooldown = { feedCooldownUntil: now + FEED_COOLDOWN_MS };

                    // User Request: Basic(+5), Corn(+10)
                    // Assuming Corn has feedAmount > 1 (usually 3)
                    const staminaGain = feedAmount > 1 ? 10 : 5;

                    const newStamina = Math.min(100, (k.stamina ?? 0) + staminaGain);

                    // Growth Logic
                    if (k.growthStage === GrowthStage.FRY && newTimesFed >= POINTS_TO_JUVENILE) {
                        // Grow to Juvenile
                        return {
                            ...k,
                            timesFed: 0, // Reset counter for next stage
                            growthStage: GrowthStage.JUVENILE,
                            foodTargetId: null,
                            ...newCooldown,
                            stamina: newStamina
                        };
                    } else if (k.growthStage === GrowthStage.JUVENILE && newTimesFed >= POINTS_TO_ADULT) {
                        // Grow to Adult
                        return {
                            ...k,
                            timesFed: 0, // Reset counter (maxed out)
                            growthStage: GrowthStage.ADULT,
                            foodTargetId: null,
                            ...newCooldown,
                            stamina: newStamina
                        };
                    }

                    return { ...k, timesFed: newTimesFed, foodTargetId: null, ...newCooldown, stamina: newStamina };
                }
                return k;
            });

            return {
                ...prev,
                [activePondId]: {
                    ...activePond,
                    kois: updatedKois,
                }
            };
        });

        audioManager.playSFX('eat');
        setFoodPellets((prev: FoodPellet[]) => prev.filter(p => p.id !== foodId));
        triggerFeedAnimation(position, feedAmount);
    }, [activePondId, triggerFeedAnimation]);


    const activePond = ponds[activePondId];

    const resetPonds = () => {
        const initial = createInitialPonds();
        setPonds(initial);
        setActivePondId('pond-1'); // Force sync with initial pond ID
    };

    return {
        ponds,
        setPonds, // Exposed for manual load
        activePondId,
        setActivePondId,
        koiList: activePond?.kois || [],
        addKois,
        removeKoi,
        updateKoiPositions,
        addPond,
        feedKoi,
        foodPellets,
        dropFood,
        feedAnimations,
        addDecoration,
        setPondTheme,
        isNight: false,
        resetPonds,
        handleFoodEaten,
        spawnKoi,
        cleanPond: () => {
            setPonds(prev => ({
                ...prev,
                [activePondId]: {
                    ...prev[activePondId],
                    waterQuality: 100
                }
            }));
        },
        reduceWaterQuality: (amount: number) => {
            setPonds(prev => {
                const activePond = prev[activePondId];
                if (!activePond) return prev;
                return {
                    ...prev,
                    [activePondId]: {
                        ...activePond,
                        waterQuality: Math.max(0, (activePond.waterQuality ?? 100) - amount)
                    }
                };
            });
        },
        consumeStamina: (koiIds: string[], amount: number) => {
            setPonds(prev => {
                const activePond = prev[activePondId];
                if (!activePond) return prev;

                const updatedKois = activePond.kois.map(k => {
                    if (koiIds.includes(k.id)) {
                        return { ...k, stamina: Math.max(0, (k.stamina ?? 0) - amount) };
                    }
                    return k;
                });

                return {
                    ...prev,
                    [activePondId]: {
                        ...activePond,
                        kois: updatedKois
                    }
                };
            });
        },
        foodCount,
        setFoodCount,
        cornCount,
        setCornCount,
        renameKoi: (koiId: string, nextName: string) => {
            setPonds(prev => {
                const activePond = prev[activePondId];
                if (!activePond) return prev;
                return {
                    ...prev,
                    [activePondId]: {
                        ...activePond,
                        kois: activePond.kois.map(k => k.id === koiId ? { ...k, name: nextName } : k)
                    }
                };
            });
        },
        toggleKoiFavorite: (koiId: string) => {
            setPonds(prev => {
                const activePond = prev[activePondId];
                if (!activePond) return prev;
                return {
                    ...prev,
                    [activePondId]: {
                        ...activePond,
                        kois: activePond.kois.map(k => k.id === koiId ? { ...k, isFavorite: !k.isFavorite } : k)
                    }
                };
            });
        },
        moveKoi,
    };
};
