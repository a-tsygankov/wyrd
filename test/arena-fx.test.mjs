import assert from "node:assert/strict";
import test from "node:test";
import { EMBER_COUNT, emberPosition, gateGlow, haloScale, idleSway, runeRing, shockwave, sparkOffsets, starPositions } from "../dist/apps/web/src/arenaFx.js";

// The graphics pass on the Three.js arena (docs/duel-3d-assets-and-ui.md §6
// step 5, second round): the pure motion and layout the renderer draws from,
// deterministic so a seed replays the same picture and testable without WebGL.

test("embers drift up through the arena volume, loop, and never leave it", () => {
    assert.ok(EMBER_COUNT >= 40 && EMBER_COUNT <= 200);
    for (let i = 0; i < EMBER_COUNT; i += 7) {
        for (const t of [0, 1.3, 7.7, 60.2]) {
            const e = emberPosition(i, t);
            assert.ok(Math.abs(e.x) <= 5.5 && e.y >= 0 && e.y <= 4 && e.z >= -3.5 && e.z <= 2.5, JSON.stringify({ i, t, e }));
            assert.ok(e.glow >= 0.15 && e.glow <= 1);
        }
    }
    const a = emberPosition(3, 2);
    const b = emberPosition(3, 2.5);
    assert.ok(b.y > a.y, "an ember rises");
    assert.deepEqual(emberPosition(3, 2), a, "deterministic");
    assert.notDeepEqual(emberPosition(4, 2), a, "embers differ");
});

test("a shockwave grows and fades over the beat", () => {
    const start = shockwave(0);
    const end = shockwave(1);
    assert.ok(start.radius < 0.3 && end.radius >= 1.2, "expands");
    assert.ok(start.opacity >= 0.8 && end.opacity === 0, "fades out completely");
    assert.ok(shockwave(0.5).radius > start.radius && shockwave(0.5).radius < end.radius);
});

test("sparks trail behind the bolt, scatter a little, and stay close", () => {
    const right = sparkOffsets(12, 0.4, 1);
    assert.equal(right.length, 12);
    assert.ok(right.every(s => s.x <= 0.02), "behind a bolt flying right (+x)");
    assert.ok(sparkOffsets(12, 0.4, -1).every(s => s.x >= -0.02), "behind a bolt flying left");
    assert.ok(right.every(s => Math.hypot(s.x, s.y, s.z) <= 0.9));
    assert.deepEqual(sparkOffsets(12, 0.4, 1), right, "deterministic");
    assert.notDeepEqual(sparkOffsets(12, 0.6, 1), right, "they move with time");
});

test("the halo grows with magnitude and the runes sit evenly on their ring", () => {
    assert.ok(haloScale(1) < haloScale(2) && haloScale(2) < haloScale(3));
    assert.ok(haloScale(9) <= haloScale(3) + 0.001, "capped");
    const ring = runeRing(12, 0.85);
    assert.equal(ring.length, 12);
    for (const r of ring) assert.ok(Math.abs(Math.hypot(r.x, r.z) - 0.85) < 1e-9);
    assert.ok(Math.abs(ring[1].angle - ring[0].angle - (Math.PI * 2) / 12) < 1e-9);
});

test("stars fill the upper dome, the camera sways gently, the gate's runes glow by state", () => {
    const stars = starPositions(120);
    assert.equal(stars.length, 120);
    assert.ok(stars.every(s => s.y > 0.5 && Math.abs(Math.hypot(s.x, s.y, s.z) - 24) < 0.01), "on a dome of radius 24, above the horizon");
    assert.deepEqual(starPositions(120), stars, "deterministic");
    for (const t of [0, 1, 2.5, 100]) {
        const s = idleSway(t);
        assert.ok(Math.abs(s.x) <= 0.05 && Math.abs(s.y) <= 0.035, JSON.stringify(s));
    }
    assert.ok(gateGlow("closed", 0) > gateGlow("open", 0), "a closed gate burns brighter");
    assert.equal(gateGlow("broken", 0), 0);
    assert.ok(gateGlow("open", 0) > 0);
    assert.ok(Math.abs(gateGlow("closed", 0) - gateGlow("closed", 1.1)) > 0.01, "it pulses");
});
