import { TRACE_RUNES, type TraceRune } from "./strokeDuel.js";

export type ParrySuggestion = "block" | "deflect" | "reflect";

export type OpponentSpellProfile = {
    id: "ember-lance" | "void-orb" | "hex-shard" | "storm-needle";
    name: string;
    behavior: "aggressive" | "patient" | "trickster" | "volatile";
    travelMs: number;
    launchDelayMs: number;
    damage: number;
    laneY: number;
    suggested: ParrySuggestion;
    color: number;
    tip: string;
};

export const OPPONENT_SPELLS: readonly OpponentSpellProfile[] = [
    {
        id: "ember-lance",
        name: "EMBER LANCE",
        behavior: "aggressive",
        travelMs: 1500,
        launchDelayMs: 240,
        damage: 16,
        laneY: 0.44,
        suggested: "block",
        color: 0xff7a3d,
        tip: "Fast and direct. A steep BLOCK is the safest answer."
    },
    {
        id: "void-orb",
        name: "VOID ORB",
        behavior: "patient",
        travelMs: 2850,
        launchDelayMs: 520,
        damage: 18,
        laneY: 0.57,
        suggested: "reflect",
        color: 0xa56bff,
        tip: "Slow and heavy. Use the extra time to curve through it for REFLECT."
    },
    {
        id: "hex-shard",
        name: "HEX SHARD",
        behavior: "trickster",
        travelMs: 2050,
        launchDelayMs: 360,
        damage: 13,
        laneY: 0.36,
        suggested: "deflect",
        color: 0x6ee7a8,
        tip: "It rides high and changes the read. A diagonal DEFLECT is forgiving."
    },
    {
        id: "storm-needle",
        name: "STORM NEEDLE",
        behavior: "volatile",
        travelMs: 1750,
        launchDelayMs: 300,
        damage: 14,
        laneY: 0.64,
        suggested: "block",
        color: 0x62ddff,
        tip: "Quick and low in the frame. Meet it decisively with BLOCK."
    }
];

export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickDifferent<T>(values: readonly T[], random: () => number, previous?: T): T {
    if (values.length === 1) return values[0]!;
    const start = Math.min(values.length - 1, Math.floor(random() * values.length));
    const candidate = values[start]!;
    if (previous === undefined || candidate !== previous) return candidate;
    return values[(start + 1) % values.length]!;
}

export function pickTraceRune(random: () => number, previous?: TraceRune): TraceRune {
    return pickDifferent(TRACE_RUNES, random, previous);
}

export function pickOpponentSpell(random: () => number, previousId?: OpponentSpellProfile["id"]): OpponentSpellProfile {
    const previous = previousId ? OPPONENT_SPELLS.find(spell => spell.id === previousId) : undefined;
    return pickDifferent(OPPONENT_SPELLS, random, previous);
}

export function playerSuggestion(rune: TraceRune, opponent: OpponentSpellProfile): string {
    const offensive =
        rune === "line" ? "Keep PIERCE straight and fast." :
        rune === "arc" ? "Preserve the arc shape; don't flatten REDIRECT." :
        "Close POWER's triangle cleanly before releasing.";
    return offensive + " Incoming read: " + opponent.tip;
}
