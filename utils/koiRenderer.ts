import { Koi as KoiType, SpotShape, SpotPhenotype } from '../types';

interface Segment {
    x: number;
    y: number;
    angle: number;
}


interface KoiColors {
    outline: string;
    body: string;
    pattern: string;
    spine: string;
    fin: string; // New cached property
}

const WORLD_TRANSFORM = (x: number, y: number) => ({ x, y });
const LEGACY_RENDER_SEGMENT_COUNT = 52;
const RENDER_SEGMENT_COUNT = 27;
const PHYSICS_SEGMENT_COUNT = 27;
const mapLegacySegmentIndex = (index: number) =>
    Math.round((index / (LEGACY_RENDER_SEGMENT_COUNT - 1)) * (RENDER_SEGMENT_COUNT - 1));
const PECTORAL_FIN_INDEX = mapLegacySegmentIndex(10);
const PELVIC_FIN_INDEX = mapLegacySegmentIndex(26);
const SPINE_START_INDEX = mapLegacySegmentIndex(8);
const SPINE_END_INDEX = mapLegacySegmentIndex(40);
const SPINE_POINT_COUNT = SPINE_END_INDEX - SPINE_START_INDEX + 1;

export class KoiRenderer {
    // The old renderer drew only every second one of its 52 body samples.
    // Use the 27 physics controls directly while preserving the old body length.
    private readonly segmentCount = RENDER_SEGMENT_COUNT;
    private readonly physicsSegmentCount = PHYSICS_SEGMENT_COUNT;
    private baseSpacing = 3.0;
    private spacing = 3.0;
    private segments: Segment[] = [];
    private physicsSegments: Segment[] = [];
    private scale = 1.0;
    private targetScale = 1.0;
    private startScale = 1.0;
    private scaleStartTime = 0;
    private readonly SCALE_DURATION = 5000;
    private readonly radiusCache = new Float64Array(RENDER_SEGMENT_COUNT);
    private readonly spineLeftX = new Float64Array(SPINE_POINT_COUNT);
    private readonly spineLeftY = new Float64Array(SPINE_POINT_COUNT);
    private readonly spineRightX = new Float64Array(SPINE_POINT_COUNT);
    private readonly spineRightY = new Float64Array(SPINE_POINT_COUNT);

    private initialized = false;

    constructor() {
        this.rebuildRadiusCache();
    }

    public getScale(): number {
        return this.scale;
    }

    private initSegments(x: number, y: number) {
        const physicsSpacing = this.getPhysicsSpacing();
        this.physicsSegments = [];
        for (let i = 0; i < this.physicsSegmentCount; i++) {
            this.physicsSegments.push({ x: x, y: y + i * physicsSpacing, angle: -Math.PI / 2 });
        }
        this.segments = this.physicsSegments;
        this.initialized = true;
    }

    private getPhysicsSpacing(): number {
        return this.spacing * (LEGACY_RENDER_SEGMENT_COUNT - 1) / (this.physicsSegmentCount - 1);
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
    }

