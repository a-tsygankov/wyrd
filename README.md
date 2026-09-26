# Wyrd

Mobile-first magical-language, puzzle, and duel game prototype inspired by the idea of composable Wyrdmarks.

Current implementation focus: **M0 — grammar**, with a playable browser duel POC. Live state: `handoff.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `packages/wyrd-grammar` | semantic types, AST, parser, diagnostics | bundled into web + worker |
| `packages/wyrd-content` | v0 glyph registry, curated scenario deck | bundled into web + worker |
| `packages/wyrd-resolver` | deterministic resolver (M1) | bundled into web + worker |
| `packages/wyrd-simulation` | seeded RNG, legal-spell enumeration, heuristic bot, telegraph presets | bundled into web |
| `apps/duel-sim` | text-only duel simulator boundary (M2) | — |
| `apps/web` | static PWA duel POC + Pages Functions `/api/*` proxy | Cloudflare Pages `wyrd-web` |
| `apps/api` | Hono Worker `wyrd-api` on D1 `wyrd-db`; migrations in `apps/api/migrations/` | Cloudflare Workers |

## Development

```bash
pnpm install                      # also installs the pre-commit version-bump hook
pnpm check                        # typecheck + tests for every tier + version tooling
pnpm build:web                    # assemble apps/web/dist
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local
pnpm dev:api                      # wrangler dev on :8787
cd apps/web && pnpm exec wrangler pages dev dist --port 8788   # serve the built client + /api proxy
E2E_BASE_URL=http://127.0.0.1:8788 pnpm --filter @wyrd/web test:e2e   # Playwright, iPhone (WebKit) + Pixel (Chromium)
```

`pnpm --filter @wyrd/web exec playwright install webkit chromium` once, for the browsers. Without `E2E_BASE_URL` the suite runs read-only against production.

Icons: `node apps/web/scripts/generate-icons.mjs` regenerates `apps/web/icons/` (committed). Phone playtest: `docs/playtest-checklist.md`.

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it.

## Telemetry

The client posts anonymous round/rematch/match-end events to `POST /api/telemetry` (no account, IP or user agent; a random session UUID in local storage). `GET /api/telemetry/summary` aggregates them per scenario for playtest review. Add `?telemetry=off` to the URL to opt out.

## Versioning and deployment

Same model as gigsy and feedme2. Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches (`scripts/version_rules.py`; a package change cascades to everything bundled on top of it). PRs are gated by `.github/workflows/version-check.yml`. A schema change is a **new** numbered file in `apps/api/migrations/`; never edit one in place.

Push to `main` runs `.github/workflows/deploy.yml`: tests, then D1 migrations + Worker deploy, then the Pages deploy. PRs get a per-branch Pages preview with a smoke check. One-time provisioning and secrets: `scripts/README.md`.

The prototype intentionally contains no map, inventory, or multiplayer code yet.
