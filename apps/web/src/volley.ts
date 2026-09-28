import type { Side } from "./stage.js";

/**
 * Volley (docs/arcade-duel-ideas.md §1 A): magic ping-pong over the gate.
 * One bolt, two mages, hearts and Focus. The bolt speeds up every return;
 * the wheel decides what a coloured return does; a miss burns hearts.
 *
 * A pure state machine over timestamps (ms): `tick` serves, arrives and
 * un-pauses when the clock says so, `act` records what a mage does during
 * the flight. The page draws the state and plays the events; the bot picks
 * its actions from `botActions`. Nothing here touches the DOM or WebGL, so
 * test/volley.test.mjs holds every rule.
 */
export type Essence = "fire" | "water" | "shadow" | "life";
export const ESSENCES: readonly Essence[] = ["fire", "water", "shadow", "life"];

/** The wheel: each essence and the one it beats. Water quenches fire, fire burns life, life banishes shadow, shadow drinks water. */
const BEATS: Record<Essence, Essence> = { water: "fire", fire: "life", life: "shadow", shadow: "water" };

export function beats(a: Essence, b: Essence): boolean {
    return BEATS[a] === b;
}

/** The essence that beats `e`. */
export function beaterOf(e: Essence): Essence {
    return (Object.keys(BEATS) as Essence[]).find(k => BEATS[k] === e) as Essence;
}

export const HEARTS = 5;
export const FOCUS = 7;
export const WARD_COST = 2;
export const SMASH_COST = 3;
export const WARD_INTEGRITY = 2;
export const MAX_SPEED = 6;
export const MAX_MAGNITUDE = 3;
/** The breath between a point and the next serve. */
export const PAUSE_MS = 900;

/** How long the bolt is in the air at a speed step: shorter as it speeds up, never under what a phone can follow. */
export function flightMs(speed: number): number {
    const s = Math.min(MAX_SPEED, Math.max(1, speed));
    return Math.max(450, 1400 - 150 * (s - 1));
}

/** The return window before arrival: narrower as speed rises, never under the touch-latency floor. */
export function windowMs(speed: number): number {
    const s = Math.min(MAX_SPEED, Math.max(1, speed));
    return Math.max(220, 450 - 30 * (s - 1));
}

export type Bolt = {
    owner: Side;
    to: Side;
    essence: Essence;
    speed: number;
    magnitude: number;
    launchedAt: number;
    arrivesAt: number;
};

export type Ward = { essence: Essence; integrity: number };

export type ReturnAction = { kind: "tap" } | { kind: "swipe"; essence: Essence };
export type Action = ReturnAction | { kind: "ward" } | { kind: "smash" };

export type VolleyState = {
    phase: "serve" | "flight" | "pause" | "over";
    hearts: Record<Side, number>;
    focus: Record<Side, number>;
    /** Each mage's colour: the last essence they swiped, which their serves and wards take. */
    colour: Record<Side, Essence>;
    /** Who serves next. */
    server: Side;
    bolt?: Bolt | undefined;
    /** A ward raised for the current return. */
    wards: Partial<Record<Side, Ward>>;
    /** A smash paid for and waiting for the return it doubles. */
    armed: Partial<Record<Side, "smash">>;
    /** The receiver's swing, recorded inside the window. */
    input: Partial<Record<Side, ReturnAction>>;
    pauseUntil?: number | undefined;
    winner?: Side | undefined;
    /** Clean returns this match. */
    exchanges: number;
};

export type VolleyEvent = {
    kind: "serve" | "return" | "quench" | "kindle" | "weak" | "block" | "shatter" | "hit" | "over" | "ward" | "smash";
    /** Whose action or whose body. */
    side: Side;
    essence?: Essence;
    magnitude?: number;
    speed?: number;
    hearts?: number;
};

export type Step = { state: VolleyState; events: VolleyEvent[] };

const other = (side: Side): Side => (side === "player" ? "opponent" : "player");

export function createVolley(server: Side = "opponent", colours: Partial<Record<Side, Essence>> = {}): VolleyState {
    return {
        phase: "serve",
        hearts: { player: HEARTS, opponent: HEARTS },
        focus: { player: FOCUS, opponent: FOCUS },
        colour: { player: colours.player ?? "shadow", opponent: colours.opponent ?? "fire" },
        server,
        wards: {},
        armed: {},
        input: {},
        exchanges: 0
    };
}

