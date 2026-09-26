import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDuelState, resolveEncounter, beginNextRound } from "../dist/packages/wyrd-resolver/src/index.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import {
    PERSONALITIES,
    PLANS,
    choosePersonality,
    choosePlan,
    chooseBotSpell,
    reactionProbabilities,
    scoreSpell
} from "../dist/packages/wyrd-simulation/src/bot.js";

// The bot varies its play: a personality per match, a plan per round, a
// memory of its recent spells - all seeded, so `?seed=` still replays.

const pool = enumerateLegalSpells(POC_TRAY);
const fresh = () => createInitialDuelState(rulesets.teeth.rules);
const by = id => PERSONALITIES.find(p => p.id === id);

test("personalities and plans are seeded and cover the documented set", () => {
    assert.deepEqual(PERSONALITIES.map(p => p.id), ["balanced", "aggressor", "warden", "trickster", "gatekeeper"]);
    for (const p of PERSONALITIES) assert.ok(p.title.length > 2 && p.blurb.length > 20, p.id);
    assert.deepEqual(PLANS, ["strike", "shield", "gate", "trick", "probe"]);
    assert.equal(choosePersonality(createRng(4)).id, choosePersonality(createRng(4)).id);
    const ids = new Set(Array.from({ length: 40 }, (_, i) => choosePersonality(createRng(i)).id));
    assert.ok(ids.size >= 4, `expected several personalities across seeds, saw ${[...ids].join(",")}`);
    const view = { state: fresh(), botId: "opponent", personality: by("balanced") };
    assert.equal(choosePlan(view, createRng(2)), choosePlan(view, createRng(2)));
});

test("a personality bends the spell table its way", () => {
    const state = fresh();
    const spell = tokens => pool.find(s => s.tokens.join(" ") === tokens);
    const score = (id, tokens) => scoreSpell(spell(tokens), { state, botId: "opponent", personality: by(id) });
    assert.ok(score("aggressor", "FIRE SEEK ENEMY AMPLIFY") > score("balanced", "FIRE SEEK ENEMY AMPLIFY"));
    assert.ok(score("warden", "SELF WARD FIRE") > score("balanced", "SELF WARD FIRE"));
    assert.ok(score("trickster", "GATE OPEN REVERSE") > score("balanced", "GATE OPEN REVERSE"));
    assert.ok(score("gatekeeper", "GATE CLOSE") > score("balanced", "GATE CLOSE"));
});

test("the round plan shifts what the bot wants this round", () => {
    const state = fresh();
    const spell = tokens => pool.find(s => s.tokens.join(" ") === tokens);
    const under = (plan, tokens) => scoreSpell(spell(tokens), { state, botId: "opponent", personality: by("balanced"), plan });
    assert.ok(under("gate", "GATE CLOSE") > under("strike", "GATE CLOSE"));
    assert.ok(under("shield", "SELF WARD SHADOW") > under("strike", "SELF WARD SHADOW"));
    assert.ok(under("trick", "FIRE SEEK ENEMY SPLIT") > under("strike", "FIRE SEEK ENEMY SPLIT"));
    assert.ok(under("probe", "SEEK ENEMY") > under("probe", "FIRE SEEK ENEMY ANCHOR"), "probe spends little");
    assert.ok(under("probe", "SEEK ENEMY") - under("strike", "SEEK ENEMY") > under("probe", "FIRE SEEK ENEMY ANCHOR") - under("strike", "FIRE SEEK ENEMY ANCHOR"), "probe favours the cheap spell more than strike does");
});

test("the bot remembers its recent spells and does not fall into a loop", () => {
    const rng = createRng(11);
    const view = { state: fresh(), botId: "opponent", personality: by("balanced") };
    const recent = [];
    const seen = new Map();
    for (let round = 0; round < 12; round++) {
        const plan = choosePlan({ ...view, recentBotSpells: recent }, rng);
        const spell = chooseBotSpell(pool, { ...view, plan, recentBotSpells: recent }, rng);
        const key = spell.join(" ");
        assert.ok(!recent.slice(-3).some(s => s.join(" ") === key), `repeated ${key} within three rounds`);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        recent.push(spell);
    }
    assert.ok(seen.size >= 8, `12 rounds, only ${seen.size} distinct spells: ${[...seen.keys()].join(" | ")}`);
    // Same seed, same story.
    const again = [];
    const rng2 = createRng(11);
    for (let round = 0; round < 12; round++) {
        const plan = choosePlan({ ...view, recentBotSpells: again }, rng2);
        again.push(chooseBotSpell(pool, { ...view, plan, recentBotSpells: again }, rng2));
    }
    assert.deepEqual(again, recent);
});

