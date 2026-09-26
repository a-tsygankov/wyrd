/**
 * Small seeded PRNG (mulberry32) so bot decisions, telegraph projections
 * and scenario shuffles replay byte-for-byte from a match seed. The kernel
 * invariant from the architecture doc: same state + same intents + same
 * seed → identical result. Math.random is never used in gameplay code.
 */
export type Rng = {
    /** Uniform float in [0, 1). */
    next(): number;
    /** Uniform integer in [0, maxExclusive). */
    int(maxExclusive: number): number;
    /** Uniform pick from a non-empty array. */
    pick<T>(items: readonly T[]): T;
    /** Weighted pick: weights ≤ 0 are never chosen. */
    weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
};

export function createRng(seed: number): Rng {
    let a = seed >>> 0;
    const next = (): number => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
    const pick = <T>(items: readonly T[]): T => {
        if (items.length === 0) throw new Error("pick from an empty list");
        return items[int(items.length)] as T;
    };
    const weighted = <T>(items: readonly T[], weightOf: (item: T) => number): T => {
        const weights = items.map(item => Math.max(0, weightOf(item)));
        const total = weights.reduce((sum, w) => sum + w, 0);
        if (total <= 0) return pick(items);
        let roll = next() * total;
        for (let i = 0; i < items.length; i++) {
            roll -= weights[i] as number;
            if (roll < 0) return items[i] as T;
        }
        return items[items.length - 1] as T;
    };
    return { next, int, pick, weighted };
}

/** Deterministic 32-bit hash of a string, for seeds typed into a URL. */
export function seedFromString(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
