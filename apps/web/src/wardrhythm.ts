import type { Side } from "./stage.js";
import { beaterOf, beats, ESSENCES, type Essence } from "./volley.js";

/**
 * Ward rhythm (docs/arcade-duel-ideas.md §1 E): protego on a beat. The
 * opponent's volley lands on a rhythm and you tap the colour that beats each
 * bolt as it lands (a clean block), or its own colour to absorb it into your
 * next throw; a wrong colour or a miss costs a heart. Then your throw: the
 * bot shows its ward, you answer with a colour. Attack, defend, attack,
 * defend, five times each.
 *
 * Pure over timestamps like the other arcade games. The bot's volleys and
 * wards come from an injected `Planner` (`botPlanner` for play, fixed ones
 * in test/wardrhythm.test.mjs), so `tick` stays deterministic.
 */
export const HEARTS = 5;
/** Five volleys, each followed by your throw. */
export const VOLLEYS = 5;
/** Either side of a bolt's landing: 300 ms in all, generous for touch latency. */
export const WINDOW_MS = 150;
/** How long your throw's window stays open. */
export const ATTACK_MS = 2500;
/** A reading bot switches its ward against a throw made more than this long before the end. */
export const REACT_MS = 700;
export const PAUSE_MS = 900;
/** Before the match's first volley: time to find the pads after pressing Start. */
export const LEAD_MS = 1500;
export const MAX_MAGNITUDE = 3;

/** The beat of volley `k` (1-based): quicker as the match goes on, never under what a thumb can follow. */
export function beatMs(k: number): number {
    return Math.max(480, 760 - 70 * (k - 1));
}
/** A bolt is in the air for two beats, so the first one is seen before it lands. */
export function flightMs(k: number): number {
    return 2 * beatMs(k);
}

export type Bolt = { essence: Essence; landsAt: number; result?: "block" | "absorb" | "hit" };

export type WardRhythmState = {
    phase: "open" | "defend" | "pause" | "attack" | "over";
    /** 1-based: the volley in play, and the throw after it. */
    exchange: number;
    /** What the pause leads to. */
    next: "defend" | "attack";
    hearts: Record<Side, number>;
    /** Your last colour: the one thrown for you if you do not pick. */
    colour: Record<Side, Essence>;
    /** Bolts absorbed this volley: each adds one to your throw. */
    absorbed: number;
    volley: { bolts: Bolt[]; beat: number };
    attack?: { startedAt: number; endsAt: number; ward: Essence; react: boolean; block: boolean; thrown?: { essence: Essence; at: number } } | undefined;
    pauseUntil?: number | undefined;
    winner?: Side | undefined;
};

export type WardRhythmEvent = {
    kind: "open" | "volley" | "block" | "absorb" | "hit" | "attack" | "feint" | "strike" | "glance" | "guarded" | "over";
    side: Side;
    essence?: Essence;
    magnitude?: number;
    /** block/absorb/hit: which bolt of the volley. */
    index?: number;
};

export type Step = { state: WardRhythmState; events: WardRhythmEvent[] };

export type WardRhythmAction = { kind: "ward"; essence: Essence } | { kind: "throw"; essence: Essence };

/** Where the bot's play comes from: the colours of the next volley, and the ward it shows against your throw. */
export type Planner = {
    volley(state: WardRhythmState): Essence[];
    /** react: switch against an early throw; block: switch against any throw (the personality's guard). */
    guard(state: WardRhythmState): { essence: Essence; react: boolean; block?: boolean };
};

export function createWardRhythm(colours: Partial<Record<Side, Essence>> = {}): WardRhythmState {
    return {
        phase: "open",
        exchange: 1,
        next: "defend",
        hearts: { player: HEARTS, opponent: HEARTS },
        colour: { player: colours.player ?? "shadow", opponent: colours.opponent ?? "fire" },
        absorbed: 0,
        volley: { bolts: [], beat: beatMs(1) }
    };
}

