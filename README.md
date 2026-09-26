# Wyrd

Mobile-first magical-language, puzzle, and duel game prototype inspired by the idea of composable Wyrdmarks.

Current implementation focus: **M0 — grammar**, with a playable browser duel POC. Live state: `handoff.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `packages/wyrd-grammar` | semantic types, AST, parser, diagnostics | bundled into web + worker |
| `packages/wyrd-content` | v0 glyph registry and data-first content | bundled into web + worker |
| `packages/wyrd-resolver` | deterministic resolver (M1) | bundled into web + worker |
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
```

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it.

## Versioning and deployment

Same model as gigsy and feedme2. Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches (`scripts/version_rules.py`; a package change cascades to everything bundled on top of it). PRs are gated by `.github/workflows/version-check.yml`. A schema change is a **new** numbered file in `apps/api/migrations/`; never edit one in place.

Push to `main` runs `.github/workflows/deploy.yml`: tests, then D1 migrations + Worker deploy, then the Pages deploy. PRs get a per-branch Pages preview with a smoke check. One-time provisioning and secrets: `scripts/README.md`.

The prototype intentionally contains no map, inventory, or multiplayer code yet.
