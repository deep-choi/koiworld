import React, { useState } from 'react';
import { Koi, PondTheme } from '../types';
import { X, DollarSign } from 'lucide-react';
import { calculateKoiValue, GENE_COLOR_MAP, calculateSpotPhenotype } from '../utils/genetics';
import { SingleKoiCanvas } from './SingleKoiCanvas';

interface KoiDetailModalProps {
    koi: Koi;
    onClose: () => void;
    onSell: (koi: Koi) => void;
    totalKoiCount: number;
    theme: PondTheme;
    hideActions?: boolean;
}

const getThemeBackground = (theme: PondTheme) => {
    switch (theme) {
        case PondTheme.MUD:
            return 'radial-gradient(circle at center, rgba(126, 95, 55, 1), rgba(66, 45, 20, 1))';
        case PondTheme.MOSS:
            return 'radial-gradient(circle at center, rgba(95, 168, 121, 1), rgba(27, 73, 48, 1))';
        case PondTheme.NIGHT:
            return 'radial-gradient(circle at center, rgba(30, 41, 59, 1), rgba(14, 13, 26, 1))';
        case PondTheme.DEFAULT:
        default:
            return 'radial-gradient(circle at center, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.18)), radial-gradient(circle at center, rgba(107, 151, 216, 1), rgba(32, 84, 148, 1))';
    }
};

export const KoiDetailModal: React.FC<KoiDetailModalProps> = ({ koi, onClose, onSell, totalKoiCount, theme, hideActions }) => {
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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1300] p-4">
            <div className="border border-white/40 rounded-2xl shadow-2xl p-5 w-full max-w-sm animate-fade-in-up relative max-h-[85svh] overflow-y-auto light-scrollbar" style={{ background: getThemeBackground(theme) }}>
                <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full text-white/75 hover:text-white hover:bg-white/15 transition-colors" aria-label={`${koi.name} 상세 정보 닫기`}>
                    <X size={24} />
                </button>

                <div className="space-y-4">
                    <div className="text-center">
                        <h2 className="text-xl font-bold text-white leading-tight">
                            {koi.name}
                        </h2>
                        <div className="flex items-center justify-center gap-2 mt-2">
                            <span className="text-xs font-bold bg-white/90 text-orange-700 border border-white px-3 py-1 rounded-full whitespace-nowrap">
                                {koi.growthStage === 'fry' ? '치어' : koi.growthStage === 'juvenile' ? '준성체' : '성체'}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2.5 text-center">
                            <span className="block text-[10px] text-slate-400">체력</span>
                            <strong className="block text-base text-orange-600 mt-0.5">{stamina}</strong>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2.5 text-center">
                            <span className="block text-[10px] text-slate-400">점</span>
                            <strong className="block text-base text-orange-600 mt-0.5">{spotCount}개</strong>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2.5 text-center">
                            <span className="block text-[10px] text-slate-400">판매가</span>
                            <strong className="block text-base text-orange-600 mt-0.5">{sellValue}</strong>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">유전 정보</h3>
                            <span className="text-[10px] text-slate-400">기본 유전자</span>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-start">
                            {koi.genetics.baseColorGenes.map((gene, idx) => (
                                <span key={idx}
                                    className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-white text-slate-700 flex items-center gap-1"
                                    title={gene}
                                >
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: GENE_COLOR_MAP[gene] }}></span>
                                    {gene}
                                </span>
                            ))}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-white border border-slate-200 p-2">
                                <span className="block text-[10px] text-slate-400 mb-1">몸 색상</span>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-500">명도</span>
                                    <strong className="text-orange-600">{koi.genetics.lightness ?? 50}</strong>
                                </div>
                                <div className="flex items-center justify-between text-xs mt-1">
                                    <span className="text-slate-500">채도</span>
                                    <strong className="text-orange-600">{koi.genetics.saturation ?? 50}</strong>
                                </div>
                            </div>
                            <div className="rounded-lg bg-white border border-slate-200 p-2">
                                <span className="block text-[10px] text-slate-400 mb-1">무늬</span>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-500">점 개수</span>
                                    <strong className="text-orange-600">{spotCount}개</strong>
                                </div>
                                <div className="flex items-center justify-between text-xs mt-1">
                                    <span className="text-slate-500">점 채도</span>
                                    <strong className="text-orange-600">{(displayPhenotype.colorSaturation * 100).toFixed(0)}</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-2 rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden">
                        <SingleKoiCanvas koi={koi} width={350} height={200} isStatic={true} />
                    </div>

                    {!hideActions && (
                        <div className="flex flex-col space-y-2">
                            <button
                                onClick={handleSell}
                                disabled={!canSell}
                                className={`flex items-center justify-center w-full font-bold py-3 px-4 rounded-lg transition-colors text-base whitespace-nowrap ${canSell
                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                                aria-label={`${koi.name} 판매하기, ${sellValue} 젠 포인트`}
                            >
                                <DollarSign className="mr-2 h-5 w-5" />
                                판매 ({sellValue} ZP)
                            </button>
                            {!canSell && (
                                <p className="text-red-500 text-xs text-center">연못에는 최소 두 마리의 코이가 있어야 합니다.</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
