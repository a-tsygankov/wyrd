import assert from "node:assert/strict";
import test from "node:test";
import { emptyStats, loadStats, recordMatchEnd, recordRematch, recordRound, saveStats, summarize } from "../dist/apps/web/src/stats.js";

function memory() {
    const map = new Map();
    return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)) };
}

test("rounds accumulate per ruleset: seals, reactions, time to commit", () => {
    let stats = emptyStats();
    stats = recordRound(stats, { ruleset: "teeth", mode: "solo", playerGained: 1, opponentGained: 0, playerReaction: "reflect", timeToCommitMs: 4000 });
    stats = recordRound(stats, { ruleset: "teeth", mode: "solo", playerGained: 0, opponentGained: 1, playerReaction: undefined, timeToCommitMs: 8000 });
    stats = recordRound(stats, { ruleset: "classic", mode: "hotseat", playerGained: 1, opponentGained: 1, playerReaction: "null", timeToCommitMs: 2000 });
    const teeth = stats.rulesets.teeth;
    assert.equal(teeth.rounds, 2);
    assert.equal(teeth.sealsFor, 1);
    assert.equal(teeth.sealsAgainst, 1);
    assert.deepEqual(teeth.reactions, { reflect: 1, none: 1 });
    assert.equal(teeth.commitMsTotal, 12000);
    assert.equal(stats.rulesets.classic.rounds, 1);
    assert.equal(stats.rulesets.classic.reactions.null, 1);
    assert.equal(stats.modes.hotseat.rounds, 1);
    assert.equal(stats.modes.solo.rounds, 2);
});

test("match ends count wins, losses, the reason and the streak; rematches count", () => {
    let stats = emptyStats();
    stats = recordMatchEnd(stats, { ruleset: "resolve", mode: "solo", won: true, reason: "seals" });
    stats = recordMatchEnd(stats, { ruleset: "resolve", mode: "solo", won: true, reason: "resolve" });
    stats = recordMatchEnd(stats, { ruleset: "resolve", mode: "solo", won: false, reason: "seals" });
    stats = recordRematch(stats, { ruleset: "resolve", mode: "solo" });
    const r = stats.rulesets.resolve;
    assert.equal(r.matches, 3);
    assert.equal(r.wins, 2);
    assert.deepEqual(r.endedBy, { seals: 2, resolve: 1 });
    assert.equal(r.rematches, 1);
    assert.equal(stats.streak, -1, "a loss resets the streak downwards");
    stats = recordMatchEnd(stats, { ruleset: "classic", mode: "solo", won: true, reason: "seals" });
    assert.equal(stats.streak, 1);
    assert.equal(stats.bestStreak, 2);
});

test("summarize produces display rows with rates and averages", () => {
    let stats = emptyStats();
    stats = recordRound(stats, { ruleset: "teeth", mode: "solo", playerGained: 1, opponentGained: 0, playerReaction: "reflect", timeToCommitMs: 4000 });
    stats = recordRound(stats, { ruleset: "teeth", mode: "solo", playerGained: 0, opponentGained: 0, playerReaction: undefined, timeToCommitMs: 6000 });
    stats = recordMatchEnd(stats, { ruleset: "teeth", mode: "solo", won: true, reason: "seals" });
    const rows = summarize(stats);
    const teeth = rows.find(r => r.ruleset === "teeth");
    assert.equal(teeth.matches, 1);
    assert.equal(teeth.winRate, 1);
    assert.equal(teeth.avgCommitMs, 5000);
    assert.equal(teeth.sealRate, 0.5);
    assert.equal(teeth.topReaction, "none/reflect", "ties are listed alphabetically");
    assert.ok(rows.find(r => r.ruleset === "classic").matches === 0, "every ruleset has a row");
});

test("stats persist and survive corrupt storage", () => {
    const storage = memory();
    const stats = recordRematch(emptyStats(), { ruleset: "classic", mode: "solo" });
    saveStats(storage, stats);
    assert.deepEqual(loadStats(storage), stats);
    storage.setItem("wyrd.stats", "{broken");
    assert.deepEqual(loadStats(storage), emptyStats());
});
