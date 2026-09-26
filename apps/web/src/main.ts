import { rulesets, type Ruleset, type RulesetId } from "../../../packages/wyrd-content/src/rulesets.js";
import { scenarios, type Scenario } from "../../../packages/wyrd-content/src/scenarios.js";
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
    lessonOutcomes,
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
import { loadSettings, saveSettings, type Settings } from "./settings.js";
import { loadStats, recordMatchEnd, recordRematch, recordRound, saveStats, summarize, type Stats } from "./stats.js";
import { QUICK_CAST_MS, REACTION_WINDOW_MS, timerState } from "./timers.js";
import { buildTimeline, createStage, type StageState } from "./stage.js";
import { createSound, cueFor } from "./sound.js";
import {
    REACTION_COSTS,
    ROUND_FOCUS,
    beginNextRound,
    createInitialDuelState,
    resolveEncounter,
    spellFocusCost,
    type DuelState,
    type PlayerId,
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

// Local storage behind a memory fallback: private mode must never break play.
const memoryStorage = new Map<string, string>();
const deviceStorage = {
    getItem: (key: string): string | null => {
        try {
            return localStorage.getItem(key) ?? memoryStorage.get(key) ?? null;
        } catch {
            return memoryStorage.get(key) ?? null;
        }
    },
    setItem: (key: string, value: string): void => {
        memoryStorage.set(key, value);
        try {
            localStorage.setItem(key, value);
        } catch {
            // Private mode: the in-memory copy carries the page load.
        }
    }
};

const playerSeals = byId<HTMLElement>("player-seals");
const focusBudget = byId<HTMLElement>("focus-budget");
const playerResolve = byId<HTMLElement>("player-resolve");
const opponentResolve = byId<HTMLElement>("opponent-resolve");
const timerBox = byId<HTMLElement>("timer");
const timerText = byId<HTMLElement>("timer-text");
const timerFill = byId<HTMLElement>("timer-fill");
const settingsToggle = byId<HTMLButtonElement>("settings-toggle");
const settingsPanel = byId<HTMLElement>("settings");
const settingsRules = byId<HTMLElement>("settings-rules");
const settingsTimers = byId<HTMLInputElement>("settings-timers");
const settingsTimersNote = byId<HTMLElement>("settings-timers-note");
const settingsHelp = byId<HTMLInputElement>("settings-help");
const settingsAnimations = byId<HTMLInputElement>("settings-animations");
const settingsSound = byId<HTMLInputElement>("settings-sound");
const settingsTelemetry = byId<HTMLInputElement>("settings-telemetry");
const statsToggle = byId<HTMLButtonElement>("stats-toggle");
const statsPanel = byId<HTMLElement>("stats");
const statsLocal = byId<HTMLElement>("stats-local");
const statsGlobal = byId<HTMLElement>("stats-global");
const statsStreak = byId<HTMLElement>("stats-streak");
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

// Settings (ruleset, timers, telemetry) and per-device stats.
let settings: Settings = loadSettings(deviceStorage, new URLSearchParams(location.search));
let ruleset: Ruleset = rulesets[settings.ruleset];
let stats: Stats = loadStats(deviceStorage);
// The stage and its sound. Reduced motion follows the system setting or
// the Animations switch; sound stays silent until the first tap unlocks it.
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const sound = createSound(settings.sound);
const stageRoot = byId<SVGSVGElement & HTMLElement>("stage");
const stage = createStage(
    stageRoot,
    {
        onBeat: beat => {
            stageRoot.dataset.lastBeat = beat.kind;
            const cue = cueFor(beat);
            if (cue) sound.play(cue);
        }
    },
    { reduced: () => !settings.animations || reducedMotionQuery.matches }
);
let gateClosedThisRound = false;
function stageState(): StageState {
    return {
        wards: { player: state.players.player.ward, opponent: state.players.opponent.ward },
        bound: { player: state.players.player.bound === true, opponent: state.players.opponent.bound === true },
        gateClosed: gateClosedThisRound
    };
}
document.addEventListener("pointerdown", () => sound.unlock(), { passive: true });
stageRoot.addEventListener("click", () => {
    // A tap skips the current animation: an empty run supersedes it.
    if (stageRoot.dataset.playing === "1") void stage.play([], stageState());
});

glyphHelpDetails.open = settings.glyphHelpOpen;
glyphHelpDetails.addEventListener("toggle", () => {
    if (settings.glyphHelpOpen !== glyphHelpDetails.open) {
        settings = { ...settings, glyphHelpOpen: glyphHelpDetails.open };
        saveSettings(deviceStorage, settings);
    }
});

let state: DuelState = createInitialDuelState(ruleset.rules);
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

/** How many extra telegraph glyphs `id` leaks: one for exposed (0 Focus), one for faltering (low Resolve). */
function leak(id: PlayerId): number {
    const p = state.players[id];
    return (p.exposed ? 1 : 0) + (p.faltering ? 1 : 0);
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
            telegraph: projectTelegraph(scenario.opponentSpell, scenario.telegraph, rng, { extraReveals: leak("opponent") }),
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
        telegraph: projectTelegraph(spell, "high", rng, { extraReveals: leak("opponent") }),
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
const telemetry = createTelemetry({ endpoint: "./api/telemetry" });
const sessionId = getSessionId(deviceStorage);
/** Record only when the player allows telemetry (settings or ?telemetry=off). */
function track(event: Parameters<typeof telemetry.record>[0]): void {
    if (settings.telemetry) telemetry.record(event);
}
let roundStartedAt = performance.now();
/** Quick-cast flags captured at commit time (hot-seat keeps Player 2's from the compose phase). */
let playerQuickCast = false;
let p2QuickCast = false;
let reactionLocked = false;

/** Timers run for Pulse/Resolve when the player allows them, in bot rounds and hot-seat turns - never in the teaching deck. */
function timersActive(): boolean {
    if (!ruleset.timers || !settings.timers || roundResolved) return false;
    if (mode === "hotseat") return hotseat.phase === "p1-turn" || hotseat.phase === "p2-react" || hotseat.phase === "p2-compose";
    return !plan.scenario;
}

type MatchOutcome = { over: boolean; winner?: PlayerId; reason?: "seals" | "resolve" };
function matchOutcome(): MatchOutcome {
    const p = state.players.player;
    const o = state.players.opponent;
    if (p.seals >= 3) return { over: true, winner: "player", reason: "seals" };
    if (o.seals >= 3) return { over: true, winner: "opponent", reason: "seals" };
    if (state.rules.resolve > 0) {
        if ((o.resolve ?? 1) <= 0) return { over: true, winner: "player", reason: "resolve" };
        if ((p.resolve ?? 1) <= 0) return { over: true, winner: "opponent", reason: "resolve" };
    }
    return { over: false };
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void telemetry.flush();
});

function formatSpell(tokens: string[]): string {
    return tokens.length > 0 ? tokens.join(" → ") : "Choose glyphs";
}

function appendLesson(scenario: Scenario, roundStart: DuelState): void {
    const heading = document.createElement("li");
    heading.className = "lesson";
    heading.textContent = "Lesson — " + scenario.title + ": " + scenario.lesson;
    combatLog.append(heading);
    // The documented responses are re-resolved against this round's opening
    // state under the ruleset in force, so the lines never promise what
    // Teeth or Resolve would not do.
    for (const line of lessonOutcomes(scenario, roundStart, names())) {
        const li = document.createElement("li");
        li.className = "lesson-option";
        li.textContent = line.text;
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
        element.disabled = roundResolved || reactionLocked;
        const label = element.dataset.label ?? (element.dataset.label = element.textContent ?? "");
        const cost = value && state.rules.reactionCosts ? REACTION_COSTS[value] : 0;
        element.textContent = cost > 0 ? `${label} · ${cost}` : label;
    }
    const slots = mode === "hotseat" && hotseat.phase === "p2-react" ? p1Telegraph : plan.telegraph;
    const reactor: PlayerId = mode === "hotseat" && hotseat.phase === "p2-react" ? "opponent" : "player";
    const focusLeft = state.rules.reactionCosts
        ? reactor === "opponent"
            ? state.players.opponent.focus - spellFocusCost(state, "opponent", parseSpell(plan.opponentSpell).focusCost)
            : state.players.player.focus
        : undefined;
    reactionExplain.textContent =
        roundResolved || slots.length === 0 ? "" : explainReaction(selectedReaction, slots, state.rules, focusLeft);
}

/** Whose Focus pays for the spell being composed. */
function composerId(): PlayerId {
    return mode === "hotseat" && hotseat.phase === "p2-compose" ? "opponent" : "player";
}

/** Focus the composing player has left after the reaction they selected (their spell must fit in it). */
function composeBudget(): { budget: number; spellCost: number; reactionCost: number } {
    const parsed = parseSpell(playerSpell);
    if (!state.rules.reactionCosts) return { budget: ROUND_FOCUS, spellCost: parsed.focusCost, reactionCost: 0 };
    const id = composerId();
    // Player 2's reaction is chosen later (p2-react) and paid after their spell.
    const reactionCost = id === "player" && selectedReaction ? REACTION_COSTS[selectedReaction] : 0;
    return { budget: state.players[id].focus - reactionCost, spellCost: spellFocusCost(state, id, parsed.focusCost), reactionCost };
}

function spellIsCastable(): boolean {
    const parsed = parseSpell(playerSpell);
    const { budget, spellCost } = composeBudget();
    return parsed.status === "valid" && playerSpell.length >= 2 && playerSpell.length <= 4 && spellCost <= budget;
}

function renderValidation(): void {
    const parsed = parseSpell(playerSpell);
    const { budget, spellCost, reactionCost } = composeBudget();
    const valid = spellIsCastable();

    focusCost.textContent = String(spellCost);
    focusBudget.textContent = String(Math.max(0, budget));
    spellPreview.textContent = formatSpell(playerSpell);
    diagnostic.classList.toggle("valid", valid);

    if (playerSpell.length < 2) {
        diagnostic.textContent = "Build a 2–4 glyph spell.";
    } else if (parsed.status !== "valid") {
        diagnostic.textContent = parsed.diagnostics[0]?.message ?? "Unstable syntax.";
    } else if (spellCost > budget) {
        diagnostic.textContent = state.rules.reactionCosts
            ? `Not enough Focus: spell ${spellCost}${reactionCost ? ` + ${selectedReaction?.toUpperCase()} ${reactionCost}` : ""} exceeds the ${state.players[composerId()].focus} you have.`
            : "Too much Focus. Maximum is 7.";
    } else {
        diagnostic.textContent = "Stable syntax • Focus " + spellCost + (reactionCost ? ` + ${reactionCost} for ${selectedReaction?.toUpperCase()}` : "");
    }

    resolveRoundButton.disabled = !valid || roundResolved;

    const composing = !roundResolved && (mode === "solo" || hotseat.phase === "p2-compose" || hotseat.phase === "p1-turn");
    const explanation = composing
        ? explainSpell(playerSpell, state, names(), composerId())
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

function renderResolve(element: HTMLElement, id: PlayerId): void {
    const value = state.players[id].resolve;
    element.classList.toggle("hidden", state.rules.resolve === 0 || value === undefined);
    if (value === undefined) return;
    const fill = element.querySelector<HTMLElement>(".resolve-fill");
    const text = element.querySelector<HTMLElement>(".resolve-text");
    if (fill) fill.style.width = `${Math.round((value / state.rules.resolve) * 100)}%`;
    if (text) text.textContent = `Resolve ${value}${state.players[id].faltering ? " · faltering" : ""}`;
}

function renderScoreboard(): void {
    playerSeals.textContent = String(state.players.player.seals);
    opponentSeals.textContent = String(state.players.opponent.seals);
    roundNumber.textContent = String(state.round);
    renderResolve(playerResolve, "player");
    renderResolve(opponentResolve, "opponent");
    const outcome = matchOutcome();
    const rulesNote = ` · ${ruleset.title}`;
    if (mode === "hotseat") {
        const shown = presentation(hotseat.phase);
        telegraph.textContent =
            shown.telegraphOf === "p2"
                ? formatTelegraph(plan.telegraph)
                : shown.telegraphOf === "p1"
                    ? formatTelegraph(p1Telegraph)
                    : "—";
        scenarioNote.textContent = "Hot-seat · two players on this phone · seed " + matchSeedLabel + rulesNote;
        matchStatus.textContent = outcome.over
            ? `${outcome.winner === "player" ? "Player 1" : "Player 2"} wins the duel${outcome.reason === "resolve" ? " on Resolve" : ""}`
            : shown.status;
        return;
    }

    telegraph.textContent = formatTelegraph(plan.telegraph);
    scenarioNote.textContent = (plan.scenario
        ? "Scenario " + state.round + "/" + scenarios.length + " · " + plan.scenario.title + " · seed " + matchSeedLabel
        : "Heuristic opponent · seed " + matchSeedLabel + " · some glyphs are hidden; infer the threat before reacting.") + rulesNote;

    matchStatus.textContent = outcome.over
        ? outcome.winner === "player"
            ? "You win the duel"
            : "Opponent wins"
        : roundResolved
            ? "Round resolved"
            : "Your move";
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
            return ward ? `${id}: ${ward.essence ?? "untyped"}${ward.integrity !== undefined ? ` (integrity ${ward.integrity})` : ""}` : `${id}: none`;
        })
        .join(" · ");
    const facts: Array<[string, string]> = [
        ["Rules", `${ruleset.title} (${ruleset.id})`],
        ["Seed", matchSeedLabel],
        ["Round", `${state.round} · ${roundResolved ? "resolved" : "awaiting your cast"}`],
        ["Scenario", plan.scenario ? `${plan.scenario.id} (telegraph ${plan.scenario.telegraph})` : "heuristic bot (telegraph high)"],
        ["Mode", mode === "solo" ? "solo" : `hot-seat · ${hotseat.phase}`],
        ["Hidden spell", plan.opponentSpell.join(" ") || "(not cast yet)"],
        ["Opponent reacts", plan.reactionPolicy],
        ["Wards", wards],
        ["Focus", `player ${state.players.player.focus} · opponent ${state.players.opponent.focus}` + (state.players.player.exposed || state.players.opponent.exposed ? " · exposed" : "")],
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
    const matchOver = matchOutcome().over;
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
    renderTimer();
    renderAdmin();
    if (stageRoot.dataset.playing !== "1") stage.setIdle(stageState());

    nextRoundButton.classList.toggle("hidden", !roundResolved || matchOutcome().over);
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
    if (!spellIsCastable()) {
        return;
    }

    combatLog.replaceChildren();
    const committedAt = performance.now();
    const roundStart = state;
    const sealsBefore = { player: state.players.player.seals, opponent: state.players.opponent.seals };

    const opponentSpell = plan.opponentSpell;
    const incoming = resolveEncounter(state, {
        casterId: "opponent",
        defenderId: "player",
        spellTokens: opponentSpell,
        ...(selectedReaction ? { reaction: selectedReaction } : {}),
        ...(mode === "hotseat" && p2QuickCast ? { quickCast: true } : {})
    });

    state = incoming.state;
    appendSteps(
        "Opponent: " + formatSpell(opponentSpell) + (selectedReaction ? " • you used " + selectedReaction.toUpperCase() : ""),
        incoming.steps
    );

    let botReaction: ReactionGlyph | undefined;
    let outgoing: ResolutionResult | undefined;
    if (!matchOutcome().over) {
        botReaction = plan.reaction(playerSpell);
        outgoing = resolveEncounter(state, {
            casterId: "player",
            defenderId: "opponent",
            spellTokens: playerSpell,
            ...(botReaction ? { reaction: botReaction } : {}),
            ...(playerQuickCast ? { quickCast: true } : {})
        });

        state = outgoing.state;
        appendSteps(
            "You: " + formatSpell(playerSpell) +
                (botReaction ? " • opponent used " + botReaction.toUpperCase() : "") +
                (playerQuickCast ? " • quick cast" : ""),
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
    const outcome = matchOutcome();
    if (outcome.over) {
        const li = document.createElement("li");
        li.className = "verdict";
        li.textContent =
            explainMatch(state, history, who) +
            (outcome.reason === "resolve" ? ` ${outcome.winner === "player" ? who.them : who.you}'s Resolve is spent.` : "");
        combatLog.prepend(li);
    }

    if (plan.scenario) {
        appendLesson(plan.scenario, roundStart);
    }
    roundResolved = true;
    log.info(`round ${state.round} resolved`, {
        rules: ruleset.id,
        you: playerSpell.join(" ") + (selectedReaction ? ` (reacted ${selectedReaction})` : "") + (playerQuickCast ? " quick" : ""),
        opponent: opponentSpell.join(" ") + (botReaction ? ` (reacted ${botReaction})` : ""),
        seals: `${state.players.player.seals}-${state.players.opponent.seals}`,
        commitMs: Math.round(committedAt - roundStartedAt)
    });

    const timeToCommitMs = Math.max(0, Math.round(committedAt - roundStartedAt));
    stats = recordRound(stats, {
        ruleset: ruleset.id,
        mode,
        playerGained: Math.max(0, state.players.player.seals - sealsBefore.player),
        opponentGained: Math.max(0, state.players.opponent.seals - sealsBefore.opponent),
        playerReaction: selectedReaction,
        timeToCommitMs
    });
    if (outcome.over) {
        stats = recordMatchEnd(stats, { ruleset: ruleset.id, mode, won: outcome.winner === "player", reason: outcome.reason ?? "seals" });
    }
    saveStats(deviceStorage, stats);

    track(
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
            mode,
            rules: ruleset.id
        })
    );
    if (outcome.over) {
        track({
            event: "match_end",
            mode,
            rules: ruleset.id,
            endReason: outcome.reason ?? "seals",
            sessionId,
            matchSeed: matchSeedLabel,
            webVersion: WEB_VERSION,
            round: state.round,
            playerSeals: state.players.player.seals,
            opponentSeals: state.players.opponent.seals
        });
    }
    void telemetry.flush();
    playerQuickCast = false;
    p2QuickCast = false;
    gateClosedThisRound =
        incoming.steps.some(s => s.code === "GATE_CLOSED") || (outgoing?.steps.some(s => s.code === "GATE_CLOSED") ?? false);
    render();

    // The stage replays the round from the resolver's steps; the log above
    // is already complete, so a tap can skip it without losing anything.
    void (async () => {
        stageRoot.dataset.playing = "1";
        stage.setIdle({
            wards: { player: roundStart.players.player.ward, opponent: roundStart.players.opponent.ward },
            bound: { player: roundStart.players.player.bound === true, opponent: roundStart.players.opponent.bound === true },
            gateClosed: false
        });
        await stage.play(
            buildTimeline(
                { result: incoming, casterId: "opponent", defenderId: "player", spell: opponentSpell, reaction: selectedReaction },
                outgoing ? { result: outgoing, casterId: "player", defenderId: "opponent", spell: playerSpell, reaction: botReaction } : undefined
            ),
            stageState()
        );
        delete stageRoot.dataset.playing;
        stage.setIdle(stageState());
    })();
}

function startNextRound(): void {
    if (!roundResolved) {
        return;
    }

    state = beginNextRound(state);
    gateClosedThisRound = false;
    playerSpell = [];
    selectedReaction = undefined;
    roundResolved = false;
    reactionLocked = false;
    plan = planRound();
    roundStartedAt = performance.now();
    combatLog.innerHTML = "<li>Opponent spell is waiting.</li>";
    render();
}

function resetMatch(): void {
    // A reset after at least one resolved round is a rematch signal - the
    // plan's cheapest proxy for "did they want to play again".
    if (roundResolved || state.round > 1) {
        track({
            event: "rematch",
            mode,
            rules: ruleset.id,
            sessionId,
            matchSeed: matchSeedLabel,
            webVersion: WEB_VERSION,
            round: state.round,
            playerSeals: state.players.player.seals,
            opponentSeals: state.players.opponent.seals
        });
        void telemetry.flush();
        stats = recordRematch(stats, { ruleset: ruleset.id, mode });
        saveStats(deviceStorage, stats);
    }
    state = createInitialDuelState(ruleset.rules);
    gateClosedThisRound = false;
    history = [];
    playerSpell = [];
    selectedReaction = undefined;
    roundResolved = false;
    reactionLocked = false;
    playerQuickCast = false;
    p2QuickCast = false;
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
    if (reactionLocked) return;
    selectedReaction = (target.dataset.reaction || undefined) as ReactionGlyph | undefined;
    // The reaction shares the Focus budget with the spell, so the composer
    // must re-validate too.
    render();
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

function onPrimaryAction(): void {
    if (mode === "solo") {
        playerQuickCast = timerState(performance.now() - roundStartedAt, timersActive()).quickCast;
        resolveRound();
        return;
    }
    switch (hotseat.phase) {
        case "p2-compose": {
            if (!spellIsCastable()) return;
            p2QuickCast = timerState(performance.now() - roundStartedAt, timersActive()).quickCast;
            hotseat = lockP2Spell(hotseat, playerSpell);
            plan = {
                ...plan,
                opponentSpell: [...playerSpell],
                telegraph: projectTelegraph(playerSpell, "high", rng, { extraReveals: leak("opponent") })
            };
            log.info(`round ${state.round}: player 2 locked in`, { glyphs: playerSpell.length });
            playerSpell = [];
            selectedReaction = undefined;
            break;
        }
        case "p1-turn": {
            if (!spellIsCastable()) return;
            playerQuickCast = timerState(performance.now() - roundStartedAt, timersActive()).quickCast;
            hotseat = commitP1(hotseat, playerSpell, selectedReaction);
            p1Telegraph = projectTelegraph(playerSpell, "high", rng, { extraReveals: leak("player") });
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
        // Each player's clock starts when they take the phone.
        roundStartedAt = performance.now();
        reactionLocked = false;
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

// --- Tempo (Pulse / Resolve): reaction ring and quick-cast badge.
function renderTimer(): void {
    const active = timersActive();
    timerBox.classList.toggle("hidden", !active);
    if (!active) {
        resolveRoundButton.classList.remove("quick");
        return;
    }
    const t = timerState(performance.now() - roundStartedAt, true);
    if (t.reactionLocked && !reactionLocked) {
        reactionLocked = true;
        log.info(`round ${state.round}: reaction window closed`, { reaction: selectedReaction ?? "none" });
        renderReactionButtons();
    }
    const showsReactions = mode === "solo" || hotseat.phase === "p1-turn" || hotseat.phase === "p2-react";
    timerText.textContent = showsReactions
        ? t.reactionLocked
            ? "Reaction locked in"
            : `React within ${(t.reactionRemainingMs / 1000).toFixed(1)} s`
        : t.quickCast
            ? `Quick cast for ${(t.quickRemainingMs / 1000).toFixed(1)} s`
            : "Compose";
    timerFill.style.width = `${Math.round(((showsReactions ? t.reactionRemainingMs : t.quickRemainingMs) / (showsReactions ? REACTION_WINDOW_MS : QUICK_CAST_MS)) * 100)}%`;
    const canQuick = hotseat.phase !== "p2-react";
    resolveRoundButton.classList.toggle("quick", canQuick && t.quickCast);
}
window.setInterval(() => {
    if (timersActive()) renderTimer();
}, 100);

// --- Settings panel: ruleset, timers, telemetry.
function renderSettings(): void {
    settingsRules.replaceChildren(
        ...(Object.values(rulesets) as Ruleset[]).map(option => {
            const label = document.createElement("label");
            label.className = "settings-option" + (option.id === settings.ruleset ? " selected" : "");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "ruleset";
            input.value = option.id;
            input.checked = option.id === settings.ruleset;
            input.addEventListener("change", () => applyRuleset(option.id));
            const title = document.createElement("strong");
            title.textContent = option.title;
            const changes = document.createElement("ul");
            for (const change of option.changes) {
                const li = document.createElement("li");
                li.textContent = change;
                changes.append(li);
            }
            label.append(input, title, changes);
            return label;
        })
    );
    settingsTimers.checked = settings.timers;
    // Tempo only exists in Pulse and Resolve; say so instead of offering a switch that does nothing.
    settingsTimers.disabled = !ruleset.timers;
    settingsTimers.closest("label")?.classList.toggle("disabled", !ruleset.timers);
    settingsTimersNote.textContent = ruleset.timers
        ? "8-second reaction window and 5-second quick cast, against the bot after the teaching deck and in hot-seat turns."
        : `${ruleset.title} has no timers. Pick Pulse or Resolve to use them.`;
    settingsTelemetry.checked = settings.telemetry;
    settingsHelp.checked = settings.glyphHelpOpen;
    settingsAnimations.checked = settings.animations;
    settingsSound.checked = settings.sound;
}

function applyRuleset(id: RulesetId): void {
    if (id === settings.ruleset) return;
    settings = { ...settings, ruleset: id };
    saveSettings(deviceStorage, settings);
    ruleset = rulesets[id];
    log.info(`ruleset: ${id}`);
    resetMatch();
    renderSettings();
}

settingsToggle.addEventListener("click", () => {
    const open = settingsPanel.classList.contains("hidden");
    settingsPanel.classList.toggle("hidden", !open);
    if (open) {
        renderSettings();
        settingsPanel.scrollIntoView({ block: "start", behavior: "smooth" });
    }
});
byId<HTMLButtonElement>("settings-close").addEventListener("click", () => settingsPanel.classList.add("hidden"));
settingsTimers.addEventListener("change", () => {
    settings = { ...settings, timers: settingsTimers.checked };
    saveSettings(deviceStorage, settings);
    log.info(`timers: ${settings.timers ? "on" : "off"}`);
    render();
});
settingsTelemetry.addEventListener("change", () => {
    settings = { ...settings, telemetry: settingsTelemetry.checked };
    saveSettings(deviceStorage, settings);
    log.info(`telemetry: ${settings.telemetry ? "on" : "off"}`);
});
settingsAnimations.addEventListener("change", () => {
    settings = { ...settings, animations: settingsAnimations.checked };
    saveSettings(deviceStorage, settings);
    log.info(`animations: ${settings.animations ? "on" : "off"}`);
});
settingsSound.addEventListener("change", () => {
    settings = { ...settings, sound: settingsSound.checked };
    saveSettings(deviceStorage, settings);
    sound.setEnabled(settings.sound);
    if (settings.sound) sound.unlock();
    log.info(`sound: ${settings.sound ? "on" : "off"}`);
});
settingsHelp.addEventListener("change", () => {
    settings = { ...settings, glyphHelpOpen: settingsHelp.checked };
    saveSettings(deviceStorage, settings);
    glyphHelpDetails.open = settings.glyphHelpOpen;
});

// --- Stats panel: this device (local storage) and everyone (worker summary).
function cell(text: string, header = false): HTMLElement {
    const td = document.createElement(header ? "th" : "td");
    td.textContent = text;
    return td;
}

function table(headers: string[], rows: string[][]): HTMLTableElement {
    const t = document.createElement("table");
    t.className = "stats-table";
    const head = document.createElement("tr");
    head.append(...headers.map(h => cell(h, true)));
    t.append(head);
    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.append(...row.map(v => cell(v)));
        t.append(tr);
    }
    return t;
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const secs = (ms: number | null | undefined): string => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);

function renderLocalStats(): void {
    const rows = summarize(stats);
    statsStreak.textContent = `Streak ${stats.streak > 0 ? "+" : ""}${stats.streak} · best ${stats.bestStreak} · hot-seat rounds ${stats.modes.hotseat.rounds}`;
    statsLocal.replaceChildren(
        table(
            ["Rules", "Matches", "Won", "Rounds", "Seal rate", "Avg commit", "Top reaction", "Rematches"],
            rows.map(r => [
                rulesets[r.ruleset].title + (r.endedBy["resolve"] ? ` (${r.endedBy["resolve"]} on Resolve)` : ""),
                String(r.matches),
                r.matches ? pct(r.winRate) : "—",
                String(r.rounds),
                r.rounds ? pct(r.sealRate) : "—",
                secs(r.avgCommitMs),
                r.topReaction,
                String(r.rematches)
            ])
        )
    );
}

type GlobalSummary = {
    rounds: number;
    rematches: number;
    sessions: number;
    rulesets: Array<{ rules: string; mode: string; rounds: number; matches: number; endedByResolve: number; rematches: number; sessions: number; playerSealRate: number; medianTimeToCommitMs: number | null }>;
    scenarios: Array<{ scenarioId: string | null; rounds: number; reactions: Record<string, number>; playerSealRate: number; medianTimeToCommitMs: number | null }>;
};

async function renderGlobalStats(): Promise<void> {
    statsGlobal.textContent = "Loading everyone's numbers…";
    try {
        const response = await fetch("./api/telemetry/summary", { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(String(response.status));
        const summary = (await response.json()) as GlobalSummary;
        const totals = document.createElement("p");
        totals.className = "muted";
        totals.textContent = `${summary.sessions} devices · ${summary.rounds} rounds · ${summary.rematches} rematches`;
        // Older workers (before 0003) answer without the per-ruleset block.
        const byRules = table(
            ["Rules", "Mode", "Rounds", "Matches", "On Resolve", "Seal rate", "Median commit", "Devices"],
            (summary.rulesets ?? []).map(r => [
                rulesets[r.rules as RulesetId]?.title ?? r.rules,
                r.mode,
                String(r.rounds),
                String(r.matches),
                String(r.endedByResolve),
                r.rounds ? pct(r.playerSealRate) : "—",
                secs(r.medianTimeToCommitMs),
                String(r.sessions)
            ])
        );
        const byScenario = table(
            ["Scenario", "Rounds", "Reactions", "Seal rate", "Median commit"],
            (summary.scenarios ?? []).map(s => [
                s.scenarioId ?? "bot / hot-seat",
                String(s.rounds),
                Object.entries(s.reactions)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `${k} ${v}`)
                    .join(", "),
                pct(s.playerSealRate),
                secs(s.medianTimeToCommitMs)
            ])
        );
        statsGlobal.replaceChildren(totals, byRules, byScenario);
    } catch (error) {
        statsGlobal.textContent = "Everyone's numbers are unavailable right now (offline?).";
        log.warn("telemetry summary unavailable", String(error));
    }
}

statsToggle.addEventListener("click", () => {
    const open = statsPanel.classList.contains("hidden");
    statsPanel.classList.toggle("hidden", !open);
    if (open) {
        renderLocalStats();
        void renderGlobalStats();
        statsPanel.scrollIntoView({ block: "start", behavior: "smooth" });
    }
});
byId<HTMLButtonElement>("stats-close").addEventListener("click", () => statsPanel.classList.add("hidden"));

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
