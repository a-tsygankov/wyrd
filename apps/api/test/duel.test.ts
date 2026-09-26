import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ResolutionResult } from "../../../packages/wyrd-resolver/src/index.js";
import { applyAllMigrations } from "./helpers/migrate.ts";

async function post(body: unknown): Promise<Response> {
    return SELF.fetch("http://wyrd/api/duel/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body)
    });
}

async function logCount(): Promise<number> {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM duel_log").first<{ n: number }>();
    return row?.n ?? 0;
}

describe("POST /api/duel/resolve", () => {
    beforeAll(applyAllMigrations);

    it("resolves a spell with the shared resolver and logs it", async () => {
        const before = await logCount();
        const res = await post({ spellTokens: ["FIRE", "SEEK", "ENEMY"] });
        expect(res.status).toBe(200);
        const result = (await res.json()) as ResolutionResult;
        expect(result.sealAwardedTo).toBe("player");
        expect(result.state.players.player.seals).toBe(1);
        expect(result.steps.length).toBeGreaterThan(0);
        expect(await logCount()).toBe(before + 1);

        const row = await env.DB.prepare(
            "SELECT spell, reaction, seal_awarded_to FROM duel_log ORDER BY ts DESC LIMIT 1"
        ).first<{ spell: string; reaction: string | null; seal_awarded_to: string | null }>();
        expect(row).toEqual({ spell: "FIRE SEEK ENEMY", reaction: null, seal_awarded_to: "player" });
    });

    it("records the reaction glyph", async () => {
        const res = await post({ spellTokens: ["FIRE", "SEEK", "ENEMY"], reaction: "null" });
        expect(res.status).toBe(200);
        const row = await env.DB.prepare(
            "SELECT reaction FROM duel_log ORDER BY ts DESC, rowid DESC LIMIT 1"
        ).first<{ reaction: string | null }>();
        expect(row?.reaction).toBe("null");
    });

    it("rejects malformed bodies without touching the log", async () => {
        const before = await logCount();
        expect((await post("not json")).status).toBe(400);
        expect((await post({})).status).toBe(400);
        expect((await post({ spellTokens: [] })).status).toBe(400);
        expect((await post({ spellTokens: ["A", "B", "C", "D", "E"] })).status).toBe(400);
        expect((await post({ spellTokens: ["FIRE"], reaction: "dance" })).status).toBe(400);
        expect(await logCount()).toBe(before);
    });
});
