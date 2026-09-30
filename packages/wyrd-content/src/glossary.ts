import { CLASSIC_RULES, FALTERING_AT, BOUND_TAX, MEND_RESOLVE, REACTION_COSTS, ROUND_FOCUS, type RuleOptions } from "../../wyrd-resolver/src/types.js";
import { glyphHelp } from "./glyphHelp.js";
import { glyphs } from "./glyphs.js";
import { POC_TRAY } from "./tray.js";

/**
 * The in-app Help section: every glyph, every reaction, every term the
 * interface uses and every control, in one place. Data, not code, built
 * from the same content the composer's help uses so the two never
 * disagree. `glossaryFor(rules)` adds the lines a ruleset changes. The
 * arcade games (Volley, Quickdraw) have their own group, which Help puts
 * first while an arcade game is being played (`glossaryGroupsFor`).
 */
export type GlossaryGroupId = "glyphs" | "reactions" | "terms" | "controls" | "arcade";

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
    },
    {
        id: "arcade",
        title: "Arcade games",
        intro: "Volley, Quickdraw, Beam clash, Gate tug and Ward rhythm: one-thumb duels on the four-colour wheel. Volley, Quickdraw and Ward rhythm play for five hearts each, Beam clash for three seals, Gate tug for the gate. Pick the game in Settings → Game. The ruleset and the glyph grammar do not apply here."
    }
];

/** The groups in the order Help shows them: the game being played leads. */
export function glossaryGroupsFor(game: "arcade" | "word"): GlossaryGroup[] {
    const arcade = GLOSSARY_GROUPS.filter(g => g.id === "arcade");
    const rest = GLOSSARY_GROUPS.filter(g => g.id !== "arcade");
    return game === "arcade" ? [...arcade, ...rest] : [...rest, ...arcade];
}

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
    { term: "Round", text: "One exchange: read the telegraph, choose a reaction, compose your spell, cast. Both spells resolve in initiative order, seals are awarded, the next round begins." },
    { term: "Initiative", text: "Who resolves first: the only quick cast (under timers), else the cheaper spell, else the mage behind on seals, else you on odd rounds and the opponent on even ones. The verdict names it every round." },
    { term: "Telegraph", text: "What you see of the opponent's spell before you react: the essence and action glyphs shown, the target and modifiers hidden. Some rules reveal more: a mage who ended at 0 Focus or is faltering leaks one extra glyph." },
    { term: "Reaction window", text: "Under Pulse and Resolve, 8 seconds to choose a reaction after the telegraph appears; hidden glyphs flip face-up across the window, so waiting buys information and risks the lock. The last 3 seconds pulse the card edge." },
    { term: "Scry", text: "In reaction-cost rulesets, pay 1 Focus to reveal one hidden telegraph glyph now, from the same budget as your spell and reaction." },
    { term: "Focus", text: `Your budget each round: ${ROUND_FOCUS}. Every glyph has a cost (the pips on the tray); the spell must fit. Under Teeth and up the reaction is paid from the same ${ROUND_FOCUS}, and ending a round at 0 leaves you exposed.` },
    { term: "Magnitude", text: "How hard a spell lands: 1 by default, +1 for AMPLIFY, −1 for WEAKEN, +1 for ignite or a quick cast. It dents wards and deals Resolve; it never changes who scores." },
    { term: "Seal", text: "The score. A SEEK or BIND that reaches the opponent, or a gate spell that moves the gate, is one seal. First to 3 wins the duel." },
    { term: "Ward", text: "A lasting shield on a mage. It blocks hostile spells of its essence (or every hostile spell if untyped) until it is broken. Your own spells pass your own ward. A ward can also stand on the GATE: only its owner's gate spells pass it." },
    { term: "Integrity", text: "Under Teeth and up a ward absorbs 2 magnitude before it shatters; each blocked hit dents it. MEND restores it." },
    { term: "Gate", text: "The objective between the mages: open, closed or broken. CLOSE scores while it stands open, OPEN while it is closed, BREAK shatters it, MEND repairs it. Wards on a mage and REFLECT cannot touch it; NULL stops a gate spell, and GATE WARD claims it: only the owner's gate spells pass until the other mage's BREAK GATE shatters the ward. When both mages cast a gate spell in the same round, the gate shudders and holds: neither scores." },
    { term: "Bound", text: `The state BIND leaves. Under Resolve a bound mage pays ${BOUND_TAX} extra Focus for their next spell, which frees them.` },
    { term: "Resolve", text: `Under the Resolve ruleset each mage has hit points; SEEK deals its magnitude, MEND SELF heals ${MEND_RESOLVE}. Emptying the opponent's Resolve wins the duel as surely as 3 seals.` },
    { term: "Faltering", text: `At Resolve ${FALTERING_AT} or less: your wards come up brittle (integrity 1) and your telegraph leaks one more glyph.` },
    { term: "Exposed", text: "Under reaction-cost rulesets, ending a round at 0 Focus reveals one extra glyph of your next telegraph." },
    { term: "Ignite", text: "Under Teeth and up, casting the same essence two rounds running adds +1 magnitude." },
    { term: "Quick cast", text: "Under Pulse and Resolve, committing your spell within 5 seconds adds +1 magnitude." },
    { term: "Scenario", text: "The teaching deck: nine scripted rounds that each show one interaction and, after the round, the answers that would have worked. The opener is always the direct threat; the other eight come in an order drawn from the match seed. It plays for your first solo match on this device and then turns itself off, so later matches meet the computer opponent from round 1; Settings → Help turns it back on." },
    { term: "Opponent personality", text: "After the deck the computer opponent plays as one of five personalities (the Adept, the Aggressor, the Warden, the Trickster, the Gatekeeper), chosen from the match seed, with a plan each round; it never repeats its last three spells." },
    { term: "Seed", text: "The match seed decides the opponent's spells, reactions and telegraph order. Open the same ?seed= link to replay the same opponent and share a challenge." },
    { term: "Hot-seat", text: "Two players on one phone: Player 2 composes, hands over, Player 1 reads and reacts and casts, hands back, Player 2 reacts, both spells resolve." },
    { term: "Weather", text: "A playtest option (Settings → Rules). Every third round draws a card both mages see, announced the round before, that bends one rule for that round only: Storm (AMPLIFY costs no Focus), Hush (SILENCE is free and strips the essence too, so any ward catches the spell), Ironbound (every ward has integrity 1), Open sky (no ward may be raised)." },
    { term: "Sudden death", text: "A playtest option. At 2-2 the next round is sudden death: the opponent's telegraph drops to the medium preset, reactions cost double, and the first seal to land decides the duel. A round nobody scores is played again." },
    { term: "Press the round", text: "A playtest option, solo only. Before you cast, press: this round's seal counts double for whoever wins it, so a press cuts both ways. If the opponent presses you may retreat instead, conceding one seal and playing the round at single stake. Both pressing makes the seal count four. Seals to win stay at 3." }
].map(e => ({ group: "terms" as const, ...e }));

