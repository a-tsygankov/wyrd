import assert from "node:assert/strict";
import test from "node:test";
import { scenarios } from "../dist/packages/wyrd-content/src/scenarios.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";
import { parseSpell } from "../dist/packages/wyrd-grammar/src/parser.js";

import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
const TRAY = new Set(POC_TRAY);

function stateFor(scenario) {
    const state = createInitialDuelState();
    if (scenario.setup?.playerWard) state.players.player.ward = { ownerId: "player", ...scenario.setup.playerWard };
    if (scenario.setup?.opponentWard) state.players.opponent.ward = { ownerId: "opponent", ...scenario.setup.opponentWard };
    return state;
}

function outcome(result) {
    if (result.sealAwardedTo === "player") return "player-seal";
    if (result.sealAwardedTo === "opponent") return "opponent-seal";
    if (result.steps.some(s => s.code === "WARD_BLOCKED")) return "blocked";
    if (result.effect?.canceled) return "canceled";
    return "no-seal";
}

test("the deck covers the POC-5 situations and is well-formed", () => {
    assert.ok(scenarios.length >= 6 && scenarios.length <= 10, `deck has ${scenarios.length} scenarios`);
    const ids = new Set(scenarios.map(s => s.id));
    assert.equal(ids.size, scenarios.length, "duplicate scenario id");
    for (const want of ["direct-threat", "amplify-bluff", "reflect-opportunity", "anchor-route", "silence-modifier", "null-hard-counter", "ward-interaction", "shattered-gate"]) {
        assert.ok(ids.has(want), `missing scenario ${want}`);
    }
    for (const s of scenarios) {
        assert.ok(s.title && s.lesson, `${s.id} needs title and lesson`);
        assert.ok(["high", "medium"].includes(s.telegraph), `${s.id} telegraph preset`);
        assert.ok(s.opponentSpell.every(t => TRAY.has(t)), `${s.id} uses a glyph outside the POC tray`);
        assert.equal(parseSpell(s.opponentSpell).status, "valid", `${s.id} opponent spell must parse`);
        assert.ok(["none", "bot", "null", "reflect", "silence"].includes(s.opponentReaction), `${s.id} opponentReaction`);
        assert.ok(s.responses.length >= 2, `${s.id} needs at least two documented responses so there is a real choice`);
        for (const r of s.responses) {
            assert.ok(r.label && r.expect, `${s.id} response needs label and expect`);
            assert.ok((r.reaction !== undefined) !== (r.spell !== undefined), `${s.id}/${r.label}: exactly one of reaction or spell`);
        }
    }
});

for (const scenario of scenarios) {
    test(`scenario ${scenario.id}: every documented response resolves as claimed`, () => {
        for (const response of scenario.responses) {
            const state = stateFor(scenario);
            let result;
            if (response.reaction !== undefined) {
                // The player reacts to the opponent's incoming spell.
                result = resolveEncounter(state, {
                    casterId: "opponent",
                    defenderId: "player",
                    spellTokens: scenario.opponentSpell,
                    ...(response.reaction ? { reaction: response.reaction } : {})
                });
            } else {
                // The player casts into the scenario's setup (e.g. an opponent ward).
                assert.ok(response.spell.every(t => TRAY.has(t)), `${scenario.id}/${response.label} uses a non-tray glyph`);
                result = resolveEncounter(state, { casterId: "player", defenderId: "opponent", spellTokens: response.spell });
            }
            assert.equal(outcome(result), response.expect, `${scenario.id} / ${response.label}: ${result.steps.map(s => s.code).join(" > ")}`);
        }
    });
}

test("the first scenario is a teaching round: the opponent does not react", () => {
    // The Playwright smoke test casts FIRE SEEK ENEMY in round 1 and expects
    // a seal; a reacting opponent in round 1 would break it and confuse a
    // brand-new player equally.
    assert.equal(scenarios[0].opponentReaction, "none");
});
