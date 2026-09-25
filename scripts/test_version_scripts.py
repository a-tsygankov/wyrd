#!/usr/bin/env python3
from __future__ import annotations
import json, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import bump_versions as bv
import version_rules as vr

def git(repo,*args):
    return subprocess.check_output(["git","-C",str(repo),*args],text=True,stderr=subprocess.PIPE)

def write(repo,rel,content):
    p=repo/rel; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(content.encode())

def pkg(v): return json.dumps({"name":"x","version":v},indent=2)+"\n"

class Rules(unittest.TestCase):
    def tier(self,name): return next(t for t in vr.TIERS if t.name==name)
    def test_docs_exempt(self): self.assertTrue(vr.is_doc_file("packages/wyrd-grammar/README.md"))
    def test_dependency_cascade(self):
        p="packages/wyrd-grammar/src/parser.ts"
        self.assertTrue(all(t.matches(p) for t in vr.TIERS))
        p="packages/wyrd-content/src/glyphs.ts"
        self.assertFalse(self.tier("grammar").matches(p))
        self.assertTrue(all(self.tier(n).matches(p) for n in ["content","resolver","duel-sim"]))
        p="apps/duel-sim/src/index.ts"
        self.assertFalse(self.tier("resolver").matches(p)); self.assertTrue(self.tier("duel-sim").matches(p))
    def test_patch(self): self.assertEqual(vr.bump_patch("0.0.9"),"0.0.10")

class Bumper(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.repo=Path(self.tmp.name)
        git(self.repo,"init","-b","main"); git(self.repo,"config","user.email","t@example.com"); git(self.repo,"config","user.name","t")
        self.versions=["packages/wyrd-grammar/package.json","packages/wyrd-content/package.json","packages/wyrd-resolver/package.json","apps/duel-sim/package.json"]
        for rel in self.versions: write(self.repo,rel,pkg("0.0.1"))
        for rel in ["packages/wyrd-grammar/src/parser.ts","packages/wyrd-content/src/glyphs.ts","packages/wyrd-resolver/src/index.ts","apps/duel-sim/src/index.ts"]: write(self.repo,rel,"export {}\n")
        git(self.repo,"add","-A"); git(self.repo,"commit","-m","base")
    def tearDown(self): self.tmp.cleanup()
    def version(self,rel): return json.loads(git(self.repo,"show",f":{rel}"))["version"]
    def test_grammar_change_bumps_all_downstream(self):
        write(self.repo,"packages/wyrd-grammar/src/parser.ts","export const x=1\n"); git(self.repo,"add","packages/wyrd-grammar/src/parser.ts")
        self.assertEqual(bv.run(self.repo),["grammar","content","resolver","duel-sim"])
        for rel in self.versions: self.assertEqual(self.version(rel),"0.0.2")
    def test_duel_change_only_bumps_duel(self):
        write(self.repo,"apps/duel-sim/src/index.ts","export const x=1\n"); git(self.repo,"add","apps/duel-sim/src/index.ts")
        self.assertEqual(bv.run(self.repo),["duel-sim"])
        self.assertEqual(self.version("apps/duel-sim/package.json"),"0.0.2")

if __name__=="__main__": unittest.main()
