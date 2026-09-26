import assert from "node:assert/strict";
import test from "node:test";
import {
    CLASSIC_RULES,
    REACTION_COSTS,
    beginNextRound,
    createInitialDuelState,
    resolveEncounter
} from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets, rulesetIds } from "../dist/packages/wyrd-content/src/rulesets.js";

const TEETH = rulesets.teeth.rules;
const PULSE = rulesets.pulse.rules;
const RESOLVE = rulesets.resolve.rules;

function cast(state, casterId, tokens, reaction, extra = {}) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    return resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}), ...extra });
}

test("four rulesets, each building on the previous", () => {
    assert.deepEqual(rulesetIds, ["classic", "teeth", "pulse", "resolve"]);
    assert.deepEqual(rulesets.classic.rules, CLASSIC_RULES);
    assert.equal(TEETH.wardIntegrity, 2);
    assert.equal(TEETH.reactionCosts, true);
    assert.equal(TEETH.ignite, true);
    assert.equal(TEETH.quickCast, false);
    assert.equal(PULSE.quickCast, true);
    assert.equal(rulesets.pulse.timers, true);
    assert.equal(rulesets.classic.timers, false);
    assert.equal(RESOLVE.resolve, 10);
    for (const id of rulesetIds) assert.ok(rulesets[id].title && rulesets[id].summary.length > 30);
});

test("classic: wards never break and reactions are free", () => {
    const state = createInitialDuelState();
    state.players.player.ward = { ownerId: "player", essence: "fire" };
    const hit = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.ok(hit.steps.some(s => s.code === "WARD_BLOCKED"));
    assert.ok(hit.state.players.player.ward, "classic ward survives an amplified hit");
    const reflected = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(reflected.state.players.player.focus, 7, "no Focus charged for the reaction");
    assert.equal(reflected.state.players.opponent.focus, 7, "no Focus charged for the spell");
    assert.deepEqual(reflected.state.rules, CLASSIC_RULES);
});

