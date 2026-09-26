import type { GlyphDefinition } from "../../wyrd-grammar/src/types.js";

export const glyphs: GlyphDefinition[] = [
    { id: "fire", displayName: "FIRE", family: "essence", produces: ["Essence"], baseFocusCost: 1, precedence: 10, attachment: "value", tags: ["essence", "fire"], canonStatus: "canon-inspired" },
    { id: "water", displayName: "WATER", family: "essence", produces: ["Essence"], baseFocusCost: 1, precedence: 10, attachment: "value", tags: ["essence", "water"], canonStatus: "canon-inspired" },
    { id: "shadow", displayName: "SHADOW", family: "essence", produces: ["Essence"], baseFocusCost: 1, precedence: 10, attachment: "value", tags: ["essence", "shadow"], canonStatus: "canon-inspired" },
    { id: "force", displayName: "FORCE", family: "essence", produces: ["Essence"], baseFocusCost: 1, precedence: 10, attachment: "value", tags: ["essence", "force"], canonStatus: "game-original" },
    { id: "life", displayName: "LIFE", family: "essence", produces: ["Essence"], baseFocusCost: 1, precedence: 10, attachment: "value", tags: ["essence", "life"], canonStatus: "canon-inspired" },

    { id: "self", displayName: "SELF", family: "target", produces: ["EntityRef"], baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original" },
    { id: "enemy", displayName: "ENEMY", family: "target", produces: ["EntityRef"], baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original" },
    { id: "ally", displayName: "ALLY", family: "target", produces: ["EntityRef"], baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["target"], canonStatus: "game-original" },
    { id: "area", displayName: "AREA", family: "target", produces: ["RegionRef"], baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["region"], canonStatus: "game-original" },
    { id: "spell", displayName: "SPELL", family: "target", produces: ["SpellRef"], baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["spell-ref"], canonStatus: "game-original" },
    { id: "gate", displayName: "GATE", family: "boundary", produces: ["BoundaryRef"], baseFocusCost: 0, precedence: 10, attachment: "value", tags: ["boundary", "gate"], canonStatus: "canon-anchor" },

    {
        id: "seek",
        displayName: "SEEK",
        family: "action",
        produces: ["InstantEffect"],
        inputs: [
            { name: "essence", accepts: ["Essence"], optional: true },
            { name: "target", accepts: ["EntityRef", "RegionRef"] }
        ],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        tags: ["action", "query", "tracking"],
        canonStatus: "game-original"
    },
    {
        id: "bind",
        displayName: "BIND",
        family: "action",
        produces: ["PersistentEffect"],
        inputs: [{ name: "target", accepts: ["EntityRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        tags: ["action", "control", "persistent"],
        canonStatus: "canon-anchor"
    },
    {
        id: "ward",
        displayName: "WARD",
        family: "boundary",
        produces: ["PersistentEffect"],
        inputs: [
            { name: "target", accepts: ["EntityRef", "RegionRef"] },
            { name: "filter", accepts: ["Essence"], optional: true }
        ],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        tags: ["action", "boundary", "persistent"],
        canonStatus: "canon-anchor"
    },
    {
        id: "open",
        displayName: "OPEN",
        family: "action",
        produces: ["InstantEffect"],
        inputs: [{ name: "boundary", accepts: ["BoundaryRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        inverseOf: "close",
        tags: ["action", "boundary-control"],
        canonStatus: "canon-anchor"
    },
    {
        id: "close",
        displayName: "CLOSE",
        family: "action",
        produces: ["InstantEffect"],
        inputs: [{ name: "boundary", accepts: ["BoundaryRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        inverseOf: "open",
        tags: ["action", "boundary-control"],
        canonStatus: "canon-anchor"
    },
    {
        id: "break",
        displayName: "BREAK",
        family: "action",
        produces: ["InstantEffect"],
        // EntityRef: "break the ward standing on that mage" - the handoff's
        // target family lists WARD as a target, and the POC has no ward
        // reference value, so the entity carrying the ward stands in for it.
        inputs: [{ name: "boundary", accepts: ["BoundaryRef", "PersistentEffect", "EntityRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        // Not in the spec's inverse table, but MEND is defined as the repair of
        // what BREAK removes (spec §12 "MEND vs BREAK"); REVERSE uses the pair.
        inverseOf: "mend",
        tags: ["action", "boundary-break"],
        canonStatus: "canon-anchor"
    },
    {
        id: "mend",
        displayName: "MEND",
        family: "action",
        produces: ["InstantEffect"],
        inputs: [{ name: "target", accepts: ["EntityRef", "BoundaryRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        inverseOf: "break",
        tags: ["action", "repair", "healing"],
        canonStatus: "canon-anchor"
    },
    {
        id: "push",
        displayName: "PUSH",
        family: "action",
        produces: ["InstantEffect"],
        inputs: [{ name: "target", accepts: ["EntityRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        inverseOf: "pull",
        tags: ["action", "movement"],
        canonStatus: "game-original"
    },
    {
        id: "pull",
        displayName: "PULL",
        family: "action",
        produces: ["InstantEffect"],
        inputs: [{ name: "target", accepts: ["EntityRef"] }],
        baseFocusCost: 2,
        precedence: 100,
        attachment: "operator",
        inverseOf: "push",
        tags: ["action", "movement"],
        canonStatus: "game-original"
    },

    {
        id: "amplify",
        displayName: "AMPLIFY",
        family: "modifier",
        produces: ["TransformEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "QueryEffect", "TransformEffect"] }],
        baseFocusCost: 1,
        precedence: 300,
        attachment: "postfix",
        inverseOf: "weaken",
        tags: ["modifier", "magnitude"],
        canonStatus: "canon-inspired"
    },
    {
        id: "weaken",
        displayName: "WEAKEN",
        family: "modifier",
        produces: ["TransformEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "QueryEffect", "TransformEffect"] }],
        baseFocusCost: 1,
        precedence: 300,
        attachment: "postfix",
        inverseOf: "amplify",
        tags: ["modifier", "magnitude"],
        canonStatus: "canon-inspired"
    },
    {
        id: "split",
        displayName: "SPLIT",
        family: "modifier",
        produces: ["TransformEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "TransformEffect"] }],
        baseFocusCost: 2,
        precedence: 350,
        attachment: "postfix",
        tags: ["modifier", "branching"],
        canonStatus: "game-original"
    },
    {
        id: "reflect",
        displayName: "REFLECT",
        family: "modifier",
        produces: ["ReactionEffect"],
        inputs: [{ name: "spell", accepts: ["SpellRef", "InstantEffect", "PersistentEffect", "TransformEffect"] }],
        baseFocusCost: 2,
        precedence: 400,
        attachment: "postfix",
        tags: ["modifier", "routing", "reaction"],
        blockedByTags: ["anchored"],
        canonStatus: "game-original"
    },
    {
        id: "reverse",
        displayName: "REVERSE",
        family: "modifier",
        produces: ["TransformEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "TransformEffect"] }],
        baseFocusCost: 2,
        precedence: 450,
        attachment: "postfix",
        tags: ["modifier", "semantic-inverse"],
        canonStatus: "game-original"
    },
    {
        id: "anchor",
        displayName: "ANCHOR",
        family: "modifier",
        produces: ["TransformEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "TransformEffect"] }],
        baseFocusCost: 2,
        precedence: 500,
        attachment: "postfix",
        tags: ["modifier", "anchored", "routing-lock"],
        canonStatus: "canon-inspired"
    },
    {
        id: "silence",
        displayName: "SILENCE",
        family: "modifier",
        produces: ["TransformEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "TransformEffect", "TriggeredEffect"] }],
        baseFocusCost: 2,
        precedence: 550,
        attachment: "postfix",
        tags: ["modifier", "suppression"],
        canonStatus: "game-original"
    },
    {
        id: "null",
        displayName: "NULL",
        family: "modifier",
        produces: ["ReactionEffect"],
        inputs: [{ name: "spell", accepts: ["SpellRef", "InstantEffect", "PersistentEffect", "TransformEffect"] }],
        baseFocusCost: 3,
        precedence: 600,
        attachment: "postfix",
        tags: ["modifier", "cancel", "reaction"],
        canonStatus: "game-original"
    },
    {
        id: "delay",
        displayName: "DELAY",
        family: "timing",
        produces: ["TriggeredEffect"],
        inputs: [{ name: "effect", accepts: ["InstantEffect", "PersistentEffect", "TransformEffect"] }],
        baseFocusCost: 1,
        precedence: 250,
        attachment: "postfix",
        tags: ["timing", "delay"],
        canonStatus: "game-original"
    },
    {
        id: "if",
        displayName: "IF",
        family: "logic",
        produces: ["TriggeredEffect"],
        inputs: [
            { name: "condition", accepts: ["Condition"] },
            { name: "effect", accepts: ["InstantEffect", "PersistentEffect", "TransformEffect"] }
        ],
        baseFocusCost: 1,
        precedence: 200,
        attachment: "infix",
        tags: ["logic", "conditional"],
        canonStatus: "game-original"
    }
];

export const glyphRegistry = new Map(glyphs.map((glyph) => [glyph.id, glyph]));
export const glyphRegistryByDisplayName = new Map(glyphs.map((glyph) => [glyph.displayName, glyph]));