function openVolley(state: WardRhythmState, now: number, planner: Planner): Step {
    const beat = beatMs(state.exchange);
    const first = now + flightMs(state.exchange);
    const bolts = planner.volley(state).map((essence, i) => ({ essence, landsAt: first + i * beat }));
    return { state: { ...state, phase: "defend", volley: { bolts, beat }, absorbed: 0, attack: undefined, pauseUntil: undefined }, events: [{ kind: "volley", side: "opponent", magnitude: bolts.length }] };
}

function openAttack(state: WardRhythmState, now: number, planner: Planner): Step {
    const guard = planner.guard(state);
    return {
        state: { ...state, phase: "attack", attack: { startedAt: now, endsAt: now + ATTACK_MS, ward: guard.essence, react: guard.react, block: guard.block === true }, pauseUntil: undefined },
        events: [{ kind: "attack", side: "opponent", essence: guard.essence }]
    };
}

/** Settle one bolt: the answer's colour against the bolt's. */
function answer(state: WardRhythmState, index: number, essence: Essence | undefined): Step {
    const bolt = state.volley.bolts[index]!;
    const result: Bolt["result"] = essence && beats(essence, bolt.essence) ? "block" : essence === bolt.essence ? "absorb" : "hit";
    const bolts = state.volley.bolts.map((b, i) => (i === index ? { ...b, result } : b));
    let next: WardRhythmState = { ...state, volley: { ...state.volley, bolts } };
    const events: WardRhythmEvent[] = [{ kind: result, side: "player", essence: bolt.essence, index }];
    if (result === "absorb") next = { ...next, absorbed: next.absorbed + 1 };
    if (result === "hit") {
        const hearts = { ...next.hearts, player: Math.max(0, next.hearts.player - 1) };
        next = { ...next, hearts };
        if (hearts.player === 0) {
            events.push({ kind: "over", side: "opponent" });
            next = { ...next, phase: "over", winner: "opponent" };
        }
    }
    return { state: next, events };
}

export function act(state: WardRhythmState, side: Side, action: WardRhythmAction, now: number): Step {
    if (side !== "player") return { state, events: [] };
    if (action.kind === "ward") {
        if (state.phase !== "defend") return { state, events: [] };
        const index = state.volley.bolts.findIndex(b => !b.result && Math.abs(now - b.landsAt) <= WINDOW_MS);
        if (index < 0) return { state, events: [] };
        const r = answer({ ...state, colour: { ...state.colour, player: action.essence } }, index, action.essence);
        return r;
    }
    if (state.phase !== "attack" || !state.attack || state.attack.thrown || now > state.attack.endsAt) return { state, events: [] };
    return { state: { ...state, colour: { ...state.colour, player: action.essence }, attack: { ...state.attack, thrown: { essence: action.essence, at: now } } }, events: [] };
}

/** Your throw lands: the wheel against their ward, a switched ward if they read an early throw. */
function resolveThrow(state: WardRhythmState): Step {
    const attack = state.attack!;
    const events: WardRhythmEvent[] = [];
    const thrown = attack.thrown?.essence ?? state.colour.player;
    let ward = attack.ward;
    // Read an early throw, or simply guess right: switch to the colour that beats it.
    if ((attack.react && attack.thrown && attack.thrown.at <= attack.endsAt - REACT_MS) || attack.block) {
        ward = beaterOf(thrown);
        events.push({ kind: "feint", side: "opponent", essence: ward });
    }
    const magnitude = Math.min(MAX_MAGNITUDE, 1 + state.absorbed);
    let damage = 0;
    if (beats(thrown, ward)) {
        damage = magnitude;
        events.push({ kind: "strike", side: "player", essence: thrown, magnitude });
    } else if (thrown === ward || beats(ward, thrown)) {
        events.push({ kind: "guarded", side: "opponent", essence: thrown });
    } else {
        damage = 1;
        events.push({ kind: "glance", side: "player", essence: thrown, magnitude: 1 });
    }
    const hearts = { ...state.hearts, opponent: Math.max(0, state.hearts.opponent - damage) };
    const next: WardRhythmState = { ...state, hearts, absorbed: 0, attack: { ...attack, ward } };
    const last = state.exchange >= VOLLEYS;
    if (hearts.opponent === 0 || last) {
        const winner: Side | undefined = hearts.opponent === 0 ? "player" : hearts.player > hearts.opponent ? "player" : hearts.opponent > hearts.player ? "opponent" : undefined;
        events.push({ kind: "over", side: winner ?? "player" });
        return { state: { ...next, phase: "over", winner }, events };
    }
    return { state: { ...next, phase: "pause", next: "defend", exchange: state.exchange + 1, pauseUntil: attack.endsAt + PAUSE_MS }, events };
}

