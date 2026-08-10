import React, { useState, useEffect, useRef } from 'react';
import { Koi, SpotPhenotypeGenes, GeneAlleles, DominanceType, GeneType, GrowthStage, KoiGenetics, Spot, SpotShape } from '../../types';
import { expressGene, calculateSpotPhenotype, GENE_COLOR_MAP, breedKoi, getPhenotype } from '../../utils/genetics';
import { getDebugConfig } from '../../config';

interface SpotGeneticsDebugPanelProps {
    koi: Koi | null;
    zenPoints?: number;
    onSetZenPoints?: (points: number) => void;
    onSpawnKoi?: (genetics: Partial<KoiGenetics>, growthStage?: GrowthStage) => void;
    onUpdateKoi?: (koiId: string, updates: { genetics?: Partial<KoiGenetics>; growthStage?: GrowthStage }) => void;
}

// Gene IDs for the 1-gene system (간소화 - 채도만)
const GENE_IDS: (keyof SpotPhenotypeGenes)[] = ['CS'];

// Gene ID mapping to Korean labels
const GENE_LABELS: Record<string, string> = {
    CS: '채도',
};

// Base colors exclude white. White remains available for spot patterns.
const BASE_COLOR_GENES: GeneType[] = [GeneType.BLACK, GeneType.RED, GeneType.YELLOW, GeneType.ORANGE, GeneType.CREAM];
const SPOT_COLOR_GENES: GeneType[] = [GeneType.BLACK, GeneType.RED, GeneType.YELLOW, GeneType.WHITE, GeneType.ORANGE, GeneType.CREAM];

// Growth stages
const GROWTH_STAGES: GrowthStage[] = [GrowthStage.FRY, GrowthStage.JUVENILE, GrowthStage.ADULT];

/**
 * Debug Panel for Full Koi Genetics Editing
 */
