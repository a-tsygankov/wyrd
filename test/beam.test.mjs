import assert from "node:assert/strict";
import test from "node:test";
import {
    BEAT_MS,
    BEAT_WINDOW_MS,
    LEAD_MS,
    STEPS,
    PERFECT_MS,
    FOCUS,
    WARD_COST,
    SWITCH_COST,
    SWITCH_MS,
    MATCH_MS,
    PAUSE_MS,
    SEALS_TO_WIN,
    act,
    botBeat,
    createBeam,
    tick
} from "../dist/apps/web/src/beam.js";
import { beaterOf } from "../dist/apps/web/src/volley.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

// Beam clash (docs/arcade-duel-ideas.md §1 B): both beams meet in a knot over
// the gate; taps on the beat push it, the wheel doubles a push, a ward at the
// end absorbs it, a knot pushed into a mage scores a seal. Pure over
// timestamps like volley.ts and quickdraw.ts.

const kinds = events => events.map(e => e.kind);

/** A clash opened at t = 0 with the given colours. */
function open(mine = "fire", theirs = "shadow") {
    const { state, events } = tick(createBeam({ player: mine, opponent: theirs }), 0);
    assert.deepEqual(kinds(events), ["open"]);
    return state;
}
const beatAt = (state, b) => state.startedAt + b * BEAT_MS;
/** Let beat `b` resolve (its window closes). */
const close = (state, b) => tick(state, beatAt(state, b) + BEAT_WINDOW_MS + 1);
const tap = (state, side, at) => act(state, side, { kind: "tap" }, at).state;

test("a clash opens with a count-in: the first beat lands LEAD_MS after the open, the knot in the middle", () => {
    const state = open();
    assert.equal(state.phase, "clash");
    assert.equal(state.startedAt, LEAD_MS);
    assert.equal(state.knot, 0);
    assert.deepEqual(state.seals, { player: 0, opponent: 0 });
    assert.deepEqual(state.focus, { player: FOCUS, opponent: FOCUS });
    assert.equal(BEAT_MS, 600, "100 bpm");
    assert.ok(BEAT_WINDOW_MS * 2 >= 150, "the on-beat window is wide enough for touch latency");
});

test("an on-beat tap pushes the knot a step toward the other mage when the beat resolves", () => {
    let state = open();
    state = tap(state, "player", beatAt(state, 0) + 60);
    const { state: after, events } = close(state, 0);
    assert.equal(after.knot, 1);
    assert.ok(kinds(events).includes("push"));
    // The opponent pushes back the other way.
    const back = close(tap(after, "opponent", beatAt(after, 1) - 80), 1).state;
    assert.equal(back.knot, 0);
});

test("two taps in one window count once; an off-beat tap pushes nothing and costs a Focus", () => {
    let state = open();
    state = tap(state, "player", beatAt(state, 0) - 90);
    state = tap(state, "player", beatAt(state, 0) + 20);
    assert.equal(close(state, 0).state.knot, 1);
    const off = act(open(), "player", { kind: "tap" }, LEAD_MS + BEAT_MS / 2);
    assert.deepEqual(kinds(off.events), ["offbeat"]);
    assert.equal(off.state.focus.player, FOCUS - 1);
    assert.equal(close(off.state, 0).state.knot, 0);
});

test("a perfect tap (inside PERFECT_MS of the beat) pushes two; a looser on-beat tap pushes one", () => {
    assert.ok(PERFECT_MS >= 40 && PERFECT_MS < BEAT_WINDOW_MS);
    const perfect = close(tap(open(), "player", LEAD_MS + 30), 0).state;
    assert.equal(perfect.knot, 2);
    const good = close(tap(open(), "player", LEAD_MS - 90), 0).state;
    assert.equal(good.knot, 1);
    // Perfect against good: the perfect side wins the beat by one.
    let both = open();
    both = tap(tap(both, "player", LEAD_MS), "opponent", LEAD_MS + 90);
    assert.equal(close(both, 0).state.knot, 1);
});

test("taps during the count-in are ignored, free and pushless", () => {
    const state = open();
    const r = act(state, "player", { kind: "tap" }, 200);
    assert.deepEqual(r.events, []);
    assert.equal(r.state.focus.player, FOCUS);
});

test("equal pushes in neutral colours hold the knot; the beating colour pushes double", () => {
    let state = open("fire", "shadow");
    state = tap(tap(state, "player", beatAt(state, 0)), "opponent", beatAt(state, 0));
    assert.equal(close(state, 0).state.knot, 0);
    // Water quenches fire: the player's water beam pushes 2 against fire's 1.
    let wheel = open("water", "fire");
    wheel = tap(tap(wheel, "player", beatAt(wheel, 0) + 70), "opponent", beatAt(wheel, 0) + 70);
    assert.equal(close(wheel, 0).state.knot, 1);
});

