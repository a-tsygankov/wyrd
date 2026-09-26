import { parseSpell } from "../../../packages/wyrd-grammar/src/parser.js";
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

const opponentSpells: string[][] = [
    ["FIRE", "SEEK", "ENEMY", "AMPLIFY"],
    ["SHADOW", "SEEK", "ENEMY"],
    ["ENEMY", "BIND"],
    ["GATE", "CLOSE", "ANCHOR"]
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

let state: DuelState = createInitialDuelState();
let playerSpell: string[] = [];
let selectedReaction: ReactionGlyph | undefined;
let roundResolved = false;

function currentOpponentSpell(): string[] {
    return opponentSpells[(state.round - 1) % opponentSpells.length]!;
}

function formatSpell(tokens: string[]): string {
    return tokens.length > 0 ? tokens.join(" → ") : "Choose glyphs";
}

function telegraphSpell(tokens: string[]): string {
    return tokens
        .map(token =>
            ["FIRE", "SHADOW", "SEEK", "BIND", "WARD", "CLOSE"].includes(token)
                ? token
                : "?"
        )
        .join(" → ");
}

function chooseBotReaction(tokens: string[]): ReactionGlyph | undefined {
    if (tokens.includes("AMPLIFY")) {
        return "silence";
    }
    if (tokens.includes("ENEMY") && !tokens.includes("ANCHOR") && state.round % 2 === 0) {
        return "reflect";
    }
    if (state.round % 3 === 0) {
        return "null";
    }
    return undefined;
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
    telegraph.textContent = telegraphSpell(currentOpponentSpell());

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

    const opponentSpell = currentOpponentSpell();
    const incoming = resolveEncounter(state, {
        casterId: "opponent",
        defenderId: "player",
        spellTokens: opponentSpell,
        ...(selectedReaction ? { reaction: selectedReaction } : {})
    });

    state = incoming.state;
    appendSteps("Opponent: " + formatSpell(opponentSpell), incoming.steps);

    if (state.players.opponent.seals < 3 && state.players.player.seals < 3) {
        const botReaction = chooseBotReaction(playerSpell);
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
    combatLog.innerHTML = "<li>Opponent spell is waiting.</li>";
    render();
}

function resetMatch(): void {
    state = createInitialDuelState();
    playerSpell = [];
    selectedReaction = undefined;
    roundResolved = false;
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

render();
