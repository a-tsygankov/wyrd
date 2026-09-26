import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDuelState, gateContested, initiative, resolveRound } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { explainRound } from "../dist/packages/wyrd-simulation/src/explain.js";

// docs/balance-analysis.md fix 3: who resolves first is decided by play
// (the cheaper spell, then the mage behind, then the round), not by seat;
// and two gate spells in one round cancel each other.

const NAMES = { you: "you", them: "the opponent" };
const codes = r => r.steps.map(s => s.code);

test("initiative: the cheaper spell resolves first, then the mage with fewer seals, then the round's parity", () => {
    const state = createInitialDuelState();
    assert.deepEqual(initiative(state, { player: ["SEEK", "ENEMY"], opponent: ["FIRE", "SEEK", "ENEMY"] }), { first: "player", reason: "focus" });
    assert.deepEqual(initiative(state, { player: ["FIRE", "SEEK", "ENEMY", "ANCHOR"], opponent: ["GATE", "CLOSE"] }), { first: "opponent", reason: "focus" });
    const behind = createInitialDuelState();
    behind.players.player.seals = 1;
    assert.deepEqual(initiative(behind, { player: ["GATE", "CLOSE"], opponent: ["GATE", "CLOSE"] }), { first: "opponent", reason: "seals" });
    assert.deepEqual(initiative(state, { player: ["GATE", "CLOSE"], opponent: ["GATE", "CLOSE"] }), { first: "player", reason: "round" }, "round 1: the player");
    const even = { ...state, round: 2 };
    assert.deepEqual(initiative(even, { player: ["GATE", "CLOSE"], opponent: ["GATE", "CLOSE"] }), { first: "opponent", reason: "round" }, "round 2: the opponent");
    // An invalid spell never has initiative.
    assert.equal(initiative(state, { player: ["FIRE", "FIRE"], opponent: ["FIRE", "SEEK", "ENEMY", "ANCHOR"] }).first, "opponent");
});

test("initiative: under Pulse a quick cast resolves first whatever it cost", () => {
    const state = createInitialDuelState(rulesets.pulse.rules);
    assert.deepEqual(
        initiative(state, { player: ["FIRE", "SEEK", "ENEMY", "ANCHOR"], opponent: ["SEEK", "ENEMY"] }, { quickCast: { player: true } }),
        { first: "player", reason: "quick" }
    );
    assert.equal(initiative(state, { player: ["FIRE", "SEEK", "ENEMY", "ANCHOR"], opponent: ["SEEK", "ENEMY"] }, { quickCast: { player: true, opponent: true } }).reason, "focus", "both quick: back to Focus");
    assert.equal(initiative(createInitialDuelState(), { player: ["FIRE", "SEEK", "ENEMY", "ANCHOR"], opponent: ["SEEK", "ENEMY"] }, { quickCast: { player: true } }).first, "opponent", "no quick cast rule under Classic");
});

test("two gate spells in one round contest the gate: it shudders and holds, nobody scores", () => {
    assert.equal(gateContested({ player: ["GATE", "CLOSE"], opponent: ["GATE", "CLOSE"] }), true);
    assert.equal(gateContested({ player: ["GATE", "MEND"], opponent: ["GATE", "BREAK", "ANCHOR"] }), true);
    assert.equal(gateContested({ player: ["GATE", "CLOSE"], opponent: ["ENEMY", "BREAK"] }), false);
    assert.equal(gateContested({ player: ["GATE", "CLOSE"], opponent: ["FIRE", "FIRE"] }), false, "an invalid spell contests nothing");

    const round = resolveRound(createInitialDuelState(), {
        player: { spellTokens: ["GATE", "CLOSE"] },
        opponent: { spellTokens: ["GATE", "CLOSE"] }
    });
    assert.equal(round.contested, true);
    assert.deepEqual(round.order, ["player", "opponent"]);
    assert.equal(round.state.gate, "open");
    assert.equal(round.state.players.player.seals + round.state.players.opponent.seals, 0);
    for (const id of ["player", "opponent"]) {
        assert.ok(codes(round.results[id]).includes("GATE_CONTESTED"), id);
        assert.ok(!codes(round.results[id]).includes("GATE_CLOSED"));
    }
    // A reaction still resolves before the contest: NULL cancels outright.
    // (a context's reaction is the one cast AGAINST that spell: here the player NULLs the opponent's.)
    const nulled = resolveRound(createInitialDuelState(), {
        player: { spellTokens: ["GATE", "CLOSE"] },
        opponent: { spellTokens: ["GATE", "CLOSE"], reaction: "null" }
    });
    assert.ok(codes(nulled.results.opponent).includes("NULL_CANCELED"));
    assert.ok(codes(nulled.results.player).includes("GATE_CONTESTED"), "the contest stands even when one side is canceled: the gate saw two hands");
});

test("resolveRound resolves in initiative order and stops when the match is decided", () => {
    const state = createInitialDuelState();
    state.players.player.seals = 2;
    const round = resolveRound(
        state,
        { player: { spellTokens: ["SEEK", "ENEMY"] }, opponent: { spellTokens: ["FIRE", "SEEK", "ENEMY"] } },
        { stopWhen: s => s.players.player.seals >= 3 || s.players.opponent.seals >= 3 }
    );
    assert.deepEqual(round.order, ["player", "opponent"]);
    assert.deepEqual(round.initiative, { first: "player", reason: "focus" });
    assert.equal(round.results.player.sealAwardedTo, "player");
    assert.equal(round.results.opponent, undefined, "the match ended before the opponent's spell");
    assert.equal(round.state.players.player.seals, 3);

    // Same spells, the opponent behind: they resolve first and land before the player's third seal.
    const s2 = createInitialDuelState();
    s2.players.player.seals = 2;
    const both = resolveRound(s2, { player: { spellTokens: ["SEEK", "ENEMY"] }, opponent: { spellTokens: ["SEEK", "ENEMY"] } }, { stopWhen: s => s.players.player.seals >= 3 });
    assert.deepEqual(both.order, ["opponent", "player"], "tied Focus: the mage behind goes first");
    assert.ok(both.results.opponent && both.results.player);
});

test("the round verdict names who resolved first and why", () => {
    const state = createInitialDuelState();
    const round = resolveRound(state, { player: { spellTokens: ["SEEK", "ENEMY"] }, opponent: { spellTokens: ["FIRE", "SEEK", "ENEMY"] } });
    const explained = explainRound(
        { result: round.results.opponent, spell: ["FIRE", "SEEK", "ENEMY"], reaction: undefined },
        { result: round.results.player, spell: ["SEEK", "ENEMY"], reaction: undefined },
        NAMES,
        round.initiative
    );
    assert.match(explained.reasons[0], /resolved first/i);
    assert.match(explained.reasons[0], /SEEK ENEMY/);
    assert.match(explained.reasons[0], /Focus/);
    assert.equal(explained.yourSeals, 1);
    assert.equal(explained.theirSeals, 1);
    const contested = resolveRound(state, { player: { spellTokens: ["GATE", "CLOSE"] }, opponent: { spellTokens: ["GATE", "CLOSE"] } });
    const text = explainRound(
        { result: contested.results.opponent, spell: ["GATE", "CLOSE"], reaction: undefined },
        { result: contested.results.player, spell: ["GATE", "CLOSE"], reaction: undefined },
        NAMES,
        contested.initiative
    );
    assert.ok(text.reasons.some(r => /shudders|contested/i.test(r)));
});
