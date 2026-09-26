#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
SCRIPT=Path(__file__).parent/"check_version_bump.py"
VERSION_FILES=["packages/wyrd-grammar/package.json","packages/wyrd-content/package.json","packages/wyrd-resolver/package.json","apps/duel-sim/package.json","apps/web/package.json","apps/api/package.json"]
def git(repo,*args): return subprocess.check_output(["git","-C",str(repo),*args],text=True,stderr=subprocess.PIPE)
def write(repo,rel,content):
    p=repo/rel; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(content,encoding="utf-8")
def pkg(v): return json.dumps({"name":"x","version":v},indent=2)+"\n"
def run_check(repo):
    env=dict(os.environ,BASE_REF="refs/heads/main")
    return subprocess.run([sys.executable,str(SCRIPT)],cwd=repo,env=env,capture_output=True,text=True).returncode
class Gate(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.repo=Path(self.tmp.name)
        git(self.repo,"init","-b","main"); git(self.repo,"config","user.email","t@example.com"); git(self.repo,"config","user.name","t")
        for rel in VERSION_FILES: write(self.repo,rel,pkg("0.0.1"))
        write(self.repo,"packages/wyrd-grammar/src/parser.ts","export {}\n")
        write(self.repo,"apps/api/src/index.ts","export {}\n")
        write(self.repo,"apps/api/migrations/0000_init.sql","SELECT 1;\n")
        git(self.repo,"add","-A"); git(self.repo,"commit","-m","base"); git(self.repo,"checkout","-b","feat")
    def tearDown(self): self.tmp.cleanup()
    def commit(self): git(self.repo,"add","-A"); git(self.repo,"commit","-m","wip")
    def bump_all(self):
        for rel in VERSION_FILES: write(self.repo,rel,pkg("0.0.2"))
    def test_fails_on_missing_cascade_bump(self):
        write(self.repo,"packages/wyrd-grammar/src/parser.ts","export const x=1\n"); self.commit(); self.assertEqual(run_check(self.repo),1)
    def test_passes_when_all_affected_bumped(self):
        write(self.repo,"packages/wyrd-grammar/src/parser.ts","export const x=1\n"); self.bump_all()
        self.commit(); self.assertEqual(run_check(self.repo),0)
    def test_fails_when_worker_changed_without_bump(self):
        write(self.repo,"apps/api/src/index.ts","export const x=1\n"); self.commit(); self.assertEqual(run_check(self.repo),1)
    def test_passes_when_worker_bumped(self):
        write(self.repo,"apps/api/src/index.ts","export const x=1\n"); write(self.repo,"apps/api/package.json",pkg("0.0.2"))
        self.commit(); self.assertEqual(run_check(self.repo),0)
    def test_fails_when_migration_edited_in_place(self):
        write(self.repo,"apps/api/migrations/0000_init.sql","SELECT 2;\n"); self.commit(); self.assertEqual(run_check(self.repo),1)
    def test_passes_when_new_migration_added(self):
        # A new migration is the schema bump; it must NOT require a worker bump.
        write(self.repo,"apps/api/migrations/0001_more.sql","SELECT 2;\n"); self.commit(); self.assertEqual(run_check(self.repo),0)
    def test_docs_only_exempt(self):
        write(self.repo,"docs/notes.md","# notes\n"); write(self.repo,"handoff.md","# state\n"); self.commit(); self.assertEqual(run_check(self.repo),0)
if __name__=="__main__": unittest.main()
