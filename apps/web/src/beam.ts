import type { Side } from "./stage.js";
import { beaterOf, beats, ESSENCES, type Essence } from "./volley.js";

/**
 * Beam clash (docs/arcade-duel-ideas.md §1 B): both mages fire a beam and the
 * beams meet in a knot over the gate. A tap on the beat pushes the knot a
 * step toward the other mage; the colour that beats the other's pushes
 * double, a perfect tap pushes two; a ward at a mage's end absorbs the knot for its integrity; a knot
 * pushed into a mage scores a seal. Rhythm, not mashing: an off-beat tap
 * pushes nothing and costs Focus.
 *
 * Pure over timestamps like volley.ts: `tick` opens the clash and resolves
 * each beat as its window closes, `act` records taps, switches and wards.
 * test/beam.test.mjs holds every rule.
 */
/** 100 bpm. */
export const BEAT_MS = 600;
/** Either side of a beat: 220 ms in all, wide enough for 60-100 ms of touch latency. */
export const BEAT_WINDOW_MS = 110;
/** A tap this close to the beat is perfect and pushes two: rhythm, not just presence, moves the knot. */
export const PERFECT_MS = 50;
/** A four-beat count-in before the first push: time to get a thumb from Start to Push. */
export const LEAD_MS = 4 * BEAT_MS;
/** The knot runs from -STEPS (the player's end) to +STEPS (the opponent's). */
export const STEPS = 3;
export const SEALS_TO_WIN = 3;
export const FOCUS = 7;
export const WARD_COST = 2;
export const WARD_INTEGRITY = 2;
/** The first switch in a clash is free; each one after costs this. */
export const SWITCH_COST = 2;
export const OFFBEAT_COST = 1;
/** A switch recolours the beam over this long before it counts, so the other side sees it coming. */
export const SWITCH_MS = 300;
export const MATCH_MS = 90_000;
export const PAUSE_MS = 1200;

export type BeamAction = { kind: "tap" } | { kind: "switch"; essence: Essence } | { kind: "ward" };

export type BeamState = {
    phase: "open" | "clash" | "pause" | "over";
    /** When the match clock started (the first open). */
    clockStart: number;
    /** When beat 0 of this clash lands. */
    startedAt: number;
    /** The next beat to resolve. */
    beat: number;
    /** -STEPS..STEPS, positive toward the opponent. */
    knot: number;
    seals: Record<Side, number>;
    focus: Record<Side, number>;
    colour: Record<Side, Essence>;
    /** A switch on its way: the colour and when it lands. */
    pending: Partial<Record<Side, { essence: Essence; at: number }>>;
    switches: Record<Side, number>;
    wards: Partial<Record<Side, { integrity: number }>>;
    wardUsed: Record<Side, boolean>;
    /** Each side's tap on the beat about to resolve, and whether it was perfect. */
    taps: Partial<Record<Side, { beat: number; perfect: boolean }>>;
    suddenDeath: boolean;
    pauseUntil?: number | undefined;
    winner?: Side | undefined;
};

export type BeamEvent = {
    kind: "open" | "push" | "offbeat" | "switch" | "ward" | "block" | "shatter" | "seal" | "sudden" | "over";
    side: Side;
    essence?: Essence;
    /** push: the net steps (signed, positive toward the opponent); block: the dent. */
    magnitude?: number;
    knot?: number;
};

export type Step = { state: BeamState; events: BeamEvent[] };

const other = (side: Side): Side => (side === "player" ? "opponent" : "player");

export function createBeam(colours: Partial<Record<Side, Essence>> = {}): BeamState {
    return {
        phase: "open",
        clockStart: 0,
        startedAt: 0,
        beat: 0,
        knot: 0,
        seals: { player: 0, opponent: 0 },
        focus: { player: FOCUS, opponent: FOCUS },
        colour: { player: colours.player ?? "shadow", opponent: colours.opponent ?? "fire" },
        pending: {},
        switches: { player: 0, opponent: 0 },
        wards: {},
        wardUsed: { player: false, opponent: false },
        taps: {},
        suddenDeath: false
    };
}

export const beatTime = (state: BeamState, b: number): number => state.startedAt + b * BEAT_MS;

/** Whether `now` is inside the window of the beat about to resolve (the ring pulses then). */
export function onBeat(state: BeamState, now: number): boolean {
    return state.phase === "clash" && Math.abs(now - beatTime(state, state.beat)) <= BEAT_WINDOW_MS;
}

