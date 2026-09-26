import assert from "node:assert/strict";
import test from "node:test";
import { parseSpell } from "../dist/packages/wyrd-grammar/src/parser.js";
import { glyphs } from "../dist/packages/wyrd-content/src/glyphs.js";
import { glyphHelp } from "../dist/packages/wyrd-content/src/glyphHelp.js";
import { POC_TRAY, TRAY_FAMILY } from "../dist/packages/wyrd-content/src/tray.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { createInitialDuelState, resolveEncounter, ROUND_FOCUS } from "../dist/packages/wyrd-resolver/src/index.js";
import { classifySpell, enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { scoreReactions, scoreSpell } from "../dist/packages/wyrd-simulation/src/bot.js";
import { glyphFits } from "../dist/packages/wyrd-simulation/src/composer.js";
import { explainReaction, explainRound, explainSpell } from "../dist/packages/wyrd-simulation/src/explain.js";
import { projectTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { buildTimeline } from "../dist/apps/web/src/stage.js";

// Grammar extension, first slice: WEAKEN, REVERSE and SPLIT from
// Wyrd_Grammar_Spec.md §10 and the conflict rules of §12; every registry
// glyph explained; parser diagnostics that name the offending glyph; the
// composer's compatibility map for the next glyph.

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    return resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
}
const codes = r => r.steps.map(s => s.code);
const NAMES = { you: "you", them: "the opponent" };

// --- parser -----------------------------------------------------------------

test("a postfix modifier placed before its action is named, with the fix", () => {
    const result = parseSpell(["AMPLIFY", "SEEK", "ENEMY"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0].glyphId, "amplify");
    assert.match(result.diagnostics[0].message, /after/i);
    assert.match(result.diagnostics[0].message, /SEEK/);
});

test("a modifier with no action to modify says which actions would do", () => {
    const result = parseSpell(["FIRE", "AMPLIFY"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0].glyphId, "amplify");
    assert.match(result.diagnostics[0].message, /SEEK/);
});

test("values with no action between them list the actions", () => {
    const result = parseSpell(["FIRE", "ENEMY"]);
    assert.equal(result.status, "invalid");
    assert.match(result.diagnostics[0].message, /SEEK/);
    assert.match(result.diagnostics[0].message, /MEND/);
});

test("an orphan value is named together with the slot that is already taken", () => {
    const result = parseSpell(["SELF", "ENEMY", "SEEK"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0].code, "ORPHAN_GLYPH");
    assert.match(result.diagnostics[0].message, /SELF|ENEMY/);
    assert.match(result.diagnostics[0].message, /SEEK/);
    assert.match(result.diagnostics[0].message, /target/);
});

test("a missing required input lists the glyphs that would fill it", () => {
    const result = parseSpell(["FIRE", "SEEK"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0].code, "MISSING_INPUT");
    assert.match(result.diagnostics[0].message, /ENEMY/);
    assert.match(result.diagnostics[0].message, /AREA/);
});

test("a modifier that cannot attach after DELAY says so", () => {
    const result = parseSpell(["SEEK", "ENEMY", "DELAY", "AMPLIFY"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0].glyphId, "amplify");
    assert.match(result.diagnostics[0].message, /DELAY/);
    assert.equal(parseSpell(["SEEK", "ENEMY", "AMPLIFY", "DELAY"]).status, "valid");
});

// --- content ----------------------------------------------------------------

test("every registry glyph has player-facing help", () => {
    for (const glyph of glyphs) {
        const help = glyphHelp[glyph.displayName];
        assert.ok(help, `${glyph.displayName} has no help`);
        assert.ok(help.text.length > 30, `${glyph.displayName} help is too short`);
    }
});

test("the tray adds WEAKEN, SPLIT and REVERSE beside AMPLIFY and ANCHOR", () => {
    assert.equal(POC_TRAY.length, 19);
    for (const token of ["WEAKEN", "SPLIT", "REVERSE"]) {
        assert.ok(POC_TRAY.includes(token), token);
        assert.equal(TRAY_FAMILY[token], "modifier");
    }
    for (const token of POC_TRAY) assert.ok(TRAY_FAMILY[token], `${token} has no tray family`);
});

test("BREAK and MEND are inverses in the registry", () => {
    assert.equal(glyphs.find(g => g.id === "break").inverseOf, "mend");
    assert.equal(glyphs.find(g => g.id === "mend").inverseOf, "break");
});

// --- resolver ---------------------------------------------------------------

test("WEAKEN lowers magnitude by one and cancels AMPLIFY", () => {
    const hp = createInitialDuelState(rulesets.resolve.rules);
    const weak = cast(hp, "player", ["SEEK", "ENEMY", "WEAKEN"]);
    assert.ok(codes(weak).includes("WEAKEN_APPLIED"));
    assert.equal(weak.effect.magnitude, 0);
    assert.ok(!codes(weak).includes("RESOLVE_DAMAGE"), "magnitude 0 deals nothing");
    assert.equal(weak.sealAwardedTo, "player", "it still reaches");
    assert.equal(cast(hp, "player", ["SEEK", "ENEMY", "AMPLIFY", "WEAKEN"]).effect.magnitude, 1);
    const teeth = createInitialDuelState(rulesets.teeth.rules);
    teeth.players.opponent.ward = { ownerId: "opponent", integrity: 2 };
    const dent = cast(teeth, "player", ["SEEK", "ENEMY", "WEAKEN"]);
    assert.ok(codes(dent).includes("WARD_BLOCKED"));
    assert.equal(dent.state.players.opponent.ward.integrity, 2, "a magnitude-0 blow leaves no dent");
    // SILENCE strips WEAKEN like any modifier: the base magnitude is back.
    assert.equal(cast(hp, "player", ["SEEK", "ENEMY", "WEAKEN"], "silence").effect.magnitude, 1);
});

test("REVERSE swaps an action for its inverse: OPEN↔CLOSE, BREAK↔MEND", () => {
    const fresh = createInitialDuelState();
    const closed = cast(fresh, "player", ["GATE", "OPEN", "REVERSE"]);
    assert.ok(codes(closed).includes("REVERSE_APPLIED"));
    assert.match(closed.steps.find(s => s.code === "REVERSE_APPLIED").text, /OPEN into CLOSE/);
    assert.equal(closed.state.gate, "closed");
    assert.equal(closed.sealAwardedTo, "player");
    assert.equal(closed.effect.action, "close");
    assert.ok(codes(cast(fresh, "player", ["GATE", "OPEN", "REVERSE", "ANCHOR"])).includes("REVERSE_APPLIED"), "ANCHOR protects route, not meaning");

    const teeth = createInitialDuelState(rulesets.teeth.rules);
    teeth.players.player.ward = { ownerId: "player", integrity: 1 };
    assert.ok(codes(cast(teeth, "player", ["SELF", "BREAK", "REVERSE"])).includes("WARD_MENDED"));

    // SILENCE strips REVERSE with the other modifiers: the telegraphed OPEN is what lands.
    const silenced = cast(fresh, "player", ["GATE", "OPEN", "REVERSE"], "silence");
    assert.ok(codes(silenced).includes("GATE_ALREADY_OPEN"));
    assert.ok(!codes(silenced).includes("REVERSE_APPLIED"));
    // NULL still cancels it outright.
    assert.ok(codes(cast(fresh, "player", ["GATE", "OPEN", "REVERSE"], "null")).includes("NULL_CANCELED"));
});

test("REVERSE flips AMPLIFY to WEAKEN when the action has no inverse; with nothing to invert it is invalid", () => {
    const hp = createInitialDuelState(rulesets.resolve.rules);
    const flipped = cast(hp, "player", ["SEEK", "ENEMY", "AMPLIFY", "REVERSE"]);
    assert.ok(codes(flipped).includes("REVERSE_MAGNITUDE"));
    assert.equal(flipped.effect.magnitude, 0);
    assert.equal(cast(hp, "player", ["SEEK", "ENEMY", "WEAKEN", "REVERSE"]).effect.magnitude, 2);
    const invalid = cast(hp, "player", ["SEEK", "ENEMY", "REVERSE"]);
    assert.ok(codes(invalid).includes("REVERSE_NO_INVERSE"));
    assert.equal(invalid.steps.find(s => s.code === "REVERSE_NO_INVERSE").stage, "validation");
    assert.equal(invalid.effect, undefined);
    assert.equal(invalid.state.players.player.focus, ROUND_FOCUS, "an invalid spell costs nothing");
    assert.ok(codes(cast(hp, "player", ["ENEMY", "BIND", "REVERSE"])).includes("REVERSE_NO_INVERSE"), "BIND has no RELEASE yet");
    assert.ok(codes(cast(hp, "player", ["SELF", "WARD", "REVERSE"])).includes("REVERSE_NO_INVERSE"));
});

test("SPLIT resolves two branches; a single REFLECT turns back only one", () => {
    const hp = createInitialDuelState(rulesets.resolve.rules);
    const split = cast(hp, "player", ["FIRE", "SEEK", "ENEMY", "SPLIT"]);
    assert.ok(codes(split).includes("SPLIT_APPLIED"));
    assert.equal(split.branches.length, 2);
    assert.equal(split.state.players.opponent.resolve, 8, "two hits of magnitude 1");
    assert.equal(split.state.players.player.seals, 1, "one seal per encounter, not per branch");
    assert.equal(split.sealAwardedTo, "player");
    assert.deepEqual(split.sealsAwarded, { player: 1 });

    const reflected = cast(hp, "player", ["FIRE", "SEEK", "ENEMY", "SPLIT"], "reflect");
    assert.ok(codes(reflected).includes("REFLECT_APPLIED"));
    assert.equal(reflected.state.players.opponent.resolve, 9, "one branch still lands");
    assert.equal(reflected.state.players.player.resolve, 9, "the other comes home");
    assert.deepEqual(reflected.sealsAwarded, { player: 1, opponent: 1 });
    assert.equal(reflected.sealAwardedTo, "player", "the caster's seal is the primary one");
    assert.equal(reflected.effect.reflected, false);
    assert.equal(reflected.branches[1].reflected, true);

    const anchored = cast(hp, "player", ["SEEK", "ENEMY", "SPLIT", "ANCHOR"], "reflect");
    assert.ok(codes(anchored).includes("REFLECT_BLOCKED_BY_ANCHOR"));
    assert.equal(anchored.state.players.opponent.resolve, 8);

    const teeth = createInitialDuelState(rulesets.teeth.rules);
    teeth.players.opponent.ward = { ownerId: "opponent", integrity: 2 };
    assert.ok(codes(cast(teeth, "player", ["SEEK", "ENEMY", "SPLIT"])).includes("WARD_BROKEN"), "two dents shatter a fresh ward");

    // SILENCE strips SPLIT: one branch, one hit. NULL cancels both.
    assert.equal(cast(hp, "player", ["FIRE", "SEEK", "ENEMY", "SPLIT"], "silence").state.players.opponent.resolve, 9);
    assert.equal(cast(hp, "player", ["FIRE", "SEEK", "ENEMY", "SPLIT"], "null").state.players.opponent.resolve, 10);
    // A split gate spell: the second branch finds the gate already moved.
    const gate = cast(createInitialDuelState(), "player", ["GATE", "CLOSE", "SPLIT"]);
    assert.equal(gate.state.gate, "closed");
    assert.equal(gate.state.players.player.seals, 1);
    assert.ok(codes(gate).includes("GATE_ALREADY_CLOSED"));
});

// --- simulation -------------------------------------------------------------

test("the legal pool covers the new modifiers and refuses REVERSE without an inverse", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const keys = new Set(pool.map(s => s.tokens.join(" ")));
    for (const k of ["GATE OPEN REVERSE", "FIRE SEEK ENEMY SPLIT", "SEEK ENEMY WEAKEN", "ENEMY BREAK REVERSE", "GATE CLOSE SPLIT ANCHOR"]) {
        assert.ok(keys.has(k), `missing ${k}`);
    }
    assert.ok(!keys.has("SEEK ENEMY REVERSE"));
    assert.equal(classifySpell(["GATE", "OPEN", "REVERSE"]).action, "close", "the pool records what the spell does after REVERSE");
    assert.deepEqual(classifySpell(["FIRE", "SEEK", "ENEMY", "SPLIT"]).modifiers, ["split"]);
    assert.equal(classifySpell(["SEEK", "ENEMY", "REVERSE"]), undefined);
});

