/**
 * Player-facing help for every registry glyph, shown as each glyph is added
 * to a spell. Data, not code: every line says what the glyph does and to
 * whom under the POC resolver rules (packages/wyrd-resolver). Glyphs the
 * resolver does not act on yet say so, and what the grammar spec intends
 * for them. Keep it truthful to the resolver - test/scenarios.test.mjs and
 * explain.test.mjs will not catch a wrong sentence here, a playtester will.
 */
export type GlyphHelp = {
    role: "essence" | "target" | "action" | "modifier" | "reaction" | "timing" | "logic";
    text: string;
    /** Parses but the POC resolver does not act on it yet; kept out of the tray. */
    pending?: boolean;
};

export const glyphHelp: Record<string, GlyphHelp> = {
    // --- essences -----------------------------------------------------------
    FIRE: {
        role: "essence",
        text: "Essence: the spell carries FIRE. A FIRE-filtered ward on the target stops it; a SHADOW ward or no ward lets it through."
    },
    WATER: {
        role: "essence",
        text: "Essence: the spell carries WATER. A WATER-filtered ward on the target stops it; other wards let it through."
    },
    SHADOW: {
        role: "essence",
        text: "Essence: the spell carries SHADOW. A SHADOW-filtered ward on the target stops it; a FIRE ward lets it through."
    },
    FORCE: {
        role: "essence",
        pending: true,
        text: "Essence: the spell carries FORCE. It filters wards like the other essences; not in the POC tray yet."
    },
    LIFE: {
        role: "essence",
        text: "Essence: the spell carries LIFE. A LIFE-filtered ward on the target stops it; other wards let it through."
    },

    // --- targets ------------------------------------------------------------
    SELF: {
        role: "target",
        text: "Target: yourself. WARD SELF raises your own ward. SEEK or BIND on SELF land on you and score nothing."
    },
    ENEMY: {
        role: "target",
        text: "Target: the opponent. SEEK or BIND on ENEMY score a seal if they land - but they can be REFLECTed back unless ANCHORed, and a matching ward on the opponent blocks them."
    },
    ALLY: {
        role: "target",
        pending: true,
        text: "Target: a friendly mage. A duel has none, so ALLY waits for team play; the spec treats it as an EntityRef like SELF and ENEMY."
    },
    AREA: {
        role: "target",
        pending: true,
        text: "Target: the whole arena rather than one mage. SEEK and WARD accept it in the grammar; the POC resolver does not sweep both sides yet."
    },
    SPELL: {
        role: "reaction",
        text: "Reference to the incoming spell. It is what REFLECT and NULL act on - the reaction row supplies it; it is never cast on its own."
    },
    GATE: {
        role: "target",
        text: "The objective between the mages, not a player. CLOSE scores while it stands open, OPEN scores while it is closed; BREAK shatters it until someone MENDs it. Wards and REFLECT cannot touch it; only NULL stops a GATE spell."
    },

    // --- actions ------------------------------------------------------------
    SEEK: {
        role: "action",
        text: "Action: reaches its target. On ENEMY it scores a seal for you; on SELF it does nothing useful. Needs a target. No inverse, so REVERSE cannot apply to it."
    },
    BIND: {
        role: "action",
        text: "Action: binds its target and scores a seal on ENEMY. It carries no essence, so any ward on the opponent stops it. No inverse yet (RELEASE is not in the language)."
    },
    WARD: {
        role: "action",
        text: "Action: raises a ward on the target that lasts into later rounds. Add an essence to filter it (only that essence is blocked) or leave it untyped to block every hostile spell. Scores nothing this round."
    },
    OPEN: {
        role: "action",
        text: "Action: OPEN GATE scores a seal while the gate is closed and reopens it. Wards and REFLECT cannot touch the gate; only NULL stops it. REVERSE turns it into CLOSE."
    },
    CLOSE: {
        role: "action",
        text: "Action: CLOSE GATE scores a seal while the gate stands open and closes it; on a closed gate it does nothing. Not aimed at a player, so wards and REFLECT do not apply. REVERSE turns it into OPEN."
    },
    BREAK: {
        role: "action",
        text: "Action: BREAK ENEMY shatters the opponent's ward outright - no ward can block it - and scores nothing; the seal comes with your next attack. BREAK GATE shatters the objective so nobody scores from it until it is MENDed. REFLECT sends BREAK back onto your own ward. REVERSE turns it into MEND."
    },
    MEND: {
        role: "action",
        text: "Action: MEND SELF restores your ward to full integrity (and under Resolve heals 2); MEND GATE repairs a shattered gate. Scores nothing. REVERSE turns it into BREAK."
    },
    PUSH: {
        role: "action",
        pending: true,
        text: "Action: shoves its target. The spec pairs it with PULL as inverses; the POC duel has no positions yet, so it is not in the tray."
    },
    PULL: {
        role: "action",
        pending: true,
        text: "Action: drags its target closer. The inverse of PUSH in the spec; waits with it for a positional rule."
    },

    // --- modifiers ----------------------------------------------------------
    AMPLIFY: {
        role: "modifier",
        text: "Modifier: doubles the spell's magnitude and makes the telegraph louder. SILENCE strips it; WEAKEN cancels it; REVERSE turns it into WEAKEN. It never changes who scores."
    },
    WEAKEN: {
        role: "modifier",
        text: "Modifier: lowers the spell's magnitude by one (to 0 on a plain spell, back to 1 on an AMPLIFYed one). A magnitude-0 strike still reaches - and still seals - but dents no ward and deals no Resolve. SILENCE strips it; REVERSE turns it into AMPLIFY."
    },
    SPLIT: {
        role: "modifier",
        text: "Modifier: the spell resolves as two branches, each at full magnitude - two dents on a ward, twice the Resolve damage - but still one seal. REFLECT turns back only one branch, so you score and they score. SILENCE strips it, NULL cancels both. Costs 2 Focus."
    },
    REFLECT: {
        role: "reaction",
        text: "Reaction (2 Focus under Teeth and up): sends a spell aimed at ENEMY back to its caster and takes the seal - unless ANCHOR fixes the route. Cannot touch the GATE, and turns back only one SPLIT branch."
    },
    REVERSE: {
        role: "modifier",
        text: "Modifier: swaps the action for its inverse - OPEN↔CLOSE, BREAK↔MEND - or, when the action has none, AMPLIFY↔WEAKEN. The telegraph still shows the original action. SEEK, BIND and WARD have no inverse, so REVERSE cannot be cast on them. ANCHOR does not stop it; SILENCE strips it. Costs 2 Focus."
    },
    ANCHOR: {
        role: "modifier",
        text: "Modifier: fixes the spell's route so REFLECT fails against it. SILENCE strips it. It does not stop REVERSE - it protects the route, not the meaning. Costs 2 Focus."
    },
    SILENCE: {
        role: "reaction",
        text: "Reaction (1 Focus under Teeth and up): strips every modifier - AMPLIFY, WEAKEN, SPLIT, REVERSE, ANCHOR - and lets the base spell land as telegraphed. Cheap, and the answer to tricks rather than to seals."
    },
    NULL: {
        role: "reaction",
        text: "Reaction (3 Focus under Teeth and up): cancels the whole spell before it resolves, whatever it was. The hard counter; it also teaches you nothing about the spell."
    },

    // --- timing / logic -------------------------------------------------------
    DELAY: {
        role: "timing",
        pending: true,
        text: "Timing: holds the effect until the start of the next round. It must come last in a spell. The POC resolver does not keep pending spells yet, so it is not in the tray."
    },
    IF: {
        role: "logic",
        pending: true,
        text: "Logic: CONDITION → IF → EFFECT fires the effect only while the condition holds. No glyph produces a condition in the v0 registry, so IF cannot be cast yet."
    }
};
