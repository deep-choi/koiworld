import { Koi as KoiType, SpotShape, SpotPhenotype } from '../types';

interface Segment {
    x: number;
    y: number;
    angle: number;
}

export interface KoiColors {
    body: string;          // top of the body
    shade: string;         // crescent on the side away from the light
    light: string;         // crescent on the lit side
    fin: string;           // pectoral, pelvic and tail membranes (translucent)
    ray: string;           // tail rays and dorsal fin edges
    membrane: string;      // dorsal fin membrane
    ridge: string;         // line on the back where the dorsal fin roots
    whisker: string;
    accent: string | null; // tail stripe colour, taken from a spot near the tail
}

export interface RenderSpot {
    x: number;
    y: number;
    size: number;
    color: string;
    shape?: SpotShape;
}

interface SpinePoint {
    x: number;
    y: number;
    fx: number; // unit vector toward the head
    fy: number;
    nx: number; // unit normal, left of fx/fy
    ny: number;
}

const LEGACY_RENDER_SEGMENT_COUNT = 52;
const N = 27;
const PHYSICS_SEGMENT_COUNT = 27;

// Proportions (all in units of R = 19 * scale, the fin/tail reference radius)
const BODY_LENGTH_SCALE = 0.8;   // body is 20% shorter than the original 153px
const REFERENCE_RADIUS = 19;
const BODY_WIDTH = 1.22;         // body half-width relative to R
const TAIL_LENGTH = 2.3;
const LIGHT_X = -0.55;
// Largest bend allowed between neighbouring chain links (radians). Ordinary turns stay well under this
// (about 0.075 per link at the engine's turn limit), so it only stops the body folding during hard strikes;
// a lower value makes the whole body pivot like a board and whips the tail.
const MAX_LINK_BEND = 0.12;
const LIGHT_Y = -0.83;

// Rounded nose, full width at 27% of the length, slim peduncle.
const bodyProfile = (u: number): number => {
    if (u < 0.27) {
        const p = u / 0.27;
        return BODY_WIDTH * (0.76 + 0.24 * Math.pow(Math.sin(p * Math.PI / 2), 0.6));
    }
    const p = (u - 0.27) / 0.73;
    return BODY_WIDTH * (1 - 0.88 * Math.pow(p, 1.8));
};

const TAIL_SHAPE: ReadonlyArray<readonly [number, number]> = [
    [0.2, 0.25], [0.5, 0.44], [0.85, 0.6], [1.06, 0.6], [0.97, 0.42], [0.78, 0.2], [0.64, 0],
    [0.78, -0.2], [0.97, -0.42], [1.06, -0.6], [0.85, -0.6], [0.5, -0.44], [0.2, -0.25],
];

const OUTLINE_POINT_COUNT = N * 2 + 5;
const SCRATCH_SIZE = 64;

export class KoiRenderer {
    private readonly segmentCount = N;
    private readonly physicsSegmentCount = PHYSICS_SEGMENT_COUNT;
    private baseSpacing = 3.0 * BODY_LENGTH_SCALE;
    private spacing = this.baseSpacing;
    private segments: Segment[] = [];
    private physicsSegments: Segment[] = [];
    private scale = 1.0;
    private targetScale = 1.0;
    private startScale = 1.0;
    private scaleStartTime = 0;
    private readonly SCALE_DURATION = 5000;
    private readonly radiusCache = new Float64Array(N);

    // Render frame: physics chain plus the swimming wave, rebuilt on every update.
    private readonly px = new Float64Array(N);
    private readonly py = new Float64Array(N);
    private readonly fx = new Float64Array(N);
    private readonly fy = new Float64Array(N);
    private readonly outlineX = new Float64Array(OUTLINE_POINT_COUNT);
    private readonly outlineY = new Float64Array(OUTLINE_POINT_COUNT);
    private readonly bufX = new Float64Array(SCRATCH_SIZE);
    private readonly bufY = new Float64Array(SCRATCH_SIZE);
    private readonly bufX2 = new Float64Array(SCRATCH_SIZE);
    private readonly bufY2 = new Float64Array(SCRATCH_SIZE);
    private readonly sa: SpinePoint = { x: 0, y: 0, fx: 1, fy: 0, nx: 0, ny: 1 };
    private readonly sb: SpinePoint = { x: 0, y: 0, fx: 1, fy: 0, nx: 0, ny: 1 };

