import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDuelState } from "../dist/packages/wyrd-resolver/src/index.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { quipFor, QUIPS } from "../dist/packages/wyrd-content/src/quips.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { PERSONALITIES, chooseBotSpell, chooseBotSpellDetailed, spellTemperature } from "../dist/packages/wyrd-simulation/src/bot.js";

// Random behaviour of the computer opponent, on top of personalities and
// plans: a whim (a random reasonable spell now and then), a temper (erratic
// when behind, calm when ahead), and a quip after the round. All seeded.

const pool = enumerateLegalSpells(POC_TRAY);
const by = id => PERSONALITIES.find(p => p.id === id);

test("every personality has a whim rate; the Trickster's is the highest", () => {
    for (const p of PERSONALITIES) assert.ok(p.whim >= 0.05 && p.whim <= 0.35, `${p.id} whim ${p.whim}`);
    assert.ok(by("trickster").whim > by("warden").whim);
});

test("on a whim the bot casts a random reasonable spell, about as often as its rate says, and says so", () => {
    const view = { state: createInitialDuelState(rulesets.teeth.rules), botId: "opponent", personality: by("balanced") };
    const rng = createRng(3);
    let whims = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
        const pick = chooseBotSpellDetailed(pool, view, rng);
        assert.ok(pool.some(s => s.tokens.join(" ") === pick.tokens.join(" ")), "always from the legal pool");
        if (pick.whim) {
            whims++;
            assert.ok(!pick.tokens.includes("SELF") || pick.tokens.includes("WARD") || pick.tokens.includes("MEND"), `a whim is never a self-hit: ${pick.tokens.join(" ")}`);
        }
    }
    const rate = whims / N;
    assert.ok(Math.abs(rate - by("balanced").whim) < 0.06, `whim rate ${rate} vs ${by("balanced").whim}`);
    assert.deepEqual(chooseBotSpell(pool, view, createRng(9)), chooseBotSpellDetailed(pool, view, createRng(9)).tokens, "the plain chooser is the detailed one's tokens");
});

test("temper: the bot runs hotter when behind on seals and cooler when ahead", () => {
    const even = createInitialDuelState();
    const behind = createInitialDuelState();
    behind.players.player.seals = 2;
    const ahead = createInitialDuelState();
    ahead.players.opponent.seals = 2;
    const base = by("balanced").temperature;
    assert.equal(spellTemperature({ state: even, botId: "opponent", personality: by("balanced") }), base);
    assert.ok(spellTemperature({ state: behind, botId: "opponent", personality: by("balanced") }) > base * 1.3, "behind: more erratic");
    assert.ok(spellTemperature({ state: ahead, botId: "opponent", personality: by("balanced") }) < base, "ahead: calmer");
    assert.ok(spellTemperature({ state: ahead, botId: "opponent", personality: by("balanced") }) >= 1, "never below 1");
});

test("quips: every personality has lines for a won, lost and even round, picked by the seed", () => {
    for (const p of PERSONALITIES) {
        for (const outcome of ["won", "lost", "even"]) {
            assert.ok(QUIPS[p.id][outcome].length >= 3, `${p.id} ${outcome}`);
            for (const line of QUIPS[p.id][outcome]) assert.ok(line.length > 8 && line.length < 90, line);
        }
    }
    assert.equal(quipFor("trickster", "won", createRng(5)), quipFor("trickster", "won", createRng(5)));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => quipFor("warden", "lost", createRng(i))));
    assert.ok(seen.size >= 3, "the seed varies the line");
    assert.equal(quipFor("nobody", "even", createRng(1)), quipFor("balanced", "even", createRng(1)), "unknown ids fall back to the Adept");
});
