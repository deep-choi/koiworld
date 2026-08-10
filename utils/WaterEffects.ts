import { PondTheme } from '../types';

export interface DustParticle {
    x: number;
    y: number;
    size: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    alpha: number;
}

export interface Ripple {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    alpha: number;
    speed: number;
}

export interface BubbleParticle {
    x: number;
    y: number;
    size: number;
    maxSize: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    alpha: number;
}

// Rising Bubbles & Frosted Glass Sheen Implementation
export class WaterEffects {
    private particles: DustParticle[] = [];
    private ripples: Ripple[] = [];
    private surfaceBubbles: BubbleParticle[] = [];
    private width: number = 0;
    private height: number = 0;
    private surfaceGradient: CanvasGradient | null = null;
    private surfaceGradientKey: string = '';

    constructor() { }

    public resize(width: number, height: number) {
        if (this.width !== width || this.height !== height) {
            this.surfaceGradient = null;
            this.surfaceGradientKey = '';
        }
        this.width = width;
        this.height = height;
    }

    public addRipple(x: number, y: number, intensity: number = 1.0) {
        if (this.ripples.length > 50) return;
        this.ripples.push({
            x,
            y,
            radius: 1,
            maxRadius: 20 + intensity * 30,
            alpha: 0.6 * intensity,
            speed: 0.5 + intensity * 0.5
        });
    }

