import React, { useState, useMemo } from 'react';
import { X, Palette, Sun, Sparkles, Dna, DollarSign, Pencil, Check, ArrowRightLeft, ChevronRight } from 'lucide-react';
import { Koi, Ponds, PondData, GeneType, GrowthStage, SpotPhenotype } from '../types';
import { calculateKoiValue, getGenotypeBadges, getKoiDisplayName } from '../utils/genetics';
import { KoiCSSPreview } from './KoiCSSPreview';

// Helper component for list items
const KoiListItem: React.FC<{
  koi: Koi;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}> = ({ koi, isSelected, onToggleSelect }) => {
  // 따로 지은 이름이 없으면 몸에 드러난 유전자로 지은 이름(예: 은빛 순백잉어)을 보여줍니다.
  const koiLabel = getKoiDisplayName(koi);
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
        {/* 첫 줄: 이름과 성장 단계. 가격은 코이를 고르면 하단에 합계로 보여줍니다. */}
        <div className="flex items-center gap-2 min-w-0 mb-1">
          <span className="font-medium text-slate-900 truncate">{koiLabel}</span>
          <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 whitespace-nowrap">
            {koi.growthStage === 'adult' ? '성체' : koi.growthStage === 'juvenile' ? '준성체' : '치어'}
          </span>
        </div>
        {/* 둘째 줄: 점·명도·채도·체력 */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span>점 <span className="text-slate-700">{koi.genetics.spots.length}개</span></span>
          <span>명도 <span className="text-slate-700">{Math.round(koi.genetics.lightness)}</span></span>
          <span>채도 <span className="text-slate-700">{Math.round(koi.genetics.saturation)}</span></span>
          <span>체력 <span className="text-slate-700">{Math.round(koi.stamina ?? 0)}</span></span>
        </div>
        {/* 유전자 한 쌍과 발현 가능한 단일 형질은 주황색, 한 개만 가진 열성 인자는 회색입니다.
            각 라벨은 한 덩어리로 유지하고, 좁은 화면에서는 라벨 사이에서 줄을 바꿉니다. */}
        <div className="mt-2 flex flex-wrap gap-1 text-[11px] leading-4">
          {getGenotypeBadges(koi.genetics).map((badge, index) => (
            <span
              key={`${badge.label}-${index}`}
              title={badge.kind === 'carrier' ? `${badge.label}: 열성 인자 1개 보유` : badge.kind === 'paired' ? `${badge.label}: 유전자 한 쌍` : `${badge.label}: 유전자 1개로 발현 가능`}
              aria-label={badge.kind === 'carrier' ? `${badge.label} 보인자` : badge.label}
              className={`rounded px-1.5 py-0.5 font-medium whitespace-nowrap ${badge.kind === 'carrier'
                ? 'bg-slate-100 text-slate-500'
                : 'bg-orange-100 text-orange-700'}`}
            >
              {badge.label}
            </span>
          ))}
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
  // 연못 화면에서 고른 코이와 같은 선택을 씁니다. 연못에서 누른 물고기는 여기서도 체크돼 있고,
  // 여기서 고른 코이는 창을 닫아도 연못에서 선택된 채로 남습니다.
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

// 한 연못에 들어갈 수 있는 최대 코이 수 (useKoiPond의 moveKoi 검사와 같은 값)
const POND_CAPACITY = 30;

// 점 채도는 게임 안에서는 그대로 쓰이지만, 너무 세밀한 값이라 라인브리딩 대상이 되지 않도록 화면에 보여주지도, 정렬하지도 않습니다.
type SortOption = 'default' | 'spots_desc' | 'body_lightness_desc' | 'body_saturation_desc';

const SORT_CHIPS: { option: SortOption, label: string, ariaLabel: string }[] = [
  { option: 'spots_desc', label: '점 개수', ariaLabel: '점 개수 많은 순으로 정렬' },
  { option: 'body_lightness_desc', label: '몸 명도 순', ariaLabel: '몸 명도 높은 순으로 정렬' },
  { option: 'body_saturation_desc', label: '몸 채도 순', ariaLabel: '몸 채도 높은 순으로 정렬' },
];

// 하단 이동·교배·판매 버튼의 공통 모양. 높이와 테두리 두께가 같아야 세 버튼이 같은 크기로 보입니다.
const ACTION_BUTTON = 'flex-1 sm:flex-none sm:min-w-[6.5rem] h-10 px-4 flex items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors';

// Select-all and sort chips: filled orange while in effect, grey otherwise.
const chipClass = (active: boolean) => `px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${active
  ? 'bg-[#f97316] text-white'
  : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`;

export const PondInfoModal: React.FC<PondInfoModalProps> = ({
  onClose,
  ponds,
  activePondId,
  onPondChange,
  koiList,
  onSell,
  onBreed,
  onMove,
  selectedIds,
  onSelectionChange,
}) => {
  const [sortOption, setSortOption] = useState<SortOption>('default');
  // 지금 연못에 있는 코이만 선택으로 칩니다. (다른 연못에서 고른 ID가 남아 있어도 무시)
  const selectedKoiIds = useMemo(
    () => new Set(selectedIds.filter(id => koiList.some(k => k.id === id))),
    [selectedIds, koiList]
  );
  const setSelectedKoiIds = (ids: Set<string>) => onSelectionChange(Array.from(ids));
  // 하단 바에서 '이동'을 눌렀을 때 옮길 연못을 고르는 패널을 보여줄지 여부
  const [isMovePickerOpen, setIsMovePickerOpen] = useState(false);
  const allSelected = koiList.length > 0 && selectedKoiIds.size === koiList.length;

  const sortedPonds = useMemo(() => {
    return Object.values(ponds).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [ponds]);

  // 연못 탭을 바꾸면 이전 연못에서 고른 코이 선택은 의미가 없으므로 함께 초기화합니다.
  const handlePondChange = (pondId: string) => {
    setSelectedKoiIds(new Set());
    setIsMovePickerOpen(false);
    onPondChange(pondId);
  };

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
    // 선택을 모두 해제하면 이동 패널도 닫습니다.
    if (newSelected.size === 0) setIsMovePickerOpen(false);
  };

  const handleMoveTo = (targetPondId: string) => {
    onMove(koiList.filter(k => selectedKoiIds.has(k.id)), targetPondId);
    setSelectedKoiIds(new Set());
    setIsMovePickerOpen(false);
  };

  // 고른 코이를 팔면 받을 ZP 합계 (App의 판매 처리와 같은 calculateKoiValue 기준)
  const selectedSellValue = useMemo(
    () => koiList.filter(k => selectedKoiIds.has(k.id)).reduce((sum, k) => sum + calculateKoiValue(k), 0),
    [koiList, selectedKoiIds]
  );

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
      <div className="light-modal bg-white rounded-2xl w-full max-w-3xl h-[88svh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

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
                onClick={() => handlePondChange(pond.id)}
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
              <strong className="font-medium text-slate-900">{koiList.length}</strong><span> / {POND_CAPACITY} 마리</span>
            </span>
            <span className="text-xs text-slate-400">코이를 선택해 관리하세요</span>
          </div>

          {/* Sort Controls: the chip that is in effect is filled orange */}
          <div className="flex gap-2 mb-3 overflow-x-auto flex-shrink-0 no-scrollbar">
            <button
              onClick={() => {
                setSelectedKoiIds(allSelected ? new Set() : new Set(koiList.map(k => k.id)));
                if (allSelected) setIsMovePickerOpen(false);
              }}
              aria-pressed={allSelected}
              className={chipClass(allSelected)}
              aria-label={allSelected ? '선택한 코이 전체 해제' : '코이 전체 선택'}
            >
              {allSelected ? '전체 해제' : '전체 선택'}
            </button>
            {SORT_CHIPS.map(chip => (
              <button key={chip.option} onClick={() => handleSort(chip.option)} aria-label={chip.ariaLabel}
                aria-pressed={sortOption === chip.option} className={chipClass(sortOption === chip.option)}>
                {chip.label}
              </button>
            ))}
          </div>

          {/* Koi List */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 light-scrollbar">
            {sortedKoiList
              .map(koi => (
                <KoiListItem
                  key={koi.id}
                  koi={koi}
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
          <div className="p-4 border-t border-slate-100 bg-slate-50">
            {isMovePickerOpen ? (
              // 이동할 연못 고르기: 연못마다 카드 한 장. 찬 정도를 막대로 보여주고, 자리가 부족하면 비활성화합니다.
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-sm text-slate-600">
                    <strong className="font-medium text-slate-900">{selectedKoiIds.size}마리</strong>를 어느 연못으로 옮길까요?
                  </p>
                  <button
                    onClick={() => setIsMovePickerOpen(false)}
                    className="text-sm text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
                  >
                    취소
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {sortedPonds.filter(p => p.id !== activePondId).map(targetPond => {
                    const count = targetPond.kois.length;
                    const hasRoom = count + selectedKoiIds.size <= POND_CAPACITY;
                    return (
                      <button
                        key={targetPond.id}
                        onClick={() => handleMoveTo(targetPond.id)}
                        disabled={!hasRoom}
                        className="group rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:border-orange-400 hover:bg-orange-50/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white"
                        aria-label={hasRoom
                          ? `선택한 코이 ${selectedKoiIds.size}마리를 ${targetPond.name}에 옮기기 (현재 ${count}마리)`
                          : `${targetPond.name}은 자리가 부족해 옮길 수 없음 (현재 ${count}마리)`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900 truncate">{targetPond.name}</span>
                          <ChevronRight size={16} className="flex-shrink-0 text-slate-300 group-enabled:group-hover:text-orange-500 transition-colors" />
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${hasRoom ? 'bg-orange-400' : 'bg-rose-400'}`}
                            style={{ width: `${Math.min(100, (count / POND_CAPACITY) * 100)}%` }}
                          />
                        </div>
                        <div className={`mt-1.5 text-xs ${hasRoom ? 'text-slate-500' : 'text-rose-500'}`}>
                          {hasRoom ? `${count} / ${POND_CAPACITY}마리` : `자리 부족 · ${count} / ${POND_CAPACITY}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* 윗줄: 고른 마릿수와 판매가 합계. 금액이 버튼 안에 있으면 자릿수에 따라 버튼 폭이 달라져서 여기에 둡니다. */}
                <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
                  <span><strong className="font-medium text-slate-900">{selectedKoiIds.size}마리</strong> 선택됨</span>
                  <span className="whitespace-nowrap">판매가 <strong className="font-medium text-orange-600">{selectedSellValue.toLocaleString()} ZP</strong></span>
                </div>
                {/* 아랫줄: 버튼은 모두 같은 높이(40px)와 테두리 두께를 써서 크기가 똑같이 보입니다. */}
                <div className="flex gap-2 sm:justify-end">
                  {/* 연못이 2개 이상일 때만 이동 버튼을 보여줍니다. */}
                  {sortedPonds.length > 1 && (
                    <button
                      onClick={() => setIsMovePickerOpen(true)}
                      className={`${ACTION_BUTTON} bg-white border-slate-300 hover:border-slate-400 hover:bg-slate-100 text-slate-700`}
                      aria-label={`선택한 코이 ${selectedKoiIds.size}마리를 다른 연못으로 옮기기`}
                    >
                      <ArrowRightLeft size={16} />
                      이동
                    </button>
                  )}
                  <button
                    onClick={handleBreedSelected}
                    disabled={selectedKoiIds.size !== 2 || Array.from(selectedKoiIds).some(id => koiList.find(k => k.id === id)?.growthStage !== GrowthStage.ADULT)}
                    className={`${ACTION_BUTTON} border-transparent bg-[#f97316] hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white`}
                    aria-label={`선택한 코이 ${selectedKoiIds.size}마리 교배하기`}
                  >
                    <Dna size={16} />
                    교배
                  </button>
                  <button
                    onClick={handleSellSelected}
                    className={`${ACTION_BUTTON} border-transparent bg-rose-500 hover:bg-rose-600 text-white`}
                    aria-label={`선택한 코이 ${selectedKoiIds.size}마리를 ${selectedSellValue.toLocaleString()} ZP에 판매하기`}
                  >
                    <DollarSign size={16} />
                    판매
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