test("a personality also shapes reactions, and the trickster is harder to predict", () => {
    const state = fresh();
    const incoming = ["FIRE", "SEEK", "ENEMY"];
    const p = id => reactionProbabilities(incoming, { state, botId: "opponent", personality: by(id) });
    assert.ok(p("warden").silence + p("warden").reflect > p("aggressor").silence + p("aggressor").reflect, "the warden answers more");
    assert.ok(p("aggressor").none > p("warden").none, "the aggressor saves Focus for its own spell");
    const spread = probs => Math.max(...Object.values(probs)) - Math.min(...Object.values(probs));
    assert.ok(spread(p("trickster")) < spread(p("balanced")), "the trickster's reactions are flatter");
});

test("no reaction is a certainty: the best answer stays under 85%, self-harming ones stay at zero", () => {
    const state = fresh();
    for (const personality of PERSONALITIES) {
        const p = reactionProbabilities(["FIRE", "SEEK", "ENEMY"], { state, botId: "opponent", personality });
        assert.ok(p.reflect < 0.85, `${personality.id} reflects ${p.reflect}`);
        assert.ok(p.reflect > 0.5, `${personality.id} still mostly finds the right answer (${p.reflect})`);
        assert.ok(p.none > 0.02 && p.null > 0.02, `${personality.id} sometimes does something else`);
        // GATE CLOSE REVERSE on an open gate fails; SILENCE would make it score. Never.
        const trap = reactionProbabilities(["GATE", "CLOSE", "REVERSE"], { state, botId: "opponent", personality });
        assert.equal(trap.silence, 0, `${personality.id} falls for the trap`);
    }
    const trickster = reactionProbabilities(["FIRE", "SEEK", "ENEMY"], { state, botId: "opponent", personality: by("trickster") });
    const adept = reactionProbabilities(["FIRE", "SEEK", "ENEMY"], { state, botId: "opponent", personality: by("balanced") });
    assert.ok(trickster.reflect < adept.reflect, "the trickster is the least predictable");
});

test("the aggressor, the narrowest personality, still spreads its spells", () => {
    const rng = createRng(21);
    const view = { state: fresh(), botId: "opponent", personality: by("aggressor") };
    const recent = [];
    const counts = new Map();
    for (let round = 0; round < 24; round++) {
        const plan = choosePlan({ ...view, recentBotSpells: recent }, rng);
        const spell = chooseBotSpell(pool, { ...view, plan, recentBotSpells: recent }, rng);
        counts.set(spell.join(" "), (counts.get(spell.join(" ")) ?? 0) + 1);
        recent.push(spell);
    }
    assert.ok(counts.size >= 12, `24 rounds, only ${counts.size} distinct spells`);
    assert.ok(Math.max(...counts.values()) <= 5, "no spell dominates");
});

test("legality survives the variety: every chosen spell resolves", () => {
    const rng = createRng(5);
    for (const personality of PERSONALITIES) {
        let state = fresh();
        const recent = [];
        for (let round = 0; round < 6; round++) {
            const view = { state, botId: "opponent", personality, recentBotSpells: recent };
            const spell = chooseBotSpell(pool, { ...view, plan: choosePlan(view, rng) }, rng);
            const result = resolveEncounter(state, { casterId: "opponent", defenderId: "player", spellTokens: spell });
            assert.ok(!result.steps.some(s => s.stage === "validation" && s.result === "failed"), `${personality.id}: ${spell.join(" ")} failed validation`);
            recent.push(spell);
            state = beginNextRound(result.state);
        }
    }
});
