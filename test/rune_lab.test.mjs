import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("rune lab ships with both prototype modes and five-rune vocabulary", () => {
    const html = readFileSync("apps/web/rune-lab.html", "utf8");
    const source = readFileSync("apps/web/src/runeLab.ts", "utf8");
    assert.match(html, /RUNE FENCING/);
    assert.match(html, /RUNE PARRY/);
    for (const rune of ["line", "arc", "circle", "triangle", "spiral"]) assert.match(source, new RegExp(rune));
});
