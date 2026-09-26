# scripts/

Workstation helpers. CI auto-deploys on push to `main`
(see [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)); these are
for one-offs and one-time setup.

| Command | What it does |
| --- | --- |
| `./scripts/deploy.sh --api` / `deploy.ps1 -Api` | Apply D1 migrations + `wrangler deploy` |
| `./scripts/deploy.sh --web` / `deploy.ps1 -Web` | Build the static client + `wrangler pages deploy` |
| `./scripts/deploy.sh --all` / `deploy.ps1 -All` | api + web |
| `./scripts/setup-secrets.local.ps1 -Provision` | One-time: create D1 `wyrd-db` + Pages project `wyrd-web` (paste the D1 id into `apps/api/wrangler.toml`) |
| `./scripts/setup-secrets.local.ps1 -GitHub` | Set GitHub Actions secrets via `gh secret set` |
| `./scripts/setup-secrets.local.ps1 -Cloudflare` | Set Worker secrets via `wrangler secret put` (none declared yet) |
| `./scripts/setup-secrets.local.ps1 -All` | GitHub + Cloudflare secrets in one go |
| `BASE_REF=main python3 scripts/check_version_bump.py` | The version-check CI gate, runnable locally |
| `python3 scripts/bump_versions.py` | Auto-bump versions of staged tiers (runs as the pre-commit hook) |
| `python3 -m unittest discover -s scripts` | Version-tooling test suite (also runs in CI) |
| `node scripts/build_web.mjs` | Assemble `apps/web/dist` from the tsc output (use `pnpm build:web`) |

Tier classification is shared in `version_rules.py`; change rules
there and both the bumper and the CI gate follow.

## The bumper and your unstaged edits

`bump_versions.py` runs on every commit and rewrites the version field
of each touched tier's `package.json`. It leaves everything else alone:

* the **index** entry is rebuilt from the file's *staged* content via
  `git update-index`, not `git add`, which would drag unstaged edits
  into the commit;
* the **worktree** copy has only its version field edited in place, so
  unstaged edits and line endings survive byte-for-byte.

If the version field itself has an unstaged edit, the bumper refuses to
guess: it bumps the index, leaves the worktree file untouched and prints
a warning. `test_version_scripts.py` guards this.

The root `package.json` is not a tier version file; the bumper never
writes to it. A new file in `apps/api/migrations/` is the schema tier's
own bump and needs nothing else.

`setup-secrets.ps1` ships with placeholders. Copy it to
`setup-secrets.local.ps1` (gitignored), fill in the values there, and
run that copy. Never commit real secrets.
