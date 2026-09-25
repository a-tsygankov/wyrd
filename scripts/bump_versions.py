#!/usr/bin/env python3
from __future__ import annotations
import subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from version_rules import TIERS, Tier, bump_patch

def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git","-C",str(repo),*args], stderr=subprocess.PIPE).decode("utf-8")

def _git_stdin(repo: Path, payload: bytes, *args: str) -> str:
    return subprocess.run(["git","-C",str(repo),*args], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout.decode("utf-8")

def _show(repo: Path, spec: str):
    try: return _git(repo,"show",spec)
    except subprocess.CalledProcessError: return None

def _stage_blob(repo: Path, rel: str, content: str) -> None:
    stage=_git(repo,"ls-files","--stage","--",rel).strip()
    if not stage: raise RuntimeError(f"{rel} is not in the index")
    mode=stage.split()[0]
    sha=_git_stdin(repo,content.encode("utf-8"),"hash-object","-w","--no-filters","--stdin").strip()
    _git(repo,"update-index","--add","--cacheinfo",f"{mode},{sha},{rel}")

def _bump_worktree(repo: Path, tier: Tier, staged_v: str, new_v: str) -> None:
    path=repo/tier.version_file
    if not path.exists(): return
    content=path.read_bytes().decode("utf-8")
    if tier.read(content)!=staged_v:
        print(f"[bump_versions] {tier.version_file}: worktree version differs from staged; worktree left untouched.", file=sys.stderr)
        return
    path.write_bytes(tier.write(content,new_v).encode("utf-8"))

def run(repo: Path) -> list[str]:
    staged=[x.strip() for x in _git(repo,"diff","--cached","--name-only").splitlines() if x.strip()]
    bumped=[]
    for tier in TIERS:
        if not any(tier.matches(p) for p in staged): continue
        rel=tier.version_file
        staged_src=_show(repo,f":{rel}")
        head_src=_show(repo,f"HEAD:{rel}")
        staged_v=tier.read(staged_src) if staged_src is not None else None
        head_v=tier.read(head_src) if head_src is not None else None
        if staged_v is None:
            print(f"[bump_versions] {tier.name}: {rel} missing or unparsable in index; CI will flag it.", file=sys.stderr)
            continue
        if head_v is None or staged_v != head_v: continue
        new_v=bump_patch(staged_v)
        _stage_blob(repo,rel,tier.write(staged_src,new_v))
        _bump_worktree(repo,tier,staged_v,new_v)
        bumped.append(tier.name)
    return bumped

def main() -> int:
    repo=Path(subprocess.check_output(["git","rev-parse","--show-toplevel"],text=True).strip())
    for name in run(repo): print(f"[bump_versions] {name}: patch version bumped (staged)")
    return 0

if __name__=="__main__": sys.exit(main())
