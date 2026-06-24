import React, { useState } from 'react';
import { Koi } from '../types';
import { X, DollarSign, Pencil, Check } from 'lucide-react';
import { calculateKoiValue, GENE_COLOR_MAP, calculateSpotPhenotype } from '../utils/genetics';
import { SingleKoiCanvas } from './SingleKoiCanvas';

interface KoiDetailModalProps {
    koi: Koi;
    onClose: () => void;
    onSell: (koi: Koi) => void;
    totalKoiCount: number;
    hideActions?: boolean;
}

export const KoiDetailModal: React.FC<KoiDetailModalProps> = ({ koi, onClose, onSell, totalKoiCount, hideActions }) => {
    const sellValue = calculateKoiValue(koi);
    const canSell = totalKoiCount > 2;
    // For display in the modal, we want the "intrinsic" genetics (before environmental/growth modifiers)
    const displayPhenotype = calculateSpotPhenotype(koi.genetics.spotPhenotypeGenes);
    const spotPhenotype = calculateSpotPhenotype(koi.genetics.spotPhenotypeGenes, koi);

    const albinoAlleles = koi.genetics.albinoAlleles || [false, false];
    const isAlbino = albinoAlleles[0] && albinoAlleles[1];

    const handleSell = () => {
        if (!canSell) return;
        onSell(koi);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[1300] p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-6 w-full max-w-sm animate-fade-in-up relative max-h-[85svh] overflow-y-auto custom-scrollbar">
                <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-white" aria-label={`${koi.name} 상세 정보 닫기`}>
                    <X size={24} />
                </button>

                <div className="space-y-4">
                    <div className="text-center">
                        <div className="flex flex-col items-center">
                            <h2
                                className="text-2xl font-bold text-white flex items-center justify-center gap-2 mb-1"
                            >
                                {koi.name}
                                {(koi.stamina ?? 100) <= 10 && (
                                    <span className="text-xs bg-red-900/50 text-red-400 border border-red-500/50 px-2 py-0.5 rounded-full animate-pulse font-normal whitespace-nowrap">
                                        병듦
                                    </span>
                                )}
                                {isAlbino && (
                                    <span className="text-xs bg-pink-500/20 text-pink-300 border border-pink-500/50 px-2 py-0.5 rounded-full font-normal whitespace-nowrap">
                                        알비노
                                    </span>
                                )}
                            </h2>
                        </div>
                        <span className="text-sm font-semibold bg-cyan-500/20 text-cyan-300 px-3 py-0.5 rounded-full whitespace-nowrap inline-block">
                            {koi.growthStage === 'fry' ? '치어' : koi.growthStage === 'juvenile' ? '준성체' : '성체'}
                        </span>
                        <p className="text-sm text-gray-400 mt-2 italic">"{koi.description}"</p>
                    </div>

                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                        <h3 className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">유전자 정보</h3>
                        <div className="flex flex-wrap gap-2 justify-center">
                            {koi.genetics.baseColorGenes.map((gene, idx) => (
                                <span key={idx}
                                    className="text-xs px-2 py-1 rounded-full border border-gray-600 bg-gray-800 text-gray-200 flex items-center gap-1"
                                    title={gene}
                                >
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: GENE_COLOR_MAP[gene] }}></span>
                                    {gene}
                                </span>
                            ))}
                            {(koi.genetics.albinoAlleles || []).map((isAc, geneIdx) => isAc && (
                                <span key={`albino-${geneIdx}`}
                                    className="text-xs px-2 py-1 rounded-full border border-pink-500/30 bg-pink-900/40 text-pink-200 flex items-center gap-1 font-bold"
                                    title="Albino Allele"
                                >
                                    알비노
                                </span>
                            ))}
                        </div>
                        <div className="mt-3 space-y-1">
                            <div className="flex items-center justify-between text-xs bg-gray-800/50 p-1.5 rounded">
                                <span className="text-gray-500 font-bold w-12 text-center border-r border-gray-700 mr-2">몸</span>
                                <div className="flex flex-1 justify-around">
                                    <span>명도: <span className="text-pink-300">{koi.genetics.lightness ?? 50}</span></span>
                                    <span>채도: <span className="text-blue-300">{koi.genetics.saturation ?? 50}</span></span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-xs bg-gray-800/50 p-1.5 rounded">
                                <span className="text-gray-500 font-bold w-12 text-center border-r border-gray-700 mr-2">무늬</span>
                                <div className="flex flex-1 justify-around">
                                    <span>점: <span className="text-cyan-300">{koi.genetics.spots.length}개</span></span>
                                    <span>채도: <span className="text-gray-300">{(displayPhenotype.colorSaturation * 100).toFixed(0)}</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-blue-900/30 p-2 rounded-lg border border-gray-700 flex items-center justify-center overflow-hidden">
                        <SingleKoiCanvas koi={koi} width={350} height={200} isStatic={true} />
                    </div>

                    {!hideActions && (
                        <div className="flex flex-col space-y-2">
                            <button
                                onClick={handleSell}
                                disabled={!canSell}
                                className={`flex items-center justify-center w-full font-bold py-3 px-4 rounded-lg transition-colors text-base whitespace-nowrap ${canSell
                                    ? 'bg-red-600/80 hover:bg-red-600 text-white'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                aria-label={`${koi.name} 판매하기, ${sellValue} 젠 포인트`}
                            >
                                <DollarSign className="mr-2 h-5 w-5" />
                                판매 ({sellValue} ZP)
                            </button>
                            {!canSell && (
                                <p className="text-red-400 text-xs text-center">연못에는 최소 두 마리의 코이가 있어야 합니다.</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
