import assert from "node:assert/strict";
import test from "node:test";
import {
    ATTACK_MS,
    HEARTS,
    LEAD_MS,
    PAUSE_MS,
    REACT_MS,
    VOLLEYS,
    WINDOW_MS,
    act,
    beatMs,
    botPlanner,
    createWardRhythm,
    flightMs,
    tick
} from "../dist/apps/web/src/wardrhythm.js";
import { beaterOf } from "../dist/apps/web/src/volley.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

// Ward rhythm (docs/arcade-duel-ideas.md §1 E): the opponent's volley lands on
// a beat and you tap the colour that beats each bolt as it lands; the same
// colour absorbs it into your next throw. Then you throw at their ward. Pure
// over timestamps; the bot's volleys and wards come from an injected planner.

const kinds = events => events.map(e => e.kind);

/** A planner that always throws `colours` and guards with `ward` (reacting to an early throw if `react`). */
const planner = (colours = ["fire", "water", "life"], ward = "shadow", react = false) => ({
    volley: () => colours,
    guard: () => ({ essence: ward, react })
});

/** A match opened at t = 0 with the first volley in the air. */
function open(p = planner()) {
    const { state, events } = tick(createWardRhythm(), 0, p);
    assert.deepEqual(kinds(events), ["open", "volley"]);
    assert.equal(state.phase, "defend");
    return state;
}
const lands = (state, i) => state.volley.bolts[i].landsAt;
const ward = (state, essence, at) => act(state, "player", { kind: "ward", essence }, at);

test("the first volley flies in on the beat: after a lead-in and a full flight, each bolt a beat after the last", () => {
    const state = open();
    assert.equal(state.volley.bolts.length, 3);
    assert.ok(LEAD_MS >= 1000, "time to find the pads after Start");
    assert.equal(lands(state, 0), LEAD_MS + flightMs(1));
    assert.equal(lands(state, 1) - lands(state, 0), beatMs(1));
    assert.ok(beatMs(VOLLEYS) < beatMs(1), "later volleys are faster");
    assert.ok(WINDOW_MS * 2 >= 200, "wide enough for touch latency");
});

test("the beating colour in the window blocks; the same colour absorbs a charge; a wrong colour costs a heart", () => {
    let state = open(planner(["fire", "water", "life"]));
    let r = ward(state, "water", lands(state, 0) + 40); // water quenches fire
    assert.deepEqual(kinds(r.events), ["block"]);
    r = ward(r.state, "water", lands(state, 1) - 60); // water on water: absorbed
    assert.deepEqual(kinds(r.events), ["absorb"]);
    assert.equal(r.state.absorbed, 1);
    r = ward(r.state, "water", lands(state, 2)); // water on life: neutral, a hit
    assert.deepEqual(kinds(r.events), ["hit"]);
    assert.equal(r.state.hearts.player, HEARTS - 1);
});

test("the first tap in a window is the answer: mashing a second colour does nothing", () => {
    const state = open(planner(["fire"]));
    let r = ward(state, "shadow", lands(state, 0)); // wrong
    r = ward(r.state, "water", lands(state, 0) + 10); // too late: already answered
    assert.deepEqual(r.events, []);
    assert.equal(r.state.hearts.player, HEARTS - 1);
});

test("taps outside every window are ignored; a bolt nobody answers hits when its window closes", () => {
    const state = open(planner(["fire"]));
    assert.deepEqual(ward(state, "water", lands(state, 0) - WINDOW_MS - 50).events, []);
    const { state: after, events } = tick(state, lands(state, 0) + WINDOW_MS + 1, planner());
    assert.ok(kinds(events).includes("hit"));
    assert.equal(after.hearts.player, HEARTS - 1);
});

test("after the volley a pause, then your throw: the bot shows its ward", () => {
    let state = open(planner(["fire"], "life"));
    state = ward(state, "water", lands(state, 0)).state;
    const done = tick(state, lands(state, 0) + WINDOW_MS + 1, planner()).state;
    assert.equal(done.phase, "pause");
    const r = tick(done, done.pauseUntil, planner(["fire"], "life"));
    assert.equal(r.state.phase, "attack");
    assert.equal(r.state.attack.ward, "life");
    assert.equal(r.state.attack.endsAt, done.pauseUntil + ATTACK_MS);
    assert.ok(PAUSE_MS > 0);
});

/** Run to the first attack with `absorbed` charges banked and the bot guarding `wardColour`. */
function toAttack(absorbed = 0, wardColour = "life", react = false) {
    const colours = ["fire", "fire", "fire"];
    const p = planner(colours, wardColour, react);
    let state = open(p);
    for (let i = 0; i < 3; i++) state = ward(state, i < absorbed ? "fire" : "water", lands(state, i)).state;
    state = tick(state, lands(state, 2) + WINDOW_MS + 1, p).state;
    return { state: tick(state, state.pauseUntil, p).state, p };
}

test("a throw in the colour that beats their ward hits for one plus your absorbed charge", () => {
    const { state, p } = toAttack(2, "life");
    // Fire burns life; two absorbed: magnitude 3.
    const thrown = act(state, "player", { kind: "throw", essence: "fire" }, state.attack.endsAt - 200).state;
    const { state: after, events } = tick(thrown, state.attack.endsAt, p);
    assert.ok(kinds(events).includes("strike"));
    assert.equal(after.hearts.opponent, HEARTS - 3);
    assert.equal(after.absorbed, 0, "the charge is spent");
});

