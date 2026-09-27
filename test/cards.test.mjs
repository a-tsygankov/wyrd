import assert from "node:assert/strict";
import test from "node:test";
import { glyphs } from "../dist/packages/wyrd-content/src/glyphs.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { parseSpell } from "../dist/packages/wyrd-grammar/src/parser.js";
import { projectTelegraph } from "../dist/packages/wyrd-simulation/src/telegraph.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { FAMILY_OF, iconFor, spellCards, telegraphCards } from "../dist/apps/web/src/cards.js";

// Telegraph cards (ideas doc A) and the lit spell sentence (G): the pure
// card models the client renders, tested without a DOM.

test("every registry glyph has an icon and a family; unknown tokens get the blank rune", () => {
    for (const glyph of glyphs) {
        const icon = iconFor(glyph.displayName);
        assert.ok(icon.startsWith("<") && icon.includes("</"), `${glyph.displayName} icon is markup`);
        assert.ok(FAMILY_OF[glyph.displayName], `${glyph.displayName} has a family`);
    }
    assert.equal(iconFor("NOPE"), iconFor("?"));
    assert.equal(FAMILY_OF.GATE, "target");
    assert.equal(FAMILY_OF.WARD, "action");
    assert.equal(FAMILY_OF.REFLECT, "reaction");
});

test("telegraph cards: shown glyphs are face-up, a family slot shows its edge, hidden slots are face-down", () => {
    const slots = projectTelegraph(["FIRE", "SEEK", "ENEMY", "AMPLIFY"], "high", createRng(1)); // FIRE SEEK ? ?
    const cards = telegraphCards(slots);
    assert.equal(cards.length, 4);
    assert.deepEqual(cards[0], { kind: "glyph", token: "FIRE", family: "essence", label: "FIRE" });
    assert.deepEqual(cards[1], { kind: "glyph", token: "SEEK", family: "action", label: "SEEK" });
    assert.deepEqual(cards[2], { kind: "hidden", family: undefined, label: "?" });
    const medium = telegraphCards([{ kind: "glyph", token: "SEEK" }, { kind: "family", family: "essence" }, { kind: "hidden" }]);
    assert.deepEqual(medium[1], { kind: "family", family: "essence", label: "essence" });
});

test("spell cards: lit when the sentence parses and is castable, the glyph at fault marked, modifiers as marks on the action", () => {
    const lit = spellCards(["FIRE", "SEEK", "ENEMY", "AMPLIFY"], parseSpell(["FIRE", "SEEK", "ENEMY", "AMPLIFY"]), true);
    assert.equal(lit.lit, true);
    assert.equal(lit.cards.length, 3, "the modifier rides on the action card");
    assert.deepEqual(lit.cards.map(c => c.token), ["FIRE", "SEEK", "ENEMY"]);
    assert.deepEqual(lit.cards[1].marks, ["AMPLIFY"]);
    assert.ok(lit.cards.every(c => !c.fault));

    const partial = spellCards(["FIRE", "SEEK"], parseSpell(["FIRE", "SEEK"]), false);
    assert.equal(partial.lit, false);
    assert.equal(partial.cards.filter(c => c.fault).length, 1, "the parser names SEEK as missing its target");
    assert.equal(partial.cards.find(c => c.fault).token, "SEEK");
    assert.match(partial.diagnostic ?? "", /target/);

    const orphan = spellCards(["SELF", "ENEMY", "SEEK"], parseSpell(["SELF", "ENEMY", "SEEK"]), false);
    assert.equal(orphan.cards.find(c => c.fault).token, "ENEMY");

    const misplaced = spellCards(["AMPLIFY", "SEEK", "ENEMY"], parseSpell(["AMPLIFY", "SEEK", "ENEMY"]), false);
    assert.equal(misplaced.cards.length, 3, "a modifier before the action stands alone, faulted");
    assert.equal(misplaced.cards[0].token, "AMPLIFY");
    assert.equal(misplaced.cards[0].fault, true);

    const empty = spellCards([], parseSpell([]), false);
    assert.equal(empty.cards.length, 0);
    assert.equal(empty.lit, false);

    // Castable is the client's word (Focus, resolver): a valid parse that is not castable is not lit.
    assert.equal(spellCards(["FIRE", "SEEK", "ENEMY"], parseSpell(["FIRE", "SEEK", "ENEMY"]), false).lit, false);
});

test("every tray glyph renders as a card without throwing", () => {
    for (const token of POC_TRAY) {
        const model = spellCards([token], parseSpell([token]), false);
        assert.equal(model.cards.length, 1);
        assert.ok(iconFor(token).length > 10);
    }
});
