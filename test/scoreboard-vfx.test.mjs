import assert from "node:assert/strict";
import test from "node:test";
import { NOTCHES, burstOffsets, gateLean, notchPosition, sealNotches, shardOffsets } from "../dist/apps/web/src/arenaMap.js";
import { buildTimeline } from "../dist/apps/web/src/stage.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";

// The gate as the scoreboard (ideas doc C) and the VFX pass (3D doc §6 step 5):
// the pure geometry the renderers share, tested without WebGL.

test("seal notches: three per side on the chains, lit up to each mage's seals", () => {
    assert.equal(NOTCHES, 3);
    const notches = sealNotches({ player: 2, opponent: 1 });
    assert.equal(notches.length, 6);
    assert.deepEqual(notches.filter(n => n.side === "player").map(n => n.lit), [true, true, false]);
    assert.deepEqual(notches.filter(n => n.side === "opponent").map(n => n.lit), [true, false, false]);
    assert.deepEqual(sealNotches({ player: 0, opponent: 0 }).map(n => n.lit), [false, false, false, false, false, false]);
    assert.deepEqual(sealNotches({ player: 5, opponent: 0 }).filter(n => n.side === "player").map(n => n.lit), [true, true, true], "capped at three");
});

test("notch positions run from the gate toward each mage, the first nearest the gate", () => {
    const p1 = notchPosition("player", 0);
    const p3 = notchPosition("player", 2);
    const o1 = notchPosition("opponent", 0);
    assert.ok(p1.x < 0 && o1.x > 0, "left and right of the gate");
    assert.ok(Math.abs(p3.x) > Math.abs(p1.x), "later notches sit further out");
    assert.equal(p1.y, o1.y);
    assert.ok(p1.y > 1, "on the chains, above the floor");
});

test("the gate leans toward whoever leads and swings at three", () => {
    assert.equal(gateLean({ player: 0, opponent: 0 }), 0);
    assert.ok(gateLean({ player: 1, opponent: 0 }) < 0, "toward the player (left)");
    assert.ok(gateLean({ player: 0, opponent: 2 }) > gateLean({ player: 0, opponent: 1 }), "more seals, more lean");
    assert.ok(Math.abs(gateLean({ player: 3, opponent: 0 })) > Math.abs(gateLean({ player: 2, opponent: 0 })) * 1.5, "the third seal swings it");
    assert.ok(Math.abs(gateLean({ player: 3, opponent: 0 })) <= 0.6, "never past the floor");
});

test("shards and bursts are deterministic and stay in bounds", () => {
    const shards = shardOffsets(6, 0.5);
    assert.equal(shards.length, 6);
    for (const s of shards) {
        assert.ok(Math.abs(s.x) <= 1.5 && s.y >= -1.6 && s.y <= 0.5 && Math.abs(s.z) <= 1.2, JSON.stringify(s));
        assert.ok(Math.abs(s.spin) <= Math.PI);
    }
    assert.deepEqual(shardOffsets(6, 0.5), shards, "same t, same shards");
    const rest = shardOffsets(6, 0);
    assert.ok(rest.every(s => s.x === 0 && s.y === 0 && s.z === 0 && s.spin === 0), "at t = 0 the slab is whole");
    const burst = burstOffsets(16, 0.3);
    assert.equal(burst.length, 16);
    assert.ok(burst.every(b => Math.hypot(b.x, b.y, b.z) <= 1.2));
    assert.ok(burstOffsets(16, 0.6).every((b, i) => Math.hypot(b.x, b.y, b.z) >= Math.hypot(burst[i].x, burst[i].y, burst[i].z)), "the burst expands");
});

test("a seal beat is enough for the scoreboard: the renderer counts from the round's state", () => {
    const state = createInitialDuelState();
    const result = resolveEncounter(state, { casterId: "player", defenderId: "opponent", spellTokens: ["GATE", "CLOSE"] });
    const beats = buildTimeline({ result, casterId: "player", defenderId: "opponent", spell: ["GATE", "CLOSE"], reaction: undefined });
    assert.deepEqual(beats.map(b => b.kind), ["cast", "gate-close", "seal"]);
    assert.equal(beats[2].side, "player");
});
