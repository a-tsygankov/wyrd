import assert from "node:assert/strict";
import test from "node:test";
import { QUICK_CAST_MS, REACTION_WINDOW_MS, timerState } from "../dist/apps/web/src/timers.js";

test("the reaction window and quick-cast thresholds match the design", () => {
    assert.equal(REACTION_WINDOW_MS, 8000);
    assert.equal(QUICK_CAST_MS, 5000);
});

test("timerState derives lock, quick cast and remaining time from elapsed ms", () => {
    assert.deepEqual(timerState(0), { reactionLocked: false, quickCast: true, reactionRemainingMs: 8000, quickRemainingMs: 5000 });
    assert.deepEqual(timerState(4999), { reactionLocked: false, quickCast: true, reactionRemainingMs: 3001, quickRemainingMs: 1 });
    assert.deepEqual(timerState(5000), { reactionLocked: false, quickCast: false, reactionRemainingMs: 3000, quickRemainingMs: 0 });
    assert.deepEqual(timerState(8000), { reactionLocked: true, quickCast: false, reactionRemainingMs: 0, quickRemainingMs: 0 });
    assert.deepEqual(timerState(99999), { reactionLocked: true, quickCast: false, reactionRemainingMs: 0, quickRemainingMs: 0 });
});

test("timers off means never locked and never quick", () => {
    assert.deepEqual(timerState(0, false), { reactionLocked: false, quickCast: false, reactionRemainingMs: 0, quickRemainingMs: 0 });
    assert.deepEqual(timerState(99999, false), { reactionLocked: false, quickCast: false, reactionRemainingMs: 0, quickRemainingMs: 0 });
});
