import assert from "node:assert/strict";
import test from "node:test";
import { STEPS, ROUND_LIMIT, COMEBACK_STEPS, botAnswer, botDraw, choose, createGateTug, hold, release, tick, ward } from "../dist/apps/web/src/gatetug.js";
import { RING_MS, CHARGE_STEP_MS, FOCUS, WARD_COST, REFILL } from "../dist/apps/web/src/quickdraw.js";
import { beaterOf } from "../dist/apps/web/src/volley.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

// Gate tug (docs/arcade-duel-ideas.md §1 D): Quickdraw's draw (colour, charge,
// ward inside a three-second ring), but the clash moves the gate along a rail
// instead of costing hearts. The gate keeps a temper: the colour of the last
// push that moved it, which the next push must beat or match. Pure over
// timestamps like quickdraw.ts, whose draw rules it reuses.

const kinds = events => events.map(e => e.kind);

/** A round opened at t = 0, the gate at `gate` with an optional temper. */
function open(gate = 0, temper = undefined) {
    const { state, events } = tick({ ...createGateTug(), gate, temper }, 0);
    assert.deepEqual(kinds(events), ["open"]);
    return state;
}
/** Close the ring after the given draws: [side, essence, atMs] entries (after the first second: no quick bonus). */
function clash(state, draws) {
    for (const [side, essence, at = 1500] of draws) state = choose(state, side, essence, at).state;
    return tick(state, RING_MS);
}

test("a round opens Quickdraw's ring with the gate in the middle and no temper", () => {
    const state = open();
    assert.equal(state.qd.phase, "draw");
    assert.equal(state.gate, 0);
    assert.equal(state.temper, undefined);
    // Five, not the doc's seven: at seven a simulated match mostly ran to the round limit.
    assert.equal(STEPS, 5);
});

test("a lone orb pushes the gate its magnitude toward the other mage and gives the gate its colour", () => {
    const { state, events } = clash(open(), [["player", "fire"]]);
    assert.equal(state.gate, 1);
    assert.equal(state.temper, "fire");
    assert.ok(kinds(events).includes("move"));
    const back = clash(open(), [["opponent", "water"]]).state;
    assert.equal(back.gate, -1);
});

test("the beating colour cancels the other's push; same or neutral colours net their magnitudes", () => {
    // Water quenches fire: only the player's push counts.
    assert.equal(clash(open(), [["player", "water"], ["opponent", "fire"]]).state.gate, 1);
    // Fire and shadow are neutral: equal pushes hold the gate.
    const level = clash(open(), [["player", "fire"], ["opponent", "shadow"]]);
    assert.equal(level.state.gate, 0);
    assert.ok(kinds(level.events).includes("hold"));
    // A charged orb in the same colour wins by the difference.
    let charged = open();
    charged = choose(charged, "player", "fire", 100).state; // quick draw: +1
    charged = choose(charged, "opponent", "fire", 1500).state;
    assert.equal(tick(charged, RING_MS).state.gate, 1);
});

test("the temper: a push that neither beats nor matches the gate's colour is deflected", () => {
    // Gate tempered fire: shadow cannot move it, water (beats fire) and fire (matches) can.
    const deflected = clash(open(0, "fire"), [["player", "shadow"]]);
    assert.equal(deflected.state.gate, 0);
    assert.ok(kinds(deflected.events).includes("deflect"));
    assert.equal(deflected.state.temper, "fire");
    assert.equal(clash(open(0, "fire"), [["player", "water"]]).state.gate, 1);
    assert.equal(clash(open(0, "fire"), [["player", "fire"]]).state.gate, 1);
});

