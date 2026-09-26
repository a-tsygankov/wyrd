# wyrd — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves an open question.

**Product decision (2026-09-26): gameplay ships as a browser/PWA app on both iPhone and Android. No native/Unity client.** Architecture: `docs/architecture.md` (v2). Plan: `docs/poc-plan.md` (v2). Design source of truth: Google Drive folder (Wyrd_Masks_Game_Concept, Wyrd_Grammar_Spec, Wyrd_Game_Agent_Handoff).

## Phase
M0 grammar + playable browser duel POC. Cloudflare deployment pipeline (worker + D1 schema + Pages client, gigsy/feedme2 model) landed 2026-09-26 via PR #6; resources provisioned and first-deployed from the workstation the same day. The earlier GitHub Pages deploy workflow was removed (it failed: Pages was never enabled on the repo).

## Live resources (provisioned and first-deployed 2026-09-26)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `wyrd-api` → https://wyrd-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `wyrd-web` → https://wyrd-web.pages.dev | per-branch previews `<branch>.wyrd-web.pages.dev`; `/api/*` proxied to the worker |
| D1 | `wyrd-db` (`68b495d9-ab5a-4a84-b996-702dc4c2de0e`) | migrations via `wrangler d1 migrations apply`; `0000_init.sql`, `0001_telemetry.sql` |
| Playtest review | https://wyrd-web.pages.dev/api/telemetry/summary | per-scenario reactions, seal rate, median time-to-commit; rematches and sessions |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` | set 2026-09-26 with `scripts/setup-secrets.local.ps1 -GitHub` (same token as gigsy/feedme2) |
| Worker secrets | none | — |

## Open items
- Rules decision surfaced by the bot: SELF-targeted SEEK/BIND used to hit the defender and score an unwardable seal; fixed 2026-09-26 so they land on the caster and score nothing. SILENCE never prevents a seal in the POC rules (it only strips modifiers, and magnitude does not affect seals) - keep or give SILENCE teeth? Decide from playtests.
- POC-4b (`docs/poc-plan.md`): items 3-5 done in code (install banner, versioned service worker, Playwright iPhone/Pixel smoke on PR previews). **Still needs a human with real phones**: install from Safari and Chrome, reload offline, finish a match; then a manual Lighthouse PWA audit.
- Whether the worker should become the authoritative resolver for the browser POC now (it already logs `POST /api/duel/resolve` to `duel_log`) or only with M3 multiplayer.

## Gotchas
- Cloudflare Pages redirects `/index.html` → `/` (308). The service worker must cache the shell under `./`, never `./index.html`; a cached redirected response makes an offline navigation fail with `net::ERR_FAILED` (caught by the Chromium offline smoke test).
- `wrangler pages project create` (wrangler ≥ 4.14x) delegates to Pages-on-Workers and reads the nearest `wrangler.toml`; run it from `apps/web` with `--force` (the `-Provision` script does). `wrangler pages deploy` from `apps/web` still targets the classic project.

## Log
- 2026-09-26 — POC-5 telemetry: `telemetry_events` table (`0001_telemetry.sql`), `POST /api/telemetry` (validated batches, atomic D1 batch insert) and `GET /api/telemetry/summary`; client records each resolved round, rematch and match end, fire-and-forget, `?telemetry=off` to opt out. Everything needed for phone playtests is now in place.
- 2026-09-26 — POC-3/POC-5: `packages/wyrd-simulation` (seeded rng, legal-spell pool, heuristic bot, telegraph presets high/medium) and the 8-scenario deck in `wyrd-content`; the client plays the deck then the bot, shows lessons, `?seed=` replays a match. New `simulation` version tier. Resolver fix for SELF-targeted scoring.
- 2026-09-26 — POC-4b code: iOS Add-to-Home-Screen coach mark + Android install prompt (`apps/web/src/install.ts`), service-worker cache versioned by the web tier and bypassing `/api/*`, Playwright smoke (WebKit iPhone 15 + Chromium Pixel 7) replacing the curl check on PR previews.
- 2026-09-26 — browser/PWA-only directive; architecture doc v2 (Unity path removed, Cloudflare + Durable Objects, PWA platform constraints) and POC plan v2 written to `docs/` and uploaded to Drive as *_v2.md.
- 2026-09-26 — GitHub secrets set; `workflow_dispatch` run 36232457853 green across all tiers (worker deploy + web deploy from CI). Pipeline complete.
- 2026-09-26 — PR #6: pipeline scaffolded (`apps/api` worker with health/version/duel-resolve + `0000_init.sql`, Pages proxy function, worker + schema version tiers, `deploy.yml`, deploy/secrets scripts). CI test jobs green; preview deploy red (no secrets).
- 2026-09-26 — D1 `wyrd-db` and Pages `wyrd-web` provisioned; migrations applied; worker v0.0.1 and web v0.0.2 deployed from the workstation; `/api/version` live through the proxy.
- 2026-09-26 — playable browser duel POC merged; GitHub Pages deploy attempt failed (Pages not enabled).
