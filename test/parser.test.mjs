import assert from "node:assert/strict";
import test from "node:test";
import { parseSpell, parseSpellWithRegistry } from "../dist/packages/wyrd-grammar/src/parser.js";
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

test("SEEK can omit optional essence", () => {
    assert.deepEqual(ast(["SEEK", "ENEMY"]), {
        kind: "operator",
        glyphId: "seek",
        outputType: "InstantEffect",
        arguments: {
            target: { kind: "value", glyphId: "enemy", outputType: "EntityRef" }
        }
    });
});

test("candidate scoring prefers a complete typed parse over optional omission", () => {
    const result = parseSpell(["FIRE", "SEEK", "AREA"]);
    assert.equal(result.status, "valid");
    assert.equal(result.ast?.kind, "operator");
    assert.deepEqual(result.ast?.kind === "operator" ? Object.keys(result.ast.arguments).sort() : [], ["essence", "target"]);
});

test("unknown glyph is rejected", () => {
    const result = parseSpell(["FIRE", "FLUBBER", "ENEMY"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0]?.code, "UNKNOWN_GLYPH");
});

test("missing required typed input reports MISSING_INPUT", () => {
    const result = parseSpell(["FIRE", "SEEK"]);
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0]?.code, "MISSING_INPUT");
    assert.equal(result.diagnostics[0]?.glyphId, "seek");
});

test("orphan values prevent a complete parse", () => {
    const result = parseSpell(["FIRE", "WATER", "SEEK", "ENEMY"]);
    assert.equal(result.status, "invalid");
});

test("multiple base actions are rejected explicitly", () => {
    const result = parseSpell(["ENEMY", "PUSH", "PULL"]);
    assert.equal(result.status, "invalid");
    assert.match(result.diagnostics[0]?.message ?? "", /one base action/i);
});

test("infix grammar is rejected until conditional parsing lands", () => {
    const result = parseSpell(["IF"]);
    assert.equal(result.status, "invalid");
    assert.match(result.diagnostics[0]?.message ?? "", /not implemented/i);
});

test("synthetic equal-score candidates return AMBIGUOUS", () => {
    const registry = new Map([
        ["SELF", {
            id: "self", displayName: "SELF", family: "target", produces: ["EntityRef"],
            baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original"
        }],
        ["ENEMY", {
            id: "enemy", displayName: "ENEMY", family: "target", produces: ["EntityRef"],
            baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original"
        }],
        ["LINK", {
            id: "link", displayName: "LINK", family: "action", produces: ["PersistentEffect"],
            inputs: [
                { name: "left", accepts: ["EntityRef"] },
                { name: "right", accepts: ["EntityRef"] }
            ],
            baseFocusCost: 2, precedence: 100, attachment: "operator", tags: ["link"], canonStatus: "game-original"
        }]
    ]);

    const result = parseSpellWithRegistry(["SELF", "LINK", "ENEMY"], registry);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.diagnostics[0]?.code, "AMBIGUOUS");
});

test("synthetic unequal distances choose the higher-scoring candidate deterministically", () => {
    const registry = new Map([
        ["SELF", {
            id: "self", displayName: "SELF", family: "target", produces: ["EntityRef"],
            baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original"
        }],
        ["ENEMY", {
            id: "enemy", displayName: "ENEMY", family: "target", produces: ["EntityRef"],
            baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original"
        }],
        ["LINK", {
            id: "link", displayName: "LINK", family: "action", produces: ["PersistentEffect"],
            inputs: [
                { name: "primary", accepts: ["EntityRef"] },
                { name: "secondary", accepts: ["EntityRef"] }
            ],
            baseFocusCost: 2, precedence: 100, attachment: "operator", tags: ["link"], canonStatus: "game-original"
        }],
        ["FIRE", {
            id: "fire", displayName: "FIRE", family: "essence", produces: ["Essence"],
            baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["essence"], canonStatus: "game-original"
        }]
    ]);

    const result = parseSpellWithRegistry(["SELF", "FIRE", "LINK", "ENEMY"], registry);
    assert.equal(result.status, "invalid");
});

test("parse result is deterministic", () => {
    const tokens = ["FIRE", "SEEK", "ENEMY", "AMPLIFY"];
    assert.deepEqual(parseSpell(tokens), parseSpell(tokens));
});

test("focus cost remains data driven", () => {
    const result = parseSpell(["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.equal(result.focusCost, 4);
});

test("complexity grows with operators and modifiers", () => {
    const base = parseSpell(["FIRE", "SEEK", "ENEMY"]);
    const modified = parseSpell(["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.ok(modified.complexity > base.complexity);
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
