import { scenarios, type Scenario, type ScenarioOutcome } from "../../../packages/wyrd-content/src/scenarios.js";
import { parseSpell } from "../../../packages/wyrd-grammar/src/parser.js";
import {
    adviseReaction,
    adviseSpell,
    chooseBotReaction,
    chooseBotSpell,
    createRng,
    enumerateLegalSpells,
    explainMatch,
    explainReaction,
    explainRound,
    explainSpell,
    fixedReactionModel,
    formatTelegraph,
    projectTelegraph,
    reactionProbabilities,
    seedFromString,
    type ReactionModel,
    type Rng,
    type RoundHistory,
    type TelegraphSlot
} from "../../../packages/wyrd-simulation/src/index.js";
import { installHint } from "./install.js";
import { createLog } from "./log.js";
import {
    acknowledgeHandoff,
    commitP1,
    lockP2Spell,
    presentation,
    resolveP2,
    startRound,
    type HotseatRound
} from "./hotseat.js";
import { buildRoundEvent, createTelemetry, getSessionId } from "./telemetry.js";
import {
    createInitialDuelState,
    resolveEncounter,
    type DuelState,
    type ReactionGlyph,
    type ResolutionResult,
    type ResolutionStep
} from "../../../packages/wyrd-resolver/src/index.js";

type GlyphFamily = "essence" | "action" | "target" | "modifier";

type GlyphChoice = {
    token: string;
    family: GlyphFamily;
};

const glyphChoices: GlyphChoice[] = [
    { token: "FIRE", family: "essence" },
    { token: "SHADOW", family: "essence" },
    { token: "SELF", family: "target" },
    { token: "ENEMY", family: "target" },
    { token: "GATE", family: "target" },
    { token: "SEEK", family: "action" },
    { token: "BIND", family: "action" },
    { token: "WARD", family: "action" },
    { token: "CLOSE", family: "action" },
    { token: "AMPLIFY", family: "modifier" },
    { token: "ANCHOR", family: "modifier" }
];

function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error("Missing element #" + id);
    }
    return element as T;
}

const playerSeals = byId<HTMLElement>("player-seals");
const opponentSeals = byId<HTMLElement>("opponent-seals");
const roundNumber = byId<HTMLElement>("round-number");
const telegraph = byId<HTMLElement>("telegraph");
const matchStatus = byId<HTMLElement>("match-status");
const spellPreview = byId<HTMLElement>("spell-preview");
const focusCost = byId<HTMLElement>("focus-cost");
const diagnostic = byId<HTMLElement>("spell-diagnostic");
const glyphTray = byId<HTMLElement>("glyph-tray");
const reactionTray = byId<HTMLElement>("reaction-tray");
const combatLog = byId<HTMLOListElement>("combat-log");
const resolveRoundButton = byId<HTMLButtonElement>("resolve-round");
const nextRoundButton = byId<HTMLButtonElement>("next-round");
const undoButton = byId<HTMLButtonElement>("undo-glyph");
const clearButton = byId<HTMLButtonElement>("clear-spell");
const resetButton = byId<HTMLButtonElement>("reset-match");

const scenarioNote = byId<HTMLElement>("scenario-note");
const modeToggle = byId<HTMLButtonElement>("mode-toggle");
const handoff = byId<HTMLElement>("handoff");
const handoffText = byId<HTMLElement>("handoff-text");
const handoffReady = byId<HTMLButtonElement>("handoff-ready");
const youLabel = byId<HTMLElement>("you-label");
const oppLabel = byId<HTMLElement>("opp-label");
const telegraphLabel = byId<HTMLElement>("telegraph-label");
const reactionLabel = byId<HTMLElement>("reaction-label");
const composerCard = document.querySelector<HTMLElement>(".composer")!;
const spellExplain = byId<HTMLUListElement>("spell-explain");
const glyphHelpDetails = byId<HTMLDetailsElement>("glyph-help");
const glyphHelpToggle = byId<HTMLElement>("glyph-help-toggle");
const glyphHelpList = byId<HTMLUListElement>("glyph-help-list");
const GLYPH_HELP_OPEN_KEY = "wyrd.glyphHelp.open";
try {
    glyphHelpDetails.open = localStorage.getItem(GLYPH_HELP_OPEN_KEY) === "1";
} catch {
    // Private mode: starts collapsed, which is the default anyway.
}
glyphHelpDetails.addEventListener("toggle", () => {
    try {
        localStorage.setItem(GLYPH_HELP_OPEN_KEY, glyphHelpDetails.open ? "1" : "0");
    } catch {
        // Nothing to persist to; the choice lasts for this page load.
    }
});
const reactionExplain = byId<HTMLElement>("reaction-explain");
const reactionCard = document.querySelector<HTMLElement>(".reaction")!;

