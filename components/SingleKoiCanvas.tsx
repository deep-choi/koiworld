import React, { useRef, useEffect } from 'react';
import { Koi } from '../types';
import { KoiRenderer } from '../utils/koiRenderer';
import { getPhenotype, getDisplayColor, getSpineColor, GENE_COLOR_MAP, calculateSpotPhenotype } from '../utils/genetics';

interface SingleKoiCanvasProps {
    koi: Koi;
    width?: number;
    height?: number;
    showDetails?: boolean;
    isStatic?: boolean;
}

export const SingleKoiCanvas: React.FC<SingleKoiCanvasProps> = ({ koi, width = 300, height = 200, showDetails = true, isStatic = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<KoiRenderer | null>(null);
    const animationRef = useRef<number | null>(null);
    const stateRef = useRef({
        x: width / 2,
        y: height / 2,
        vx: 0,
        vy: 0,
        targetX: width / 2,
        targetY: height / 2,
        nextTargetTime: 0,
        lastTime: 0,
        initialized: false
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Create new renderer for each mount
        const renderer = new KoiRenderer();
        rendererRef.current = renderer;

        // Calculate appropriate scale based on canvas size
        const scale = Math.min(width, height) / 300;
        renderer.setScale(scale, true); // Set scale immediately

        const colorsObject = () => {
            // Calculate colors from genetics
            const phenotype = getPhenotype(koi.genetics.baseColorGenes);
            const bodyColor = getDisplayColor(phenotype, koi.genetics.lightness, koi.genetics.saturation);
            const spineColor = getSpineColor(phenotype, koi.genetics.lightness, koi.genetics.saturation);
            const spotPhenotype = calculateSpotPhenotype(koi.genetics.spotPhenotypeGenes, koi);

            const colors = {
                outline: 'rgba(255, 255, 255, 0.15)',
                body: bodyColor,
                pattern: '#FF4500',
                spine: spineColor || '#000000',
                fin: bodyColor.replace(/hsla\((\d+),\s*([\.\d]+)%,\s*([\.\d]+)%,\s*1\)/, (match: string, h: string, s: string, l: string) => {
                    const desaturatedS = Math.max(0, parseFloat(s) * 0.4);
                    return `hsla(${h}, ${desaturatedS}%, ${l}%, 0.5)`;
                })
            };

            const spots = koi.genetics.spots.map(spot => ({
                ...spot,
                color: GENE_COLOR_MAP[spot.color]
            }));

            return { colors, spots, spotPhenotype };
        };

        const { colors, spots, spotPhenotype } = colorsObject();

        // Animation loop - 코이가 중앙에서 원을 그리며 헤엄칩니다.
        const animate = () => {
            if (!rendererRef.current || !ctx) return;

            const now = performance.now();
            let dt = (now - stateRef.current.lastTime) / 1000;
            stateRef.current.lastTime = now;
            if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
            dt = Math.min(dt, 0.05);

            // 원형 궤도 계산
            const time = now / 1000;
            const radius = Math.min(width, height) * 0.25; // 중앙에서의 거리
            const orbitSpeed = 0.8; // 회전 속도 (초당 라디안)

            const targetAngle = time * orbitSpeed;
            // 코이가 바라보는 방향 (접선 방향)
            const swimAngle = targetAngle + Math.PI / 2;

            stateRef.current.x = width / 2 + Math.cos(targetAngle) * radius;
            stateRef.current.y = height / 2 + Math.sin(targetAngle) * radius;
            stateRef.current.vx = Math.cos(swimAngle);
            stateRef.current.vy = Math.sin(swimAngle);

            const swimKoi = {
                ...koi,
                position: { x: stateRef.current.x, y: stateRef.current.y },
                velocity: { vx: stateRef.current.vx, vy: stateRef.current.vy }
            };

            rendererRef.current.update(swimKoi, dt, true);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            rendererRef.current.drawWorld(ctx, colors, spots, false, Date.now(), spotPhenotype);

            animationRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [koi, width, height, isStatic]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="block"
            style={{ width: `${width}px`, height: `${height}px` }}
        />
    );
};
