# wyrd — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves an open question.

## Phase
M0 grammar + playable browser duel POC. Cloudflare deployment pipeline (worker + D1 schema + Pages client, gigsy/feedme2 model) landed 2026-09-26 via PR #6; resources provisioned and first-deployed from the workstation the same day. The earlier GitHub Pages deploy workflow was removed (it failed: Pages was never enabled on the repo).

## Live resources (provisioned and first-deployed 2026-09-26)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `wyrd-api` → https://wyrd-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `wyrd-web` → https://wyrd-web.pages.dev | per-branch previews `<branch>.wyrd-web.pages.dev`; `/api/*` proxied to the worker |
| D1 | `wyrd-db` (`68b495d9-ab5a-4a84-b996-702dc4c2de0e`) | migrations via `wrangler d1 migrations apply`; `0000_init.sql` applied |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` | set 2026-09-26 with `scripts/setup-secrets.local.ps1 -GitHub` (same token as gigsy/feedme2) |
| Worker secrets | none | — |

## Open items
- Whether the worker should become the authoritative resolver for the browser POC now (it already logs `POST /api/duel/resolve` to `duel_log`) or only with M3 multiplayer.
- Playwright smoke suite for the web client (gigsy/feedme2 have one; the preview job currently uses curl).

## Gotchas
- `wrangler pages project create` (wrangler ≥ 4.14x) delegates to Pages-on-Workers and reads the nearest `wrangler.toml`; run it from `apps/web` with `--force` (the `-Provision` script does). `wrangler pages deploy` from `apps/web` still targets the classic project.

## Log
- 2026-09-26 — GitHub secrets set; `workflow_dispatch` run 36232457853 green across all tiers (worker deploy + web deploy from CI). Pipeline complete.
- 2026-09-26 — PR #6: pipeline scaffolded (`apps/api` worker with health/version/duel-resolve + `0000_init.sql`, Pages proxy function, worker + schema version tiers, `deploy.yml`, deploy/secrets scripts). CI test jobs green; preview deploy red (no secrets).
- 2026-09-26 — D1 `wyrd-db` and Pages `wyrd-web` provisioned; migrations applied; worker v0.0.1 and web v0.0.2 deployed from the workstation; `/api/version` live through the proxy.
- 2026-09-26 — playable browser duel POC merged; GitHub Pages deploy attempt failed (Pages not enabled).