test("the bot reads the new modifiers: SPLIT blunts REFLECT, REVERSE invites SILENCE", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const spell = tokens => pool.find(s => s.tokens.join(" ") === tokens);
    const view = { state: createInitialDuelState(rulesets.teeth.rules), botId: "opponent" };
    assert.ok(scoreReactions(["FIRE", "SEEK", "ENEMY", "SPLIT"], view).reflect < scoreReactions(["FIRE", "SEEK", "ENEMY"], view).reflect);
    assert.ok(scoreReactions(["GATE", "OPEN", "REVERSE"], view).silence > scoreReactions(["GATE", "OPEN"], view).silence);
    assert.ok(scoreSpell(spell("GATE OPEN REVERSE"), view) > scoreSpell(spell("GATE OPEN"), view), "the gate is open: OPEN fails, REVERSEd it closes");
    assert.ok(scoreSpell(spell("FIRE SEEK ENEMY SPLIT"), view) > scoreSpell(spell("FIRE SEEK ENEMY WEAKEN"), view));
});

test("glyphFits marks each tray glyph as completing, keeping open or breaking the spell", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const empty = glyphFits([], POC_TRAY, pool);
    assert.equal(empty.FIRE, "open");
    assert.equal(empty.SEEK, "open");
    assert.equal(empty.AMPLIFY, "incompatible", "a modifier cannot come first");

    const fire = glyphFits(["FIRE"], POC_TRAY, pool);
    assert.equal(fire.SEEK, "open");
    assert.equal(fire.WATER, "incompatible", "two essences never fit one spell");
    assert.equal(fire.ENEMY, "open");
    assert.equal(fire.CLOSE, "incompatible", "CLOSE takes no essence");
    assert.equal(fire.BIND, "incompatible", "BIND takes no essence");

    const seek = glyphFits(["FIRE", "SEEK"], POC_TRAY, pool);
    assert.equal(seek.ENEMY, "complete");
    assert.equal(seek.SELF, "complete");
    assert.equal(seek.GATE, "incompatible");
    assert.equal(seek.AMPLIFY, "open", "the target can still follow the modifier");

    const gate = glyphFits(["GATE", "CLOSE"], POC_TRAY, pool);
    assert.equal(gate.ANCHOR, "complete");
    assert.equal(gate.REVERSE, "complete");
    assert.equal(gate.SPLIT, "complete");
    assert.equal(gate.SEEK, "incompatible", "one action per spell");
    assert.equal(gate.ENEMY, "incompatible");

    const full = glyphFits(["FIRE", "SEEK", "ENEMY", "AMPLIFY"], POC_TRAY, pool);
    assert.ok(Object.values(full).every(fit => fit === "incompatible"), "four glyphs is the limit");

    const poor = glyphFits(["GATE", "CLOSE"], POC_TRAY, pool, 3);
    assert.equal(poor.ANCHOR, "incompatible", "ANCHOR would cost 4 of a 3-Focus budget");
    assert.equal(poor.WEAKEN, "complete");

    const seekEnemy = glyphFits(["SEEK", "ENEMY"], POC_TRAY, pool);
    assert.equal(seekEnemy.REVERSE, "open", "SEEK has no inverse, but AMPLIFY after REVERSE gives it one to flip");
    assert.equal(glyphFits(["SEEK", "ENEMY", "ANCHOR"], POC_TRAY, pool).REVERSE, "incompatible", "nothing left to invert and no room for AMPLIFY");
    assert.equal(seekEnemy.AMPLIFY, "complete");
    assert.equal(glyphFits(["SEEK", "ENEMY", "AMPLIFY"], POC_TRAY, pool).REVERSE, "complete", "with AMPLIFY to flip, REVERSE fits");
});

