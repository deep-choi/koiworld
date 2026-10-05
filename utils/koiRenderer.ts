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
    motoguro?: MotoguroColors; // roots of the pectoral, pelvic and tail fins, only on koi that express motoguro
    finLength?: number;    // hirenaga: side fins and tail stretched by this factor (1 = normal)
    ginrin?: number;       // ginrin: 0-1, share of scales that sparkle
    doitsu?: boolean;      // doitsu: hexagonal scale rows replace the small scales
}

export interface MotoguroColors {
    root: string;          // at the fin root
    mid: string;
    edge: string;          // fully transparent, where the colour ends
}

export interface RenderSpot {
    x: number;
    y: number;
    size: number;
    color: string;
    shape?: SpotShape;
    koromo?: string;       // koromo: colour of the scale net drawn over this pattern
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
const BODY_LENGTH_SCALE = 1.06;  // body is 6% longer than the original 153px
const REFERENCE_RADIUS = 19;
const BODY_WIDTH = 1.4;        // body half-width relative to R
const TAIL_LENGTH = 2.3;
const LIGHT_X = -0.55;
// Largest bend allowed between neighbouring chain links (radians). Ordinary turns stay well under this
// (about 0.075 per link at the engine's turn limit), so it only stops the body folding during hard strikes;
// a lower value makes the whole body pivot like a board and whips the tail.
const MAX_LINK_BEND = 0.12;
// 몸통의 곡률 제한만 적용하면 느린 이동 중 제약이 풀리는 순간 꼬리가 크게
// 튈 수 있습니다. 각 마디가 돌아가는 속도도 시간 기준으로 제한합니다.
const MAX_LINK_TURN_RATE = 3.2;
const LIGHT_Y = -0.83;

// Rounded head, widest across the chest just behind the pectoral fins, slim peduncle.
// The head widens from NOSE_WIDTH at u = 0 to CHEST_WIDTH at CHEST_U along a cubic that leaves u = 0
// at HEAD_START_SLOPE (a steep start made the head flare right behind the mouth; MOUTH_SHAPE picks up
// about the same slope, so mouth and head run together without a bend) and arrives flat at the chest.
const CHEST_U = 0.2;
const CHEST_WIDTH = 1.05;         // widest point, of BODY_WIDTH
const NOSE_WIDTH = 0.8;           // width at u = 0 (where the eyes sit), of BODY_WIDTH
const HEAD_START_SLOPE = 2.0;     // d(width)/du at u = 0, of BODY_WIDTH
const TAIL_END_WIDTH = 0.12;      // width where the tail fin starts, of BODY_WIDTH

// One side of the mouth, from just ahead of the head edge at u = 0 to the tip on the axis
// (x: ahead of u = 0, y: out from the axis, both in widths at u = 0). The snout narrows, pinches in
// just behind the mouth and swells again into small rounded lips; buildOutline mirrors it for the other side.
const MOUTH_SHAPE: ReadonlyArray<readonly [number, number]> = [
    [0.26, 0.89], [0.5, 0.79], [0.69, 0.67], [0.81, 0.53],
    [0.87, 0.47],                                 // soft pinch behind the lips
    [0.94, 0.46], [1.0, 0.41],                    // lips
    [1.05, 0.3], [1.09, 0.15], [1.1, 0],
];
const NOSE_LENGTH = MOUTH_SHAPE[MOUTH_SHAPE.length - 1][0];  // how far the mouth reaches past u = 0
const NOSE_CAP_POINTS = MOUTH_SHAPE.length * 2 - 1;

const bodyProfile = (u: number): number => {
    if (u < CHEST_U) {
        const t = Math.max(0, u) / CHEST_U, t2 = t * t, t3 = t2 * t;
        return BODY_WIDTH * (
            (2 * t3 - 3 * t2 + 1) * NOSE_WIDTH
            + (t3 - 2 * t2 + t) * CHEST_U * HEAD_START_SLOPE
            + (3 * t2 - 2 * t3) * CHEST_WIDTH
        );
    }
    const p = (u - CHEST_U) / (1 - CHEST_U);
    return BODY_WIDTH * CHEST_WIDTH * (1 - (1 - TAIL_END_WIDTH / CHEST_WIDTH) * Math.pow(p, 1.65));
};

const TAIL_SHAPE: ReadonlyArray<readonly [number, number]> = [
    [0.2, 0.25], [0.5, 0.44], [0.85, 0.6], [1.06, 0.6], [0.97, 0.42], [0.78, 0.2], [0.64, 0],
    [0.78, -0.2], [0.97, -0.42], [1.06, -0.6], [0.85, -0.6], [0.5, -0.44], [0.2, -0.25],
];

// Hirenaga (finLength > 1): fins grow back by finLength and outward by this share of the extra length,
// and their edge ripples by up to this many fin-space units per unit of extra length.
const FIN_SPREAD = 0.4;
const FIN_RIPPLE = 4;
const tailStretch = (finLength: number) => 1 + (finLength - 1) * 0.95;

// Side fin outline in fin space (x: back toward the tail, y: out from the body), smoothed through midpoints.
// Wide base from (0,0) to (34,0), reaching almost straight out to a blunt, rounded end.
const SIDE_FIN_SHAPE: ReadonlyArray<readonly [number, number]> = [
    [0, 0], [1, 24], [4, 44], [10, 53], [19, 55], [27, 50], [31, 40], [33, 26], [35, 12], [34, 0],
];

// Fan-shaped pectoral fins: a narrow root opening into a circular arc that spreads from almost straight
// out (0.1 rad) back toward the tail (1.2 rad). The rays in drawSideFin run to the arc midpoints.
const PECTORAL_FIN_U = 0.15;      // where the pectoral fins attach along the body
const PELVIC_FIN_U = 0.6;         // where the pelvic fins attach along the body
const PECTORAL_FIN_SIZE = 0.85;
const PELVIC_FIN_SIZE = 0.43;
const PECTORAL_FAN_RADIUS = 52;
const PECTORAL_FAN_ARC_POINTS = 8;
const PECTORAL_FIN_SHAPE: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    ...Array.from({ length: PECTORAL_FAN_ARC_POINTS }, (_, k): [number, number] => {
        const angle = 0.1 + 1.1 * k / (PECTORAL_FAN_ARC_POINTS - 1);
        return [4 + Math.sin(angle) * PECTORAL_FAN_RADIUS, Math.cos(angle) * PECTORAL_FAN_RADIUS];
    }),
    [10, 0],
];