function launch(state: VolleyState, owner: Side, essence: Essence, speed: number, magnitude: number, now: number): VolleyState {
    const s = Math.min(MAX_SPEED, Math.max(1, speed));
    return {
        ...state,
        phase: "flight",
        bolt: { owner, to: other(owner), essence, speed: s, magnitude: Math.min(MAX_MAGNITUDE, Math.max(1, magnitude)), launchedAt: now, arrivesAt: now + flightMs(s) },
        input: {},
        pauseUntil: undefined
    };
}

/** The server puts the bolt in the air at speed 1 in their colour. */
export function serve(state: VolleyState, now: number): Step {
    if (state.phase === "over") return { state, events: [] };
    const next = launch(state, state.server, state.colour[state.server], 1, 1, now);
    return { state: next, events: [{ kind: "serve", side: state.server, essence: next.bolt!.essence, speed: 1 }] };
}

/** Is the receiver's return window open? */
export function windowOpen(state: VolleyState, now: number): boolean {
    const bolt = state.bolt;
    return state.phase === "flight" && bolt !== undefined && now >= bolt.arrivesAt - windowMs(bolt.speed) && now <= bolt.arrivesAt;
}

/**
 * What a mage does during the flight. Only the receiver can act. A ward or a
 * smash can be paid for any time before arrival; a swing counts only inside
 * the window (the last one wins).
 */
export function act(state: VolleyState, side: Side, action: Action, now: number): Step {
    const bolt = state.bolt;
    if (state.phase !== "flight" || !bolt || bolt.to !== side || now > bolt.arrivesAt) return { state, events: [] };
    switch (action.kind) {
        case "ward": {
            if (state.wards[side] || state.focus[side] < WARD_COST) return { state, events: [] };
            const ward: Ward = { essence: state.colour[side], integrity: WARD_INTEGRITY };
            return {
                state: { ...state, wards: { ...state.wards, [side]: ward }, focus: { ...state.focus, [side]: state.focus[side] - WARD_COST } },
                events: [{ kind: "ward", side, essence: ward.essence }]
            };
        }
        case "smash": {
            if (state.armed[side] || state.focus[side] < SMASH_COST) return { state, events: [] };
            return {
                state: { ...state, armed: { ...state.armed, [side]: "smash" }, focus: { ...state.focus, [side]: state.focus[side] - SMASH_COST } },
                events: [{ kind: "smash", side }]
            };
        }
        case "tap":
        case "swipe": {
            const colour = action.kind === "swipe" ? { ...state.colour, [side]: action.essence } : state.colour;
            if (!windowOpen(state, now)) return { state: { ...state, colour }, events: [] };
            return { state: { ...state, colour, input: { ...state.input, [side]: action } }, events: [] };
        }
        default:
            return { state, events: [] };
    }
}

/** The bolt reaches the receiver: ward, swing or miss. */
function arrive(state: VolleyState, now: number): Step {
    const bolt = state.bolt;
    if (!bolt) return { state, events: [] };
    const receiver = bolt.to;
    const events: VolleyEvent[] = [];
    let next: VolleyState = { ...state, wards: { ...state.wards }, armed: { ...state.armed }, input: {}, focus: { ...state.focus }, hearts: { ...state.hearts } };
    const ward = state.wards[receiver];
    delete next.wards[receiver];
    const swing = state.input[receiver];

    // The ward stands unless the bolt's colour beats it, or a kindled bolt of
    // its own colour comes through. A standing ward drops the bolt: the
    // blocker owns the next serve.
    if (ward && !beats(bolt.essence, ward.essence) && !(bolt.essence === ward.essence && bolt.magnitude >= 2)) {
        const remaining = ward.integrity - bolt.magnitude;
        events.push({ kind: remaining <= 0 ? "shatter" : "block", side: receiver, essence: bolt.essence, magnitude: bolt.magnitude });
        delete next.armed[receiver];
        return { state: { ...next, phase: "pause", bolt: undefined, server: receiver, pauseUntil: now + PAUSE_MS }, events };
    }

    if (!swing) {
        const hearts = Math.max(0, state.hearts[receiver] - bolt.magnitude);
        next.hearts[receiver] = hearts;
        delete next.armed[receiver];
        events.push({ kind: "hit", side: receiver, essence: bolt.essence, magnitude: bolt.magnitude, hearts });
        if (hearts === 0) {
            events.push({ kind: "over", side: bolt.owner });
            return { state: { ...next, phase: "over", bolt: undefined, winner: bolt.owner }, events };
        }
        return { state: { ...next, phase: "pause", bolt: undefined, server: bolt.owner, pauseUntil: now + PAUSE_MS }, events };
    }

    // The return.
    let essence = bolt.essence;
    let speed = bolt.speed + 1;
    let magnitude = bolt.magnitude;
    let kind: VolleyEvent["kind"] = "return";
    let clean = true;
    if (swing.kind === "swipe") {
        essence = swing.essence;
        if (beats(swing.essence, bolt.essence)) {
            kind = "quench";
            speed = 1;
            magnitude = 1;
        } else if (swing.essence === bolt.essence) {
            kind = "kindle";
            magnitude = bolt.magnitude + 1;
        } else if (beats(bolt.essence, swing.essence)) {
            kind = "weak";
            speed = Math.max(1, Math.floor(bolt.speed / 2));
            magnitude = 1;
            clean = false;
        }
    }
    if (clean) next.focus[receiver] = Math.min(FOCUS, state.focus[receiver] + 1);
    events.push({ kind, side: receiver, essence, speed: Math.min(MAX_SPEED, speed), magnitude: Math.min(MAX_MAGNITUDE, magnitude) });
    if (state.armed[receiver] === "smash") {
        speed = Math.min(MAX_SPEED, speed * 2);
        delete next.armed[receiver];
        events.push({ kind: "smash", side: receiver, speed });
    }
    next = launch(next, receiver, essence, speed, magnitude, now);
    next.exchanges = state.exchanges + 1;
    return { state: next, events };
}

