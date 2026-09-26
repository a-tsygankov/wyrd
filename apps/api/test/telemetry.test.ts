import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";

const roundEvent = {
    event: "round",
    sessionId: "11111111-1111-4111-8111-111111111111",
    matchSeed: "smoke",
    round: 2,
    scenarioId: "reflect-opportunity",
    telegraphPreset: "high",
    telegraph: "SHADOW → SEEK → ? → ?",
    opponentSpell: ["SHADOW", "SEEK", "ENEMY", "AMPLIFY"],
    playerSpell: ["GATE", "CLOSE"],
    playerReaction: "reflect",
    opponentReaction: "silence",
    playerSeals: 3,
    opponentSeals: 1,
    playerGained: 2,
    opponentGained: 0,
    timeToCommitMs: 8400,
    webVersion: "0.0.4"
};

async function post(body: unknown): Promise<Response> {
    return SELF.fetch("http://wyrd/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body)
    });
}

async function count(): Promise<number> {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM telemetry_events").first<{ n: number }>();
    return row?.n ?? 0;
}

describe("POST /api/telemetry", () => {
    beforeAll(applyAllMigrations);

    it("stores a batch of round events and answers 202 with the count", async () => {
        const before = await count();
        const res = await post({ events: [roundEvent, { ...roundEvent, event: "rematch", round: 3 }] });
        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ accepted: 2 });
        expect(await count()).toBe(before + 2);

        const row = await env.DB.prepare(
            "SELECT session_id, match_seed, round, scenario_id, telegraph_preset, telegraph, opponent_spell, player_spell, player_reaction, opponent_reaction, player_seals, opponent_seals, player_gained, opponent_gained, time_to_commit_ms, web_version, mode, rules, end_reason, event FROM telemetry_events WHERE event = 'round' ORDER BY ts DESC LIMIT 1"
        ).first<Record<string, unknown>>();
        expect(row).toEqual({
            session_id: roundEvent.sessionId,
            match_seed: "smoke",
            round: 2,
            scenario_id: "reflect-opportunity",
            telegraph_preset: "high",
            telegraph: "SHADOW → SEEK → ? → ?",
            opponent_spell: "SHADOW SEEK ENEMY AMPLIFY",
            player_spell: "GATE CLOSE",
            player_reaction: "reflect",
            opponent_reaction: "silence",
            player_seals: 3,
            opponent_seals: 1,
            player_gained: 2,
            opponent_gained: 0,
            time_to_commit_ms: 8400,
            web_version: "0.0.4",
            mode: "solo",
            rules: "classic",
            end_reason: null,
            event: "round"
        });
    });

    it("accepts a single event object, nullable fields and the hot-seat mode", async () => {
        const before = await count();
        const { playerReaction, opponentReaction, scenarioId, ...rest } = roundEvent;
        const res = await post({ ...rest, round: 9, telegraphPreset: "medium", mode: "hotseat" });
        expect(res.status).toBe(202);
        expect(await count()).toBe(before + 1);
        const row = await env.DB.prepare(
            "SELECT scenario_id, player_reaction, opponent_reaction, mode FROM telemetry_events WHERE round = 9"
        ).first<Record<string, unknown>>();
        expect(row).toEqual({ scenario_id: null, player_reaction: null, opponent_reaction: null, mode: "hotseat" });
        expect((await post({ ...roundEvent, mode: "lan" })).status).toBe(400);
        expect((await post({ ...roundEvent, rules: "chaos" })).status).toBe(400);
        expect((await post({ ...roundEvent, endReason: "forfeit" })).status).toBe(400);
    });

    it("stores the ruleset and how a match ended", async () => {
        const res = await post({ events: [{ ...roundEvent, round: 42, rules: "resolve" }, { ...roundEvent, event: "match_end", round: 43, rules: "resolve", endReason: "resolve" }] });
        expect(res.status).toBe(202);
        const rows = (await env.DB.prepare("SELECT rules, end_reason FROM telemetry_events WHERE round IN (42, 43) ORDER BY round").all<{ rules: string; end_reason: string | null }>()).results;
        expect(rows).toEqual([{ rules: "resolve", end_reason: null }, { rules: "resolve", end_reason: "resolve" }]);
    });

    it("rejects malformed input without writing anything", async () => {
        const before = await count();
        expect((await post("nope")).status).toBe(400);
        expect((await post({})).status).toBe(400);
        expect((await post({ events: [] })).status).toBe(400);
        expect((await post({ ...roundEvent, event: "dance" })).status).toBe(400);
        expect((await post({ ...roundEvent, sessionId: "not-a-uuid" })).status).toBe(400);
        expect((await post({ ...roundEvent, playerReaction: "shout" })).status).toBe(400);
        expect((await post({ ...roundEvent, playerSpell: ["A", "B", "C", "D", "E"] })).status).toBe(400);
        expect((await post({ ...roundEvent, telegraph: "x".repeat(300) })).status).toBe(400);
        expect((await post({ events: Array.from({ length: 21 }, () => roundEvent) })).status).toBe(400);
        expect(await count()).toBe(before);
    });
});

describe("GET /api/telemetry/summary", () => {
    beforeAll(applyAllMigrations);

    it("aggregates reactions and outcomes per scenario for the playtest review", async () => {
        // The workers pool isolates storage per test, so this test seeds
        // its own rows rather than relying on the POST tests above.
        const seeded = await post({
            events: [
                roundEvent,
                { ...roundEvent, playerReaction: null, playerGained: 0, timeToCommitMs: 12000 },
                { ...roundEvent, event: "rematch", round: 3 }
            ]
        });
        expect(seeded.status).toBe(202);
        const res = await SELF.fetch("http://wyrd/api/telemetry/summary");
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            rounds: number;
            rematches: number;
            sessions: number;
            rulesets: Array<{ rules: string; mode: string; rounds: number; matches: number; endedByResolve: number; playerSealRate: number; medianTimeToCommitMs: number | null }>;
            scenarios: Array<{ scenarioId: string | null; rounds: number; reactions: Record<string, number>; playerSealRate: number; medianTimeToCommitMs: number | null }>;
        };
        expect(body.rounds).toBeGreaterThanOrEqual(2);
        expect(body.rematches).toBeGreaterThanOrEqual(1);
        expect(body.sessions).toBeGreaterThanOrEqual(1);
        const reflect = body.scenarios.find(s => s.scenarioId === "reflect-opportunity");
        expect(reflect).toBeDefined();
        expect(reflect!.rounds).toBe(2);
        expect(reflect!.reactions).toEqual({ reflect: 1, none: 1 });
        expect(reflect!.playerSealRate).toBe(0.5);
        // Lower median of [8400, 12000].
        expect(reflect!.medianTimeToCommitMs).toBe(8400);
        const classic = body.rulesets.find(r => r.rules === "classic" && r.mode === "solo");
        expect(classic).toBeDefined();
        expect(classic!.rounds).toBe(2);
        expect(classic!.playerSealRate).toBe(0.5);
        expect(classic!.medianTimeToCommitMs).toBe(8400);
    });
});
