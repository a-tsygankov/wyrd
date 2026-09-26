import { Hono } from "hono";
import {
    createInitialDuelState,
    resolveEncounter,
    type ReactionGlyph,
    type ResolutionResult
} from "../../../../packages/wyrd-resolver/src/index.js";
import type { Bindings } from "../env.ts";

const REACTIONS: ReadonlySet<string> = new Set<ReactionGlyph>(["null", "reflect", "silence"]);
const MAX_GLYPHS = 4;

export type ResolveRequest = {
    spellTokens: string[];
    reaction?: ReactionGlyph;
};

function parseRequest(body: unknown): ResolveRequest | string {
    if (typeof body !== "object" || body === null) return "body must be a JSON object";
    const { spellTokens, reaction } = body as Record<string, unknown>;
    if (
        !Array.isArray(spellTokens) ||
        spellTokens.length === 0 ||
        spellTokens.length > MAX_GLYPHS ||
        !spellTokens.every(t => typeof t === "string" && t.length > 0)
    ) {
        return `spellTokens must be 1-${MAX_GLYPHS} non-empty strings`;
    }
    if (reaction !== undefined && !(typeof reaction === "string" && REACTIONS.has(reaction))) {
        return "reaction must be one of null, reflect, silence";
    }
    return reaction === undefined
        ? { spellTokens: spellTokens as string[] }
        : { spellTokens: spellTokens as string[], reaction: reaction as ReactionGlyph };
}

/**
 * POST /api/duel/resolve - authoritative resolution of one encounter
 * against a fresh duel state, logged to D1. The same resolver runs in
 * the browser for the offline POC; this is the server-side boundary
 * M3 multiplayer will move the real state behind.
 */
export const duelRouter = new Hono<{ Bindings: Bindings }>().post("/resolve", async c => {
    let raw: unknown;
    try {
        raw = await c.req.json();
    } catch {
        return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = parseRequest(raw);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const result: ResolutionResult = resolveEncounter(createInitialDuelState(), {
        casterId: "player",
        defenderId: "opponent",
        ...parsed
    });

    await c.env.DB.prepare(
        "INSERT INTO duel_log (id, ts, caster, spell, reaction, seal_awarded_to, steps) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
        .bind(
            crypto.randomUUID(),
            Date.now(),
            "player",
            parsed.spellTokens.join(" "),
            parsed.reaction ?? null,
            result.sealAwardedTo ?? null,
            JSON.stringify(result.steps)
        )
        .run();

    return c.json(result);
});
