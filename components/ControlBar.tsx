import React, { useState } from 'react';
import { Store, Fish, Palette, Trophy, Menu, Medal } from 'lucide-react';

interface IconProps {
  size?: number;
  className?: string;
}

const CornIcon = ({ size = 24, className = "" }: IconProps) => (
  <div
    className={`bg-current ${className}`}
    style={{
      width: size,
      height: size,
      maskImage: "url('/corn.png')",
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskImage: "url('/corn.png')",
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
    }}
  />
);

const FeedIcon = ({ size = 24, className = "" }: IconProps) => (
  <div
    className={`bg-current ${className}`}
    style={{
      width: size,
      height: size,
      maskImage: "url('/feed.png')",
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskImage: "url('/feed.png')",
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
    }}
  />
);


interface ControlBarProps {
  onShopClick: () => void;
  isFeedModeActive: boolean;
  onToggleFeedMode: () => void;
  foodCount: number;
  cornCount: number;
  selectedFoodType: 'normal' | 'corn';
  onSelectFoodType: (type: 'normal' | 'corn') => void;
  onPondInfoClick: () => void;
  onThemeClick: () => void;
  onRankingClick: () => void;
  onAchievementClick: () => void;
  hasUnclaimedAchievements: boolean;
}

// Updated getButtonClass: Removed scale, shadow-lg, and glow effects
const getButtonClass = (isActive: boolean) =>
  `p-3 sm:p-4 rounded-full border backdrop-blur-md transition-all duration-200 flex items-center justify-center relative ${isActive
    ? 'bg-orange-600 border-orange-400 text-white' // Active: distinct but flat
    : 'bg-white/10 border-white/20 text-white hover:bg-white/20' // Inactive: translucent HUD
  }`;

const getPopupButtonClass = (isActive = false) =>
  `p-3 sm:p-4 rounded-full transition-all duration-200 flex items-center justify-center relative ${isActive
    ? 'bg-orange-500/70 text-white'
    : 'text-white hover:bg-white/20'
  }`;