// Solo: the scenario deck, then the heuristic bot. Hot-seat: Player 2 on the
// same phone takes the opponent's seat (state machine in hotseat.ts).
type Mode = "solo" | "hotseat";
let mode: Mode = new URLSearchParams(location.search).get("mode") === "hotseat" ? "hotseat" : "solo";
let hotseat: HotseatRound = startRound();
let p1Telegraph: TelegraphSlot[] = [];
/** Round-by-round reasons, for the match verdict. */
let history: RoundHistory[] = [];

/** Who "you" and "the opponent" are in explanations, per mode and phase. */
function names(): { you: string; them: string } {
    if (mode === "solo") return { you: "you", them: "the opponent" };
    return hotseat.phase === "p2-compose" ? { you: "Player 2", them: "Player 1" } : { you: "Player 1", them: "Player 2" };
}

let state: DuelState = createInitialDuelState();
let playerSpell: string[] = [];
let selectedReaction: ReactionGlyph | undefined;
let roundResolved = false;

// The opponent: the curated scenario deck (packages/wyrd-content) round by
// round, then the heuristic bot (packages/wyrd-simulation). Everything the
// opponent does derives from the match seed, so `?seed=<text>` in the URL
// replays the same opponent - a shareable challenge.
const seedParam = new URLSearchParams(location.search).get("seed");
const spellPool = enumerateLegalSpells(glyphChoices.map(choice => choice.token));

type RoundPlan = {
    scenario?: Scenario;
    opponentSpell: string[];
    telegraph: TelegraphSlot[];
    reaction: (spell: string[]) => ReactionGlyph | undefined;
    /** What the admin advisor assumes about the opponent's reaction. */
    reactionModel: ReactionModel;
    /** Human-readable reaction policy for the admin console. */
    reactionPolicy: string;
};

const log = createLog();

let matchSeedLabel = "";
let rng: Rng = createRng(0);
let lastBotSpell: string[] | undefined;
let plan: RoundPlan;

function newMatchSeed(): void {
    matchSeedLabel = seedParam ?? String(Math.floor(Math.random() * 1_000_000));
    rng = createRng(seedFromString(matchSeedLabel));
    lastBotSpell = undefined;
}

function botView(): { state: DuelState; botId: "opponent"; lastBotSpell: string[] | undefined } {
    return { state, botId: "opponent", lastBotSpell };
}

function planRound(): RoundPlan {
    if (mode === "hotseat") {
        // The opponent's spell arrives when Player 2 locks it in; until then
        // there is nothing to telegraph and nothing for the advisor to read.
        hotseat = startRound();
        p1Telegraph = [];
        log.info(`round ${state.round} planned: hot-seat`);
        return {
            opponentSpell: [],
            telegraph: [],
            reaction: () => hotseat.p2Reaction,
            reactionModel: () => ({ none: 0.25, null: 0.25, reflect: 0.25, silence: 0.25 }),
            reactionPolicy: "Player 2 decides"
        };
    }
    const scenario = scenarios[state.round - 1];
    if (scenario) {
        // Scenario setup (an existing ward) is applied as the round opens so
        // the situation matches the lesson regardless of earlier rounds.
        if (scenario.setup?.playerWard) {
            state.players.player.ward = { ownerId: "player", ...scenario.setup.playerWard };
        }
        if (scenario.setup?.opponentWard) {
            state.players.opponent.ward = { ownerId: "opponent", ...scenario.setup.opponentWard };
        }
        const fixed = scenario.opponentReaction;
        log.info(`round ${state.round} planned: scenario ${scenario.id}`, {
            telegraph: scenario.telegraph,
            opponentSpell: scenario.opponentSpell.join(" "),
            opponentReaction: fixed
        });
        return {
            scenario,
            opponentSpell: scenario.opponentSpell,
            telegraph: projectTelegraph(scenario.opponentSpell, scenario.telegraph, rng),
            reaction: spell =>
                fixed === "bot" ? chooseBotReaction(spell, botView(), rng) : fixed === "none" ? undefined : fixed,
            reactionModel: fixed === "bot" ? spell => reactionProbabilities(spell, botView()) : fixedReactionModel(fixed),
            reactionPolicy: fixed === "bot" ? "heuristic bot table" : fixed === "none" ? "no reaction (teaching round)" : `always ${fixed.toUpperCase()}`
        };
    }
    const spell = chooseBotSpell(spellPool, botView(), rng);
    log.info(`round ${state.round} planned: heuristic bot`, { opponentSpell: spell.join(" ") });
    return {
        opponentSpell: spell,
        telegraph: projectTelegraph(spell, "high", rng),
        reaction: playerCast => chooseBotReaction(playerCast, botView(), rng),
        reactionModel: playerCast => reactionProbabilities(playerCast, botView()),
        reactionPolicy: "heuristic bot table"
    };
}

