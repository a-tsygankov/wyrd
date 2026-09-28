import assert from "node:assert/strict";
import test from "node:test";
import {
    ESSENCES, HEARTS, FOCUS, WARD_COST, SMASH_COST, MAX_SPEED, MAX_MAGNITUDE,
    beats, beaterOf, flightMs, windowMs, createVolley, tick, act, windowOpen, botActions
} from "../dist/apps/web/src/volley.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

// Volley (docs/arcade-duel-ideas.md §1 A): magic ping-pong over the gate. A
// pure state machine over timestamps, so every rule here runs without a page.

const kinds = events => events.map(e => e.kind);

/** A volley in flight from the opponent to the player, launched at t = 0. */
function inFlight() {
    const r = tick(createVolley("opponent"), 0);
    assert.equal(r.state.phase, "flight");
    return r.state;
}
const arrival = state => state.bolt.arrivesAt;

test("the wheel: water quenches fire, fire burns life, life banishes shadow, shadow drinks water; across is neutral", () => {
    assert.deepEqual(ESSENCES, ["fire", "water", "shadow", "life"]);
    assert.ok(beats("water", "fire") && beats("fire", "life") && beats("life", "shadow") && beats("shadow", "water"));
    assert.ok(!beats("fire", "water") && !beats("fire", "shadow") && !beats("water", "life") && !beats("fire", "fire"));
    assert.equal(beaterOf("fire"), "water");
    assert.equal(beaterOf("water"), "shadow");
    assert.equal(beaterOf("shadow"), "life");
    assert.equal(beaterOf("life"), "fire");
});

test("flight shortens and the return window narrows as speed rises, both with floors", () => {
    assert.ok(flightMs(1) > flightMs(3) && flightMs(3) > flightMs(MAX_SPEED));
    assert.ok(flightMs(MAX_SPEED) >= 450, "a phone can still see it");
    assert.ok(windowMs(1) > windowMs(MAX_SPEED));
    assert.ok(windowMs(MAX_SPEED) >= 220, "touch latency floor");
    assert.equal(flightMs(99), flightMs(MAX_SPEED), "capped");
});

test("the first tick serves from the server's hand at speed 1 in the server's colour, toward the other mage", () => {
    const start = createVolley("opponent");
    assert.equal(start.phase, "serve");
    assert.deepEqual(start.hearts, { player: HEARTS, opponent: HEARTS });
    assert.deepEqual(start.focus, { player: FOCUS, opponent: FOCUS });
    const { state, events } = tick(start, 1000);
    assert.equal(state.phase, "flight");
    assert.equal(state.bolt.owner, "opponent");
    assert.equal(state.bolt.to, "player");
    assert.equal(state.bolt.speed, 1);
    assert.equal(state.bolt.magnitude, 1);
    assert.equal(state.bolt.essence, start.colour.opponent);
    assert.equal(state.bolt.launchedAt, 1000);
    assert.equal(state.bolt.arrivesAt, 1000 + flightMs(1));
    assert.deepEqual(kinds(events), ["serve"]);
    assert.equal(windowOpen(state, 1000), false);
    assert.equal(windowOpen(state, state.bolt.arrivesAt - windowMs(1)), true);
});

test("a tap inside the window returns the bolt at its colour one speed step faster and refills a Focus", () => {
    let state = inFlight();
    state = { ...state, focus: { ...state.focus, player: 5 } };
    const early = act(state, "player", { kind: "tap" }, 100);
    assert.equal(early.state.input.player, undefined, "before the window a swing is nothing");
    const inWindow = act(state, "player", { kind: "tap" }, arrival(state) - 100);
    assert.deepEqual(inWindow.state.input.player, { kind: "tap" });
    const { state: next, events } = tick(inWindow.state, arrival(state));
    assert.deepEqual(kinds(events), ["return"]);
    assert.equal(next.phase, "flight");
    assert.equal(next.bolt.owner, "player");
    assert.equal(next.bolt.to, "opponent");
    assert.equal(next.bolt.speed, 2);
    assert.equal(next.bolt.essence, state.bolt.essence);
    assert.equal(next.bolt.launchedAt, arrival(state));
    assert.equal(next.bolt.arrivesAt, arrival(state) + flightMs(2));
    assert.equal(next.focus.player, 6, "a clean return refills one Focus");
    assert.equal(next.exchanges, 1);
});

