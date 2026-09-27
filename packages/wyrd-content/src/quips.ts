import type { Rng } from "../../wyrd-simulation/src/rng.js";

/**
 * A line from the opponent after each round, by personality and by how
 * the round went for it (docs/duel-engagement-options.md §I, the taunt
 * half). Data, not code; picked with the match rng so a seed replays it.
 * Keep them short, in character, and never about the player's skill.
 */
export type QuipOutcome = "won" | "lost" | "even";

export const QUIPS: Record<string, Record<QuipOutcome, readonly string[]>> = {
    balanced: {
        won: ["The Adept nods once. \"As the grammar allows.\"", "\"A clean sentence,\" says the Adept, \"and a clean seal.\"", "The Adept turns a page. \"Noted.\""],
        lost: ["The Adept tilts their head. \"Well read.\"", "\"So that is how you answer it,\" the Adept murmurs.", "The Adept closes the book for a moment. \"Again.\""],
        even: ["The Adept shrugs. \"A page turned, nothing written.\"", "\"Even,\" says the Adept. \"The next line decides.\"", "The Adept studies the gate. \"Neither of us blinked.\""]
    },
    aggressor: {
        won: ["The Aggressor grins. \"Faster. Always faster.\"", "\"You read it,\" the Aggressor says. \"Too slowly.\"", "The Aggressor cracks her knuckles. \"More.\""],
        lost: ["The Aggressor spits. \"Lucky read.\"", "\"Anchors,\" the Aggressor growls. \"Cowards' glyphs.\"", "The Aggressor rolls her shoulders. \"That one stung. Good.\""],
        even: ["The Aggressor snorts. \"Nobody bled. Boring.\"", "\"Trade,\" says the Aggressor. \"I'll take the next one.\"", "The Aggressor paces. \"Cast louder.\""]
    },
    warden: {
        won: ["The Warden lowers his shield an inch. \"Patience pays.\"", "\"Wards first,\" says the Warden. \"Then the rest follows.\"", "The Warden taps the gate. \"Still standing.\""],
        lost: ["The Warden frowns at his ward. \"A crack. It will mend.\"", "\"Through the ward,\" the Warden says. \"Well found.\"", "The Warden plants his feet. \"Once. Not twice.\""],
        even: ["The Warden exhales. \"Nothing lost. Nothing gained.\"", "\"Hold,\" says the Warden, mostly to himself.", "The Warden checks his ward's edge. \"Fine.\""]
    },
    trickster: {
        won: ["The Trickster bows. \"Did you see it? No? Lovely.\"", "\"REVERSE,\" the Trickster whispers. \"Say it with me.\"", "The Trickster flips a knife. \"Read the whole sentence next time.\""],
        lost: ["The Trickster laughs. \"Fine. That was a good SILENCE.\"", "\"Rude,\" says the Trickster, delighted.", "The Trickster vanishes into the hood. \"I'll be stranger.\""],
        even: ["The Trickster yawns theatrically. \"A draw? How dull of us.\"", "\"Neither trick landed,\" the Trickster says. \"Yet.\"", "The Trickster juggles two glyphs. \"Pick one. I already have.\""]
    },
    gatekeeper: {
        won: ["The Gatekeeper rests a hand on the arch. \"Mine.\"", "\"The gate remembers who closed it,\" says the Gatekeeper.", "The Gatekeeper winds the crossbow. \"Come and open it.\""],
        lost: ["The Gatekeeper glares at the gate. \"It will swing back.\"", "\"You touched my gate,\" the Gatekeeper says quietly.", "The Gatekeeper counts the seals. \"Not enough. Not yet.\""],
        even: ["The Gatekeeper shrugs. \"The gate does not care who waits.\"", "\"Both of us reaching,\" the Gatekeeper says. \"It shuddered. It held.\"", "The Gatekeeper leans on the arch. \"Again, then.\""]
    }
};

export function quipFor(personalityId: string, outcome: QuipOutcome, rng: Rng): string {
    const lines = (QUIPS[personalityId] ?? QUIPS.balanced!)[outcome];
    return rng.pick(lines);
}
