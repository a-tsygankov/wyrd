#!/usr/bin/env python3
from __future__ import annotations
import json, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import bump_versions as bv
import version_rules as vr

VERSION_FILES=["packages/wyrd-grammar/package.json","packages/wyrd-content/package.json","packages/wyrd-resolver/package.json","apps/duel-sim/package.json","apps/web/package.json","apps/api/package.json"]
SOURCE_FILES=["packages/wyrd-grammar/src/parser.ts","packages/wyrd-content/src/glyphs.ts","packages/wyrd-resolver/src/index.ts","apps/duel-sim/src/index.ts","apps/web/src/main.ts","apps/api/src/index.ts","apps/api/migrations/0000_init.sql"]
ALL_TIERS=["grammar","content","resolver","duel-sim","web","worker"]

def git(repo,*args):
    return subprocess.check_output(["git","-C",str(repo),*args],text=True,stderr=subprocess.PIPE)

def write(repo,rel,content):
    p=repo/rel; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(content.encode())

def pkg(v): return json.dumps({"name":"x","version":v},indent=2)+"\n"

class Rules(unittest.TestCase):
    def tier(self,name): return next(t for t in vr.TIERS if t.name==name)
    def matching(self,p): return [t.name for t in vr.TIERS if t.matches(p)]
    def test_docs_exempt(self):
        self.assertTrue(vr.is_doc_file("packages/wyrd-grammar/README.md"))
        self.assertTrue(vr.is_doc_file("handoff.md"))
        self.assertEqual(self.matching("apps/api/README.md"),[])
    def test_dependency_cascade(self):
        self.assertEqual(self.matching("packages/wyrd-grammar/src/parser.ts"),ALL_TIERS)
        self.assertEqual(self.matching("packages/wyrd-content/src/glyphs.ts"),["content","resolver","duel-sim","web","worker"])
        self.assertEqual(self.matching("packages/wyrd-resolver/src/resolver.ts"),["resolver","duel-sim","web","worker"])
        self.assertEqual(self.matching("apps/duel-sim/src/index.ts"),["duel-sim"])
        self.assertEqual(self.matching("apps/web/src/main.ts"),["web"])
        self.assertEqual(self.matching("apps/web/functions/api/[[path]].ts"),["web"])
    def test_worker_tier(self):
        self.assertEqual(self.matching("apps/api/src/index.ts"),["worker"])
        self.assertEqual(self.matching("apps/api/wrangler.toml"),["worker"])
    def test_migrations_are_schema_not_worker(self):
        self.assertEqual(self.matching("apps/api/migrations/0001_next.sql"),[])
        self.assertTrue("apps/api/migrations/0001_next.sql".startswith(vr.SCHEMA_DIR))
    def test_patch(self): self.assertEqual(vr.bump_patch("0.0.9"),"0.0.10")

class Bumper(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.repo=Path(self.tmp.name)
        git(self.repo,"init","-b","main"); git(self.repo,"config","user.email","t@example.com"); git(self.repo,"config","user.name","t")
        for rel in VERSION_FILES: write(self.repo,rel,pkg("0.0.1"))
        for rel in SOURCE_FILES: write(self.repo,rel,"export {}\n")
        git(self.repo,"add","-A"); git(self.repo,"commit","-m","base")
    def tearDown(self): self.tmp.cleanup()
    def version(self,rel): return json.loads(git(self.repo,"show",f":{rel}"))["version"]
    def stage(self,rel,content="export const x=1\n"):
        write(self.repo,rel,content); git(self.repo,"add",rel)
    def test_grammar_change_bumps_all_downstream(self):
        self.stage("packages/wyrd-grammar/src/parser.ts")
        self.assertEqual(bv.run(self.repo),ALL_TIERS)
        for rel in VERSION_FILES: self.assertEqual(self.version(rel),"0.0.2")
    def test_duel_change_only_bumps_duel(self):
        self.stage("apps/duel-sim/src/index.ts")
        self.assertEqual(bv.run(self.repo),["duel-sim"])
        self.assertEqual(self.version("apps/duel-sim/package.json"),"0.0.2")
    def test_web_change_only_bumps_web(self):
        self.stage("apps/web/src/main.ts")
        self.assertEqual(bv.run(self.repo),["web"])
        self.assertEqual(self.version("apps/web/package.json"),"0.0.2")
    def test_worker_change_only_bumps_worker(self):
        self.stage("apps/api/src/index.ts")
        self.assertEqual(bv.run(self.repo),["worker"])
        self.assertEqual(self.version("apps/api/package.json"),"0.0.2")
        self.assertEqual(self.version("apps/web/package.json"),"0.0.1")
    def test_new_migration_bumps_nothing(self):
        self.stage("apps/api/migrations/0001_next.sql","SELECT 2;\n")
        self.assertEqual(bv.run(self.repo),[])
        self.assertEqual(self.version("apps/api/package.json"),"0.0.1")
    def test_preserves_unstaged_edits(self):
        # An unstaged edit to a version file must survive the bump: the index
        # is rebuilt from the staged blob, the worktree only has its version
        # field rewritten.
        self.stage("apps/api/src/index.ts")
        path=self.repo/"apps/api/package.json"
        path.write_bytes(json.dumps({"name":"x","version":"0.0.1","scripts":{"dev":"wrangler dev"}},indent=2).encode()+b"\n")
        self.assertEqual(bv.run(self.repo),["worker"])
        self.assertEqual(self.version("apps/api/package.json"),"0.0.2")
        wt=json.loads(path.read_bytes())
        self.assertEqual(wt["version"],"0.0.2")
        self.assertEqual(wt["scripts"],{"dev":"wrangler dev"})

if __name__=="__main__": unittest.main()