const controlEntries: GlossaryEntry[] = [
    { term: "Glyph tray", text: "Tap glyphs to add them to your spell. A green ring marks a glyph that completes a castable spell; dimmed glyphs cannot follow what you have; the pips are the Focus cost." },
    { term: "Undo", text: "Removes the last glyph you added to your spell." },
    { term: "Clear", text: "Empties your spell so you can start the strip again." },
    { term: "Cast", text: "Commits your spell and reaction; the round resolves and the stage replays it. Tap the stage to skip the replay." },
    { term: "Next round", text: "Refills Focus to 7 for both mages and deals the next telegraph." },
    { term: "Rematch", text: "Starts a new duel. With a ?seed= link the same opponent returns; otherwise a new seed is drawn." },
    { term: "Hot-seat", text: "Switches between the solo duel against the computer and two players on one phone." },
    { term: "Settings", text: "Game (Arcade · Volley, Arcade · Quickdraw, or the word duel), ruleset (Classic, Teeth, Pulse, Resolve) and the playtest options (weather, sudden death, press the round), timers, telemetry, animations, sound, the teaching deck, whether glyph help opens by default." },
    { term: "Press / Retreat", text: "With the press option on, the two buttons above Cast: Press stakes a double seal on this round; Retreat, offered only when the opponent pressed, concedes one seal and keeps the round at single stake." },
    { term: "Stats", text: "Your rounds, seals, reactions and time to commit on this device, and everyone's per-ruleset summary." },
    { term: "Help", text: "This section: every glyph, reaction, term and button, under the rules you play." },
    { term: "Update banner", text: "Appears at the top when a newer version of the app is live: Reload fetches it now, Later hides it until an even newer one. The app never reloads on its own, so a game in progress is safe." },
    { term: "Admin console", text: "Triple-tap the title (or ?admin=1) for hidden state, the opponent's spell, best-move advice with the resolver's reasons, and the client log." }
].map(e => ({ group: "controls" as const, ...e }));

