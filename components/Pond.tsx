import React, { useEffect, useRef } from 'react';
import { Koi as KoiType, Decoration, DecorationType, PondTheme } from '../types';
import { GameEngine } from '../utils/GameEngine';


interface PondProps {
  gameState: 'pre-start' | 'playing';
  koiList: KoiType[];
  decorations: Decoration[];
  theme: PondTheme;
  // FIX: Updated MouseEvent to MouseEvent<HTMLElement> to match handler signature in App.tsx
  onKoiClick: (event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>, koi: KoiType) => void;
  // FIX: Updated  onKoiClick: (event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>, koi: KoiType) => void;
  onBackgroundClick: (event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: React.PointerEvent<HTMLElement>) => void;
  updateKoiPositions: () => void;
  isSellModeActive: boolean;
  isFeedModeActive: boolean;
  breedingSelection: string[];
  sellAnimations: { id: number, value?: number, position: { x: number, y: number } }[];
  feedAnimations: { id: number, position: { x: number, y: number }, feedAmount?: number }[];
  foodDropAnimations: { id: number, position: { x: number, y: number } }[];
  foodPellets: { id: number, position: { x: number, y: number }, feedAmount: number }[];
  onFoodEaten?: (koiId: string, foodId: number, feedAmount: number, position: { x: number, y: number }) => void;
  isNight: boolean;
  waterQuality: number;
}

const DecorationComponent: React.FC<{ decoration: Decoration }> = ({ decoration }) => {
  const { type, position, scale, rotation } = decoration;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,
    pointerEvents: 'none',
    zIndex: 10,
  };

  if (type === DecorationType.LILY_PAD) {
    return (
      <div style={style}>
        <svg width="60" height="60" viewBox="0 0 100 100">
          <defs>
            <radialGradient id={`lilyGradient-${decoration.id}`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <stop offset="0%" style={{ stopColor: '#38a169' }} />
              <stop offset="100%" style={{ stopColor: '#2f855a' }} />
            </radialGradient>
          </defs>
          <path d="M 50 0 A 50 50 0 1 1 49.99 0 L 70 50 Z" fill={`url(#lilyGradient-${decoration.id})`} stroke="#276749" strokeWidth="2.5" />
        </svg>
      </div>
    );
  } else if (type === DecorationType.ROCK) {
    return (
      <div style={style}>
        <svg width="50" height="40" viewBox="0 0 100 80">
          <path d="M 10,80 Q 0,80 5,60 Q 10,30 30,20 Q 60,10 80,30 Q 95,40 90,70 Q 85,80 10,80 Z" fill="#4b5563" />
          <path d="M 30,20 Q 40,15 50,25" stroke="#374151" strokeWidth="2" fill="none" />
        </svg>
      </div>
    );
  } else if (type === DecorationType.LANTERN) {
    return (
      <div style={style}>
        <div className="relative">
          <div className="w-4 h-4 bg-orange-200 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 blur-md opacity-50 animate-pulse"></div>
          <svg width="40" height="60" viewBox="0 0 40 60">
            <rect x="10" y="0" width="20" height="5" fill="#1f2937" />
            <path d="M 5,5 L 35,5 L 40,15 L 0,15 Z" fill="#374151" />
            <rect x="5" y="15" width="30" height="30" fill="#fef3c7" opacity="0.9" />
            <rect x="0" y="45" width="40" height="5" fill="#374151" />
            <rect x="10" y="50" width="20" height="10" fill="#1f2937" />
            <circle cx="20" cy="30" r="5" fill="#f59e0b" opacity="0.6" />
          </svg>
        </div>
      </div>
    );
  }
  return null;
};