test("a ward throws nothing but blocks a push it is not beaten by", () => {
    let state = open();
    state = choose(state, "opponent", "life", 200).state; // the ward takes the opponent's colour
    state = ward(state, "opponent", 400).state;
    assert.equal(state.qd.focus.opponent, FOCUS - WARD_COST);
    const blocked = clash(state, [["player", "water"]]);
    assert.equal(blocked.state.gate, 0);
    assert.ok(kinds(blocked.events).includes("block"));
    // Fire burns life: the ward falls to the beating colour.
    let beaten = open();
    beaten = choose(beaten, "opponent", "life", 200).state;
    beaten = ward(beaten, "opponent", 400).state;
    assert.equal(clash(beaten, [["player", "fire"]]).state.gate, 1);
});

test("the comeback: within COMEBACK_STEPS of your own circle your push counts double", () => {
    const near = -(STEPS - COMEBACK_STEPS);
    const state = clash(open(near), [["player", "fire"]]).state;
    assert.equal(state.gate, near + 2);
    const far = clash(open(0), [["player", "fire"]]).state;
    assert.equal(far.gate, 1);
});

test("charge costs Focus and Focus refills after each round", () => {
    let state = open();
    state = choose(state, "player", "fire", 1100).state;
    state = hold(state, "player", 1100).state;
    state = release(state, "player", 1100 + CHARGE_STEP_MS + 10).state;
    const { state: after } = tick(state, RING_MS);
    assert.equal(after.gate, 2);
    assert.equal(after.qd.focus.player, Math.min(FOCUS, FOCUS - 1 + REFILL));
});

test("pushing the gate into the enemy's circle wins", () => {
    const { state, events } = clash(open(STEPS - 1), [["player", "fire"]]);
    assert.equal(state.gate, STEPS);
    assert.equal(state.qd.phase, "over");
    assert.equal(state.qd.winner, "player");
    assert.ok(kinds(events).includes("over"));
});

test("at the round limit the side the gate leans away from wins; dead centre goes to sudden death", () => {
    const last = { ...open(), qd: { ...open().qd, round: { ...open().qd.round, number: ROUND_LIMIT } } };
    const leaning = clash({ ...last, gate: 3 }, []);
    assert.equal(leaning.state.qd.phase, "over");
    assert.equal(leaning.state.qd.winner, "player");
    const centre = clash({ ...last, gate: 0 }, []);
    assert.equal(centre.state.suddenDeath, true);
    assert.notEqual(centre.state.qd.phase, "over");
    // In sudden death the next move decides.
    const next = tick(centre.state, centre.state.qd.pauseUntil).state;
    const decided = tick(choose(next, "opponent", "fire", next.qd.round.startedAt + 1500).state, next.qd.round.startedAt + RING_MS);
    assert.equal(decided.state.qd.phase, "over");
    assert.equal(decided.state.qd.winner, "opponent");
});

test("the bot draws a colour that can move a tempered gate", () => {
    const state = open(0, "fire");
    const rng = createRng(3);
    let movers = 0;
    let orbs = 0;
    for (let i = 0; i < 200; i++) {
        const plan = botDraw(state, "balanced", rng);
        if (plan.ward || !plan.essence) continue;
        orbs++;
        if (plan.essence === "fire" || plan.essence === beaterOf("fire")) movers++;
    }
    assert.ok(movers / orbs > 0.7, `most orbs can move the gate (${movers}/${orbs})`);
});

test("a late-drawing bot reads an orb you have already shown and answers with its beater, when that moves the gate", () => {
    let state = open();
    state = choose(state, "player", "fire", 300).state; // a quick draw: shown early
    const rng = createRng(5);
    const answers = Array.from({ length: 100 }, () => botAnswer(state, "balanced", rng, "life")).filter(e => e === beaterOf("fire")).length;
    assert.ok(answers > 40, `balanced answers a shown orb (${answers}/100)`);
    // Nothing shown yet: it keeps its planned colour.
    assert.equal(botAnswer(open(), "balanced", rng, "life"), "life");
    // An answer that cannot move the tempered gate is not taken.
    let tempered = open(0, "shadow");
    tempered = choose(tempered, "player", "fire", 300).state; // water beats fire, but neither beats nor matches shadow
    assert.equal(botAnswer(tempered, "balanced", rng, "life"), "life");
});
