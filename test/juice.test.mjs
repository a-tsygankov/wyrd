import assert from "node:assert/strict";
import test from "node:test";
import { HIT_STOP_MS, decayTrauma, markFor, shakeOffset, traumaFor } from "../dist/apps/web/src/juice.js";
import { BEAT_MS, beatDuration, buildTimeline } from "../dist/apps/web/src/stage.js";
import { focusMeter } from "../dist/apps/web/src/meter.js";
import { timerState, URGENT_MS } from "../dist/apps/web/src/timers.js";
import { CUES, extraCueFor, urgencyCue } from "../dist/apps/web/src/sound.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";

// docs/duel-ux-ideas.md: D (hit juice on one trauma dial), I (short beats,
// long crits), E (Focus meter, cost pips, urgent timer). Presentation only.

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    const result = resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
    return { result, casterId, defenderId, spell: tokens, reaction };
}

// --- D -------------------------------------------------------------------

test("every impact adds trauma by its meaning; quiet beats add none", () => {
    assert.equal(traumaFor({ kind: "hit", side: "player", magnitude: 1 }), 0.3);
    assert.equal(traumaFor({ kind: "hit", side: "player", magnitude: 2 }), 0.5);
    assert.equal(traumaFor({ kind: "ward-block", side: "player", broken: true }), 0.6);
    assert.equal(traumaFor({ kind: "ward-block", side: "player", broken: false }), 0.2);
    assert.equal(traumaFor({ kind: "ward-break", side: "player" }), 0.6);
    assert.equal(traumaFor({ kind: "gate-break" }), 0.5);
    assert.equal(traumaFor({ kind: "seal", side: "player" }), 0.4);
    assert.equal(traumaFor({ kind: "cast", side: "player", spell: "x" }), 0);
    assert.equal(traumaFor({ kind: "fly", from: "player", to: "opponent", magnitude: 1, action: "seek" }), 0);
    assert.equal(HIT_STOP_MS, 80);
});

test("trauma decays linearly and never goes negative; shake grows with trauma squared", () => {
    assert.equal(decayTrauma(1, 250), 0.55);
    assert.equal(decayTrauma(0.1, 1000), 0);
    assert.deepEqual(shakeOffset(0, 123), { x: 0, y: 0, rot: 0 });
    const small = shakeOffset(0.5, 300);
    const big = shakeOffset(1, 300);
    for (const k of ["x", "y", "rot"]) {
        assert.ok(Math.abs(big[k]) <= (k === "rot" ? 1.5 : k === "x" ? 6 : 4) + 1e-9, `${k} within bounds`);
        assert.ok(Math.abs(small[k]) <= Math.abs(big[k]) + 1e-9, `${k} grows with trauma`);
    }
    assert.ok(Math.abs(shakeOffset(0.5, 300).x) <= 0.25 * 6 + 1e-9, "amplitude is trauma squared");
    assert.deepEqual(shakeOffset(0.7, 300), shakeOffset(0.7, 300), "deterministic in time");
    assert.notDeepEqual(shakeOffset(0.7, 300), shakeOffset(0.7, 360), "and moves");
});

test("a hit leaves a mark on the struck mage's floor; nothing else does", () => {
    assert.deepEqual(markFor({ kind: "hit", side: "opponent", magnitude: 1 }, "fire"), { side: "opponent", essence: "fire" });
    assert.deepEqual(markFor({ kind: "hit", side: "player", magnitude: 1 }, undefined), { side: "player", essence: undefined });
    assert.equal(markFor({ kind: "seal", side: "player" }, "fire"), undefined);
    assert.equal(markFor({ kind: "ward-block", side: "player", broken: true }, "fire"), undefined);
});

// --- I -------------------------------------------------------------------

