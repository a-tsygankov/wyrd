import { scenarios, type Scenario, type ScenarioOutcome } from "../../../packages/wyrd-content/src/scenarios.js";
import { parseSpell } from "../../../packages/wyrd-grammar/src/parser.js";
import {
    chooseBotReaction,
    chooseBotSpell,
    createRng,
    enumerateLegalSpells,
    formatTelegraph,
    projectTelegraph,
    seedFromString,
    type Rng,
    type TelegraphSlot
} from "../../../packages/wyrd-simulation/src/index.js";
import { installHint } from "./install.js";
import {
    createInitialDuelState,
    resolveEncounter,
    type DuelState,
    type ReactionGlyph,
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
};

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
        return {
            scenario,
            opponentSpell: scenario.opponentSpell,
            telegraph: projectTelegraph(scenario.opponentSpell, scenario.telegraph, rng),
            reaction: spell =>
                fixed === "bot" ? chooseBotReaction(spell, botView(), rng) : fixed === "none" ? undefined : fixed
        };
    }
    const spell = chooseBotSpell(spellPool, botView(), rng);
    return {
        opponentSpell: spell,
        telegraph: projectTelegraph(spell, "high", rng),
        reaction: playerCast => chooseBotReaction(playerCast, botView(), rng)
    };
}

newMatchSeed();
plan = planRound();

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
}

function renderScoreboard(): void {
    playerSeals.textContent = String(state.players.player.seals);
    opponentSeals.textContent = String(state.players.opponent.seals);
    roundNumber.textContent = String(state.round);
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

function render(): void {
    renderScoreboard();
    renderGlyphTray();
    renderReactionButtons();
    renderValidation();

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

    if (state.players.opponent.seals < 3 && state.players.player.seals < 3) {
        const botReaction = plan.reaction(playerSpell);
        const outgoing = resolveEncounter(state, {
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
    if (plan.scenario) {
        appendLesson(plan.scenario);
    }
    roundResolved = true;
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
    combatLog.innerHTML = "<li>Opponent spell is waiting.</li>";
    render();
}

function resetMatch(): void {
    state = createInitialDuelState();
    playerSpell = [];
    selectedReaction = undefined;
    roundResolved = false;
    // A seeded URL replays the same match; otherwise every reset is a new one.
    newMatchSeed();
    plan = planRound();
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

resolveRoundButton.addEventListener("click", resolveRound);
nextRoundButton.addEventListener("click", startNextRound);
resetButton.addEventListener("click", resetMatch);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        void navigator.serviceWorker.register("./sw.js");
    });
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
        })
        .catch(() => undefined);
}

render();
