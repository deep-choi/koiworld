import React, { useState, useMemo } from 'react';
import { X, Palette, Sun, Sparkles, Dna, DollarSign, Pencil, Check } from 'lucide-react';
import { Koi, Ponds, PondData, GeneType, GrowthStage, SpotPhenotype } from '../types';
import { calculateKoiValue, calculateRarityScore, GENE_COLOR_MAP, getPhenotype, GENE_RARITY, getDisplayColor, calculateSpotPhenotype } from '../utils/genetics';
import { KoiCSSPreview } from './KoiCSSPreview';

// Helper component for list items
const KoiListItem: React.FC<{
  koi: Koi;
  index: number;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}> = ({ koi, index, isSelected, onToggleSelect }) => {
  const phenotype = getPhenotype(koi.genetics.baseColorGenes);
  const bodyColor = getDisplayColor(phenotype as any, koi.genetics.lightness, koi.genetics.saturation);
  // For display in the list, we want the "intrinsic" genetics (before environmental/growth modifiers)
  const displayPhenotype = calculateSpotPhenotype(koi.genetics.spotPhenotypeGenes);
  const spotPhenotype = calculateSpotPhenotype(koi.genetics.spotPhenotypeGenes, koi);

  const rarityScore = calculateRarityScore(koi);
  const value = calculateKoiValue(koi);
  const koiLabel = koi.name || `코이 #${index}`;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleSelect(koi.id);
    }
  };

  return (
    <div
      onClick={() => onToggleSelect(koi.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${koiLabel} 선택${isSelected ? ' 해제' : ''}`}
      className={`flex items-center px-1 py-4 border-b border-slate-200 cursor-pointer transition-colors ${isSelected
        ? 'bg-orange-50/70'
        : 'hover:bg-slate-50'
        }`}
    >
      <div className="relative mr-3">
        <KoiCSSPreview
          koi={koi}
          className="w-14 h-14"
        />
        {/* Checkbox overlay */}
        <div
          className={`absolute -top-1 -left-1 w-5 h-5 rounded-full border flex items-center justify-center transition-colors z-10 ${isSelected ? 'bg-[#f97316] border-[#f97316] text-white' : 'bg-white border-slate-300 text-transparent hover:border-slate-400'
            }`}
        >
          {isSelected && <Check size={12} />}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 truncate">{koi.name || `코이 #${index}`}</span>
            <span className="text-xs text-slate-400 font-mono">#{index}</span>
            <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 whitespace-nowrap">
              {koi.growthStage === 'adult' ? '성체' : koi.growthStage === 'juvenile' ? '준성체' : '치어'}
            </span>
          </div>
          <span className="text-sm font-medium text-orange-600 bg-orange-50 px-2 py-1 rounded-md whitespace-nowrap">
            {value} ZP
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-x-2">
            <span>점 <span className="text-slate-700">{koi.genetics.spots.length}개</span></span>
            <span>점 채도 <span className="text-slate-700">{(displayPhenotype.colorSaturation * 100).toFixed(0)}</span></span>
            <span>명도 <span className="text-slate-700">{Math.round(koi.genetics.lightness)}</span></span>
            <span>채도 <span className="text-slate-700">{Math.round(koi.genetics.saturation)}</span></span>
          </span>
          <span className="koi-meta-secondary inline-flex items-center gap-x-2 text-slate-600">
            <span>{koi.genetics.baseColorGenes.join('/')}</span>
            <span>체력 {Math.round(koi.stamina ?? 0)}</span>
          </span>
        </div>
      </div>

    </div>
  );
};

interface PondInfoModalProps {
  onClose: () => void;
  ponds: Ponds;
  activePondId: string;
  onPondChange: (pondId: string) => void;
  koiList: Koi[];

  onSell: (kois: Koi[]) => void;
  onBreed: (kois: Koi[]) => void;
  onMove: (kois: Koi[], targetPondId: string) => void;
}

type SortOption = 'default' | 'spots_desc' | 'body_lightness_desc' | 'body_saturation_desc' | 'spot_saturation_desc';

export const PondInfoModal: React.FC<PondInfoModalProps> = ({
  onClose,
  ponds,
  activePondId,
  onPondChange,
  koiList,
  onSell,
  onBreed,
  onMove
}) => {
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const [selectedKoiIds, setSelectedKoiIds] = useState<Set<string>>(new Set());

  const sortedPonds = useMemo(() => {
    return Object.values(ponds).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [ponds]);

  const handleSort = (option: SortOption) => {
    setSortOption(option);
  };

  const sortedKoiList = useMemo(() => {
    const sorted = [...koiList];
    switch (sortOption) {
      case 'spots_desc':
        return sorted.sort((a, b) => b.genetics.spots.length - a.genetics.spots.length);
      case 'body_lightness_desc':
        return sorted.sort((a, b) => b.genetics.lightness - a.genetics.lightness);
      case 'body_saturation_desc':
        return sorted.sort((a, b) => b.genetics.saturation - a.genetics.saturation);
      case 'spot_saturation_desc':
        return sorted.sort((a, b) => {
          const phenoA = calculateSpotPhenotype(a.genetics.spotPhenotypeGenes, a);
          const phenoB = calculateSpotPhenotype(b.genetics.spotPhenotypeGenes, b);
          return phenoB.colorSaturation - phenoA.colorSaturation;
        });
      default:
        return sorted;
    }
  }, [koiList, sortOption]);

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedKoiIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedKoiIds(newSelected);
  };

  const handleSellSelected = () => {
    const selectedKois = koiList.filter(k => selectedKoiIds.has(k.id));

    // Restriction: Must leave at least 2 koi
    if (koiList.length - selectedKois.length < 2) {
      alert("연못에는 최소 두 마리의 코이가 있어야 합니다!");
      return;
    }

    onSell(selectedKois);
    setSelectedKoiIds(new Set());
  };

  const handleBreedSelected = () => {
    const selectedKois = koiList.filter(k => selectedKoiIds.has(k.id));
    if (selectedKois.length === 2) {
      onBreed(selectedKois);
      setSelectedKoiIds(new Set());
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="light-modal bg-white rounded-2xl w-full max-w-3xl h-[80svh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header - Title and Tabs */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-100">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-xl font-medium text-slate-900">연못 현황</h2>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors flex items-center justify-center flex-shrink-0" aria-label="연못 현황 닫기">
              <X size={20} />
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {sortedPonds.map((pond) => (
              <button
                key={pond.id}
                onClick={() => onPondChange(pond.id)}
                aria-label={`${pond.name}으로 전환`}
                aria-current={activePondId === pond.id ? 'page' : undefined}
                className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-sm ${activePondId === pond.id
                  ? 'bg-[#f97316] text-white'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
              >
                {pond.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-5 pt-4 pb-2">

          {/* Compact count */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
            <span className="text-base text-slate-500">
              <strong className="font-medium text-slate-900">{koiList.length}</strong><span> / 30 마리</span>
            </span>
            <span className="text-xs text-slate-400">코이를 선택해 관리하세요</span>
          </div>

          {/* Sort Controls */}
          <div className="flex gap-2 mb-3 overflow-x-auto flex-shrink-0 no-scrollbar">
            <button
              onClick={() => {
                if (selectedKoiIds.size === koiList.length) {
                  setSelectedKoiIds(new Set());
                } else {
                  setSelectedKoiIds(new Set(koiList.map(k => k.id)));
                }
              }}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-[#f97316] text-white whitespace-nowrap"
              aria-label={selectedKoiIds.size === koiList.length ? '선택한 코이 전체 해제' : '코이 전체 선택'}
            >
              {selectedKoiIds.size === koiList.length ? '전체 해제' : '전체 선택'}
            </button>
            <button onClick={() => handleSort('spots_desc')} aria-label="점 개수 많은 순으로 정렬" aria-pressed={sortOption === 'spots_desc'} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${sortOption === 'spots_desc' ? 'bg-orange-50 text-slate-900' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
              점 개수
            </button>
            <button onClick={() => handleSort('body_lightness_desc')} aria-label="몸 명도 높은 순으로 정렬" aria-pressed={sortOption === 'body_lightness_desc'} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${sortOption === 'body_lightness_desc' ? 'bg-orange-50 text-slate-900' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
              몸 명도 순
            </button>
            <button onClick={() => handleSort('body_saturation_desc')} aria-label="몸 채도 높은 순으로 정렬" aria-pressed={sortOption === 'body_saturation_desc'} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${sortOption === 'body_saturation_desc' ? 'bg-orange-50 text-slate-900' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
              몸 채도 순
            </button>
            <button onClick={() => handleSort('spot_saturation_desc')} aria-label="점 채도 높은 순으로 정렬" aria-pressed={sortOption === 'spot_saturation_desc'} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${sortOption === 'spot_saturation_desc' ? 'bg-orange-50 text-slate-900' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
              점 채도 순
            </button>
          </div>

          {/* Koi List */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 light-scrollbar">
            {sortedKoiList
              .map((koi, idx) => (
                <KoiListItem
                  key={koi.id}
                  koi={koi}
                  index={idx + 1}
                  isSelected={selectedKoiIds.has(koi.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            {sortedKoiList.length === 0 && (
              <div className="text-center text-slate-400 py-10">
                연못에 물고기가 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        {selectedKoiIds.size > 0 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 flex-wrap">
            {/* Move Buttons - Show direct options if multiple ponds exist */}
            {sortedPonds.length > 1 && (
              <div className="flex items-center gap-1.5 mr-auto">
                <span className="text-xs text-slate-500 mr-1">이동</span>
                {sortedPonds.filter(p => p.id !== activePondId).map(targetPond => (
                  <button
                    key={targetPond.id}
                    onClick={() => onMove(koiList.filter(k => selectedKoiIds.has(k.id)), targetPond.id)}
                    className="text-slate-500 hover:text-slate-900 text-xs px-2 py-1 transition-colors whitespace-nowrap"
                    aria-label={`선택한 코이 ${selectedKoiIds.size}마리를 ${targetPond.name}으로 이동`}
                  >
                    → {targetPond.name}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleBreedSelected}
              disabled={selectedKoiIds.size !== 2 || Array.from(selectedKoiIds).some(id => koiList.find(k => k.id === id)?.growthStage !== GrowthStage.ADULT)}
              className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium py-2 px-4 text-sm whitespace-nowrap rounded-lg transition-colors"
              aria-label={`선택한 코이 ${selectedKoiIds.size}마리 교배하기`}
            >
              <Dna size={16} />
              {selectedKoiIds.size}마리 교배
            </button>
            <button
              onClick={handleSellSelected}
              className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white font-medium py-2 px-4 text-sm whitespace-nowrap rounded-lg transition-colors"
              aria-label={`선택한 코이 ${selectedKoiIds.size}마리 판매하기`}
            >
              <DollarSign size={16} />
              {selectedKoiIds.size}마리 판매
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
