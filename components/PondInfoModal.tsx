import React, { useState, useMemo } from 'react';
import { X, Palette, Sun, Sparkles, Dna, DollarSign, Search, Pencil, Check } from 'lucide-react';
import { Koi, Ponds, PondData, GeneType, GrowthStage, SpotPhenotype } from '../types';
import { calculateKoiValue, calculateRarityScore, GENE_COLOR_MAP, getPhenotype, GENE_RARITY, getDisplayColor, calculateSpotPhenotype } from '../utils/genetics';
import { KoiCSSPreview } from './KoiCSSPreview';

// Helper component for list items
const KoiListItem: React.FC<{
  koi: Koi;
  index: number;
  onViewDetail: () => void;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}> = ({ koi, index, onViewDetail, isSelected, onToggleSelect }) => {
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
      className={`flex items-center px-2 py-3 border-b border-white/15 cursor-pointer transition-colors ${isSelected
        ? 'bg-white/10'
        : 'hover:bg-white/5'
        }`}
    >
      <div className="relative mr-3">
        <KoiCSSPreview
          koi={koi}
          className="w-12 h-12 border-2 border-gray-500 shadow-sm"
        />
        {/* Checkbox overlay */}
        <div
          className={`absolute -top-1 -left-1 w-5 h-5 rounded border flex items-center justify-center transition-colors z-10 ${isSelected ? 'bg-yellow-500 border-yellow-400 text-white' : 'bg-gray-800 border-gray-500 text-transparent hover:border-gray-300'
            }`}
        >
          {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
        </div>
        {/* Magnifying glass button */}
        <button
          onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
          className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gray-700 border border-gray-500 flex items-center justify-center hover:bg-gray-600 transition-colors z-10"
          title="상세 보기"
          aria-label={`${koiLabel} 상세 보기`}
        >
          <Search size={10} className="text-gray-300" />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-200 truncate">{koi.name || `코이 #${index}`}</span>
            <span className="text-xs text-gray-500 font-mono">#{index}</span>
            <span className="text-xs bg-gray-800 px-1.5 py-0.5 rounded border border-gray-600 text-gray-400 whitespace-nowrap">
              {koi.growthStage === 'adult' ? '성체' : koi.growthStage === 'juvenile' ? '준성체' : '치어'}
            </span>
          </div>
          <span className="text-xs font-mono text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/30 whitespace-nowrap">
            {value} ZP
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
          <span>명도 <span className="text-gray-300">{Math.round(koi.genetics.lightness)}</span></span>
          <span>채도 <span className="text-gray-300">{Math.round(koi.genetics.saturation)}</span></span>
          <span>점 채도 <span className="text-gray-300">{(displayPhenotype.colorSaturation * 100).toFixed(0)}</span></span>
          <span className="text-yellow-300 font-bold">점 {koi.genetics.spots.length}개</span>
          <span className="text-yellow-300">{koi.genetics.baseColorGenes.join(' / ')}</span>
          <span className="text-yellow-400">체력 {Math.round(koi.stamina ?? 0)}</span>
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
  onKoiSelect: (koi: Koi) => void;

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
  onKoiSelect,
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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg w-full max-w-4xl h-[80svh] flex flex-col border border-gray-700 shadow-2xl glass-panel" onClick={e => e.stopPropagation()}>

        {/* Header - Title and Tabs */}
        <div className="p-3 border-b border-gray-700 bg-gray-900/40 rounded-t-lg glass-header">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-yellow-300">연못 현황</h2>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-full transition-all flex-shrink-0" aria-label="연못 현황 닫기">
              <X size={24} />
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {sortedPonds.map((pond) => (
              <button
                key={pond.id}
                onClick={() => onPondChange(pond.id)}
                aria-label={`${pond.name}으로 전환`}
                aria-current={activePondId === pond.id ? 'page' : undefined}
                className={`px-5 py-2 rounded-md font-bold transition-all whitespace-nowrap text-sm border ${activePondId === pond.id
                  ? 'bg-yellow-600 text-white border-yellow-500'
                  : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white hover:border-white/40'
                  }`}
              >
                {pond.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-3">

          {/* Compact count */}
          <div className="px-1 pb-2 mb-3 border-b border-white/10 flex-shrink-0">
            <span className="font-mono text-yellow-300 text-base">
              <strong>{koiList.length}</strong><span className="text-white/50"> / 30 마리</span>
            </span>
          </div>

          {/* Sort Controls */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto flex-shrink-0 no-scrollbar">
            <button
              onClick={() => {
                if (selectedKoiIds.size === koiList.length) {
                  setSelectedKoiIds(new Set());
                } else {
                  setSelectedKoiIds(new Set(koiList.map(k => k.id)));
                }
              }}
              className="px-2.5 py-1.5 rounded-md border text-sm font-bold transition-colors bg-yellow-500 border-yellow-400 text-gray-900 whitespace-nowrap"
              aria-label={selectedKoiIds.size === koiList.length ? '선택한 코이 전체 해제' : '코이 전체 선택'}
            >
              {selectedKoiIds.size === koiList.length ? '전체 해제' : '전체 선택'}
            </button>
            <button onClick={() => handleSort('spots_desc')} aria-label="점 개수 많은 순으로 정렬" aria-pressed={sortOption === 'spots_desc'} className={`px-2.5 py-1.5 rounded-md border text-sm font-bold transition-colors whitespace-nowrap ${sortOption === 'spots_desc' ? 'bg-yellow-500 border-yellow-400 text-gray-900' : 'bg-transparent border-white/15 text-white/65 hover:bg-white/10 hover:text-white'}`}>
              점 개수
            </button>
            <button onClick={() => handleSort('body_lightness_desc')} aria-label="몸 명도 높은 순으로 정렬" aria-pressed={sortOption === 'body_lightness_desc'} className={`px-2.5 py-1.5 rounded-md border text-sm font-bold transition-colors whitespace-nowrap ${sortOption === 'body_lightness_desc' ? 'bg-yellow-500 border-yellow-400 text-gray-900' : 'bg-transparent border-white/15 text-white/65 hover:bg-white/10 hover:text-white'}`}>
              몸 명도 순
            </button>
            <button onClick={() => handleSort('body_saturation_desc')} aria-label="몸 채도 높은 순으로 정렬" aria-pressed={sortOption === 'body_saturation_desc'} className={`px-2.5 py-1.5 rounded-md border text-sm font-bold transition-colors whitespace-nowrap ${sortOption === 'body_saturation_desc' ? 'bg-yellow-500 border-yellow-400 text-gray-900' : 'bg-transparent border-white/15 text-white/65 hover:bg-white/10 hover:text-white'}`}>
              몸 채도 순
            </button>
            <button onClick={() => handleSort('spot_saturation_desc')} aria-label="점 채도 높은 순으로 정렬" aria-pressed={sortOption === 'spot_saturation_desc'} className={`px-2.5 py-1.5 rounded-md border text-sm font-bold transition-colors whitespace-nowrap ${sortOption === 'spot_saturation_desc' ? 'bg-yellow-500 border-yellow-400 text-gray-900' : 'bg-transparent border-white/15 text-white/65 hover:bg-white/10 hover:text-white'}`}>
              점 채도 순
            </button>
          </div>

          {/* Koi List */}
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
            {sortedKoiList
              .map((koi, idx) => (
                <KoiListItem
                  key={koi.id}
                  koi={koi}
                  index={idx + 1}
                  onViewDetail={() => onKoiSelect(koi)}
                  isSelected={selectedKoiIds.has(koi.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            {sortedKoiList.length === 0 && (
              <div className="text-center text-gray-500 py-10">
                연못에 물고기가 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        {selectedKoiIds.size > 0 && (
          <div className="p-4 border-t border-gray-700 bg-gray-900/80 backdrop-blur-sm flex justify-end gap-3 rounded-b-lg flex-wrap glass-header">
            {/* Move Buttons - Show direct options if multiple ponds exist */}
            {sortedPonds.length > 1 && (
              <div className="flex items-center gap-1.5 mr-auto">
                <span className="text-xs text-gray-400 mr-1">이동</span>
                {sortedPonds.filter(p => p.id !== activePondId).map(targetPond => (
                  <button
                    key={targetPond.id}
                    onClick={() => onMove(koiList.filter(k => selectedKoiIds.has(k.id)), targetPond.id)}
                    className="text-white/65 hover:text-white text-xs px-2 py-1 transition-colors whitespace-nowrap"
                    aria-label={`선택한 코이 ${selectedKoiIds.size}마리를 ${targetPond.name}으로 이동`}
                  >
                    To {targetPond.name}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleBreedSelected}
              disabled={selectedKoiIds.size !== 2 || Array.from(selectedKoiIds).some(id => koiList.find(k => k.id === id)?.growthStage !== GrowthStage.ADULT)}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 text-sm whitespace-nowrap rounded-lg transition-all shadow-lg"
              aria-label={`선택한 코이 ${selectedKoiIds.size}마리 교배하기`}
            >
              <Dna size={16} />
              {selectedKoiIds.size}마리 교배
            </button>
            <button
              onClick={handleSellSelected}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 text-sm whitespace-nowrap rounded-lg transition-all shadow-lg"
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
