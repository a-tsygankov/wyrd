import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";

function resolve(tokens, reaction, mutate) {
    const state = createInitialDuelState();
    mutate?.(state);

    return resolveEncounter(state, {
        casterId: "player",
        defenderId: "opponent",
        spellTokens: tokens,
        ...(reaction ? { reaction } : {})
    });
}

test("SEEK scores a seal", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY"]);
    assert.equal(result.sealAwardedTo, "player");
    assert.equal(result.state.players.player.seals, 1);
    assert.equal(result.effect?.action, "seek");
});

test("BIND applies bound and scores a seal", () => {
    const result = resolve(["ENEMY", "BIND"]);
    assert.equal(result.state.players.opponent.bound, true);
    assert.equal(result.sealAwardedTo, "player");
});

test("WARD creates persistent defense without scoring", () => {
    const result = resolve(["SELF", "WARD", "SHADOW"]);
    assert.deepEqual(result.state.players.player.ward, {
        ownerId: "player",
        essence: "shadow"
    });
    assert.equal(result.sealAwardedTo, undefined);
});

test("matching WARD blocks incoming essence", () => {
    const result = resolve(["SHADOW", "SEEK", "ENEMY"], undefined, state => {
        state.players.opponent.ward = {
            ownerId: "opponent",
            essence: "shadow"
        };
    });

    assert.equal(result.sealAwardedTo, undefined);
    assert.ok(result.steps.some(step => step.code === "WARD_BLOCKED"));
});

test("non-matching WARD does not block", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY"], undefined, state => {
        state.players.opponent.ward = {
            ownerId: "opponent",
            essence: "shadow"
        };
    });

    assert.equal(result.sealAwardedTo, "player");
});

test("NULL cancels before effect", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY", "AMPLIFY"], "null");
    assert.equal(result.effect?.canceled, true);
    assert.equal(result.sealAwardedTo, undefined);
    assert.ok(result.steps.some(step => step.code === "NULL_CANCELED"));
});

test("REFLECT sends hostile SEEK back to caster", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(result.effect?.reflected, true);
    assert.equal(result.sealAwardedTo, "opponent");
    assert.equal(result.state.players.opponent.seals, 1);
});

test("ANCHOR blocks REFLECT", () => {
    const result = resolve(["GATE", "CLOSE", "ANCHOR"], "reflect");
    assert.equal(result.effect?.anchored, true);
    assert.equal(result.effect?.reflected, false);
    assert.equal(result.sealAwardedTo, "player");
    assert.ok(result.steps.some(step => step.code === "REFLECT_BLOCKED_BY_ANCHOR"));
});

test("AMPLIFY increases magnitude", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.equal(result.effect?.magnitude, 2);
});

test("SILENCE strips AMPLIFY but leaves base spell", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY", "AMPLIFY"], "silence");
    assert.equal(result.effect?.magnitude, 1);
    assert.equal(result.effect?.silenced, true);
    assert.equal(result.sealAwardedTo, "player");
});

test("CLOSE GATE scores objective seal", () => {
    const result = resolve(["GATE", "CLOSE"]);
    assert.equal(result.sealAwardedTo, "player");
    assert.ok(result.steps.some(step => step.code === "GATE_CLOSED"));
});

test("invalid spell returns validation failure", () => {
    const result = resolve(["FIRE", "ENEMY"]);
    assert.equal(result.effect, undefined);
    assert.equal(result.sealAwardedTo, undefined);
    assert.equal(result.steps[0]?.code, "INVALID_SPELL");
});

test("self-targeted SEEK or BIND does not score and hits the caster", () => {
    // Before this rule a SELF-targeted attack ignored its own target glyph,
    // hit the defender and scored an unreflectable, unwardable seal - the
    // bot would have found and abused it immediately.
    const seek = resolve(["FIRE", "SEEK", "SELF"]);
    assert.equal(seek.sealAwardedTo, undefined);
    assert.equal(seek.state.players.player.seals, 0);
    assert.ok(seek.steps.some(step => step.code === "NO_SEAL"));
    const bind = resolve(["SELF", "BIND"]);
    assert.equal(bind.sealAwardedTo, undefined);
    assert.equal(bind.state.players.player.bound, true, "SELF BIND binds the caster");
    assert.equal(bind.state.players.opponent.bound, undefined);
});

test("REFLECT still scores for the defender after the self-target rule", () => {
    const result = resolve(["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(result.sealAwardedTo, "opponent");
    assert.equal(result.state.players.opponent.seals, 1);
});

