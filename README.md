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

Design options for the next duel iteration: `docs/duel-engagement-options.md`. Icons: `node apps/web/scripts/generate-icons.mjs` regenerates `apps/web/icons/` (committed). Phone playtest: `docs/playtest-checklist.md`.

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it.

## Rulesets, settings and stats

**Settings** (header) picks one of four rulesets, each building on the last (`packages/wyrd-content/src/rulesets.ts`, rules in `packages/wyrd-resolver`): **Classic** (the original POC), **Teeth** (wards have integrity 2 and shatter; reactions cost Focus - SILENCE 1, REFLECT 2, NULL 3 - from the same 7 you compose with; ending at 0 exposes an extra telegraph glyph; the same essence twice ignites for +1 magnitude), **Pulse** (Teeth plus an 8-second reaction window and a 5-second quick cast worth +1 magnitude) and **Resolve** (Pulse plus 10 hit points: SEEK deals its magnitude, BIND taxes the next spell, faltering at 3 or less; win by 3 seals or by emptying Resolve). Timers and telemetry have switches too; `?rules=`, `?timers=off`, `?telemetry=off` override for one visit. Changing rules resets the match.

**Stats** (header) shows this device's games per ruleset (matches, win rate, seal rate, average time to commit, top reaction, rematches, streak) from local storage, and everyone's numbers from `GET /api/telemetry/summary` (per ruleset and mode, per scenario).

## Hot-seat

Tap **Hot-seat** in the header (or open `?mode=hotseat`) for two players on one phone: Player 2 composes in secret and locks in, the phone is passed, Player 1 reads the telegraph, reacts and casts, the phone is passed back, Player 2 reacts, both see the resolution. The hand-off overlay hides the board between turns. State machine in `apps/web/src/hotseat.ts`.

## Admin mode

Triple-tap the title block ("WYRD • DUEL POC / Read the spell…") or open the site with `?admin=1`. The console shows the hidden opponent spell, the reaction policy, wards, versions and session id; the best reaction to the incoming spell and the best spells to cast now, ranked by the resolver itself with its own step texts as the explanation (`packages/wyrd-simulation/src/advisor.ts`); and the client log (`apps/web/src/log.ts`). Debug tooling for playtests: it spoils the round.

## Telemetry

The client posts anonymous round/rematch/match-end events to `POST /api/telemetry` (no account, IP or user agent; a random session UUID in local storage). `GET /api/telemetry/summary` aggregates them per scenario for playtest review. Add `?telemetry=off` to the URL to opt out.

## Versioning and deployment

Same model as gigsy and feedme2. Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches (`scripts/version_rules.py`; a package change cascades to everything bundled on top of it). PRs are gated by `.github/workflows/version-check.yml`. A schema change is a **new** numbered file in `apps/api/migrations/`; never edit one in place.

Push to `main` runs `.github/workflows/deploy.yml`: tests, then D1 migrations + Worker deploy, then the Pages deploy. PRs get a per-branch Pages preview with a smoke check. One-time provisioning and secrets: `scripts/README.md`.

The prototype intentionally contains no map, inventory, or multiplayer code yet.
