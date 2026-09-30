import assert from "node:assert/strict";
import test from "node:test";
import { glossary, glossaryFor, glossaryGroupsFor, GLOSSARY_GROUPS } from "../dist/packages/wyrd-content/src/glossary.js";
import { glyphs } from "../dist/packages/wyrd-content/src/glyphs.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";

// The in-app Help section: every glyph, every reaction, every term the
// interface uses and every control, explained from content, rule-aware.

test("the glossary groups cover glyphs, reactions, terms, controls and the arcade games", () => {
    assert.deepEqual(GLOSSARY_GROUPS.map(g => g.id), ["glyphs", "reactions", "terms", "controls", "arcade"]);
    for (const group of GLOSSARY_GROUPS) assert.ok(group.title.length > 2 && group.intro.length > 20, group.id);
});

test("every registry glyph appears once in the glyph group, castable ones first, pending ones marked", () => {
    const entries = glossary.filter(e => e.group === "glyphs");
    assert.equal(entries.length, glyphs.filter(g => !["reflect", "silence", "null", "spell"].includes(g.id)).length);
    for (const glyph of glyphs) {
        const inGlyphs = entries.find(e => e.term === glyph.displayName);
        const inReactions = glossary.find(e => e.group === "reactions" && e.term === glyph.displayName);
        assert.ok(inGlyphs || inReactions, `${glyph.displayName} missing from the glossary`);
    }
    const firstPending = entries.findIndex(e => e.pending);
    const lastCastable = entries.map(e => !e.pending).lastIndexOf(true);
    assert.ok(firstPending === -1 || lastCastable < firstPending, "castable glyphs come before pending ones");
    assert.ok(entries.find(e => e.term === "PUSH").pending);
    assert.ok(!entries.find(e => e.term === "SEEK").pending);
});

test("terms the interface shows are all explained", () => {
    const terms = glossary.filter(e => e.group === "terms").map(e => e.term);
    for (const term of ["Focus", "Seal", "Telegraph", "Reaction window", "Scry", "Ward", "Integrity", "Gate", "Bound", "Resolve", "Faltering", "Exposed", "Ignite", "Quick cast", "Magnitude", "Seed", "Hot-seat", "Opponent personality", "Initiative"]) {
        assert.ok(terms.includes(term), `${term} not explained`);
    }
    for (const entry of glossary) assert.ok(entry.text.length > 25, `${entry.term} is too short`);
});

test("controls explain what every button does", () => {
    const controls = glossary.filter(e => e.group === "controls").map(e => e.term);
    for (const control of ["Cast", "Undo", "Clear", "Next round", "Rematch", "Settings", "Stats", "Help", "Hot-seat"]) assert.ok(controls.includes(control), control);
});

test("glossaryFor adds the ruleset's lines: prices under Teeth, hit points under Resolve", () => {
    const classic = glossaryFor(rulesets.classic.rules);
    const teeth = glossaryFor(rulesets.teeth.rules);
    const find = (list, term) => list.find(e => e.term === term).text;
    assert.match(find(teeth, "NULL"), /Costs 3 Focus under these rules/);
    assert.match(find(classic, "NULL"), /Free under these rules/);
    assert.ok(!/Costs 3 Focus under these rules/.test(find(classic, "NULL")));
    assert.match(find(teeth, "WARD"), /Integrity 2/);
    assert.match(find(glossaryFor(rulesets.resolve.rules), "SEEK"), /Resolve/);
    assert.equal(classic.length, glossary.length);
});

test("the arcade group explains both games, their rules and every arcade button and gesture", () => {
    const arcade = glossary.filter(e => e.group === "arcade").map(e => e.term);
    for (const term of ["Volley", "Quickdraw", "Wheel", "Hearts", "Arcade Focus", "Serve", "Speed", "Return window", "Quench", "Kindle", "Weak return", "Ward (Volley)", "Smash", "Quick draw", "Charge", "Ward (Quickdraw)", "Clash", "Start", "Colour pads", "Gestures", "Play again", "Reset (arcade)", "Fullscreen"]) {
        assert.ok(arcade.includes(term), `${term} missing from the arcade group`);
    }
    // Moved, not copied: the word duel's terms no longer carry the arcade lines.
    const terms = glossary.filter(e => e.group === "terms").map(e => e.term);
    for (const term of ["Volley", "Quickdraw", "Wheel", "Return window", "Ward (Volley)", "Smash"]) assert.ok(!terms.includes(term), `${term} still under terms`);
    assert.match(glossary.find(e => e.term === "Wheel").text, /water quenches fire/);
});

test("Beam clash has its own arcade topics: the beat, the knot, the switch, its ward and its clock", () => {
    const arcade = glossary.filter(e => e.group === "arcade").map(e => e.term);
    for (const term of ["Beam clash", "Beat", "Knot", "Push", "Switch", "Ward (Beam clash)", "Seals (Beam clash)", "Time (Beam clash)"]) {
        assert.ok(arcade.includes(term), `${term} missing from the arcade group`);
    }
    assert.match(glossary.find(e => e.term === "Beam clash").text, /beat/);
});

test("Gate tug has its own arcade topics: the rail, the temper, the comeback, its ward and its round limit", () => {
    const arcade = glossary.filter(e => e.group === "arcade").map(e => e.term);
    for (const term of ["Gate tug", "Rail", "Temper", "Comeback", "Ward (Gate tug)", "Round limit"]) {
        assert.ok(arcade.includes(term), `${term} missing from the arcade group`);
    }
    assert.match(glossary.find(e => e.term === "Temper").text, /beat or match/);
});

test("the update banner is explained among the controls", () => {
    const update = glossary.find(e => e.group === "controls" && e.term === "Update banner");
    assert.ok(update);
    assert.match(update.text, /Reload/);
});

test("Help leads with the game being played: arcade first in the arcade, last in the word duel", () => {
    assert.deepEqual(glossaryGroupsFor("arcade").map(g => g.id), ["arcade", "glyphs", "reactions", "terms", "controls"]);
    assert.deepEqual(glossaryGroupsFor("word").map(g => g.id), ["glyphs", "reactions", "terms", "controls", "arcade"]);
});
