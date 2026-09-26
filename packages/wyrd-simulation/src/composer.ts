import { glyphs } from "../../wyrd-content/src/glyphs.js";
import type { Attachment } from "../../wyrd-grammar/src/types.js";
import { classifySpell, POC_LIMITS, type LegalSpell, type SpellLimits } from "./spells.js";

/**
 * Compatibility of every tray glyph as the NEXT glyph of the spell being
 * composed (the tray highlights it). "complete": tapping it yields a
 * castable spell now. "open": not castable yet, but some legal spell in
 * the pool starts this way. "incompatible": no castable spell can follow.
 * The legal pool (spells.ts) is the authority, so the tray can never
 * promise a spell the resolver would refuse.
 */
export type GlyphFit = "complete" | "open" | "incompatible";

const attachmentByToken: ReadonlyMap<string, Attachment> = new Map(glyphs.map(g => [g.displayName, g.attachment]));

function attachment(token: string): Attachment | undefined {
    return attachmentByToken.get(token);
}

/** `rest` = `spell` minus `used`, respecting multiplicity; undefined when `used` is not contained. */
function remainder(spell: readonly string[], used: readonly string[]): string[] | undefined {
    const rest = [...spell];
    for (const token of used) {
        const at = rest.indexOf(token);
        if (at < 0) return undefined;
        rest.splice(at, 1);
    }
    return rest;
}

function canComplete(sequence: readonly string[], pool: readonly LegalSpell[], limits: SpellLimits): boolean {
    // A postfix modifier attaches to the effect on its left: one written
    // before the action (or with no action yet) can never parse.
    const actionAt = sequence.findIndex(token => attachment(token) === "operator");
    if (sequence.some((token, i) => attachment(token) === "postfix" && (actionAt < 0 || i < actionAt))) return false;

    for (const spell of pool) {
        if (spell.focusCost > limits.maxFocus || spell.tokens.length <= sequence.length) continue;
        const rest = remainder(spell.tokens, sequence);
        if (!rest) continue;
        // Values may follow the modifiers; modifiers stay behind the action.
        const ordered = [...rest.filter(t => attachment(t) === "value"), ...rest.filter(t => attachment(t) !== "value")];
        if (classifySpell([...sequence, ...ordered], limits)) return true;
    }
    return false;
}

export function glyphFits(
    prefix: readonly string[],
    tray: readonly string[],
    pool: readonly LegalSpell[],
    budget: number = POC_LIMITS.maxFocus,
    limits: SpellLimits = POC_LIMITS
): Record<string, GlyphFit> {
    const within: SpellLimits = { ...limits, maxFocus: Math.min(limits.maxFocus, budget) };
    const fits: Record<string, GlyphFit> = {};
    for (const token of tray) {
        const sequence = [...prefix, token];
        if (sequence.length > limits.maxGlyphs) {
            fits[token] = "incompatible";
        } else if (classifySpell(sequence, within)) {
            fits[token] = "complete";
        } else {
            fits[token] = canComplete(sequence, pool, within) ? "open" : "incompatible";
        }
    }
    return fits;
}
