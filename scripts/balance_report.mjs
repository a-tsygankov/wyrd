// Balance report: does every opponent spell have an answer, and at what
// price? Runs the real resolver over the legal pool (run `pnpm build` first),
// prints markdown. docs/balance-analysis.md interprets the numbers.
//
//   node scripts/balance_report.mjs [classic|teeth|resolve] [--all]
//
// A "threat" is a spell that, unanswered, scores against the player, damages
// their Resolve, breaks their ward or binds them. A "counter" is a reaction
// that removes that gain (the player ends the encounter no worse off in
// seals, ward and Resolve). Prices are the Teeth reaction costs.
import { createInitialDuelState, resolveEncounter, resolveRound, REACTION_COSTS } from "../dist/packages/wyrd-resolver/src/index.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { reactionProbabilities, PERSONALITIES } from "../dist/packages/wyrd-simulation/src/bot.js";
import { sealValue } from "../dist/packages/wyrd-simulation/src/advisor.js";

const rulesetId = process.argv.find(a => ["classic", "teeth", "resolve"].includes(a)) ?? "teeth";
const showAll = process.argv.includes("--all");
const rules = rulesets[rulesetId].rules;
const pool = enumerateLegalSpells(POC_TRAY);
const REACTIONS = [undefined, "silence", "reflect", "null"];

function fresh(setup = {}) {
    const state = createInitialDuelState(rules);
    if (setup.playerWard) state.players.player.ward = { ownerId: "player", ...setup.playerWard, ...(rules.wardIntegrity ? { integrity: rules.wardIntegrity } : {}) };
    if (setup.gate) state.gate = setup.gate;
    if (setup.gateWard) state.gateWard = { ...setup.gateWard, ...(rules.wardIntegrity ? { integrity: rules.wardIntegrity } : {}) };
    return state;
}

/** How much worse off the player is after the encounter, from their side: seals, ward, Resolve, binding. */
function harm(before, result) {
    const after = result.state.players.player;
    const seals = -sealValue(result, "player");
    const ward = before.players.player.ward && !after.ward ? 1 : 0;
    const dent = before.players.player.ward && after.ward && (after.ward.integrity ?? 9) < (before.players.player.ward.integrity ?? 9) ? 0.3 : 0;
    const resolve = rules.resolve > 0 ? Math.max(0, (before.players.player.resolve ?? 0) - (after.resolve ?? 0)) * 0.25 : 0;
    const bound = !before.players.player.bound && after.bound ? 0.5 : 0;
    return seals + ward + dent + resolve + bound;
}

function shapeOf(spell) {
    return [spell.action, spell.target ?? "-", spell.essence ? "essence" : "-", ...spell.modifiers].join(" ");
}

const situations = [
    { id: "fresh", setup: {} },
    { id: "you hold an untyped ward", setup: { playerWard: {} } },
    { id: "you hold a FIRE ward", setup: { playerWard: { essence: "fire" } } },
    { id: "gate closed", setup: { gate: "closed" } },
    { id: "gate broken", setup: { gate: "broken" } },
    { id: "you ward the gate", setup: { gateWard: { ownerId: "player" } } }
];

const rows = [];
for (const spell of pool) {
    const shape = shapeOf(spell);
    if (!showAll && rows.some(r => r.shape === shape)) continue;
    for (const situation of situations) {
        const state = fresh(situation.setup);
        const outcomes = REACTIONS.map(reaction => {
            const result = resolveEncounter(state, { casterId: "opponent", defenderId: "player", spellTokens: spell.tokens, ...(reaction ? { reaction } : {}) });
            return { reaction: reaction ?? "none", harm: harm(state, result), gain: sealValue(result, "player") };
        });
        const unanswered = outcomes[0];
        if (unanswered.harm <= 0) continue; // not a threat here
        const counters = outcomes.filter(o => o.reaction !== "none" && o.harm <= 0);
        const cheapest = counters.map(o => REACTION_COSTS[o.reaction]).sort((a, b) => a - b)[0];
        const punishes = counters.some(o => o.gain > 0);
        rows.push({
            shape,
            example: spell.tokens.join(" "),
            cost: spell.focusCost,
            situation: situation.id,
            harm: unanswered.harm,
            counters: counters.map(o => `${o.reaction.toUpperCase()}${o.gain > 0 ? "+" : ""}`).join(" "),
            cheapest,
            punishes,
            flags: [
                counters.length === 0 ? "UNANSWERABLE" : "",
                counters.length === 1 && counters[0].reaction === "null" ? "NULL-ONLY" : "",
                cheapest !== undefined && rules.reactionCosts && cheapest > spell.focusCost ? "TEMPO-NEGATIVE" : "",
                cheapest !== undefined && rules.reactionCosts && cheapest * 2 <= spell.focusCost ? "CHEAP-ANSWER" : ""
            ].filter(Boolean).join(" ")
        });
    }
}

