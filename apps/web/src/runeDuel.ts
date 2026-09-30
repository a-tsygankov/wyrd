/**
 * Rune Lab's duel rules (docs/rune-lab.md), pure and unit-tested in node
 * (test/rune_duel.test.mjs); runeLab.ts draws them.
 *
 * The idea: magic is a written language. Your opponent writes a rune in the
 * air, stroke by stroke; you read it while it is still being written and
 * write the rune that undoes it before it lands. Reading early is the skill:
 * a counter readied early is charged, a misread can be corrected by drawing
 * again (the charge restarts), and two runes in a known order make a combo.
 */
export type Rune = "line" | "arc" | "circle" | "triangle" | "spiral";
export const RUNES: readonly Rune[] = ["line", "arc", "circle", "triangle", "spiral"];

/**
 * What undoes what: each threat and the two runes that counter it, with the
 * reason the Help shows. A Ward blocks and a Redirect deflects a Pierce;
 * Power overwhelms and a Pierce cuts a Redirect; Absorb drains and Power
 * breaks a Ward; a Ward contains and a Redirect diverts Power; a Pierce
 * bursts and Power overloads an Absorb.
 */
export const COUNTERS: Record<Rune, readonly Rune[]> = {
    line: ["circle", "arc"],
    arc: ["triangle", "line"],
    circle: ["spiral", "triangle"],
    triangle: ["circle", "arc"],
    spiral: ["line", "triangle"]
};

export function beats(answer: Rune, threat: Rune): boolean {
    return COUNTERS[threat].includes(answer);
}

/** How long the opponent takes to write its rune, then how long it flies (1× speed). */
export const DRAW_MS = 3000;
export const FLIGHT_MS = 600;
/** Rune Parry shows this share of the opponent's stroke before hiding it: an opening, not the rune. */
export const GLIMPSE = 0.35;

/**
 * Combos: a starter rune, then a finisher that must counter the threat.
 * Specific pairs, so correcting a misread is never a combo by accident, and
 * chosen so every threat has a combo whose finisher answers it.
 */
export type Combo = "empower" | "reflect" | "siphon";
export const COMBOS: Record<Combo, { first: Rune; second: Rune; label: string }> = {
    // Aim with a Pierce, drive it with Power: the answer lands half again as hard.
    empower: { first: "line", second: "triangle", label: "EMPOWER" },
    // A Ward, then a Redirect: their blow is turned back on them.
    reflect: { first: "circle", second: "arc", label: "REFLECT" },
    // Absorb, then a Pierce: what you deal, you drink.
    siphon: { first: "spiral", second: "line", label: "SIPHON" }
};

export function comboOf(first: Rune, second: Rune): Combo | undefined {
    return (Object.keys(COMBOS) as Combo[]).find(name => COMBOS[name].first === first && COMBOS[name].second === second);
}

export type Exchange = {
    threat: Rune;
    startedAt: number;
    /** When the opponent finishes writing. */
    drawnAt: number;
    impactAt: number;
    /** Your answer: the rune that will meet theirs, its execution score, and when it was readied (a combo keeps its first rune's time). */
    readied?: { rune: Rune; score: number; at: number } | undefined;
    /** The rune before the readied one, when the pair formed a combo. */
    combo?: Combo | undefined;
};

/** A new exchange: `speed` is the game speed (2 = twice as fast). */
export function openExchange(threat: Rune, now: number, speed = 1): Exchange {
    const draw = DRAW_MS / speed;
    return { threat, startedAt: now, drawnAt: now + draw, impactAt: now + draw + FLIGHT_MS / speed };
}

// --- How the opponent writes: every rune from the same opening.
//
// All five begin as a flat stroke from the left, so the first strokes do not
// give the rune away. Then Redirect bows up and Absorb bows down, Ward curls
// back into a loop, Power turns at the corner at the end of its base, and
// Pierce simply stays flat to the end. The counter chart pairs them up
// (Pierce and Power share their answers, as do Redirect and Absorb), so a
// partial read is already worth something. Coordinates are a 100 x 70 box,
// y down, the same box as the Help cards; the HUD, the arena and the Help's
// diagram all draw these points.
export type StrokePoint = { x: number; y: number };

