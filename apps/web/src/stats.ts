import { rulesetIds, type RulesetId } from "../../../packages/wyrd-content/src/rulesets.js";

/**
 * Per-device statistics, kept in local storage and shown in the Stats
 * panel next to the global telemetry summary. Pure functions over a plain
 * object so they are unit-tested in node; main.ts owns storage and DOM.
 */
export type Mode = "solo" | "hotseat";
export type EndReason = "seals" | "resolve";

export type Bucket = {
    rounds: number;
    sealsFor: number;
    sealsAgainst: number;
    reactions: Record<string, number>;
    commitMsTotal: number;
    matches: number;
    wins: number;
    endedBy: Record<string, number>;
    rematches: number;
};

export type Stats = {
    version: 1;
    rulesets: Record<RulesetId, Bucket>;
    modes: Record<Mode, Bucket>;
    streak: number;
    bestStreak: number;
};

function emptyBucket(): Bucket {
    return { rounds: 0, sealsFor: 0, sealsAgainst: 0, reactions: {}, commitMsTotal: 0, matches: 0, wins: 0, endedBy: {}, rematches: 0 };
}

export function emptyStats(): Stats {
    const rulesets = Object.fromEntries(rulesetIds.map(id => [id, emptyBucket()])) as Record<RulesetId, Bucket>;
    return { version: 1, rulesets, modes: { solo: emptyBucket(), hotseat: emptyBucket() }, streak: 0, bestStreak: 0 };
}

function clone(stats: Stats): Stats {
    return structuredClone(stats);
}

function buckets(stats: Stats, ruleset: RulesetId, mode: Mode): Bucket[] {
    return [stats.rulesets[ruleset], stats.modes[mode]];
}

export type RoundFacts = {
    ruleset: RulesetId;
    mode: Mode;
    playerGained: number;
    opponentGained: number;
    playerReaction: string | undefined;
    timeToCommitMs: number;
};

export function recordRound(stats: Stats, facts: RoundFacts): Stats {
    const next = clone(stats);
    for (const b of buckets(next, facts.ruleset, facts.mode)) {
        b.rounds += 1;
        b.sealsFor += facts.playerGained;
        b.sealsAgainst += facts.opponentGained;
        const key = facts.playerReaction ?? "none";
        b.reactions[key] = (b.reactions[key] ?? 0) + 1;
        b.commitMsTotal += facts.timeToCommitMs;
    }
    return next;
}

export function recordMatchEnd(stats: Stats, facts: { ruleset: RulesetId; mode: Mode; won: boolean; reason: EndReason }): Stats {
    const next = clone(stats);
    for (const b of buckets(next, facts.ruleset, facts.mode)) {
        b.matches += 1;
        if (facts.won) b.wins += 1;
        b.endedBy[facts.reason] = (b.endedBy[facts.reason] ?? 0) + 1;
    }
    next.streak = facts.won ? Math.max(0, next.streak) + 1 : Math.min(0, next.streak) - 1;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
    return next;
}

export function recordRematch(stats: Stats, facts: { ruleset: RulesetId; mode: Mode }): Stats {
    const next = clone(stats);
    for (const b of buckets(next, facts.ruleset, facts.mode)) b.rematches += 1;
    return next;
}

export type StatsRow = {
    ruleset: RulesetId;
    rounds: number;
    matches: number;
    wins: number;
    winRate: number;
    sealsFor: number;
    sealsAgainst: number;
    /** Share of rounds in which the player gained at least one seal. */
    sealRate: number;
    avgCommitMs: number | null;
    topReaction: string;
    endedBy: Record<string, number>;
    rematches: number;
};

export function summarize(stats: Stats): StatsRow[] {
    return rulesetIds.map(ruleset => {
        const b = stats.rulesets[ruleset];
        const max = Math.max(0, ...Object.values(b.reactions));
        const top = Object.entries(b.reactions)
            .filter(([, n]) => n === max && max > 0)
            .map(([k]) => k)
            .sort()
            .join("/");
        return {
            ruleset,
            rounds: b.rounds,
            matches: b.matches,
            wins: b.wins,
            winRate: b.matches === 0 ? 0 : b.wins / b.matches,
            sealsFor: b.sealsFor,
            sealsAgainst: b.sealsAgainst,
            sealRate: b.rounds === 0 ? 0 : Math.min(1, b.sealsFor / b.rounds),
            avgCommitMs: b.rounds === 0 ? null : Math.round(b.commitMsTotal / b.rounds),
            topReaction: top || "—",
            endedBy: b.endedBy,
            rematches: b.rematches
        };
    });
}

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const KEY = "wyrd.stats";

export function loadStats(storage: StorageLike): Stats {
    try {
        const raw = storage.getItem(KEY);
        if (!raw) return emptyStats();
        const parsed = JSON.parse(raw) as Partial<Stats>;
        if (parsed.version !== 1 || !parsed.rulesets || !parsed.modes) return emptyStats();
        // Fill any bucket a newer ruleset added since the stats were saved.
        const base = emptyStats();
        for (const id of rulesetIds) base.rulesets[id] = { ...emptyBucket(), ...(parsed.rulesets[id] ?? {}) };
        for (const mode of ["solo", "hotseat"] as const) base.modes[mode] = { ...emptyBucket(), ...(parsed.modes[mode] ?? {}) };
        base.streak = typeof parsed.streak === "number" ? parsed.streak : 0;
        base.bestStreak = typeof parsed.bestStreak === "number" ? parsed.bestStreak : 0;
        return base;
    } catch {
        return emptyStats();
    }
}

export function saveStats(storage: StorageLike, stats: Stats): void {
    try {
        storage.setItem(KEY, JSON.stringify(stats));
    } catch {
        // Private mode: stats live for this page load only.
    }
}