newMatchSeed();
plan = planRound();

// Playtest telemetry (plan POC-5): anonymous, fire-and-forget, off with
// `?telemetry=off`. The web version is read from the footer, which
// build_web.mjs stamps before the worker's versions are appended.
const WEB_VERSION = (document.getElementById("version-line")?.textContent ?? "web vdev").replace(/^web v/, "");
const telemetry = createTelemetry({
    endpoint: "./api/telemetry",
    enabled: new URLSearchParams(location.search).get("telemetry") !== "off"
});
const memoryStorage = new Map<string, string>();
const sessionId = getSessionId({
    getItem: key => {
        try {
            return localStorage.getItem(key) ?? memoryStorage.get(key) ?? null;
        } catch {
            return memoryStorage.get(key) ?? null;
        }
    },
    setItem: (key, value) => {
        memoryStorage.set(key, value);
        try {
            localStorage.setItem(key, value);
        } catch {
            // Private mode: the in-memory copy carries the page load.
        }
    }
});
let roundStartedAt = performance.now();
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void telemetry.flush();
});

function formatSpell(tokens: string[]): string {
    return tokens.length > 0 ? tokens.join(" → ") : "Choose glyphs";
}

const OUTCOME_TEXT: Record<ScenarioOutcome, string> = {
    "player-seal": "seal to you",
    "opponent-seal": "seal to the opponent",
    blocked: "blocked by the ward",
    canceled: "canceled",
    "no-seal": "no seal"
};

function appendLesson(scenario: Scenario): void {
    const heading = document.createElement("li");
    heading.className = "lesson";
    heading.textContent = "Lesson — " + scenario.title + ": " + scenario.lesson;
    combatLog.append(heading);
    for (const response of scenario.responses) {
        const li = document.createElement("li");
        li.className = "lesson-option";
        const what = response.spell ? "Cast " + response.spell.join(" ") : response.label;
        li.textContent = what + " → " + OUTCOME_TEXT[response.expect];
        combatLog.append(li);
    }
}

function renderGlyphTray(): void {
    glyphTray.replaceChildren();

    for (const choice of glyphChoices) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "glyph-button";
        button.dataset.family = choice.family;
        button.textContent = choice.token;
        button.disabled = roundResolved || playerSpell.length >= 4;
        button.addEventListener("click", () => {
            if (playerSpell.length >= 4 || roundResolved) {
                return;
            }
            playerSpell = [...playerSpell, choice.token];
            render();
        });
        glyphTray.append(button);
    }
}

function renderReactionButtons(): void {
    for (const element of reactionTray.querySelectorAll<HTMLButtonElement>(".reaction-button")) {
        const value = element.dataset.reaction as ReactionGlyph | "" | undefined;
        const selected = (value || undefined) === selectedReaction;
        element.classList.toggle("selected", selected);
        element.disabled = roundResolved;
    }
    const slots = mode === "hotseat" && hotseat.phase === "p2-react" ? p1Telegraph : plan.telegraph;
    reactionExplain.textContent = roundResolved || slots.length === 0 ? "" : explainReaction(selectedReaction, slots);
}