    private wavePhase = Math.random() * Math.PI * 2;
    private waveAmp = 0.25;
    private readonly seed = Math.random() * 10;
    private dorsalSide: number | null = null;

    private initialized = false;

    constructor() {
        this.rebuildRadiusCache();
    }

    public getScale(): number {
        return this.scale;
    }

    private get R(): number {
        return REFERENCE_RADIUS * this.scale;
    }

    private initSegments(x: number, y: number) {
        const physicsSpacing = this.getPhysicsSpacing();
        this.physicsSegments = [];
        for (let i = 0; i < this.physicsSegmentCount; i++) {
            this.physicsSegments.push({ x: x, y: y + i * physicsSpacing, angle: -Math.PI / 2 });
        }
        this.segments = this.physicsSegments;
        this.initialized = true;
        this.buildFrame();
    }

    private getPhysicsSpacing(): number {
        return this.spacing * (LEGACY_RENDER_SEGMENT_COUNT - 1) / (this.physicsSegmentCount - 1);
    }

    private getBodyLength(): number {
        return this.getPhysicsSpacing() * (N - 1);
    }

    public setScale(targetScale: number, immediate: boolean = false) {
        if (immediate) {
            this.scale = targetScale;
            this.targetScale = targetScale;
            this.spacing = this.baseSpacing * targetScale;
            this.rebuildRadiusCache();
            return;
        }

        if (this.targetScale === targetScale) return;

        this.startScale = this.scale;
        this.targetScale = targetScale;
        this.scaleStartTime = Date.now();
    }

    /**
     * 코이를 특정 위치에 특정 각도로 즉시 일직선으로 배치합니다. (정지 화면용)
     */
    public forceStaticState(x: number, y: number, angle: number) {
        this.spacing = this.baseSpacing * this.scale;
        const physicsSpacing = this.getPhysicsSpacing();
        this.physicsSegments = [];
        for (let i = 0; i < this.physicsSegmentCount; i++) {
            this.physicsSegments.push({
                x: x - Math.cos(angle) * i * physicsSpacing,
                y: y - Math.sin(angle) * i * physicsSpacing,
                angle: angle
            });
        }
        this.segments = this.physicsSegments;
        this.initialized = true;
        this.waveAmp = 0;
        this.buildFrame();
    }

    private rebuildRadiusCache() {
        const R = this.R;
        for (let index = 0; index < this.segmentCount; index++) {
            this.radiusCache[index] = bodyProfile(index / (this.segmentCount - 1)) * R;
        }
    }

    private getRadius(index: number): number {
        return this.radiusCache[index];
    }