test("every beat is capped near half a second and a normal two-spell round stays under four seconds", () => {
    for (const [kind, ms] of Object.entries(BEAT_MS)) assert.ok(ms <= 500, `${kind} is ${ms}ms`);
    const state = createInitialDuelState(rulesets.teeth.rules);
    const beats = buildTimeline(cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect"), cast(state, "player", ["SELF", "WARD", "SHADOW"]));
    const total = beats.reduce((sum, b) => sum + beatDuration(b), 0);
    assert.ok(total <= 4000, `round takes ${total}ms`);
    assert.ok(beats.every(b => !b.emphasis), "nothing decisive in round one");
});

test("the seal that decides the match, or an amplified or split seal, earns the long version", () => {
    const state = createInitialDuelState();
    state.players.opponent.seals = 2;
    const decisive = buildTimeline(cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"]));
    const marked = decisive.filter(b => b.emphasis === "decisive").map(b => b.kind);
    assert.deepEqual(marked, ["fly", "hit", "seal"]);
    assert.ok(beatDuration(decisive.find(b => b.kind === "seal")) > BEAT_MS.seal * 2);
    assert.ok(beatDuration(decisive.find(b => b.kind === "fly")) > BEAT_MS.fly);
    assert.ok(beatDuration(decisive.find(b => b.kind === "seal")) <= 1600, "long, not endless");

    const amplified = buildTimeline(cast(createInitialDuelState(), "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]));
    assert.ok(amplified.some(b => b.kind === "hit" && b.emphasis === "decisive"), "an amplified hit that seals is a crit");
    const blockedAmplified = (() => {
        const s = createInitialDuelState();
        s.players.player.ward = { ownerId: "player" };
        return buildTimeline(cast(s, "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]));
    })();
    assert.ok(blockedAmplified.every(b => !b.emphasis), "a blocked amplified hit is not a crit");
    const resolveOut = createInitialDuelState(rulesets.resolve.rules);
    resolveOut.players.player.resolve = 1;
    const ko = buildTimeline(cast(resolveOut, "opponent", ["SEEK", "ENEMY"]));
    assert.ok(ko.some(b => b.kind === "hit" && b.emphasis === "decisive"), "emptying Resolve decides the match too");
});

// --- E -------------------------------------------------------------------

test("the Focus meter splits the bar into spell (left), reaction and spent (right) and names its state", () => {
    assert.deepEqual(focusMeter({ focus: 7, spellCost: 0, reactionCost: 0 }), { spellPct: 0, reactionPct: 0, spentPct: 0, state: "full" });
    assert.deepEqual(focusMeter({ focus: 7, spellCost: 3, reactionCost: 2 }), { spellPct: 43, reactionPct: 29, spentPct: 0, state: "ok" });
    assert.deepEqual(focusMeter({ focus: 6, spellCost: 4, reactionCost: 2 }), { spellPct: 57, reactionPct: 29, spentPct: 14, state: "ok" });
    assert.equal(focusMeter({ focus: 6, spellCost: 5, reactionCost: 2 }).state, "over");
    assert.equal(focusMeter({ focus: 6, spellCost: 5, reactionCost: 2 }).spellPct, 71);
    assert.equal(focusMeter({ focus: 9, spellCost: 0, reactionCost: 0 }).state, "full", "a PULLed surplus still reads full");
});

test("the timer turns urgent for the last three seconds of the reaction window", () => {
    assert.equal(URGENT_MS, 3000);
    assert.equal(timerState(1000).urgent, false);
    assert.equal(timerState(5500).urgent, true);
    assert.equal(timerState(8000).urgent, false, "locked is not urgent");
    assert.equal(timerState(6000, false).urgent, false);
});

test("hits carry a bass layer and the urgent seconds a rising tick", () => {
    assert.equal(extraCueFor({ kind: "hit", side: "player", magnitude: 1 }), "impact");
    assert.equal(extraCueFor({ kind: "ward-break", side: "player" }), "impact");
    assert.equal(extraCueFor({ kind: "cast", side: "player", spell: "x" }), null);
    assert.deepEqual([urgencyCue(2900), urgencyCue(1900), urgencyCue(900)], ["tick", "tick2", "tick3"]);
    assert.equal(urgencyCue(3500), null);
    for (const name of ["impact", "tick", "tick2", "tick3"]) assert.ok(CUES[name], `${name} is a cue`);
    assert.ok(CUES.tick.notes[0] < CUES.tick2.notes[0] && CUES.tick2.notes[0] < CUES.tick3.notes[0], "the pitch rises");
    assert.ok(CUES.impact.notes.every(f => f < 100), "impact is bass");
});