function renderValidation(): void {
    const parsed = parseSpell(playerSpell);
    const valid =
        parsed.status === "valid" &&
        playerSpell.length >= 2 &&
        playerSpell.length <= 4 &&
        parsed.focusCost <= 7;

    focusCost.textContent = String(parsed.focusCost);
    spellPreview.textContent = formatSpell(playerSpell);
    diagnostic.classList.toggle("valid", valid);

    if (playerSpell.length < 2) {
        diagnostic.textContent = "Build a 2–4 glyph spell.";
    } else if (parsed.focusCost > 7) {
        diagnostic.textContent = "Too much Focus. Maximum is 7.";
    } else if (parsed.status !== "valid") {
        diagnostic.textContent = parsed.diagnostics[0]?.message ?? "Unstable syntax.";
    } else {
        diagnostic.textContent = "Stable syntax • Focus " + parsed.focusCost;
    }

    resolveRoundButton.disabled = !valid || roundResolved;

    const composing = !roundResolved && (mode === "solo" || hotseat.phase === "p2-compose" || hotseat.phase === "p1-turn");
    const explanation = composing
        ? explainSpell(playerSpell, state, names(), mode === "hotseat" && hotseat.phase === "p2-compose" ? "opponent" : "player")
        : { glyphs: [], summary: [] };
    glyphHelpDetails.classList.toggle("hidden", explanation.glyphs.length === 0);
    glyphHelpToggle.textContent =
        explanation.glyphs.length === 1
            ? `What ${explanation.glyphs[0]!.token} does`
            : `What ${explanation.glyphs.map(g => g.token).join(", ")} do`;
    glyphHelpList.replaceChildren(
        ...explanation.glyphs.map(glyph => {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.className = "glyph-name";
            name.textContent = glyph.token + " ";
            li.append(name, glyph.text);
            return li;
        })
    );
    spellExplain.replaceChildren(
        ...explanation.summary.map(line => {
            const li = document.createElement("li");
            li.className = "summary";
            li.textContent = line;
            return li;
        })
    );
}

function renderScoreboard(): void {
    playerSeals.textContent = String(state.players.player.seals);
    opponentSeals.textContent = String(state.players.opponent.seals);
    roundNumber.textContent = String(state.round);
    if (mode === "hotseat") {
        const shown = presentation(hotseat.phase);
        telegraph.textContent =
            shown.telegraphOf === "p2"
                ? formatTelegraph(plan.telegraph)
                : shown.telegraphOf === "p1"
                    ? formatTelegraph(p1Telegraph)
                    : "—";
        scenarioNote.textContent = "Hot-seat · two players on this phone · seed " + matchSeedLabel;
        matchStatus.textContent =
            state.players.player.seals >= 3
                ? "Player 1 wins the duel"
                : state.players.opponent.seals >= 3
                    ? "Player 2 wins the duel"
                    : shown.status;
        return;
    }

    telegraph.textContent = formatTelegraph(plan.telegraph);
    scenarioNote.textContent = plan.scenario
        ? "Scenario " + state.round + "/" + scenarios.length + " · " + plan.scenario.title + " · seed " + matchSeedLabel
        : "Heuristic opponent · seed " + matchSeedLabel + " · some glyphs are hidden; infer the threat before reacting.";

    const winner =
        state.players.player.seals >= 3
            ? "You win the duel"
            : state.players.opponent.seals >= 3
                ? "Opponent wins"
                : roundResolved
                    ? "Round resolved"
                    : "Your move";

    matchStatus.textContent = winner;
}

// Admin console: everything the player must not see (the hidden spell, the
// bot's odds) plus best-move advice from the resolver itself and the client
// log. Debug tooling for playtests; toggled by a triple-tap on the title.
let adminOpen = new URLSearchParams(location.search).get("admin") === "1";
const adminConsole = byId<HTMLElement>("admin-console");
const adminState = byId<HTMLDListElement>("admin-state");
const adminReactions = byId<HTMLOListElement>("admin-reactions");
const adminSpells = byId<HTMLOListElement>("admin-spells");
const adminLog = byId<HTMLOListElement>("admin-log");

const OUTCOME_SHORT: Record<string, string> = {
    "player-seal": "seal to you",
    "opponent-seal": "seal to opponent",
    blocked: "blocked by ward",
    canceled: "canceled",
    "no-seal": "no seal"
};