test("teeth: ward integrity dents, then shatters; SILENCE saves it", () => {
    const state = createInitialDuelState(TEETH);
    const warded = cast(state, "player", ["SELF", "WARD", "FIRE"]).state;
    assert.equal(warded.players.player.ward.integrity, 2);

    const dent = cast(warded, "opponent", ["FIRE", "SEEK", "ENEMY"]);
    assert.ok(dent.steps.some(s => s.code === "WARD_BLOCKED"));
    assert.ok(dent.steps.some(s => s.code === "WARD_DENTED"));
    assert.equal(dent.state.players.player.ward.integrity, 1);
    assert.equal(dent.sealAwardedTo, undefined);

    const shatter = cast(dent.state, "opponent", ["FIRE", "SEEK", "ENEMY"]);
    assert.ok(shatter.steps.some(s => s.code === "WARD_BROKEN"));
    assert.equal(shatter.state.players.player.ward, undefined, "the ward is gone");
    assert.equal(shatter.sealAwardedTo, undefined, "the breaking hit is still blocked");

    const through = cast(shatter.state, "opponent", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(through.sealAwardedTo, "opponent", "the next hit goes through");

    const oneShot = cast(warded, "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.ok(oneShot.steps.some(s => s.code === "WARD_BROKEN"), "magnitude 2 breaks a fresh ward at once");
    const saved = cast(warded, "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"], "silence");
    assert.equal(saved.state.players.player.ward.integrity, 1, "SILENCE strips AMPLIFY: only a dent");
});

test("teeth: reactions cost Focus, unaffordable ones fail, 0 Focus exposes you", () => {
    assert.deepEqual(REACTION_COSTS, { silence: 1, reflect: 2, null: 3 });
    const state = createInitialDuelState(TEETH);
    const r = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(r.state.players.opponent.focus, 4, "caster paid the spell's 3 Focus");
    assert.equal(r.state.players.player.focus, 5, "defender paid 2 for REFLECT");
    assert.ok(r.steps.some(s => s.code === "REACTION_PAID"));
    assert.equal(r.sealAwardedTo, "player");

    const poor = createInitialDuelState(TEETH);
    poor.players.player.focus = 2;
    const denied = cast(poor, "opponent", ["FIRE", "SEEK", "ENEMY"], "null");
    assert.ok(denied.steps.some(s => s.code === "REACTION_UNAFFORDABLE"));
    assert.equal(denied.sealAwardedTo, "opponent", "the spell lands as if unanswered");
    assert.equal(denied.state.players.player.focus, 2, "nothing charged for a failed reaction");
    const spent = cast(poor, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(spent.state.players.player.focus, 0);
    assert.equal(spent.state.players.player.exposed, true, "0 Focus at the end of an encounter exposes you");
    assert.equal(spent.state.players.opponent.exposed, false);
});

test("beginNextRound refills Focus and keeps the exposed flag for one round", () => {
    const state = createInitialDuelState(TEETH);
    state.players.player.focus = 0;
    state.players.player.exposed = true;
    const next = beginNextRound(state);
    assert.equal(next.round, 2);
    assert.equal(next.players.player.focus, 7);
    assert.equal(next.players.player.exposed, true, "still exposed during the round after running dry");
    const after = cast(next, "opponent", ["FIRE", "SEEK", "ENEMY"], "silence").state;
    assert.equal(after.players.player.exposed, false, "re-evaluated at the next encounter");
});

test("teeth: ignite adds +1 magnitude for the same essence two casts running", () => {
    const state = createInitialDuelState(TEETH);
    const first = cast(state, "player", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(first.effect.magnitude, 1);
    assert.equal(first.state.players.player.lastEssence, "fire");
    const second = cast(first.state, "player", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(second.effect.magnitude, 2);
    assert.ok(second.steps.some(s => s.code === "IGNITE_APPLIED"));
    const switched = cast(first.state, "player", ["SHADOW", "SEEK", "ENEMY"]);
    assert.equal(switched.effect.magnitude, 1);
    const untyped = cast(first.state, "player", ["ENEMY", "BIND"]);
    assert.equal(untyped.state.players.player.lastEssence, undefined, "an untyped spell forgets the essence");
    const classic = cast(cast(createInitialDuelState(), "player", ["FIRE", "SEEK", "ENEMY"]).state, "player", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(classic.effect.magnitude, 1, "no ignite under classic");
});

test("pulse: a quick cast adds +1 magnitude only when the ruleset allows it", () => {
    const quick = cast(createInitialDuelState(PULSE), "player", ["FIRE", "SEEK", "ENEMY"], undefined, { quickCast: true });
    assert.equal(quick.effect.magnitude, 2);
    assert.ok(quick.steps.some(s => s.code === "QUICK_CAST"));
    const slow = cast(createInitialDuelState(PULSE), "player", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(slow.effect.magnitude, 1);
    const teeth = cast(createInitialDuelState(TEETH), "player", ["FIRE", "SEEK", "ENEMY"], undefined, { quickCast: true });
    assert.equal(teeth.effect.magnitude, 1, "teeth has no quick cast");
});

test("resolve: SEEK damages resolve by magnitude, reflected SEEK hurts the caster, blocked deals nothing", () => {
    const state = createInitialDuelState(RESOLVE);
    assert.equal(state.players.player.resolve, 10);
    assert.equal(state.players.opponent.resolve, 10);
    const hit = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.equal(hit.state.players.player.resolve, 8);
    assert.ok(hit.steps.some(s => s.code === "RESOLVE_DAMAGE"));
    assert.equal(hit.sealAwardedTo, "opponent", "seals still count");

    const back = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(back.state.players.opponent.resolve, 9);
    assert.equal(back.state.players.player.resolve, 10);

    const warded = createInitialDuelState(RESOLVE);
    warded.players.player.ward = { ownerId: "player", essence: "fire", integrity: 2 };
    const blocked = cast(warded, "opponent", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(blocked.state.players.player.resolve, 10);

    const gate = cast(state, "opponent", ["GATE", "CLOSE"]);
    assert.equal(gate.state.players.player.resolve, 10, "the objective deals no damage");
});

test("resolve: faltering caps new wards at integrity 1; BIND taxes the next spell", () => {
    const state = createInitialDuelState(RESOLVE);
    state.players.player.resolve = 3;
    const ward = cast(state, "player", ["SELF", "WARD", "FIRE"]).state;
    assert.equal(ward.players.player.ward.integrity, 1, "faltering: wards are brittle");
    assert.equal(ward.players.player.faltering, true);

    const bound = cast(createInitialDuelState(RESOLVE), "opponent", ["ENEMY", "BIND"]).state;
    assert.equal(bound.players.player.bound, true);
    const taxed = cast(bound, "player", ["FIRE", "SEEK", "ENEMY"]);
    assert.ok(taxed.steps.some(s => s.code === "BOUND_TAX"));
    assert.equal(taxed.state.players.player.focus, 7 - 3 - 2, "3 for the spell plus 2 for being bound");
    assert.equal(taxed.state.players.player.bound, false, "the tax consumes the bind");
});
