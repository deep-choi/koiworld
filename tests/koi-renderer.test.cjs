const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const { KoiRenderer } = require('../utils/koiRenderer.ts');
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const pose = (x, y, angle, speed) => ({
    position: { x, y }, velocity: { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed },
});
const tail = renderer => renderer.spineAt(1, {});

test('slow swimming and alternating tight turns never snap the rendered tail', () => {
    for (const fps of [10, 30, 60, 120]) {
        const renderer = new KoiRenderer();
        renderer.setScale(0.5, true);
        renderer.wavePhase = 0;
        let x = 400, y = 400, angle = 0, previousTailAngle = null;
        for (let frame = 0; frame < fps * 25; frame++) {
            const time = frame / fps;
            const rate = time < 5 ? 0 : time < 10 ? 1.6 : time < 15 ? -1.6 : time < 20 ? 3 : -3;
            angle += rate / fps;
            x += Math.cos(angle) * 20 / fps;
            y += Math.sin(angle) * 20 / fps;
            renderer.update(pose(x, y, angle, 20), 1 / fps, true);
            // 꼬리 속도 제한을 넣어도 기존 몸통 곡률이 무너져 접히면 안 됩니다.
            for (let index = 1; index < renderer.physicsSegments.length; index++) {
                const previousAngle = index === 1 ? renderer.physicsSegments[0].angle + Math.PI
                    : renderer.physicsSegments[index - 1].angle;
                assert.ok(Math.abs(angleDiff(renderer.physicsSegments[index].angle, previousAngle)) <= 0.120001);
            }
            const point = tail(renderer);
            const currentTailAngle = Math.atan2(point.fy, point.fx);
            if (previousTailAngle !== null) {
                const angularSpeed = Math.abs(angleDiff(currentTailAngle, previousTailAngle)) * fps;
                assert.ok(angularSpeed < 4.5, `${fps} FPS at ${time}s: tail rotated ${angularSpeed} rad/s`);
            }
            previousTailAngle = currentTailAngle;
        }
    }
});

test('steady straight swimming retains a small periodic tail sway', () => {
    const renderer = new KoiRenderer();
    renderer.setScale(0.5, true);
    renderer.wavePhase = 0;
    let minimum = Infinity, maximum = -Infinity;
    for (let frame = 0; frame < 600; frame++) {
        renderer.update(pose(400 + frame * 70 / 60, 400, 0, 70), 1 / 60, true);
        if (frame > 60) {
            const y = tail(renderer).y;
            minimum = Math.min(minimum, y);
            maximum = Math.max(maximum, y);
        }
    }
    assert.ok(maximum - minimum > 1, 'gentle swimming wave must remain visible');
    assert.ok(maximum - minimum < 4, 'ordinary swimming must not develop a large swing');
});

test('first update aligns the entire body with the swimming direction', () => {
    for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI - 0.01]) {
        const renderer = new KoiRenderer();
        renderer.setScale(0.5, true);
        renderer.wavePhase = 0;
        renderer.update(pose(400, 400, angle, 70), 1 / 60, true);
        assert.ok(Math.abs(angleDiff(Math.atan2(tail(renderer).fy, tail(renderer).fx), angle)) < 0.15);
    }
});

test('crossing the pond boundary translates the complete body without whipping the tail', () => {
    const renderer = new KoiRenderer();
    renderer.setScale(0.5, true);
    renderer.forceStaticState(400, 400, 0.4);
    const before = renderer.physicsSegments.map(segment => ({ ...segment }));
    renderer.update(pose(1200, 1000, 0.4, 70), 0, true);
    for (let index = 0; index < before.length; index++) {
        const after = renderer.physicsSegments[index];
        assert.ok(Math.abs(after.x - before[index].x - 800) < 1e-6);
        assert.ok(Math.abs(after.y - before[index].y - 600) < 1e-6);
        assert.ok(Math.abs(angleDiff(after.angle, before[index].angle)) < 1e-6);
    }
});