function renderAdmin(): void {
    adminConsole.classList.toggle("hidden", !adminOpen);
    if (!adminOpen) return;

    const wards = (["player", "opponent"] as const)
        .map(id => {
            const ward = state.players[id].ward;
            return ward ? `${id}: ${ward.essence ?? "untyped"}` : `${id}: none`;
        })
        .join(" · ");
    const facts: Array<[string, string]> = [
        ["Seed", matchSeedLabel],
        ["Round", `${state.round} · ${roundResolved ? "resolved" : "awaiting your cast"}`],
        ["Scenario", plan.scenario ? `${plan.scenario.id} (telegraph ${plan.scenario.telegraph})` : "heuristic bot (telegraph high)"],
        ["Mode", mode === "solo" ? "solo" : `hot-seat · ${hotseat.phase}`],
        ["Hidden spell", plan.opponentSpell.join(" ") || "(not cast yet)"],
        ["Opponent reacts", plan.reactionPolicy],
        ["Wards", wards],
        ["Versions", document.getElementById("version-line")?.textContent ?? ""],
        ["Session", sessionId]
    ];
    adminState.replaceChildren(
        ...facts.flatMap(([term, detail]) => {
            const dt = document.createElement("dt");
            dt.textContent = term;
            const dd = document.createElement("dd");
            dd.textContent = detail;
            return [dt, dd];
        })
    );

    const reactions = plan.opponentSpell.length > 0 ? adviseReaction(state, plan.opponentSpell) : [];
    adminReactions.replaceChildren(
        ...reactions.map((advice, index) => {
            const li = document.createElement("li");
            if (index === 0) li.className = "best";
            const name = advice.reaction === "none" ? "No reaction" : advice.reaction.toUpperCase();
            li.textContent = `${name} → ${OUTCOME_SHORT[advice.outcome] ?? advice.outcome} (${advice.value > 0 ? "+" : ""}${advice.value})`;
            const why = document.createElement("span");
            why.className = "why";
            why.textContent = advice.explanation.replace(/^[^:]+:\s*/, "");
            li.append(why);
            return li;
        })
    );

    const spells = adviseSpell(state, spellPool, plan.reactionModel, { top: 3 });
    adminSpells.replaceChildren(
        ...spells.map((advice, index) => {
            const li = document.createElement("li");
            if (index === 0) li.className = "best";
            li.textContent = `${advice.tokens.join(" ")} · EV ${advice.expectedValue > 0 ? "+" : ""}${advice.expectedValue} · Focus ${advice.focusCost}`;
            const why = document.createElement("span");
            why.className = "why";
            why.textContent = advice.explanation;
            li.append(why);
            return li;
        })
    );

    const entries = [...log.entries()].slice(-40).reverse();
    adminLog.replaceChildren(
        ...entries.map(entry => {
            const li = document.createElement("li");
            li.className = entry.level;
            const time = new Date(entry.ts).toISOString().slice(11, 19);
            li.textContent = `${time} ${entry.message}${entry.data !== undefined ? " " + JSON.stringify(entry.data) : ""}`;
            return li;
        })
    );
}

let titleTaps: number[] = [];
byId<HTMLElement>("title-block").addEventListener("click", () => {
    const now = performance.now();
    titleTaps = [...titleTaps.filter(t => now - t < 900), now];
    if (titleTaps.length >= 3) {
        titleTaps = [];
        adminOpen = !adminOpen;
        log.info(adminOpen ? "admin console opened" : "admin console closed");
        renderAdmin();
    }
});
byId<HTMLButtonElement>("admin-close").addEventListener("click", () => {
    adminOpen = false;
    renderAdmin();
});
log.subscribe(() => {
    if (adminOpen) renderAdmin();
});

