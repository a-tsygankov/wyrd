import assert from "node:assert/strict";
import test from "node:test";
import { parseSpell } from "../dist/packages/wyrd-grammar/src/parser.js";
import { beginNextRound, createInitialDuelState, resolveEncounter, resolveRound } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { PERSONALITIES, scoreReactions, scoreSpell } from "../dist/packages/wyrd-simulation/src/bot.js";
import { explainSpell, glyphHelpText } from "../dist/packages/wyrd-simulation/src/explain.js";
import { glyphFits } from "../dist/packages/wyrd-simulation/src/composer.js";
import { buildTimeline } from "../dist/apps/web/src/stage.js";

// docs/balance-analysis.md fix 4: a ward on the GATE. The owner's gate
// spells pass it; anyone else's are turned away until BREAK GATE removes it.

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    return resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
}
const codes = r => r.steps.map(s => s.code);
const NAMES = { you: "you", them: "the opponent" };

test("GATE WARD parses; a filtered gate ward does not resolve", () => {
    const parsed = parseSpell(["GATE", "WARD"]);
    assert.equal(parsed.status, "valid", JSON.stringify(parsed.diagnostics));
    assert.equal(parsed.ast.glyphId, "ward");
    assert.equal(parsed.focusCost, 2);
    assert.equal(parseSpell(["GATE", "WARD", "FIRE"]).status, "valid", "the grammar allows it");
    const filtered = cast(createInitialDuelState(), "player", ["GATE", "WARD", "FIRE"]);
    assert.ok(codes(filtered).includes("GATE_WARD_NO_ESSENCE"));
    assert.equal(filtered.steps.find(s => s.code === "GATE_WARD_NO_ESSENCE").stage, "validation");
});

test("a warded gate lets its owner's gate spells through and turns the other mage's away", () => {
    const fresh = createInitialDuelState();
    const warded = cast(fresh, "player", ["GATE", "WARD"]);
    assert.ok(codes(warded).includes("GATE_WARDED"));
    assert.deepEqual(warded.state.gateWard, { ownerId: "player" });
    assert.equal(warded.sealAwardedTo, undefined);

    const turned = cast(warded.state, "opponent", ["GATE", "CLOSE"]);
    assert.ok(codes(turned).includes("GATE_WARD_BLOCKED"));
    assert.equal(turned.state.gate, "open");
    assert.equal(turned.sealAwardedTo, undefined);
    assert.ok(codes(cast(warded.state, "opponent", ["GATE", "MEND"])).includes("GATE_WARD_BLOCKED"));

    const own = cast(warded.state, "player", ["GATE", "CLOSE"]);
    assert.equal(own.state.gate, "closed");
    assert.equal(own.sealAwardedTo, "player");
    assert.deepEqual(own.state.gateWard, { ownerId: "player" }, "the ward stays");
    assert.deepEqual(beginNextRound(own.state).gateWard, { ownerId: "player" }, "and persists across rounds");
    // NULL still cancels a gate spell before the ward is consulted; REFLECT still has no route.
    assert.ok(codes(cast(warded.state, "player", ["GATE", "CLOSE"], "null")).includes("NULL_CANCELED"));
});

test("BREAK GATE by the other mage shatters the ward, not the gate; the owner's BREAK shatters the gate", () => {
    const warded = cast(createInitialDuelState(), "player", ["GATE", "WARD"]).state;
    const broke = cast(warded, "opponent", ["GATE", "BREAK"]);
    assert.ok(codes(broke).includes("GATE_WARD_BROKEN"));
    assert.equal(broke.state.gateWard, undefined);
    assert.equal(broke.state.gate, "open", "the gate itself stands");
    assert.equal(broke.sealAwardedTo, undefined);
    const ownersBreak = cast(warded, "player", ["GATE", "BREAK"]);
    assert.equal(ownersBreak.state.gate, "broken");
    assert.deepEqual(ownersBreak.state.gateWard, { ownerId: "player" });
    // Re-warding hands the gate to the new owner.
    const taken = cast(broke.state, "opponent", ["GATE", "WARD"]);
    assert.deepEqual(taken.state.gateWard, { ownerId: "opponent" });
});

