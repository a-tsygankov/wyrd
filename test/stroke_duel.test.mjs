import assert from "node:assert/strict";
import test from "node:test";
import { STROKES } from "../dist/apps/web/src/runeDuel.js";
import {
    evaluateParry,
    scoreTrace,
    traceSpeedScore
} from "../dist/apps/web/src/strokeDuel.js";

function traced(rune, durationMs, reverse = false) {
    const source = reverse ? [...STROKES[rune]].reverse() : STROKES[rune];
    return source.map((point, index) => ({
        x: point.x,
        y: point.y,
        t: (durationMs * index) / Math.max(1, source.length - 1)
    }));
}

test("perfect canonical trace scores as the requested rune", () => {
    const score = scoreTrace(traced("line", 450), "line");
    assert.equal(score.correct, true);
    assert.equal(score.recognized, "line");
    assert.ok(score.accuracy > 0.98);
    assert.ok(score.direction > 0.98);
    assert.ok(score.total > 0.9);
    assert.ok(score.attackDamage >= 22);
});

test("reversing a trace keeps the shape but loses direction quality", () => {
    const forward = scoreTrace(traced("line", 450), "line");
    const backward = scoreTrace(traced("line", 450, true), "line");
    assert.equal(backward.correct, true);
    assert.ok(backward.direction < 0.1);
    assert.ok(backward.total < forward.total);
});

test("a clean but wrong rune is a miscast and deals no damage", () => {
    const score = scoreTrace(traced("arc", 500), "line");
    assert.equal(score.recognized, "arc");
    assert.equal(score.correct, false);
    assert.equal(score.attackDamage, 0);
    assert.ok(score.total <= 0.35);
});

test("faster clean execution scores more speed than a slow trace", () => {
    assert.ok(traceSpeedScore(500) > traceSpeedScore(2200));
});

const incoming = { width: 1000, height: 600, launchedAt: 0, impactAt: 2000 };

test("a well-timed steep crossing blocks", () => {
    const result = evaluateParry([
        { x: 500, y: 180, t: 930 },
        { x: 500, y: 420, t: 1070 }
    ], incoming);
    assert.equal(result.outcome, "block");
    assert.ok(result.timing > 0.95);
    assert.ok(result.crossingAngleDeg > 85);
    assert.equal(result.incomingDamage, 0);
});

test("a well-timed diagonal crossing deflects and counters", () => {
    const result = evaluateParry([
        { x: 430, y: 230, t: 900 },
        { x: 570, y: 370, t: 1100 }
    ], incoming);
    assert.equal(result.outcome, "deflect");
    assert.ok(result.timing > 0.95);
    assert.ok(result.counterDamage > 0);
});

test("a curved, precisely timed crossing reflects", () => {
    const result = evaluateParry([
        { x: 400, y: 200, t: 880 },
        { x: 500, y: 300, t: 1000 },
        { x: 600, y: 220, t: 1110 },
        { x: 650, y: 155, t: 1180 }
    ], incoming);
    assert.equal(result.outcome, "reflect");
    assert.ok(result.curvature >= 0.48);
    assert.ok(result.counterDamage >= 10);
});

test("crossing the lane far away from the projectile misses on timing", () => {
    const result = evaluateParry([
        { x: 820, y: 180, t: 930 },
        { x: 820, y: 420, t: 1070 }
    ], incoming);
    assert.equal(result.outcome, "miss");
    assert.ok(result.timing < 0.25);
    assert.equal(result.incomingDamage, 14);
});

test("a stroke that never crosses the trajectory misses", () => {
    const result = evaluateParry([
        { x: 300, y: 120, t: 800 },
        { x: 700, y: 140, t: 1200 }
    ], incoming);
    assert.equal(result.outcome, "miss");
    assert.equal(result.timing, 0);
});


test("custom incoming lane and damage are respected", () => {
    const path = {
        width: 1000,
        height: 600,
        launchedAt: 0,
        impactAt: 2000,
        laneY: 0.35,
        damage: 19
    };
    const miss = evaluateParry([], path);
    assert.equal(miss.incomingDamage, 19);

    const block = evaluateParry([
        { x: 500, y: 90, t: 930 },
        { x: 500, y: 330, t: 1070 }
    ], path);
    assert.equal(block.outcome, "block");
    assert.equal(block.intersection?.y, 210);
});