    public update(koi: KoiType, dt: number, isAbsolutePosition: boolean = false) {
        let targetX, targetY;

        if (isAbsolutePosition) {
            targetX = koi.position.x;
            targetY = koi.position.y;
        } else {
            const worldScale = 20;
            targetX = koi.position.x * worldScale;
            targetY = koi.position.y * worldScale;
        }

        if (this.scale !== this.targetScale) {
            const now = Date.now();
            const elapsed = now - this.scaleStartTime;
            if (elapsed >= this.SCALE_DURATION) {
                this.scale = this.targetScale;
            } else {
                const progress = elapsed / this.SCALE_DURATION;
                this.scale = this.startScale + (this.targetScale - this.startScale) * progress;
            }
            this.spacing = this.baseSpacing * this.scale;
            this.rebuildRadiusCache();
        }

        if (!this.initialized) {
            this.initSegments(targetX, targetY);
        }

        const head = this.physicsSegments[0];

        const dx = targetX - head.x;
        const dy = targetY - head.y;
        const distanceSquared = dx * dx + dy * dy;

        const moveFactor = 6.0 * dt;

        if (distanceSquared > 100 * 100) {
            head.x = targetX;
            head.y = targetY;
        } else {
            head.x += dx * moveFactor;
            head.y += dy * moveFactor;
        }

        const speedSquared = koi.velocity.vx * koi.velocity.vx + koi.velocity.vy * koi.velocity.vy;
        if (speedSquared > 0.001 * 0.001) {
            const targetAngle = Math.atan2(koi.velocity.vy, koi.velocity.vx);

            let diff = targetAngle - head.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;

            const turnFactor = 3.6 * dt;
            head.angle += diff * turnFactor;
        }

        const physicsSpacing = this.getPhysicsSpacing();
        for (let i = 1; i < this.physicsSegmentCount; i++) {
            const cur = this.physicsSegments[i];
            const prev = this.physicsSegments[i - 1];
            const dx = cur.x - prev.x;
            const dy = cur.y - prev.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            // Direction the previous link points (toward the tail); the head link points backward from its heading.
            const prevAngle = i === 1 ? head.angle + Math.PI : prev.angle;
            let linkAngle = distance > 0.000001 ? Math.atan2(dy, dx) : prevAngle;

            // Stiffen the spine: a link may only turn a little relative to the one in front,
            // so sharp turns curve the whole body instead of folding it at one point.
            let bend = linkAngle - prevAngle;
            while (bend < -Math.PI) bend += Math.PI * 2;
            while (bend > Math.PI) bend -= Math.PI * 2;
            if (bend > MAX_LINK_BEND) linkAngle = prevAngle + MAX_LINK_BEND;
            else if (bend < -MAX_LINK_BEND) linkAngle = prevAngle - MAX_LINK_BEND;

            cur.x = prev.x + Math.cos(linkAngle) * physicsSpacing;
            cur.y = prev.y + Math.sin(linkAngle) * physicsSpacing;
            cur.angle = linkAngle;
        }

        // Swimming wave: faster and wider the faster the koi moves (speed measured in body radii).
        const speedInRadii = Math.sqrt(speedSquared) / Math.max(1, this.R);
        this.wavePhase += dt * (2.5 + Math.min(4, speedInRadii * 0.6));
        this.waveAmp = 0.15 + Math.min(0.15, speedInRadii * 0.03);

        this.buildFrame();
    }

    /** Physics chain + lateral swimming wave → render points with tangents. */
    private buildFrame() {
        const segs = this.segments;
        const last = N - 1;
        const R = this.R;
        // tangents of the physics chain
        for (let i = 0; i < N; i++) {
            const a = segs[Math.max(0, i - 1)], b = segs[Math.min(last, i + 1)];
            let dx = a.x - b.x, dy = a.y - b.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            dx /= len; dy /= len;
            const q = i / last;
            const w = Math.sin(this.wavePhase - q * 5) * this.waveAmp * R * 0.45 * q * q;
            this.px[i] = segs[i].x - dy * w;
            this.py[i] = segs[i].y + dx * w;
        }
        // tangents of the waved points
        for (let i = 0; i < N; i++) {
            const ia = Math.max(0, i - 1), ib = Math.min(last, i + 1);
            let dx = this.px[ia] - this.px[ib], dy = this.py[ia] - this.py[ib];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            this.fx[i] = dx / len;
            this.fy[i] = dy / len;
        }
    }

    /** Interpolated point on the spine at u (0 = nose, 1 = tail root). */
    private spineAt(u: number, out: SpinePoint): SpinePoint {
        const t = Math.max(0, Math.min(1, u)) * (N - 1);
        const i = Math.min(N - 2, Math.floor(t));
        const f = t - i;
        out.x = this.px[i] + (this.px[i + 1] - this.px[i]) * f;
        out.y = this.py[i] + (this.py[i + 1] - this.py[i]) * f;
        let fx = this.fx[i] * (1 - f) + this.fx[i + 1] * f;
        let fy = this.fy[i] * (1 - f) + this.fy[i + 1] * f;
        const len = Math.sqrt(fx * fx + fy * fy) || 1;
        fx /= len; fy /= len;
        out.fx = fx; out.fy = fy; out.nx = -fy; out.ny = fx;
        return out;
    }

    public getHeadPosition(): { x: number, y: number } {
        if (!this.initialized || this.segments.length === 0) return { x: 0, y: 0 };
        return { x: this.segments[0].x, y: this.segments[0].y };
    }

    public draw(ctx: CanvasRenderingContext2D, width: number, height: number, colors: KoiColors, spots: RenderSpot[], phenotype?: SpotPhenotype) {
        if (!this.initialized) return;
        const head = this.segments[0];
        ctx.save();
        ctx.translate(width / 2 - head.x, height / 2 - head.y);
        this.renderKoi(ctx, colors, spots, performance.now());
        ctx.restore();
    }