function renderMode(): void {
    const matchOver = state.players.player.seals >= 3 || state.players.opponent.seals >= 3;
    modeToggle.textContent = mode === "solo" ? "Hot-seat" : "Solo";
    if (mode === "solo") {
        youLabel.textContent = "You";
        oppLabel.textContent = "Opponent";
        telegraphLabel.textContent = "Opponent telegraph";
        reactionLabel.textContent = "Reaction to opponent";
        composerCard.classList.remove("hidden");
        reactionCard.classList.remove("hidden");
        reactionTray.classList.remove("hidden");
        handoff.classList.add("hidden");
        resolveRoundButton.textContent = "CAST ROUND";
        return;
    }
    const shown = presentation(hotseat.phase);
    youLabel.textContent = "Player 1";
    oppLabel.textContent = "Player 2";
    telegraphLabel.textContent = shown.telegraphLabel || "Telegraph";
    reactionLabel.textContent = shown.reactionLabel;
    composerCard.classList.toggle("hidden", !shown.showComposer);
    // The primary button lives in the reaction card, so the card stays for
    // Player 2's compose step while the tray itself is hidden.
    const needsPrimary = shown.castLabel !== "" && !matchOver;
    reactionCard.classList.toggle("hidden", !(shown.showReaction || needsPrimary));
    reactionTray.classList.toggle("hidden", !shown.showReaction);
    handoff.classList.toggle("hidden", shown.overlay === undefined);
    handoffText.textContent = shown.overlay ?? "";
    resolveRoundButton.textContent = shown.castLabel || "CAST ROUND";
    if (hotseat.phase === "p2-react") resolveRoundButton.disabled = matchOver;
}

function render(): void {
    renderScoreboard();
    renderGlyphTray();
    renderReactionButtons();
    renderValidation();
    renderMode();
    renderAdmin();

    const matchOver =
        state.players.player.seals >= 3 ||
        state.players.opponent.seals >= 3;

    nextRoundButton.classList.toggle("hidden", !roundResolved || matchOver);
}

function appendSteps(prefix: string, steps: ResolutionStep[]): void {
    const heading = document.createElement("li");
    heading.textContent = prefix;
    heading.style.fontWeight = "800";
    combatLog.append(heading);

    for (const item of steps) {
        const li = document.createElement("li");
        li.textContent = item.text;
        combatLog.append(li);
    }
}

function resolveRound(): void {
    if (roundResolved) {
        return;
    }

    const parsed = parseSpell(playerSpell);
    if (
        parsed.status !== "valid" ||
        playerSpell.length < 2 ||
        playerSpell.length > 4 ||
        parsed.focusCost > 7
    ) {
        return;
    }

    combatLog.replaceChildren();
    const committedAt = performance.now();
    const sealsBefore = { player: state.players.player.seals, opponent: state.players.opponent.seals };

    const opponentSpell = plan.opponentSpell;
    const incoming = resolveEncounter(state, {
        casterId: "opponent",
        defenderId: "player",
        spellTokens: opponentSpell,
        ...(selectedReaction ? { reaction: selectedReaction } : {})
    });

    state = incoming.state;
    appendSteps(
        "Opponent: " + formatSpell(opponentSpell) + (selectedReaction ? " • you used " + selectedReaction.toUpperCase() : ""),
        incoming.steps
    );

    let botReaction: ReactionGlyph | undefined;
    let outgoing: ResolutionResult | undefined;
    if (state.players.opponent.seals < 3 && state.players.player.seals < 3) {
        botReaction = plan.reaction(playerSpell);
        outgoing = resolveEncounter(state, {
            casterId: "player",
            defenderId: "opponent",
            spellTokens: playerSpell,
            ...(botReaction ? { reaction: botReaction } : {})
        });

        state = outgoing.state;
        appendSteps(
            "You: " + formatSpell(playerSpell) +
                (botReaction ? " • opponent used " + botReaction.toUpperCase() : ""),
            outgoing.steps
        );
    }

    lastBotSpell = opponentSpell;

    // Who won the round and why, on top of the log; the match verdict when
    // the duel ends. Both come from the resolutions themselves.
    const who = names();
    const round = explainRound(
        { result: incoming, spell: opponentSpell, reaction: selectedReaction },
        outgoing ? { result: outgoing, spell: playerSpell, reaction: botReaction } : undefined,
        who
    );
    history.push({ round: state.round, reasons: round.reasons });
    const verdictItems = [round.verdict, ...round.reasons].map((text, index) => {
        const li = document.createElement("li");
        li.className = index === 0 ? "verdict" : "reason";
        li.textContent = text;
        return li;
    });
    combatLog.prepend(...verdictItems);
    if (state.players.player.seals >= 3 || state.players.opponent.seals >= 3) {
        const li = document.createElement("li");
        li.className = "verdict";
        li.textContent = explainMatch(state, history, who);
        combatLog.prepend(li);
    }

    if (plan.scenario) {
        appendLesson(plan.scenario);
    }
    roundResolved = true;
    log.info(`round ${state.round} resolved`, {
        you: playerSpell.join(" ") + (selectedReaction ? ` (reacted ${selectedReaction})` : ""),
        opponent: opponentSpell.join(" ") + (botReaction ? ` (reacted ${botReaction})` : ""),
        seals: `${state.players.player.seals}-${state.players.opponent.seals}`,
        commitMs: Math.round(committedAt - roundStartedAt)
    });

    telemetry.record(
        buildRoundEvent({
            sessionId,
            matchSeed: matchSeedLabel,
            webVersion: WEB_VERSION,
            round: state.round,
            scenarioId: plan.scenario?.id,
            telegraphPreset: plan.scenario?.telegraph ?? "high",
            telegraph: formatTelegraph(plan.telegraph),
            opponentSpell,
            playerSpell,
            playerReaction: selectedReaction,
            opponentReaction: botReaction,
            playerSealsBefore: sealsBefore.player,
            opponentSealsBefore: sealsBefore.opponent,
            playerSeals: state.players.player.seals,
            opponentSeals: state.players.opponent.seals,
            roundStartedAt,
            committedAt,
            mode
        })
    );
    if (state.players.player.seals >= 3 || state.players.opponent.seals >= 3) {
        telemetry.record({
            event: "match_end",
            mode,
            sessionId,
            matchSeed: matchSeedLabel,
            webVersion: WEB_VERSION,
            round: state.round,
            playerSeals: state.players.player.seals,
            opponentSeals: state.players.opponent.seals
        });
    }
    void telemetry.flush();
    render();
}