export const Pond: React.FC<PondProps> = ({ gameState, koiList, decorations, theme, onKoiClick, onBackgroundClick, onPointerMove, onPointerUp, updateKoiPositions, isSellModeActive, isFeedModeActive, breedingSelection, sellAnimations, feedAnimations, foodDropAnimations, foodPellets, onFoodEaten, isNight, waterQuality }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  // Initialize Engine
  useEffect(() => {
    if (canvasRef.current && !engineRef.current) {
      engineRef.current = new GameEngine(canvasRef.current);

      // Perform initial syncs immediately
      engineRef.current.syncKois(koiList);
      engineRef.current.syncFoods(foodPellets);
      engineRef.current.setTheme(theme);
      engineRef.current.setDayNight(isNight);
      engineRef.current.setWaterQuality(waterQuality);
      engineRef.current.setSelection(breedingSelection);
      engineRef.current.onFoodEaten = onFoodEaten;

      engineRef.current.start();
    }

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, []); // Run ONLY once on mount

  // Sync Data with Engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.syncKois(koiList);
    }
  }, [koiList]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.syncFoods(foodPellets);
    }
  }, [foodPellets]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setTheme(theme);
    }
  }, [theme]);

  // Sync Day/Night
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setDayNight(isNight);
    }
  }, [isNight]);

  // Sync Water Quality
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setWaterQuality(waterQuality);
    }
  }, [waterQuality]);

  // Sync Selection
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setSelection(breedingSelection);
    }
  }, [breedingSelection]);

  // Sync onFoodEaten callback without restarting engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.onFoodEaten = onFoodEaten;
    }
  }, [onFoodEaten]);

  const getPondClassName = () => {
    // Base classes without background colors
    let className = 'flex-grow h-full w-full relative overflow-hidden cursor-pointer transition-colors duration-500 ';

    // Append mode-specific classes
    if (isSellModeActive) className += 'sell-mode ';
    if (isFeedModeActive) className += 'feed-mode ';
    if (breedingSelection.length > 0) className += 'breeding-mode ';
    return className;
  };

  // Define RGB-based styles for each theme (RGB control)
  const getThemeStyle = (): React.CSSProperties => {
    switch (theme) {
      case PondTheme.MUD:
        return { background: 'radial-gradient(circle at center, rgba(126, 95, 55, 1), rgba(66, 45, 20, 1))' };
      case PondTheme.MOSS:
        return { background: 'radial-gradient(circle at center, rgba(95, 168, 121, 1), rgba(27, 73, 48, 1))' };
      case PondTheme.NIGHT:
        return { background: 'radial-gradient(circle at center, rgba(30, 41, 59, 1), rgba(14, 13, 26, 1))' };
      case PondTheme.DEFAULT:
      default:
        return { background: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.18)), radial-gradient(circle at center, rgba(107, 151, 216, 1), rgba(32, 84, 148, 1))' };
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!engineRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickedKoi = engineRef.current.getKoiAtPosition(x, y);

    if (clickedKoi) {
      onKoiClick(e, clickedKoi);
    } else {
      onBackgroundClick(e);
    }
  };

  return (
    <div
      className={getPondClassName()}
      style={getThemeStyle()}
      onPointerDown={handlePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* Background Image for Watercolor Theme */}

      {/* Water effect */}
      <div className="caustics-overlay pointer-events-none"></div>

      {/* Single Game Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block"
      />



      {/* Decorations & Plants */}
      {decorations.map(decoration => {

        return <DecorationComponent key={decoration.id} decoration={decoration} />;
      })}

      {/* UI Overlays (Animations) */}
      {sellAnimations.map(anim => (
        <div
          key={anim.id}
          className="absolute text-green-600 font-bold text-xl animate-float-up z-30 pointer-events-none"
          style={{
            left: `${anim.position.x}%`,
            top: `${anim.position.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          +{anim.value} ZP
        </div>
      ))}
      {feedAnimations.map(anim => (
        <div
          key={anim.id}
          className="absolute text-green-500 font-bold text-lg animate-feed-up z-30 pointer-events-none"
          style={{
            left: `${anim.position.x}%`,
            top: `${anim.position.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          +{anim.feedAmount || 1}
        </div>
      ))}
      {foodDropAnimations.map(anim => (
        <div
          key={anim.id}
          className="absolute z-30 pointer-events-none"
          style={{
            left: `${anim.position.x}%`,
            top: `${anim.position.y}%`,
          }}
        >
          <div className="food-pellet pellet1"></div>
          <div className="food-pellet pellet2"></div>
          <div className="food-pellet pellet3"></div>
        </div>
      ))}
    </div>
  );
};
