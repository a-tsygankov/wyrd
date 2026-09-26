import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { PERSONALITIES, scoreReactions, scoreSpell } from "../dist/packages/wyrd-simulation/src/bot.js";
import { explainSpell, explainReaction, glyphHelpText } from "../dist/packages/wyrd-simulation/src/explain.js";
import { projectTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

// docs/balance-analysis.md, fixes 1 and 2: the bot answers a scoring gate
// spell, and an ANCHORed hostile spell is blocked by any ward.

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    return resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
}
const codes = r => r.steps.map(s => s.code);
const NAMES = { you: "you", them: "the opponent" };

test("every personality rates NULL highly against a gate spell that would score, and low against one that would not", () => {
    for (const personality of PERSONALITIES) {
        const open = { state: createInitialDuelState(rulesets.teeth.rules), botId: "opponent", personality };
        assert.ok(scoreReactions(["GATE", "CLOSE"], open).null >= 2.5, `${personality.id} lets CLOSE through`);
        assert.ok(scoreReactions(["GATE", "OPEN"], open).null < 0, `${personality.id} wastes NULL on a failing OPEN`);
        const shut = { ...open, state: { ...open.state, gate: "closed" } };
        assert.ok(scoreReactions(["GATE", "OPEN"], shut).null >= 2.5, `${personality.id} lets OPEN through`);
        assert.ok(scoreReactions(["GATE", "OPEN", "REVERSE"], open).null >= 2.5, `${personality.id} misses the REVERSEd close`);
    }
});

test("the bot checks each reaction against the resolver: no SILENCE that un-reverses a trick, NULL when nothing else answers", () => {
    const open = { state: createInitialDuelState(rulesets.teeth.rules), botId: "opponent", personality: PERSONALITIES[0] };
    // GATE CLOSE REVERSE on an open gate is OPEN, which fails; SILENCE would turn it back into the scoring CLOSE.
    const trap = scoreReactions(["GATE", "CLOSE", "REVERSE"], open);
    assert.ok(trap.silence < 0, `silence ${trap.silence} falls for the trap`);
    assert.ok(trap.none > trap.null, "let a failing spell fail");
    // GATE OPEN REVERSE on an open gate closes it: SILENCE undoes the trick for 1 Focus, NULL also answers.
    const trick = scoreReactions(["GATE", "OPEN", "REVERSE"], open);
    assert.ok(trick.silence >= 3 && trick.null >= 2.5);
    // FIRE SEEK ENEMY ANCHOR on a fresh board: SILENCE strips nothing that matters, REFLECT fails, only NULL answers.
    const anchored = scoreReactions(["FIRE", "SEEK", "ENEMY", "ANCHOR"], open);
    assert.ok(anchored.silence < 0 && anchored.reflect < 0 && anchored.null >= 2.5, JSON.stringify(anchored));
    // Against the trickster too: the probe overrides the personality bias.
    const trickster = { ...open, personality: PERSONALITIES.find(p => p.id === "trickster") };
    assert.ok(scoreReactions(["GATE", "CLOSE", "REVERSE"], trickster).silence < 0);
});

test("a fixed route is a known route: any ward blocks an ANCHORed hostile spell", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    state.players.opponent.ward = { ownerId: "opponent", essence: "shadow", integrity: 2 };
    const anchored = cast(state, "player", ["FIRE", "SEEK", "ENEMY", "ANCHOR"]);
    assert.ok(codes(anchored).includes("WARD_BLOCKED"));
    assert.match(anchored.steps.find(s => s.code === "WARD_BLOCKED").text, /ANCHOR/);
    assert.equal(anchored.sealAwardedTo, undefined);
    assert.equal(anchored.state.players.opponent.ward.integrity, 1, "it still dents");
    const plain = cast(state, "player", ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(plain.sealAwardedTo, "player", "an unanchored FIRE spell still passes a SHADOW ward");
    const bind = cast(state, "player", ["ENEMY", "BIND", "ANCHOR"]);
    assert.ok(codes(bind).includes("WARD_BLOCKED"));
    // SILENCE strips the anchor, and with it the reason the ward could catch the spell.
    const silenced = cast(state, "player", ["FIRE", "SEEK", "ENEMY", "ANCHOR"], "silence");
    assert.equal(silenced.sealAwardedTo, "player");
    // Non-hostile anchored spells and gate spells are untouched.
    assert.ok(codes(cast(state, "player", ["GATE", "CLOSE", "ANCHOR"])).includes("GATE_CLOSED"));
    assert.ok(codes(cast(state, "player", ["SELF", "WARD", "FIRE", "ANCHOR"])).includes("WARD_CREATED"));
});

test("the bot's ward model and the explanations follow the anchor rule", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const spell = tokens => pool.find(s => s.tokens.join(" ") === tokens);
    const state = createInitialDuelState(rulesets.teeth.rules);
    state.players.player.ward = { ownerId: "player", essence: "shadow", integrity: 2 };
    const view = { state, botId: "opponent", personality: PERSONALITIES[0] };
    assert.ok(scoreSpell(spell("FIRE SEEK ENEMY ANCHOR"), view) < scoreSpell(spell("FIRE SEEK ENEMY"), view), "the bot does not anchor into a ward");
    const summary = explainSpell(["FIRE", "SEEK", "ENEMY", "ANCHOR"], (() => { const s = createInitialDuelState(rulesets.teeth.rules); s.players.opponent.ward = { ownerId: "opponent", essence: "shadow", integrity: 2 }; return s; })(), NAMES).summary.join(" ");
    assert.match(summary, /ANCHOR/);
    assert.match(summary, /ward/i);
    assert.match(glyphHelpText("ANCHOR"), /any ward/i);
    const telegraph = projectTelegraph(["FIRE", "SEEK", "ENEMY", "ANCHOR"], "high", createRng(1));
    assert.match(explainReaction("silence", telegraph), /ward/i);
});