function startNextRound(): void {
    if (!roundResolved) {
        return;
    }

    state = {
        ...state,
        round: state.round + 1,
        players: {
            player: { ...state.players.player, focus: 7 },
            opponent: { ...state.players.opponent, focus: 7 }
        }
    };
    playerSpell = [];
    selectedReaction = undefined;
    roundResolved = false;
    plan = planRound();
    roundStartedAt = performance.now();
    combatLog.innerHTML = "<li>Opponent spell is waiting.</li>";
    render();
}

function resetMatch(): void {
    // A reset after at least one resolved round is a rematch signal - the
    // plan's cheapest proxy for "did they want to play again".
    if (roundResolved || state.round > 1) {
        telemetry.record({
            event: "rematch",
            mode,
            sessionId,
            matchSeed: matchSeedLabel,
            webVersion: WEB_VERSION,
            round: state.round,
            playerSeals: state.players.player.seals,
            opponentSeals: state.players.opponent.seals
        });
        void telemetry.flush();
    }
    state = createInitialDuelState();
    history = [];
    playerSpell = [];
    selectedReaction = undefined;
    roundResolved = false;
    // A seeded URL replays the same match; otherwise every reset is a new one.
    newMatchSeed();
    plan = planRound();
    roundStartedAt = performance.now();
    combatLog.innerHTML = "<li>Opponent spell is waiting.</li>";
    render();
}

reactionTray.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains("reaction-button")) {
        return;
    }
    selectedReaction = (target.dataset.reaction || undefined) as ReactionGlyph | undefined;
    renderReactionButtons();
});

undoButton.addEventListener("click", () => {
    if (!roundResolved) {
        playerSpell = playerSpell.slice(0, -1);
        render();
    }
});

clearButton.addEventListener("click", () => {
    if (!roundResolved) {
        playerSpell = [];
        render();
    }
});

function spellIsCastable(): boolean {
    const parsed = parseSpell(playerSpell);
    return parsed.status === "valid" && playerSpell.length >= 2 && playerSpell.length <= 4 && parsed.focusCost <= 7;
}

