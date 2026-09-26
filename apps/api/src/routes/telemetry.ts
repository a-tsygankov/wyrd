import { Hono } from "hono";
import type { Bindings } from "../env.ts";

/**
 * Anonymous playtest telemetry (plan POC-5). The client fires and forgets;
 * this side validates hard (the endpoint is public) and writes one row per
 * event. `/summary` is the playtest review view: per scenario, how players
 * reacted, how often they scored, how long they took to commit.
 */
const EVENTS = new Set(["round", "rematch", "match_end"]);
const REACTIONS = new Set(["null", "reflect", "silence"]);
const PRESETS = new Set(["high", "medium"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 20;
const MAX_TEXT = 200;
const MAX_GLYPHS = 4;

export type TelemetryEvent = {
    event: "round" | "rematch" | "match_end";
    sessionId: string;
    matchSeed: string;
    round: number;
    scenarioId: string | null;
    telegraphPreset: "high" | "medium" | null;
    telegraph: string | null;
    opponentSpell: string[] | null;
    playerSpell: string[] | null;
    playerReaction: "null" | "reflect" | "silence" | null;
    opponentReaction: "null" | "reflect" | "silence" | null;
    playerSeals: number;
    opponentSeals: number;
    playerGained: number;
    opponentGained: number;
    timeToCommitMs: number | null;
    webVersion: string;
};

type Raw = Record<string, unknown>;

function optText(v: unknown, field: string): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || v.length === 0 || v.length > MAX_TEXT) throw new Error(`${field} must be a string of at most ${MAX_TEXT} chars`);
    return v;
}

function text(v: unknown, field: string): string {
    const t = optText(v, field);
    if (t === null) throw new Error(`${field} is required`);
    return t;
}

function int(v: unknown, field: string, { min = 0, max = 1_000_000_000 } = {}): number {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Error(`${field} must be an integer in [${min}, ${max}]`);
    return v;
}

function optInt(v: unknown, field: string): number | null {
    return v === undefined || v === null ? null : int(v, field);
}

function optEnum<T extends string>(v: unknown, field: string, allowed: Set<string>): T | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || !allowed.has(v)) throw new Error(`${field} must be one of ${[...allowed].join(", ")}`);
    return v as T;
}

function optSpell(v: unknown, field: string): string[] | null {
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v) || v.length === 0 || v.length > MAX_GLYPHS || !v.every(t => typeof t === "string" && t.length > 0 && t.length <= 16)) {
        throw new Error(`${field} must be 1-${MAX_GLYPHS} glyph tokens`);
    }
    return v as string[];
}

export function parseEvent(raw: unknown): TelemetryEvent {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("event must be an object");
    const r = raw as Raw;
    const event = r.event;
    if (typeof event !== "string" || !EVENTS.has(event)) throw new Error("event must be round, rematch or match_end");
    const sessionId = text(r.sessionId, "sessionId");
    if (!UUID.test(sessionId)) throw new Error("sessionId must be a UUID");
    return {
        event: event as TelemetryEvent["event"],
        sessionId,
        matchSeed: text(r.matchSeed, "matchSeed"),
        round: int(r.round, "round", { min: 1, max: 10_000 }),
        scenarioId: optText(r.scenarioId, "scenarioId"),
        telegraphPreset: optEnum(r.telegraphPreset, "telegraphPreset", PRESETS),
        telegraph: optText(r.telegraph, "telegraph"),
        opponentSpell: optSpell(r.opponentSpell, "opponentSpell"),
        playerSpell: optSpell(r.playerSpell, "playerSpell"),
        playerReaction: optEnum(r.playerReaction, "playerReaction", REACTIONS),
        opponentReaction: optEnum(r.opponentReaction, "opponentReaction", REACTIONS),
        playerSeals: int(r.playerSeals, "playerSeals", { max: 100 }),
        opponentSeals: int(r.opponentSeals, "opponentSeals", { max: 100 }),
        playerGained: r.playerGained === undefined ? 0 : int(r.playerGained, "playerGained", { max: 100 }),
        opponentGained: r.opponentGained === undefined ? 0 : int(r.opponentGained, "opponentGained", { max: 100 }),
        timeToCommitMs: optInt(r.timeToCommitMs, "timeToCommitMs"),
        webVersion: text(r.webVersion, "webVersion")
    };
}

