import React, { useState } from 'react';
import { Koi } from '../types';
import { X, DollarSign } from 'lucide-react';
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
    const stamina = Math.round(koi.stamina ?? 0);
    const spotCount = koi.genetics.spots.length;

    const handleSell = () => {
        if (!canSell) return;
        onSell(koi);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[1300] p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-xl p-5 w-full max-w-sm animate-fade-in-up relative max-h-[85svh] overflow-y-auto custom-scrollbar glass-panel">
                <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors" aria-label={`${koi.name} 상세 정보 닫기`}>
                    <X size={24} />
                </button>

                <div className="space-y-4">
                    <div className="text-center">
                        <h2 className="text-xl font-bold text-white leading-tight">
                            {koi.name}
                        </h2>
                        <div className="flex items-center justify-center gap-2 mt-2">
                            <span className="text-xs font-bold bg-yellow-500/15 text-yellow-300 border border-yellow-400/30 px-3 py-1 rounded-full whitespace-nowrap">
                                {koi.growthStage === 'fry' ? '치어' : koi.growthStage === 'juvenile' ? '준성체' : '성체'}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-white/15 bg-white/10 px-2 py-2.5 text-center">
                            <span className="block text-[10px] text-white/55">체력</span>
                            <strong className="block text-base text-yellow-300 mt-0.5">{stamina}</strong>
                        </div>
                        <div className="rounded-lg border border-white/15 bg-white/10 px-2 py-2.5 text-center">
                            <span className="block text-[10px] text-white/55">점</span>
                            <strong className="block text-base text-yellow-300 mt-0.5">{spotCount}개</strong>
                        </div>
                        <div className="rounded-lg border border-white/15 bg-white/10 px-2 py-2.5 text-center">
                            <span className="block text-[10px] text-white/55">판매가</span>
                            <strong className="block text-base text-yellow-300 mt-0.5">{sellValue}</strong>
                        </div>
                    </div>

                    <div className="bg-gray-900/50 p-3 rounded-xl border border-gray-700 glass-section">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-white/65 uppercase tracking-wider">유전 정보</h3>
                            <span className="text-[10px] text-white/40">기본 유전자</span>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-start">
                            {koi.genetics.baseColorGenes.map((gene, idx) => (
                                <span key={idx}
                                    className="text-xs px-2 py-1 rounded-full border border-white/20 bg-white/10 text-gray-100 flex items-center gap-1"
                                    title={gene}
                                >
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: GENE_COLOR_MAP[gene] }}></span>
                                    {gene}
                                </span>
                            ))}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-white/10 border border-white/10 p-2">
                                <span className="block text-[10px] text-white/50 mb-1">몸 색상</span>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-white/65">명도</span>
                                    <strong className="text-yellow-300">{koi.genetics.lightness ?? 50}</strong>
                                </div>
                                <div className="flex items-center justify-between text-xs mt-1">
                                    <span className="text-white/65">채도</span>
                                    <strong className="text-yellow-300">{koi.genetics.saturation ?? 50}</strong>
                                </div>
                            </div>
                            <div className="rounded-lg bg-white/10 border border-white/10 p-2">
                                <span className="block text-[10px] text-white/50 mb-1">무늬</span>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-white/65">점 개수</span>
                                    <strong className="text-yellow-300">{spotCount}개</strong>
                                </div>
                                <div className="flex items-center justify-between text-xs mt-1">
                                    <span className="text-white/65">점 채도</span>
                                    <strong className="text-yellow-300">{(displayPhenotype.colorSaturation * 100).toFixed(0)}</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white/10 p-2 rounded-xl border border-white/15 flex items-center justify-center overflow-hidden">
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
