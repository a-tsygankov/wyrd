import assert from "node:assert/strict";
import test from "node:test";
import { buildRoundEvent, createTelemetry, getSessionId } from "../dist/apps/web/src/telemetry.js";

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => void map.set(k, String(v)),
        map
    };
}

test("getSessionId mints a UUID once and reuses it", () => {
    const storage = memoryStorage();
    const first = getSessionId(storage, () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(first, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const second = getSessionId(storage, () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.equal(second, first, "existing id must win");
});

test("getSessionId survives a storage that throws (private mode)", () => {
    const broken = {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); }
    };
    const id = getSessionId(broken, () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});

test("buildRoundEvent captures what the plan asks for and nothing personal", () => {
    const event = buildRoundEvent({
        sessionId: "s",
        matchSeed: "smoke",
        webVersion: "0.0.4",
        round: 2,
        scenarioId: "reflect-opportunity",
        telegraphPreset: "high",
        telegraph: "SHADOW → SEEK → ? → ?",
        opponentSpell: ["SHADOW", "SEEK", "ENEMY", "AMPLIFY"],
        playerSpell: ["GATE", "CLOSE"],
        playerReaction: "reflect",
        opponentReaction: undefined,
        playerSealsBefore: 1,
        opponentSealsBefore: 1,
        playerSeals: 3,
        opponentSeals: 1,
        roundStartedAt: 1000,
        committedAt: 9400,
        mode: "hotseat",
        rules: "teeth",
        scries: 1
    });
    assert.deepEqual(event, {
        event: "round",
        sessionId: "s",
        matchSeed: "smoke",
        webVersion: "0.0.4",
        round: 2,
        scenarioId: "reflect-opportunity",
        telegraphPreset: "high",
        telegraph: "SHADOW → SEEK → ? → ?",
        opponentSpell: ["SHADOW", "SEEK", "ENEMY", "AMPLIFY"],
        playerSpell: ["GATE", "CLOSE"],
        playerReaction: "reflect",
        opponentReaction: null,
        playerSeals: 3,
        opponentSeals: 1,
        playerGained: 2,
        opponentGained: 0,
        timeToCommitMs: 8400,
        mode: "hotseat",
        rules: "teeth",
        scries: 1
    });
    assert.ok(!("userAgent" in event) && !("ip" in event));
});

test("createTelemetry batches, flushes on demand and never throws when the network is down", async () => {
    const sent = [];
    const telemetry = createTelemetry({
        endpoint: "./api/telemetry",
        send: async (url, body) => {
            sent.push({ url, body });
            throw new Error("offline");
        }
    });
    telemetry.record({ event: "rematch", sessionId: "s", matchSeed: "x", webVersion: "0.0.4", round: 1, playerSeals: 0, opponentSeals: 0 });
    telemetry.record({ event: "rematch", sessionId: "s", matchSeed: "x", webVersion: "0.0.4", round: 1, playerSeals: 0, opponentSeals: 0 });
    await telemetry.flush();
    assert.equal(sent.length, 1, "one request for the batch");
    assert.equal(sent[0].url, "./api/telemetry");
    assert.equal(JSON.parse(sent[0].body).events.length, 2);
    // A failed send drops the batch instead of retrying forever or throwing.
    await telemetry.flush();
    assert.equal(sent.length, 1);
});

test("createTelemetry can be disabled entirely", async () => {
    let calls = 0;
    const telemetry = createTelemetry({ endpoint: "x", enabled: false, send: async () => void calls++ });
    telemetry.record({ event: "rematch", sessionId: "s", matchSeed: "x", webVersion: "0.0.4", round: 1, playerSeals: 0, opponentSeals: 0 });
    await telemetry.flush();
    assert.equal(calls, 0);
});
