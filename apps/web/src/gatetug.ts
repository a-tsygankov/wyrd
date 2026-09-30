import type { Side } from "./stage.js";
import { beaterOf, beats, type Essence } from "./volley.js";
import * as qd from "./quickdraw.js";
import type { QuickdrawState } from "./quickdraw.js";

/**
 * Gate tug (docs/arcade-duel-ideas.md §1 D): Quickdraw's draw (a colour, a
 * charge or a ward inside the three-second ring), but when the ring closes
 * the orbs push the gate along a rail instead of costing hearts. Push it
 * into the enemy's circle to win.
 *
 * - The wheel decides whose push counts: the beating colour cancels the
 *   other's push; same or neutral colours both push and net out.
 * - The gate keeps a temper, the colour of the last push that moved it; a
 *   push must beat or match it to move the gate (Spellbreak's "play what is
 *   on the field").
 * - A ward throws nothing but blocks a push it is not beaten by.
 * - The comeback: within COMEBACK_STEPS of your own circle your push counts
 *   double (Nidhogg's tug of war).
 *
 * The draw itself is quickdraw.ts's, reused as is (`state.qd`); only the
 * clash is new. Pure over timestamps; test/gatetug.test.mjs holds the rules.
 */
/** Steps from the middle to either mage's circle. */
export const STEPS = 5;
/** Within this many steps of your own circle, your pushes count double. */
export const COMEBACK_STEPS = 1;
/** After this many rounds the side the gate leans away from wins; dead centre goes to sudden death. */
export const ROUND_LIMIT = 15;

export type GateTugState = {
    /** The draw: Quickdraw's ring, colours, charge, wards and Focus (its hearts are unused). */
    qd: QuickdrawState;
    /** -STEPS (the player's circle) .. +STEPS (the opponent's). */
    gate: number;
    /** The colour of the last push that moved the gate; none at the start. */
    temper?: Essence | undefined;
    suddenDeath: boolean;
};

export type GateTugEvent = {
    kind: "open" | "ward" | "fly" | "block" | "deflect" | "cancel" | "move" | "hold" | "sudden" | "over";
    side: Side;
    essence?: Essence;
    /** fly: the orb's magnitude; move: the steps (signed, positive toward the opponent). */
    magnitude?: number;
    gate?: number;
};

export type Step = { state: GateTugState; events: GateTugEvent[] };

const other = (side: Side): Side => (side === "player" ? "opponent" : "player");

export function createGateTug(colours: Partial<Record<Side, Essence>> = {}): GateTugState {
    return { qd: qd.createQuickdraw(colours), gate: 0, suddenDeath: false };
}

// The draw: Quickdraw's own moves on the nested state.
const lift = (state: GateTugState, r: { state: QuickdrawState; events: qd.QuickdrawEvent[] }): Step => ({
    state: { ...state, qd: r.state },
    events: r.events.filter(e => e.kind === "ward").map(e => ({ kind: "ward" as const, side: e.side, ...(e.essence ? { essence: e.essence } : {}) }))
});
export const choose = (state: GateTugState, side: Side, essence: Essence, now: number): Step => lift(state, qd.choose(state.qd, side, essence, now));
export const hold = (state: GateTugState, side: Side, now: number): Step => lift(state, qd.hold(state.qd, side, now));
export const release = (state: GateTugState, side: Side, now: number): Step => lift(state, qd.release(state.qd, side, now));
export const ward = (state: GateTugState, side: Side, now: number): Step => lift(state, qd.ward(state.qd, side, now));

type Orb = { essence: Essence; magnitude: number; cost: number };

function orbOf(state: QuickdrawState, side: Side, now: number): Orb | undefined {
    const draw = state.round.draws[side];
    if (!draw?.essence || draw.ward) return undefined;
    const charge = qd.chargeOf(state, side, now);
    return { essence: draw.essence, magnitude: Math.min(qd.MAX_MAGNITUDE, charge + (draw.quick ? 1 : 0)), cost: charge - 1 };
}

/** Whether a push in `essence` can move a gate tempered `temper`: it must beat or match it. */
export function moves(essence: Essence, temper: Essence | undefined): boolean {
    return temper === undefined || essence === temper || beats(essence, temper);
}

