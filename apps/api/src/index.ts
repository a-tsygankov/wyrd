import { Hono } from "hono";
import type { Bindings } from "./env.ts";
import { duelRouter } from "./routes/duel.ts";
import { telemetryRouter } from "./routes/telemetry.ts";
import { versionRouter } from "./routes/version.ts";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", c => c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }));
app.route("/api/version", versionRouter);
app.route("/api/duel", duelRouter);
app.route("/api/telemetry", telemetryRouter);

export { app };

export default {
    fetch: app.fetch
} satisfies ExportedHandler<Bindings>;