test("under Teeth the gate ward has integrity and dents like a mage's", () => {
    const teeth = createInitialDuelState(rulesets.teeth.rules);
    const warded = cast(teeth, "player", ["GATE", "WARD"]).state;
    assert.equal(warded.gateWard.integrity, 2);
    const dented = cast(warded, "opponent", ["GATE", "CLOSE"]);
    assert.ok(codes(dented).includes("GATE_WARD_DENTED"));
    assert.equal(dented.state.gateWard.integrity, 1);
    const shattered = cast(dented.state, "opponent", ["GATE", "CLOSE"]);
    assert.ok(codes(shattered).includes("GATE_WARD_BROKEN"));
    assert.equal(shattered.state.gateWard, undefined);
    assert.equal(shattered.state.gate, "open", "the shattering blow is still turned away");
    const amplified = cast(warded, "opponent", ["GATE", "CLOSE", "AMPLIFY"]);
    assert.ok(codes(amplified).includes("GATE_WARD_BROKEN"), "magnitude 2 shatters a fresh gate ward");
    const mended = cast(dented.state, "player", ["GATE", "MEND"]);
    assert.equal(mended.state.gateWard.integrity, 2, "the owner's MEND GATE restores the ward");
    assert.ok(codes(mended).includes("GATE_WARD_MENDED"));
});

test("two gate spells still contest the gate, ward or not", () => {
    const round = resolveRound(createInitialDuelState(), { player: { spellTokens: ["GATE", "WARD"] }, opponent: { spellTokens: ["GATE", "CLOSE"] } });
    assert.equal(round.contested, true);
    assert.equal(round.state.gateWard, undefined);
    assert.equal(round.state.gate, "open");
});

test("the pool, the tray fits, the bot and the explanations know the gate ward", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const spell = tokens => pool.find(s => s.tokens.join(" ") === tokens);
    assert.ok(spell("GATE WARD"), "GATE WARD is a legal spell");
    assert.equal(spell("GATE WARD FIRE"), undefined, "a filtered gate ward is not");
    assert.equal(glyphFits(["GATE"], POC_TRAY, pool).WARD, "complete");

    const state = createInitialDuelState(rulesets.teeth.rules);
    const view = { state, botId: "opponent", personality: PERSONALITIES[0] };
    assert.ok(scoreSpell(spell("GATE WARD"), view) > 0, "worth casting on an open board");
    const theirs = cast(state, "player", ["GATE", "WARD"]).state;
    const v2 = { state: theirs, botId: "opponent", personality: PERSONALITIES[0] };
    assert.ok(scoreSpell(spell("GATE BREAK"), v2) > scoreSpell(spell("GATE CLOSE"), v2), "break the ward before closing the gate");
    assert.ok(scoreSpell(spell("GATE WARD"), v2) < 0, "no second ward while theirs stands");
    // Reactions: the resolver probe knows the player's CLOSE fails against the bot's own gate ward.
    const mine = cast(state, "opponent", ["GATE", "WARD"]).state;
    const r = scoreReactions(["GATE", "CLOSE"], { state: mine, botId: "opponent", personality: PERSONALITIES[0] });
    assert.ok(r.none > r.null, "no need to NULL a spell the ward turns away");

    assert.match(glyphHelpText("WARD"), /GATE/);
    const summary = explainSpell(["GATE", "WARD"], state, NAMES).summary.join(" ");
    assert.match(summary, /gate/i);
    const blocked = explainSpell(["GATE", "CLOSE"], theirs, NAMES, "opponent").summary.join(" ");
    assert.match(blocked, /ward/i);
    assert.match(blocked, /BREAK/);
});

test("the stage draws the gate ward: up, block, break", () => {
    const kinds = c => buildTimeline(c).map(b => b.kind);
    const fresh = createInitialDuelState(rulesets.teeth.rules);
    const up = cast(fresh, "player", ["GATE", "WARD"]);
    assert.deepEqual(kinds({ result: up, casterId: "player", defenderId: "opponent", spell: ["GATE", "WARD"], reaction: undefined }), ["cast", "gate-ward-up"]);
    const blocked = cast(up.state, "opponent", ["GATE", "CLOSE"]);
    assert.deepEqual(kinds({ result: blocked, casterId: "opponent", defenderId: "player", spell: ["GATE", "CLOSE"], reaction: undefined }), ["cast", "gate-ward-block"]);
    const broken = cast(up.state, "opponent", ["GATE", "BREAK"]);
    assert.deepEqual(kinds({ result: broken, casterId: "opponent", defenderId: "player", spell: ["GATE", "BREAK"], reaction: undefined }), ["cast", "gate-ward-break"]);
});