test("swipes: the beating colour quenches to speed 1 and owns the volley, the same colour kindles, a losing colour is a weak half-speed return, across is a plain return", () => {
    let state = inFlight(); // opponent's colour toward the player
    const B = state.bolt.essence;
    state = { ...state, bolt: { ...state.bolt, speed: 4, magnitude: 2 } };
    const t = arrival(state) - 50;
    const quench = tick(act(state, "player", { kind: "swipe", essence: beaterOf(B) }, t).state, arrival(state));
    assert.deepEqual(kinds(quench.events), ["quench"]);
    assert.equal(quench.state.bolt.speed, 1);
    assert.equal(quench.state.bolt.magnitude, 1);
    assert.equal(quench.state.bolt.essence, beaterOf(B));
    assert.equal(quench.state.colour.player, beaterOf(B), "a swipe sets your colour");
    const kindle = tick(act(state, "player", { kind: "swipe", essence: B }, t).state, arrival(state));
    assert.deepEqual(kinds(kindle.events), ["kindle"]);
    assert.equal(kindle.state.bolt.magnitude, 3);
    assert.equal(kindle.state.bolt.speed, 5);
    const losing = ESSENCES.find(e => beats(B, e));
    const weak = tick(act(state, "player", { kind: "swipe", essence: losing }, t).state, arrival(state));
    assert.deepEqual(kinds(weak.events), ["weak"]);
    assert.equal(weak.state.bolt.speed, 2, "half of 4");
    assert.equal(weak.state.bolt.magnitude, 1);
    assert.equal(weak.state.focus.player, FOCUS, "a weak return refills nothing");
    const across = ESSENCES.find(e => e !== B && !beats(e, B) && !beats(B, e));
    const plain = tick(act(state, "player", { kind: "swipe", essence: across }, t).state, arrival(state));
    assert.deepEqual(kinds(plain.events), ["return"]);
    assert.equal(plain.state.bolt.essence, across);
    assert.equal(plain.state.bolt.speed, 5);
    assert.equal(plain.state.bolt.magnitude, 2, "a plain return keeps the magnitude");
    // Caps.
    const fast = { ...state, bolt: { ...state.bolt, speed: MAX_SPEED, magnitude: MAX_MAGNITUDE } };
    const capped = tick(act(fast, "player", { kind: "swipe", essence: B }, arrival(fast) - 10).state, arrival(fast));
    assert.equal(capped.state.bolt.speed, MAX_SPEED);
    assert.equal(capped.state.bolt.magnitude, MAX_MAGNITUDE);
});

test("a miss burns hearts equal to the magnitude, the sender serves again after a pause, and the last heart ends the match", () => {
    let state = inFlight();
    state = { ...state, bolt: { ...state.bolt, magnitude: 2 } };
    const { state: hit, events } = tick(state, arrival(state));
    assert.deepEqual(kinds(events), ["hit"]);
    assert.equal(hit.hearts.player, HEARTS - 2);
    assert.equal(hit.phase, "pause");
    assert.equal(hit.server, "opponent", "the scorer serves");
    assert.equal(hit.bolt, undefined);
    const stillPaused = tick(hit, hit.pauseUntil - 1);
    assert.equal(stillPaused.state.phase, "pause");
    const served = tick(hit, hit.pauseUntil);
    assert.equal(served.state.phase, "flight");
    assert.equal(served.state.bolt.owner, "opponent");
    assert.equal(served.state.bolt.speed, 1);
    // The last heart.
    const lastHeart = { ...state, hearts: { ...state.hearts, player: 1 } };
    const over = tick(lastHeart, arrival(lastHeart));
    assert.deepEqual(kinds(over.events), ["hit", "over"]);
    assert.equal(over.state.phase, "over");
    assert.equal(over.state.winner, "opponent");
    assert.equal(over.state.hearts.player, 0, "never below zero");
    assert.equal(tick(over.state, arrival(lastHeart) + 5000).state.phase, "over", "nothing moves after the end");
});

