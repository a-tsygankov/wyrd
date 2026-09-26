import { CLASSIC_RULES, FALTERING_AT, BOUND_TAX, MEND_RESOLVE, REACTION_COSTS, ROUND_FOCUS, type RuleOptions } from "../../wyrd-resolver/src/types.js";
import { glyphHelp } from "./glyphHelp.js";
import { glyphs } from "./glyphs.js";
import { POC_TRAY } from "./tray.js";

/**
 * The in-app Help section: every glyph, every reaction, every term the
 * interface uses and every control, in one place. Data, not code, built
 * from the same content the composer's help uses so the two never
 * disagree. `glossaryFor(rules)` adds the lines a ruleset changes.
 */
export type GlossaryGroupId = "glyphs" | "reactions" | "terms" | "controls";

export type GlossaryGroup = { id: GlossaryGroupId; title: string; intro: string };

export type GlossaryEntry = {
    group: GlossaryGroupId;
    term: string;
    text: string;
    /** For glyphs: the tray family (essence / target / action / modifier), or the pending family. */
    kind?: string;
    /** A glyph the parser knows but the POC resolver does not act on yet. */
    pending?: boolean;
};

export const GLOSSARY_GROUPS: readonly GlossaryGroup[] = [
    {
        id: "glyphs",
        title: "Glyphs",
        intro: "A spell is 2 to 4 glyphs: one action, its target, an optional essence, and modifiers after the action. Glyphs not yet in the tray are listed last with what the grammar intends for them."
    },
    {
        id: "reactions",
        title: "Reactions",
        intro: "One reaction per round against the opponent's spell, chosen from the telegraph. Free under Classic; priced from your 7 Focus under Teeth, Pulse and Resolve."
    },
    {
        id: "terms",
        title: "Terms",
        intro: "The words on the board, in the order you meet them in a round."
    },
    {
        id: "controls",
        title: "Controls",
        intro: "What every button does."
    }
];

const REACTION_GLYPHS = ["REFLECT", "SILENCE", "NULL", "SPELL"];

const glyphEntries: GlossaryEntry[] = (() => {
    const registryOrder = glyphs.map(g => g.displayName);
    const castable = POC_TRAY.filter(t => !REACTION_GLYPHS.includes(t));
    const pending = registryOrder.filter(t => !POC_TRAY.includes(t) && !REACTION_GLYPHS.includes(t));
    return [...castable, ...pending].map(term => {
        const help = glyphHelp[term];
        const glyph = glyphs.find(g => g.displayName === term);
        return {
            group: "glyphs" as const,
            term,
            text: `${help?.text ?? "Unknown glyph."} Costs ${glyph?.baseFocusCost ?? 0} Focus.`,
            kind: glyph?.family ?? help?.role ?? "glyph",
            ...(help?.pending ? { pending: true } : {})
        };
    });
})();

const reactionEntries: GlossaryEntry[] = ["REFLECT", "SILENCE", "NULL", "SPELL"].map(term => ({
    group: "reactions" as const,
    term,
    text: glyphHelp[term]?.text ?? "Unknown glyph.",
    kind: "reaction"
}));

const termEntries: GlossaryEntry[] = [
    { term: "Round", text: "One exchange: read the telegraph, choose a reaction, compose your spell, cast. Both spells resolve, seals are awarded, the next round begins." },
    { term: "Telegraph", text: "What you see of the opponent's spell before you react: the essence and action glyphs shown, the target and modifiers hidden. Some rules reveal more: a mage who ended at 0 Focus or is faltering leaks one extra glyph." },
    { term: "Reaction window", text: "Under Pulse and Resolve, 8 seconds to choose a reaction after the telegraph appears; hidden glyphs flip face-up across the window, so waiting buys information and risks the lock. The last 3 seconds pulse the card edge." },
    { term: "Scry", text: "In reaction-cost rulesets, pay 1 Focus to reveal one hidden telegraph glyph now, from the same budget as your spell and reaction." },
    { term: "Focus", text: `Your budget each round: ${ROUND_FOCUS}. Every glyph has a cost (the pips on the tray); the spell must fit. Under Teeth and up the reaction is paid from the same ${ROUND_FOCUS}, and ending a round at 0 leaves you exposed.` },
    { term: "Magnitude", text: "How hard a spell lands: 1 by default, +1 for AMPLIFY, −1 for WEAKEN, +1 for ignite or a quick cast. It dents wards and deals Resolve; it never changes who scores." },
    { term: "Seal", text: "The score. A SEEK or BIND that reaches the opponent, or a gate spell that moves the gate, is one seal. First to 3 wins the duel." },
    { term: "Ward", text: "A lasting shield on a mage. It blocks hostile spells of its essence (or every hostile spell if untyped) until it is broken. Your own spells pass your own ward." },
    { term: "Integrity", text: "Under Teeth and up a ward absorbs 2 magnitude before it shatters; each blocked hit dents it. MEND restores it." },
    { term: "Gate", text: "The objective between the mages: open, closed or broken. CLOSE scores while it stands open, OPEN while it is closed, BREAK shatters it, MEND repairs it. Wards and REFLECT cannot touch it; only NULL stops a gate spell." },
    { term: "Bound", text: `The state BIND leaves. Under Resolve a bound mage pays ${BOUND_TAX} extra Focus for their next spell, which frees them.` },
    { term: "Resolve", text: `Under the Resolve ruleset each mage has hit points; SEEK deals its magnitude, MEND SELF heals ${MEND_RESOLVE}. Emptying the opponent's Resolve wins the duel as surely as 3 seals.` },
    { term: "Faltering", text: `At Resolve ${FALTERING_AT} or less: your wards come up brittle (integrity 1) and your telegraph leaks one more glyph.` },
    { term: "Exposed", text: "Under reaction-cost rulesets, ending a round at 0 Focus reveals one extra glyph of your next telegraph." },
    { term: "Ignite", text: "Under Teeth and up, casting the same essence two rounds running adds +1 magnitude." },
    { term: "Quick cast", text: "Under Pulse and Resolve, committing your spell within 5 seconds adds +1 magnitude." },
    { term: "Scenario", text: "The first nine rounds of a solo match are a teaching deck: each shows one interaction and, after the round, the answers that would have worked." },
    { term: "Opponent personality", text: "After the deck the computer opponent plays as one of five personalities (the Adept, the Aggressor, the Warden, the Trickster, the Gatekeeper), chosen from the match seed, with a plan each round; it never repeats its last three spells." },
    { term: "Seed", text: "The match seed decides the opponent's spells, reactions and telegraph order. Open the same ?seed= link to replay the same opponent and share a challenge." },
    { term: "Hot-seat", text: "Two players on one phone: Player 2 composes, hands over, Player 1 reads and reacts and casts, hands back, Player 2 reacts, both spells resolve." }
].map(e => ({ group: "terms" as const, ...e }));

