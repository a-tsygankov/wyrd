import assert from "node:assert/strict";
import test from "node:test";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { chooseBotSpell, chooseBotReaction, scoreReactions } from "../dist/packages/wyrd-simulation/src/bot.js";
import { projectTelegraph, formatTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { parseSpell } from "../dist/packages/wyrd-grammar/src/parser.js";
import { createInitialDuelState, resolveEncounter } from "../dist/packages/wyrd-resolver/src/index.js";

// The same tray the web client exposes (POC glyph set).
const TRAY = ["FIRE", "SHADOW", "SELF", "ENEMY", "GATE", "SEEK", "BIND", "WARD", "CLOSE", "AMPLIFY", "ANCHOR"];

test("rng is deterministic per seed and uniform-ish in [0,1)", () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    assert.deepEqual(seqA, seqB);
    assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => c.next()));
    for (const x of seqA) assert.ok(x >= 0 && x < 1);
    assert.equal(createRng(7).int(1), 0);
    assert.deepEqual(createRng(7).pick(["only"]), "only");
});

test("enumerateLegalSpells yields only spells the parser and resolver accept", () => {
    const spells = enumerateLegalSpells(TRAY);
    assert.ok(spells.length >= 10, `expected a real pool, got ${spells.length}`);
    for (const spell of spells) {
        assert.ok(spell.tokens.length >= 2 && spell.tokens.length <= 4);
        const parsed = parseSpell(spell.tokens);
        assert.equal(parsed.status, "valid", spell.tokens.join(" "));
        assert.ok(parsed.focusCost <= 7);
        assert.equal(spell.focusCost, parsed.focusCost);
        const result = resolveEncounter(createInitialDuelState(), {
            casterId: "opponent", defenderId: "player", spellTokens: spell.tokens
        });
        assert.ok(!result.steps.some(s => s.stage === "validation" && s.result === "failed"), spell.tokens.join(" "));
        assert.ok(["seek", "bind", "ward", "close"].includes(spell.action));
    }
    // The canonical POC spells are all in the pool.
    const keys = new Set(spells.map(s => s.tokens.join(" ")));
    for (const k of ["FIRE SEEK ENEMY", "ENEMY BIND", "GATE CLOSE ANCHOR", "SELF WARD SHADOW", "FIRE SEEK ENEMY AMPLIFY"]) {
        assert.ok(keys.has(k), `missing ${k}`);
    }
    // No duplicates.
    assert.equal(keys.size, spells.length);
});

test("bot spells are legal, seeded-deterministic, and vary between rounds", () => {
    const pool = enumerateLegalSpells(TRAY);
    const view = { state: createInitialDuelState(), botId: "opponent" };
    const a = chooseBotSpell(pool, view, createRng(1));
    const b = chooseBotSpell(pool, view, createRng(1));
    assert.deepEqual(a, b, "same seed must give the same spell");
    assert.ok(pool.some(s => s.tokens.join(" ") === a.join(" ")), "bot spell must come from the legal pool");

    const rng = createRng(9);
    const seen = new Set();
    let last;
    for (let i = 0; i < 12; i++) {
        const spell = chooseBotSpell(pool, { ...view, lastBotSpell: last }, rng);
        assert.notDeepEqual(spell, last, "the bot must not repeat its previous spell");
        seen.add(spell.join(" "));
        last = spell;
    }
    assert.ok(seen.size >= 4, `expected variety, saw ${[...seen].join(" | ")}`);
});