    private rebuildRadiusCache() {
        const peakPoint = 0.25;
        const maxRadius = 24 * this.scale;
        const noseRadius = 13 * this.scale;
        const tailRadius = 1 * this.scale;

        for (let index = 0; index < this.segmentCount; index++) {
            const t = index / (this.segmentCount - 1);
            if (t < peakPoint) {
                const progress = t / peakPoint;
                this.radiusCache[index] = noseRadius + (maxRadius - noseRadius) * Math.sin(progress * Math.PI / 2);
            } else {
                const progress = (t - peakPoint) / (1 - peakPoint);
                this.radiusCache[index] = maxRadius - (maxRadius - tailRadius) * Math.pow(progress, 1.5);
            }
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
            const targetAngle = Math.atan2(dy, dx);
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 0.000001) {
                const spacingRatio = physicsSpacing / distance;
                cur.x = prev.x + dx * spacingRatio;
                cur.y = prev.y + dy * spacingRatio;
            } else {
                // Match the former atan2(0, 0) behavior for the degenerate case.
                cur.x = prev.x + physicsSpacing;
                cur.y = prev.y;
            }
            cur.angle = targetAngle;
        }
    }

    public getHeadPosition(): { x: number, y: number } {
        if (!this.initialized || this.segments.length === 0) return { x: 0, y: 0 };
        return { x: this.segments[0].x, y: this.segments[0].y };
    }

    public draw(ctx: CanvasRenderingContext2D, width: number, height: number, colors: KoiColors, spots: Array<{ x: number, y: number, size: number, color: string }>, phenotype?: SpotPhenotype, isAlbino: boolean = false) {
        if (!this.initialized) return;
        const head = this.segments[0];
        const toLocal = (x: number, y: number) => {
            return {
                x: x - head.x + width / 2,
                y: y - head.y + height / 2
            };
        };
        this.renderKoi(ctx, colors, spots, toLocal, 0, phenotype, isAlbino);
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

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        // ctx.filter = 'blur(3px)'; // 성능 최적화: 필터 제거
        ctx.beginPath();

        const shadowScale = 0.8;
        const head = this.segments[0];

        for (let i = this.segmentCount - 1; i >= 0; i--) {
            const r = this.getRadius(i) * shadowScale * 1.1;

            const dx = this.segments[i].x - head.x;
            const dy = this.segments[i].y - head.y;
            const scaledX = head.x + (dx * shadowScale);
            const scaledY = head.y + (dy * shadowScale);

            const x = scaledX + offsetX;
            const y = scaledY + offsetY;

            if (i === this.segmentCount - 1) ctx.moveTo(x + r, y);
            else ctx.arc(x, y, r, 0, Math.PI * 2);
        }

        ctx.fill();
        ctx.restore();
    }

    public drawWorld(ctx: CanvasRenderingContext2D, colors: KoiColors, spots: Array<{ x: number, y: number, size: number, color: string }>, isSelected: boolean = false, time: number = 0, phenotype?: SpotPhenotype, isAlbino: boolean = false) {
        if (!this.initialized) return;

        if (isSelected) {
            this.drawSelectionOutline(ctx, WORLD_TRANSFORM);
        }

        this.renderKoi(ctx, colors, spots, WORLD_TRANSFORM, time, phenotype, isAlbino);
    }

    private drawHitboxDebug(ctx: CanvasRenderingContext2D) {
        // Debug placeholder
    }

    private drawSelectionOutline(ctx: CanvasRenderingContext2D, transform: (x: number, y: number) => { x: number, y: number }) {
        ctx.save();
        ctx.beginPath();

        const outerPoints: { x: number, y: number }[] = [];

        for (let i = 0; i < this.segmentCount; i++) {
            const r = this.getRadius(i) + 8;
            const s = this.segments[i];
            const angle = s.angle + Math.PI / 2;
            const px = s.x + Math.cos(angle) * r;
            const py = s.y + Math.sin(angle) * r;
            outerPoints.push(transform(px, py));
        }

        for (let i = this.segmentCount - 1; i >= 0; i--) {
            const r = this.getRadius(i) + 8;
            const s = this.segments[i];
            const angle = s.angle - Math.PI / 2;
            const px = s.x + Math.cos(angle) * r;
            const py = s.y + Math.sin(angle) * r;
            outerPoints.push(transform(px, py));
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

    private renderKoi(ctx: CanvasRenderingContext2D, colors: KoiColors, spots: Array<{ x: number, y: number, size: number, color: string }>, transform: (x: number, y: number) => { x: number, y: number }, time: number = 0, phenotype?: SpotPhenotype, isAlbino: boolean = false) {
        // USE CACHED FIN COLOR directly! No Regex!
        const finColor = colors.fin;

        // 0. Fins & Tail (Layer 0 - Moved BEFORE body to act as bottom layer)
        // Tail
        this.drawTail(ctx, this.segments[this.segmentCount - 1], transform, finColor, time);

        // Fins
        // Pectoral: Steeper angle (0.2), Size 0.6
        this.drawFin(ctx, PECTORAL_FIN_INDEX, 'left', 0.6, 15, transform, finColor, time, 0.05);
        this.drawFin(ctx, PECTORAL_FIN_INDEX, 'right', 0.6, 15, transform, finColor, time, 0.05);

        // Pelvic: Normal angle (0.2), Smaller size (0.35)
        this.drawFin(ctx, PELVIC_FIN_INDEX, 'left', 0.3, 6, transform, finColor, time, 0.5);
        this.drawFin(ctx, PELVIC_FIN_INDEX, 'right', 0.3, 6, transform, finColor, time, 0.5);

        // 1-2. Body Outline & Fill - build the same circle union once and reuse it.
        ctx.beginPath();
        this.appendBodyPath(ctx, transform, 1.1);
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = colors.body;
        ctx.fill();

        // 3. Eyes (Layer 2.5)
        this.drawEyes(ctx, this.segments[0], transform, isAlbino);


        // 4. Patterns (Layer 3) - SHAPES
        if (spots && spots.length > 0) {
            ctx.save();
            // Keep the original, slightly tighter pattern clipping boundary.
            ctx.beginPath();
            this.appendBodyPath(ctx, transform, 1);
            ctx.clip();

            // 성능 최적화: ctx.filter 제거됨, 채도는 색상 생성 시 적용됨

            spots.forEach(spot => {
                const segmentIndex = Math.floor((spot.y / 100) * this.segmentCount);
                if (segmentIndex >= 0 && segmentIndex < this.segmentCount) {
                    const s = this.segments[segmentIndex];
                    const radius = this.getRadius(segmentIndex);
                    const offsetX = ((spot.x / 100) - 0.5) * 2 * radius;

                    const perpAngle = s.angle + Math.PI / 2;
                    const spotX = s.x + Math.cos(perpAngle) * offsetX;
                    const spotY = s.y + Math.sin(perpAngle) * offsetX;
                    const p = transform(spotX, spotY);

                    // Spot inherent size
                    const spotRadius = (spot.size / 100) * radius;

                    // save/restore 제거로 성능 향상 (필터는 위에서 한 번만 설정)
                    ctx.fillStyle = spot.color;

                    ctx.beginPath();

                    // @ts-ignore
                    const shape = spot.shape || SpotShape.CIRCLE;

                    if (shape === SpotShape.HEXAGON) {
                        // Pre-calculate vertices
                        const vertices: { x: number, y: number }[] = [];
                        // Align rotation with body segment
                        const rotationOffset = s.angle + Math.PI / 2;

                        // Normalization Scale: 1.2x
                        const normalizedRadius = spotRadius * 1.2;

                        for (let i = 0; i < 6; i++) {
                            const angle = (Math.PI * 2 / 6) * i + rotationOffset;
                            vertices.push({
                                x: p.x + Math.cos(angle) * normalizedRadius,
                                y: p.y + Math.sin(angle) * normalizedRadius
                            });
                        }

                        // Draw rounded polygon (User request: "A bit rounded")
                        const cornerRadius = 0.3; // 0 to 0.5 (0 = sharp, 0.5 = max roundness)
                        ctx.moveTo(
                            vertices[0].x * (1 - cornerRadius) + vertices[1].x * cornerRadius,
                            vertices[0].y * (1 - cornerRadius) + vertices[1].y * cornerRadius
                        );

                        for (let i = 1; i <= 6; i++) {
                            const curr = vertices[i % 6];
                            const next = vertices[(i + 1) % 6];
                            // Line to start of round corner
                            const startX = curr.x * (1 - cornerRadius) + vertices[(i - 1) % 6].x * cornerRadius;
                            const startY = curr.y * (1 - cornerRadius) + vertices[(i - 1) % 6].y * cornerRadius;

                            // End of round corner
                            const endX = curr.x * (1 - cornerRadius) + next.x * cornerRadius;
                            const endY = curr.y * (1 - cornerRadius) + next.y * cornerRadius;

                            ctx.lineTo(startX, startY);
                            // Curve around the vertex
                            ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
                        }
                        ctx.closePath();
                    } else if (shape === SpotShape.POLYGON) {
                        // Renamed from BLOTCH: Smooth organic spline
                        const pointsCount = 10 + Math.floor((spot.x % 3));
                        const spotSeed = (spot.x * 123.45 + spot.y * 678.91);
                        const rotationOffset = s.angle + Math.PI / 2;

                        // Normalization Scale: 1.3x
                        const normalizedRadius = spotRadius * 1.3;

                        const points: { x: number, y: number }[] = [];

                        // Generate jagged points first
                        for (let i = 0; i < pointsCount; i++) {
                            const angle = (Math.PI * 2 / pointsCount) * i + rotationOffset;
                            const seed = (i * 997 + spotSeed);
                            // Variance 0.8 to 1.2
                            const rVar = 1.0 + 0.2 * Math.sin(seed);
                            // Reduced size removed (User request: spots too small)
                            const r = normalizedRadius * rVar;
                            points.push({
                                x: p.x + Math.cos(angle) * r,
                                y: p.y + Math.sin(angle) * r
                            });
                        }

                        // Smooth spline drawing (Midpoint Quadratic Averaging)
                        const midX = (points[pointsCount - 1].x + points[0].x) / 2;
                        const midY = (points[pointsCount - 1].y + points[0].y) / 2;

                        ctx.moveTo(midX, midY);

                        for (let i = 0; i < pointsCount; i++) {
                            const nextI = (i + 1) % pointsCount;
                            const nextMidX = (points[i].x + points[nextI].x) / 2;
                            const nextMidY = (points[i].y + points[nextI].y) / 2;
                            ctx.quadraticCurveTo(points[i].x, points[i].y, nextMidX, nextMidY);
                        }
                        ctx.closePath();
                    } else if (shape === SpotShape.OVAL_H) {
                        // "Rounded Bumpy" (Cloud/Potato like)
                        // User Request: Remove OVAL_V, make OVAL_H bumpy and rounded

                        // Horizontal orientation (Aligned with body spine)
                        const rotation = s.angle;
                        const spotSeed = (spot.x * 543.21 + spot.y * 123.45);

                        // Normalization Scale: 1.3x
                        const normalizedRadius = spotRadius * 1.3;

                        // Base dimensions (Slender)
                        const baseLen = normalizedRadius * 1.0;
                        const baseWidth = normalizedRadius * 0.6;

                        // 12 points is good for organic curves without too much jaggedness
                        const numPoints = 12;
                        const points: { x: number, y: number }[] = [];

                        for (let i = 0; i < numPoints; i++) {
                            const theta = (i / numPoints) * Math.PI * 2;

                            // 1. Base Ellipse
                            const localX = Math.cos(theta) * baseLen;
                            const localY = Math.sin(theta) * baseWidth;

                            // 2. Bumpy Noise (Soft/Rounded bumps)
                            // "Simple Bumpy" (Potato-like): Moderate frequencies, lower amplitude
                            const noise1 = Math.sin(theta * 3 + spotSeed);
                            const noise2 = Math.cos(theta * 5 + spotSeed * 2);

                            // Reduced amplitude to avoid "complex map" look
                            const rNoise = 1.0 + 0.2 * noise1 + 0.15 * noise2;

                            const noisyX = localX * rNoise;
                            const noisyY = localY * rNoise;

                            // 3. Rotate
                            const rotatedX = noisyX * Math.cos(rotation) - noisyY * Math.sin(rotation);
                            const rotatedY = noisyX * Math.sin(rotation) + noisyY * Math.cos(rotation);

                            points.push({
                                x: p.x + rotatedX,
                                y: p.y + rotatedY
                            });
                        }

                        // Draw SMOOTH curves (Rounded)
                        if (points.length > 0) {
                            const midX = (points[numPoints - 1].x + points[0].x) / 2;
                            const midY = (points[numPoints - 1].y + points[0].y) / 2;

                            ctx.moveTo(midX, midY);

                            for (let i = 0; i < numPoints; i++) {
                                const nextI = (i + 1) % numPoints;
                                const nextMidX = (points[i].x + points[nextI].x) / 2;
                                const nextMidY = (points[i].y + points[nextI].y) / 2;
                                ctx.quadraticCurveTo(points[i].x, points[i].y, nextMidX, nextMidY);
                            }
                            ctx.closePath();
                        }

                    } else {
                        // Default Circle
                        ctx.arc(p.x, p.y, spotRadius, 0, Math.PI * 2);
                    }

                    ctx.fill();
                    // ctx.restore(); // 제거: save/restore는 spots 전체에서 한 번만
                }
            });
            ctx.restore();
        }


        // 6. Spine (Layer 5) - one smooth tapered ribbon instead of many strokes
        this.drawSpineRibbon(ctx, transform, colors.spine);

        ctx.restore();
    }

    private appendBodyPath(
        ctx: CanvasRenderingContext2D,
        transform: (x: number, y: number) => { x: number, y: number },
        radiusScale: number
    ) {
        for (let i = this.segmentCount - 1; i >= 0; i--) {
            const radius = this.getRadius(i) * radiusScale;
            const point = transform(this.segments[i].x, this.segments[i].y);
            ctx.moveTo(point.x + radius, point.y);
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        }
    }

    private drawSpineRibbon(
        ctx: CanvasRenderingContext2D,
        transform: (x: number, y: number) => { x: number, y: number },
        color: string
    ) {
        const lastPointIndex = SPINE_POINT_COUNT - 1;
        const maxSpineWidth = 6 * this.scale;
        let startTangentX = 1;
        let startTangentY = 0;
        let endTangentX = 1;
        let endTangentY = 0;
        let startHalfWidth = maxSpineWidth / 2;
        let endHalfWidth = maxSpineWidth / 2;

        for (let pointIndex = 0; pointIndex < SPINE_POINT_COUNT; pointIndex++) {
            const segmentIndex = SPINE_START_INDEX + pointIndex;
            const previous = this.segments[Math.max(SPINE_START_INDEX, segmentIndex - 1)];
            const next = this.segments[Math.min(SPINE_END_INDEX, segmentIndex + 1)];
            const tangentDx = next.x - previous.x;
            const tangentDy = next.y - previous.y;
            const tangentLength = Math.sqrt(tangentDx * tangentDx + tangentDy * tangentDy);
            const tangentX = tangentLength > 0.000001 ? tangentDx / tangentLength : Math.cos(this.segments[segmentIndex].angle);
            const tangentY = tangentLength > 0.000001 ? tangentDy / tangentLength : Math.sin(this.segments[segmentIndex].angle);
            const normalX = -tangentY;
            const normalY = tangentX;
            // The old final stroke used the penultimate taper value, so clamp
            // the endpoint to the same width before applying the round cap.
            const taperStep = Math.min(pointIndex, lastPointIndex - 1);
            const progress = taperStep / lastPointIndex;
            const halfWidth = (maxSpineWidth * (1 - progress * 0.8)) / 2;
            const center = transform(this.segments[segmentIndex].x, this.segments[segmentIndex].y);

            this.spineLeftX[pointIndex] = center.x + normalX * halfWidth;
            this.spineLeftY[pointIndex] = center.y + normalY * halfWidth;
            this.spineRightX[pointIndex] = center.x - normalX * halfWidth;
            this.spineRightY[pointIndex] = center.y - normalY * halfWidth;

            if (pointIndex === 0) {
                startTangentX = tangentX;
                startTangentY = tangentY;
                startHalfWidth = halfWidth;
            } else if (pointIndex === lastPointIndex) {
                endTangentX = tangentX;
                endTangentY = tangentY;
                endHalfWidth = halfWidth;
            }
        }

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.moveTo(this.spineLeftX[0], this.spineLeftY[0]);

        for (let i = 1; i < lastPointIndex; i++) {
            const midpointX = (this.spineLeftX[i] + this.spineLeftX[i + 1]) / 2;
            const midpointY = (this.spineLeftY[i] + this.spineLeftY[i + 1]) / 2;
            ctx.quadraticCurveTo(this.spineLeftX[i], this.spineLeftY[i], midpointX, midpointY);
        }
        ctx.lineTo(this.spineLeftX[lastPointIndex], this.spineLeftY[lastPointIndex]);

        const endCenterX = (this.spineLeftX[lastPointIndex] + this.spineRightX[lastPointIndex]) / 2;
        const endCenterY = (this.spineLeftY[lastPointIndex] + this.spineRightY[lastPointIndex]) / 2;
        ctx.quadraticCurveTo(
            endCenterX + endTangentX * endHalfWidth,
            endCenterY + endTangentY * endHalfWidth,
            this.spineRightX[lastPointIndex],
            this.spineRightY[lastPointIndex]
        );

        for (let i = lastPointIndex - 1; i > 0; i--) {
            const midpointX = (this.spineRightX[i] + this.spineRightX[i - 1]) / 2;
            const midpointY = (this.spineRightY[i] + this.spineRightY[i - 1]) / 2;
            ctx.quadraticCurveTo(this.spineRightX[i], this.spineRightY[i], midpointX, midpointY);
        }
        ctx.lineTo(this.spineRightX[0], this.spineRightY[0]);

        const startCenterX = (this.spineLeftX[0] + this.spineRightX[0]) / 2;
        const startCenterY = (this.spineLeftY[0] + this.spineRightY[0]) / 2;
        ctx.quadraticCurveTo(
            startCenterX - startTangentX * startHalfWidth,
            startCenterY - startTangentY * startHalfWidth,
            this.spineLeftX[0],
            this.spineLeftY[0]
        );
        ctx.closePath();
        ctx.fill();
    }

    private drawFin(ctx: CanvasRenderingContext2D, segmentIndex: number, type: 'left' | 'right', sizeScale: number, yOffset: number, toLocal: (x: number, y: number) => { x: number, y: number }, color: string, time: number, baseAngleOffset: number = 0.2) {
        const s = this.segments[segmentIndex];
        // 애니메이션 제거 - 고정 각도 (성능 최적화)
        const angleOffset = type === 'left' ? (-baseAngleOffset) : (baseAngleOffset);
        const angle = s.angle + angleOffset;
        const sideScale = type === 'left' ? 1 : -1;
        const bodyRadius = this.getRadius(segmentIndex);

        const perpAngle = s.angle + Math.PI / 2;
        const rootDist = bodyRadius * 0.85 * sideScale;
        const rootX = s.x + Math.cos(perpAngle) * rootDist;
        const rootY = s.y + Math.sin(perpAngle) * rootDist;

        // Transform helper for fin local coordinates
        const transform = (lx: number, ly: number) => {
            const rx = lx * Math.cos(angle) - ly * Math.sin(angle);
            const ry = lx * Math.sin(angle) + ly * Math.cos(angle);
            const wx = rootX + rx;
            const wy = rootY + ry;
            return toLocal(wx, wy);
        };

        const globalScale = this.scale;
        const outerX = 45 * sizeScale * globalScale;
        const outerY = 60 * sideScale * sizeScale * globalScale;
        const innerX = 35 * sizeScale * globalScale;
        const innerY = 10 * sideScale * sizeScale * globalScale;

        const p0 = transform(0, 0);
        const p1 = transform(5 * sizeScale * globalScale, 30 * sideScale * sizeScale * globalScale);
        const p2 = transform(outerX, outerY);
        const p3 = transform(55 * sizeScale * globalScale, 40 * sideScale * sizeScale * globalScale);
        const p4 = transform(innerX, innerY);

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        ctx.quadraticCurveTo(p3.x, p3.y, p4.x, p4.y);
        ctx.lineTo(p0.x, p0.y);
        ctx.fill();

        // Striations
        ctx.clip();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;

        const rayCount = 6;
        for (let i = 1; i <= rayCount; i++) {
            const t = i / (rayCount + 1);
            const lx = (outerX * (1 - t) + innerX * t) * 1.2;
            const ly = (outerY * (1 - t) + innerY * t) * 1.2;
            const pRay = transform(lx, ly);
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(pRay.x, pRay.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    private drawTail(ctx: CanvasRenderingContext2D, s: Segment, toLocal: (x: number, y: number) => { x: number, y: number }, color: string, time: number) {
        // Animation: fast flutter
        const flutter = Math.sin(time / 100) * 0.1;
        const angle = s.angle + flutter;
        const transform = (lx: number, ly: number) => {
            const rx = lx * Math.cos(angle) - ly * Math.sin(angle);
            const ry = lx * Math.sin(angle) + ly * Math.cos(angle);
            const wx = s.x + rx;
            const wy = s.y + ry;
            return toLocal(wx, wy);
        };

        const sc = this.scale * 0.55; // Reduced tail size further (was 0.75)
        const p0 = transform(0, 0);
        const p1 = transform(15 * sc, 30 * sc);
        const p2 = transform(60 * sc, 55 * sc);
        const p3 = transform(90 * sc, 30 * sc);
        const p4 = transform(80 * sc, 0);
        const p5 = transform(90 * sc, -30 * sc);
        const p6 = transform(60 * sc, -55 * sc);
        const p7 = transform(15 * sc, -30 * sc);

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.bezierCurveTo(p4.x, p4.y, p4.x, p4.y, p5.x, p5.y);
        ctx.bezierCurveTo(p6.x, p6.y, p7.x, p7.y, p0.x, p0.y);
        ctx.fill();

        // Striations
        ctx.clip();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;

        const rays = 10;
        for (let i = 0; i <= rays; i++) {
            const t = (i / rays) * 2 - 1;
            const tx = 100 * sc;
            const ty = t * 50 * sc;
            const cp = transform(20 * sc, ty * 0.5);
            const end = transform(tx, ty);

            ctx.moveTo(p0.x, p0.y);
            ctx.quadraticCurveTo(cp.x, cp.y, end.x, end.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    private drawEyes(ctx: CanvasRenderingContext2D, head: Segment, toLocal: (x: number, y: number) => { x: number, y: number }, isAlbino: boolean = false) {
        const angle = head.angle;
        const headRadius = this.getRadius(0);

        // Eyes are positioned at ~60 degrees from the nose, on the outer edge
        // ADJUSTMENT: Move slightly inward (reduce offset angle or distance)
        // User requested "lower" -> Move back towards PI/2.2
        // User requested "towards glabella" -> Reduce distance to 0.65
        // User requested "towards outer edge" -> Increase distance back to 0.75
        // User requested "back to outer edge" -> Increase distance to 0.9
        // User requested "attach to outer edge" -> Set distance to 1.0 (headRadius)
        const eyeOffsetAngle = Math.PI / 2.2; // Keep vertical position
        const eyeDist = headRadius; // Was 0.9 -> 1.0 (attached to edge)

        const leftEyeAngle = angle - eyeOffsetAngle;
        const rightEyeAngle = angle + eyeOffsetAngle;

        const leftEyeX = head.x + Math.cos(leftEyeAngle) * eyeDist;
        const leftEyeY = head.y + Math.sin(leftEyeAngle) * eyeDist;

        const rightEyeX = head.x + Math.cos(rightEyeAngle) * eyeDist;
        const rightEyeY = head.y + Math.sin(rightEyeAngle) * eyeDist;

        const pLeft = toLocal(leftEyeX, leftEyeY);
        const pRight = toLocal(rightEyeX, rightEyeY);

        // ADJUSTMENT: Larger eyes (User requested "make them bigger" again)
        const eyeSize = 4.0 * this.scale; // Increased from 2.0 -> 3.5 -> 4.0
        const borderSize = 1.5 * this.scale; // White border thickness

        // Flattening factor for "less convex" look
        const flattenX = 0.6; // Flatten along the radial axis

        // ADJUSTMENT: Tilt eyes slightly forward (rotate relative to radial line)
        const eyeRotationOffset = Math.PI / 8; // Tilt forward by ~22.5 degrees

        ctx.save();

        // Draw White Border (Sclera) - FLATTENED
        ctx.fillStyle = '#ffffff';

        // Left Eye Border
        ctx.beginPath();
        // Ellipse rotated to face outward + tilt (REVERSED: + offset)
        ctx.ellipse(pLeft.x, pLeft.y, (eyeSize + borderSize) * flattenX, eyeSize + borderSize, leftEyeAngle + eyeRotationOffset, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();

        // Right Eye Border
        ctx.beginPath();
        // REVERSED: - offset
        ctx.ellipse(pRight.x, pRight.y, (eyeSize + borderSize) * flattenX, eyeSize + borderSize, rightEyeAngle - eyeRotationOffset, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();

        // Draw Pupil (Black or Pink for Albino) - FLATTENED
        ctx.fillStyle = isAlbino ? '#E53E3E' : '#1a1a1a'; // Red/Pink for Albino, Dark grey for normal

        // Left Eye Pupil
        ctx.beginPath();
        ctx.ellipse(pLeft.x, pLeft.y, eyeSize * flattenX, eyeSize, leftEyeAngle + eyeRotationOffset, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();

        // Right Eye Pupil
        ctx.beginPath();
        ctx.ellipse(pRight.x, pRight.y, eyeSize * flattenX, eyeSize, rightEyeAngle - eyeRotationOffset, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();

        // REMOVED: Eye Shine (User requested removal)

        ctx.restore();
    }
}