/** Move the clock: serve when waiting, resolve the arrival when the bolt lands, serve again when the pause ends. */
export function tick(state: VolleyState, now: number): Step {
    switch (state.phase) {
        case "serve":
            return serve(state, now);
        case "flight":
            return state.bolt && now >= state.bolt.arrivesAt ? arrive(state, now) : { state, events: [] };
        case "pause":
            return state.pauseUntil !== undefined && now >= state.pauseUntil ? serve(state, now) : { state, events: [] };
        default:
            return { state, events: [] };
    }
}

/** Where the bolt is along its flight, 0 at the hand that threw it, 1 at the receiver. */
export function progress(state: VolleyState, now: number): number {
    const bolt = state.bolt;
    if (!bolt || state.phase !== "flight") return 0;
    return Math.min(1, Math.max(0, (now - bolt.launchedAt) / (bolt.arrivesAt - bolt.launchedAt)));
}

// --- The bot: personality as timing and tendency knobs.

type Tendency = { miss: number; quench: number; kindle: number; ward: number; smash: number; wild: number };

const TENDENCIES: Record<string, Tendency> = {
    balanced: { miss: 0.06, quench: 0.5, kindle: 0.2, ward: 0.25, smash: 0.2, wild: 0 },
    aggressor: { miss: 0.08, quench: 0.3, kindle: 0.35, ward: 0.05, smash: 0.5, wild: 0 },
    warden: { miss: 0.05, quench: 0.55, kindle: 0.1, ward: 0.6, smash: 0.05, wild: 0 },
    trickster: { miss: 0.1, quench: 0.35, kindle: 0.3, ward: 0.2, smash: 0.3, wild: 0.25 },
    gatekeeper: { miss: 0.07, quench: 0.45, kindle: 0.2, ward: 0.3, smash: 0.2, wild: 0 }
};

/**
 * What the bot does with the bolt coming at it, decided once per flight
 * when the window opens. Empty means it misses: its error grows with speed.
 */
export function botActions(state: VolleyState, personalityId: string, rng: { next(): number }): Action[] {
    const bolt = state.bolt;
    if (!bolt || state.phase !== "flight") return [];
    const me = bolt.to;
    const t = TENDENCIES[personalityId] ?? TENDENCIES.balanced!;
    const pMiss = Math.min(0.6, t.miss + 0.07 * (bolt.speed - 1));
    if (rng.next() < pMiss) return [];
    const actions: Action[] = [];
    let focus = state.focus[me];
    if (bolt.speed >= 3 && focus >= WARD_COST && !state.wards[me] && rng.next() < t.ward) {
        // A ward in the beating colour when it can, which is what makes it stand.
        const colour = beaterOf(bolt.essence);
        if (state.colour[me] !== colour) actions.push({ kind: "swipe", essence: colour });
        actions.push({ kind: "ward" });
        return actions;
    }
    if (focus >= SMASH_COST && rng.next() < t.smash) {
        actions.push({ kind: "smash" });
        focus -= SMASH_COST;
    }
    const roll = rng.next();
    if (roll < t.wild) actions.push({ kind: "swipe", essence: ESSENCES[Math.floor(rng.next() * ESSENCES.length)] as Essence });
    else if (roll < t.wild + t.quench) actions.push({ kind: "swipe", essence: beaterOf(bolt.essence) });
    else if (roll < t.wild + t.quench + t.kindle) actions.push({ kind: "swipe", essence: bolt.essence });
    else actions.push({ kind: "tap" });
    return actions;
}
