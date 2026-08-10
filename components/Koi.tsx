import React, { useRef, useEffect } from 'react';
import { Koi as KoiType } from '../types';
import { GENE_COLOR_MAP, getPhenotype, getDisplayColor, getSpineColor, calculateSpotPhenotype } from '../utils/genetics';
import { KoiRenderer } from '../utils/koiRenderer';

interface KoiProps {
  koi: KoiType;
  onClick: (event: React.MouseEvent<HTMLElement>, koi: KoiType) => void;
  isSelected?: boolean;
}

export const Koi: React.FC<KoiProps> = ({ koi, onClick, isSelected }) => {
  const rendererRef = useRef<KoiRenderer | null>(null);
  const animationRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const latestKoiRef = useRef<KoiType>(koi);

  // Update ref when prop changes
  useEffect(() => {
    latestKoiRef.current = koi;
  }, [koi]);

  // Initialize renderer once
  if (!rendererRef.current) {
    rendererRef.current = new KoiRenderer();
  }

  useEffect(() => {
    // Animation loop
    const animate = () => {
      if (rendererRef.current && canvasRef.current && divRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        const currentKoi = latestKoiRef.current;

        if (ctx && currentKoi) {
          // Get colors from genetics (calculated here to ensure latest state)
          const phenotype = getPhenotype(currentKoi.genetics.baseColorGenes);
          const bodyColor = getDisplayColor(
            phenotype,
            currentKoi.genetics.lightness,
            currentKoi.genetics.saturation
          );

          const colors = {
            outline: 'rgba(255, 255, 255, 0.15)',
            body: bodyColor,
            pattern: '#FF4500',
            spine: getSpineColor(
              phenotype,
              currentKoi.genetics.lightness,
              currentKoi.genetics.saturation
            ),
            fin: bodyColor.replace(/hsla\((\d+),\s*([.\d]+)%,\s*([.\d]+)%,\s*1\)/, (match: string, h: string, s: string, l: string) => {
              const desaturatedS = Math.max(0, parseFloat(s) * 0.4);
              return `hsla(${h}, ${desaturatedS}%, ${l}%, 0.5)`;
            })
          };

          const spots = currentKoi.genetics.spots.map(spot => ({
            ...spot,
            color: GENE_COLOR_MAP[spot.color]
          }));

          // Update simulation (smooths head position internally)
          rendererRef.current.update(currentKoi, 1 / 60);

          // Update DIV position directly for smooth movement across screen
          // We get the smoothed head position from the renderer
          const headPos = rendererRef.current.getHeadPosition();

          // Convert world pixels back to percentage (worldScale was 20, so 1% = 20px)
          const left = headPos.x / 20;
          const top = headPos.y / 20;

          divRef.current.style.left = `${left}%`;
          divRef.current.style.top = `${top}%`;

          // Draw to canvas
          const spotPhenotype = calculateSpotPhenotype(currentKoi.genetics.spotPhenotypeGenes, currentKoi);
          rendererRef.current.draw(ctx, canvasRef.current.width, canvasRef.current.height, colors, spots, spotPhenotype);
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []); // Run once on mount

  return (
    <div
      ref={divRef}
      className={`absolute cursor-pointer ${isSelected ? 'ring-4 ring-purple-500 rounded-full' : ''}`}
      style={{
        // Initial position from props, then updated by ref in animation loop
        left: `${koi.position.x}%`,
        top: `${koi.position.y}%`,
        transform: `translate(-50%, -50%) scale(${koi.growthStage === 'fry' ? 0.4 : koi.growthStage === 'juvenile' ? 0.7 : 1.0})`,
        transition: 'none', // Disable CSS transition to allow smooth JS control
        width: '0px',
        height: '0px',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e, koi);
      }}
    >
      <canvas
        ref={canvasRef}
        width={500}
        height={500}
        style={{
          transform: 'translate(-50%, -50%)', // Center the canvas on the div's position
          pointerEvents: 'none' // Let clicks pass through to the div
        }}
      />
    </div>
  );
};