// Scale grid for the scale arcs (and the ginrin and koromo lines on them). Classic fish-scale tiling:
// circles of radius SCALE_RADIUS (in units of R), 2 radii apart across the body, rows one radius
// apart along it and shifted by a radius on alternate rows.
const SCALE_RADIUS = 0.28;
const SCALE_START_U = 0.06;      // scale arcs start just behind the head
// Koi drawn smaller than this scale (the fry in the pond) skip the small scales and the whiskers.
const FINE_DETAIL_SCALE = 0.35;
// Doitsu: a honeycomb band of hexagonal scales touching along the spine (two interlocking columns),
// from DOITSU_START_U to DOITSU_END_U, radius DOITSU_SIZE (in R) in the middle of the band, shrinking by
// up to DOITSU_TAPER toward both ends. Points face across the body, like the pattern cells.
// The fill is a see-through grey, so each scale reads a shade darker than whatever lies under it.
const DOITSU_START_U = 0.14;
const DOITSU_END_U = 0.88;
const DOITSU_SIZE = 0.27;
const DOITSU_TAPER = 0.45;
const DOITSU_FILL = 'rgba(35, 38, 46, 0.24)';
const DOITSU_EDGE = 'rgba(35, 38, 46, 0.08)';  // over the fill: only just darker than the scale
// Ginrin: share of scales with a silver edge at ginrin 1. Silver rather than white, so it reads on
// white and cream bodies too.
const GINRIN_MAX_SHARE = 0.6;
const GINRIN_SILVER = 'rgba(214, 228, 240, 0.7)';
/** Stable pseudo-random 0-1 per scale, so the same scales glint on the same koi every frame. */
const scaleHash = (row: number, column: number, seed: number): number => {
    const s = Math.sin(row * 127.1 + column * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
};
const SPOT_SIZE_SCALE = 1.0;
/**
 * Drawn spot size from the size gene: the gene range 30-80 is drawn as 20-80 (was size / 100),
 * which widens the spread so small spots get smaller. Older genes above 80 cap at 80.
 */
const spotDisplaySize = (size: number): number =>
    Math.min(0.8, Math.max(0.2, 0.2 + (size - 30) * 0.012));
// Patterns are built from small hexagon cells (circumradius, in units of R).
// Points face across the body and flat sides face the head and tail, so pattern sides get a shallow
// zigzag while the head and tail ends step in rows.
const SPOT_CELL_SIZE = 0.2;
const SPOT_CELL_HALF_HEIGHT = SPOT_CELL_SIZE * Math.sqrt(3) / 2;

/** First lattice column (in units of R) at or beyond -half; odd rows are shifted by one radius. */
const firstScaleColumn = (half: number, row: number): number => {
    const shift = row % 2 ? SCALE_RADIUS : 0;
    return shift + Math.ceil((-half - shift) / (2 * SCALE_RADIUS)) * 2 * SCALE_RADIUS;
};

interface SpotParams {
    u: number;
    b: number;          // lateral centre, in units of R
    size: number;       // in units of R
    elongation: number;
    across: number;
    wobble: number;
    lobes: number;
    seed: number;
}

const OUTLINE_POINT_COUNT = N * 2 + NOSE_CAP_POINTS;
const SCRATCH_SIZE = 64;
const SCALE_ARC_SPAN = Math.PI / 2 + 0.15;
// Two quadratic sections approximate each tiny arc. Balance inward/outward radial error;
// the maximum error is 1.2% of a scale radius (under 0.07 px at ordinary pond sizes).
const SCALE_CURVES = (() => {
    const halfAngle = SCALE_ARC_SPAN / 2, c = Math.cos(halfAngle), sine2 = 1 - c * c;
    let low = 2 - c, high = 1 / c;
    for (let i = 0; i < 32; i++) {
        const control = (low + high) / 2, a = (c + control) / 2, b = (control - c) / 2;
        const z = Math.max(0, Math.min(1, (2 * a * b - sine2) / (2 * b * b)));
        const minimum = Math.sqrt((a - b * z) ** 2 + sine2 * z);
        if (a + minimum > 2) high = control; else low = control;
    }
    const factor = (low + high) / 2;
    return Array.from({ length: 2 }, (_, i) => {
        const start = -SCALE_ARC_SPAN + SCALE_ARC_SPAN * i;
        const end = start + SCALE_ARC_SPAN, midpoint = (start + end) / 2;
        return [Math.cos(midpoint) * factor, Math.sin(midpoint) * factor, Math.cos(end), Math.sin(end)];
    });
})();

interface ScaleRow {
    u: number;
    first: number;
    count: number;
    hashes: number[];
}

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
    private outlineMinX = 0;
    private outlineMinY = 0;
    private outlineMaxX = 0;
    private outlineMaxY = 0;
    private readonly bufX = new Float64Array(SCRATCH_SIZE);
    private readonly bufY = new Float64Array(SCRATCH_SIZE);
    private readonly bufX2 = new Float64Array(SCRATCH_SIZE);
    private readonly bufY2 = new Float64Array(SCRATCH_SIZE);
    private readonly selX = new Float64Array(80);
    private readonly selY = new Float64Array(80);
    private readonly sa: SpinePoint = { x: 0, y: 0, fx: 1, fy: 0, nx: 0, ny: 1 };
    // Hexagon cells covered by each pattern, in body coordinates (u along, v across in units of R).
    // Rebuilt only when the spots array changes: they stay put in body coordinates while the koi bends.
    private spotCellsFor: RenderSpot[] | null = null;
    private spotCellU: number[] = [];
    private spotCellV: number[] = [];
    private spotCellSpot: number[] = [];
    private spotContours: number[][][] = [];
    private spotVertexU: number[] = [];
    private spotVertexV: number[] = [];
    private spotVertexSample: number[] = [];
    private spotSamples: SpinePoint[] = [];
    private spotSampleU: number[] = [];
    private spotX: number[] = [];
    private spotY: number[] = [];
    private scaleRows: ScaleRow[] | null = null;
    private scaleArcPath: Path2D | null = null;
    private scaleArcSpan = 0;
    private readonly sb: SpinePoint = { x: 0, y: 0, fx: 1, fy: 0, nx: 0, ny: 1 };

    private wavePhase = Math.random() * Math.PI * 2;
    private waveAmp = 0.25;
    private readonly seed = Math.random() * 10;
    private dorsalSide: number | null = null;
    private time = 0;  // seconds, for details that move on their own (hirenaga fin edges)

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

    private initSegments(x: number, y: number, angle: number) {
        const physicsSpacing = this.getPhysicsSpacing();
        this.physicsSegments = [];
        for (let i = 0; i < this.physicsSegmentCount; i++) {
            this.physicsSegments.push({
                x: x - Math.cos(angle) * i * physicsSpacing,
                y: y - Math.sin(angle) * i * physicsSpacing,
                angle: i === 0 ? angle : angle + Math.PI,
            });
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
                angle: i === 0 ? angle : angle + Math.PI,
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

        const speedSquared = koi.velocity.vx * koi.velocity.vx + koi.velocity.vy * koi.velocity.vy;
        if (!this.initialized) {
            // 처음부터 이동 방향에 맞춰 배치해 생성 직후의 불필요한 큰 회전을 막습니다.
            const angle = speedSquared > 0.001 * 0.001 ? Math.atan2(koi.velocity.vy, koi.velocity.vx) : -Math.PI / 2;
            this.initSegments(targetX, targetY, angle);
        }

        const head = this.physicsSegments[0];

        const dx = targetX - head.x;
        const dy = targetY - head.y;
        const distanceSquared = dx * dx + dy * dy;

        const moveFactor = 1 - Math.exp(-6.0 * dt);

        if (distanceSquared > 100 * 100) {
            // 화면 가장자리 순환 등 큰 위치 변경에서는 몸 전체를 함께 옮깁니다.
            // 머리만 이동시키면 꼬리가 이전 위치에서 급하게 접혀 따라오게 됩니다.
            for (const segment of this.physicsSegments) {
                segment.x += dx;
                segment.y += dy;
            }
        } else {
            head.x += dx * moveFactor;
            head.y += dy * moveFactor;
        }

        if (speedSquared > 0.001 * 0.001) {
            const targetAngle = Math.atan2(koi.velocity.vy, koi.velocity.vx);

            let diff = targetAngle - head.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;

            const turnFactor = 1 - Math.exp(-3.6 * dt);
            head.angle += diff * turnFactor;
        }

        const physicsSpacing = this.getPhysicsSpacing();
        const maxLinkTurn = MAX_LINK_TURN_RATE * dt;
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

            // 목표 곡률까지 한 프레임에 강제로 돌리지 않고, 기존 각도에서 부드럽게
            // 따라갑니다. 물결 애니메이션은 별도로 그대로 적용하므로 살랑임은 유지됩니다.
            let turn = linkAngle - cur.angle;
            while (turn < -Math.PI) turn += Math.PI * 2;
            while (turn > Math.PI) turn -= Math.PI * 2;
            linkAngle = cur.angle + Math.max(-maxLinkTurn, Math.min(maxLinkTurn, turn));

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
            this.drawSelectionOutline(ctx, colors.finLength ?? 1);
        }

        this.renderKoi(ctx, colors, spots, time);
    }

    /**
     * Dashed yellow outline around the whole koi: body, pectoral/pelvic fins and tail,
     * following the drawn (waved) spine so it hugs the fish as it swims.
     */
    private drawSelectionOutline(ctx: CanvasRenderingContext2D, finLength: number) {
        const R = this.R;
        const margin = 4 + R * 0.3;
        const T = TAIL_LENGTH * R * tailStretch(finLength);
        const finOut = 1 + (finLength - 1) * FIN_SPREAD;  // how much further the fins reach out
        const X = this.selX, Y = this.selY;
        const BODY_SAMPLES = 24;
        const TAIL_SAMPLES: ReadonlyArray<readonly [number, number]> = [[0.2, 0.3], [0.5, 0.45], [0.85, 0.62], [1.05, 0.5]];
        const sideCount = BODY_SAMPLES + TAIL_SAMPLES.length;

        // Half-width envelope along the body: body radius plus bumps where the fins reach out.
        const halfWidth = (u: number) => R * (
            bodyProfile(u)
            + 1.58 * PECTORAL_FIN_SIZE * finOut * Math.exp(-Math.pow((u - PECTORAL_FIN_U - 0.13 * finLength) / (0.14 * finLength), 2))   // pectoral fins
            + 1.25 * PELVIC_FIN_SIZE * finOut * Math.exp(-Math.pow((u - PELVIC_FIN_U - 0.08 * finLength) / (0.08 * finLength), 2))   // pelvic fins
        ) + margin;

        const tail = this.spineAt(1, this.sb);
        for (const side of [1, -1]) {
            for (let k = 0; k < sideCount; k++) {
                let x: number, y: number;
                if (k < BODY_SAMPLES) {
                    const u = k / (BODY_SAMPLES - 1);
                    const s = this.spineAt(u, this.sa);
                    const w = halfWidth(u);
                    x = s.x + s.nx * side * w;
                    y = s.y + s.ny * side * w;
                } else {
                    const [along, across] = TAIL_SAMPLES[k - BODY_SAMPLES];
                    const w = across * T + margin;
                    x = tail.x - tail.fx * along * T + tail.nx * side * w;
                    y = tail.y - tail.fy * along * T + tail.ny * side * w;
                }
                // left side runs head→tail, right side tail→head, so the loop closes around the fish
                const index = side === 1 ? k : 2 * sideCount - 1 - k;
                X[index] = x;
                Y[index] = y;
            }
        }
        // rounded cap in front of the nose
        let count = 2 * sideCount;
        const r0 = halfWidth(0), fx = this.fx[0], fy = this.fy[0];
        for (let j = 1; j < 6; j++) {
            const a = -Math.PI / 2 + j * Math.PI / 6;  // from the right side, round the front, to the left side
            X[count] = this.px[0] + fx * Math.cos(a) * r0 * 1.2 - fy * Math.sin(a) * r0;
            Y[count] = this.py[0] + fy * Math.cos(a) * r0 * 1.2 + fx * Math.sin(a) * r0;
            count++;
        }

        ctx.save();
        ctx.beginPath();
        this.appendSmoothPath(ctx, X, Y, count);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 15;
        ctx.stroke();
        ctx.restore();
    }

    /** time in milliseconds */
    private renderKoi(ctx: CanvasRenderingContext2D, colors: KoiColors, spots: RenderSpot[], time: number) {
        const t = time / 1000;
        this.time = t;
        this.scaleArcPath = null;
        const R = this.R;
        // Fry (and other very small koi) skip only the small scales and the whiskers.
        const fine = this.scale >= FINE_DETAIL_SCALE;

        ctx.save();

        // 0. Fins & tail under the body
        const flap = Math.sin(t * 2.2 + this.seed) * 0.16;
        this.drawSideFin(ctx, PELVIC_FIN_U, 1, PELVIC_FIN_SIZE, 0.5, -flap * 0.5, colors);
        this.drawSideFin(ctx, PELVIC_FIN_U, -1, PELVIC_FIN_SIZE, 0.5, -flap * 0.5, colors);
        this.drawTail(ctx, colors);
        this.drawSideFin(ctx, PECTORAL_FIN_U, 1, PECTORAL_FIN_SIZE, 0.16, flap * 0.6, colors, PECTORAL_FIN_SHAPE);
        this.drawSideFin(ctx, PECTORAL_FIN_U, -1, PECTORAL_FIN_SIZE, 0.16, flap * 0.6, colors, PECTORAL_FIN_SHAPE);

        // 1. Body
        this.buildOutline(1);
        ctx.beginPath();
        this.appendSmoothPath(ctx, this.outlineX, this.outlineY, OUTLINE_POINT_COUNT);
        ctx.fillStyle = colors.body;
        ctx.fill();

        ctx.save();
        ctx.clip();

        // 2. Patterns, bent along the body, built from scale-sized hexagons so their edges step like the scales.
        if (spots && spots.length > 0) this.drawScaleSpots(ctx, spots);

        // 2.5 Fine scales over body and patterns (doitsu: the hexagonal scale band instead)
        if (fine && colors.doitsu) this.drawDoitsuScales(ctx);
        else if (fine) this.drawScales(ctx, colors.ginrin ?? 0);

        // 3. Two-tone shading: crescents made by shifting the outline toward / away from the light
        const d = R * 0.42;
        this.fillCrescent(ctx, LIGHT_X * d, LIGHT_Y * d, colors.shade);
        this.fillCrescent(ctx, -LIGHT_X * d * 0.6, -LIGHT_Y * d * 0.6, colors.light);

        ctx.restore();

        // 4. Dorsal fin, eyes, whiskers
        this.drawDorsal(ctx, colors, t);
        this.drawEyes(ctx);
        if (fine) this.drawWhiskers(ctx, colors.whisker, t);

        ctx.restore();
    }

    /** Body outline: left edge head→tail, right edge tail→head, then the rounded mouth. */
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
        // Mouth (MOUTH_SHAPE): from the right side forward to the tip, then mirrored back to the left side.
        const fx = this.fx[0], fy = this.fy[0], nx = -fy, ny = fx;
        const r0 = this.radiusCache[0] * radiusScale;
        const last = MOUTH_SHAPE.length - 1;
        for (let j = 0; j < NOSE_CAP_POINTS; j++) {
            const side = j < last ? -1 : 1;
            const [ahead, across] = MOUTH_SHAPE[j <= last ? j : 2 * last - j];
            this.outlineX[k] = this.px[0] + (fx * ahead + nx * across * side) * r0;
            this.outlineY[k] = this.py[0] + (fy * ahead + ny * across * side) * r0;
            k++;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < OUTLINE_POINT_COUNT; i++) {
            minX = Math.min(minX, this.outlineX[i]); minY = Math.min(minY, this.outlineY[i]);
            maxX = Math.max(maxX, this.outlineX[i]); maxY = Math.max(maxY, this.outlineY[i]);
        }
        this.outlineMinX = minX; this.outlineMinY = minY;
        this.outlineMaxX = maxX; this.outlineMaxY = maxY;
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
        ctx.beginPath();
        // The outer rectangle only needs to cover the already clipped body.
        ctx.rect(this.outlineMinX - 2, this.outlineMinY - 2,
            this.outlineMaxX - this.outlineMinX + 4, this.outlineMaxY - this.outlineMinY + 4);
        this.appendSmoothPath(ctx, this.outlineX, this.outlineY, OUTLINE_POINT_COUNT, dx, dy);
        ctx.fillStyle = color;
        ctx.fill('evenodd');
    }

    /**
     * Spot outline in body coordinates, so it bends with the koi. Stretched along the body;
     * the shape gene sets how wobbly the edge is. Points past the nose or the tail tip continue
     * along the end tangent (clamping them would cut the pattern flat).
     */
    private static spotParams(spot: RenderSpot, index: number): SpotParams {
        const u = spot.y / 100;
        const ru = bodyProfile(Math.max(0, Math.min(1, u)));
        const shape = spot.shape || SpotShape.CIRCLE;
        return {
            u,
            b: (spot.x / 100 - 0.5) * 2 * ru,
            size: spotDisplaySize(spot.size) * ru * SPOT_SIZE_SCALE,
            elongation: shape === SpotShape.OVAL_H ? 1.9 : 1.35,
            across: shape === SpotShape.OVAL_H ? 0.7 : 1,
            wobble: shape === SpotShape.CIRCLE ? 0.08 : shape === SpotShape.HEXAGON ? 0.12 : 0.2,
            lobes: shape === SpotShape.HEXAGON ? 6 : 3,
            seed: spot.x * 0.37 + spot.y * 0.91 + index,
        };
    }

    /** Spot edge radius (1 = nominal size) at angle th around its centre. */
    private static spotRadius(sp: SpotParams, th: number): number {
        return 1 + sp.wobble * Math.sin(th * sp.lobes + sp.seed) + 0.1 * Math.cos(th * 5 + sp.seed * 2);
    }

    /**
     * Side fin membrane with rays fanning toward the rim.
     * Pectoral fins are fans (PECTORAL_FIN_SHAPE); pelvic fins keep their smaller paddle shape.
     * size: fin scale; offset: angle turning the fin back toward the tail.
     * Motoguro colours spread from the root; hirenaga stretches the fin back and ripples its edge.
     */
    private drawSideFin(ctx: CanvasRenderingContext2D, u: number, side: number, size: number, offset: number, flap: number, colors: KoiColors, shape: ReadonlyArray<readonly [number, number]> = SIDE_FIN_SHAPE) {
        const s = this.spineAt(u, this.sa);
        const r = bodyProfile(u) * this.R;
        const ox = s.nx * side, oy = s.ny * side;
        const rootX = s.x + ox * r * 0.85, rootY = s.y + oy * r * 0.85;
        const a = offset + flap, c = Math.cos(a), sn = Math.sin(a);
        const Xx = -s.fx * c - ox * sn, Xy = -s.fy * c - oy * sn; // backward, turned in by the offset
        const Yx = ox * c - s.fx * sn, Yy = oy * c - s.fy * sn;   // outward
        const g = size * this.R / 24;
        const stretch = colors.finLength ?? 1;
        const along = stretch, out = 1 + (stretch - 1) * FIN_SPREAD;
        const ripple = (stretch - 1) * FIN_RIPPLE;
        const n = shape.length, last = n - 1;
        let reach = 0;
        for (let i = 0; i < n; i++) {
            let [lx, ly] = shape[i];
            if (ripple && i > 0 && i < last) ly += Math.sin(this.time * 2.4 + i * 1.7 + side) * ripple;
            lx *= along;
            ly *= out;
            this.bufX2[i] = rootX + (Xx * lx + Yx * ly) * g;
            this.bufY2[i] = rootY + (Xy * lx + Yy * ly) * g;
            reach = Math.max(reach, Math.hypot(lx, ly) * g);
        }
        const X = this.bufX2, Y = this.bufY2;

        ctx.save();
        ctx.beginPath();
        this.appendSmoothPath(ctx, X, Y, n);
        ctx.fillStyle = colors.fin;
        ctx.fill();
        ctx.clip();
        const rootColor = colors.motoguro;

        if (rootColor) {
            const radius = reach * 0.8;
            const gradient = ctx.createRadialGradient(rootX, rootY, 0, rootX, rootY, radius);
            gradient.addColorStop(0, rootColor.root);
            gradient.addColorStop(0.6, rootColor.mid);
            gradient.addColorStop(1, rootColor.edge);
            ctx.fillStyle = gradient;
            ctx.fillRect(rootX - radius, rootY - radius, radius * 2, radius * 2);
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = Math.max(0.5, this.R * 0.035);
        ctx.lineCap = 'round';
        ctx.beginPath();
        // Rays converge near the root and spread across the rounded fan edge.
        const rayCount = n - 3;
        for (let k = 0; k < rayCount; k++) {
            const t = k / (rayCount - 1);
            const ex = (X[k + 1] + X[k + 2]) / 2, ey = (Y[k + 1] + Y[k + 2]) / 2;
            const rootT = 0.15 + t * 0.45;
            const bx = X[0] + (X[n - 1] - X[0]) * rootT, by = Y[0] + (Y[n - 1] - Y[0]) * rootT;
            ctx.moveTo(bx + (ex - bx) * 0.1, by + (ey - by) * 0.1);
            ctx.lineTo(bx + (ex - bx) * 0.9, by + (ey - by) * 0.9);
        }
        ctx.stroke();
        ctx.restore();
    }

    /** Forked tail that carries on the body wave. */
    private drawTail(ctx: CanvasRenderingContext2D, colors: KoiColors) {
        const s = this.spineAt(1, this.sb);
        const R = this.R;
        const stretch = colors.finLength ?? 1;
        const T = TAIL_LENGTH * R * tailStretch(stretch);
        const spread = 1 + (stretch - 1) * 0.3;   // hirenaga tails also open a little wider
        const ripple = (stretch - 1) * 0.13;      // and their edges ripple
        const bx = -s.fx, by = -s.fy, nx = s.nx, ny = s.ny;
        const sx = s.x, sy = s.y;
        const phase = this.wavePhase, amp = this.waveAmp * (1 + (stretch - 1) * 0.5);
        const W = (x: number, y: number, out: Float64Array, outY: Float64Array, i: number) => {
            const q = x / T;
            const w = Math.sin(phase - (1 + q * 0.9) * 2.6) * amp * R * 0.7 * q;
            out[i] = sx + bx * x + nx * (y + w);
            outY[i] = sy + by * x + ny * (y + w);
        };

        let k = 0;
        W(0, 0.16 * R, this.bufX, this.bufY, k++);
        for (let i = 0; i < TAIL_SHAPE.length; i++) {
            const [x, y] = TAIL_SHAPE[i];
            const wave = ripple ? Math.sin(this.time * 2.2 + i * 1.3) * ripple * x : 0;
            W(x * T, (y * spread + wave) * T, this.bufX, this.bufY, k++);
        }
        W(0, -0.16 * R, this.bufX, this.bufY, k++);

        ctx.save();
        ctx.beginPath();
        this.appendSmoothPath(ctx, this.bufX, this.bufY, k);
        ctx.fillStyle = colors.fin;
        ctx.fill();
        ctx.clip();

        if (colors.motoguro) {
            // Motoguro: the colour spreads from the tail root over the inner part of the tail.
            const radius = T * 0.55;
            const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
            gradient.addColorStop(0, colors.motoguro.root);
            gradient.addColorStop(0.6, colors.motoguro.mid);
            gradient.addColorStop(1, colors.motoguro.edge);
            ctx.fillStyle = gradient;
            ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
        }

        ctx.lineCap = 'round';
        ctx.strokeStyle = colors.ray;
        ctx.lineWidth = Math.max(0.7, R * 0.05);
        ctx.beginPath();
        for (let r = 0; r <= 8; r++) {
            const y = (-0.56 + r * 0.14) * T * spread;
            const xe = Math.min(1.02 * T, 0.64 * T + 0.75 * Math.abs(y));
            for (let j = 0; j <= 8; j++) {
                const q = j / 8;
                W(xe * q, y * Math.pow(q, 0.8), this.bufX2, this.bufY2, 0);
                if (j) ctx.lineTo(this.bufX2[0], this.bufY2[0]); else ctx.moveTo(this.bufX2[0], this.bufY2[0]);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Dorsal fin: a long, low translucent sail from behind the head to above the peduncle.
     * It lies to one side of the back, flops over slowly when the body bends the other way,
     * and ripples with the swimming wave.
     */
    private drawDorsal(ctx: CanvasRenderingContext2D, colors: KoiColors, t: number) {
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
        const length = R * 0.42, M = 10;
        ctx.save();
        ctx.fillStyle = color;
        for (const side of [1, -1]) {
            const sway = Math.sin(t * 2.5 + side * 1.3) * 0.12;
            let x = this.px[0] + fx * r0 * NOSE_LENGTH * 0.84 + nx * side * r0 * 0.36;
            let y = this.py[0] + fy * r0 * NOSE_LENGTH * 0.84 + ny * side * r0 * 0.36;
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

    /** Original eye design (flattened half-ellipse, pale yellow rim, tilted forward), set right at the head edge. */
    private drawEyes(ctx: CanvasRenderingContext2D) {
        const headAngle = Math.atan2(this.fy[0], this.fx[0]);
        const headRadius = this.radiusCache[0];
        const eyeDist = headRadius * 0.78;            // a touch in, so the larger eye stays on the head
        const eyeSize = this.R * (3.4 / 24) * 1.4;
        const borderSize = this.R * (1.3 / 24) * 1.2; // the rim grows less than the eye
        const flattenX = 0.6;
        const eyeRotationOffset = Math.PI / 8;

        ctx.save();
        for (const side of [1, -1]) {
            const eyeAngle = headAngle + side * Math.PI / 2.2;
            const ex = this.px[0] + Math.cos(eyeAngle) * eyeDist;
            const ey = this.py[0] + Math.sin(eyeAngle) * eyeDist;
            const rotation = eyeAngle - side * eyeRotationOffset;

            ctx.fillStyle = '#fbefb4';  // pale yellow rim
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

    /**
     * Fine overlapping scales: rows of arcs laid out in body coordinates (convex side toward the tail),
     * offset by half a scale on alternate rows so they bend with the koi. Drawn inside the body clip.
     */
    private getScaleRows(): ScaleRow[] {
        if (this.scaleRows) return this.scaleRows;
        const rows: ScaleRow[] = [];
        const du = this.scaleRowStep();
        let row = 0;
        for (let u = SCALE_START_U % du; u < 0.98; u += du, row++) {
            if (u < SCALE_START_U) continue;
            const half = bodyProfile(u) + SCALE_RADIUS;
            const first = firstScaleColumn(half, row);
            const hashes: number[] = [];
            for (let v = first, column = 0; v <= half; v += 2 * SCALE_RADIUS, column++) {
                hashes.push(scaleHash(row, column, this.seed));
            }
            rows.push({ u, first, count: hashes.length, hashes });
        }
        return this.scaleRows = rows;
    }

    private drawScales(ctx: CanvasRenderingContext2D, ginrin: number) {
        const R = this.R, radius = R * SCALE_RADIUS;
        const silver = ginrin > 0 ? new Path2D() : null;
        const transform = ctx.getTransform();
        const resolution = Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d));
        // Keep native arcs for enlarged previews; the pond approximation stays below 0.1 screen px.
        const smallArcs = radius * resolution <= 8;
        const p = this.sa;
        ctx.save();
        ctx.beginPath();
        for (const row of this.getScaleRows()) {
            // The original head fade is at most 2% opacity here. Keep it in enlarged views;
            // on small koi omit only these faint arcs, while retaining every ginrin glint.
            const faintHead = smallArcs && row.u < 0.2;
            if (faintHead && !silver) continue;
            this.spineAt(row.u, p);
            const back = Math.atan2(-p.fy, -p.fx), span = Math.PI / 2 + 0.15;
            const ax = Math.cos(back - span) * radius, ay = Math.sin(back - span) * radius;
            const sr = radius * 0.82, gx = Math.cos(back - 0.8) * sr, gy = Math.sin(back - 0.8) * sr;
            const c0 = SCALE_CURVES[0], c1 = SCALE_CURVES[1];
            const cx0 = (-p.fx * c0[0] + p.fy * c0[1]) * radius, cy0 = (-p.fy * c0[0] - p.fx * c0[1]) * radius;
            const ex0 = (-p.fx * c0[2] + p.fy * c0[3]) * radius, ey0 = (-p.fy * c0[2] - p.fx * c0[3]) * radius;
            const cx1 = (-p.fx * c1[0] + p.fy * c1[1]) * radius, cy1 = (-p.fy * c1[0] - p.fx * c1[1]) * radius;
            const ex1 = (-p.fx * c1[2] + p.fy * c1[3]) * radius, ey1 = (-p.fy * c1[2] - p.fx * c1[3]) * radius;
            for (let column = 0; column < row.count; column++) {
                const v = (row.first + column * 2 * SCALE_RADIUS) * R;
                const x = p.x + p.nx * v, y = p.y + p.ny * v;
                if (!faintHead) {
                    ctx.moveTo(x + ax, y + ay);
                    if (smallArcs) {
                        ctx.quadraticCurveTo(x + cx0, y + cy0, x + ex0, y + ey0);
                        ctx.quadraticCurveTo(x + cx1, y + cy1, x + ex1, y + ey1);
                    } else {
                        ctx.arc(x, y, radius, back - span, back + span);
                    }
                }
                if (silver && row.hashes[column] < ginrin * GINRIN_MAX_SHARE) {
                    silver.moveTo(x + gx, y + gy);
                    silver.arc(x, y, sr, back - 0.8, back + 0.8);
                }
            }
        }
        const fade = ctx.createLinearGradient(this.px[0], this.py[0], this.px[N - 1], this.py[N - 1]);
        fade.addColorStop(0, 'rgba(40, 40, 60, 0)');
        fade.addColorStop(0.2, 'rgba(40, 40, 60, 0.02)');
        fade.addColorStop(0.6, 'rgba(40, 40, 60, 0.09)');
        fade.addColorStop(1, 'rgba(40, 40, 60, 0.17)');
        ctx.strokeStyle = fade;
        ctx.lineWidth = Math.max(0.5, R * 0.03);
        ctx.stroke();
        if (silver) {
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(0.9, R * 0.065);
            ctx.strokeStyle = GINRIN_SILVER;
            ctx.stroke(silver);
        }
        ctx.restore();
    }

    /**
     * Doitsu: smooth skin (no small scales) with a row of interlocking hexagonal scales on each side
     * of the dorsal fin. Corners are placed in body coordinates, so the scales bend with the koi.
     * Drawn inside the body clip, over the patterns.
     */
    private drawDoitsuScales(ctx: CanvasRenderingContext2D) {
        const R = this.R;
        const L = this.getBodyLength() / R;
        const p = this.sa;
        ctx.save();

        const hexagon = (u: number, v: number, s: number) => {
            const h = (s * Math.sqrt(3) / 2) / L;
            const corner = (cu: number, cv: number, first: boolean) => {
                this.spineAt(cu, p);
                const x = p.x + p.nx * cv * R, y = p.y + p.ny * cv * R;
                if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            };
            corner(u, v + s, true);
            corner(u + h, v + s / 2, false);
            corner(u + h, v - s / 2, false);
            corner(u, v - s, false);
            corner(u - h, v - s / 2, false);
            corner(u - h, v + s / 2, false);
            ctx.closePath();
        };
        const middle = (DOITSU_START_U + DOITSU_END_U) / 2, half = (DOITSU_END_U - DOITSU_START_U) / 2;
        ctx.lineJoin = 'round';
        const sizeAt = (u: number) => DOITSU_SIZE * (1 - DOITSU_TAPER * Math.pow((u - middle) / half, 2));
        ctx.beginPath();
        for (const side of [1, -1]) {
            const start = side > 0 ? DOITSU_START_U : DOITSU_START_U + (sizeAt(DOITSU_START_U) * Math.sqrt(3) / 2) / L;
            for (let u = start; u < DOITSU_END_U;) {
                const s = sizeAt(u);
                hexagon(u, side * s * 0.75, s);
                u += (s * Math.sqrt(3)) / L;
            }
        }
        ctx.fillStyle = DOITSU_FILL;
        ctx.fill();
        ctx.strokeStyle = DOITSU_EDGE;
        ctx.lineWidth = Math.max(0.6, R * DOITSU_SIZE * 0.09);
        ctx.stroke();
        ctx.restore();
    }

    /** Koromo patterns share one bent scale path during this render. */
    private traceScaleArcs(radius: number, span: number): Path2D {
        if (this.scaleArcPath && this.scaleArcSpan === span) return this.scaleArcPath;
        const path = new Path2D(), R = this.R, p = this.sa;
        for (const row of this.getScaleRows()) {
            this.spineAt(row.u, p);
            const back = Math.atan2(-p.fy, -p.fx);
            const ax = Math.cos(back - span) * radius, ay = Math.sin(back - span) * radius;
            for (let column = 0; column < row.count; column++) {
                const v = (row.first + column * 2 * SCALE_RADIUS) * R;
                const x = p.x + p.nx * v, y = p.y + p.ny * v;
                path.moveTo(x + ax, y + ay);
                path.arc(x, y, radius, back - span, back + span);
            }
        }
        this.scaleArcSpan = span;
        return this.scaleArcPath = path;
    }

    /** Distance between scale rows as a fraction of the body length (independent of scale). */
    private scaleRowStep(): number {
        return (SCALE_RADIUS * this.R) / this.getBodyLength();
    }

    /**
     * Assigns each hexagon cell to the topmost pattern covering its centre. Columns run along the body,
     * 1.5 cell sizes apart across it; cells in a column are one cell height apart, and every other
     * column is shifted by half a height, which is the regular tiling for hexagons with side points.
     */
    private buildSpotCells(spots: RenderSpot[]) {
        const params = spots.map((spot, i) => KoiRenderer.spotParams(spot, i));
        const L = this.getBodyLength() / this.R;
        const columnStep = SPOT_CELL_SIZE * 1.5;
        const rowStep = SPOT_CELL_HALF_HEIGHT * 2;
        const columns = Math.ceil((BODY_WIDTH * CHEST_WIDTH + SPOT_CELL_SIZE) / columnStep);
        const noseLength = bodyProfile(0) * NOSE_LENGTH + SPOT_CELL_HALF_HEIGHT;  // mouth (see buildOutline) plus a cell
        this.spotCellU = [];
        this.spotCellV = [];
        this.spotCellSpot = [];
        const covers = params.map(() => false);
        for (let j = -columns; j <= columns; j++) {
            const v = j * columnStep;
            // Start in front of u = 0: the rounded nose cap reaches past the spine, and patterns must
            // run into it rather than stop in a straight line.
            const shift = j & 1 ? SPOT_CELL_HALF_HEIGHT : 0;
            for (let a = shift - Math.ceil((noseLength + shift) / rowStep) * rowStep; a < L; a += rowStep) {
                const u = a / L;
                if (Math.abs(v) > bodyProfile(Math.max(0, u)) + SPOT_CELL_SIZE) continue;
                for (let i = params.length - 1; i >= 0; i--) {
                    const sp = params[i];
                    const x = (sp.u - u) * L / (sp.size * sp.elongation);
                    const y = (v - sp.b) / (sp.size * sp.across);
                    const d2 = x * x + y * y;
                    if (d2 > 1.69) continue;  // beyond the largest possible edge radius (1.3)
                    if (Math.sqrt(d2) <= KoiRenderer.spotRadius(sp, Math.atan2(y, x))) {
                        covers[i] = true;
                        this.spotCellU.push(u);
                        this.spotCellV.push(v);
                        this.spotCellSpot.push(i);
                        break;
                    }
                }
            }
        }
        // A spot smaller than a cell can miss every cell centre; give it the cell under its centre.
        for (let i = 0; i < params.length; i++) {
            if (covers[i]) continue;
            const j = Math.round(params[i].b / columnStep);
            const shift = j & 1 ? SPOT_CELL_HALF_HEIGHT : 0;
            const a = shift + Math.round((params[i].u * L - shift) / rowStep) * rowStep;
            this.spotCellU.push(a / L);
            this.spotCellV.push(j * columnStep);
            this.spotCellSpot.push(i);
        }
        this.spotCellsFor = spots;
        this.buildSpotVertices(spots.length);
    }

    /** Cache shared hexagon corners and their spine samples in scale-independent body space. */
    private buildSpotVertices(spotCount: number) {
        const h = SPOT_CELL_HALF_HEIGHT / (this.getBodyLength() / this.R);
        const s = SPOT_CELL_SIZE;
        const vertices = new Map<string, number>(), samples = new Map<string, number>();
        const cells: number[][] = Array.from({ length: spotCount }, () => []);
        this.spotVertexU = []; this.spotVertexV = []; this.spotVertexSample = [];
        this.spotSampleU = []; this.spotSamples = [];
        const corner = (u: number, v: number) => {
            const key = `${u.toFixed(12)},${v.toFixed(12)}`;
            const existing = vertices.get(key);
            if (existing !== undefined) return existing;
            const sampleKey = u.toFixed(12);
            let sample = samples.get(sampleKey);
            if (sample === undefined) {
                sample = this.spotSampleU.length;
                samples.set(sampleKey, sample);
                this.spotSampleU.push(u);
                this.spotSamples.push({ x: 0, y: 0, fx: 1, fy: 0, nx: 0, ny: 1 });
            }
            const index = this.spotVertexU.length;
            vertices.set(key, index);
            this.spotVertexU.push(u); this.spotVertexV.push(v); this.spotVertexSample.push(sample);
            return index;
        };
        for (let c = 0; c < this.spotCellU.length; c++) {
            const u = this.spotCellU[c], v = this.spotCellV[c];
            cells[this.spotCellSpot[c]].push(
                corner(u, v + s), corner(u + h, v + s / 2), corner(u + h, v - s / 2),
                corner(u, v - s), corner(u - h, v - s / 2), corner(u - h, v + s / 2));
        }
        // Interior edges cancel: filling just the union's boundary preserves the exact stepped outline.
        this.spotContours = cells.map(indices => {
            const edges = new Map<string, [number, number]>();
            for (let c = 0; c < indices.length; c += 6) {
                for (let k = 0; k < 6; k++) {
                    const a = indices[c + k], b = indices[c + (k + 1) % 6];
                    if (!edges.delete(`${b}:${a}`)) edges.set(`${a}:${b}`, [a, b]);
                }
            }
            const next = new Map<number, number[]>();
            for (const [a, b] of edges.values()) {
                const outgoing = next.get(a);
                if (outgoing) outgoing.push(b); else next.set(a, [b]);
            }
            const contours: number[][] = [];
            while (next.size) {
                const start = next.keys().next().value!;
                const contour = [start];
                let a = start;
                do {
                    const outgoing = next.get(a)!;
                    const b = outgoing.pop()!;
                    if (!outgoing.length) next.delete(a);
                    a = b;
                    if (a !== start) contour.push(a);
                } while (a !== start);
                contours.push(contour);
            }
            return contours;
        });
        this.spotX = new Array(this.spotVertexU.length);
        this.spotY = new Array(this.spotVertexU.length);
    }

    /**
     * Patterns made of scale-sized hexagons (see SPOT_CELL_SIZE). Every corner is placed from its own
     * body coordinates, so neighbouring cells share corners even while the koi bends. Drawn inside the
     * body clip.
     */
    private drawScaleSpots(ctx: CanvasRenderingContext2D, spots: RenderSpot[]) {
        if (this.spotCellsFor !== spots) this.buildSpotCells(spots);
        const R = this.R;
        const bodyLength = this.getBodyLength();
        for (let i = 0; i < this.spotSampleU.length; i++) {
            this.spineAt(this.spotSampleU[i], this.spotSamples[i]);
        }
        for (let i = 0; i < this.spotVertexU.length; i++) {
            const u = this.spotVertexU[i], v = this.spotVertexV[i] * R;
            const p = this.spotSamples[this.spotVertexSample[i]];
            const over = (Math.max(0, Math.min(1, u)) - u) * bodyLength;
            this.spotX[i] = p.x + p.fx * over + p.nx * v;
            this.spotY[i] = p.y + p.fy * over + p.ny * v;
        }
        for (let i = 0; i < spots.length; i++) {
            const contours = this.spotContours[i];
            if (!contours.length) continue;
            ctx.beginPath();
            for (const indices of contours) {
                ctx.moveTo(this.spotX[indices[0]], this.spotY[indices[0]]);
                for (let k = 1; k < indices.length; k++) ctx.lineTo(this.spotX[indices[k]], this.spotY[indices[k]]);
                ctx.closePath();
            }
            ctx.fillStyle = spots[i].color;
            ctx.fill();
            const net = spots[i].koromo;
            if (net) {
                // Koromo: scale outlines in a darker shade, only inside this pattern's cells.
                ctx.save();
                ctx.clip();
                const scalePath = this.traceScaleArcs(R * SCALE_RADIUS, 1.4);
                ctx.strokeStyle = net;
                ctx.lineWidth = Math.max(0.8, R * 0.06);
                ctx.stroke(scalePath);
                ctx.restore();
            }
        }
    }
}