/** The shared start and the length every rune spends on the flat lead before any can differ. */
export const OPENING = { from: { x: 12, y: 50 }, length: 22 } as const;

const STROKE_POINTS = 64;

function sampleLine(a: StrokePoint, b: StrokePoint, n = 24): StrokePoint[] {
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}
function sampleQuad(a: StrokePoint, c: StrokePoint, b: StrokePoint, n = 48): StrokePoint[] {
    return Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n;
        const u = 1 - t;
        return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
    });
}
function sampleCubic(a: StrokePoint, c1: StrokePoint, c2: StrokePoint, b: StrokePoint, n = 48): StrokePoint[] {
    return Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n;
        const u = 1 - t;
        return {
            x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
        };
    });
}
/** Join pieces end to start, dropping each piece's repeated first point. */
const join = (...pieces: StrokePoint[][]): StrokePoint[] => pieces.flatMap((piece, i) => (i === 0 ? piece : piece.slice(1)));

/** Resample to `n` points evenly spaced along the stroke, so progress is a share of its length. */
function even(ps: StrokePoint[], n: number): StrokePoint[] {
    const lengths = [0];
    for (let i = 1; i < ps.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(ps[i]!.x - ps[i - 1]!.x, ps[i]!.y - ps[i - 1]!.y));
    const total = lengths.at(-1)!;
    const out: StrokePoint[] = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
        const target = (total * k) / (n - 1);
        while (j < ps.length - 1 && lengths[j]! < target) j++;
        const span = lengths[j]! - lengths[j - 1]! || 1;
        const t = (target - lengths[j - 1]!) / span;
        const round = (v: number): number => Math.round(v * 1000) / 1000;
        out.push({ x: round(ps[j - 1]!.x + (ps[j]!.x - ps[j - 1]!.x) * t), y: round(ps[j - 1]!.y + (ps[j]!.y - ps[j - 1]!.y) * t) });
    }
    return out;
}

const O = OPENING.from;
const LEAD_END = { x: O.x + OPENING.length, y: O.y };
export const STROKES: Record<Rune, readonly StrokePoint[]> = {
    // Flat all the way: the rune that is only known by not turning.
    line: even(sampleLine(O, { x: 88, y: O.y }), STROKE_POINTS),
    // The lead, then a bow up (and back down to the baseline).
    arc: even(join(sampleLine(O, LEAD_END), sampleQuad(LEAD_END, { x: 61, y: 2 }, { x: 88, y: O.y })), STROKE_POINTS),
    // The lead, then a bow down.
    spiral: even(join(sampleLine(O, LEAD_END), sampleQuad(LEAD_END, { x: 61, y: 82 }, { x: 88, y: O.y })), STROKE_POINTS),
    // The lead a little further, then curling up and back round to close where it began.
    circle: even(join(sampleLine(O, { x: 48, y: O.y }), sampleCubic({ x: 48, y: O.y }, { x: 80, y: O.y }, { x: 86, y: 10 }, { x: 50, y: 10 }), sampleCubic({ x: 50, y: 10 }, { x: 16, y: 10 }, { x: 12, y: 30 }, O)), STROKE_POINTS),
    // The base, flat like a Pierce, then the corner: up to the apex and back down to close.
    triangle: even(join(sampleLine(O, { x: 88, y: O.y }), sampleLine({ x: 88, y: O.y }, { x: 50, y: 8 }), sampleLine({ x: 50, y: 8 }, O)), STROKE_POINTS)
};

/** Where a stroke first leaves the flat lead, as a share of its length (the index of the first point off it). */
function leaves(stroke: readonly StrokePoint[]): number {
    for (let i = 1; i < stroke.length; i++) {
        if (Math.abs(stroke[i]!.y - O.y) > 1 || stroke[i]!.x < stroke[i - 1]!.x) return (i - 1) / (stroke.length - 1);
    }
    return 1;
}

/**
 * When each rune stops looking like the shared opening. Pierce never leaves
 * it, so it reads only once it has stayed flat past the point where Power
 * would have turned its corner.
 */