    public hitTest(x: number, y: number, hitMargin: number = 0): boolean {
        if (!this.initialized || this.segments.length === 0) return false;

        const points: { x: number, y: number }[] = [];

        for (let i = 0; i < this.segmentCount; i++) {
            const r = this.getRadius(i) + hitMargin;
            const s = this.segments[i];
            const angle = s.angle + Math.PI / 2;
            points.push({
                x: s.x + Math.cos(angle) * r,
                y: s.y + Math.sin(angle) * r
            });
        }

        for (let i = this.segmentCount - 1; i >= 0; i--) {
            const r = this.getRadius(i) + hitMargin;
            const s = this.segments[i];
            const angle = s.angle - Math.PI / 2;
            points.push({
                x: s.x + Math.cos(angle) * r,
                y: s.y + Math.sin(angle) * r
            });
        }

        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;

            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    public drawShadow(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number) {
        if (!this.initialized) return;

        this.buildOutline(0.95);
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        this.appendSmoothPath(ctx, this.outlineX, this.outlineY, OUTLINE_POINT_COUNT, offsetX, offsetY);
        ctx.fill();
        ctx.restore();
    }

    public drawWorld(ctx: CanvasRenderingContext2D, colors: KoiColors, spots: RenderSpot[], isSelected: boolean = false, time: number = performance.now(), phenotype?: SpotPhenotype) {
        if (!this.initialized) return;

        if (isSelected) {
            this.drawSelectionOutline(ctx);
        }

        this.renderKoi(ctx, colors, spots, time);
    }

    private drawSelectionOutline(ctx: CanvasRenderingContext2D) {
        ctx.save();
        ctx.beginPath();

        const outerPoints: { x: number, y: number }[] = [];

        for (let i = 0; i < this.segmentCount; i++) {
            const r = this.getRadius(i) + 8;
            const s = this.segments[i];
            const angle = s.angle + Math.PI / 2;
            outerPoints.push({ x: s.x + Math.cos(angle) * r, y: s.y + Math.sin(angle) * r });
        }

        for (let i = this.segmentCount - 1; i >= 0; i--) {
            const r = this.getRadius(i) + 8;
            const s = this.segments[i];
            const angle = s.angle - Math.PI / 2;
            outerPoints.push({ x: s.x + Math.cos(angle) * r, y: s.y + Math.sin(angle) * r });
        }

        if (outerPoints.length > 0) {
            ctx.moveTo(outerPoints[0].x, outerPoints[0].y);
            for (let i = 1; i < outerPoints.length; i++) {
                ctx.lineTo(outerPoints[i].x, outerPoints[i].y);
            }
            ctx.closePath();

            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);
            ctx.stroke();

            ctx.shadowColor = '#ffff00';
            ctx.shadowBlur = 15;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    /** time in milliseconds */
    private renderKoi(ctx: CanvasRenderingContext2D, colors: KoiColors, spots: RenderSpot[], time: number) {
        const t = time / 1000;
        const R = this.R;
        // Level of detail: fry and very small koi skip rays, whiskers and the highlight.
        const detail = this.scale >= 0.35;

        ctx.save();

        // 0. Fins & tail under the body
        const flap = Math.sin(t * 2.2 + this.seed) * 0.16;
        this.drawSideFin(ctx, 0.5, 1, 0.36, 0.5, -flap * 0.5, colors.fin, detail);
        this.drawSideFin(ctx, 0.5, -1, 0.36, 0.5, -flap * 0.5, colors.fin, detail);
        this.drawTail(ctx, colors, detail);
        this.drawSideFin(ctx, 0.19, 1, 0.68, 0.05, flap * 0.6, colors.fin, detail);
        this.drawSideFin(ctx, 0.19, -1, 0.68, 0.05, flap * 0.6, colors.fin, detail);

        // 1. Body
        this.buildOutline(1);
        ctx.beginPath();
        this.appendSmoothPath(ctx, this.outlineX, this.outlineY, OUTLINE_POINT_COUNT);
        ctx.fillStyle = colors.body;
        ctx.fill();

        ctx.save();
        ctx.clip();

        // 2. Patterns, bent along the body
        if (spots && spots.length > 0) {
            const bodyLength = this.getBodyLength();
            for (let i = 0; i < spots.length; i++) {
                const count = this.buildSpot(spots[i], i, bodyLength);
                ctx.beginPath();
                this.appendSmoothPath(ctx, this.bufX, this.bufY, count);
                ctx.fillStyle = spots[i].color;
                ctx.fill();
            }
        }

        // 3. Two-tone shading: crescents made by shifting the outline toward / away from the light
        const d = R * 0.42;
        this.fillCrescent(ctx, LIGHT_X * d, LIGHT_Y * d, colors.shade);
        if (detail) this.fillCrescent(ctx, -LIGHT_X * d * 0.6, -LIGHT_Y * d * 0.6, colors.light);

        ctx.restore();

        // 4. Dorsal fin, eyes, whiskers
        this.drawDorsal(ctx, colors, t, detail);
        this.drawEyes(ctx);
        if (detail) this.drawWhiskers(ctx, colors.whisker, t);

        ctx.restore();
    }

    /** Body outline: left edge head→tail, right edge tail→head, rounded nose cap. */
    private buildOutline(radiusScale: number) {
        let k = 0;
        for (let i = 0; i < N; i++) {
            const r = this.radiusCache[i] * radiusScale;
            this.outlineX[k] = this.px[i] - this.fy[i] * r;
            this.outlineY[k] = this.py[i] + this.fx[i] * r;
            k++;
        }
        for (let i = N - 1; i >= 0; i--) {
            const r = this.radiusCache[i] * radiusScale;
            this.outlineX[k] = this.px[i] + this.fy[i] * r;
            this.outlineY[k] = this.py[i] - this.fx[i] * r;
            k++;
        }
        const r0 = this.radiusCache[0] * radiusScale;
        const fx = this.fx[0], fy = this.fy[0], nx = -fy, ny = fx;
        for (let j = 1; j < 6; j++) {
            const a = -Math.PI / 2 + j * Math.PI / 6;
            const c = Math.cos(a) * r0 * 1.08, s = Math.sin(a) * r0;
            this.outlineX[k] = this.px[0] + fx * c + nx * s;
            this.outlineY[k] = this.py[0] + fy * c + ny * s;
            k++;
        }
    }

    /** Closed curve through the midpoints of consecutive points. */
    private appendSmoothPath(ctx: CanvasRenderingContext2D, xs: Float64Array, ys: Float64Array, count: number, dx: number = 0, dy: number = 0) {
        ctx.moveTo((xs[count - 1] + xs[0]) / 2 + dx, (ys[count - 1] + ys[0]) / 2 + dy);
        for (let i = 0; i < count; i++) {
            const j = (i + 1) % count;
            ctx.quadraticCurveTo(xs[i] + dx, ys[i] + dy, (xs[i] + xs[j]) / 2 + dx, (ys[i] + ys[j]) / 2 + dy);
        }
        ctx.closePath();
    }

    /** Fills the part of the (already clipped) body outside a shifted copy of the outline. */
    private fillCrescent(ctx: CanvasRenderingContext2D, dx: number, dy: number, color: string) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-1e5, -1e5, 2e5, 2e5);
        this.appendSmoothPath(ctx, this.outlineX, this.outlineY, OUTLINE_POINT_COUNT, dx, dy);
        ctx.clip('evenodd');
        ctx.fillStyle = color;
        ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
        ctx.restore();
    }