test("bot prefers scoring threats and avoids a ward it cannot pass", () => {
    const pool = enumerateLegalSpells(TRAY);
    // Player holds a FIRE ward: FIRE attacks and untyped BIND are blocked.
    const state = createInitialDuelState();
    state.players.player.ward = { ownerId: "player", essence: "fire" };
    const counts = { blockedByWard: 0, scoring: 0, total: 0 };
    const rng = createRng(3);
    for (let i = 0; i < 40; i++) {
        const spell = chooseBotSpell(pool, { state, botId: "opponent" }, rng);
        const result = resolveEncounter(state, { casterId: "opponent", defenderId: "player", spellTokens: spell });
        counts.total++;
        if (result.steps.some(s => s.code === "WARD_BLOCKED")) counts.blockedByWard++;
        if (result.sealAwardedTo === "opponent") counts.scoring++;
    }
    assert.ok(counts.blockedByWard <= counts.total * 0.15, `bot walked into the ward ${counts.blockedByWard}/${counts.total}`);
    assert.ok(counts.scoring >= counts.total * 0.6, `bot scored only ${counts.scoring}/${counts.total}`);
});

test("reaction scoring follows the resolver's rules", () => {
    const view = { state: createInitialDuelState(), botId: "opponent" };
    const open = scoreReactions(["FIRE", "SEEK", "ENEMY"], view);
    assert.ok(open.reflect > open.none, "an unanchored hostile spell invites REFLECT");
    const anchored = scoreReactions(["FIRE", "SEEK", "ENEMY", "ANCHOR"], view);
    assert.ok(anchored.reflect < anchored.none, "REFLECT is wasted against ANCHOR");
    assert.ok(anchored.silence > open.silence, "SILENCE is worth more when there is a modifier to strip");
    const ward = scoreReactions(["SELF", "WARD", "FIRE"], view);
    assert.ok(ward.reflect <= ward.none && ward.null <= ward.none, "nothing to counter in a self-ward");
    // Reaction choice is deterministic per seed and only ever a legal glyph.
    const r1 = chooseBotReaction(["FIRE", "SEEK", "ENEMY"], view, createRng(5));
    const r2 = chooseBotReaction(["FIRE", "SEEK", "ENEMY"], view, createRng(5));
    assert.equal(r1, r2);
    assert.ok([undefined, "null", "reflect", "silence"].includes(r1));
});

test("NULL is reserved for when the bot is about to lose", () => {
    const calm = scoreReactions(["FIRE", "SEEK", "ENEMY", "ANCHOR"], { state: createInitialDuelState(), botId: "opponent" });
    const state = createInitialDuelState();
    state.players.player.seals = 2;
    const desperate = scoreReactions(["FIRE", "SEEK", "ENEMY", "ANCHOR"], { state, botId: "opponent" });
    assert.ok(desperate.null > calm.null);
    assert.ok(desperate.null > desperate.none, "at match point the hard counter is worth it");
});

test("telegraph presets reveal what the plan says they reveal", () => {
    const spell = ["FIRE", "SEEK", "ENEMY", "AMPLIFY"];
    const high = projectTelegraph(spell, "high", createRng(1));
    assert.equal(high.length, 4);
    assert.deepEqual(high[0], { kind: "glyph", token: "FIRE" });
    assert.deepEqual(high[1], { kind: "glyph", token: "SEEK" });
    assert.deepEqual(high[2], { kind: "hidden" });
    assert.deepEqual(high[3], { kind: "hidden" });
    assert.equal(formatTelegraph(high), "FIRE → SEEK → ? → ?");

    const medium = projectTelegraph(spell, "medium", createRng(1));
    assert.equal(medium.length, 4, "medium reveals the glyph count");
    assert.equal(medium.filter(s => s.kind === "glyph").length, 1, "exactly one exact glyph");
    assert.equal(medium.filter(s => s.kind === "family").length, 1, "exactly one family");
    assert.equal(medium.filter(s => s.kind === "hidden").length, 2);
    const fam = medium.find(s => s.kind === "family");
    assert.ok(["essence", "action", "target", "modifier"].includes(fam.family));
    assert.match(formatTelegraph(medium), /\?/);
    // Same seed, same projection.
    assert.deepEqual(medium, projectTelegraph(spell, "medium", createRng(1)));
});