export const DIVERGE: Record<Rune, number> = (() => {
    const d = { line: 1, arc: leaves(STROKES.arc), spiral: leaves(STROKES.spiral), circle: leaves(STROKES.circle), triangle: leaves(STROKES.triangle) };
    return { ...d, line: Math.min(0.9, d.triangle + 0.1) };
})();

/** How long after leaving the opening a rune reads plainly. */
const NAMED_AFTER = 0.15;

/** How much of their rune is written: 0 at the start, 1 when it leaves their hand. */
export function progress(ex: Exchange, now: number): number {
    return Math.min(1, Math.max(0, (now - ex.startedAt) / (ex.drawnAt - ex.startedAt)));
}

/** How clearly their rune reads: the shared opening, the first sign of its shape, then plainly the rune. */
export function readStage(ex: Exchange, now: number): "sensing" | "hint" | "named" {
    const p = progress(ex, now);
    const d = DIVERGE[ex.threat];
    return p < d ? "sensing" : p < d + NAMED_AFTER ? "hint" : "named";
}

/** The share of the exchange still to come when your answer was readied: 1 at the start, 0 at impact. */
export function chargeOf(ex: Exchange): number {
    if (!ex.readied) return 0;
    return Math.min(1, Math.max(0, (ex.impactAt - ex.readied.at) / (ex.impactAt - ex.startedAt)));
}

/**
 * Ready a drawn rune. The first is your answer; a second that follows a
 * combo starter makes the combo (keeping the starter's charge); anything
 * else replaces the answer, a correction that restarts the charge.
 */
export function ready(ex: Exchange, rune: Rune, score: number, now: number): { exchange: Exchange; kind: "ready" | "replace" | "combo" | "late" } {
    if (now > ex.impactAt) return { exchange: ex, kind: "late" };
    const current = ex.readied;
    if (!current) return { exchange: { ...ex, readied: { rune, score, at: now }, combo: undefined }, kind: "ready" };
    const combo = ex.combo ? undefined : comboOf(current.rune, rune);
    if (combo) return { exchange: { ...ex, readied: { rune, score: (current.score + score) / 2, at: current.at }, combo }, kind: "combo" };
    return { exchange: { ...ex, readied: { rune, score, at: now }, combo: undefined }, kind: "replace" };
}

/** Their blow, when it lands on you. */
export const HIT_DAMAGE = 12;
/** Standing there with no rune ready is the worst answer. */
export const UNANSWERED_DAMAGE = 16;

export type Resolution = {
    outcome: "counter" | "fail" | "none";
    answer?: Rune | undefined;
    combo?: Combo | undefined;
    charge: number;
    damageToEnemy: number;
    damageToYou: number;
    heal: number;
};

/**
 * Impact: your readied rune against theirs. A counter deals 8-16 by stroke
 * quality, up to +60% for an early read; Empower adds half again, Reflect
 * adds their own blow, Siphon heals what it deals. A wrong rune takes a
 * lighter hit the cleaner it was drawn; no rune takes the full blow.
 */
export function resolveExchange(ex: Exchange): Resolution {
    const charge = chargeOf(ex);
    const answer = ex.readied;
    if (!answer) return { outcome: "none", charge: 0, damageToEnemy: 0, damageToYou: UNANSWERED_DAMAGE, heal: 0 };
    if (!beats(answer.rune, ex.threat)) {
        return { outcome: "fail", answer: answer.rune, combo: ex.combo, charge, damageToEnemy: 0, damageToYou: Math.round(7 + (1 - answer.score) * 7), heal: 0 };
    }
    let dealt = (8 + 8 * answer.score) * (1 + 0.6 * charge);
    if (ex.combo === "empower") dealt *= 1.5;
    if (ex.combo === "reflect") dealt += HIT_DAMAGE;
    const damageToEnemy = Math.round(dealt);
    return { outcome: "counter", answer: answer.rune, combo: ex.combo, charge, damageToEnemy, damageToYou: 0, heal: ex.combo === "siphon" ? damageToEnemy : 0 };
}

