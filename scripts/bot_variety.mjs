// Bot variety report: does the computer opponent repeat itself?
// Plays bot vs bot rounds from many seeds (run `pnpm build` first) and prints,
// per personality and ruleset: distinct spells, the most common spell's share,
// Shannon entropy (bits), how often a spell recurs within 6 rounds, and how
// the reaction choice spreads against a fixed set of incoming spells.
//
//   node scripts/bot_variety.mjs [seeds=40] [rounds=12]
import { beginNextRound, createInitialDuelState, resolveRound } from "../dist/packages/wyrd-resolver/src/index.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { PERSONALITIES, chooseBotReaction, chooseBotSpell, choosePlan, reactionProbabilities } from "../dist/packages/wyrd-simulation/src/bot.js";

const seeds = Number(process.argv[2] ?? 40);
const rounds = Number(process.argv[3] ?? 12);
const pool = enumerateLegalSpells(POC_TRAY);

function entropy(counts) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return -[...counts.values()].reduce((sum, n) => sum + (n / total) * Math.log2(n / total), 0);
}

/** One match: two bots (the personality under test as the opponent, the Adept as the player), `rounds` rounds or until 3 seals. */
function playMatch(personality, rules, seed) {
    const rng = createRng(seed);
    let state = createInitialDuelState(rules);
    const recent = { player: [], opponent: [] };
    const spells = [];
    const plans = [];
    for (let r = 0; r < rounds; r++) {
        const views = {
            opponent: { state, botId: "opponent", personality, recentBotSpells: recent.opponent },
            player: { state, botId: "player", personality: PERSONALITIES[0], recentBotSpells: recent.player }
        };
        const plan = choosePlan(views.opponent, rng);
        const opp = chooseBotSpell(pool, { ...views.opponent, plan }, rng);
        const me = chooseBotSpell(pool, { ...views.player, plan: choosePlan(views.player, rng) }, rng);
        const oppReaction = chooseBotReaction(me, { ...views.opponent, plan }, rng);
        const myReaction = chooseBotReaction(opp, views.player, rng);
        const round = resolveRound(state, {
            opponent: { spellTokens: opp, ...(myReaction ? { reaction: myReaction } : {}) },
            player: { spellTokens: me, ...(oppReaction ? { reaction: oppReaction } : {}) }
        });
        spells.push(opp.join(" "));
        plans.push(plan);
        recent.opponent.push(opp);
        recent.player.push(me);
        state = beginNextRound(round.state);
        if (state.players.player.seals >= 3 || state.players.opponent.seals >= 3) break;
    }
    return { spells, plans };
}

const INCOMING = [
    ["FIRE", "SEEK", "ENEMY"],
    ["FIRE", "SEEK", "ENEMY", "AMPLIFY"],
    ["ENEMY", "BIND"],
    ["GATE", "CLOSE"],
    ["SEEK", "ENEMY", "SPLIT"],
    ["GATE", "OPEN", "REVERSE"],
    ["SELF", "WARD", "SHADOW"]
];

const out = [];
out.push(`# Bot variety · ${seeds} seeds × up to ${rounds} rounds per personality and ruleset`);
out.push("");
out.push("| Ruleset | Personality | Rounds | Distinct spells | Top spell (share) | Entropy bits | Repeat within 6 | Plans used |");
out.push("|---|---|---:|---:|---|---:|---:|---|");
const summary = {};
for (const rulesetId of ["classic", "teeth", "resolve"]) {
    const rules = rulesets[rulesetId].rules;
    for (const personality of PERSONALITIES) {
        const counts = new Map();
        const planCounts = new Map();
        let total = 0;
        let repeats = 0;
        for (let seed = 1; seed <= seeds; seed++) {
            const { spells, plans } = playMatch(personality, rules, seed * 7919 + rulesetId.length);
            spells.forEach((s, i) => {
                counts.set(s, (counts.get(s) ?? 0) + 1);
                total++;
                if (spells.slice(Math.max(0, i - 6), i).includes(s)) repeats++;
            });
            for (const p of plans) planCounts.set(p, (planCounts.get(p) ?? 0) + 1);
        }
        const [topSpell, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const share = topCount / total;
        summary[`${rulesetId}/${personality.id}`] = { distinct: counts.size, share, entropy: entropy(counts), repeatRate: repeats / total };
        out.push(
            `| ${rulesetId} | ${personality.id} | ${total} | ${counts.size} | ${topSpell} (${(share * 100).toFixed(0)}%) | ${entropy(counts).toFixed(2)} | ${((repeats / total) * 100).toFixed(1)}% | ${[...planCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${((n / total) * 100).toFixed(0)}%`).join(", ")} |`
        );
    }
}
out.push("");
out.push("## Reactions against fixed incoming spells (Teeth, fresh board)");
out.push("");
out.push("| Personality | " + INCOMING.map(s => s.join(" ")).join(" | ") + " |");
out.push("|---|" + INCOMING.map(() => "---").join("|") + "|");
for (const personality of PERSONALITIES) {
    const state = createInitialDuelState(rulesets.teeth.rules);
    const cells = INCOMING.map(spell => {
        const p = reactionProbabilities(spell, { state, botId: "opponent", personality });
        return Object.entries(p)
            .filter(([, v]) => v >= 0.05)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
            .join(" / ");
    });
    out.push(`| ${personality.id} | ${cells.join(" | ")} |`);
}
console.log(out.join("\n"));
export { summary };
