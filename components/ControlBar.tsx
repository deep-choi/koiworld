import React, { useState } from 'react';
import { Store, Fish, Pill, Palette, Trophy, Menu, Medal } from 'lucide-react';

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
  medicineCount: number;
  selectedFoodType: 'normal' | 'corn' | 'medicine';
  onSelectFoodType: (type: 'normal' | 'corn' | 'medicine') => void;
  onPondInfoClick: () => void;
  onThemeClick: () => void;
  onRankingClick: () => void;
  onAchievementClick: () => void;
  hasUnclaimedAchievements: boolean;
}

// Updated getButtonClass: Removed scale, shadow-lg, and glow effects
const getButtonClass = (isActive: boolean) =>
  `p-3 sm:p-4 rounded-full border transition-all duration-200 flex items-center justify-center relative ${isActive
    ? 'bg-yellow-600 border-yellow-400 text-white' // Active: distinct but flat
    : 'bg-gray-900/60 border-white/10 text-white hover:bg-gray-800' // Inactive: minimal
  }`;

export const ControlBar: React.FC<ControlBarProps> = ({
  onShopClick,
  isFeedModeActive,
  onToggleFeedMode,
  foodCount,
  cornCount,
  medicineCount,
  selectedFoodType,
  onSelectFoodType,
  onPondInfoClick,
  onThemeClick,
  onRankingClick,
  onAchievementClick,
  hasUnclaimedAchievements,
}) => {
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);

  const handleItemClick = (type: 'normal' | 'corn' | 'medicine') => {
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
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex flex-row gap-2 bg-black/60 p-2 rounded-2xl border border-gray-700 backdrop-blur-md whitespace-nowrap">
          <button onClick={() => handleSubMenuClick(onShopClick)} className={getButtonClass(false)} aria-label="Shop">
            <Store size={24} />
          </button>
          <button onClick={() => handleSubMenuClick(onRankingClick)} className={getButtonClass(false)} aria-label="Ranking">
            <Trophy size={24} />
          </button>
          <button onClick={() => handleSubMenuClick(onAchievementClick)} className={getButtonClass(false)} aria-label="Achievements">
            <div className="relative">
              <Medal size={24} />
              {hasUnclaimedAchievements && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-gray-900 animate-pulse" />
              )}
            </div>
          </button>
          <button onClick={() => handleSubMenuClick(onThemeClick)} className={getButtonClass(false)} aria-label="Themes">
            <Palette size={24} />
          </button>
        </div>
      )}

      {/* Main Menu Button (Left) */}
      <div className="relative">
        <button onClick={handleMainMenuToggle} className={getButtonClass(isMainMenuOpen)} aria-label="Menu">
          <Menu size={24} className="sm:w-[26px] sm:h-[26px]" strokeWidth={2} />
          {hasUnclaimedAchievements && !isMainMenuOpen && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
      </div>
      {/* Inventory System (Middle) */}
      <div className="relative">
        {isInventoryOpen && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex flex-row gap-2 bg-black/60 p-2 rounded-2xl border border-gray-700 backdrop-blur-md whitespace-nowrap">
            <button onClick={() => handleItemClick('normal')} className={getButtonClass(isFeedModeActive && selectedFoodType === 'normal')}>
              <FeedIcon size={24} className="sm:w-[26px] sm:h-[26px]" />
              <span className="absolute -top-1 -right-1 bg-gray-800 text-yellow-400 border border-white/20 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{foodCount}</span>
            </button>
            <button onClick={() => handleItemClick('corn')} className={getButtonClass(isFeedModeActive && selectedFoodType === 'corn')}>
              <CornIcon size={24} className="sm:w-[26px] sm:h-[26px]" />
              <span className="absolute -top-1 -right-1 bg-gray-800 text-yellow-400 border border-white/20 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{cornCount}</span>
            </button>
            <button onClick={() => handleItemClick('medicine')} className={getButtonClass(isFeedModeActive && selectedFoodType === 'medicine')}>
              <Pill size={24} className="sm:w-[26px] sm:h-[26px]" />
              <span className="absolute -top-1 -right-1 bg-gray-800 text-yellow-400 border border-white/20 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{medicineCount}</span>
            </button>
          </div>
        )}
        <button onClick={handleInventoryClick} className={getButtonClass(isInventoryOpen || isFeedModeActive)}>
          {selectedFoodType === 'corn' ? <CornIcon size={24} /> : selectedFoodType === 'medicine' ? <Pill size={24} /> : <FeedIcon size={24} />}
          <span className="absolute -top-1 -right-1 bg-gray-800 text-yellow-400 border border-white/20 text-[10px] sm:text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {selectedFoodType === 'corn' ? cornCount : selectedFoodType === 'medicine' ? medicineCount : foodCount}
          </span>
        </button>
      </div>

      <button onClick={onPondInfoClick} className={getButtonClass(false)} aria-label="Open pond info">
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
