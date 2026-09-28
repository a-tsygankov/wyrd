import type { Side } from "./stage.js";
import { beaterOf, beats, ESSENCES, type Essence } from "./volley.js";

/**
 * Quickdraw (docs/arcade-duel-ideas.md §1 C): both mages draw once inside a
 * three-second ring. Swipe a colour, hold to charge, tap to ward. When the
 * ring closes both orbs fly and the wheel and the charge decide the clash.
 * The orb is the telegraph: the opponent watches it grow.
 *
 * Pure over timestamps like volley.ts; the page draws the state and plays
 * the events, the bot's plan comes from `botDraw`.
 */
export const RING_MS = 3000;
/** A colour chosen inside the first second is a quick draw: +1 magnitude, chosen blind. */
export const QUICK_MS = 1000;
/** Holding adds a charge step per this long. */
export const CHARGE_STEP_MS = 1000;
export const HEARTS = 5;
export const FOCUS = 7;
export const WARD_COST = 2;
export const WARD_INTEGRITY = 2;
export const MAX_CHARGE = 3;
export const MAX_MAGNITUDE = 3;
/** Focus back at the end of every round. */
export const REFILL = 2;
export const PAUSE_MS = 900;

export type Draw = {
    essence?: Essence | undefined;
    /** Chosen inside the first second and never changed after it. */
    quick: boolean;
    chosenAt?: number | undefined;
    /** Holding since; undefined when released. */
    holdFrom?: number | undefined;
    /** Charge steps banked by releases (1 = none). */
    charge: number;
    ward?: true | undefined;
};

export type Round = { number: number; startedAt: number; draws: Partial<Record<Side, Draw>> };

export type QuickdrawState = {
    phase: "open" | "draw" | "pause" | "over";
    hearts: Record<Side, number>;
    focus: Record<Side, number>;
    /** Each mage's colour: the last one they drew, which their ward takes. */
    colour: Record<Side, Essence>;
    round: Round;
    pauseUntil?: number | undefined;
    winner?: Side | undefined;
};

export type QuickdrawEvent = {
    kind: "open" | "ward" | "fly" | "hit" | "block" | "shatter" | "cancel" | "over";
    side: Side;
    essence?: Essence;
    magnitude?: number;
    hearts?: number;
};

export type Step = { state: QuickdrawState; events: QuickdrawEvent[] };

const other = (side: Side): Side => (side === "player" ? "opponent" : "player");
const EMPTY: Draw = { quick: false, charge: 1 };

export function createQuickdraw(colours: Partial<Record<Side, Essence>> = {}): QuickdrawState {
    return {
        phase: "open",
        hearts: { player: HEARTS, opponent: HEARTS },
        focus: { player: FOCUS, opponent: FOCUS },
        colour: { player: colours.player ?? "shadow", opponent: colours.opponent ?? "fire" },
        round: { number: 0, startedAt: 0, draws: {} }
    };
}

function inRing(state: QuickdrawState, now: number): boolean {
    return state.phase === "draw" && now >= state.round.startedAt && now < state.round.startedAt + RING_MS;
}

function withDraw(state: QuickdrawState, side: Side, draw: Draw): QuickdrawState {
    return { ...state, round: { ...state.round, draws: { ...state.round.draws, [side]: draw } } };
}

/** Pick the orb's colour. Inside the first second it is a quick draw; a change after that loses the bonus. A ward already raised is refunded. */
export function choose(state: QuickdrawState, side: Side, essence: Essence, now: number): Step {
    if (!inRing(state, now)) return { state, events: [] };
    const current = state.round.draws[side] ?? EMPTY;
    let focus = state.focus;
    if (current.ward) focus = { ...focus, [side]: Math.min(FOCUS, focus[side] + WARD_COST) };
    const quick = now - state.round.startedAt < QUICK_MS;
    const draw: Draw = { ...current, essence, quick, chosenAt: now };
    delete draw.ward;
    return { state: { ...withDraw(state, side, draw), focus, colour: { ...state.colour, [side]: essence } }, events: [] };
}