// The arcade games (apps/web/src/volley.ts and quickdraw.ts hold the numbers these lines quote).
const arcadeEntries: GlossaryEntry[] = [
    { term: "Volley", text: "The default arcade game: one bolt volleyed over the gate, faster every return. Swing inside the gold window to send it back, in a colour if you like; a bolt that reaches you unanswered costs hearts equal to its magnitude, and whoever landed it serves next." },
    { term: "Quickdraw", text: "The second arcade game: both mages draw once inside a three-second ring. Pick a colour, charge it or ward instead; when the ring closes both orbs fly and the wheel decides the clash. Two Focus come back after every round." },
    { term: "Wheel", text: "The colour rule of both games: water quenches fire, fire burns life, life banishes shadow, shadow drinks water. Fire and shadow, water and life sit across the wheel from each other and are neutral." },
    { term: "Hearts", text: "Five each, the red pips. A hit takes hearts equal to the magnitude of the bolt or orb (1 to 3); the first mage at zero loses." },
    { term: "Arcade Focus", text: "Seven each, the violet pips, spent on wards (2), smashes (3) and Quickdraw charge (1 a step). Volley gives one back for every clean return; Quickdraw gives two back after every round." },
    { term: "Serve", text: "Volley opens with the opponent serving in their colour. After a hit the mage who landed it serves; after a ward blocks, the blocker serves. The serve flies in the server's colour at speed 1." },
    { term: "Speed", text: "Volley's bolt has six speed steps: every return adds one, so it crosses in 1.4 s at speed 1 and 0.65 s at speed 6. A quench drops it back to 1, a weak return halves it, a smash doubles it." },
    { term: "Return window", text: "The last part of the bolt's flight, marked by the gold ring under your mage and around Return: a swing counts only inside it. It narrows from 0.45 s to 0.3 s as the bolt speeds up, never below what a thumb can hit." },
    { term: "Quench", text: "Return in the colour that beats the bolt's (water on fire, and so on round the wheel): the bolt goes back in your colour at speed 1 and magnitude 1. The safe answer to a fast or heavy bolt." },
    { term: "Kindle", text: "Return in the bolt's own colour: +1 magnitude (up to 3), so it costs the other mage more hearts if it lands. Speed still rises by one." },
    { term: "Weak return", text: "Return in a colour the bolt beats: you reach it, but it goes back at half speed and magnitude 1, and it earns no Focus. A neutral colour or a plain tap is an ordinary return." },
    { term: "Ward (Volley)", text: "Hold the stage or tap Ward (2 Focus) while the bolt is coming to raise a ward in your colour for that one arrival. It stands unless the bolt's colour beats yours, or a kindled bolt of your own colour comes through. A block drops the bolt and you serve next." },
    { term: "Smash", text: "Tap Smash (3 Focus) while the bolt is coming: your return goes back at double speed (up to 6). Focus refills one per clean return, so a volleying mage can afford smashes and a hiding one runs dry." },
    { term: "Quick draw", text: "In Quickdraw, a colour tapped inside the first second of the ring is a quick draw: +1 magnitude, but chosen before you could read the other orb. The pads glow gold while the quick window is open." },
    { term: "Charge", text: "Hold Charge (or press and hold the stage) to grow your orb a step per second, one Focus a step, up to magnitude 3. Letting go banks the charge so far." },
    { term: "Ward (Quickdraw)", text: "Tap Ward (2 Focus) instead of drawing: you throw nothing this round, and a ward in your colour stands against an orb it is not beaten by. The same colour or the beating colour goes through." },
    { term: "Clash", text: "When Quickdraw's ring closes both orbs fly. The colour that beats the other lands alone; the same colour goes to the bigger orb and equal orbs cancel; colours across the wheel both land. The orb you watch growing in the other hand is their telegraph." },
    { term: "Beam clash", text: "The third arcade game: both mages fire a beam and the beams meet in a knot over the gate. Tap on the beat to push the knot toward the other mage; push it past their end for a seal. First to three seals, or the leader after 90 seconds." },
    { term: "Beat", text: "Beam clash runs on a 100 bpm metronome: the gold ring under your mage and around Push lights on each beat, and with sound on it ticks. A tap within about a tenth of a second of the beat pushes one step, within a twentieth it is perfect and pushes two; an off-beat tap pushes nothing and costs a Focus. The match opens with a four-beat count-in (4, 3, 2, 1) and taps during it are free." },
    { term: "Knot", text: "Where the beams meet, shown on the track under the names. Each beat both pushes are compared and the knot moves by the difference: equal pushes hold it, a stronger push moves it. Three steps from the middle to either end." },
    { term: "Push", text: "Tap Push or anywhere on the stage on the beat. A push counts on the press, not the release, so a rhythm is not late by the length of your tap. A perfect tap pushes two; holding the colour that beats the other beam doubles your push again." },
    { term: "Switch", text: "Tap a colour pad to recolour your beam. It lands 300 ms later, so the other mage sees it coming and can answer. The first switch in a clash is free; each after it costs 2 Focus." },
    { term: "Ward (Beam clash)", text: "Tap Ward (2 Focus, once per clash) to hold your end: pushes past it dent the ward instead of scoring, and it shatters after two. Best raised when the knot is a step from you." },
    { term: "Seals (Beam clash)", text: "The gold diamonds. A seal pauses the clash, gives the mage who was scored on a Focus back, and restarts the knot a step toward them: the scorer keeps a little momentum." },
    { term: "Time (Beam clash)", text: "After 90 seconds the mage with more seals wins. Level at time goes to sudden death: the next seal decides." },
    { term: "Gate tug", text: "The fourth arcade game: Quickdraw's draw (a colour, a charge or a ward inside the three-second ring), but when the ring closes the orbs push the gate along a rail instead of costing hearts. Push it into the other mage's circle to win." },
    { term: "Rail", text: "The track under the names: five steps from the middle to either circle. Each round the gate moves by the difference between the two pushes (an orb pushes its magnitude); equal pushes hold it." },
    { term: "Temper", text: "The gate takes the colour of the last push that moved it, shown on the rail and the gate itself. A push must beat or match that colour to move it; any other colour glances off. A fresh gate has no temper." },
    { term: "Comeback", text: "With the gate one step from your own circle, your push counts double, so a nearly lost tug can still swing back." },
    { term: "Ward (Gate tug)", text: "Tap Ward (2 Focus) instead of drawing: you push nothing this round, but the other push is blocked unless its colour beats or matches your ward's." },
    { term: "Round limit", text: "After fifteen rounds the mage the gate leans away from wins. A gate dead in the middle goes to sudden death: the next push that moves it wins." },
    { term: "Ward rhythm", text: "The fifth and gentlest arcade game: they throw a volley of coloured bolts on a beat and you ward each one as it lands, then you throw one back at their ward. Five volleys and five throws; five hearts each, the most hearts at the end win." },
    { term: "Lane", text: "The strip under the names in Ward rhythm: their bolts slide in from the right toward the gold hit line and glow gold when due. Volleys grow longer and quicker as the match goes on." },
    { term: "Ward tap", text: "As a bolt reaches the line, tap the pad that beats its colour (water on fire, fire on life, life on shadow, shadow on water) for a clean block. The first tap in a bolt's window is your answer, so tapping every pad does not work; a wrong colour or no tap costs a heart." },
    { term: "Absorb", text: "Tap a bolt's own colour instead and you take it in: no damage, and +1 to your next throw, up to 3. A riskier read than the block, since a neutral colour costs a heart." },
    { term: "Throw", text: "After each volley, 2.5 seconds to throw: tap the colour that beats their ward for a strike worth 1 plus what you absorbed; a neutral colour glances for 1; their ward's own colour, or one it beats, is held. Throw late: a bot that sees an early throw can switch its ward. No throw and your last colour goes for you." },
    { term: "Their ward", text: "The colour their ward shows while you throw, on the card and the stage. The Trickster reads early throws, the Warden guesses right most often, the Aggressor throws longer volleys but guards worst." },
    { term: "Start", text: "No arcade game starts on its own: the clock begins when you press Start, so you can read the board or go fullscreen first." },
    { term: "Colour pads", text: "The four pads under the stage, placed like the swipes: up FIRE, right WATER, down SHADOW, left LIFE. In Volley a pad returns in that colour, in Quickdraw it draws that colour, in Beam clash it switches your beam, in Gate tug it draws that colour, in Ward rhythm it wards or throws that colour." },
    { term: "Gestures", text: "On the stage itself: in Volley a tap returns, a swipe returns in the colour of its direction and a long press wards; in Quickdraw a swipe picks a colour and press-and-hold charges; in Beam clash any touch on the stage is a push; Gate tug plays like Quickdraw; in Ward rhythm a swipe is the pad of its direction." },
    { term: "Play again", text: "Shown when a game ends: a fresh game of the same kind starts straight away." },
    { term: "Reset (arcade)", text: "In the arcade, Reset abandons the game in progress and puts the board back on Start." },
    { term: "Fullscreen", text: "The corner button on the stage (arcade only): hides the header and hints and gives the stage the height; where the browser allows it the page goes truly fullscreen too. Tap it again, or leave fullscreen from the browser, to come back." }
].map(e => ({ group: "arcade" as const, ...e }));

export const glossary: readonly GlossaryEntry[] = [...glyphEntries, ...reactionEntries, ...termEntries, ...controlEntries, ...arcadeEntries];

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
