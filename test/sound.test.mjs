import assert from "node:assert/strict";
import test from "node:test";
import { CUES, cueFor } from "../dist/apps/web/src/sound.js";

test("every stage beat maps to a cue or silence, and every cue is a short synth note", () => {
    const beats = ["cast", "fly", "reflect", "silence", "null", "ward-block", "ward-up", "bind", "gate-close", "gate-open", "gate-break", "gate-mend", "ward-break", "mend", "hit", "seal", "fizzle"];
    for (const kind of beats) {
        const cue = cueFor({ kind, broken: true });
        if (cue !== null) {
            assert.ok(CUES[cue], `${kind} → unknown cue ${cue}`);
            assert.ok(CUES[cue].duration <= 0.6, `${cue} is too long for a beat`);
            assert.ok(CUES[cue].notes.length >= 1);
        }
    }
    assert.equal(cueFor({ kind: "fly" }), null, "flight is silent; the impact speaks");
    assert.equal(cueFor({ kind: "ward-block", broken: true }), "shatter");
    assert.equal(cueFor({ kind: "ward-block", broken: false }), "block");
    assert.equal(cueFor({ kind: "seal" }), "seal");
});