/** Fold in the switches that have landed by `now`. */
function landSwitches(state: BeamState, now: number): BeamState {
    let colour = state.colour;
    let pending = state.pending;
    for (const side of ["player", "opponent"] as const) {
        const p = pending[side];
        if (p && now >= p.at) {
            colour = { ...colour, [side]: p.essence };
            pending = { ...pending };
            delete pending[side];
        }
    }
    return colour === state.colour ? state : { ...state, colour, pending };
}

export function act(state: BeamState, side: Side, action: BeamAction, now: number): Step {
    if (state.phase !== "clash") return { state, events: [] };
    switch (action.kind) {
        case "tap": {
            const at = beatTime(state, state.beat);
            // The count-in and the gap before the first window are free: nothing to miss yet.
            if (now < state.startedAt - BEAT_WINDOW_MS) return { state, events: [] };
            if (Math.abs(now - at) <= BEAT_WINDOW_MS) {
                if (state.taps[side]?.beat === state.beat) return { state, events: [] };
                return { state: { ...state, taps: { ...state.taps, [side]: { beat: state.beat, perfect: Math.abs(now - at) <= PERFECT_MS } } }, events: [] };
            }
            if (state.focus[side] <= 0) return { state, events: [] };
            return { state: { ...state, focus: { ...state.focus, [side]: state.focus[side] - OFFBEAT_COST } }, events: [{ kind: "offbeat", side }] };
        }
        case "switch": {
            const target = state.pending[side]?.essence ?? state.colour[side];
            if (action.essence === target) return { state, events: [] };
            const cost = state.switches[side] >= 1 ? SWITCH_COST : 0;
            if (state.focus[side] < cost) return { state, events: [] };
            return {
                state: {
                    ...state,
                    pending: { ...state.pending, [side]: { essence: action.essence, at: now + SWITCH_MS } },
                    switches: { ...state.switches, [side]: state.switches[side] + 1 },
                    focus: { ...state.focus, [side]: state.focus[side] - cost }
                },
                events: [{ kind: "switch", side, essence: action.essence }]
            };
        }
        case "ward": {
            if (state.wardUsed[side] || state.focus[side] < WARD_COST) return { state, events: [] };
            return {
                state: {
                    ...state,
                    wards: { ...state.wards, [side]: { integrity: WARD_INTEGRITY } },
                    wardUsed: { ...state.wardUsed, [side]: true },
                    focus: { ...state.focus, [side]: state.focus[side] - WARD_COST }
                },
                events: [{ kind: "ward", side, essence: state.colour[side] }]
            };
        }
        default:
            return { state, events: [] };
    }
}

/** A new clash after a seal: the knot a step toward the mage who was scored on. */
function openClash(state: BeamState, now: number, knot: number): BeamState {
    return { ...state, phase: "clash", startedAt: now + BEAT_MS, beat: 0, knot, wards: {}, wardUsed: { player: false, opponent: false }, switches: { player: 0, opponent: 0 }, taps: {}, pauseUntil: undefined };
}

/** Resolve the beat about to close: both pushes, the wheel, the ends. */
function resolveBeat(state: BeamState): Step {
    const events: BeamEvent[] = [];
    const push = (side: Side): number => {
        const t = state.taps[side];
        if (t?.beat !== state.beat) return 0;
        return (t.perfect ? 2 : 1) * (beats(state.colour[side], state.colour[other(side)]) ? 2 : 1);
    };
    const net = push("player") - push("opponent");
    let next: BeamState = { ...state, beat: state.beat + 1, taps: {} };
    if (net === 0) return { state: next, events };
    const moved = state.knot + net;
    const knot = Math.max(-STEPS, Math.min(STEPS, moved));
    const overflow = Math.abs(moved) - STEPS;
    next = { ...next, knot };
    events.push({ kind: "push", side: net > 0 ? "player" : "opponent", magnitude: net, knot, essence: state.colour[net > 0 ? "player" : "opponent"] });
    if (overflow <= 0) return { state: next, events };

    // Past the end: the ward takes it, or the mage does.
    const target: Side = net > 0 ? "opponent" : "player";
    const scorer = other(target);
    const ward = state.wards[target];
    if (ward) {
        const integrity = ward.integrity - overflow;
        const wards = { ...state.wards };
        if (integrity <= 0) delete wards[target];
        else wards[target] = { integrity };
        events.push({ kind: integrity <= 0 ? "shatter" : "block", side: target, magnitude: overflow, essence: state.colour[scorer] });
        return { state: { ...next, wards }, events };
    }
    const seals = { ...state.seals, [scorer]: state.seals[scorer] + 1 };
    const focus = { ...state.focus, [target]: Math.min(FOCUS, state.focus[target] + 1) };
    events.push({ kind: "seal", side: scorer, magnitude: seals[scorer], essence: state.colour[scorer] });
    if (seals[scorer] >= SEALS_TO_WIN || state.suddenDeath) {
        events.push({ kind: "over", side: scorer });
        return { state: { ...next, seals, focus, phase: "over", winner: scorer }, events };
    }
    return { state: { ...next, seals, focus, phase: "pause", knot: target === "opponent" ? 1 : -1, wards: {} }, events };
}