/** Start holding: the charge grows a step per second while held. */
export function hold(state: QuickdrawState, side: Side, now: number): Step {
    if (!inRing(state, now)) return { state, events: [] };
    const current = state.round.draws[side] ?? EMPTY;
    if (current.ward || current.holdFrom !== undefined) return { state, events: [] };
    return { state: withDraw(state, side, { ...current, holdFrom: now }), events: [] };
}

/** The orb's charge right now: banked steps plus the hold in progress, capped at 3 and by the Focus the steps will cost. */
export function chargeOf(state: QuickdrawState, side: Side, now: number): number {
    const draw = state.round.draws[side] ?? EMPTY;
    const held = draw.holdFrom !== undefined ? Math.floor(Math.max(0, now - draw.holdFrom) / CHARGE_STEP_MS) : 0;
    return Math.min(MAX_CHARGE, 1 + state.focus[side], draw.charge + held);
}

/** Stop holding; the charge so far is banked. */
export function release(state: QuickdrawState, side: Side, now: number): Step {
    const current = state.round.draws[side];
    if (!current || current.holdFrom === undefined) return { state, events: [] };
    const charge = chargeOf(state, side, Math.min(now, state.round.startedAt + RING_MS));
    const draw: Draw = { ...current, charge };
    delete draw.holdFrom;
    return { state: withDraw(state, side, draw), events: [] };
}

/** Raise a ward in your colour instead of drawing (2 Focus). */
export function ward(state: QuickdrawState, side: Side, now: number): Step {
    if (!inRing(state, now)) return { state, events: [] };
    const current = state.round.draws[side] ?? EMPTY;
    if (current.ward || state.focus[side] < WARD_COST) return { state, events: [] };
    const draw: Draw = { quick: false, charge: 1, ward: true };
    return {
        state: { ...withDraw(state, side, draw), focus: { ...state.focus, [side]: state.focus[side] - WARD_COST } },
        events: [{ kind: "ward", side, essence: state.colour[side] }]
    };
}

type Orb = { essence: Essence; magnitude: number; cost: number };

function orbOf(state: QuickdrawState, side: Side, now: number): Orb | undefined {
    const draw = state.round.draws[side];
    if (!draw?.essence || draw.ward) return undefined;
    const charge = chargeOf(state, side, now);
    return { essence: draw.essence, magnitude: Math.min(MAX_MAGNITUDE, charge + (draw.quick ? 1 : 0)), cost: charge - 1 };
}

/** The ring closes: orbs fly, wards stand or fall, hearts fall. */
function resolve(state: QuickdrawState, now: number): Step {
    const events: QuickdrawEvent[] = [];
    const orbs: Record<Side, Orb | undefined> = { player: orbOf(state, "player", now), opponent: orbOf(state, "opponent", now) };
    const hearts = { ...state.hearts };
    const focus = { ...state.focus };
    for (const side of ["player", "opponent"] as const) {
        const orb = orbs[side];
        if (orb) {
            focus[side] -= orb.cost;
            events.push({ kind: "fly", side, essence: orb.essence, magnitude: orb.magnitude });
        }
    }
    const land = (target: Side, orb: Orb): void => {
        const guard = state.round.draws[target]?.ward ? { essence: state.colour[target], integrity: WARD_INTEGRITY } : undefined;
        if (guard && !beats(orb.essence, guard.essence) && orb.essence !== guard.essence) {
            events.push({ kind: guard.integrity - orb.magnitude <= 0 ? "shatter" : "block", side: target, essence: orb.essence, magnitude: orb.magnitude });
            return;
        }
        hearts[target] = Math.max(0, hearts[target] - orb.magnitude);
        events.push({ kind: "hit", side: target, essence: orb.essence, magnitude: orb.magnitude, hearts: hearts[target] });
    };
    const p = orbs.player;
    const o = orbs.opponent;
    if (p && o) {
        if (beats(p.essence, o.essence)) land("opponent", p);
        else if (beats(o.essence, p.essence)) land("player", o);
        else if (p.essence === o.essence) {
            if (p.magnitude > o.magnitude) land("opponent", p);
            else if (o.magnitude > p.magnitude) land("player", o);
            else events.push({ kind: "cancel", side: "player" });
        } else {
            land("opponent", p);
            land("player", o);
        }
    } else if (p) land("opponent", p);
    else if (o) land("player", o);
    else events.push({ kind: "cancel", side: "player" });

    const dead = (["player", "opponent"] as const).filter(side => hearts[side] === 0);
    if (dead.length > 0) {
        // Both at zero in one clash: the one with the bigger orb takes it, else the player.
        const winner: Side = dead.length === 2 ? ((p?.magnitude ?? 0) >= (o?.magnitude ?? 0) ? "player" : "opponent") : other(dead[0] as Side);
        events.push({ kind: "over", side: winner });
        return { state: { ...state, phase: "over", hearts, focus, winner }, events };
    }
    for (const side of ["player", "opponent"] as const) focus[side] = Math.min(FOCUS, focus[side] + REFILL);
    return { state: { ...state, phase: "pause", hearts, focus, pauseUntil: now + PAUSE_MS }, events };
}

