# wyrd — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves an open question.

## Phase
M0 grammar + playable browser duel POC on `main`. Cloudflare deployment pipeline (worker + D1 schema + Pages client, gigsy/feedme2 model) scaffolded on 2026-09-26 on branch `feature/cloudflare-deploy`; **not yet provisioned or deployed**. The earlier GitHub Pages deploy workflow was removed (it failed: Pages was never enabled on the repo) in favour of Cloudflare Pages.

## Live resources
| Thing | Name / URL | Status |
|---|---|---|
| Worker | `wyrd-api` → https://wyrd-api.atsyg-feedme.workers.dev | not provisioned; deployed by `.github/workflows/deploy.yml` on push to main once secrets exist |
| Pages | `wyrd-web` → https://wyrd-web.pages.dev | not provisioned; per-branch previews `<branch>.wyrd-web.pages.dev` |
| D1 | `wyrd-db` | not provisioned; id placeholder in `apps/api/wrangler.toml` |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` | not set; `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | none | — |

## Go-live checklist (one-time, from the workstation)
1. `pnpm install` (installs the pre-commit hook and wrangler).
2. `cp scripts/setup-secrets.ps1 scripts/setup-secrets.local.ps1`; fill in the Cloudflare token + account id.
3. `./scripts/setup-secrets.local.ps1 -Provision` → paste the D1 `database_id` into `apps/api/wrangler.toml`, commit.
4. `./scripts/setup-secrets.local.ps1 -GitHub`.
5. Merge to `main` (or `gh workflow run deploy.yml`) — the dispatch path deploys every tier regardless of the change filter.
6. Check https://wyrd-web.pages.dev shows `web vX · worker vY · schema 0000_init.sql` in the footer; record the run id here.

## Open questions
- Whether the worker should become the authoritative resolver for the browser POC now (it already logs `POST /api/duel/resolve` to `duel_log`) or only with M3 multiplayer.
- Playwright smoke suite for the web client (gigsy/feedme2 have one; the preview job currently uses curl).

## Log
- 2026-09-26 — deployment pipeline scaffolded: `apps/api` worker (health, version, duel/resolve) + `0000_init.sql`, Pages proxy function, worker + schema version tiers, `deploy.yml`, deploy/secrets scripts. Awaiting provisioning + secrets.
- 2026-09-26 — playable browser duel POC merged; GitHub Pages deploy attempt failed (Pages not enabled).