test("a neutral colour glances for one; the ward's own colour or one it beats is blocked", () => {
    const run = (essence, wardColour) => {
        const { state, p } = toAttack(2, wardColour);
        const thrown = act(state, "player", { kind: "throw", essence }, state.attack.endsAt - 200).state;
        return tick(thrown, state.attack.endsAt, p);
    };
    assert.equal(run("water", "life").state.hearts.opponent, HEARTS - 1); // water / life: neutral
    const same = run("life", "life");
    assert.equal(same.state.hearts.opponent, HEARTS);
    assert.ok(kinds(same.events).includes("guarded"));
    assert.equal(run("shadow", "life").state.hearts.opponent, HEARTS); // life banishes shadow
});

test("a reading bot switches its ward against an early throw, but not a late one", () => {
    const early = toAttack(0, "life", true);
    let s = act(early.state, "player", { kind: "throw", essence: "fire" }, early.state.attack.startedAt + 300).state;
    let r = tick(s, early.state.attack.endsAt, early.p);
    assert.ok(kinds(r.events).includes("feint"));
    assert.equal(r.state.hearts.opponent, HEARTS, "the switched ward beats the throw");
    const late = toAttack(0, "life", true);
    s = act(late.state, "player", { kind: "throw", essence: "fire" }, late.state.attack.endsAt - REACT_MS + 50).state;
    r = tick(s, late.state.attack.endsAt, late.p);
    assert.equal(r.state.hearts.opponent, HEARTS - 1);
});

test("no throw by the end: your last colour is thrown for you", () => {
    const { state, p } = toAttack(0, "life");
    const r = tick(state, state.attack.endsAt, p);
    assert.ok(kinds(r.events).some(k => k === "strike" || k === "guarded" || k === "glance"));
});

test("hearts at zero end it; after the last throw the most hearts win, level is a draw", () => {
    const state = open(planner(["fire"]));
    const dying = { ...state, hearts: { player: 1, opponent: HEARTS } };
    const r = tick(dying, lands(state, 0) + WINDOW_MS + 1, planner());
    assert.equal(r.state.phase, "over");
    assert.equal(r.state.winner, "opponent");
    // The last exchange: after the fifth throw the hearts decide.
    const { state: last, p } = toAttack(0, "life");
    const final = { ...last, exchange: VOLLEYS, hearts: { player: 3, opponent: 3 } };
    const glance = tick(act(final, "player", { kind: "throw", essence: "water" }, final.attack.endsAt - 100).state, final.attack.endsAt, p);
    assert.equal(glance.state.phase, "over");
    assert.equal(glance.state.winner, "player");
    const blocked = tick(act(final, "player", { kind: "throw", essence: "life" }, final.attack.endsAt - 100).state, final.attack.endsAt, p);
    assert.equal(blocked.state.phase, "over");
    assert.equal(blocked.state.winner, undefined, "level: a draw");
});

test("the bot's volleys grow with the match and its wards follow its personality", () => {
    const rng = createRng(11);
    const aggressor = botPlanner("aggressor", rng);
    const warden = botPlanner("warden", rng);
    const first = createWardRhythm();
    assert.ok(aggressor.volley({ ...first, exchange: 1 }).length >= 3);
    assert.ok(aggressor.volley({ ...first, exchange: VOLLEYS }).length >= warden.volley({ ...first, exchange: 1 }).length);
    for (const len of Array.from({ length: 30 }, () => warden.volley({ ...first, exchange: 3 }).length)) assert.ok(len >= 3 && len <= 6);
    // The trickster reads early throws more often than the warden.
    const reads = id => Array.from({ length: 200 }, () => botPlanner(id, rng).guard(first).react).filter(Boolean).length;
    assert.ok(reads("trickster") > reads("aggressor"));
    // A guard is always a colour.
    assert.ok(["fire", "water", "shadow", "life"].includes(warden.guard(first).essence));
    assert.equal(beaterOf("life"), "fire");
});

test("after a throw the next volley opens, a beat quicker", () => {
    const { state, p } = toAttack(0, "life");
    const thrown = tick(act(state, "player", { kind: "throw", essence: "water" }, state.attack.endsAt - 100).state, state.attack.endsAt, p).state;
    assert.equal(thrown.phase, "pause");
    assert.equal(thrown.exchange, 2);
    const next = tick(thrown, thrown.pauseUntil, p);
    assert.equal(next.state.phase, "defend");
    assert.ok(kinds(next.events).includes("volley"));
    assert.equal(next.state.volley.beat, beatMs(2));
    assert.ok(beatMs(2) < beatMs(1));
});

test("a blocking bot turns even a late throw aside; how often is its personality", () => {
    const blocker = { volley: () => ["fire", "fire", "fire"], guard: () => ({ essence: "life", react: false, block: true }) };
    let state = open(blocker);
    for (let i = 0; i < 3; i++) state = ward(state, "water", lands(state, i)).state;
    state = tick(state, lands(state, 2) + WINDOW_MS + 1, blocker).state;
    state = tick(state, state.pauseUntil, blocker).state;
    const late = act(state, "player", { kind: "throw", essence: "fire" }, state.attack.endsAt - 100).state;
    const r = tick(late, state.attack.endsAt, blocker);
    assert.ok(kinds(r.events).includes("feint"));
    assert.equal(r.state.hearts.opponent, HEARTS);
    const rng = createRng(4);
    const blocks = id => Array.from({ length: 300 }, () => botPlanner(id, rng).guard(createWardRhythm()).block).filter(Boolean).length;
    assert.ok(blocks("warden") > blocks("balanced") && blocks("balanced") > blocks("aggressor"), "the Warden blocks most, the Aggressor least");
});
