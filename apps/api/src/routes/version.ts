import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { WORKER_VERSION, getSchemaVersion } from "../version.ts";

export type VersionResponse = {
    worker: { version: string; env: string };
    schema: { version: string | null };
};

/** GET /api/version - public; the web client shows it in its footer. */
export const versionRouter = new Hono<{ Bindings: Bindings }>().get("/", async c => {
    const body: VersionResponse = {
        worker: { version: WORKER_VERSION, env: c.env.ENVIRONMENT },
        schema: { version: await getSchemaVersion(c.env.DB) }
    };
    return c.json(body);
});
