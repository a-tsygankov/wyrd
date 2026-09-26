import assert from "node:assert/strict";
import test from "node:test";
import { explainReaction, explainRound, explainSpell, glyphHelpText, lessonOutcomes } from "../dist/packages/wyrd-simulation/src/explain.js";
import { projectTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { createInitialDuelState, resolveEncounter, CLASSIC_RULES } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { scenarioById } from "../dist/packages/wyrd-content/src/scenarios.js";

const NAMES = { you: "you", them: "the opponent" };
const TEETH = rulesets.teeth.rules;
const RESOLVE = rulesets.resolve.rules;

test("glyph help adds only the lines the ruleset earns", () => {
    assert.equal(glyphHelpText("WARD", CLASSIC_RULES), glyphHelpText("WARD"));
    assert.ok(!/integrity/i.test(glyphHelpText("WARD", CLASSIC_RULES)));
    assert.match(glyphHelpText("WARD", TEETH), /Integrity 2/);
    assert.match(glyphHelpText("AMPLIFY", TEETH), /shatters a fresh ward/);
    assert.match(glyphHelpText("FIRE", TEETH), /Ignite/);
    assert.match(glyphHelpText("SEEK", RESOLVE), /Resolve/);
    assert.match(glyphHelpText("BIND", RESOLVE), /2 extra Focus/);
    assert.ok(!/Resolve/.test(glyphHelpText("SEEK", TEETH)), "Teeth has no hit points");
});

test("explainSpell states costs, ignite and ward integrity under Teeth", () => {
    const state = createInitialDuelState(TEETH);
    const plain = explainSpell(["FIRE", "SEEK", "ENEMY"], state, NAMES);
    assert.ok(plain.summary.some(l => /Costs 3 Focus; 4 left for a reaction/.test(l)), plain.summary.join(" | "));
    assert.ok(plain.summary.some(l => /REFLECT \(2 Focus\)/.test(l)));
    assert.ok(plain.summary.some(l => /NULL \(3 Focus\)/.test(l)));
    const ignited = createInitialDuelState(TEETH);
    ignited.players.player.lastEssence = "fire";
    const again = explainSpell(["FIRE", "SEEK", "ENEMY"], ignited, NAMES);
    assert.ok(again.summary.some(l => /ignite/i.test(l)), again.summary.join(" | "));
    assert.ok(again.summary.some(l => /magnitude 2/.test(l)));

    const warded = createInitialDuelState(TEETH);
    warded.players.opponent.ward = { ownerId: "opponent", essence: "fire", integrity: 1 };
    const blocked = explainSpell(["FIRE", "SEEK", "ENEMY"], warded, NAMES);
    assert.ok(blocked.summary.some(l => /ward blocks this/.test(l) && /shattered/i.test(l)), blocked.summary.join(" | "));

    const classic = explainSpell(["FIRE", "SEEK", "ENEMY"], createInitialDuelState(), NAMES);
    assert.ok(!classic.summary.some(l => /Focus\)/.test(l)), "no prices under Classic");
});

test("explainSpell mentions Resolve damage and the exposed warning", () => {
    const state = createInitialDuelState(RESOLVE);
    const spell = explainSpell(["FIRE", "SEEK", "ENEMY", "AMPLIFY"], state, NAMES);
    assert.ok(spell.summary.some(l => /resolve drops by 2/i.test(l)), spell.summary.join(" | "));
    const heavy = explainSpell(["FIRE", "SEEK", "ENEMY", "ANCHOR"], createInitialDuelState(TEETH), NAMES);
    assert.ok(heavy.summary.some(l => /Costs 5 Focus; 2 left/.test(l)));
    const broke = createInitialDuelState(TEETH);
    broke.players.player.focus = 3;
    const dry = explainSpell(["FIRE", "SEEK", "ENEMY"], broke, NAMES);
    assert.ok(dry.summary.some(l => /0 left/.test(l) && /exposes/.test(l)), dry.summary.join(" | "));
});

test("explainReaction prices reactions and warns when Focus is short", () => {
    const slots = projectTelegraph(["FIRE", "SEEK", "ENEMY"], "high", createRng(1));
    assert.ok(!/Focus/.test(explainReaction("reflect", slots, CLASSIC_RULES)));
    assert.match(explainReaction("reflect", slots, TEETH), /Costs 2 of your Focus/);
    assert.match(explainReaction("null", slots, TEETH, 2), /You have 2: it would fail/);
    assert.match(explainReaction("silence", slots, TEETH), /spares your ward one dent/);
    assert.match(explainReaction(undefined, slots, TEETH), /all 7 Focus go to your spell/);
    assert.match(explainReaction("reflect", slots, RESOLVE), /Resolve damage/);
});

test("explainRound reports dents, shatters, unpaid reactions and Resolve damage", () => {
    const state = createInitialDuelState(TEETH);
    state.players.player.ward = { ownerId: "player", essence: "fire", integrity: 2 };
    state.players.player.focus = 1;
    const incoming = resolveEncounter(state, {
        casterId: "opponent", defenderId: "player", spellTokens: ["FIRE", "SEEK", "ENEMY", "AMPLIFY"], reaction: "null"
    });
    const round = explainRound({ result: incoming, spell: ["FIRE", "SEEK", "ENEMY", "AMPLIFY"], reaction: "null" }, undefined, NAMES);
    assert.ok(round.reasons.some(r => /blocked by you's ward|blocked by your ward|blocked by you/.test(r) && /shattered/i.test(r)), round.reasons.join(" | "));
    assert.ok(round.reasons.some(r => /NULL could not be paid/.test(r)), round.reasons.join(" | "));

    const hp = createInitialDuelState(RESOLVE);
    const hit = resolveEncounter(hp, { casterId: "opponent", defenderId: "player", spellTokens: ["FIRE", "SEEK", "ENEMY"] });
    const hpRound = explainRound({ result: hit, spell: ["FIRE", "SEEK", "ENEMY"], reaction: undefined }, undefined, NAMES);
    assert.ok(hpRound.reasons.some(r => /gained a seal/.test(r) && /resolve drops by 1/i.test(r)), hpRound.reasons.join(" | "));
});

test("lessonOutcomes resolves the deck's responses under the rules in force", () => {
    const direct = scenarioById("direct-threat");
    const classic = lessonOutcomes(direct, createInitialDuelState(), NAMES);
    assert.equal(classic.length, direct.responses.length);
    assert.equal(classic.find(l => l.label === "REFLECT").outcome, "player-seal");
    assert.match(classic.find(l => l.label === "REFLECT").text, /seal to you/);

    // Under Resolve the same response also reports the damage it deals.
    const withHp = lessonOutcomes(direct, createInitialDuelState(RESOLVE), NAMES);
    assert.match(withHp.find(l => l.label === "No reaction").text, /resolve drops/i);

    // Ward scenario under Teeth: the blocked cast shows the dent.
    const wardScenario = scenarioById("ward-interaction");
    const start = createInitialDuelState(TEETH);
    start.players.opponent.ward = { ownerId: "opponent", essence: "fire", integrity: 2 };
    const teeth = lessonOutcomes(wardScenario, start, NAMES);
    const fire = teeth.find(l => l.label === "Cast FIRE SEEK ENEMY");
    assert.equal(fire.outcome, "blocked");
    assert.match(fire.text, /dented|integrity 1/i);
});