const md = [];
md.push(`## Threat table · ${rulesets[rulesetId].title} rules`);
md.push("");
md.push(`Pool: ${pool.length} legal spells, ${new Set(pool.map(shapeOf)).size} shapes. Threat rows only (a spell that costs you nothing unanswered is not listed). "+" marks a counter that also scores for you. Prices: SILENCE ${REACTION_COSTS.silence}, REFLECT ${REACTION_COSTS.reflect}, NULL ${REACTION_COSTS.null}${rules.reactionCosts ? "" : " (free under these rules)"}.`);
md.push("");
md.push("| Opponent spell (shape) | Focus | Situation | Harm unanswered | Counters | Cheapest | Flags |");
md.push("|---|---:|---|---:|---|---:|---|");
for (const r of rows.sort((a, b) => (b.flags.length - a.flags.length) || b.harm - a.harm)) {
    md.push(`| ${r.example} | ${r.cost} | ${r.situation} | ${r.harm.toFixed(2)} | ${r.counters || "—"} | ${r.cheapest ?? "—"} | ${r.flags} |`);
}
md.push("");

// --- Dominance: what does the bot's own reaction table leave open to the player?
md.push(`## Player spells by expected seals against the balanced bot · ${rulesets[rulesetId].title}`);
md.push("");
for (const situation of situations.slice(0, 2)) {
    const state = createInitialDuelState(rules);
    if (situation.setup.playerWard) state.players.opponent.ward = { ownerId: "opponent", ...(rules.wardIntegrity ? { integrity: rules.wardIntegrity } : {}) };
    const view = { state, botId: "opponent", personality: PERSONALITIES[0] };
    const evs = pool.map(spell => {
        const probs = reactionProbabilities(spell.tokens, view);
        let ev = 0;
        for (const [reaction, p] of Object.entries(probs)) {
            if (p <= 0) continue;
            const result = resolveEncounter(state, { casterId: "player", defenderId: "opponent", spellTokens: spell.tokens, ...(reaction === "none" ? {} : { reaction }) });
            ev += p * sealValue(result, "player");
        }
        return { spell: spell.tokens.join(" "), cost: spell.focusCost, ev };
    }).sort((a, b) => b.ev - a.ev || a.cost - b.cost);
    md.push(`### ${situation.id === "fresh" ? "Fresh board" : "Opponent holds an untyped ward"}`);
    md.push("");
    md.push("| Player spell | Focus | Expected seals |");
    md.push("|---|---:|---:|");
    for (const e of evs.slice(0, 8)) md.push(`| ${e.spell} | ${e.cost} | ${e.ev >= 0 ? "+" : ""}${e.ev.toFixed(2)} |`);
    const positive = evs.filter(e => e.ev > 0.05).length;
    md.push("");
    md.push(`${positive} of ${evs.length} spells have a positive expectation here; the top spell's expectation is ${evs[0].ev.toFixed(2)}.`);
    md.push("");
}

// --- Resolution order: initiative and the contested gate (fix 3).
md.push("## Resolution order");
md.push("");
{
    const state = createInitialDuelState(rules);
    const race = resolveRound(state, { player: { spellTokens: ["GATE", "CLOSE"] }, opponent: { spellTokens: ["GATE", "CLOSE"] } });
    const cheap = resolveRound(state, { player: { spellTokens: ["SEEK", "ENEMY"] }, opponent: { spellTokens: ["FIRE", "SEEK", "ENEMY"] } });
    md.push(`Both mages cast GATE CLOSE on an open gate: ${race.contested ? "the gate is contested - it shudders and holds, nobody scores" : "the first to resolve scores"} (initiative: ${race.initiative.first} by ${race.initiative.reason}). SEEK ENEMY (2) against FIRE SEEK ENEMY (3): ${cheap.initiative.first} resolves first by ${cheap.initiative.reason}.`);
}
console.log(md.join("\n"));