// --- explanations -----------------------------------------------------------

test("the composer summary explains the new modifiers in the player's terms", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    const reverse = explainSpell(["GATE", "OPEN", "REVERSE"], state, NAMES).summary.join(" ");
    assert.match(reverse, /REVERSE/);
    assert.match(reverse, /CLOSE/);
    assert.match(reverse, /seal to you/i);
    const split = explainSpell(["FIRE", "SEEK", "ENEMY", "SPLIT"], state, NAMES).summary.join(" ");
    assert.match(split, /branch/i);
    assert.match(split, /REFLECT/);
    const weak = explainSpell(["SEEK", "ENEMY", "WEAKEN"], state, NAMES).summary.join(" ");
    assert.match(weak, /magnitude 0|no dent|nothing/i);
    const invalid = explainSpell(["SEEK", "ENEMY", "REVERSE"], state, NAMES).summary.join(" ");
    assert.match(invalid, /inverse/i);
});

test("the reaction explanation names every action the telegraph can show and knows REVERSE is a modifier", () => {
    const open = projectTelegraph(["GATE", "OPEN", "REVERSE"], "high", createRng(1));
    assert.match(explainReaction("reflect", open), /OPEN/);
    assert.match(explainReaction("reflect", open), /wasted|no hostile route/i);
    assert.match(explainReaction("silence", open), /REVERSE/);
    const brk = projectTelegraph(["ENEMY", "BREAK"], "high", createRng(1));
    assert.match(explainReaction(undefined, brk), /BREAK/);
});