    public update(koiPositions: { x: number, y: number, vx: number, vy: number }[]) {
        koiPositions.forEach(pos => {
            const speed = Math.hypot(pos.vx, pos.vy);
            // Limit max particles
            if (speed > 0.1 && Math.random() < 0.05 && this.particles.length < 150) {
                this.particles.push({
                    x: pos.x + (Math.random() - 0.5) * 5,
                    y: pos.y + (Math.random() - 0.5) * 5,
                    size: Math.random() * 2 + 0.5,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: (Math.random() - 0.5) * 0.5,
                    life: 0,
                    maxLife: 60 + Math.random() * 60,
                    alpha: 0.2 + Math.random() * 0.2
                });
            }
        });

        if (Math.random() < 0.005 && this.particles.length < 150) {
            this.particles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                size: Math.random() * 2 + 0.5,
                vx: (Math.random() - 0.5) * 0.2,
                vy: (Math.random() - 0.5) * 0.2,
                life: 0,
                maxLife: 100 + Math.random() * 100,
                alpha: 0.1 + Math.random() * 0.1
            });
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life++;
            if (p.life >= p.maxLife) this.particles.splice(i, 1);
        }

        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.radius += r.speed;
            r.alpha -= 0.01;
            if (r.alpha <= 0 || r.radius > r.maxRadius) this.ripples.splice(i, 1);
        }
    }

    public updateSurface(width: number, height: number, isNight: boolean) {
        try {
            // Spawn rising bubbles
            // High frequency (0.05)
            if (Math.random() < 0.05) {
                this.surfaceBubbles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    size: 0.5,
                    maxSize: 1.5 + Math.random() * 2,
                    vx: (Math.random() - 0.5) * 0.1,
                    vy: -0.05 - Math.random() * 0.1,
                    life: 0,
                    maxLife: 200 + Math.random() * 200,
                    alpha: 0
                });
            }

            // Update bubbles
            for (let i = this.surfaceBubbles.length - 1; i >= 0; i--) {
                const b = this.surfaceBubbles[i];

                b.x += b.vx;
                b.y += ((Math.random() - 0.5) * 0.1) + b.vy;

                b.life++;

                if (b.size < b.maxSize) {
                    b.size += 0.005;
                }

                const midLife = b.maxLife * 0.3;
                if (b.life < midLife) {
                    // High visibility (0.5 opacity)
                    b.alpha = (b.life / midLife) * 0.5;
                } else if (b.life > b.maxLife * 0.7) {
                    b.alpha -= 0.005;
                }

                if (b.life >= b.maxLife || b.alpha <= 0) {
                    this.surfaceBubbles.splice(i, 1);
                }
            }
        } catch (e) {
            console.warn("Error updating surface effects:", e);
        }
    }

    public draw(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (const p of this.particles) {
            const fade = 1 - (p.life / p.maxLife);
            ctx.globalAlpha = p.alpha * fade;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        ctx.lineWidth = 2;
        for (const r of this.ripples) {
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${r.alpha})`;
            ctx.stroke();
        }
    }

    public drawSurface(ctx: CanvasRenderingContext2D, isNight: boolean, waterQuality: number = 100) {
        try {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';

            const w = this.width;
            const h = this.height;

            // 1. Draw Surface Sheen (Frosted Glass Effect)
            // Much higher opacity to obscure bottom slightly (simulating blur/depth)
            // Day: original soft green sheen, Night: icy blue
            const sheenBaseColor = isNight ? '200, 220, 255' : '100, 255, 200';

            // Keep clear water close to the pond's base color; let the surface tint appear as quality drops.
            const daySheenAlpha =
                waterQuality >= 90 ? 0.025 :
                    waterQuality >= 80 ? 0.04 :
                        waterQuality >= 70 ? 0.06 :
                            waterQuality >= 60 ? 0.08 :
                                waterQuality >= 50 ? 0.1 :
                                    0.12;
            const sheenAlphaTop = isNight ? 0.15 : daySheenAlpha;
            const sheenAlphaBottom = isNight ? 0.15 : daySheenAlpha;
            const gradientKey = `${w}x${h}:${sheenBaseColor}:${sheenAlphaTop}:${sheenAlphaBottom}`;

            if (!this.surfaceGradient || this.surfaceGradientKey !== gradientKey) {
                const sheenGradient = ctx.createLinearGradient(0, 0, 0, h);
                sheenGradient.addColorStop(0, `rgba(${sheenBaseColor}, ${sheenAlphaTop})`);
                sheenGradient.addColorStop(1, `rgba(${sheenBaseColor}, ${sheenAlphaBottom})`);
                this.surfaceGradient = sheenGradient;
                this.surfaceGradientKey = gradientKey;
            }

            ctx.fillStyle = this.surfaceGradient;

            // Add "Backdrop Blur" simulation by filling with semi-transparent milky layer
            ctx.fillRect(0, 0, w, h);

            // Murky Water Effect based on quality stages (Discrete)
            // Constant Green Color, varying only opacity as requested
            const fixedMurkyColor = '40, 50, 20';
            let murkyAlpha = 0;

            if (waterQuality >= 90) {
                murkyAlpha = 0;
            } else if (waterQuality >= 80) {
                murkyAlpha = 0.1;
            } else if (waterQuality >= 70) {
                murkyAlpha = 0.2;
            } else if (waterQuality >= 60) {
                murkyAlpha = 0.3;
            } else if (waterQuality >= 50) {
                murkyAlpha = 0.4;
            } else if (waterQuality >= 20) {
                murkyAlpha = 0.6;
            } else {
                murkyAlpha = 0.85;
            }

            if (murkyAlpha > 0) {
                ctx.fillStyle = `rgba(${fixedMurkyColor}, ${murkyAlpha})`;
                ctx.fillRect(0, 0, w, h);
            }

            // Reset filter
            ctx.filter = 'none';

            // 2. Draw Rising Bubbles (Kept as is: Visible & Frequent)
            ctx.globalCompositeOperation = 'source-over';

            ctx.shadowBlur = 2; // Slightly more blur
            ctx.shadowColor = isNight ? 'rgba(200, 230, 255, 0.5)' : 'rgba(255, 255, 255, 0.5)';

            ctx.fillStyle = isNight ? 'rgba(200, 230, 255, 1)' : 'rgba(255, 255, 255, 1)';

            for (const b of this.surfaceBubbles) {
                ctx.globalAlpha = b.alpha;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        } catch (e) {
            console.warn("Error drawing surface effects:", e);
            ctx.restore();
        }
    }
}