export const SpotGeneticsDebugPanel: React.FC<SpotGeneticsDebugPanelProps> = ({
    koi,
    zenPoints = 0,
    onSetZenPoints,
    onSpawnKoi,
    onUpdateKoi
}) => {
    const debugConfig = getDebugConfig();
    const [isMinimized, setIsMinimized] = useState(false);
    const [editZenPoints, setEditZenPoints] = useState(zenPoints.toString());

    // Color genetics state
    const [baseColorGenes, setBaseColorGenes] = useState<GeneType[]>([GeneType.CREAM, GeneType.CREAM]);
    const [lightness, setLightness] = useState(50);
    const [saturation, setSaturation] = useState(50);
    const [growthStage, setGrowthStage] = useState<GrowthStage>(GrowthStage.ADULT);

    // Spots state (actual spots on the koi)
    const [spots, setSpots] = useState<Spot[]>([]);

    // Spot phenotype genes state (percentage values 0-100)
    const [customGenes, setCustomGenes] = useState<Record<string, number>>(() => {
        const initial: Record<string, number> = {};
        GENE_IDS.forEach(id => { initial[id] = 50; }); // Start at 50%
        return initial;
    });

    // Sim Results State
    const [simResults, setSimResults] = useState<{
        total: number;
        mutationCount: number;
        colorCounts: Record<string, number>;
    } | null>(null);

    // Dragging state
    const [pos, setPos] = useState({ top: 8, right: 8 });
    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, initialTop: 8, initialRight: 8 });

    const handleMouseDown = (e: React.MouseEvent) => {
        // Only allow dragging from the header or specific non-interactive areas
        if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input') || (e.target as HTMLElement).closest('select')) {
            return;
        }

        isDragging.current = true;
        dragStart.current = {
            x: e.clientX,
            y: e.clientY,
            initialTop: pos.top,
            initialRight: pos.right
        };
        e.preventDefault();
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;

            const deltaX = e.clientX - dragStart.current.x;
            const deltaY = e.clientY - dragStart.current.y;

            setPos({
                top: dragStart.current.initialTop + deltaY,
                right: dragStart.current.initialRight - deltaX // Moving right decreases right property
            });
        };

        const handleMouseUp = () => {
            isDragging.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    // Sync editZenPoints with prop
    useEffect(() => {
        setEditZenPoints(zenPoints.toString());
    }, [zenPoints]);

    // Don't render if debug is disabled
    if (!debugConfig.SHOW_SPOT_GENETICS_DEBUG) return null;

    const genes = koi?.genetics.spotPhenotypeGenes;
    const phenotype = genes ? calculateSpotPhenotype(genes, koi) : null;

    // Create SpotPhenotypeGenes from custom values
    const createGenesFromCustom = (): SpotPhenotypeGenes => {
        const makeGene = (value: number): GeneAlleles => ({
            allele1: { value: Math.round(value), origin: 'maternal' },
            allele2: { value: Math.round(value), origin: 'paternal' },
            dominanceType: DominanceType.INCOMPLETE,
        });

        return {
            CS: makeGene(customGenes.CS),
        };
    };

    // ========== COPY ALL FROM SELECTED KOI ==========
    const handleCopyAll = () => {
        if (!koi) return;

        // Copy color genes
        setBaseColorGenes([...koi.genetics.baseColorGenes]);
        setLightness(koi.genetics.lightness);
        setSaturation(koi.genetics.saturation);
        setGrowthStage(koi.growthStage as GrowthStage);

        // Copy spots
        setSpots([...koi.genetics.spots]);

        // Copy spot phenotype genes
        if (koi.genetics.spotPhenotypeGenes) {
            const copied: Record<string, number> = {};
            GENE_IDS.forEach(id => {
                copied[id] = Math.round(expressGene(koi.genetics.spotPhenotypeGenes![id]));
            });
            setCustomGenes(copied);
        }
    };

    const handleRandomizeGenes = () => {
        const newGenes: Record<string, number> = {};
        GENE_IDS.forEach(id => { newGenes[id] = Math.round(Math.random() * 100); });
        setCustomGenes(newGenes);
    };

    const handleRandomizeColors = () => {
        const randomGene = () => BASE_COLOR_GENES[Math.floor(Math.random() * BASE_COLOR_GENES.length)];
        const count = Math.floor(Math.random() * 4) + 2;
        const genes: GeneType[] = [];
        for (let i = 0; i < count; i++) {
            genes.push(randomGene());
        }
        setBaseColorGenes(genes);
        setLightness(Math.floor(Math.random() * 100));
        setSaturation(Math.floor(Math.random() * 100));
    };

    // Add a random spot
    const handleAddSpot = () => {
        const newSpot: Spot = {
            x: Math.floor(Math.random() * 80) + 10,
            y: Math.floor(Math.random() * 80) + 10,
            size: Math.floor(Math.random() * 51) + 40, // 40-90% size range
            color: SPOT_COLOR_GENES[Math.floor(Math.random() * SPOT_COLOR_GENES.length)],
            shape: SpotShape.CIRCLE,
        };
        setSpots(prev => [...prev, newSpot]);
    };

    const handleRemoveSpot = (index: number) => {
        setSpots(prev => prev.filter((_, i) => i !== index));
    };

    const handleClearSpots = () => {
        setSpots([]);
    };

    const handleSpawnKoi = () => {
        if (onSpawnKoi) {
            onSpawnKoi({
                baseColorGenes,
                lightness,
                saturation,
                spots,
                spotPhenotypeGenes: createGenesFromCustom(),
            }, growthStage);
        }
    };

    const handleApplyToSelected = () => {
        if (onUpdateKoi && koi) {
            onUpdateKoi(koi.id, {
                genetics: {
                    baseColorGenes,
                    lightness,
                    saturation,
                    spots,
                    spotPhenotypeGenes: createGenesFromCustom(),
                },
                growthStage,
            });
        }
    };

    const handleSetZenPoints = () => {
        const points = parseInt(editZenPoints.replace(/,/g, ''), 10);
        if (!isNaN(points) && points >= 0 && onSetZenPoints) {
            onSetZenPoints(points);
        }
    };

    const addColorGene = (gene: GeneType) => {
        setBaseColorGenes(prev => [...prev, gene]);
    };

    const removeColorGene = (index: number) => {
        if (baseColorGenes.length > 2) {
            setBaseColorGenes(prev => prev.filter((_, i) => i !== index));
        }
    };

    const handleSimulateBreeding = () => {
        const parentGenetics: KoiGenetics = {
            baseColorGenes,
            spots,
            lightness,
            saturation,
            spotPhenotypeGenes: createGenesFromCustom(),
        };

        const results = {
            total: 100,
            mutationCount: 0,
            colorCounts: {} as Record<string, number>,
        };

        for (let i = 0; i < 100; i++) {
            // Self-breeding for testing recessive traits visibility
            const { genetics: child, mutations } = breedKoi(parentGenetics, parentGenetics);

            // Check Mutations
            if (mutations.length > 0) {
                results.mutationCount++;
            }

            // Check Phenotype
            const phenotype = getPhenotype(child.baseColorGenes);
            results.colorCounts[phenotype] = (results.colorCounts[phenotype] || 0) + 1;
        }

        setSimResults(results);
    };

    return (
        <div
            className="fixed z-[9999] pointer-events-auto select-none"
            onMouseDown={handleMouseDown}
            style={{
                top: `${pos.top}px`,
                right: `${pos.right}px`,
                background: 'rgba(0,0,0,0.95)',
                color: '#00ff00',
                padding: isMinimized ? '8px' : '12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                borderRadius: '8px',
                border: '1px solid #00ff00',
                maxHeight: isMinimized ? 'auto' : '85vh',
                overflow: 'auto',
                minWidth: isMinimized ? 'auto' : '360px',
                cursor: 'move',
            }}
        >
            {/* Header */}
            <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-bold flex items-center gap-2">
                    🧬 개발자 패널
                    {koi && <span className="text-xs text-gray-500">#{koi.name}</span>}
                </h4>
                <div className="flex items-center gap-1">
                    {koi && (
                        <button
                            onClick={handleCopyAll}
                            className="bg-yellow-600 hover:bg-yellow-500 text-white px-2 py-0.5 rounded text-xs font-bold"
                        >
                            📋 전부 복사
                        </button>
                    )}
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="text-yellow-400 hover:text-yellow-200 px-2"
                    >
                        {isMinimized ? '▼' : '▲'}
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    {/* Zen Points Editor */}
                    <div className="border-t border-gray-700 pt-2 mb-3">
                        <h5 className="text-xs text-yellow-400 mb-1">💰 젠 포인트</h5>
                        <div className="flex gap-1">
                            <input
                                type="number"
                                value={editZenPoints}
                                onChange={e => setEditZenPoints(e.target.value)}
                                className="flex-1 bg-gray-800 text-white px-2 py-1 rounded text-xs border border-gray-600"
                            />
                            <button
                                onClick={handleSetZenPoints}
                                className="bg-yellow-600 hover:bg-yellow-500 text-black px-2 py-1 rounded text-xs font-bold"
                            >
                                변경
                            </button>
                            <button
                                onClick={() => onSetZenPoints?.(zenPoints + 10000)}
                                className="bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs"
                            >
                                +10K
                            </button>
                        </div>
                        <div className="text-gray-500 text-xs mt-1">현재: {zenPoints.toLocaleString()} ZP</div>
                    </div>

                    {/* GROWTH STAGE */}
                    <div className="border-t border-gray-700 pt-2 mb-3">
                        <h5 className="text-xs text-green-400 mb-1">🌱 Growth Stage (성장 상태)</h5>
                        <div className="flex gap-1">
                            {GROWTH_STAGES.map(stage => (
                                <button
                                    key={stage}
                                    onClick={() => setGrowthStage(stage)}
                                    className={`px-3 py-1 rounded text-xs font-bold ${growthStage === stage
                                        ? 'bg-green-600 text-white'
                                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                                >
                                    {stage === GrowthStage.FRY ? '치어' : stage === GrowthStage.JUVENILE ? '준성체' : '성체'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* COLOR GENES EDITOR */}
                    <div className="border-t border-gray-700 pt-2 mb-3">
                        <div className="flex justify-between items-center mb-2">
                            <h5 className="text-xs text-pink-400">🎨 기본 색상 유전자</h5>
                            <button
                                onClick={handleRandomizeColors}
                                className="bg-pink-600 hover:bg-pink-500 text-white px-2 py-0.5 rounded text-xs"
                            >
                                무작위
                            </button>
                        </div>

                        {/* Current Color Genes Display */}
                        <div className="flex flex-wrap gap-1 mb-2">
                            {baseColorGenes.map((gene, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                                    style={{
                                        backgroundColor: GENE_COLOR_MAP[gene],
                                        color: gene === GeneType.BLACK || gene === GeneType.RED ? '#fff' : '#000'
                                    }}
                                >
                                    {gene}
                                    {baseColorGenes.length > 2 && (
                                        <button
                                            onClick={() => removeColorGene(idx)}
                                            className="ml-1 hover:opacity-70"
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Add Color Gene Buttons */}
                        <div className="flex flex-wrap gap-1 mb-2">
                            {BASE_COLOR_GENES.map(gene => (
                                <button
                                    key={gene}
                                    onClick={() => addColorGene(gene)}
                                    className="px-2 py-0.5 rounded text-xs border border-gray-600 hover:border-white"
                                    style={{
                                        backgroundColor: GENE_COLOR_MAP[gene],
                                        color: gene === GeneType.BLACK || gene === GeneType.RED ? '#fff' : '#000'
                                    }}
                                >
                                    +{gene}
                                </button>
                            ))}
                        </div>

                        {/* Lightness & Transparency */}
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-gray-400 w-12">명도:</span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={lightness}
                                onChange={e => setLightness(parseInt(e.target.value))}
                                className="flex-1 h-3"
                                style={{ accentColor: '#ff69b4' }}
                            />
                            <span className="text-pink-300 w-8 text-right">{lightness}</span>
                        </div>

                        {/* Saturation Slider */}
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-gray-400 w-12">채도:</span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={saturation}
                                onChange={e => setSaturation(parseInt(e.target.value))}
                                className="flex-1 h-3"
                                style={{ accentColor: '#facc15' }}
                            />
                            <span className="text-yellow-300 w-8 text-right">{saturation}</span>
                        </div>

                    </div>

                    {/* SPOTS EDITOR (무늬) */}
                    <div className="border-t border-gray-700 pt-2 mb-3">
                        <div className="flex justify-between items-center mb-2">
                            <h5 className="text-xs text-orange-400">🔴 무늬 - {spots.length}개</h5>
                            <div className="flex gap-1">
                                <button
                                    onClick={handleAddSpot}
                                    className="bg-orange-600 hover:bg-orange-500 text-white px-2 py-0.5 rounded text-xs"
                                >
                                    +추가
                                </button>
                                <button
                                    onClick={handleClearSpots}
                                    className="bg-red-600 hover:bg-red-500 text-white px-2 py-0.5 rounded text-xs"
                                >
                                    전부 삭제
                                </button>
                            </div>
                        </div>

                        {/* Spots Detail Editor */}
                        {spots.length > 0 ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {spots.map((spot, idx) => (
                                    <div key={idx} className="bg-gray-800 p-2 rounded border border-gray-700">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs text-gray-400">무늬 #{idx + 1}</span>
                                            <button
                                                onClick={() => handleRemoveSpot(idx)}
                                                className="text-red-400 hover:text-red-200 text-xs px-1"
                                            >
                                                삭제
                                            </button>
                                        </div>

                                        {/* Color & Shape Row */}
                                        <div className="flex gap-2 mb-1">
                                            <div className="flex items-center gap-1">
                                                <span className="text-gray-500 text-xs">색:</span>
                                                <select
                                                    value={spot.color}
                                                    onChange={e => {
                                                        const newSpots = [...spots];
                                                        newSpots[idx] = { ...spot, color: e.target.value as GeneType };
                                                        setSpots(newSpots);
                                                    }}
                                                    className="bg-gray-700 text-white text-xs rounded px-1 py-0.5 border border-gray-600"
                                                    style={{ backgroundColor: GENE_COLOR_MAP[spot.color] }}
                                                >
                                                    {SPOT_COLOR_GENES.map(g => (
                                                        <option key={g} value={g}>{g}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="text-gray-500 text-xs">형:</span>
                                                <select
                                                    value={spot.shape}
                                                    onChange={e => {
                                                        const newSpots = [...spots];
                                                        newSpots[idx] = { ...spot, shape: e.target.value as SpotShape };
                                                        setSpots(newSpots);
                                                    }}
                                                    className="bg-gray-700 text-white text-xs rounded px-1 py-0.5 border border-gray-600"
                                                >
                                                    <option value={SpotShape.CIRCLE}>원</option>
                                                    <option value={SpotShape.HEXAGON}>육각</option>
                                                    <option value={SpotShape.POLYGON}>다각</option>
                                                    <option value={SpotShape.OVAL_H}>가로타원</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* X Position */}
                                        <div className="flex items-center gap-1 mb-1">
                                            <span className="text-gray-500 text-xs w-6">X:</span>
                                            <input
                                                type="range" min="0" max="100" value={spot.x}
                                                onChange={e => {
                                                    const newSpots = [...spots];
                                                    newSpots[idx] = { ...spot, x: parseInt(e.target.value) };
                                                    setSpots(newSpots);
                                                }}
                                                className="flex-1 h-2"
                                                style={{ accentColor: '#f97316' }}
                                            />
                                            <span className="text-orange-300 text-xs w-8 text-right">{spot.x}%</span>
                                        </div>

                                        {/* Y Position */}
                                        <div className="flex items-center gap-1 mb-1">
                                            <span className="text-gray-500 text-xs w-6">Y:</span>
                                            <input
                                                type="range" min="0" max="100" value={spot.y}
                                                onChange={e => {
                                                    const newSpots = [...spots];
                                                    newSpots[idx] = { ...spot, y: parseInt(e.target.value) };
                                                    setSpots(newSpots);
                                                }}
                                                className="flex-1 h-2"
                                                style={{ accentColor: '#f97316' }}
                                            />
                                            <span className="text-orange-300 text-xs w-8 text-right">{spot.y}%</span>
                                        </div>

                                        {/* Size */}
                                        <div className="flex items-center gap-1">
                                            <span className="text-gray-500 text-xs w-6">크기:</span>
                                            <input
                                                type="range" min="40" max="90" value={spot.size}
                                                onChange={e => {
                                                    const newSpots = [...spots];
                                                    newSpots[idx] = { ...spot, size: parseInt(e.target.value) };
                                                    setSpots(newSpots);
                                                }}
                                                className="flex-1 h-2"
                                                style={{ accentColor: '#f97316' }}
                                            />
                                            <span className="text-orange-300 text-xs w-8 text-right">{spot.size}%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-gray-500 text-xs">무늬 없음 - +추가 버튼을 클릭하세요</div>
                        )}
                    </div>

                    {/* Spot Phenotype Gene Editor */}
                    <div className="border-t border-gray-700 pt-2 mb-3">
                        <div className="flex justify-between items-center mb-2">
                            <h5 className="text-xs text-yellow-400">🧬 무늬 표현형 유전자</h5>
                            <button
                                onClick={handleRandomizeGenes}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded text-xs"
                            >
                                무작위
                            </button>
                        </div>

                        {/* Gene Sliders */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {GENE_IDS.map(id => (
                                <div key={id} className="flex items-center gap-1">
                                    <span className="text-gray-400 w-12">{GENE_LABELS[id]}</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={customGenes[id]}
                                        onChange={e => setCustomGenes(prev => ({ ...prev, [id]: parseInt(e.target.value) }))}
                                        className="flex-1 h-3"
                                        style={{ accentColor: '#00ff00' }}
                                    />
                                    <span className="text-yellow-300 w-8 text-right">{Math.round(customGenes[id])}%</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* BREEDING SIMULATOR */}
                    <div className="border-t border-gray-700 pt-2 mb-3">
                        <h5 className="text-xs text-purple-400 mb-2">🧬 자가 교배 시뮬레이션 (100회)</h5>
                        <button
                            onClick={handleSimulateBreeding}
                            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-1.5 rounded text-xs font-bold mb-2"
                        >
                            ▶️ 시뮬레이션 실행 (현재 유전자 x 현재 유전자)
                        </button>

                        {simResults && (
                            <div className="bg-gray-800 p-2 rounded border border-gray-600 text-xs">
                                <div className="flex justify-between mb-1">
                                    <span className="text-gray-400">돌연변이 감지:</span>
                                    <span className={simResults.mutationCount > 0 ? "text-yellow-300 font-bold" : "text-gray-500"}>
                                        {simResults.mutationCount}회
                                    </span>
                                </div>
                                <div className="border-t border-gray-600 mt-1 pt-1">
                                    <div className="text-gray-500 mb-1">색상 발현 분포:</div>
                                    <div className="flex flex-wrap gap-1">
                                        {Object.entries(simResults.colorCounts).map(([color, count]) => (
                                            <span key={color} className="px-1.5 py-0.5 rounded bg-gray-700 border border-gray-500" style={{ color: GENE_COLOR_MAP[color as GeneType] }}>
                                                {color}: {count}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 mb-3">
                        <button
                            onClick={handleSpawnKoi}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white py-1.5 rounded text-xs font-bold"
                        >
                            🐟 새 코이 생성
                        </button>
                        {koi && (
                            <button
                                onClick={handleApplyToSelected}
                                className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-1.5 rounded text-xs font-bold"
                            >
                                ✏️ 선택 코이 수정
                            </button>
                        )}
                    </div>

                    {/* Current Koi Info (Read-only) */}
                    {koi && (
                        <div className="border-t border-gray-700 pt-2">
                            <h5 className="text-xs text-gray-400 mb-1">📊 선택된 코이 정보</h5>
                            <div className="text-xs space-y-1">
                                <div><span className="text-gray-500">성장 단계:</span> <span className="text-green-300">{koi.growthStage === GrowthStage.FRY ? '치어' : koi.growthStage === GrowthStage.JUVENILE ? '준성체' : '성체'}</span></div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500">색상:</span>
                                    <div className="flex gap-1">
                                        {koi.genetics.baseColorGenes.map((g, i) => (
                                            <span key={i} className="px-1 rounded text-xs" style={{ backgroundColor: GENE_COLOR_MAP[g] }}>{g}</span>
                                        ))}
                                    </div>
                                </div>
                                <div><span className="text-gray-500">명도:</span> <span className="text-pink-300">{koi.genetics.lightness}</span> | <span className="text-gray-500">채도:</span> <span className="text-yellow-300">{koi.genetics.saturation}</span></div>
                                <div><span className="text-gray-500">무늬:</span> <span className="text-orange-300">{koi.genetics.spots.length}개</span></div>
                            </div>
                        </div>
                    )}

                    {/* Phenotype Preview */}
                    {phenotype && debugConfig.SHOW_PHENOTYPE_PREVIEW && (
                        <div className="border-t border-gray-700 pt-2 mt-2">
                            <h5 className="text-xs text-gray-400 mb-1">🎨 무늬 표현형</h5>
                            <div className="grid grid-cols-2 gap-1 text-xs">
                                <span>채도: <span className="text-yellow-300">{(phenotype.colorSaturation * 100).toFixed(0)}</span></span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