test("a ward costs 2 Focus, blocks a bolt whose colour does not beat the ward's, dents by magnitude, and lasts one return", () => {
    let state = inFlight();
    const B = state.bolt.essence;
    // The player's colour is the beater of the bolt: the ward stands.
    state = { ...state, colour: { ...state.colour, player: beaterOf(B) } };
    const warded = act(state, "player", { kind: "ward" }, 100);
    assert.deepEqual(kinds(warded.events), ["ward"]);
    assert.deepEqual(warded.state.wards.player, { essence: beaterOf(B), integrity: 2 });
    assert.equal(warded.state.focus.player, FOCUS - WARD_COST);
    const blocked = tick(warded.state, arrival(state));
    assert.deepEqual(kinds(blocked.events), ["block"]);
    assert.equal(blocked.state.hearts.player, HEARTS);
    assert.equal(blocked.state.phase, "pause");
    assert.equal(blocked.state.server, "player", "the blocker owns the volley");
    assert.equal(blocked.state.wards.player, undefined, "one return");
    // A magnitude-2 bolt shatters an integrity-2 ward but still does not land.
    const heavy = { ...warded.state, bolt: { ...warded.state.bolt, magnitude: 2 } };
    const shattered = tick(heavy, arrival(heavy));
    assert.deepEqual(kinds(shattered.events), ["shatter"]);
    assert.equal(shattered.state.hearts.player, HEARTS);
    // A bolt whose colour beats the ward's burns through: a hit.
    const weakWard = { ...state, colour: { ...state.colour, player: ESSENCES.find(e => beats(B, e)) } };
    const through = tick(act(weakWard, "player", { kind: "ward" }, 100).state, arrival(weakWard));
    assert.deepEqual(kinds(through.events), ["hit"]);
    // A kindled bolt of the ward's own colour passes too.
    const sameWard = { ...state, colour: { ...state.colour, player: B }, bolt: { ...state.bolt, magnitude: 2 } };
    const passes = tick(act(sameWard, "player", { kind: "ward" }, 100).state, arrival(sameWard));
    assert.deepEqual(kinds(passes.events), ["hit"]);
    // Unaffordable: nothing happens.
    const broke = { ...state, focus: { ...state.focus, player: 1 } };
    assert.equal(act(broke, "player", { kind: "ward" }, 100).state.wards.player, undefined);
    // A ward and a swing together: the swing still returns a bolt that would have passed.
    const both = act(act(weakWard, "player", { kind: "ward" }, 100).state, "player", { kind: "tap" }, arrival(weakWard) - 50);
    assert.deepEqual(kinds(tick(both.state, arrival(weakWard)).events), ["return"]);
});

test("a smash costs 3 Focus and doubles the speed of the return it is armed for", () => {
    let state = inFlight();
    state = { ...state, bolt: { ...state.bolt, speed: 2 } };
    const armed = act(state, "player", { kind: "smash" }, 100);
    assert.deepEqual(kinds(armed.events), ["smash"]);
    assert.equal(armed.state.focus.player, FOCUS - SMASH_COST);
    const returned = tick(act(armed.state, "player", { kind: "tap" }, arrival(state) - 50).state, arrival(state));
    assert.deepEqual(kinds(returned.events), ["return", "smash"]);
    assert.equal(returned.state.bolt.speed, 6, "(2 + 1) × 2");
    assert.equal(returned.state.armed.player, undefined);
    const broke = { ...state, focus: { ...state.focus, player: 2 } };
    assert.equal(act(broke, "player", { kind: "smash" }, 100).state.armed.player, undefined);
    // A smash with no swing is wasted Focus, not a return.
    const wasted = tick(armed.state, arrival(state));
    assert.deepEqual(kinds(wasted.events), ["hit"]);
});

test("only the receiver acts, and only during the flight", () => {
    const state = inFlight();
    const sender = act(state, "opponent", { kind: "tap" }, arrival(state) - 50);
    assert.equal(sender.state.input.opponent, undefined);
    assert.equal(act(state, "opponent", { kind: "ward" }, 100).state.wards.opponent, undefined);
    const paused = tick({ ...state, hearts: { ...state.hearts } }, arrival(state)).state;
    assert.equal(paused.phase, "pause");
    assert.deepEqual(act(paused, "player", { kind: "tap" }, paused.pauseUntil - 10).state, paused);
});

test("the bot decides from its personality and the seed: the Warden wards, the Aggressor smashes, everyone misses more as speed rises", () => {
    const state = inFlight();
    const count = (id, speed, key, n = 300) => {
        const s = { ...state, bolt: { ...state.bolt, to: "opponent", owner: "player", speed }, focus: { player: 7, opponent: 7 } };
        let hits = 0;
        const rng = createRng(7);
        for (let i = 0; i < n; i++) {
            const actions = botActions(s, id, rng);
            if (key === "miss" ? actions.length === 0 : actions.some(a => a.kind === key)) hits++;
        }
        return hits / n;
    };
    assert.ok(count("warden", 3, "ward") > count("aggressor", 3, "ward") + 0.2);
    assert.ok(count("aggressor", 3, "smash") > count("warden", 3, "smash") + 0.2);
    assert.ok(count("balanced", 6, "miss") > count("balanced", 1, "miss") + 0.15, "speed costs the bot too");
    assert.ok(count("balanced", 1, "miss") < 0.15, "but a slow serve is nearly always returned");
    const a = botActions({ ...state, bolt: { ...state.bolt, to: "opponent", owner: "player" } }, "trickster", createRng(3));
    const b = botActions({ ...state, bolt: { ...state.bolt, to: "opponent", owner: "player" } }, "trickster", createRng(3));
    assert.deepEqual(a, b, "seeded");
    for (const id of ["balanced", "aggressor", "warden", "trickster", "gatekeeper"]) {
        for (const action of botActions({ ...state, bolt: { ...state.bolt, to: "opponent", owner: "player" } }, id, createRng(11))) {
            assert.ok(["tap", "swipe", "ward", "smash"].includes(action.kind));
        }
    }
});