// --- Recognition: one stroke to a rune. Forgiving on purpose (the prototype's
// note): stroke quality scales power, it does not cancel a recognised cast.
export type Point = { x: number; y: number; t: number };

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(ps: readonly Point[]): number {
    let n = 0;
    for (let i = 1; i < ps.length; i++) n += dist(ps[i - 1]!, ps[i]!);
    return n;
}

/** The stroke resampled to `n` points evenly spaced along its length, so turning is measured per distance, not per sample. */
function resample(ps: readonly Point[], n: number): Point[] {
    const step = pathLength(ps) / (n - 1);
    const out: Point[] = [ps[0]!];
    let carried = 0;
    for (let i = 1; i < ps.length && out.length < n; i++) {
        let a = ps[i - 1]!;
        const b = ps[i]!;
        let seg = dist(a, b);
        while (carried + seg >= step && out.length < n) {
            const t = (step - carried) / seg;
            const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t: a.t + (b.t - a.t) * t };
            out.push(p);
            a = p;
            seg = dist(a, b);
            carried = 0;
        }
        carried += seg;
    }
    while (out.length < n) out.push(ps.at(-1)!);
    return out;
}

/** The sharpest turn over a short stretch of the resampled stroke: a triangle's corners spike, a loop turns evenly. */
function peakTurn(ps: readonly Point[], window = 2): number {
    const angles: number[] = [];
    for (let i = 1; i < ps.length; i++) angles.push(Math.atan2(ps[i]!.y - ps[i - 1]!.y, ps[i]!.x - ps[i - 1]!.x));
    let peak = 0;
    for (let i = window; i < angles.length; i++) {
        let d = angles[i]! - angles[i - window]!;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        peak = Math.max(peak, Math.abs(d));
    }
    return peak;
}

export function classify(ps: readonly Point[]): { rune: Rune | "unknown"; score: number; detail: string } {
    if (ps.length < 5) return { rune: "unknown", score: 0, detail: "too short" };
    const xs = ps.map(p => p.x);
    const ys = ps.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const diag = Math.hypot(w, h) || 1;
    const len = pathLength(ps);
    const closure = dist(ps[0]!, ps.at(-1)!) / diag;
    const straight = dist(ps[0]!, ps.at(-1)!) / (len || 1);
    let turns = 0;
    let totalTurn = 0;
    let last: number | undefined;
    for (let i = 1; i < ps.length; i++) {
        const a = Math.atan2(ps[i]!.y - ps[i - 1]!.y, ps[i]!.x - ps[i - 1]!.x);
        if (last !== undefined) {
            let d = a - last;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            totalTurn += d;
            if (Math.abs(d) > 0.42) turns++;
        }
        last = a;
    }
    const absTurn = Math.abs(totalTurn);
    const mid = ps[Math.floor(ps.length / 2)]!;
    const endY = (ps[0]!.y + ps.at(-1)!.y) / 2;
    const bend = (endY - mid.y) / diag;
    if (straight > 0.91) return { rune: "line", score: Math.min(1, straight), detail: `straight ${Math.round(straight * 100)}%` };
    if (closure < 0.24) {
        // Closed: corners make it Power, even when a blunt top pushes its total turning past a loop's.
        const cornered = peakTurn(resample(ps, 32)) > 1.3;
        if (!cornered && turns <= 8 && absTurn > 4.2 && absTurn < 8.1) return { rune: "circle", score: Math.max(0.62, 1 - closure), detail: `closure ${Math.round((1 - closure) * 100)}%` };
        return { rune: "triangle", score: Math.max(0.58, Math.min(1, 0.72 + (8 - Math.min(8, turns)) * 0.035)), detail: `corners ~${Math.max(3, turns)}` };
    }
    if (absTurn > 1.2) {
        const rune: Rune = bend >= 0 ? "arc" : "spiral";
        return { rune, score: Math.min(1, 0.62 + Math.min(0.3, Math.abs(bend))), detail: `${rune === "arc" ? "upward" : "downward"} bend ${Math.round(Math.abs(bend) * 100)}%` };
    }
    return { rune: "line", score: 0.58, detail: "open stroke" };
}