function onPrimaryAction(): void {
    if (mode === "solo") {
        resolveRound();
        return;
    }
    switch (hotseat.phase) {
        case "p2-compose": {
            if (!spellIsCastable()) return;
            hotseat = lockP2Spell(hotseat, playerSpell);
            plan = { ...plan, opponentSpell: [...playerSpell], telegraph: projectTelegraph(playerSpell, "high", rng) };
            log.info(`round ${state.round}: player 2 locked in`, { glyphs: playerSpell.length });
            playerSpell = [];
            selectedReaction = undefined;
            break;
        }
        case "p1-turn": {
            if (!spellIsCastable()) return;
            hotseat = commitP1(hotseat, playerSpell, selectedReaction);
            p1Telegraph = projectTelegraph(playerSpell, "high", rng);
            log.info(`round ${state.round}: player 1 committed`, { glyphs: playerSpell.length, reaction: selectedReaction ?? "none" });
            playerSpell = [];
            selectedReaction = undefined;
            break;
        }
        case "p2-react": {
            hotseat = resolveP2(hotseat, selectedReaction);
            // Restore Player 1's commitment: resolveRound reads the player's
            // spell and reaction from the shared composer state, and takes
            // the opponent's reaction from plan.reaction (Player 2's choice).
            playerSpell = [...(hotseat.p1Spell ?? [])];
            selectedReaction = hotseat.p1Reaction;
            resolveRound();
            return;
        }
        default:
            return;
    }
    render();
}

resolveRoundButton.addEventListener("click", onPrimaryAction);
handoffReady.addEventListener("click", () => {
    if (hotseat.phase === "handoff-to-p1" || hotseat.phase === "handoff-to-p2") {
        hotseat = acknowledgeHandoff(hotseat);
        render();
    }
});
modeToggle.addEventListener("click", () => {
    mode = mode === "solo" ? "hotseat" : "solo";
    log.info(`mode: ${mode}`);
    resetMatch();
});
nextRoundButton.addEventListener("click", startNextRound);
resetButton.addEventListener("click", resetMatch);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./sw.js")
            .then(registration => log.info("service worker registered", { scope: registration.scope }))
            .catch(error => log.warn("service worker registration failed", String(error)));
    });
} else {
    log.warn("service workers unsupported: no offline shell");
}

// Install coaching (policy in install.ts, tested in node). The banner is
// decoration for the product commitment "installable on iPhone and
// Android"; gameplay never depends on it.
type BeforeInstallPromptEvent = Event & { prompt(): Promise<void> };
const INSTALL_DISMISSED_KEY = "wyrd.install.dismissed";
let deferredInstallPrompt: BeforeInstallPromptEvent | undefined;

function readDismissed(): boolean {
    try {
        return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

function renderInstallBanner(): void {
    const banner = document.getElementById("install-banner");
    const text = document.getElementById("install-text");
    const installButton = document.getElementById("install-now");
    if (!banner || !text || !installButton) return;

    const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const hint = installHint({
        userAgent: navigator.userAgent,
        standalone,
        dismissed: readDismissed(),
        canPrompt: deferredInstallPrompt !== undefined
    });

    banner.classList.toggle("hidden", hint === null);
    installButton.classList.toggle("hidden", hint !== "prompt");
    if (hint !== null) log.info(`install hint shown: ${hint}`);
    if (hint === "ios") {
        text.textContent = "Add Wyrd to your Home Screen: tap Share, then “Add to Home Screen”.";
    } else if (hint === "prompt") {
        text.textContent = "Install Wyrd for full-screen play.";
    }
}

window.addEventListener("beforeinstallprompt", event => {
    // Keep the browser's own mini-infobar out of the way; the banner's
    // Install button replays the prompt on tap.
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    renderInstallBanner();
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = undefined;
    renderInstallBanner();
});

document.getElementById("install-now")?.addEventListener("click", () => {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = undefined;
    renderInstallBanner();
    void prompt?.prompt();
});

document.getElementById("install-dismiss")?.addEventListener("click", () => {
    try {
        localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
        // Private mode without storage: the banner simply returns next visit.
    }
    renderInstallBanner();
});

renderInstallBanner();

// Tier versions in the footer. The web version is inlined at build time
// (scripts/build_web.mjs); worker + schema come from the worker through
// the Pages /api/* proxy. Offline, or before the worker's first deploy,
// the web version alone is shown.
type VersionResponse = { worker: { version: string }; schema: { version: string | null } };
const versionLine = document.getElementById("version-line");
if (versionLine) {
    void fetch("./api/version", { headers: { accept: "application/json" } })
        .then(response => (response.ok ? (response.json() as Promise<VersionResponse>) : Promise.reject(new Error(String(response.status)))))
        .then(versions => {
            versionLine.textContent =
                `${versionLine.textContent} · worker v${versions.worker.version} · schema ${versions.schema.version ?? "none"}`;
            log.info("worker reachable", versions);
        })
        .catch(error => log.warn("worker unreachable (offline or not deployed)", String(error)));
}

render();
