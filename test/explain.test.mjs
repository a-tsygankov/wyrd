import assert from "node:assert/strict";
import test from "node:test";
import { explainMatch, explainReaction, explainRound, explainSpell } from "../dist/packages/wyrd-simulation/src/explain.js";
import { glyphHelp } from "../dist/packages/wyrd-content/src/glyphHelp.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";
import { projectTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
const TRAY = [...POC_TRAY];
const NAMES = { you: "You", them: "Opponent" };

test("every POC tray glyph has player-facing help that says how it affects whom", () => {
    for (const token of TRAY) {
        const help = glyphHelp[token];
        assert.ok(help, `${token} has no help`);
        assert.ok(help.role && help.text.length > 20, `${token} help too thin`);
    }
    assert.match(glyphHelp.ENEMY.text, /seal/i);
    assert.match(glyphHelp.ANCHOR.text, /REFLECT/);
    assert.match(glyphHelp.WARD.text, /scores nothing|no seal/i);
});

test("explainSpell narrates each glyph as it is added and what the cast will do", () => {
    const state = createInitialDuelState();
    const one = explainSpell(["FIRE"], state, NAMES);
    assert.equal(one.glyphs.length, 1);
    assert.equal(one.glyphs[0].token, "FIRE");
    assert.match(one.glyphs[0].text, /essence/i);
    assert.ok(one.summary.some(line => /2.4 glyph|incomplete|not yet/i.test(line)), one.summary.join(" | "));

    const full = explainSpell(["FIRE", "SEEK", "ENEMY"], state, NAMES);
    assert.equal(full.glyphs.length, 3);
    assert.ok(full.summary.some(line => /seal to you|you gain/i.test(line)), full.summary.join(" | "));
    assert.ok(full.summary.some(line => /REFLECT/.test(line) && /return|back/i.test(line)), "warns the route is open to REFLECT");

    const anchored = explainSpell(["FIRE", "SEEK", "ENEMY", "ANCHOR"], state, NAMES);
    assert.ok(anchored.summary.some(line => /ANCHOR/.test(line) && /REFLECT/.test(line)), "says ANCHOR protects against REFLECT");
    assert.ok(!anchored.summary.some(line => /open to REFLECT/i.test(line)));
});

test("explainSpell reads the opponent's ward and invalid syntax", () => {
    const state = createInitialDuelState();
    state.players.opponent.ward = { ownerId: "opponent", essence: "fire" };
    const blocked = explainSpell(["FIRE", "SEEK", "ENEMY"], state, NAMES);
    assert.ok(blocked.summary.some(line => /ward/i.test(line) && /block/i.test(line)), blocked.summary.join(" | "));
    const passes = explainSpell(["SHADOW", "SEEK", "ENEMY"], state, NAMES);
    assert.ok(passes.summary.some(line => /seal to you/i.test(line)));

    const bad = explainSpell(["SEEK", "AMPLIFY"], createInitialDuelState(), NAMES);
    assert.ok(bad.summary.some(line => /SEEK/.test(line) && /input|target|incomplete/i.test(line)), bad.summary.join(" | "));
});

test("explainReaction describes the chosen reaction against what the telegraph shows", () => {
    const rng = createRng(1);
    const high = projectTelegraph(["FIRE", "SEEK", "ENEMY", "ANCHOR"], "high", rng);
    assert.match(explainReaction(undefined, high), /no reaction|let it resolve/i);
    const reflect = explainReaction("reflect", high);
    assert.match(reflect, /SEEK/);
    assert.match(reflect, /target/i);
    assert.match(reflect, /ANCHOR/);
    const nul = explainReaction("null", high);
    assert.match(nul, /cancel/i);
    const silence = explainReaction("silence", high);
    assert.match(silence, /AMPLIFY|ANCHOR|modifier/);
    assert.match(silence, /still/i);
    // A telegraph that reveals CLOSE: REFLECT is known to be useless.
    const gate = projectTelegraph(["GATE", "CLOSE"], "high", rng);
    assert.match(explainReaction("reflect", gate), /nothing to reverse|no hostile|useless|wasted/i);
});

test("explainRound says who won the round and why, from both resolutions", () => {
    const state = createInitialDuelState();
    const incoming = resolveEncounter(state, {
        casterId: "opponent", defenderId: "player", spellTokens: ["FIRE", "SEEK", "ENEMY"], reaction: "reflect"
    });
    const outgoing = resolveEncounter(incoming.state, {
        casterId: "player", defenderId: "opponent", spellTokens: ["GATE", "CLOSE"], reaction: "silence"
    });
    const round = explainRound(
        { result: incoming, spell: ["FIRE", "SEEK", "ENEMY"], reaction: "reflect" },
        { result: outgoing, spell: ["GATE", "CLOSE"], reaction: "silence" },
        NAMES
    );
    assert.match(round.verdict, /You took the round/i);
    assert.match(round.verdict, /2.*0/);
    assert.ok(round.reasons.some(r => /REFLECT/.test(r) && /FIRE SEEK ENEMY/.test(r) && /seal/i.test(r)), round.reasons.join(" | "));
    assert.ok(round.reasons.some(r => /GATE CLOSE/.test(r) && /closed|seal/i.test(r)), round.reasons.join(" | "));
    assert.ok(round.reasons.some(r => /SILENCE/.test(r) && /nothing|no modifier|did not/i.test(r)), "explains the wasted SILENCE");

    const lost = resolveEncounter(createInitialDuelState(), {
        casterId: "opponent", defenderId: "player", spellTokens: ["ENEMY", "BIND", "ANCHOR"], reaction: "reflect"
    });
    const lostRound = explainRound({ result: lost, spell: ["ENEMY", "BIND", "ANCHOR"], reaction: "reflect" }, undefined, NAMES);
    assert.match(lostRound.verdict, /Opponent took the round/i);
    assert.ok(lostRound.reasons.some(r => /ANCHOR/.test(r) && /REFLECT/.test(r)), lostRound.reasons.join(" | "));

    const even = explainRound(
        { result: resolveEncounter(createInitialDuelState(), { casterId: "opponent", defenderId: "player", spellTokens: ["SELF", "WARD"] }), spell: ["SELF", "WARD"], reaction: undefined },
        undefined,
        NAMES
    );
    assert.match(even.verdict, /even|no seals/i);
});

test("explainMatch names the winner and where the seals came from", () => {
    const state = createInitialDuelState();
    state.players.player.seals = 3;
    state.players.opponent.seals = 1;
    const history = [
        { round: 1, reasons: ["You gained a seal: REFLECT returned FIRE SEEK ENEMY.", "Opponent gained a seal: ENEMY BIND reached you."] },
        { round: 2, reasons: ["You gained a seal: GATE CLOSE closed the gate."] },
        { round: 3, reasons: ["You gained a seal: SHADOW SEEK ENEMY reached the opponent."] }
    ];
    const text = explainMatch(state, history, NAMES);
    assert.match(text, /You win/i);
    assert.match(text, /3.*1/);
    assert.match(text, /REFLECT/);
    assert.match(text, /GATE CLOSE/);
    state.players.player.seals = 1;
    state.players.opponent.seals = 3;
    assert.match(explainMatch(state, history, NAMES), /Opponent wins/i);
});
