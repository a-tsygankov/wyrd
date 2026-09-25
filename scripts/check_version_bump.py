#!/usr/bin/env python3
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from version_rules import TIERS, bump_patch

def sh(cmd):
    return subprocess.check_output(cmd,text=True,stderr=subprocess.PIPE)

def show_at(path, ref):
    try: return sh(["git","show",f"{ref}:{path}"])
    except subprocess.CalledProcessError: return None

def main() -> int:
    base_ref=os.environ.get("BASE_REF","origin/main")
    if "/" not in base_ref: base_ref=f"origin/{base_ref}"
    try:
        files=[x.strip() for x in sh(["git","diff","--name-only",f"{base_ref}...HEAD"]).splitlines() if x.strip()]
    except subprocess.CalledProcessError as e:
        print(f"::error::git diff failed: {e.stderr}",file=sys.stderr); return 2
    if not files:
        print("No files changed — nothing to check."); return 0
    errors=[]
    for tier in TIERS:
        touched=[p for p in files if tier.matches(p)]
        if not touched: continue
        head=show_at(tier.version_file,"HEAD"); base=show_at(tier.version_file,base_ref)
        if head is None:
            errors.append((tier.name,f"{tier.version_file} not found at HEAD")); continue
        if base is None: continue
        hv,bv=tier.read(head),tier.read(base)
        if hv is None or bv is None:
            errors.append((tier.name,f"could not parse version from {tier.version_file}"))
        elif hv==bv:
            sample=", ".join(touched[:3])
            errors.append((tier.name,f"{tier.version_file} version unchanged ({hv}); touched {sample}. Bump patch (e.g. {hv} -> {bump_patch(hv)}), or install the auto-bump hook with pnpm install."))
    if errors:
        for name,msg in errors:
            print(f"::error title=Missing version bump ({name})::{msg}",file=sys.stderr)
        return 1
    print("All touched tiers bumped their version."); return 0

if __name__=="__main__": sys.exit(main())
