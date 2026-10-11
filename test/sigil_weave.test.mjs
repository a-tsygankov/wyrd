import assert from "node:assert/strict";
import test from "node:test";
import {
    canReleaseWeave,
    nextWeaveStep,
    placeWeaveRune,
    releaseWeave,
    resolveWeaveParry,
    startWeave
} from "../dist/apps/web/src/sigilWeave.js";

test("Aegis Spiral advances only on the correct rune and anchor", () => {
    let state = startWeave("aegis", false);
    assert.equal(nextWeaveStep(state)?.rune, "circle");
    assert.equal(nextWeaveStep(state)?.anchor, 0);

    const wrongRune = placeWeaveRune(state, "line", 0);
    assert.equal(wrongRune.verdict, "wrong-rune");
    assert.equal(wrongRune.state.placements.length, 0);
    assert.ok(wrongRune.state.stability < state.stability);

    state = placeWeaveRune(wrongRune.state, "circle", 0).state;
    assert.equal(state.placements.length, 1);

    const wrongAnchor = placeWeaveRune(state, "arc", 3);
    assert.equal(wrongAnchor.verdict, "wrong-anchor");
    assert.equal(wrongAnchor.state.placements.length, 1);

    state = placeWeaveRune(wrongAnchor.state, "arc", 2).state;
    state = placeWeaveRune(state, "triangle", 4).state;
    assert.equal(state.complete, true);
    assert.equal(canReleaseWeave(state), true);
});

test("guided recipes trigger Arcade Parry at their planned layer", () => {
    let state = startWeave("aegis", true);
    state = placeWeaveRune(state, "circle", 0).state;
    assert.equal(state.parryPending, false);
    state = placeWeaveRune(state, "arc", 2).state;
    assert.equal(state.parryPending, true);
    assert.equal(canReleaseWeave(state), false);
});

test("parry outcomes change weave stability and charge", () => {
    let state = startWeave("aegis", true);
    state = placeWeaveRune(state, "circle", 0).state;
    state = placeWeaveRune(state, "arc", 2).state;

    const reflected = resolveWeaveParry(state, "reflect", 0.9);
    assert.equal(reflected.parryPending, false);
    assert.ok(reflected.stability > state.stability);
    assert.ok(reflected.charge > state.charge);

    const missBase = { ...state, parryPending: true };
    const missed = resolveWeaveParry(missBase, "miss", 0);
    assert.ok(missed.stability < missBase.stability);
    assert.ok(missed.charge <= missBase.charge);
});

test("Free Weave uses unique anchors and can release after three layers", () => {
    let state = startWeave("free", false);
    state = placeWeaveRune(state, "circle", 0).state;
    const occupied = placeWeaveRune(state, "arc", 0);
    assert.equal(occupied.verdict, "occupied");
    assert.equal(occupied.state.placements.length, 1);

    state = placeWeaveRune(occupied.state, "arc", 2).state;
    state = placeWeaveRune(state, "triangle", 4).state;
    assert.equal(canReleaseWeave(state), true);

    const release = releaseWeave(state);
    assert.equal(release.state.released, true);
    assert.equal(release.title, "FREE WEAVE");
    assert.ok(release.score > 0);
});

test("Mirror Crown requires four layers before release", () => {
    let state = startWeave("mirror", false);
    state = placeWeaveRune(state, "arc", 1).state;
    state = placeWeaveRune(state, "circle", 4).state;
    state = placeWeaveRune(state, "spiral", 2).state;
    assert.equal(canReleaseWeave(state), false);
    state = placeWeaveRune(state, "line", 5).state;
    assert.equal(canReleaseWeave(state), true);
    assert.equal(releaseWeave(state).title, "MIRROR CROWN");
});