    /**
     * Spot outline in body coordinates, so it bends with the koi. Stretched along the body;
     * the shape gene sets how wobbly the edge is. Points past the nose or the tail tip continue
     * along the end tangent (clamping them would cut the pattern flat).
     */
    private buildSpot(spot: RenderSpot, index: number, bodyLength: number): number {
        const u = spot.y / 100;
        const v = (spot.x / 100 - 0.5) * 2;
        const ru = bodyProfile(Math.max(0, Math.min(1, u))) * this.R;
        const size = (spot.size / 100) * ru * 1.3;
        const seed = spot.x * 0.37 + spot.y * 0.91 + index;
        const shape = spot.shape || SpotShape.CIRCLE;
        const elongation = shape === SpotShape.OVAL_H ? 1.9 : 1.35;
        const across = shape === SpotShape.OVAL_H ? 0.7 : 1;
        const wobble = shape === SpotShape.CIRCLE ? 0.08 : shape === SpotShape.HEXAGON ? 0.12 : 0.2;
        const lobes = shape === SpotShape.HEXAGON ? 6 : 3;
        const K = 18;
        const p = this.sa;
        for (let k = 0; k < K; k++) {
            const th = (k / K) * Math.PI * 2;
            const rad = 1 + wobble * Math.sin(th * lobes + seed) + 0.1 * Math.cos(th * 5 + seed * 2);
            const along = Math.cos(th) * rad * size * elongation;
            const side = Math.sin(th) * rad * size * across;
            const uu = u - along / bodyLength;
            this.spineAt(uu, p);
            const over = uu < 0 ? -uu * bodyLength : uu > 1 ? -(uu - 1) * bodyLength : 0;
            const off = v * ru + side;
            this.bufX[k] = p.x + p.fx * over + p.nx * off;
            this.bufY[k] = p.y + p.fy * over + p.ny * off;
        }
        return K;
    }

