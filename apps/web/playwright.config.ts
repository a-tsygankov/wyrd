import { defineConfig, devices } from "@playwright/test";

// Defaults to production; CI points E2E_BASE_URL at the per-PR Pages
// preview. For a local run serve the build first:
//   pnpm build:web && (cd apps/web && pnpm exec wrangler pages dev dist --port 8788)
//   E2E_BASE_URL=http://127.0.0.1:8788 pnpm --filter @wyrd/web test:e2e
// Production is the default target, so every spec must stay read-only
// beyond the client-side duel it plays.
const baseURL = process.env["E2E_BASE_URL"] ?? "https://wyrd-web.pages.dev";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    forbidOnly: !!process.env["CI"],
    retries: process.env["CI"] ? 2 : 0,
    workers: 1,
    reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
    use: { baseURL, trace: "retain-on-failure", actionTimeout: 10_000 },
    // The two platforms the product ships on, at handset profiles.
    projects: [
        { name: "webkit", use: { ...devices["iPhone 15"] } },
        { name: "chromium", use: { ...devices["Pixel 7"] } }
    ]
});
