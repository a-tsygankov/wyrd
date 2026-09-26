import type { Initiative, PlayerId } from "../../../packages/wyrd-resolver/src/index.js";

/**
 * The commit ritual (docs/duel-ux-ideas.md §B): both spells go face-down
 * under a wax seal, the seals crack, and the spells reveal in initiative
 * order with a gold rim on the first mover - so "why did theirs land
 * before mine" is shown before the replay answers it. Pure copy and
 * timings here; playRitual owns the DOM. Skipped under reduced motion.
 */
export type RitualStep = { kind: "seal" | "crack" | "reveal"; ms: number };

const STEPS: readonly RitualStep[] = [
    { kind: "seal", ms: 520 },
    { kind: "crack", ms: 380 },
    { kind: "reveal", ms: 700 }
];
export const RITUAL_MS = STEPS.reduce((sum, s) => sum + s.ms, 0);

export function ritualSteps(reduced: boolean): readonly RitualStep[] {
    return reduced ? [] : STEPS;
}

export type Names = { you: string; them: string };

export type RitualCopy = {
    headline: string;
    /** "Your SEEK ENEMY resolves first" */
    first: string;
    /** "the cheaper spell (2 Focus against 3)" */
    why: string;
    cards: Record<PlayerId, { name: string; spell: string }>;
};

function possessive(name: string): string {
    return name.toLowerCase() === "you" ? "your" : `${name}'s`;
}

export function ritualCopy(
    initiative: Initiative,
    spells: Record<PlayerId, readonly string[]>,
    names: Names,
    costs: Record<PlayerId, number>
): RitualCopy {
    const other: PlayerId = initiative.first === "player" ? "opponent" : "player";
    const firstName = initiative.first === "player" ? names.you : names.them;
    const spell = spells[initiative.first].join(" ");
    const why =
        initiative.reason === "quick"
            ? "the quick cast"
            : initiative.reason === "focus"
                ? `the cheaper spell (${costs[initiative.first]} Focus against ${costs[other]})`
                : initiative.reason === "seals"
                    ? "the mage behind on seals goes first"
                    : `${firstName} ${firstName.toLowerCase() === "you" ? "have" : "has"} the seat this ${initiative.first === "player" ? "odd" : "even"} round`;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return {
        headline: "Seals crack",
        first: cap(`${possessive(firstName)} ${spell} resolves first`),
        why,
        cards: {
            player: { name: cap(names.you), spell: spells.player.join(" ") },
            opponent: { name: cap(names.them), spell: spells.opponent.join(" ") }
        }
    };
}

export type RitualHandle = { done: Promise<void>; skip(): void };

/** Play the ritual in `container` (an overlay inside the stage card). Resolves when it ends or is skipped. */
export function playRitual(container: HTMLElement, copy: RitualCopy, options: { reduced: boolean; first: PlayerId }): RitualHandle {
    const steps = ritualSteps(options.reduced);
    let skipped = false;
    let wake: (() => void) | undefined;
    const skip = (): void => {
        skipped = true;
        wake?.();
    };
    if (steps.length === 0) {
        container.classList.add("hidden");
        return { done: Promise.resolve(), skip };
    }

    container.replaceChildren();
    container.classList.remove("hidden");
    const headline = document.createElement("p");
    headline.className = "ritual-headline";
    headline.textContent = copy.headline;
    const row = document.createElement("div");
    row.className = "ritual-row";
    const cards: Record<PlayerId, HTMLElement> = { player: document.createElement("div"), opponent: document.createElement("div") };
    for (const side of ["player", "opponent"] as const) {
        const card = cards[side];
        card.className = "ritual-card";
        card.dataset.side = side;
        const name = document.createElement("span");
        name.className = "ritual-name";
        name.textContent = copy.cards[side].name;
        const seal = document.createElement("span");
        seal.className = "ritual-seal";
        seal.setAttribute("aria-hidden", "true");
        const spell = document.createElement("span");
        spell.className = "ritual-spell";
        spell.textContent = copy.cards[side].spell;
        card.append(name, seal, spell);
        row.append(card);
    }
    const verdict = document.createElement("p");
    verdict.className = "ritual-first";
    verdict.textContent = `${copy.first}: ${copy.why}.`;
    container.append(headline, row, verdict);

    const wait = (ms: number): Promise<void> =>
        new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            wake = () => {
                clearTimeout(timer);
                resolve();
            };
        });

    const done = (async () => {
        for (const step of steps) {
            if (skipped) break;
            container.dataset.step = step.kind;
            if (step.kind === "seal") for (const card of Object.values(cards)) card.classList.add("sealed");
            if (step.kind === "crack") for (const card of Object.values(cards)) card.classList.add("cracked");
            if (step.kind === "reveal") {
                for (const card of Object.values(cards)) card.classList.add("revealed");
                cards[options.first].classList.add("first");
            }
            await wait(step.ms);
        }
        container.classList.add("hidden");
        delete container.dataset.step;
    })();
    return { done, skip };
}
