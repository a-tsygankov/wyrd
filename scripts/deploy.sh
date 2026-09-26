#!/usr/bin/env bash
# Workstation deploy helper. CI handles main-branch deploys
# (.github/workflows/deploy.yml); this is for one-offs and the first
# deploy. Needs `wrangler login` (or CLOUDFLARE_API_TOKEN +
# CLOUDFLARE_ACCOUNT_ID in the environment) and `pnpm install`.
#
# Usage:
#   ./scripts/deploy.sh --api     # D1 migrations + wrangler deploy
#   ./scripts/deploy.sh --web     # build + wrangler pages deploy
#   ./scripts/deploy.sh --all
set -euo pipefail
cd "$(dirname "$0")/.."

do_api=0; do_web=0
[[ $# -eq 0 ]] && { echo "usage: $0 [--api] [--web] [--all]"; exit 1; }
for arg in "$@"; do
  case "$arg" in
    --api) do_api=1 ;;
    --web) do_web=1 ;;
    --all) do_api=1; do_web=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ $do_api -eq 1 ]]; then
  echo "-- api --"
  pnpm --filter @wyrd/api db:migrate:remote
  pnpm --filter @wyrd/api run deploy
fi
if [[ $do_web -eq 1 ]]; then
  echo "-- web --"
  pnpm build:web
  pnpm --filter @wyrd/web run deploy
fi
