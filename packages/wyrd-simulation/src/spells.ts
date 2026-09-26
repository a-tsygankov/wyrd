import { glyphs } from "../../wyrd-content/src/glyphs.js";
import { parseSpell } from "../../wyrd-grammar/src/parser.js";
import type { GlyphFamily } from "../../wyrd-grammar/src/types.js";
import { createInitialDuelState, resolveEncounter } from "../../wyrd-resolver/src/index.js";
import type { ResolvedEffect } from "../../wyrd-resolver/src/index.js";

/**
 * A spell the bot may cast: legal for the parser, the Focus budget and the
 * POC resolver, with its flattened shape precomputed for scoring.
 */
export type LegalSpell = {
    tokens: string[];
    focusCost: number;
    action: ResolvedEffect["action"];
    target?: ResolvedEffect["target"];
    essence?: string;
    amplified: boolean;
    anchored: boolean;
};

export type SpellLimits = { minGlyphs: number; maxGlyphs: number; maxFocus: number };

/** The web client's rules: 2-4 glyphs, 7 Focus. */
export const POC_LIMITS: SpellLimits = { minGlyphs: 2, maxGlyphs: 4, maxFocus: 7 };

const familyByToken: ReadonlyMap<string, GlyphFamily> = new Map(glyphs.map(g => [g.displayName, g.family]));

// The parser is order-tolerant but not order-free (AMPLIFY first, or an
// essence after BIND, fails). Two canonical orders cover every POC shape,
// and the spelling players see in the examples wins:
//   essence · action · target · modifiers    FIRE SEEK ENEMY AMPLIFY   (SEEK)
//   target  · action · essence · modifiers   SELF WARD SHADOW, ENEMY BIND, GATE CLOSE ANCHOR
const ESSENCE_FIRST: readonly GlyphFamily[] = ["essence", "action", "target", "boundary", "modifier"];
const TARGET_FIRST: readonly GlyphFamily[] = ["target", "boundary", "action", "essence", "modifier"];

function ordersFor(subset: readonly string[]): ReadonlyArray<readonly GlyphFamily[]> {
    return subset.includes("SEEK") ? [ESSENCE_FIRST, TARGET_FIRST] : [TARGET_FIRST, ESSENCE_FIRST];
}

function arrange(subset: readonly string[], order: readonly GlyphFamily[]): string[] | undefined {
    const rank = new Map(order.map((family, i) => [family, i]));
    const ranked = subset.map(token => ({ token, rank: rank.get(familyByToken.get(token) as GlyphFamily) }));
    if (ranked.some(r => r.rank === undefined)) return undefined;
    return ranked.sort((a, b) => (a.rank as number) - (b.rank as number)).map(r => r.token);
}

function* subsets(items: readonly string[], size: number, start = 0, acc: string[] = []): Generator<string[]> {
    if (acc.length === size) {
        yield [...acc];
        return;
    }
    for (let i = start; i < items.length; i++) {
        acc.push(items[i] as string);
        yield* subsets(items, size, i + 1, acc);
        acc.pop();
    }
}

/** Classify a token sequence through the real resolver; undefined if it is not a castable POC spell. */
export function classifySpell(tokens: readonly string[], limits: SpellLimits = POC_LIMITS): LegalSpell | undefined {
    if (tokens.length < limits.minGlyphs || tokens.length > limits.maxGlyphs) return undefined;
    const parsed = parseSpell([...tokens]);
    if (parsed.status !== "valid" || parsed.focusCost > limits.maxFocus) return undefined;
    // The resolver is the authority on what a spell *does*; a parse the POC
    // resolver rejects (unsupported action, CLOSE without GATE) is not legal
    // for the bot either.
    const probe = resolveEncounter(createInitialDuelState(), {
        casterId: "opponent",
        defenderId: "player",
        spellTokens: [...tokens]
    });
    if (!probe.effect || probe.steps.some(s => s.result === "failed")) return undefined;
    const effect = probe.effect;
    return {
        tokens: [...tokens],
        focusCost: parsed.focusCost,
        action: effect.action,
        ...(effect.target ? { target: effect.target } : {}),
        ...(effect.essence ? { essence: effect.essence } : {}),
        amplified: effect.magnitude > 1,
        anchored: effect.anchored
    };
}

/**
 * Every distinct legal spell the tray allows. Subsets (not permutations)
 * of the tray, each tried in the canonical orders: a few hundred parses,
 * cheap enough to run once per match on a phone.
 */
export function enumerateLegalSpells(tray: readonly string[], limits: SpellLimits = POC_LIMITS): LegalSpell[] {
    const seen = new Set<string>();
    const pool: LegalSpell[] = [];
    for (let size = limits.minGlyphs; size <= limits.maxGlyphs; size++) {
        for (const subset of subsets(tray, size)) {
            for (const order of ordersFor(subset)) {
                const tokens = arrange(subset, order);
                if (!tokens) break;
                const spell = classifySpell(tokens, limits);
                if (!spell) continue;
                const key = spell.tokens.join(" ");
                if (!seen.has(key)) {
                    seen.add(key);
                    pool.push(spell);
                }
                break;
            }
        }
    }
    return pool;
}
