#!/usr/bin/env python3
"""CI gate: verify every tier touched by this PR bumped its version.

Runs as the `version-check` GitHub Actions job. Local invocation:

    BASE_REF=main python3 scripts/check_version_bump.py

(a bare BASE_REF like "main" is resolved as origin/main.)

Tier definitions live in version_rules.py (shared with the pre-commit
auto-bumper, scripts/bump_versions.py - with the hook installed this
check should never fire; it is the backstop for commits made without
hooks, e.g. via the GitHub web UI).

The schema tier is the one without a version file: apps/api/migrations/
may only ever GAIN a new numbered .sql file. Editing one in place would
skip wrangler's d1_migrations tracker and never apply in production.

Pure-doc PRs (README, handoff, *.md, docs/) are exempt.
"""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path
from typing import Optional
sys.path.insert(0, str(Path(__file__).parent))
from version_rules import SCHEMA_DIR, TIERS, bump_patch, is_doc_file

def sh(cmd):
    return subprocess.check_output(cmd,text=True,stderr=subprocess.PIPE)

def show_at(path, ref):
    try: return sh(["git","show",f"{ref}:{path}"])
    except subprocess.CalledProcessError: return None

def _lines(out: str) -> list[str]:
    return [x.strip() for x in out.splitlines() if x.strip()]

def check_schema(touched: list[str], added: list[str]) -> Optional[str]:
    """Error message if the migrations dir was touched without a NEW
    migration file (schema "version" = newest numbered migration)."""
    touched_migrations=[p for p in touched if p.startswith(SCHEMA_DIR) and not is_doc_file(p)]
    if not touched_migrations: return None
    if any(p.startswith(SCHEMA_DIR) and p.endswith(".sql") for p in added): return None
    return (f"{SCHEMA_DIR} touched without a new migration .sql file. Schema changes need a new "
            "numbered migration; edit-in-place would skip wrangler's d1_migrations tracker and "
            "fail to apply in production.")

def main() -> int:
    base_ref=os.environ.get("BASE_REF","origin/main")
    if "/" not in base_ref: base_ref=f"origin/{base_ref}"
    try:
        files=_lines(sh(["git","diff","--name-only",f"{base_ref}...HEAD"]))
        added=_lines(sh(["git","diff","--name-only","--diff-filter=A",f"{base_ref}...HEAD"]))
    except subprocess.CalledProcessError as e:
        print(f"::error::git diff failed: {e.stderr}",file=sys.stderr); return 2
    if not files:
        print("No files changed - nothing to check."); return 0
    errors=[]
    for tier in TIERS:
        touched=[p for p in files if tier.matches(p)]
        if not touched: continue
        head=show_at(tier.version_file,"HEAD"); base=show_at(tier.version_file,base_ref)
        if head is None:
            errors.append((tier.name,f"{tier.version_file} not found at HEAD")); continue
        if base is None: continue  # version file is new in this PR: a bump by definition
        hv,bv=tier.read(head),tier.read(base)
        if hv is None or bv is None:
            errors.append((tier.name,f"could not parse version from {tier.version_file}"))
        elif hv==bv:
            sample=", ".join(touched[:3])
            errors.append((tier.name,f"{tier.version_file} version unchanged ({hv}); touched {sample}. Bump patch (e.g. {hv} -> {bump_patch(hv)}), or install the auto-bump hook with pnpm install."))
    schema_err=check_schema(files,added)
    if schema_err: errors.append(("schema",schema_err))
    if errors:
        for name,msg in errors:
            print(f"::error title=Missing version bump ({name})::{msg}",file=sys.stderr)
        return 1
    print("All touched tiers bumped their version."); return 0

if __name__=="__main__": sys.exit(main())