export const ControlBar: React.FC<ControlBarProps> = ({
  onShopClick,
  isFeedModeActive,
  onToggleFeedMode,
  foodCount,
  cornCount,
  selectedFoodType,
  onSelectFoodType,
  onPondInfoClick,
  onThemeClick,
  onRankingClick,
  onAchievementClick,
  hasUnclaimedAchievements,
}) => {
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const itemLabels = {
    normal: '기본 사료',
    corn: '프리미엄 옥수수',
  };
  const selectedItemLabel = itemLabels[selectedFoodType];
  const selectedItemCount = selectedFoodType === 'corn' ? cornCount : foodCount;

  const handleItemClick = (type: 'normal' | 'corn') => {
    if (!isFeedModeActive) {
      onToggleFeedMode();
    }
    onSelectFoodType(type);
    setIsInventoryOpen(false);
  };

  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);

  const handleMainMenuToggle = () => {
    setIsMainMenuOpen(!isMainMenuOpen);
    if (isInventoryOpen) setIsInventoryOpen(false);
  };

  const handleSubMenuClick = (action: () => void) => {
    action();
    setIsMainMenuOpen(false);
  };

  const handleInventoryClick = () => {
    setIsInventoryOpen(!isInventoryOpen);
    if (isMainMenuOpen) setIsMainMenuOpen(false);
  };

  return (
    <div className="absolute bottom-[calc(3rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
      {/* Main Menu Popup (Centered on Screen) */}
      {isMainMenuOpen && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex flex-row gap-1 bg-white/10 p-2 rounded-[9999px] border border-white/20 backdrop-blur-md whitespace-nowrap shadow-lg">
          <button onClick={() => handleSubMenuClick(onShopClick)} className={getPopupButtonClass()} aria-label="상점 열기">
            <Store size={24} className="sm:w-[26px] sm:h-[26px]" />
          </button>
          <button onClick={() => handleSubMenuClick(onRankingClick)} className={getPopupButtonClass()} aria-label="랭킹 열기">
            <Trophy size={24} className="sm:w-[26px] sm:h-[26px]" />
          </button>
          <button onClick={() => handleSubMenuClick(onAchievementClick)} className={getPopupButtonClass()} aria-label={hasUnclaimedAchievements ? '업적 열기, 받을 보상 있음' : '업적 열기'}>
            <div className="relative">
              <Medal size={24} className="sm:w-[26px] sm:h-[26px]" />
              {hasUnclaimedAchievements && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white/30 animate-pulse" />
              )}
            </div>
          </button>
          <button onClick={() => handleSubMenuClick(onThemeClick)} className={getPopupButtonClass()} aria-label="테마 선택 열기">
            <Palette size={24} className="sm:w-[26px] sm:h-[26px]" />
          </button>
        </div>
      )}

      {/* Main Menu Button (Left) */}
      <div className="relative">
        <button
          onClick={handleMainMenuToggle}
          className={getButtonClass(isMainMenuOpen)}
          aria-label={isMainMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={isMainMenuOpen}
          aria-haspopup="menu"
        >
          <Menu size={24} className="sm:w-[26px] sm:h-[26px]" strokeWidth={2} />
          {hasUnclaimedAchievements && !isMainMenuOpen && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
      </div>
      {/* Inventory System (Middle) */}
      <div className="relative">
        {isInventoryOpen && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex flex-row gap-1 bg-white/10 p-2 rounded-[9999px] border border-white/20 backdrop-blur-md whitespace-nowrap shadow-lg">
            <button
              onClick={() => handleItemClick('normal')}
              className={getPopupButtonClass(isFeedModeActive && selectedFoodType === 'normal')}
              aria-label={`기본 사료 선택, 보유 ${foodCount}개`}
              aria-pressed={isFeedModeActive && selectedFoodType === 'normal'}
            >
              <FeedIcon size={24} className="sm:w-[26px] sm:h-[26px]" />
              <span className="absolute -top-1 -right-1 bg-gray-900 text-orange-300 border border-white/40 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-sm">{foodCount}</span>
            </button>
            <button
              onClick={() => handleItemClick('corn')}
              className={getPopupButtonClass(isFeedModeActive && selectedFoodType === 'corn')}
              aria-label={`프리미엄 옥수수 선택, 보유 ${cornCount}개`}
              aria-pressed={isFeedModeActive && selectedFoodType === 'corn'}
            >
              <CornIcon size={24} className="sm:w-[26px] sm:h-[26px]" />
              <span className="absolute -top-1 -right-1 bg-gray-900 text-orange-300 border border-white/40 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-sm">{cornCount}</span>
            </button>
          </div>
        )}
        <button
          onClick={handleInventoryClick}
          className={getButtonClass(isInventoryOpen || isFeedModeActive)}
          aria-label={isInventoryOpen ? '먹이와 아이템 선택 닫기' : `${selectedItemLabel} 메뉴 열기, 보유 ${selectedItemCount}개`}
          aria-expanded={isInventoryOpen}
          aria-haspopup="menu"
        >
          {selectedFoodType === 'corn' ? <CornIcon size={24} /> : <FeedIcon size={24} />}
          <span className="absolute -top-1 -right-1 bg-gray-900 text-orange-300 border border-white/40 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-sm">
            {selectedItemCount}
          </span>
        </button>
      </div>

      <button onClick={onPondInfoClick} className={getButtonClass(false)} aria-label="연못 현황 열기">
        <Fish size={24} className="sm:w-[26px] sm:h-[26px]" strokeWidth={2} />
      </button>

      {/* Image Preloader to prevent flicker/delay on first menu open */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
        <img src="/feed.png" alt="preload" />
        <img src="/corn.png" alt="preload" />
      </div>
    </div>
  );
};