test("the round verdict counts a seal for each side when a SPLIT branch comes home", () => {
    const hp = createInitialDuelState(rulesets.resolve.rules);
    const reflected = cast(hp, "opponent", ["FIRE", "SEEK", "ENEMY", "SPLIT"], "reflect");
    const round = explainRound({ result: reflected, spell: ["FIRE", "SEEK", "ENEMY", "SPLIT"], reaction: "reflect" }, undefined, NAMES);
    assert.equal(round.yourSeals, 1);
    assert.equal(round.theirSeals, 1);
});

test("the stage shows both SPLIT branches and a REVERSE beat", () => {
    const hp = createInitialDuelState(rulesets.resolve.rules);
    const kinds = c => buildTimeline(c).map(b => b.kind);
    const reflected = cast(hp, "player", ["FIRE", "SEEK", "ENEMY", "SPLIT"], "reflect");
    assert.deepEqual(
        kinds({ result: reflected, casterId: "player", defenderId: "opponent", spell: ["FIRE", "SEEK", "ENEMY", "SPLIT"], reaction: "reflect" }),
        ["cast", "split", "fly", "hit", "reflect", "fly", "hit", "seal", "seal"]
    );
    const closed = cast(createInitialDuelState(), "player", ["GATE", "OPEN", "REVERSE"]);
    assert.deepEqual(kinds({ result: closed, casterId: "player", defenderId: "opponent", spell: ["GATE", "OPEN", "REVERSE"], reaction: undefined }), ["cast", "reverse", "gate-close", "seal"]);
});
