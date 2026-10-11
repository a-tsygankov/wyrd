import assert from "node:assert/strict";
import test from "node:test";
import {
    OPPONENT_SPELLS,
    pickOpponentSpell,
    pickTraceRune,
    playerSuggestion,
    seededRandom
} from "../dist/apps/web/src/strokeDuelScenario.js";

test("seeded scenario choices are deterministic", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const sequenceA = [
        pickTraceRune(a),
        pickOpponentSpell(a).id,
        pickTraceRune(a),
        pickOpponentSpell(a).id
    ];
    const sequenceB = [
        pickTraceRune(b),
        pickOpponentSpell(b).id,
        pickTraceRune(b),
        pickOpponentSpell(b).id
    ];
    assert.deepEqual(sequenceA, sequenceB);
});

test("scenario picker avoids immediate repeats when alternatives exist", () => {
    const zero = () => 0;
    assert.notEqual(pickTraceRune(zero, "line"), "line");
    assert.notEqual(pickOpponentSpell(zero, "ember-lance").id, "ember-lance");
});

test("opponent profiles vary speed lane damage and behavior", () => {
    assert.ok(new Set(OPPONENT_SPELLS.map(spell => spell.travelMs)).size > 1);
    assert.ok(new Set(OPPONENT_SPELLS.map(spell => spell.laneY)).size > 1);
    assert.ok(new Set(OPPONENT_SPELLS.map(spell => spell.damage)).size > 1);
    assert.ok(new Set(OPPONENT_SPELLS.map(spell => spell.behavior)).size > 1);
});

test("player suggestion combines offense and the opponent read", () => {
    const text = playerSuggestion("triangle", OPPONENT_SPELLS[1]);
    assert.match(text, /POWER/);
    assert.match(text, /REFLECT/);
});