/** Move the clock: open the match, let unanswered bolts land, pause, throw, and on to the next volley. */
export function tick(state: WardRhythmState, now: number, planner: Planner): Step {
    switch (state.phase) {
        case "open": {
            const r = openVolley(state, now + LEAD_MS, planner);
            return { state: r.state, events: [{ kind: "open", side: "player" }, ...r.events] };
        }
        case "defend": {
            let s = state;
            const events: WardRhythmEvent[] = [];
            for (let i = 0; i < s.volley.bolts.length && s.phase === "defend"; i++) {
                const bolt = s.volley.bolts[i]!;
                if (!bolt.result && now > bolt.landsAt + WINDOW_MS) {
                    const r = answer(s, i, undefined);
                    s = r.state;
                    events.push(...r.events);
                }
            }
            if (s.phase === "defend" && s.volley.bolts.every(b => b.result)) s = { ...s, phase: "pause", next: "attack", pauseUntil: now + PAUSE_MS };
            return { state: s, events };
        }
        case "pause":
            if (state.pauseUntil === undefined || now < state.pauseUntil) return { state, events: [] };
            return state.next === "attack" ? openAttack(state, state.pauseUntil, planner) : openVolley(state, state.pauseUntil, planner);
        case "attack":
            return state.attack && now >= state.attack.endsAt ? resolveThrow(state) : { state, events: [] };
        default:
            return { state, events: [] };
    }
}

/** base: bolts in the first volley; react: reads an early throw; block: guesses any throw right. */
type Tendency = { base: number; react: number; block: number };
const TENDENCIES: Record<string, Tendency> = {
    balanced: { base: 3, react: 0.4, block: 0.35 },
    aggressor: { base: 4, react: 0.15, block: 0.22 },
    warden: { base: 3, react: 0.3, block: 0.55 },
    trickster: { base: 3, react: 0.7, block: 0.3 },
    gatekeeper: { base: 3, react: 0.45, block: 0.4 }
};

/**
 * The bot as a planner: volleys that grow with the match (the Aggressor
 * throws more), random colours that never repeat three in a row, and a ward
 * in a random colour; whether it reads an early throw (the Trickster almost
 * always) and how often it simply guards right (the Warden most, the
 * Aggressor least) is its personality. Seeded through rng.
 */
export function botPlanner(personalityId: string, rng: { next(): number }): Planner {
    const t = TENDENCIES[personalityId] ?? TENDENCIES.balanced!;
    const pick = (): Essence => ESSENCES[Math.floor(rng.next() * ESSENCES.length)] as Essence;
    return {
        volley: state => {
            const length = Math.min(6, t.base + Math.floor((state.exchange - 1) / 2));
            const colours: Essence[] = [];
            while (colours.length < length) {
                const c = pick();
                if (colours.length >= 2 && colours[colours.length - 1] === c && colours[colours.length - 2] === c) continue;
                colours.push(c);
            }
            return colours;
        },
        guard: () => ({ essence: pick(), react: rng.next() < t.react, block: rng.next() < t.block })
    };
}
