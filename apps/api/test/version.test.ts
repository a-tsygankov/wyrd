import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import pkg from "../package.json";
import type { VersionResponse } from "../src/routes/version.ts";
import { getSchemaVersion } from "../src/version.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";

describe("GET /api/version", () => {
    beforeAll(applyAllMigrations);

    it("reports the worker and schema tiers", async () => {
        const res = await SELF.fetch("http://wyrd/api/version");
        expect(res.status).toBe(200);
        const body = (await res.json()) as VersionResponse;
        expect(body.worker).toEqual({ version: pkg.version, env: "development" });
        // The newest applied migration is the schema version.
        expect(body.schema.version).toBe("0000_init.sql");
    });
});

describe("getSchemaVersion", () => {
    it("rethrows anything other than a missing tracker table", async () => {
        const broken = {
            prepare: () => ({
                first: () => Promise.reject(new Error("D1_ERROR: storage unavailable"))
            })
        } as unknown as D1Database;
        await expect(getSchemaVersion(broken)).rejects.toThrow("storage unavailable");
    });

    it("returns null when the tracker table is absent", async () => {
        const fresh = {
            prepare: () => ({
                first: () => Promise.reject(new Error("D1_ERROR: no such table: d1_migrations"))
            })
        } as unknown as D1Database;
        expect(await getSchemaVersion(fresh)).toBeNull();
    });
});
