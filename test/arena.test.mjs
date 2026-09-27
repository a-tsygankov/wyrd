import assert from "node:assert/strict";
import test from "node:test";
import { ARENA_CLIPS, ARENA_MODELS, MARKS, boltArc, clipFor, isBodyPart, modelFor } from "../dist/apps/web/src/arenaMap.js";
import { PERSONALITIES } from "../dist/packages/wyrd-simulation/src/bot.js";
import { loadSettings, DEFAULT_SETTINGS } from "../dist/apps/web/src/settings.js";

// The Three.js arena (apps/web/src/arena.ts) is a second renderer of the
// stage beats. Its pure mapping - which KayKit clip plays for which beat,
// which model each personality wears, where things stand - lives in
// arenaMap.ts so it can be tested without WebGL.

test("every beat kind maps to a KayKit clip name that the prepared assets keep", () => {
    const kinds = ["cast", "fly", "reflect", "silence", "null", "ward-block", "ward-break", "ward-up", "mend", "bind", "gate-close", "gate-open", "gate-break", "gate-mend", "gate-ward-up", "gate-ward-block", "gate-ward-break", "hit", "seal", "fizzle", "split", "reverse"];
    const kept = new Set(Object.values(ARENA_CLIPS));
    for (const kind of kinds) {
        const clip = clipFor({ kind, side: "player", magnitude: 1, broken: false });
        if (clip) assert.ok(kept.has(clip.name), `${kind} → ${clip.name} is not a kept clip`);
    }
    assert.equal(clipFor({ kind: "cast", side: "player", spell: "x" }).name, ARENA_CLIPS.cast);
    assert.equal(clipFor({ kind: "hit", side: "player", magnitude: 2 }).name, ARENA_CLIPS.hit);
    assert.equal(clipFor({ kind: "ward-up", side: "player" }).name, ARENA_CLIPS.ward);
    assert.equal(clipFor({ kind: "seal", side: "player" }).name, ARENA_CLIPS.cheer);
    assert.equal(clipFor({ kind: "seal", side: "player" }).side, "player", "the scorer cheers");
    assert.equal(clipFor({ kind: "fly", from: "player", to: "opponent", magnitude: 1, action: "seek" }), undefined, "the bolt is not a body animation");
    assert.equal(ARENA_CLIPS.idle, "Idle");
    assert.ok(Object.keys(ARENA_CLIPS).length <= 14, "a dozen clips, not the pack's 77");
});

test("each personality wears a KayKit character; the player is the Mage", () => {
    for (const personality of PERSONALITIES) {
        const file = modelFor("opponent", personality.id);
        assert.ok(ARENA_MODELS[file], `${personality.id} → ${file} is not a prepared model`);
    }
    assert.equal(modelFor("player"), "mage.glb");
    assert.equal(modelFor("opponent", "warden"), "knight.glb");
    assert.equal(modelFor("opponent", "trickster"), "rogue_hooded.glb");
    assert.ok(Object.values(ARENA_MODELS).every(m => typeof m.source === "string" && typeof m.tint === "number" && m.show.length > 0));
    // The pack ships every weapon in one file: bodies always show, props only when listed.
    assert.equal(isBodyPart("Mage_Body", "Mage"), true);
    assert.equal(isBodyPart("Mage_Hat", "Mage"), true);
    assert.equal(isBodyPart("Rogue_Head_Hooded", ARENA_MODELS["rogue_hooded.glb"]), true, "the hooded rogue's meshes are named Rogue_*");
    assert.equal(isBodyPart("Rogue_Head_Hooded", "Rogue_Hooded"), false);
    assert.equal(isBodyPart("2H_Staff", "Mage"), false);
    assert.equal(isBodyPart("Barbarian_Round_Shield", "Barbarian"), false, "a shield is a prop even with the body prefix");
});

test("the bolt arcs from the caster's hand to the target and never below the floor", () => {
    const start = boltArc("player", "opponent", 0);
    const mid = boltArc("player", "opponent", 0.5);
    const end = boltArc("player", "opponent", 1);
    assert.ok(start.x < 0 && end.x > 0, "left to right");
    assert.ok(mid.y > start.y && mid.y > end.y, "an arc, not a line");
    for (const t of [0, 0.25, 0.5, 0.75, 1]) assert.ok(boltArc("opponent", "player", t).y > 0);
    assert.ok(MARKS.player.x < 0 && MARKS.opponent.x > 0 && MARKS.gate.x === 0);
});

test("the 3D arena is a setting, on by default, with ?stage=2d and ?stage=3d overrides", () => {
    const store = { getItem: () => null, setItem: () => undefined };
    assert.equal(DEFAULT_SETTINGS.arena3d, true);
    assert.equal(loadSettings(store, new URLSearchParams("")).arena3d, true);
    assert.equal(loadSettings(store, new URLSearchParams("stage=3d")).arena3d, true);
    assert.equal(loadSettings(store, new URLSearchParams("stage=2d")).arena3d, false);
    const saved = { getItem: () => JSON.stringify({ arena3d: false }), setItem: () => undefined };
    assert.equal(loadSettings(saved, new URLSearchParams("")).arena3d, false, "a saved choice is kept");
});
