import type { ReactionGlyph } from "../../wyrd-resolver/src/types.js";

/**
 * Curated duel situations for the POC-5 gameplay experiment. Data, not
 * code: the web client plays the deck in order before handing the
 * opponent to the heuristic bot, and test/scenarios.test.mjs proves every
 * documented response resolves exactly as its lesson claims - so a rules
 * change that silently breaks a lesson fails CI.
 *
 * Each scenario is the OPPONENT's incoming spell plus how the opponent
 * reacts to the player's own cast that round. `responses` list the
 * player's plausible answers with the outcome the resolver produces;
 * the client shows them after the round as the explanation.
 */
export type TelegraphPresetId = "high" | "medium";

export type ScenarioOutcome = "player-seal" | "opponent-seal" | "blocked" | "canceled" | "no-seal";

export type ScenarioResponse = {
    label: string;
    /** The player's reaction to the opponent's spell (null = no reaction). */
    reaction?: ReactionGlyph | null;
    /** Or: the player's own spell cast into the scenario's setup. */
    spell?: string[];
    expect: ScenarioOutcome;
};

export type Scenario = {
    id: string;
    title: string;
    telegraph: TelegraphPresetId;
    opponentSpell: string[];
    /** Fixed reaction the opponent uses against the player's spell, or the bot's table. */
    opponentReaction: ReactionGlyph | "none" | "bot";
    setup?: {
        playerWard?: { essence?: string };
        opponentWard?: { essence?: string };
    };
    lesson: string;
    responses: ScenarioResponse[];
};

export const scenarios: Scenario[] = [
    {
        id: "direct-threat",
        title: "A direct threat",
        telegraph: "high",
        opponentSpell: ["FIRE", "SEEK", "ENEMY"],
        opponentReaction: "none",
        lesson: "A plain hostile SEEK has an open route: REFLECT sends it home for your seal, NULL simply stops it, and doing nothing concedes one.",
        responses: [
            { label: "No reaction", reaction: null, expect: "opponent-seal" },
            { label: "REFLECT", reaction: "reflect", expect: "player-seal" },
            { label: "NULL", reaction: "null", expect: "canceled" },
            { label: "SILENCE", reaction: "silence", expect: "opponent-seal" }
        ]
    },
    {
        id: "reflect-opportunity",
        title: "An open route",
        telegraph: "high",
        opponentSpell: ["SHADOW", "SEEK", "ENEMY", "AMPLIFY"],
        opponentReaction: "silence",
        lesson: "AMPLIFY makes the spell louder, not safer. Without ANCHOR the route is still open, and REFLECT returns the whole amplified spell.",
        responses: [
            { label: "REFLECT", reaction: "reflect", expect: "player-seal" },
            { label: "SILENCE (strips AMPLIFY, spell still lands)", reaction: "silence", expect: "opponent-seal" },
            { label: "No reaction", reaction: null, expect: "opponent-seal" }
        ]
    },
    {
        id: "anchor-route",
        title: "A protected route",
        telegraph: "high",
        opponentSpell: ["FIRE", "SEEK", "ENEMY", "ANCHOR"],
        opponentReaction: "reflect",
        lesson: "ANCHOR fixes the route. REFLECT fails against it; SILENCE strips the ANCHOR but the SEEK still lands. Only NULL, or a matching WARD from an earlier round, stops it.",
        responses: [
            { label: "REFLECT (blocked by ANCHOR)", reaction: "reflect", expect: "opponent-seal" },
            { label: "SILENCE (strips ANCHOR, spell still lands)", reaction: "silence", expect: "opponent-seal" },
            { label: "NULL", reaction: "null", expect: "canceled" }
        ]
    },
    {
        id: "amplify-bluff",
        title: "The same telegraph, a different tail",
        telegraph: "high",
        opponentSpell: ["FIRE", "SEEK", "ENEMY", "AMPLIFY"],
        opponentReaction: "bot",
        lesson: "FIRE → SEEK → ? → ? looked exactly like the protected route last round, but this tail was AMPLIFY. Reading the telegraph means weighing both: REFLECT wins big here and fails against ANCHOR.",
        responses: [
            { label: "REFLECT", reaction: "reflect", expect: "player-seal" },
            { label: "NULL (safe either way)", reaction: "null", expect: "canceled" },
            { label: "SILENCE", reaction: "silence", expect: "opponent-seal" }
        ]
    },
    {
        id: "silence-modifier",
        title: "Stripping a modifier",
        telegraph: "medium",
        opponentSpell: ["ENEMY", "BIND", "ANCHOR"],
        opponentReaction: "bot",
        lesson: "SILENCE changes what a spell does, not whether it lands: it removes the ANCHOR, yet the BIND still binds. Against a bare objective, SILENCE is the wrong tool.",
        responses: [
            { label: "SILENCE", reaction: "silence", expect: "opponent-seal" },
            { label: "REFLECT (blocked by ANCHOR)", reaction: "reflect", expect: "opponent-seal" },
            { label: "NULL", reaction: "null", expect: "canceled" }
        ]
    },
    {
        id: "null-hard-counter",
        title: "The hard counter",
        telegraph: "medium",
        opponentSpell: ["GATE", "CLOSE", "ANCHOR"],
        opponentReaction: "bot",
        lesson: "CLOSE GATE is an objective, not an attack: there is no hostile route to REFLECT and no WARD in the way. NULL is the only reaction that stops it, which is exactly why NULL must stay expensive.",
        responses: [
            { label: "NULL", reaction: "null", expect: "canceled" },
            { label: "REFLECT (no hostile route)", reaction: "reflect", expect: "opponent-seal" },
            { label: "No reaction", reaction: null, expect: "opponent-seal" }
        ]
    },
    {
        id: "ward-interaction",
        title: "Reading a ward",
        telegraph: "high",
        opponentSpell: ["SELF", "WARD", "FIRE"],
        opponentReaction: "none",
        setup: { opponentWard: { essence: "fire" } },
        lesson: "The opponent stands behind a FIRE ward. FIRE attacks and untyped BIND are blocked; a SHADOW attack or the GATE objective passes. Wards are read by their essence, not their presence.",
        responses: [
            { label: "FIRE SEEK ENEMY (blocked)", spell: ["FIRE", "SEEK", "ENEMY"], expect: "blocked" },
            { label: "ENEMY BIND (untyped, blocked)", spell: ["ENEMY", "BIND"], expect: "blocked" },
            { label: "SHADOW SEEK ENEMY", spell: ["SHADOW", "SEEK", "ENEMY"], expect: "player-seal" },
            { label: "GATE CLOSE", spell: ["GATE", "CLOSE"], expect: "player-seal" },
            { label: "Opponent's ward spell itself scores nothing", reaction: null, expect: "no-seal" }
        ]
    },
    {
        id: "ward-versus-bind",
        title: "Behind your own ward",
        telegraph: "medium",
        opponentSpell: ["ENEMY", "BIND", "AMPLIFY"],
        opponentReaction: "bot",
        setup: { playerWard: { essence: "shadow" } },
        lesson: "Your SHADOW ward stops untyped spells too, so this BIND never arrives - no reaction needed. Spending REFLECT here still wins a seal, but NULL would be wasted Focus.",
        responses: [
            { label: "No reaction (ward holds)", reaction: null, expect: "blocked" },
            { label: "REFLECT (before the ward matters)", reaction: "reflect", expect: "player-seal" },
            { label: "NULL (wasted)", reaction: "null", expect: "canceled" }
        ]
    }
];

export function scenarioById(id: string): Scenario | undefined {
    return scenarios.find(s => s.id === id);
}
