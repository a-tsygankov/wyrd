import assert from "node:assert/strict";
import test from "node:test";
import { RING_MS, QUICK_MS, CHARGE_STEP_MS, HEARTS, FOCUS, WARD_COST, REFILL, createQuickdraw, tick, choose, hold, release, ward, chargeOf, botDraw } from "../dist/apps/web/src/quickdraw.js";
import { beaterOf, beats, ESSENCES } from "../dist/apps/web/src/volley.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

// Quickdraw (docs/arcade-duel-ideas.md §1 C): both mages draw once inside a
// three-second ring; the wheel and the charge decide the clash. The orb is the
// telegraph. Pure over timestamps like volley.ts.

const kinds = events => events.map(e => e.kind);

/** A round opened at t = 0 with the player's colour set to `mine` and the bot's to `theirs`. */
function open(mine = "fire", theirs = "life") {
    const start = createQuickdraw({ player: mine, opponent: theirs });
    const { state } = tick(start, 0);
    assert.equal(state.phase, "draw");
    return state;
}

test("a round opens a three-second ring; a colour chosen inside the first second is a quick draw", () => {
    const state = open();
    assert.equal(state.round.startedAt, 0);
    assert.equal(RING_MS, 3000);
    assert.equal(QUICK_MS, 1000);
    const quick = choose(state, "player", "water", 400).state;
    assert.equal(quick.round.draws.player.essence, "water");
    assert.equal(quick.round.draws.player.quick, true);
    const slow = choose(state, "player", "water", 1400).state;
    assert.equal(slow.round.draws.player.quick, false);
    const changed = choose(quick, "player", "shadow", 2000).state;
    assert.equal(changed.round.draws.player.essence, "shadow");
    assert.equal(changed.round.draws.player.quick, false, "changing your mind after the first second loses the quick bonus");
    assert.equal(changed.colour.player, "shadow", "the last colour becomes yours");
});

test("holding charges the orb one step per second up to 3, paying a Focus per step above 1; releasing keeps the charge", () => {
    let state = open();
    state = choose(state, "player", "fire", 200).state;
    state = hold(state, "player", 500).state;
    assert.equal(chargeOf(state, "player", 500), 1);
    assert.equal(chargeOf(state, "player", 500 + CHARGE_STEP_MS), 2);
    assert.equal(chargeOf(state, "player", 500 + 2 * CHARGE_STEP_MS), 3);
    assert.equal(chargeOf(state, "player", 500 + 9 * CHARGE_STEP_MS), 3, "capped");
    const released = release(state, "player", 500 + CHARGE_STEP_MS + 100).state;
    assert.equal(released.round.draws.player.charge, 2);
    assert.equal(chargeOf(released, "player", 2900), 2, "a released charge stays");
    // Focus is charged when the orb flies, not while holding.
    assert.equal(released.focus.player, FOCUS);
    const broke = { ...state, focus: { ...state.focus, player: 0 } };
    assert.equal(chargeOf(broke, "player", 500 + 2 * CHARGE_STEP_MS), 1, "no Focus, no charge");
});

test("a ward costs 2 Focus and replaces the draw", () => {
    let state = open();
    const warded = ward(state, "player", 300);
    assert.deepEqual(kinds(warded.events), ["ward"]);
    assert.equal(warded.state.round.draws.player.ward, true);
    assert.equal(warded.state.round.draws.player.essence, undefined);
    const broke = { ...state, focus: { ...state.focus, player: 1 } };
    assert.equal(ward(broke, "player", 300).state.round.draws.player?.ward, undefined);
});

test("at the ring's close the wheel decides: the beating colour lands alone, same colour goes to the bigger charge, across both land", () => {
    // Player water (beats fire) vs bot fire.
    let state = open("water", "fire");
    state = choose(state, "player", "water", 200).state;
    state = choose(state, "opponent", "fire", 200).state;
    const clash = tick(state, RING_MS);
    assert.deepEqual(kinds(clash.events), ["fly", "fly", "hit"]);
    assert.equal(clash.state.hearts.opponent, HEARTS - 2, "a quick draw lands at magnitude 2");
    assert.equal(clash.state.hearts.player, HEARTS);
    assert.equal(clash.state.phase, "pause");
    // Same colour: the bigger charge wins; equal charges cancel.
    let same = open("fire", "fire");
    same = choose(same, "player", "fire", 1500).state;
    same = choose(same, "opponent", "fire", 1500).state;
    same = hold(same, "player", 1500).state;
    same = release(same, "player", 1500 + CHARGE_STEP_MS).state; // charge 2
    const bigger = tick(same, RING_MS);
    assert.deepEqual(kinds(bigger.events), ["fly", "fly", "hit"]);
    assert.equal(bigger.state.hearts.opponent, HEARTS - 2);
    assert.equal(bigger.state.focus.player, FOCUS - 1 + REFILL > FOCUS ? FOCUS : FOCUS - 1 + REFILL, "one Focus for the second step, then the round's refill");
    let equal = open("fire", "fire");
    equal = choose(equal, "player", "fire", 1500).state;
    equal = choose(equal, "opponent", "fire", 1500).state;
    const cancel = tick(equal, RING_MS);
    assert.deepEqual(kinds(cancel.events), ["fly", "fly", "cancel"]);
    assert.equal(cancel.state.hearts.player, HEARTS);
    assert.equal(cancel.state.hearts.opponent, HEARTS);
    // Across the wheel: both land.
    let across = open("fire", "shadow");
    across = choose(across, "player", "fire", 1500).state;
    across = choose(across, "opponent", "shadow", 1500).state;
    const both = tick(across, RING_MS);
    assert.deepEqual(kinds(both.events), ["fly", "fly", "hit", "hit"]);
    assert.equal(both.state.hearts.player, HEARTS - 1);
    assert.equal(both.state.hearts.opponent, HEARTS - 1);
});