/** Move the clock: open the match, resolve every beat whose window has closed, resume after a seal, call time. */
export function tick(state: BeamState, now: number): Step {
    if (state.phase === "over") return { state, events: [] };
    if (state.phase === "open") {
        return { state: { ...state, phase: "clash", clockStart: now, startedAt: now + LEAD_MS, beat: 0 }, events: [{ kind: "open", side: "player" }] };
    }
    const events: BeamEvent[] = [];
    let s = landSwitches(state, now);
    // Catch up on every beat whose window has closed (a slow frame can skip one).
    while (s.phase === "clash" && now > beatTime(s, s.beat) + BEAT_WINDOW_MS) {
        s = landSwitches(s, beatTime(s, s.beat));
        const r = resolveBeat(s);
        s = r.state;
        events.push(...r.events);
        if (s.phase === "pause") s = { ...s, pauseUntil: beatTime(s, s.beat - 1) + BEAT_WINDOW_MS + PAUSE_MS };
    }
    if (s.phase === "pause" && s.pauseUntil !== undefined && now >= s.pauseUntil) s = openClash(s, s.pauseUntil, s.knot);
    // Time: the leader wins; level goes to sudden death.
    if (s.phase !== "over" && !s.suddenDeath && now >= s.clockStart + MATCH_MS) {
        if (s.seals.player !== s.seals.opponent) {
            const winner: Side = s.seals.player > s.seals.opponent ? "player" : "opponent";
            events.push({ kind: "over", side: winner });
            s = { ...s, phase: "over", winner };
        } else {
            events.push({ kind: "sudden", side: "player" });
            s = { ...s, suddenDeath: true };
        }
    }
    return { state: s, events };
}

/** Seconds left on the match clock (0 in sudden death). */
export function timeLeft(state: BeamState, now: number): number {
    if (state.phase === "open") return MATCH_MS / 1000;
    return Math.max(0, Math.ceil((state.clockStart + MATCH_MS - now) / 1000));
}

/** accuracy: beats landed; perfect: the share of those inside PERFECT_MS. */
type Tendency = { accuracy: number; perfect: number; answer: number; ward: number; wild: number };
const TENDENCIES: Record<string, Tendency> = {
    balanced: { accuracy: 0.8, perfect: 0.4, answer: 0.5, ward: 0.5, wild: 0 },
    aggressor: { accuracy: 0.86, perfect: 0.45, answer: 0.25, ward: 0.1, wild: 0 },
    warden: { accuracy: 0.8, perfect: 0.38, answer: 0.45, ward: 0.9, wild: 0 },
    trickster: { accuracy: 0.82, perfect: 0.42, answer: 0.35, ward: 0.4, wild: 0.03 },
    gatekeeper: { accuracy: 0.8, perfect: 0.4, answer: 0.45, ward: 0.6, wild: 0 }
};

export type BeamPlan = { tap: false | "good" | "perfect"; switchTo?: Essence; ward?: boolean };

/**
 * The bot's play for the coming beat: whether it lands the tap (its accuracy
 * is the difficulty knob), whether it answers a losing wheel by switching to
 * the colour that beats yours, and whether it wards with the knot a step
 * from its end. Seeded through the rng.
 */
export function botBeat(state: BeamState, personalityId: string, rng: { next(): number }): BeamPlan {
    const t = TENDENCIES[personalityId] ?? TENDENCIES.balanced!;
    const me: Side = "opponent";
    const plan: BeamPlan = { tap: rng.next() < t.accuracy ? (rng.next() < t.perfect ? "perfect" : "good") : false };
    const mine = state.pending[me]?.essence ?? state.colour[me];
    const theirs = state.pending.player?.essence ?? state.colour.player;
    const affordable = state.switches[me] === 0 || state.focus[me] >= SWITCH_COST;
    if (affordable && beats(theirs, mine) && rng.next() < t.answer) plan.switchTo = beaterOf(theirs);
    else if (affordable && t.wild > 0 && rng.next() < t.wild) {
        const choice = ESSENCES[Math.floor(rng.next() * ESSENCES.length)] as Essence;
        if (choice !== mine) plan.switchTo = choice;
    }
    if (!state.wardUsed[me] && state.focus[me] >= WARD_COST && state.knot >= STEPS - 1 && rng.next() < t.ward) plan.ward = true;
    return plan;
}
