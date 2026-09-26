import { glyphs } from "../../wyrd-content/src/glyphs.js";
import type { GlyphFamily } from "../../wyrd-grammar/src/types.js";
import type { Rng } from "./rng.js";

/**
 * Telegraph presets from the POC plan (POC-5). The telegraph is what the
 * defender sees of the incoming spell before choosing a reaction; the
 * whole product question is whether these reveal enough to reason with.
 *
 * - high:   reveal essence and action glyphs exactly; hide target and
 *           modifiers. Tested first.
 * - medium: reveal one exact glyph, one hidden glyph's family, and the
 *           total glyph count (every slot is shown, most as "?").
 * A "low" preset is deliberately absent until "medium" works.
 */
export type TelegraphPreset = "high" | "medium";

export type TelegraphSlot =
    | { kind: "glyph"; token: string }
    | { kind: "family"; family: GlyphFamily }
    | { kind: "hidden" };

const familyByToken: ReadonlyMap<string, GlyphFamily> = new Map(glyphs.map(g => [g.displayName, g.family]));

export function glyphFamily(token: string): GlyphFamily | undefined {
    return familyByToken.get(token);
}

export function projectTelegraph(tokens: readonly string[], preset: TelegraphPreset, rng: Rng): TelegraphSlot[] {
    if (preset === "high") {
        return tokens.map(token => {
            const family = familyByToken.get(token);
            return family === "essence" || family === "action" ? { kind: "glyph", token } : { kind: "hidden" };
        });
    }

    // medium: pick the exact glyph and the family slot with the rng so the
    // same spell telegraphs differently across rounds (and identically for
    // the same seed).
    const slots: TelegraphSlot[] = tokens.map(() => ({ kind: "hidden" }));
    const exact = rng.int(tokens.length);
    slots[exact] = { kind: "glyph", token: tokens[exact] as string };
    if (tokens.length > 1) {
        const others = tokens.map((_, i) => i).filter(i => i !== exact);
        const familyIndex = others[rng.int(others.length)] as number;
        const family = familyByToken.get(tokens[familyIndex] as string);
        slots[familyIndex] = family ? { kind: "family", family } : { kind: "hidden" };
    }
    return slots;
}

export function formatTelegraph(slots: readonly TelegraphSlot[]): string {
    return slots
        .map(slot => {
            if (slot.kind === "glyph") return slot.token;
            if (slot.kind === "family") return `[${slot.family}]`;
            return "?";
        })
        .join(" → ");
}
