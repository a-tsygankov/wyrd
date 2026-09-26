import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline, essenceColor, BEAT_MS } from "../dist/apps/web/src/stage.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";

const kinds = beats => beats.map(b => b.kind);

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    const result = resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
    return { result, casterId, defenderId, spell: tokens, reaction };
}

test("a landing SEEK: cast, fly, hit, seal orb to the caster", () => {
    const beats = buildTimeline(cast(createInitialDuelState(), "opponent", ["FIRE", "SEEK", "ENEMY"]));
    assert.deepEqual(kinds(beats), ["cast", "fly", "hit", "seal"]);
    assert.equal(beats[0].side, "opponent");
    assert.deepEqual([beats[1].from, beats[1].to], ["opponent", "player"]);
    assert.equal(beats[1].essence, "fire");
    assert.equal(beats[2].side, "player");
    assert.equal(beats[3].side, "opponent");
});

test("REFLECT flips the bolt mid-flight and the seal goes to the reflector", () => {
    const beats = buildTimeline(cast(createInitialDuelState(), "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect"));
    assert.deepEqual(kinds(beats), ["cast", "fly", "reflect", "fly", "hit", "seal"]);
    assert.deepEqual([beats[3].from, beats[3].to], ["player", "opponent"], "the return leg");
    assert.equal(beats[4].side, "opponent");
    assert.equal(beats[5].side, "player");
});

test("NULL collapses the spell before it lands; SILENCE dims it and it still lands", () => {
    const nulled = buildTimeline(cast(createInitialDuelState(), "opponent", ["FIRE", "SEEK", "ENEMY"], "null"));
    assert.deepEqual(kinds(nulled), ["cast", "fly", "null"]);
    assert.equal(nulled[2].side, "player");
    const silenced = buildTimeline(cast(createInitialDuelState(), "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"], "silence"));
    assert.deepEqual(kinds(silenced), ["cast", "fly", "silence", "hit", "seal"]);
    assert.equal(silenced[1].magnitude, 2, "the bolt launches amplified");
    assert.equal(silenced[3].magnitude, 1, "and lands stripped");
});

test("wards: a block, a dent and a shatter are distinct beats", () => {
    const classic = createInitialDuelState();
    classic.players.player.ward = { ownerId: "player", essence: "fire" };
    const block = buildTimeline(cast(classic, "opponent", ["FIRE", "SEEK", "ENEMY"]));
    assert.deepEqual(kinds(block), ["cast", "fly", "ward-block"]);
    assert.equal(block[2].broken, false);

    const teeth = createInitialDuelState(rulesets.teeth.rules);
    teeth.players.player.ward = { ownerId: "player", essence: "fire", integrity: 2 };
    const dent = buildTimeline(cast(teeth, "opponent", ["FIRE", "SEEK", "ENEMY"]));
    assert.equal(dent[2].kind, "ward-block");
    assert.equal(dent[2].broken, false);
    assert.equal(dent[2].integrity, 1);
    const shatter = buildTimeline(cast(teeth, "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]));
    assert.equal(shatter[2].kind, "ward-block");
    assert.equal(shatter[2].broken, true);
});

test("WARD raises a shield on its owner; BIND wraps the target; CLOSE shuts the gate", () => {
    const ward = buildTimeline(cast(createInitialDuelState(), "player", ["SELF", "WARD", "FIRE"]));
    assert.deepEqual(kinds(ward), ["cast", "ward-up"]);
    assert.equal(ward[1].side, "player");
    assert.equal(ward[1].essence, "fire");
    const bind = buildTimeline(cast(createInitialDuelState(), "player", ["ENEMY", "BIND"]));
    assert.deepEqual(kinds(bind), ["cast", "fly", "bind", "seal"]);
    assert.equal(bind[2].side, "opponent");
    const gate = buildTimeline(cast(createInitialDuelState(), "player", ["GATE", "CLOSE"]));
    assert.deepEqual(kinds(gate), ["cast", "gate-close", "seal"]);
});

test("Resolve damage rides on the hit; invalid spells fizzle", () => {
    const hp = buildTimeline(cast(createInitialDuelState(rulesets.resolve.rules), "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]));
    const hit = hp.find(b => b.kind === "hit");
    assert.equal(hit.damage, 2);
    const bad = buildTimeline(cast(createInitialDuelState(), "player", ["SEEK", "AMPLIFY"]));
    assert.deepEqual(kinds(bad), ["cast", "fizzle"]);
});

test("a round concatenates both contributions and every beat has a duration", () => {
    const state = createInitialDuelState();
    const incoming = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect");
    const outgoing = cast(incoming.result.state, "player", ["GATE", "CLOSE"]);
    const beats = buildTimeline(incoming, outgoing);
    assert.equal(beats.length, 6 + 3);
    for (const b of beats) assert.ok(BEAT_MS[b.kind] > 0, `${b.kind} needs a duration`);
});

test("essence colours are stable and untyped has its own", () => {
    assert.notEqual(essenceColor("fire"), essenceColor("shadow"));
    assert.equal(essenceColor(undefined), essenceColor(undefined));
    assert.match(essenceColor("fire"), /^#[0-9a-f]{6}$/i);
});
