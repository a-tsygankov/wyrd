/**
 * Player-facing help for the POC tray, shown as each glyph is added to a
 * spell. Data, not code: every line says what the glyph does and to whom
 * under the POC resolver rules (packages/wyrd-resolver). Keep it truthful
 * to the resolver - test/scenarios.test.mjs and explain.test.mjs will not
 * catch a wrong sentence here, a playtester will.
 */
export type GlyphHelp = {
    role: "essence" | "target" | "action" | "modifier";
    text: string;
};

export const glyphHelp: Record<string, GlyphHelp> = {
    FIRE: {
        role: "essence",
        text: "Essence: the spell carries FIRE. A FIRE-filtered ward on the target stops it; a SHADOW ward or no ward lets it through."
    },
    SHADOW: {
        role: "essence",
        text: "Essence: the spell carries SHADOW. A SHADOW-filtered ward on the target stops it; a FIRE ward lets it through."
    },
    SELF: {
        role: "target",
        text: "Target: yourself. WARD SELF raises your own ward. SEEK or BIND on SELF land on you and score nothing."
    },
    ENEMY: {
        role: "target",
        text: "Target: the opponent. SEEK or BIND on ENEMY score a seal if they land - but they can be REFLECTed back unless ANCHORed, and a matching ward on the opponent blocks them."
    },
    GATE: {
        role: "target",
        text: "Target for CLOSE: the objective, not a player. Wards and REFLECT cannot touch it; only NULL stops a GATE spell."
    },
    SEEK: {
        role: "action",
        text: "Action: reaches its target. On ENEMY it scores a seal for you; on SELF it does nothing useful. Needs a target."
    },
    BIND: {
        role: "action",
        text: "Action: binds its target and scores a seal on ENEMY. It carries no essence, so any ward on the opponent stops it."
    },
    WARD: {
        role: "action",
        text: "Action: raises a ward on the target that lasts into later rounds. Add an essence to filter it (only that essence is blocked) or leave it untyped to block every hostile spell. Scores nothing this round."
    },
    CLOSE: {
        role: "action",
        text: "Action: closes the GATE for a seal. Not aimed at a player, so wards and REFLECT do not apply."
    },
    AMPLIFY: {
        role: "modifier",
        text: "Modifier: doubles the spell's magnitude and makes the telegraph louder. SILENCE strips it. It never changes who scores."
    },
    ANCHOR: {
        role: "modifier",
        text: "Modifier: fixes the spell's route so REFLECT fails against it. SILENCE strips it. Costs 2 Focus."
    }
};
