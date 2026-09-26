import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgeHandoff, commitP1, lockP2Spell, presentation, resolveP2, startRound } from "../dist/apps/web/src/hotseat.js";

test("a hot-seat round walks P2 compose → P1 turn → P2 react → resolved", () => {
    let round = startRound();
    assert.equal(round.phase, "p2-compose");
    round = lockP2Spell(round, ["FIRE", "SEEK", "ENEMY"]);
    assert.equal(round.phase, "handoff-to-p1");
    assert.deepEqual(round.p2Spell, ["FIRE", "SEEK", "ENEMY"]);
    round = acknowledgeHandoff(round);
    assert.equal(round.phase, "p1-turn");
    round = commitP1(round, ["GATE", "CLOSE"], "reflect");
    assert.equal(round.phase, "handoff-to-p2");
    assert.deepEqual(round.p1Spell, ["GATE", "CLOSE"]);
    assert.equal(round.p1Reaction, "reflect");
    round = acknowledgeHandoff(round);
    assert.equal(round.phase, "p2-react");
    round = resolveP2(round, undefined);
    assert.equal(round.phase, "resolved");
    assert.equal(round.p2Reaction, undefined);
});

test("transitions out of order are rejected so the UI cannot skip a hand-off", () => {
    const round = startRound();
    assert.throws(() => commitP1(round, ["GATE", "CLOSE"]), /p1-turn/);
    assert.throws(() => resolveP2(round, "null"), /p2-react/);
    assert.throws(() => acknowledgeHandoff(round), /handoff/);
    const locked = lockP2Spell(round, ["ENEMY", "BIND"]);
    assert.throws(() => lockP2Spell(locked, ["ENEMY", "BIND"]), /p2-compose/);
});

test("presentation tells the shell what each phase shows", () => {
    const compose = presentation("p2-compose");
    assert.equal(compose.showComposer, true);
    assert.equal(compose.showReaction, false);
    assert.equal(compose.telegraphOf, null);
    assert.match(compose.castLabel, /lock/i);
    assert.match(compose.status, /Player 2/);
    assert.equal(compose.overlay, undefined);

    const toP1 = presentation("handoff-to-p1");
    assert.match(toP1.overlay, /Player 1/);
    const p1 = presentation("p1-turn");
    assert.equal(p1.telegraphOf, "p2");
    assert.equal(p1.showComposer, true);
    assert.equal(p1.showReaction, true);
    assert.match(p1.castLabel, /commit/i);

    const toP2 = presentation("handoff-to-p2");
    assert.match(toP2.overlay, /Player 2/);
    const react = presentation("p2-react");
    assert.equal(react.telegraphOf, "p1");
    assert.equal(react.showComposer, false);
    assert.equal(react.showReaction, true);
    assert.match(react.castLabel, /resolve/i);

    const done = presentation("resolved");
    assert.equal(done.showComposer, false);
    assert.equal(done.showReaction, false);
});
