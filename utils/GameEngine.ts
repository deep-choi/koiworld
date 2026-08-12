/// <reference types="vite/client" />
import { Koi, PondTheme, Decoration, DecorationType, SpotPhenotype, GrowthStage } from '../types';
import { KoiRenderer } from './koiRenderer';
import { GENE_COLOR_MAP, getPhenotype, getDisplayColor, getSpineColor, calculateSpotPhenotype, getSpotColorWithSaturation } from './genetics';
import { WaterEffects } from './WaterEffects';

const NO_KOI_POSITIONS: { x: number, y: number, vx: number, vy: number }[] = [];

interface GameEntity {
    id: string;
    type: 'koi' | 'food' | 'decoration';
}

interface KoiEntity extends GameEntity {
    type: 'koi';
    data: Koi;
    renderer: KoiRenderer;
    target: { x: number, y: number };
    chaseTimer: number; // Time spent chasing current target
    cachedColors: {
        outline: string;
        body: string;
        pattern: string;
        spine: string;
        fin: string; // Pre-calculated transparent color
        spots: Array<{ x: number, y: number, size: number, color: string, shape?: any }>;
    };
    phenotype?: SpotPhenotype;
    geneticsHash?: string; // 유전자 변경 감지용 해시
}

interface FoodEntity extends GameEntity {
    type: 'food';
    position: { x: number, y: number };
    feedAmount: number;
}

export class GameEngine {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationId: number | null = null;

    private kois: Map<string, KoiEntity> = new Map();
    private foods: Map<number, FoodEntity> = new Map();
    private decorations: Decoration[] = [];
    private theme: PondTheme = PondTheme.DEFAULT; // Default to Day
    private isNight: boolean = false;
    private waterEffects: WaterEffects;
    private waterQuality: number = 100; // Default 100

    private width: number = 0;
    private height: number = 0;

    // Physics Constants (Time-based now)
    // Speed was 2.0 px/frame @ 60fps => 120 px/sec. Let's make it 100 px/sec for slightly calmer movement.
    private readonly SPEED = 100.0;
    // Turn speed was 0.03 rad/frame @ 60fps => 1.8 rad/sec. Let's make it 2.0 rad/sec.
    private readonly TURN_SPEED = 2.0;
    private readonly MARGIN = 50;

    // FPS Counter
    private frameCount = 0;
    private fpsLastTime = 0;
    private currentFPS = 0;
    private showFPS = import.meta.env.DEV; // 개발자 패널용 FPS 표시 (개발 환경에서만)
    private readonly resizeListener = () => this.resize();
    private readonly visibilityListener = () => {
        if (document.hidden) this.stop();
        else this.start();
    };

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const context = canvas.getContext('2d');
        if (!context) throw new Error("Could not get 2D context");
        this.ctx = context;
        this.waterEffects = new WaterEffects();