const controlEntries: GlossaryEntry[] = [
    { term: "Glyph tray", text: "Tap glyphs to add them to your spell. A green ring marks a glyph that completes a castable spell; dimmed glyphs cannot follow what you have; the pips are the Focus cost." },
    { term: "Undo", text: "Removes the last glyph you added to your spell." },
    { term: "Clear", text: "Empties your spell so you can start the strip again." },
    { term: "Cast", text: "Commits your spell and reaction; the round resolves and the stage replays it. Tap the stage to skip the replay." },
    { term: "Next round", text: "Refills Focus to 7 for both mages and deals the next telegraph." },
    { term: "Rematch", text: "Starts a new duel. With a ?seed= link the same opponent returns; otherwise a new seed is drawn." },
    { term: "Hot-seat", text: "Switches between the solo duel against the computer and two players on one phone." },
    { term: "Settings", text: "Ruleset (Classic, Teeth, Pulse, Resolve), timers, telemetry, animations, sound, whether glyph help opens by default." },
    { term: "Stats", text: "Your rounds, seals, reactions and time to commit on this device, and everyone's per-ruleset summary." },
    { term: "Help", text: "This section: every glyph, reaction, term and button, under the rules you play." },
    { term: "Admin console", text: "Triple-tap the title (or ?admin=1) for hidden state, the opponent's spell, best-move advice with the resolver's reasons, and the client log." }
].map(e => ({ group: "controls" as const, ...e }));

export const glossary: readonly GlossaryEntry[] = [...glyphEntries, ...reactionEntries, ...termEntries, ...controlEntries];

/** The glossary with the ruleset's own lines appended (prices, integrity, hit points). */
export function glossaryFor(rules: RuleOptions = CLASSIC_RULES): GlossaryEntry[] {
    return glossary.map(entry => {
        const extra: string[] = [];
        switch (entry.term) {
            case "REFLECT":
            case "SILENCE":
            case "NULL": {
                const key = entry.term.toLowerCase() as keyof typeof REACTION_COSTS;
                if (rules.reactionCosts) extra.push(`Costs ${REACTION_COSTS[key]} Focus under these rules.`);
                else extra.push("Free under these rules.");
                break;
            }
            case "WARD":
                if (rules.wardIntegrity > 0) extra.push(`Integrity ${rules.wardIntegrity}: each blocked hit dents it by its magnitude; at 0 it shatters.`);
                if (rules.resolve > 0) extra.push(`Faltering casters (Resolve ${FALTERING_AT} or less) raise brittle wards.`);
                break;
            case "SEEK":
                if (rules.resolve > 0) extra.push("Under these rules it also deals its magnitude to the target's Resolve.");
                if (rules.ignite) extra.push("The same essence two rounds running ignites for +1 magnitude.");
                break;
            case "AMPLIFY":
                if (rules.wardIntegrity > 0) extra.push("Magnitude 2 shatters a fresh ward in one hit.");
                break;
            case "BIND":
                if (rules.resolve > 0) extra.push(`A bound mage pays ${BOUND_TAX} extra Focus for their next spell.`);
                break;
        }
        return extra.length ? { ...entry, text: `${entry.text} ${extra.join(" ")}` } : entry;
    });
}