test("a switch recolours the beam after SWITCH_MS; the first is free, the next cost Focus, none without it", () => {
    let state = open("fire", "shadow");
    const first = act(state, "player", { kind: "switch", essence: "water" }, LEAD_MS);
    assert.deepEqual(kinds(first.events), ["switch"]);
    assert.equal(first.state.focus.player, FOCUS);
    assert.equal(first.state.colour.player, "fire", "not yet: the switch is visible before it lands");
    state = tick(first.state, LEAD_MS + SWITCH_MS).state;
    assert.equal(state.colour.player, "water");
    const second = act(state, "player", { kind: "switch", essence: "life" }, LEAD_MS + SWITCH_MS + 10);
    assert.equal(second.state.focus.player, FOCUS - SWITCH_COST);
    // Switching to the colour you already hold does nothing.
    assert.deepEqual(act(state, "player", { kind: "switch", essence: "water" }, LEAD_MS + 400).events, []);
    // Out of Focus: refused.
    const broke = { ...state, focus: { ...state.focus, player: 1 } };
    assert.deepEqual(act(broke, "player", { kind: "switch", essence: "life" }, LEAD_MS + 400).events, []);
});

/** Push the knot `n` beats in a row from the player's side, starting at beat `from`. */
function pushRun(state, n, from = 0) {
    const events = [];
    for (let b = from; b < from + n; b++) {
        // A good tap, not a perfect one: one step a beat.
        const r = close(tap(state, "player", beatAt(state, b) + 70), b);
        state = r.state;
        events.push(...r.events);
    }
    return { state, events };
}

test("a ward at the end absorbs the knot for its integrity, then shatters; the next push scores a seal", () => {
    let state = open();
    const warded = act(state, "opponent", { kind: "ward" }, LEAD_MS);
    assert.deepEqual(kinds(warded.events), ["ward"]);
    assert.equal(warded.state.focus.opponent, FOCUS - WARD_COST);
    assert.deepEqual(act(warded.state, "opponent", { kind: "ward" }, LEAD_MS + 5).events, [], "one ward per clash");
    state = pushRun(warded.state, STEPS).state;
    assert.equal(state.knot, STEPS);
    let r = pushRun(state, 1, STEPS);
    assert.deepEqual(kinds(r.events).filter(k => k !== "push"), ["block"]);
    r = pushRun(r.state, 1, STEPS + 1);
    assert.deepEqual(kinds(r.events).filter(k => k !== "push"), ["shatter"]);
    r = pushRun(r.state, 1, STEPS + 2);
    assert.ok(kinds(r.events).includes("seal"));
    assert.equal(r.state.seals.player, 1);
});

test("a seal pauses, gives the scored-on mage a Focus back and restarts the knot a step toward them", () => {
    let state = open();
    state = { ...state, focus: { player: FOCUS, opponent: 3 } };
    const r = pushRun(state, STEPS + 1);
    const sealed = r.state;
    assert.equal(sealed.phase, "pause");
    assert.equal(sealed.seals.player, 1);
    assert.equal(sealed.focus.opponent, 4);
    const resumed = tick(sealed, sealed.pauseUntil).state;
    assert.equal(resumed.phase, "clash");
    assert.equal(resumed.knot, 1, "the Nidhogg momentum: the loser starts a step back");
    assert.equal(resumed.startedAt, sealed.pauseUntil + BEAT_MS, "a one-beat count-in");
    assert.equal(resumed.wardUsed.opponent, false);
    assert.ok(PAUSE_MS > 0);
});

test("three seals win the clash", () => {
    let state = open();
    state = { ...state, seals: { player: SEALS_TO_WIN - 1, opponent: 0 } };
    const r = pushRun(state, STEPS + 1);
    assert.equal(r.state.phase, "over");
    assert.equal(r.state.winner, "player");
    assert.ok(kinds(r.events).includes("over"));
});

test("at time the leader wins; level at time goes to sudden death, and the next seal decides", () => {
    const state = open();
    const ahead = tick({ ...state, seals: { player: 0, opponent: 1 } }, MATCH_MS);
    assert.equal(ahead.state.phase, "over");
    assert.equal(ahead.state.winner, "opponent");
    const level = tick(state, MATCH_MS);
    assert.equal(level.state.phase, "clash");
    assert.equal(level.state.suddenDeath, true);
    assert.ok(kinds(level.events).includes("sudden"));
    const decided = pushRun(level.state, STEPS + 1, level.state.beat);
    assert.equal(decided.state.phase, "over");
    assert.equal(decided.state.winner, "player");
});

test("the bot answers a losing wheel by switching to the beater, taps by its accuracy, wards near its end", () => {
    // The player's water beats the bot's fire: an answering bot switches to water's beater.
    const state = open("water", "fire");
    let switched = 0;
    let taps = 0;
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
        const plan = botBeat(state, "balanced", rng);
        if (plan.switchTo) {
            switched++;
            assert.equal(plan.switchTo, beaterOf("water"));
        }
        if (plan.tap) taps++;
    }
    assert.ok(switched > 40, `balanced bot answers the wheel (${switched}/200)`);
    assert.ok(taps > 130 && taps < 190, `balanced bot lands most beats (${taps}/200)`);
    const perfects = Array.from({ length: 200 }, () => botBeat(state, "balanced", rng)).filter(p => p.tap === "perfect").length;
    assert.ok(perfects > 40 && perfects < 130, `some of its taps are perfect (${perfects}/200)`);
    // The Warden wards when the knot is a step from its end.
    const cornered = { ...open(), knot: STEPS - 1 };
    const wards = Array.from({ length: 50 }, () => botBeat(cornered, "warden", rng)).filter(p => p.ward).length;
    assert.ok(wards > 30, `warden wards when cornered (${wards}/50)`);
    // No ward without Focus or once used.
    assert.ok(!botBeat({ ...cornered, wardUsed: { player: false, opponent: true } }, "warden", rng).ward);
});