function openRound(state: QuickdrawState, now: number): Step {
    const round: Round = { number: state.round.number + 1, startedAt: now, draws: {} };
    return { state: { ...state, phase: "draw", round, pauseUntil: undefined }, events: [{ kind: "open", side: "player" }] };
}

/** Move the clock: open the first round, close the ring, reopen after the pause. */
export function tick(state: QuickdrawState, now: number): Step {
    switch (state.phase) {
        case "open":
            return openRound(state, now);
        case "draw":
            return now >= state.round.startedAt + RING_MS ? resolve(state, state.round.startedAt + RING_MS) : { state, events: [] };
        case "pause":
            return state.pauseUntil !== undefined && now >= state.pauseUntil ? openRound(state, now) : { state, events: [] };
        default:
            return { state, events: [] };
    }
}

/** How far the ring has closed, 0 to 1. */
export function ringProgress(state: QuickdrawState, now: number): number {
    if (state.phase !== "draw") return 0;
    return Math.min(1, Math.max(0, (now - state.round.startedAt) / RING_MS));
}

// --- The bot: a plan for the round, applied by the page across the ring.

export type BotPlan = { essence?: Essence; quick?: boolean; charge?: number; ward?: boolean };

type Tendency = { answer: number; ward: number; charge: number; quick: number; wild: number };
const TENDENCIES: Record<string, Tendency> = {
    balanced: { answer: 0.55, ward: 0.15, charge: 0.3, quick: 0.25, wild: 0 },
    aggressor: { answer: 0.4, ward: 0.05, charge: 0.6, quick: 0.5, wild: 0 },
    warden: { answer: 0.5, ward: 0.45, charge: 0.15, quick: 0.15, wild: 0 },
    trickster: { answer: 0.3, ward: 0.2, charge: 0.35, quick: 0.3, wild: 0.3 },
    gatekeeper: { answer: 0.5, ward: 0.2, charge: 0.3, quick: 0.25, wild: 0 }
};

/**
 * The bot's draw for this round: a ward, or a colour (the one that beats
 * your last colour more often than not; a quick draw guesses blind) and a
 * charge when it can afford one. Seeded through the rng.
 */
export function botDraw(state: QuickdrawState, personalityId: string, rng: { next(): number }): BotPlan {
    const t = TENDENCIES[personalityId] ?? TENDENCIES.balanced!;
    const me: Side = "opponent";
    if (state.focus[me] >= WARD_COST && rng.next() < t.ward) return { ward: true };
    const quick = rng.next() < t.quick;
    const roll = rng.next();
    let essence: Essence;
    if (quick || roll < t.wild) essence = ESSENCES[Math.floor(rng.next() * ESSENCES.length)] as Essence;
    else if (roll < t.wild + t.answer) essence = beaterOf(state.colour.player);
    else essence = state.colour[me];
    const canCharge = Math.min(MAX_CHARGE, 1 + state.focus[me]);
    const charge = canCharge > 1 && rng.next() < t.charge ? Math.min(canCharge, 2 + (rng.next() < 0.4 ? 1 : 0)) : 1;
    return { essence, quick, charge };
}