        this.resize();
        window.addEventListener('resize', this.resizeListener);
        document.addEventListener('visibilitychange', this.visibilityListener);
    }

    public onFoodEaten?: (koiId: string, foodId: number, feedAmount: number, position: { x: number, y: number }) => void;

    private resize() {
        // 캔버스의 실제 크기에 맞춰 해상도 조정
        let clientWidth = this.canvas.clientWidth;
        let clientHeight = this.canvas.clientHeight;

        // Fallback if canvas has no size yet (e.g. not attached or hidden)
        if (clientWidth === 0) clientWidth = window.innerWidth;
        if (clientHeight === 0) clientHeight = window.innerHeight;

        if (this.canvas.width !== clientWidth || this.canvas.height !== clientHeight) {
            this.canvas.width = clientWidth;
            this.canvas.height = clientHeight;
        }
        this.width = clientWidth;
        this.height = clientHeight;
        this.waterEffects.resize(this.width, this.height);
    }

    private duckweeds: Map<string, {
        id: string, x: number, y: number, vx: number, vy: number, leafCount: number, scale: number
    }> = new Map();

    private updateDuckweeds(dt: number) {
        // Physics Loop (dt in seconds)
        const entities = Array.from(this.duckweeds.values());

        entities.forEach(dec => {
            // 1. Repulsion
            let repulsionX = 0;
            let repulsionY = 0;
            const radius = 60 * dec.scale; // Approx pixel radius of cluster

            entities.forEach(other => {
                if (dec.id !== other.id) {
                    const dx = dec.x - other.x;
                    const dy = dec.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    let minDist = radius * 1.5; // Padding
                    // If leafCount is small, radius is smaller.
                    // Rough sizing:
                    if (dec.leafCount < 10) minDist = 40;
                    else if (dec.leafCount < 25) minDist = 70;
                    else minDist = 100;

                    if (dist < minDist && dist > 1) {
                        const push = (minDist - dist) / dist;
                        repulsionX += dx * push * 60; // Force magnitude
                        repulsionY += dy * push * 60;
                    }
                }
            });

            // 2. Steering / Wander
            // Randomly change velocity slightly
            const steerRate = 20;
            dec.vx += (Math.random() - 0.5) * steerRate * dt;
            dec.vy += (Math.random() - 0.5) * steerRate * dt;

            // Apply repulsion
            dec.vx += repulsionX * dt;
            dec.vy += repulsionY * dt;

            // 3. Limit Speed
            const speed = Math.sqrt(dec.vx * dec.vx + dec.vy * dec.vy);
            const maxSpeed = 15; // Pixels per second (very slow drift)
            if (speed > maxSpeed) {
                dec.vx = (dec.vx / speed) * maxSpeed;
                dec.vy = (dec.vy / speed) * maxSpeed;
            }

            // 4. Move
            dec.x += dec.vx * dt;
            dec.y += dec.vy * dt;

            // 5. Bounce Walls
            const margin = radius;
            if (dec.x < margin) { dec.x = margin; dec.vx = Math.abs(dec.vx); }
            if (dec.x > this.width - margin) { dec.x = this.width - margin; dec.vx = -Math.abs(dec.vx); }
            if (dec.y < margin) { dec.y = margin; dec.vy = Math.abs(dec.vy); }
            if (dec.y > this.height - margin) { dec.y = this.height - margin; dec.vy = -Math.abs(dec.vy); }
        });
    }

    private drawDuckweed(ctx: CanvasRenderingContext2D) {
        // Hex offsets (Hardcoded spiral 37)
        const spiral = [
            { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
            { q: 2, r: 0 }, { q: 1, r: 1 }, { q: 0, r: 2 }, { q: -1, r: 2 }, { q: -2, r: 2 }, { q: -2, r: 1 },
            { q: -2, r: 0 }, { q: -1, r: -1 }, { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 }, { q: 2, r: -1 },
            { q: 3, r: 0 }, { q: 2, r: 1 }, { q: 1, r: 2 }, { q: 0, r: 3 },
            { q: -1, r: 3 }, { q: -2, r: 3 }, { q: -3, r: 3 }, { q: -3, r: 2 },
            { q: -3, r: 1 }, { q: -3, r: 0 }, { q: -2, r: -1 }, { q: -1, r: -2 },
            { q: 0, r: -3 }, { q: 1, r: -3 }, { q: 2, r: -3 }, { q: 3, r: -3 },
            { q: 3, r: -2 }, { q: 3, r: -1 }
        ];

        this.duckweeds.forEach(dec => {
            ctx.save();
            ctx.translate(dec.x, dec.y);
            // ctx.scale(dec.scale, dec.scale); // Scale creates fuzzy rendering sometimes, better to just draw

            // Draw Cluster
            // Shadow
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;

            const offsets = spiral.slice(0, dec.leafCount);
            offsets.forEach((pos, i) => {
                const cx = pos.q * 13 + pos.r * 6.5;
                const cy = pos.r * 11.2;

                // Color variety
                const colors = ['#4d7c0f', '#65a30d', '#3f6212'];
                ctx.fillStyle = colors[i % 3];

                ctx.beginPath();
                ctx.arc(cx, cy, 6, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.restore();
        });
    }

    private lastTime: number = 0;

    public start() {
        if (document.hidden) return;
        if (!this.animationId) {
            this.lastTime = performance.now();
            this.loop(this.lastTime);
        }
    }

    public stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public destroy() {
        this.stop();
        window.removeEventListener('resize', this.resizeListener);
        document.removeEventListener('visibilitychange', this.visibilityListener);
    }

    private selectedIds: Set<string> = new Set();

    public setSelection(selectedIds: string[]) {
        this.selectedIds = new Set(selectedIds);
    }

    public getKoiAtPosition(x: number, y: number): Koi | null {
        // x, y are in pixels relative to canvas
        const kois = Array.from(this.kois.values());
        // Check in reverse order to pick top-most
        for (let i = kois.length - 1; i >= 0; i--) {
            const entity = kois[i];
            // Use renderer's precise hit test (body segments)
            // Pass a generous hit radius (e.g. 10px extra margin around body)
            if (entity.renderer.hitTest(x, y, 15)) {
                return entity.data;
            }
        }
        return null;
    }

    public syncKois(kois: Koi[]) {
        // Ensure dimensions are valid before syncing positions
        if (this.width === 0 || this.height === 0) {
            this.resize();
        }

        // Remove kois that no longer exist
        const currentIds = new Set(kois.map(k => k.id));
        for (const [id] of this.kois) {
            if (!currentIds.has(id)) {
                this.kois.delete(id);
            }
        }

        // Add or Update kois
        // Add or Update kois
        kois.forEach(koiData => {
            if (!this.kois.has(koiData.id)) {
                // New Koi
                const renderer = new KoiRenderer();
                // Initialize renderer with starting position
                const startX = (koiData.position.x / 100) * this.width;
                const startY = (koiData.position.y / 100) * this.height;

                // Pre-calculate colors
                const baseColorPhenotype = getPhenotype(koiData.genetics.baseColorGenes);
                const bodyColor = getDisplayColor(baseColorPhenotype, koiData.genetics.lightness ?? 50, koiData.genetics.saturation ?? 50);
                const spineColor = getSpineColor(baseColorPhenotype, koiData.genetics.lightness ?? 50, koiData.genetics.saturation ?? 50);

                // Calculate Fin Color (Regex logic moved here to run once)
                // "hsla(h, s%, l%, 1)" -> "hsla(h, s*0.4%, l%, 0.5)"
                const finColor = bodyColor.replace(/hsla\((\d+),\s*([.\d]+)%,\s*([.\d]+)%,\s*1\)/, (match, h, s, l) => {
                    const desaturatedS = Math.max(0, parseFloat(s) * 0.4);
                    return `hsla(${h}, ${desaturatedS}%, ${l}%, 0.5)`;
                });

                // phenotype 먼저 계산 (채도 반영에 필요)
                const phenotype = koiData.genetics.spotPhenotypeGenes ? calculateSpotPhenotype(koiData.genetics.spotPhenotypeGenes, koiData) : undefined;
                const colorSaturation = phenotype?.colorSaturation ?? 0.5;

                // spots 색상에 채도와 명도 변형 반영 (ctx.filter 대신 색상 자체에 적용)
                const spots = koiData.genetics.spots.map((spot, idx) => ({
                    ...spot,
                    color: getSpotColorWithSaturation(GENE_COLOR_MAP[spot.color], colorSaturation, idx)
                }));
                const geneticsHash = `${koiData.genetics.baseColorGenes.join('')}-${koiData.genetics.lightness}-${koiData.genetics.saturation}-${koiData.genetics.spots.length}`;

                this.kois.set(koiData.id, {
                    id: koiData.id,
                    type: 'koi',
                    data: {
                        ...koiData,
                        position: { x: startX, y: startY },
                        age: koiData.age || 0,
                        growthStage: koiData.growthStage || GrowthStage.FRY
                    },
                    renderer,
                    target: this.getRandomTarget(),
                    chaseTimer: 0,
                    cachedColors: {
                        outline: 'rgba(255, 255, 255, 0.15)',
                        body: bodyColor,
                        pattern: '#FF4500',
                        spine: spineColor || '#000000',
                        fin: finColor,
                        spots: spots
                    },
                    phenotype,
                    geneticsHash
                });
                this.updateKoiScale(this.kois.get(koiData.id)!, true);
            } else {
                // Update existing data
                const entity = this.kois.get(koiData.id)!;

                // 유전자 해시 비교 - 변경 시에만 색상 재계산 (성능 최적화)
                const geneticsHash = `${koiData.genetics.baseColorGenes.join('')}-${koiData.genetics.lightness}-${koiData.genetics.saturation}-${koiData.genetics.spots.length}`;

                if (entity.geneticsHash !== geneticsHash) {
                    // 유전자가 변경되었을 때만 색상 재계산
                    const baseColorPhenotype = getPhenotype(koiData.genetics.baseColorGenes);
                    const bodyColor = getDisplayColor(baseColorPhenotype, koiData.genetics.lightness ?? 50, koiData.genetics.saturation ?? 50);
                    const spineColor = getSpineColor(baseColorPhenotype, koiData.genetics.lightness ?? 50, koiData.genetics.saturation ?? 50);
                    const finColor = bodyColor.replace(/hsla\((\d+),\s*([.\d]+)%,\s*([.\d]+)%,\s*1\)/, (match, h, s, l) => {
                        const desaturatedS = Math.max(0, parseFloat(s) * 0.4);
                        return `hsla(${h}, ${desaturatedS}%, ${l}%, 0.5)`;
                    });

                    // phenotype 먼저 계산 (채도 반영에 필요)
                    entity.phenotype = koiData.genetics.spotPhenotypeGenes ? calculateSpotPhenotype(koiData.genetics.spotPhenotypeGenes, koiData) : undefined;
                    const colorSaturation = entity.phenotype?.colorSaturation ?? 0.5;

                    // spots 색상에 채도와 명도 변형 반영 (ctx.filter 대신 색상 자체에 적용)
                    const spots = koiData.genetics.spots.map((spot, idx) => ({
                        ...spot,
                        color: getSpotColorWithSaturation(GENE_COLOR_MAP[spot.color], colorSaturation, idx)
                    }));

                    entity.cachedColors = {
                        outline: 'rgba(255, 255, 255, 0.15)',
                        body: bodyColor,
                        pattern: '#FF4500',
                        spine: spineColor || '#000000',
                        fin: finColor,
                        spots: spots
                    };

                    entity.geneticsHash = geneticsHash;
                }

                entity.data = {
                    ...koiData,
                    position: entity.data.position, // Keep local physics position
                    velocity: entity.data.velocity,  // Keep local velocity
                    age: koiData.age || entity.data.age || 0,
                    growthStage: koiData.growthStage || entity.data.growthStage || GrowthStage.FRY
                };
                this.updateKoiScale(entity);
            }
        });
    }

    public setDecorations(decorations: Decoration[]) {
        this.decorations = decorations;

        // Ensure dimensions
        if (this.width === 0 || this.height === 0) this.resize();

        if (this.width === 0 || this.height === 0) return;

        const currentIds = new Set<string>();

        decorations.forEach(dec => {
            if (dec.type === DecorationType.DUCKWEED) {
                currentIds.add(dec.id);
                if (!this.duckweeds.has(dec.id)) {
                    // Start new simulation entity
                    // Convert % to pixels
                    const x = (dec.position.x / 100) * this.width;
                    const y = (dec.position.y / 100) * this.height;

                    this.duckweeds.set(dec.id, {
                        id: dec.id,
                        x: x,
                        y: y,
                        vx: (Math.random() - 0.5) * 40,
                        vy: (Math.random() - 0.5) * 40,
                        leafCount: dec.leafCount || 20,
                        scale: dec.scale || 1
                    });
                }
            }
        });

        // Remove old
        for (const id of this.duckweeds.keys()) {
            if (!currentIds.has(id)) {
                this.duckweeds.delete(id);
            }
        }
    }

    public syncFoods(foods: Array<{ id: number, position: { x: number, y: number }, feedAmount: number }>) {
        this.foods.clear();
        foods.forEach(f => {
            this.foods.set(f.id, {
                id: f.id.toString(),
                type: 'food',
                position: {
                    x: (f.position.x / 100) * this.width,
                    y: (f.position.y / 100) * this.height
                },
                feedAmount: f.feedAmount
            });
        });
    }

    public setTheme(theme: PondTheme) {
        this.theme = theme;
        // this.theme = PondTheme.NIGHT; // Removed lock
    }

    public setDayNight(isNight: boolean) {
        this.isNight = isNight;
    }

    public setWaterQuality(quality: number) {
        this.waterQuality = quality;
    }

    private updateKoiScale(entity: KoiEntity, immediate: boolean = false) {
        const isMobile = this.width < 768; // Simple width check for mobile

        let scale = isMobile ? 0.5 : 0.7; // Mobile: 0.5, Desktop: 0.7

        if (entity.data.growthStage === 'fry') {
            scale = isMobile ? 0.3 : 0.3; // Fry: Mobile 0.3, Desktop 0.3
        } else if (entity.data.growthStage === 'juvenile') {
            scale = isMobile ? 0.4 : 0.5; // Juvenile: Mobile 0.4, Desktop 0.5
        }

        entity.renderer.setScale(scale, immediate);
    }

    private getRandomTarget() {
        const padding = 100;
        return {
            x: padding + Math.random() * (this.width - padding * 2),
            y: padding + Math.random() * (this.height - padding * 2)
        };
    }

    private update(dt: number, now: number) {


        // Water Effects (Ambient only, no position tracking for performance)
        this.waterEffects.update(NO_KOI_POSITIONS);
        this.waterEffects.updateSurface(this.width, this.height, this.isNight);

        // Update Kois
        this.kois.forEach(entity => {
            const head = entity.data.position; // This is now in PIXELS

            // 1. Target Logic
            let target = entity.target;
            let chasingFood = false;

            // Food Seeking Logic
            if (this.foods.size > 0 && (!entity.data.feedCooldownUntil || now >= entity.data.feedCooldownUntil)) {
                let closestFood: FoodEntity | null = null;
                let minDist = Infinity;

                // Find closest food
                for (const food of this.foods.values()) {
                    const dx = food.position.x - head.x;
                    const dy = food.position.y - head.y;
                    const dist = dx * dx + dy * dy; // Squared distance

                    if (dist < minDist) {
                        minDist = dist;
                        closestFood = food;
                    }
                }

                // If food is within detection range (e.g. 300px)
                if (closestFood && minDist < 300 * 300) {
                    target = closestFood.position;
                    chasingFood = true;
                    entity.chaseTimer += dt;

                    // Check collision (eating)
                    if (minDist < 20 * 20) { // Eating distance
                        if (this.onFoodEaten) {
                            const posPercent = {
                                x: (head.x / this.width) * 100,
                                y: (head.y / this.height) * 100
                            };
                            this.onFoodEaten(entity.id, parseInt(closestFood.id), closestFood.feedAmount, posPercent);
                        }
                        // Remove locally immediately to prevent double eating
                        this.foods.delete(parseInt(closestFood.id));
                        chasingFood = false;
                        entity.target = this.getRandomTarget(); // Pick new random target
                    }
                }
            }

            if (!chasingFood) {
                entity.chaseTimer = 0;
                const distToTarget = Math.hypot(entity.target.x - head.x, entity.target.y - head.y);
                if (distToTarget < 100) {
                    entity.target = this.getRandomTarget();
                }
            }

            // 2. Physics (Steering)
            const angleToTarget = Math.atan2(target.y - head.y, target.x - head.x);
            const distToTargetForPhysics = Math.hypot(target.x - head.x, target.y - head.y);

            // Current angle from velocity
            let currentAngle = Math.atan2(entity.data.velocity.vy, entity.data.velocity.vx);

            let diff = angleToTarget - currentAngle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;

            // Dynamic Physics Parameters
            let currentTurnSpeed = this.TURN_SPEED;
            let currentSpeed = this.SPEED;

            // Stamina-based speed modifier
            const stamina = entity.data.stamina ?? 100;
            if (stamina <= 5) {
                currentSpeed *= 0.35; // Slow but not crawling at critical stamina
            } else if (stamina <= 40) {
                currentSpeed *= 0.5; // Half speed at low stamina
            }

            // Fix for "Circling" behavior:
            if (chasingFood && distToTargetForPhysics < 100) {
                if (entity.chaseTimer > 1.5) {
                    // STRIKE MODE: stuck for > 1.5s
                    // Snap to target (5x turn) and Dash (1.5x speed)
                    currentTurnSpeed *= 5.0;
                    currentSpeed *= 1.5;
                } else {
                    // Normal Approach: Smoother, wider turns
                    currentTurnSpeed *= 0.5;
                }
            }

            // Apply turn speed with Delta Time
            currentAngle += diff * currentTurnSpeed * dt;

            // Update Velocity
            entity.data.velocity.vx = Math.cos(currentAngle) * currentSpeed;
            entity.data.velocity.vy = Math.sin(currentAngle) * currentSpeed;

            // Move
            head.x += entity.data.velocity.vx * dt;
            head.y += entity.data.velocity.vy * dt;

            // Wall Wrap 
            if (head.x < -this.MARGIN) head.x = this.width + this.MARGIN;
            if (head.x > this.width + this.MARGIN) head.x = -this.MARGIN;
            if (head.y < -this.MARGIN) head.y = this.height + this.MARGIN;
            if (head.y > this.height + this.MARGIN) head.y = -this.MARGIN;

            // Update Renderer (IK Body)
            entity.renderer.update(entity.data, dt, true); // true = isAbsolutePixels
        });
    }

    private draw(now: number) {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // Draw Water Effects (Background)
        this.waterEffects.draw(this.ctx);



        // Draw Shadows (Pass 1)
        this.kois.forEach(entity => {
            const scale = entity.renderer.getScale();
            // Base offset is 15px for scale 1.0. Scale linearly with size.
            // Using 20 as base multiplier for slightly better separation on larger fish
            const offsetVal = 26 * scale;
            // Almost vertical: small X offset (20%), full Y offset
            try {
                entity.renderer.drawShadow(this.ctx, offsetVal * 0.2, offsetVal);
            } catch (e) {
                // Ignore shadow errors
            }
        });

        // Draw Kois (Pass 2)


        this.kois.forEach(entity => {
            const isSelected = this.selectedIds.has(entity.id);

            try {
                entity.renderer.drawWorld(this.ctx, entity.cachedColors, entity.cachedColors.spots, isSelected, now, entity.phenotype);
            } catch (e) {
                console.error("Error drawing koi:", e);
            }
        });



        // Draw Surface Decorations (Duckweeds)
        // this.drawDuckweed(this.ctx); // Disabled in favor of React Component

        // Draw Surface Effects (Shimmer - Top Layer)
        this.waterEffects.drawSurface(this.ctx, this.isNight, this.waterQuality);

        // Draw Foods (Absolute Top Layer)
        this.foods.forEach(food => {
            this.ctx.fillStyle = food.feedAmount > 1 ? '#fbbf24' : '#78350f'; // Yellow for corn (amount=2)
            this.ctx.beginPath();
            this.ctx.arc(food.position.x, food.position.y, 4, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // FPS Display (개발자 패널)
        if (this.showFPS) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(10, this.height - 35, 80, 25);
            this.ctx.fillStyle = this.currentFPS >= 50 ? '#4ade80' : this.currentFPS >= 30 ? '#fbbf24' : '#f87171';
            this.ctx.font = 'bold 14px monospace';
            this.ctx.fillText(`FPS: ${this.currentFPS}`, 18, this.height - 17);
            this.ctx.restore();
        }
    }

    private loop = (timestamp: number) => {
        try {
            const dt = (timestamp - this.lastTime) / 1000;
            this.lastTime = timestamp;

            // FPS 계산
            this.frameCount++;
            if (timestamp - this.fpsLastTime >= 1000) {
                this.currentFPS = this.frameCount;
                this.frameCount = 0;
                this.fpsLastTime = timestamp;
            }

            const safeDt = Math.min(dt, 0.1);
            const now = Date.now();

            // this.resize(); // Optimization: Removed per-frame resize
            this.update(safeDt, now);
            this.draw(now);
            this.animationId = requestAnimationFrame(this.loop);
        } catch (e) {
            console.error("Error in game loop:", e);
            if (this.animationId) cancelAnimationFrame(this.animationId);
        }
    }
}
