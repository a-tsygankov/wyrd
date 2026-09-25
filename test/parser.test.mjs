import assert from "node:assert/strict";
import test from "node:test";
import { parseSpell } from "../dist/packages/wyrd-grammar/src/parser.js";
import { glyphs } from "../dist/packages/wyrd-content/src/glyphs.js";

function ast(tokens) {
    const result = parseSpell(tokens);
    assert.equal(result.status, "valid", JSON.stringify(result.diagnostics));
    assert.ok(result.ast);
    return result.ast;
}

test("FIRE -> SEEK -> ENEMY", () => {
    assert.deepEqual(ast(["FIRE", "SEEK", "ENEMY"]), {
        kind: "operator",
        glyphId: "seek",
        outputType: "InstantEffect",
        arguments: {
            essence: { kind: "value", glyphId: "fire", outputType: "Essence" },
            target: { kind: "value", glyphId: "enemy", outputType: "EntityRef" }
        }
    });
});

test("SELF -> WARD -> SHADOW", () => {
    assert.deepEqual(ast(["SELF", "WARD", "SHADOW"]), {
        kind: "operator",
        glyphId: "ward",
        outputType: "PersistentEffect",
        arguments: {
            target: { kind: "value", glyphId: "self", outputType: "EntityRef" },
            filter: { kind: "value", glyphId: "shadow", outputType: "Essence" }
        }
    });
});

test("FIRE -> SEEK -> ENEMY -> AMPLIFY", () => {
    assert.deepEqual(ast(["FIRE", "SEEK", "ENEMY", "AMPLIFY"]), {
        kind: "modifier",
        glyphId: "amplify",
        outputType: "TransformEffect",
        child: {
            kind: "operator",
            glyphId: "seek",
            outputType: "InstantEffect",
            arguments: {
                essence: { kind: "value", glyphId: "fire", outputType: "Essence" },
                target: { kind: "value", glyphId: "enemy", outputType: "EntityRef" }
            }
        }
    });
});

test("SPELL -> REFLECT", () => {
    assert.deepEqual(ast(["SPELL", "REFLECT"]), {
        kind: "modifier",
        glyphId: "reflect",
        outputType: "ReactionEffect",
        child: { kind: "value", glyphId: "spell", outputType: "SpellRef" }
    });
});

test("GATE -> CLOSE -> ANCHOR", () => {
    assert.deepEqual(ast(["GATE", "CLOSE", "ANCHOR"]), {
        kind: "modifier",
        glyphId: "anchor",
        outputType: "TransformEffect",
        child: {
            kind: "operator",
            glyphId: "close",
            outputType: "InstantEffect",
            arguments: {
                boundary: { kind: "value", glyphId: "gate", outputType: "BoundaryRef" }
            }
        }
    });
});

test("unknown glyph is rejected", () => {
    const result = parseSpell(["FIRE", "FLUBBER", "ENEMY"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0]?.code, "UNKNOWN_GLYPH");
});

test("incomplete typed sequence is rejected", () => {
    const result = parseSpell(["FIRE", "ENEMY"]);
    assert.equal(result.status, "invalid");
});

test("parse result is deterministic", () => {
    const tokens = ["FIRE", "SEEK", "ENEMY", "AMPLIFY"];
    assert.deepEqual(parseSpell(tokens), parseSpell(tokens));
});

test("v0 registry contains exactly 30 glyphs", () => {
    assert.equal(glyphs.length, 30);
});

test("v0 glyph ids and display names are unique", () => {
    assert.equal(new Set(glyphs.map(g => g.id)).size, glyphs.length);
    assert.equal(new Set(glyphs.map(g => g.displayName)).size, glyphs.length);
});

for (const glyph of glyphs) {
    test(`glyph definition is structurally valid: ${glyph.displayName}`, () => {
        assert.ok(glyph.id.length > 0);
        assert.ok(glyph.displayName.length > 0);
        assert.ok(glyph.produces.length > 0);
        assert.ok(glyph.baseFocusCost >= 0);
        assert.ok(Number.isInteger(glyph.precedence));
        assert.ok(glyph.tags.length > 0);
    });
}

for (const [a,b] of [["open","close"],["push","pull"],["amplify","weaken"]]) {
    test(`${a.toUpperCase()} and ${b.toUpperCase()} are inverse mappings`, () => {
        const left=glyphs.find(g=>g.id===a);
        const right=glyphs.find(g=>g.id===b);
        assert.equal(left?.inverseOf,b);
        assert.equal(right?.inverseOf,a);
    });
}
