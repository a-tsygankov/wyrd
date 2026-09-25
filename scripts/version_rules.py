#!/usr/bin/env python3
from __future__ import annotations
import json, re
from dataclasses import dataclass, field
from typing import Callable, Optional

DOC_SUFFIXES = (".md", ".txt")
DOC_PATHS = ("README.md", "AGENTS.md", "CLAUDE.md", "handoff.md", "docs/")

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

def _duel_sim(p: str) -> bool:
    return _resolver(p) or _source(p, "apps/duel-sim/")

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
    Tier("duel-sim", "apps/duel-sim/package.json", read_package_json_version, write_package_json_version, _duel_sim),
]

def bump_patch(v: str) -> str:
    parts=v.split(".")
    if len(parts)==3 and all(p.isdigit() for p in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2])+1}"
    return f"{v}.1"
