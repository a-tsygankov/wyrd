import type { WeatherId } from "../../wyrd-resolver/src/types.js";

/**
 * Weather rounds (docs/duel-engagement-options.md §H). Every third round
 * draws one card, visible to both mages, announced the round before so the
 * telegraph and the composer can plan for it. One rule flipped for one
 * round; the resolver reads `state.weather` and does the rest.
 */
export type Weather = {
    id: WeatherId;
    title: string;
    /** The rule line shown on the card. */
    text: string;
    /** Which rule it bends, for the Help text. */
    bends: string;
};

export const WEATHERS: readonly Weather[] = [
    { id: "storm", title: "Storm", text: "AMPLIFY costs no Focus. Bolts come amplified for the price of a plain one.", bends: "Focus prices" },
    { id: "hush", title: "Hush", text: "SILENCE is free and strips the essence too: a silenced spell flies untyped, so any ward catches it.", bends: "reactions" },
    { id: "ironbound", title: "Ironbound", text: "Every ward has integrity 1 this round, whatever the ruleset: one hit and it shatters.", bends: "wards" },
    { id: "opensky", title: "Open sky", text: "No WARD may be raised, on a mage or on the gate. Spells that try fizzle before they cost anything.", bends: "wards" }
];

export const WEATHER_EVERY = 3;

export function weatherById(id: WeatherId): Weather {
    return WEATHERS.find(w => w.id === id) as Weather;
}

type Picker = { pick<T>(items: readonly T[]): T };

/** The weather of `round`, or none: every third round draws a card from the seeded stream. */
export function weatherForRound(round: number, rng: Picker): WeatherId | undefined {
    if (round < WEATHER_EVERY || round % WEATHER_EVERY !== 0) return undefined;
    return rng.pick(WEATHERS).id;
}

/** Which upcoming round `round` announces the weather for (the one before a weather round), or none. */
export function weatherAnnouncedFor(round: number): number | undefined {
    return (round + 1) % WEATHER_EVERY === 0 ? round + 1 : undefined;
}
