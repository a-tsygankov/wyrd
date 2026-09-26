#!/usr/bin/env python3
"""Single source of truth for tier/versioning rules.

Consumed by:
  bump_versions.py       - pre-commit auto-bump (writes versions)
  check_version_bump.py  - CI gate (verifies versions)

Tiers and their version sources (all package.json `.version`):
  grammar   packages/wyrd-grammar/package.json
  content   packages/wyrd-content/package.json   (+ grammar)
  resolver    packages/wyrd-resolver/package.json    (+ content, grammar)
  simulation  packages/wyrd-simulation/package.json  (+ resolver chain)
  duel-sim    apps/duel-sim/package.json             (+ simulation chain)
  web         apps/web/package.json                  (+ simulation chain)
  worker      apps/api/package.json                  (+ resolver chain; no bot)
  schema    apps/api/migrations/   the numbered .sql filename IS the
                                   version - no file to bump, so it has
                                   no Tier entry; check_version_bump.py
                                   special-cases it via SCHEMA_DIR.

A change in a package cascades to everything bundled on top of it: the
web client and the worker both ship the grammar/content/resolver
sources, so a grammar edit bumps all six package tiers. Doc-only
changes bump nothing.
"""
from __future__ import annotations
import json, re
from dataclasses import dataclass, field
from typing import Callable, Optional

DOC_SUFFIXES = (".md", ".txt")
DOC_PATHS = ("README.md", "AGENTS.md", "CLAUDE.md", "handoff.md", "docs/")

SCHEMA_DIR = "apps/api/migrations/"

def is_doc_file(path: str) -> bool:
    return path.endswith(DOC_SUFFIXES) or any(path == p or path.startswith(p) for p in DOC_PATHS)

def _source(path: str, prefix: str) -> bool:
    return path.startswith(prefix) and not is_doc_file(path)

def _grammar(p: str) -> bool:
    return _source(p, "packages/wyrd-grammar/")

def _content(p: str) -> bool:
    return _grammar(p) or _source(p, "packages/wyrd-content/")

def _resolver(p: str) -> bool:
    return _content(p) or _source(p, "packages/wyrd-resolver/")

def _simulation(p: str) -> bool:
    return _resolver(p) or _source(p, "packages/wyrd-simulation/")

def _duel_sim(p: str) -> bool:
    return _simulation(p) or _source(p, "apps/duel-sim/")

def _web(p: str) -> bool:
    return _simulation(p) or _source(p, "apps/web/")

def _worker(p: str) -> bool:
    # Migrations are the schema tier, not the worker: a new numbered
    # .sql file is its own version bump and the worker code is untouched.
    return _resolver(p) or (_source(p, "apps/api/") and not p.startswith(SCHEMA_DIR))

def read_package_json_version(content: str) -> Optional[str]:
    try:
        return str(json.loads(content)["version"])
    except (KeyError, json.JSONDecodeError):
        return None

def write_package_json_version(content: str, new_version: str) -> str:
    replaced = re.sub(r'("version"\s*:\s*")[^"]+(")', rf"\g<1>{new_version}\g<2>", content, count=1)
    if read_package_json_version(replaced) != new_version:
        raise RuntimeError("failed to rewrite package.json version field")
    return replaced

@dataclass(frozen=True)
class Tier:
    name: str
    version_file: str
    read: Callable[[str], Optional[str]] = field(repr=False)
    write: Callable[[str, str], str] = field(repr=False)
    _matches: Callable[[str], bool] = field(repr=False)
    def matches(self, path: str) -> bool:
        return self._matches(path)

TIERS = [
    Tier("grammar", "packages/wyrd-grammar/package.json", read_package_json_version, write_package_json_version, _grammar),
    Tier("content", "packages/wyrd-content/package.json", read_package_json_version, write_package_json_version, _content),
    Tier("resolver", "packages/wyrd-resolver/package.json", read_package_json_version, write_package_json_version, _resolver),
    Tier("simulation", "packages/wyrd-simulation/package.json", read_package_json_version, write_package_json_version, _simulation),
    Tier("duel-sim", "apps/duel-sim/package.json", read_package_json_version, write_package_json_version, _duel_sim),
    Tier("web", "apps/web/package.json", read_package_json_version, write_package_json_version, _web),
    Tier("worker", "apps/api/package.json", read_package_json_version, write_package_json_version, _worker),
]

def bump_patch(v: str) -> str:
    parts=v.split(".")
    if len(parts)==3 and all(p.isdigit() for p in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2])+1}"
    return f"{v}.1"
