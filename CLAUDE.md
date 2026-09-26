# wyrd — agent rules

Live state: `handoff.md` (one page, update when a phase changes or a URL/resource is added). Layout and commands: `README.md`. Architecture: `docs/architecture.md`. Plan: `docs/poc-plan.md`. **Gameplay is a browser/PWA app on iPhone and Android; never propose a native or Unity client.**

## Layout
- `packages/` TypeScript sources (grammar, content, resolver) imported by relative path; no build step of their own. Root `tsconfig.json` compiles them plus `apps/web` and `apps/duel-sim` into `dist/`.
- `apps/web/` static PWA (no framework, no bundler). `scripts/build_web.mjs` assembles `apps/web/dist`; `functions/api/[[path]].ts` proxies `/api/*` to the worker so the client stays single-origin.
- `apps/api/` Hono Worker `wyrd-api` on D1 `wyrd-db`, own `tsconfig.json` (workers types) and vitest workers pool. Migrations are hand-written numbered SQL in `apps/api/migrations/`; never edit one in place, add a new one.

## Versioning
Six package tiers (grammar, content, resolver, duel-sim, web, worker) auto-bumped by `.githooks/pre-commit` (`scripts/bump_versions.py`) and enforced on PRs by `scripts/check_version_bump.py`; a package change cascades to every tier bundling it. Schema tier = a new file in `apps/api/migrations/`. Doc-only changes bump nothing. Rules in `scripts/version_rules.py`, tests next to them.

## Rules
- TDD: failing test first, then the minimal code. Comments explain *why*.
- Integers only in D1 (epoch-ms). UUID text primary keys.
- Never print secret values. `scripts/setup-secrets.ps1` is committed with placeholders; the real copy is `scripts/setup-secrets.local.ps1` (gitignored).
- Cloudflare account: the one whose workers.dev subdomain is `atsyg-feedme` (shared with gigsy and feedme2). Names: `wyrd-api`, `wyrd-web`, `wyrd-db`.
- CI (`.github/workflows/deploy.yml`) is the deploy path; `scripts/deploy.*` are for one-offs.
- Commit messages: lowercase conventional style with scope (`feat(api): …`), ending with the Co-Authored-By line from the session reminder.
