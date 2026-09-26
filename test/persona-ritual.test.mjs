import assert from "node:assert/strict";
import test from "node:test";
import { ARENA_MODELS, personaFor } from "../dist/apps/web/src/arenaMap.js";
import { PERSONALITIES } from "../dist/packages/wyrd-simulation/src/bot.js";
import { RITUAL_MS, ritualCopy, ritualSteps } from "../dist/apps/web/src/ritual.js";

// Personality props (ideas doc F, 3D doc §1) and the commit ritual (idea B):
// pure mappings and copy, tested here; the DOM and WebGL halves are e2e.

test("every personality has a persona: title, tint, character model and the props it holds", () => {
    for (const personality of PERSONALITIES) {
        const persona = personaFor(personality.id);
        assert.equal(persona.title, personality.title, personality.id);
        assert.ok(ARENA_MODELS[persona.model], `${personality.id} model ${persona.model} is prepared`);
        assert.ok(persona.show.length > 0, `${personality.id} holds something`);
        assert.match(persona.tint, /^#[0-9a-f]{6}$/i);
        assert.ok(persona.blurb.length > 20);
    }
    const tints = new Set(PERSONALITIES.map(p => personaFor(p.id).tint));
    assert.equal(tints.size, PERSONALITIES.length, "five distinct tints");
    assert.deepEqual(personaFor("warden").show, ["1H_Sword", "Round_Shield"]);
    assert.deepEqual(personaFor("trickster").show, ["Knife", "Knife_Offhand"]);
    assert.deepEqual(personaFor("gatekeeper").show, ["1H_Crossbow"]);
    assert.equal(personaFor("nobody").title, "the Adept", "unknown ids fall back to the Adept");
    assert.equal(personaFor("player").title, "You");
});

test("the commit ritual names who resolves first and why, in the players' words", () => {
    const names = { you: "you", them: "the opponent" };
    const copy = ritualCopy({ first: "player", reason: "focus" }, { player: ["SEEK", "ENEMY"], opponent: ["FIRE", "SEEK", "ENEMY"] }, names, { player: 2, opponent: 3 });
    assert.match(copy.headline, /seals crack/i);
    assert.match(copy.first, /your SEEK ENEMY/i);
    assert.match(copy.why, /cheaper/i);
    assert.match(copy.why, /2 Focus/);
    const quick = ritualCopy({ first: "opponent", reason: "quick" }, { player: ["SEEK", "ENEMY"], opponent: ["GATE", "CLOSE"] }, names, { player: 2, opponent: 2 });
    assert.match(quick.first, /the opponent's GATE CLOSE/i);
    assert.match(quick.why, /quick cast/i);
    const seals = ritualCopy({ first: "player", reason: "seals" }, { player: ["SEEK", "ENEMY"], opponent: ["SEEK", "ENEMY"] }, names, { player: 2, opponent: 2 });
    assert.match(seals.why, /behind/i);
    const hot = ritualCopy({ first: "opponent", reason: "round" }, { player: ["SEEK", "ENEMY"], opponent: ["SEEK", "ENEMY"] }, { you: "Player 1", them: "Player 2" }, { player: 2, opponent: 2 });
    assert.match(hot.first, /Player 2's SEEK ENEMY/);
    assert.match(hot.why, /even round/i);
});

test("the ritual has three beats within two seconds, and none under reduced motion", () => {
    const steps = ritualSteps(false);
    assert.deepEqual(steps.map(s => s.kind), ["seal", "crack", "reveal"]);
    const total = steps.reduce((sum, s) => sum + s.ms, 0);
    assert.ok(total <= 2000 && total >= 900, `ritual takes ${total}ms`);
    assert.equal(total, RITUAL_MS);
    assert.deepEqual(ritualSteps(true), [], "reduced motion skips the ritual");
});