    /**
     * Pectoral / pelvic fin: the original leaf (two quadratic curves to a swept-back point)
     * with white rays fanned across the whole outer edge, stopping just inside it.
     * size: leaf scale; offset: angle turning the fin back toward the tail.
     */
    private drawSideFin(ctx: CanvasRenderingContext2D, u: number, side: number, size: number, offset: number, flap: number, color: string, detail: boolean) {
        const s = this.spineAt(u, this.sa);
        const r = bodyProfile(u) * this.R;
        const ox = s.nx * side, oy = s.ny * side;
        const rootX = s.x + ox * r * 0.85, rootY = s.y + oy * r * 0.85;
        const a = offset + flap, c = Math.cos(a), sn = Math.sin(a);
        const Xx = -s.fx * c - ox * sn, Xy = -s.fy * c - oy * sn; // backward, turned in by the offset
        const Yx = ox * c - s.fx * sn, Yy = oy * c - s.fy * sn;   // outward
        const g = size * this.R / 24;
        const W = (lx: number, ly: number, i: number) => {
            this.bufX2[i] = rootX + (Xx * lx + Yx * ly) * g;
            this.bufY2[i] = rootY + (Xy * lx + Yy * ly) * g;
        };
        W(0, 0, 0); W(5, 30, 1); W(45, 60, 2); W(55, 40, 3); W(35, 10, 4);
        const X = this.bufX2, Y = this.bufY2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(X[0], Y[0]);
        ctx.quadraticCurveTo(X[1], Y[1], X[2], Y[2]);
        ctx.quadraticCurveTo(X[3], Y[3], X[4], Y[4]);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        if (detail) {
            ctx.clip();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = Math.max(0.5, this.R * 0.035);
            ctx.lineCap = 'round';
            ctx.beginPath();
            // 4 rays toward the leading edge, 7 toward the tip and trailing edge
            for (let k = 0; k < 11; k++) {
                let ex: number, ey: number;
                if (k < 4) {
                    const q = 0.5 + k * 0.14, iq = 1 - q;
                    ex = iq * iq * X[0] + 2 * iq * q * X[1] + q * q * X[2];
                    ey = iq * iq * Y[0] + 2 * iq * q * Y[1] + q * q * Y[2];
                } else {
                    const q = 0.04 + (k - 4) * 0.13, iq = 1 - q;
                    ex = iq * iq * X[2] + 2 * iq * q * X[3] + q * q * X[4];
                    ey = iq * iq * Y[2] + 2 * iq * q * Y[3] + q * q * Y[4];
                }
                ctx.moveTo(X[0] + (ex - X[0]) * 0.08, Y[0] + (ey - Y[0]) * 0.08);
                ctx.lineTo(X[0] + (ex - X[0]) * 0.93, Y[0] + (ey - Y[0]) * 0.93);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Forked tail that carries on the body wave; an accent stripe when a spot sits near the tail. */
    private drawTail(ctx: CanvasRenderingContext2D, colors: KoiColors, detail: boolean) {
        const s = this.spineAt(1, this.sb);
        const R = this.R;
        const T = TAIL_LENGTH * R;
        const bx = -s.fx, by = -s.fy, nx = s.nx, ny = s.ny;
        const sx = s.x, sy = s.y;
        const phase = this.wavePhase, amp = this.waveAmp;
        const W = (x: number, y: number, out: Float64Array, outY: Float64Array, i: number) => {
            const q = x / T;
            const w = Math.sin(phase - (1 + q * 0.9) * 2.6) * amp * R * 0.7 * q;
            out[i] = sx + bx * x + nx * (y + w);
            outY[i] = sy + by * x + ny * (y + w);
        };

        let k = 0;
        W(0, 0.16 * R, this.bufX, this.bufY, k++);
        for (const [x, y] of TAIL_SHAPE) W(x * T, y * T, this.bufX, this.bufY, k++);
        W(0, -0.16 * R, this.bufX, this.bufY, k++);

        ctx.save();
        ctx.beginPath();
        this.appendSmoothPath(ctx, this.bufX, this.bufY, k);
        ctx.fillStyle = colors.fin;
        ctx.fill();
        ctx.clip();

        ctx.lineCap = 'round';
        if (colors.accent) {
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = T * 0.13;
            ctx.globalAlpha = 0.7;
            for (const sgn of [1, -1]) {
                ctx.beginPath();
                for (let j = 0; j <= 10; j++) {
                    const q = j / 10;
                    W(q * 0.95 * T, sgn * (0.06 + q * 0.4) * T, this.bufX2, this.bufY2, 0);
                    if (j) ctx.lineTo(this.bufX2[0], this.bufY2[0]); else ctx.moveTo(this.bufX2[0], this.bufY2[0]);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
        if (detail) {
            ctx.strokeStyle = colors.ray;
            ctx.lineWidth = Math.max(0.7, R * 0.05);
            ctx.beginPath();
            for (let r = 0; r <= 8; r++) {
                const y = (-0.56 + r * 0.14) * T;
                const xe = Math.min(1.02 * T, 0.64 * T + 0.75 * Math.abs(y));
                for (let j = 0; j <= 8; j++) {
                    const q = j / 8;
                    W(xe * q, y * Math.pow(q, 0.8), this.bufX2, this.bufY2, 0);
                    if (j) ctx.lineTo(this.bufX2[0], this.bufY2[0]); else ctx.moveTo(this.bufX2[0], this.bufY2[0]);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    /**
     * Dorsal fin: a long, low translucent sail from behind the head to above the peduncle.
     * It lies to one side of the back, flops over slowly when the body bends the other way,
     * and ripples with the swimming wave.
     */
    private drawDorsal(ctx: CanvasRenderingContext2D, colors: KoiColors, t: number, detail: boolean) {
        const a = 0.2, b = 0.86, M = 22;
        const R = this.R;
        const sa = this.spineAt(0.28, this.sa);
        const afx = sa.fx, afy = sa.fy;
        const sb = this.spineAt(0.66, this.sb);
        const bend = afx * sb.fy - afy * sb.fx;
        const target = Math.abs(bend) > 0.04 ? -Math.sign(bend) : ((this.dorsalSide ?? 1) >= 0 ? 1 : -1);
        if (this.dorsalSide === null) this.dorsalSide = target;
        this.dorsalSide += (target - this.dorsalSide) * 0.06;
        const flop = this.dorsalSide;

        // base on the spine → bufX/bufY, free edge → bufX2/bufY2
        for (let j = 0; j <= M; j++) {
            const q = j / M;
            const s = this.spineAt(a + (b - a) * q, this.sa);
            const hp = Math.sin(Math.min(1, q / 0.14) * Math.PI / 2) * (1 - 0.6 * q) * (q > 0.88 ? 1 - (q - 0.88) / 0.12 * 0.75 : 1);
            const h = R * 0.36 * hp;
            const side = flop * 0.78 + Math.sin(this.wavePhase * 0.9 - q * 4.5) * 0.12;
            const rake = 0.3 * h;
            this.bufX[j] = s.x;
            this.bufY[j] = s.y;
            this.bufX2[j] = s.x + s.nx * side * h - s.fx * rake;
            this.bufY2[j] = s.y + s.ny * side * h - s.fy * rake;
        }
        const BX = this.bufX, BY = this.bufY, TX = this.bufX2, TY = this.bufY2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(BX[0], BY[0]);
        for (let j = 1; j <= M; j++) ctx.lineTo(BX[j], BY[j]);
        for (let j = M; j >= 0; j--) {
            const n = Math.max(0, j - 1);
            ctx.quadraticCurveTo(TX[j], TY[j], (TX[j] + TX[n]) / 2, (TY[j] + TY[n]) / 2);
        }
        ctx.closePath();
        ctx.fillStyle = colors.membrane;
        ctx.fill();

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (detail) {
            ctx.save();
            ctx.clip();
            ctx.strokeStyle = colors.ray;
            ctx.lineWidth = Math.max(0.6, R * 0.05);
            ctx.beginPath();
            for (let j = 0; j < M - 1; j += 2) {
                const e = Math.min(M, j + 3);
                ctx.moveTo(BX[j], BY[j]);
                ctx.lineTo(TX[e], TY[e]);
            }
            ctx.stroke();
            ctx.restore();
        }
        // free edge and the stiff leading ray
        ctx.strokeStyle = colors.ray;
        ctx.lineWidth = Math.max(0.6, R * 0.045);
        ctx.beginPath();
        ctx.moveTo(TX[0], TY[0]);
        for (let j = 1; j <= M; j++) ctx.lineTo(TX[j], TY[j]);
        ctx.stroke();
        ctx.lineWidth = Math.max(0.9, R * 0.08);
        ctx.beginPath();
        ctx.moveTo(BX[0], BY[0]);
        ctx.quadraticCurveTo(TX[0], TY[0], TX[2], TY[2]);
        ctx.stroke();
        // ridge where the fin roots
        ctx.strokeStyle = colors.ridge;
        ctx.lineWidth = Math.max(1, R * 0.1);
        ctx.beginPath();
        ctx.moveTo(BX[0], BY[0]);
        for (let j = 1; j <= M; j++) ctx.lineTo(BX[j], BY[j]);
        ctx.stroke();
        ctx.restore();
    }

    /** Short barbels from the corners of the mouth, drooping back along the cheeks. */
    private drawWhiskers(ctx: CanvasRenderingContext2D, color: string, t: number) {
        const R = this.R;
        const r0 = this.radiusCache[0];
        const fx = this.fx[0], fy = this.fy[0], nx = -fy, ny = fx;
        const length = R * 0.62, M = 10;
        ctx.save();
        ctx.fillStyle = color;
        for (const side of [1, -1]) {
            const sway = Math.sin(t * 2.5 + side * 1.3) * 0.12;
            let x = this.px[0] + fx * r0 * 0.88 + nx * side * r0 * 0.5;
            let y = this.py[0] + fy * r0 * 0.88 + ny * side * r0 * 0.5;
            for (let k = 0; k <= M; k++) {
                const q = k / M;
                const ang = 1.3 + (0.85 + sway) * q; // from forward toward this side, bending back
                const dx = fx * Math.cos(ang) + nx * side * Math.sin(ang);
                const dy = fy * Math.cos(ang) + ny * side * Math.sin(ang);
                const w = R * 0.045 * (1 - q) + R * 0.007;
                this.bufX[k] = x - dy * w; this.bufY[k] = y + dx * w;
                this.bufX2[k] = x + dy * w; this.bufY2[k] = y - dx * w;
                x += dx * length / M;
                y += dy * length / M;
            }
            ctx.beginPath();
            ctx.moveTo(this.bufX[0], this.bufY[0]);
            for (let k = 1; k <= M; k++) ctx.lineTo(this.bufX[k], this.bufY[k]);
            for (let k = M; k >= 0; k--) ctx.lineTo(this.bufX2[k], this.bufY2[k]);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    /** Original eye design (flattened half-ellipse, white rim, tilted forward), set slightly inside the head edge. */
    private drawEyes(ctx: CanvasRenderingContext2D) {
        const headAngle = Math.atan2(this.fy[0], this.fx[0]);
        const headRadius = this.radiusCache[0];
        const eyeDist = headRadius * 0.82;
        const eyeSize = this.R * (4.6 / 24);
        const borderSize = this.R * (1.7 / 24);
        const flattenX = 0.6;
        const eyeRotationOffset = Math.PI / 8;

        ctx.save();
        for (const side of [1, -1]) {
            const eyeAngle = headAngle + side * Math.PI / 2.2;
            const ex = this.px[0] + Math.cos(eyeAngle) * eyeDist;
            const ey = this.py[0] + Math.sin(eyeAngle) * eyeDist;
            const rotation = eyeAngle - side * eyeRotationOffset;

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(ex, ey, (eyeSize + borderSize) * flattenX, eyeSize + borderSize, rotation, -Math.PI / 2, Math.PI / 2);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.ellipse(ex, ey, eyeSize * flattenX, eyeSize, rotation, -Math.PI / 2, Math.PI / 2);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
}