/** The ring closes: both orbs fly at the gate and the wheel, the wards, the temper and the comeback decide how far it moves. */
function resolve(state: GateTugState, now: number): Step {
    const events: GateTugEvent[] = [];
    const draw = state.qd;
    const orbs: Record<Side, Orb | undefined> = { player: orbOf(draw, "player", now), opponent: orbOf(draw, "opponent", now) };
    const focus = { ...draw.focus };
    const push: Record<Side, number> = { player: 0, opponent: 0 };
    for (const side of ["player", "opponent"] as const) {
        const orb = orbs[side];
        if (!orb) continue;
        focus[side] -= orb.cost;
        events.push({ kind: "fly", side, essence: orb.essence, magnitude: orb.magnitude });
        push[side] = orb.magnitude;
    }
    const p = orbs.player;
    const o = orbs.opponent;
    // The wheel between the orbs: the beating colour cancels the other's push.
    if (p && o && beats(p.essence, o.essence)) {
        push.opponent = 0;
        events.push({ kind: "cancel", side: "opponent", essence: o.essence });
    } else if (p && o && beats(o.essence, p.essence)) {
        push.player = 0;
        events.push({ kind: "cancel", side: "player", essence: p.essence });
    }
    for (const side of ["player", "opponent"] as const) {
        const orb = orbs[side];
        if (!orb || push[side] === 0) continue;
        // A ward on the other side blocks a push it is not beaten by (its own colour passes, as in Quickdraw).
        const target = other(side);
        if (draw.round.draws[target]?.ward) {
            const guard = draw.colour[target];
            if (!beats(orb.essence, guard) && orb.essence !== guard) {
                push[side] = 0;
                events.push({ kind: "block", side: target, essence: orb.essence, magnitude: orb.magnitude });
                continue;
            }
        }
        if (!moves(orb.essence, state.temper)) {
            push[side] = 0;
            events.push({ kind: "deflect", side, essence: orb.essence, magnitude: orb.magnitude });
            continue;
        }
        // The comeback: near your own circle your push counts double.
        const home = side === "player" ? -STEPS : STEPS;
        if (Math.abs(state.gate - home) <= COMEBACK_STEPS) push[side] *= 2;
    }
    const net = push.player - push.opponent;
    const gate = Math.max(-STEPS, Math.min(STEPS, state.gate + net));
    const mover: Side | undefined = net > 0 ? "player" : net < 0 ? "opponent" : undefined;
    const temper = mover ? orbs[mover]!.essence : state.temper;
    events.push(mover ? { kind: "move", side: mover, magnitude: net, gate, essence: temper! } : { kind: "hold", side: "player", gate });
    for (const side of ["player", "opponent"] as const) focus[side] = Math.min(qd.FOCUS, focus[side] + qd.REFILL);

    const next: GateTugState = { ...state, gate, temper };
    let winner: Side | undefined;
    if (Math.abs(gate) >= STEPS) winner = gate > 0 ? "player" : "opponent";
    else if (state.suddenDeath && mover) winner = mover;
    else if (!state.suddenDeath && draw.round.number >= ROUND_LIMIT) {
        if (gate !== 0) winner = gate > 0 ? "player" : "opponent";
        else {
            next.suddenDeath = true;
            events.push({ kind: "sudden", side: "player" });
        }
    }
    if (winner) {
        events.push({ kind: "over", side: winner });
        return { state: { ...next, qd: { ...draw, phase: "over", focus, winner } }, events };
    }
    return { state: { ...next, qd: { ...draw, phase: "pause", focus, pauseUntil: now + qd.PAUSE_MS } }, events };
}

/** Move the clock: Quickdraw opens and reopens the ring; the close is the gate's clash. */
export function tick(state: GateTugState, now: number): Step {
    const draw = state.qd;
    if (draw.phase === "draw") return now >= draw.round.startedAt + qd.RING_MS ? resolve(state, draw.round.startedAt + qd.RING_MS) : { state, events: [] };
    const r = qd.tick(draw, now);
    return { state: { ...state, qd: r.state }, events: r.events.filter(e => e.kind === "open").map(e => ({ kind: "open" as const, side: e.side })) };
}

/**
 * The bot's draw: Quickdraw's personality plan, then fitted to the gate. It
 * wards mostly when the gate is near its own circle, and an orb that cannot
 * move the tempered gate is usually swapped for one that can, the colour
 * that beats the temper or the temper itself.
 */
export function botDraw(state: GateTugState, personalityId: string, rng: { next(): number }): qd.BotPlan {
    let plan = qd.botDraw(state.qd, personalityId, rng);
    // A ward never pushes: far from its own circle the bot usually draws instead.
    if (plan.ward && state.gate < STEPS - 2 && rng.next() < 0.7) {
        const essence = state.temper ? (rng.next() < 0.6 ? beaterOf(state.temper) : state.temper) : state.qd.colour.opponent;
        plan = { essence, quick: false, charge: 1 };
    }
    if (plan.ward || !plan.essence || moves(plan.essence, state.temper) || rng.next() < 0.15) return plan;
    return { ...plan, essence: rng.next() < 0.6 ? beaterOf(state.temper!) : state.temper! };
}

/** How often each personality answers an orb it can already see; the rest keep their plan. */
const ANSWER: Record<string, number> = { balanced: 0.6, aggressor: 0.35, warden: 0.55, trickster: 0.4, gatekeeper: 0.65 };

/**
 * The late draw's read: if you have already shown an orb (a quick draw), the
 * bot may swap its planned colour for the one that beats yours, as long as
 * that colour can move the gate. Nothing shown, or no move: the plan stands.
 */
export function botAnswer(state: GateTugState, personalityId: string, rng: { next(): number }, planned: Essence): Essence {
    const shown = state.qd.round.draws.player;
    if (!shown?.essence || shown.ward) return planned;
    const answer = beaterOf(shown.essence);
    if (!moves(answer, state.temper)) return planned;
    return rng.next() < (ANSWER[personalityId] ?? ANSWER.balanced!) ? answer : planned;
}