export function parseBatch(body: unknown): TelemetryEvent[] {
    const list = typeof body === "object" && body !== null && "events" in body ? (body as { events: unknown }).events : [body];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) throw new Error(`events must hold 1-${MAX_BATCH} items`);
    return list.map(parseEvent);
}

const INSERT =
    "INSERT INTO telemetry_events (id, ts, event, session_id, match_seed, round, scenario_id, telegraph_preset, telegraph, opponent_spell, player_spell, player_reaction, opponent_reaction, player_seals, opponent_seals, player_gained, opponent_gained, time_to_commit_ms, web_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

export const telemetryRouter = new Hono<{ Bindings: Bindings }>()
    .post("/", async c => {
        let raw: unknown;
        try {
            raw = await c.req.json();
        } catch {
            return c.json({ error: "body must be JSON" }, 400);
        }
        let events: TelemetryEvent[];
        try {
            events = parseBatch(raw);
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : "invalid telemetry" }, 400);
        }
        const now = Date.now();
        // One batch, one round trip: D1 batch() is atomic, so a rejected row
        // (a CHECK the validator missed) drops the whole request rather than
        // leaving half a match behind.
        await c.env.DB.batch(
            events.map((e, i) =>
                c.env.DB.prepare(INSERT).bind(
                    crypto.randomUUID(),
                    now + i,
                    e.event,
                    e.sessionId,
                    e.matchSeed,
                    e.round,
                    e.scenarioId,
                    e.telegraphPreset,
                    e.telegraph,
                    e.opponentSpell?.join(" ") ?? null,
                    e.playerSpell?.join(" ") ?? null,
                    e.playerReaction,
                    e.opponentReaction,
                    e.playerSeals,
                    e.opponentSeals,
                    e.playerGained,
                    e.opponentGained,
                    e.timeToCommitMs,
                    e.webVersion
                )
            )
        );
        return c.json({ accepted: events.length }, 202);
    })
    .get("/summary", async c => {
        const db = c.env.DB;
        const totals = await db
            .prepare(
                "SELECT SUM(event = 'round') AS rounds, SUM(event = 'rematch') AS rematches, COUNT(DISTINCT session_id) AS sessions FROM telemetry_events"
            )
            .first<{ rounds: number | null; rematches: number | null; sessions: number }>();
        const rows = (
            await db
                .prepare(
                    "SELECT scenario_id, COALESCE(player_reaction, 'none') AS reaction, COUNT(*) AS n, SUM(player_gained > 0) AS scored FROM telemetry_events WHERE event = 'round' GROUP BY scenario_id, reaction"
                )
                .all<{ scenario_id: string | null; reaction: string; n: number; scored: number }>()
        ).results;
        const times = (
            await db
                .prepare("SELECT scenario_id, time_to_commit_ms FROM telemetry_events WHERE event = 'round' AND time_to_commit_ms IS NOT NULL ORDER BY time_to_commit_ms")
                .all<{ scenario_id: string | null; time_to_commit_ms: number }>()
        ).results;

        const byScenario = new Map<string | null, { rounds: number; scored: number; reactions: Record<string, number>; times: number[] }>();
        const bucket = (id: string | null) => {
            let b = byScenario.get(id);
            if (!b) {
                b = { rounds: 0, scored: 0, reactions: {}, times: [] };
                byScenario.set(id, b);
            }
            return b;
        };
        for (const row of rows) {
            const b = bucket(row.scenario_id);
            b.rounds += row.n;
            b.scored += row.scored;
            b.reactions[row.reaction] = (b.reactions[row.reaction] ?? 0) + row.n;
        }
        for (const row of times) bucket(row.scenario_id).times.push(row.time_to_commit_ms);

        const median = (sorted: number[]): number | null =>
            sorted.length === 0 ? null : (sorted[Math.floor((sorted.length - 1) / 2)] as number);

        return c.json({
            rounds: totals?.rounds ?? 0,
            rematches: totals?.rematches ?? 0,
            sessions: totals?.sessions ?? 0,
            scenarios: [...byScenario.entries()].map(([scenarioId, b]) => ({
                scenarioId,
                rounds: b.rounds,
                reactions: b.reactions,
                playerSealRate: b.rounds === 0 ? 0 : b.scored / b.rounds,
                medianTimeToCommitMs: median(b.times)
            }))
        });
    });
