import assert from "node:assert/strict";
import test from "node:test";
import { adviseReaction, adviseSpell, classifyOutcome, fixedReactionModel } from "../dist/packages/wyrd-simulation/src/advisor.js";
import { reactionProbabilities } from "../dist/packages/wyrd-simulation/src/bot.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";

import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
const TRAY = [...POC_TRAY];
const pool = enumerateLegalSpells(TRAY);

test("classifyOutcome names what the resolver did", () => {
    const s = createInitialDuelState();
    const ctx = tokens => ({ casterId: "opponent", defenderId: "player", spellTokens: tokens });
    assert.equal(classifyOutcome(resolveEncounter(s, ctx(["FIRE", "SEEK", "ENEMY"])), "player"), "opponent-seal");
    assert.equal(classifyOutcome(resolveEncounter(s, { ...ctx(["FIRE", "SEEK", "ENEMY"]), reaction: "reflect" }), "player"), "player-seal");
    assert.equal(classifyOutcome(resolveEncounter(s, { ...ctx(["FIRE", "SEEK", "ENEMY"]), reaction: "null" }), "player"), "canceled");
    assert.equal(classifyOutcome(resolveEncounter(s, ctx(["SELF", "WARD", "FIRE"])), "player"), "no-seal");
    const warded = createInitialDuelState();
    warded.players.player.ward = { ownerId: "player", essence: "fire" };
    assert.equal(classifyOutcome(resolveEncounter(warded, ctx(["FIRE", "SEEK", "ENEMY"])), "player"), "blocked");
});

test("adviseReaction ranks the four reactions against the incoming spell with explanations", () => {
    const advice = adviseReaction(createInitialDuelState(), ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(advice.length, 4);
    assert.equal(advice[0].reaction, "reflect", "an open hostile route: REFLECT wins a seal");
    assert.equal(advice[0].value, 1);
    assert.equal(advice[0].outcome, "player-seal");
    assert.match(advice[0].explanation, /REFLECT/);
    const none = advice.find(a => a.reaction === "none");
    assert.equal(none.value, -1);
    assert.equal(none.outcome, "opponent-seal");
    // Values are sorted descending and the null cancel sits at 0.
    for (let i = 1; i < advice.length; i++) assert.ok(advice[i - 1].value >= advice[i].value);
    assert.equal(advice.find(a => a.reaction === "null").value, 0);
});

test("adviseReaction knows ANCHOR beats REFLECT and that NULL is the only stop", () => {
    const advice = adviseReaction(createInitialDuelState(), ["GATE", "CLOSE", "ANCHOR"]);
    assert.equal(advice[0].reaction, "null");
    assert.ok(advice.find(a => a.reaction === "reflect").value < 0);
    assert.match(advice.find(a => a.reaction === "reflect").explanation, /no hostile route|ANCHOR/i);
});

test("reactionProbabilities is a distribution that follows the scoring table", () => {
    const view = { state: createInitialDuelState(), botId: "opponent" };
    const p = reactionProbabilities(["FIRE", "SEEK", "ENEMY"], view);
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.ok(p.reflect > p.none && p.reflect > p.null && p.reflect > p.silence);
});

test("adviseSpell ranks the player's spells by expected value under a reaction model", () => {
    // Against an opponent who always REFLECTs, unanchored hostile spells hand
    // over a seal; the GATE objective and anchored routes come out on top.
    const always = fixedReactionModel("reflect");
    const advice = adviseSpell(createInitialDuelState(), pool, always, { top: 5 });
    assert.equal(advice.length, 5);
    for (const a of advice) {
        assert.ok(a.expectedValue > 0, `${a.tokens.join(" ")} should still score against a reflector`);
        assert.ok(a.tokens.includes("GATE") || a.tokens.includes("ANCHOR"), a.tokens.join(" "));
        assert.match(a.explanation, /seal|REFLECT|ANCHOR|GATE/i);
    }
    const naked = adviseSpell(createInitialDuelState(), pool, always, { top: pool.length }).find(a => a.tokens.join(" ") === "FIRE SEEK ENEMY");
    assert.equal(naked.expectedValue, -1, "an open route against a guaranteed REFLECT loses a seal");
    assert.equal(naked.breakdown.length, 1);
    assert.equal(naked.breakdown[0].reaction, "reflect");
});

test("adviseSpell respects the opponent's ward and the model's probabilities", () => {
    const state = createInitialDuelState();
    state.players.opponent.ward = { ownerId: "opponent", essence: "fire" };
    const quiet = fixedReactionModel("none");
    const advice = adviseSpell(state, pool, quiet, { top: 3 });
    for (const a of advice) {
        assert.ok(!a.tokens.includes("FIRE"), "FIRE is walled off by the ward");
        assert.equal(a.expectedValue, 1);
    }
    // A 50/50 model halves the value of a reflectable spell.
    const half = () => ({ none: 0.5, reflect: 0.5, null: 0, silence: 0 });
    const shadow = adviseSpell(createInitialDuelState(), pool, half, { top: pool.length }).find(a => a.tokens.join(" ") === "SHADOW SEEK ENEMY");
    assert.equal(shadow.expectedValue, 0);
    assert.deepEqual(shadow.breakdown.map(b => b.reaction).sort(), ["none", "reflect"]);
});