test("a ward blocks an orb whose colour does not beat the ward's, is dented by its magnitude, and lets its own colour through; no draw at all is a free hit", () => {
    // Player wards in shadow; bot draws fire (fire does not beat shadow): blocked.
    let state = open("shadow", "fire");
    state = ward(state, "player", 300).state;
    state = choose(state, "opponent", "fire", 1500).state;
    const blocked = tick(state, RING_MS);
    assert.deepEqual(kinds(blocked.events), ["fly", "block"]);
    assert.equal(blocked.state.hearts.player, HEARTS);
    // Bot draws life; life beats shadow: burns through.
    let through = open("shadow", "life");
    through = ward(through, "player", 300).state;
    through = choose(through, "opponent", "life", 1500).state;
    const burnt = tick(through, RING_MS);
    assert.deepEqual(kinds(burnt.events), ["fly", "hit"]);
    assert.equal(burnt.state.hearts.player, HEARTS - 1);
    // Bot draws shadow into a shadow ward: passes.
    let same = open("shadow", "shadow");
    same = ward(same, "player", 300).state;
    same = choose(same, "opponent", "shadow", 1500).state;
    assert.deepEqual(kinds(tick(same, RING_MS).events), ["fly", "hit"]);
    // A magnitude-3 orb shatters the integrity-2 ward and still does not land.
    let heavy = open("shadow", "fire");
    heavy = ward(heavy, "player", 300).state;
    heavy = choose(heavy, "opponent", "fire", 200).state; // quick: 2
    heavy = hold(heavy, "opponent", 200).state;
    heavy = release(heavy, "opponent", 200 + CHARGE_STEP_MS).state; // +1 → 3
    const shattered = tick(heavy, RING_MS);
    assert.deepEqual(kinds(shattered.events), ["fly", "shatter"]);
    assert.equal(shattered.state.hearts.player, HEARTS);
    // Nothing drawn: the other orb lands for free.
    let idle = open("fire", "life");
    idle = choose(idle, "opponent", "life", 1500).state;
    const free = tick(idle, RING_MS);
    assert.deepEqual(kinds(free.events), ["fly", "hit"]);
    assert.equal(free.state.hearts.player, HEARTS - 1);
});

test("rounds pause, refill Focus and reopen; the last heart ends the match", () => {
    let state = open("water", "fire");
    state = { ...state, focus: { ...state.focus, player: 3 } };
    state = choose(state, "player", "water", 200).state;
    state = choose(state, "opponent", "fire", 200).state;
    const clash = tick(state, RING_MS);
    assert.equal(clash.state.phase, "pause");
    assert.equal(clash.state.focus.player, 3 + REFILL);
    const reopened = tick(clash.state, clash.state.pauseUntil);
    assert.equal(reopened.state.phase, "draw");
    assert.equal(reopened.state.round.startedAt, clash.state.pauseUntil);
    assert.equal(reopened.state.round.number, 2);
    let last = open("water", "fire");
    last = { ...last, hearts: { ...last.hearts, opponent: 1 } };
    last = choose(last, "player", "water", 200).state;
    const over = tick(last, RING_MS);
    assert.deepEqual(kinds(over.events), ["fly", "hit", "over"]);
    assert.equal(over.state.phase, "over");
    assert.equal(over.state.winner, "player");
    assert.equal(over.state.hearts.opponent, 0);
});

test("the bot draws from its personality: it beats your last colour more than chance, the Aggressor charges, the Warden wards, and it is seeded", () => {
    const state = open("fire", "life");
    const rng = createRng(5);
    let beatsMine = 0;
    let charges = 0;
    let wards = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
        const d = botDraw(state, "balanced", rng);
        if (d.essence === beaterOf("fire")) beatsMine++;
        if ((d.charge ?? 1) > 1) charges++;
        if (d.ward) wards++;
    }
    assert.ok(beatsMine / N > 0.4, `the Adept answers your colour ${beatsMine}/${N}`);
    const count = (id, key) => {
        let n = 0;
        const r = createRng(9);
        for (let i = 0; i < N; i++) {
            const d = botDraw(state, id, r);
            if (key === "charge" ? (d.charge ?? 1) > 1 : d.ward === true) n++;
        }
        return n / N;
    };
    assert.ok(count("aggressor", "charge") > count("warden", "charge") + 0.2);
    assert.ok(count("warden", "ward") > count("aggressor", "ward") + 0.2);
    assert.deepEqual(botDraw(state, "trickster", createRng(2)), botDraw(state, "trickster", createRng(2)));
    for (const id of ["balanced", "aggressor", "warden", "trickster", "gatekeeper"]) {
        const d = botDraw(state, id, createRng(1));
        assert.ok(d.ward === true || ESSENCES.includes(d.essence), id);
    }
    assert.ok(WARD_COST === 2 && HEARTS === 5 && beats("water", "fire"));
});
