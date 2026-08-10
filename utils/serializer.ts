import { SavedGameState, Ponds, PondData, Koi, KoiGenetics, Spot, GeneType, SpotShape, PondTheme, GrowthStage } from '../types';

// Dictionaries for mapping Enums to Integers
const GENE_MAP = [
    GeneType.BLACK, GeneType.RED, GeneType.YELLOW, GeneType.WHITE,
    GeneType.ORANGE, GeneType.CREAM
];

const SHAPE_MAP = [
    SpotShape.CIRCLE, SpotShape.HEXAGON, SpotShape.POLYGON, SpotShape.OVAL_H
];

const THEME_MAP = [
    PondTheme.DEFAULT, PondTheme.MUD, PondTheme.MOSS
];

// Round number to precision
const round = (num: number, precision: number = 1) => {
    const p = Math.pow(10, precision);
    return Math.round(num * p) / p;
};

// Minified Interfaces
// Use Arrays for extreme compactness where possible
// Spot: [x, y, size, colorIdx, shapeIdx]
type MinifiedSpot = [number, number, number, number, number];

// Genetics: [ [baseGenes...], [spots...], lightness, saturation ]
type MinifiedGenetics = [number[], MinifiedSpot[], number, number];

// Koi: [id, name, genetics, age, growthStageIdx, timesFed, x, y] (Last 2: pos)
type MinifiedKoi = [string, string, MinifiedGenetics, number, number, number, number, number];

// Pond: [id, name, themeIdx, [kois...], waterQuality] 
type MinifiedPond = [string, string, number, MinifiedKoi[], number];

// State: [version, zenPoints, foodCount, cornCount, koisNameCounter, [ponds...], activePondId]
type MinifiedState = [number, number, number, number, number, MinifiedPond[], string];

const CURRENT_VERSION = 3;


export const compressGameStateAsync = async (state: SavedGameState): Promise<string> => {
    const minPonds: MinifiedPond[] = Object.values(state.ponds).map(pond => {
        const minKois: MinifiedKoi[] = pond.kois.map(koi => {
            const minSpots: MinifiedSpot[] = koi.genetics.spots.map(s => [
                round(s.x),
                round(s.y),
                round(s.size),
                GENE_MAP.indexOf(s.color),
                SHAPE_MAP.indexOf(s.shape)
            ]);

            const minGenes = koi.genetics.baseColorGenes.map(g => GENE_MAP.indexOf(g));

            const minGenetics: MinifiedGenetics = [
                minGenes,
                minSpots,
                koi.genetics.lightness,
                koi.genetics.saturation

            ];

            const stageIdx = ['fry', 'juvenile', 'adult'].indexOf(koi.growthStage);

            return [
                koi.id,
                koi.name,
                minGenetics,
                koi.age,
                stageIdx,
                koi.timesFed,
                round(koi.position.x),
                round(koi.position.y)
            ];
        });

        return [
            pond.id,
            pond.name,
            THEME_MAP.indexOf(pond.theme),
            minKois,
            round(pond.waterQuality || 100)
        ];
    });

    const minState: MinifiedState = [
        CURRENT_VERSION,
        state.zenPoints,
        state.foodCount,
        state.cornCount || 0,
        state.koiNameCounter,
        minPonds,
        state.activePondId
    ];

    const json = JSON.stringify(minState);

    // GZIP Compression via CompressionStream
    try {
        if (typeof CompressionStream === 'undefined') {
            throw new Error("GZIP not supported");
        }
        const stream = new Blob([json]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const compressedResponse = new Response(compressedStream);
        const blob = await compressedResponse.blob();
        const buffer = await blob.arrayBuffer();

        // Convert Buffer to Base64 (Chunked to avoid Stack Overflow)
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK_SIZE = 8192; // Process in 8KB chunks
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.subarray(i, i + CHUNK_SIZE);
            binary += String.fromCharCode.apply(null, Array.from(chunk) as any);
        }

        // Mark as Compressed with a prefix to distinguish from plain JSON
        return 'GZ:' + btoa(binary);

    } catch (e) {
        console.warn("Compression failed, falling back to Minified JSON:", e);
        // Fallback: UTF-8 Clean Base64 (Legacy/Safe Mode)
        return btoa(unescape(encodeURIComponent(json)));
    }
};

export const decompressGameStateAsync = async (code: string): Promise<SavedGameState> => {
    try {
        let json = '';

        if (code.startsWith('GZ:')) {
            // Handle GZIP Compressed Data
            const base64 = code.substring(3);
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            const stream = new Blob([bytes]).stream();
            const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
            const response = new Response(decompressedStream);
            json = await response.text();
        } else {
            // Handle Legacy/Fallback Data (Minified JSON)
            json = decodeURIComponent(escape(atob(code)));
        }

        const minState: MinifiedState = JSON.parse(json);

        const version = minState[0];
        const pondsArray = minState[5];
        const ponds: Ponds = {};

        pondsArray.forEach(p => {
            const [id, name, themeIdx, minKois, waterQuality] = p;

            const kois: Koi[] = minKois.map(mk => {
                const [kid, kname, mGen, kAge, kStageIdx, kFed, kx, ky] = mk;
                const [mGenes, mSpots, kLight, kSaturation] = mGen;

                const baseColorGenes = mGenes.map(idx => GENE_MAP[idx] || GeneType.CREAM);
                const spots: Spot[] = mSpots.map(s => ({
                    x: s[0],
                    y: s[1],
                    size: s[2],
                    color: GENE_MAP[s[3]] || GeneType.RED,
                    shape: SHAPE_MAP[s[4]] || SpotShape.CIRCLE
                }));

                const growthStages: GrowthStage[] = [GrowthStage.FRY, GrowthStage.JUVENILE, GrowthStage.ADULT];

                return {
                    id: kid,
                    name: kname,
                    description: '', // Re-generate or leave empty
                    genetics: {
                        baseColorGenes,
                        spots,
                        lightness: kLight,
                        saturation: (kSaturation !== undefined && kSaturation > 1) ? kSaturation : 50
                    },
                    position: { x: kx, y: ky },
                    velocity: { vx: 0, vy: 0 },
                    age: kAge,
                    growthStage: growthStages[kStageIdx] || GrowthStage.FRY,
                    timesFed: kFed,
                    foodTargetId: null,
                    feedCooldownUntil: null,
                    stamina: 100 // Reset stamina on load for safety
                };
            });

            ponds[id] = {
                id,
                name,
                theme: THEME_MAP[themeIdx] || PondTheme.DEFAULT,
                kois,
                decorations: [],
                waterQuality: waterQuality !== undefined ? waterQuality : 100
            };
        });

        return {
            ponds,
            activePondId: minState[6] || 'pond-1',
            zenPoints: minState[1],
            foodCount: minState[2],
            cornCount: minState[3],
            koiNameCounter: minState[4],
            timestamp: Date.now()
        };

    } catch (e) {
        console.error("Decompression failed", e);
        throw new Error("Invalid or Corrupted Backup Code");
    }
};
