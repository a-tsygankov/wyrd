import assert from "node:assert/strict";
import test from "node:test";
import { PHASES, derivePhase, phaseTarget } from "../dist/apps/web/src/phase.js";

// Layout A (docs/duel-3d-assets-and-ui.md §3): the round has phases, the
// interface says which one you are in, and the arena's camera follows.

const solo = (over = {}) => ({
    mode: "solo",
    hotseatPhase: "p2-compose",
    roundResolved: false,
    playing: false,
    spellLength: 0,
    castable: false,
    reactionSelected: false,
    reactionLocked: false,
    ...over
});

test("the phase order is read, react, shape, cast, resolve, verdict", () => {
    assert.deepEqual(PHASES.map(p => p.id), ["read", "react", "shape", "cast", "resolve", "verdict"]);
    for (const p of PHASES) assert.ok(p.title.length > 2 && p.hint.length > 10, p.id);
});

test("solo: the phase follows what the player has done this round", () => {
    assert.equal(derivePhase(solo()), "read");
    assert.equal(derivePhase(solo({ reactionSelected: true })), "react");
    assert.equal(derivePhase(solo({ reactionLocked: true })), "react", "the window closed: the reaction is settled");
    assert.equal(derivePhase(solo({ spellLength: 1 })), "shape", "composing skips ahead even without a reaction");
    assert.equal(derivePhase(solo({ reactionSelected: true, spellLength: 2 })), "shape");
    assert.equal(derivePhase(solo({ spellLength: 3, castable: true })), "cast");
    assert.equal(derivePhase(solo({ roundResolved: true, playing: true })), "resolve");
    assert.equal(derivePhase(solo({ roundResolved: true, playing: false })), "verdict");
});

test("hot-seat: Player 2 composes first, hand-offs read, Player 1 reacts and shapes, Player 2 reacts, then the verdict", () => {
    const hot = (hotseatPhase, over = {}) => ({ ...solo({ mode: "hotseat", hotseatPhase }), ...over });
    assert.equal(derivePhase(hot("p2-compose")), "shape");
    assert.equal(derivePhase(hot("p2-compose", { spellLength: 3, castable: true })), "cast");
    assert.equal(derivePhase(hot("handoff-to-p1")), "read");
    assert.equal(derivePhase(hot("p1-turn")), "read");
    assert.equal(derivePhase(hot("p1-turn", { reactionSelected: true })), "react");
    assert.equal(derivePhase(hot("p1-turn", { spellLength: 2 })), "shape");
    assert.equal(derivePhase(hot("p1-turn", { spellLength: 2, castable: true })), "cast");
    assert.equal(derivePhase(hot("handoff-to-p2")), "read");
    assert.equal(derivePhase(hot("p2-react")), "react");
    assert.equal(derivePhase(hot("resolved", { roundResolved: true })), "verdict");
});

test("each phase points at the card the strip scrolls to", () => {
    assert.equal(phaseTarget("read"), "opponent");
    assert.equal(phaseTarget("react"), "reaction");
    assert.equal(phaseTarget("shape"), "composer");
    assert.equal(phaseTarget("cast"), "composer");
    assert.equal(phaseTarget("resolve"), "stage");
    assert.equal(phaseTarget("verdict"), "log");
});
