import assert from "node:assert/strict";
import test from "node:test";
import { revealSchedule, revealedSlots, scrySlot, hiddenCount } from "../dist/apps/web/src/reveal.js";
import { projectTelegraph, formatTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";

const SPELL = ["FIRE", "SEEK", "ENEMY", "AMPLIFY"];

test("the schedule flips every hidden slot inside the window, evenly spaced, in rng order", () => {
    const slots = projectTelegraph(SPELL, "high", createRng(1)); // FIRE SEEK ? ?
    assert.equal(hiddenCount(slots), 2);
    const schedule = revealSchedule(slots, createRng(7), 8000);
    assert.equal(schedule.length, 2);
    assert.deepEqual(schedule.map(s => s.atMs), [8000 / 3, 16000 / 3].map(Math.round));
    assert.deepEqual(schedule.map(s => s.index).sort(), [2, 3]);
    assert.deepEqual(revealSchedule(slots, createRng(7), 8000), schedule, "deterministic per seed");
    assert.deepEqual(revealSchedule(projectTelegraph(["GATE", "CLOSE"], "high", createRng(1)), createRng(1), 8000).length, 1);
});

test("revealedSlots applies only the flips whose time has come", () => {
    const slots = projectTelegraph(SPELL, "high", createRng(1));
    const schedule = revealSchedule(slots, createRng(7), 8000);
    assert.equal(formatTelegraph(revealedSlots(slots, SPELL, schedule, 0)), "FIRE → SEEK → ? → ?");
    const one = revealedSlots(slots, SPELL, schedule, schedule[0].atMs);
    assert.equal(hiddenCount(one), 1);
    assert.equal(one[schedule[0].index].kind, "glyph");
    assert.equal(one[schedule[0].index].token, SPELL[schedule[0].index]);
    assert.equal(formatTelegraph(revealedSlots(slots, SPELL, schedule, 99999)), "FIRE → SEEK → ENEMY → AMPLIFY");
    assert.equal(hiddenCount(slots), 2, "the input is not mutated");
});

test("scrySlot flips one hidden slot and reports which; nothing to flip returns null", () => {
    const slots = projectTelegraph(SPELL, "high", createRng(1));
    const result = scrySlot(slots, SPELL, createRng(3));
    assert.ok(result);
    assert.equal(hiddenCount(result.slots), 1);
    assert.equal(result.slots[result.index].kind, "glyph");
    assert.ok([2, 3].includes(result.index));
    const again = scrySlot(result.slots, SPELL, createRng(3));
    assert.equal(hiddenCount(again.slots), 0);
    assert.equal(scrySlot(again.slots, SPELL, createRng(3)), null);
});
