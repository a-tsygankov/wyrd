import { glyphs } from "../../../packages/wyrd-content/src/glyphs.js";
import type { ParseResult } from "../../../packages/wyrd-grammar/src/types.js";
import type { TelegraphSlot } from "../../../packages/wyrd-simulation/src/telegraph.js";

/**
 * Rune cards (docs/duel-ux-ideas.md A and G): the telegraph as a strip of
 * face-up, family-edged and face-down cards, and the composer's spell as a
 * sentence of cards that lights up when it parses, with the glyph at fault
 * left dark and modifiers drawn as marks on the action. The models here are
 * pure; the render functions build DOM from them.
 */
export type CardFamily = "essence" | "target" | "action" | "modifier" | "reaction" | "timing" | "logic";

/** Every registry glyph's card family (the tray's grouping, plus the reactions). */
export const FAMILY_OF: Record<string, CardFamily> = Object.fromEntries(
    glyphs.map(g => {
        const family: CardFamily =
            ["REFLECT", "SILENCE", "NULL", "SPELL"].includes(g.displayName)
                ? "reaction"
                : g.displayName === "GATE"
                    ? "target"
                    : g.displayName === "WARD"
                        ? "action"
                        : g.family === "boundary"
                            ? "target"
                            : (g.family as CardFamily);
        return [g.displayName, family];
    })
) as Record<string, CardFamily>;

// Small, consistent glyph marks: 24x24 strokes, currentColor.
const S = 'stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const ICONS: Record<string, string> = {
    "?": `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg>`,
    FIRE: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-5 1-8z"/></svg>`,
    WATER: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/></svg>`,
    SHADOW: `<svg viewBox="0 0 24 24" ${S}><path d="M14 4a8 8 0 1 0 6 13 7 7 0 0 1-6-13z"/></svg>`,
    FORCE: `<svg viewBox="0 0 24 24" ${S}><path d="M4 12h16M12 4l8 8-8 8"/></svg>`,
    LIFE: `<svg viewBox="0 0 24 24" ${S}><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l8-8"/></svg>`,
    SELF: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="7" r="3"/><path d="M6 20c0-4 3-6 6-6s6 2 6 6"/></svg>`,
    ENEMY: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="7" r="3"/><path d="M6 20c0-4 3-6 6-6s6 2 6 6M18 4l3 3M21 4l-3 3"/></svg>`,
    ALLY: `<svg viewBox="0 0 24 24" ${S}><circle cx="9" cy="7" r="3"/><circle cx="16" cy="9" r="2"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/></svg>`,
    AREA: `<svg viewBox="0 0 24 24" ${S}><ellipse cx="12" cy="14" rx="9" ry="4"/><circle cx="12" cy="7" r="2"/></svg>`,
    SPELL: `<svg viewBox="0 0 24 24" ${S}><path d="M5 19L19 5M14 5h5v5"/></svg>`,
    GATE: `<svg viewBox="0 0 24 24" ${S}><path d="M5 20V10a7 7 0 0 1 14 0v10M5 20h14"/></svg>`,
    SEEK: `<svg viewBox="0 0 24 24" ${S}><path d="M4 18L18 6M11 6h7v7"/></svg>`,
    BIND: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="9" width="8" height="6" rx="3"/><rect x="13" y="9" width="8" height="6" rx="3"/></svg>`,
    WARD: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/></svg>`,
    OPEN: `<svg viewBox="0 0 24 24" ${S}><path d="M5 20V10a7 7 0 0 1 14 0v10M12 20v-6"/></svg>`,
    CLOSE: `<svg viewBox="0 0 24 24" ${S}><path d="M5 20V10a7 7 0 0 1 14 0v10M5 20h14M8 20v-8h8v8"/></svg>`,
    BREAK: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l-2 6 4 2-3 6 1 4M12 3l3 5-2 3 4 4"/></svg>`,
    MEND: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l-2 6 4 2-3 6 1 4M7 9h4M13 11h4M9 17h4"/></svg>`,
    PUSH: `<svg viewBox="0 0 24 24" ${S}><path d="M4 12h12M11 7l5 5-5 5M19 6v12"/></svg>`,
    PULL: `<svg viewBox="0 0 24 24" ${S}><path d="M20 12H8M13 7l-5 5 5 5M5 6v12"/></svg>`,
    AMPLIFY: `<svg viewBox="0 0 24 24" ${S}><path d="M6 18L14 6M10 18l8-12"/></svg>`,
    WEAKEN: `<svg viewBox="0 0 24 24" ${S} stroke-width="1"><path d="M8 18l8-12"/></svg>`,
    SPLIT: `<svg viewBox="0 0 24 24" ${S}><path d="M12 20v-7M12 13l-6-7M12 13l6-7"/></svg>`,
    REFLECT: `<svg viewBox="0 0 24 24" ${S}><path d="M4 8h12l-3-3M20 16H8l3 3"/></svg>`,
    REVERSE: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3v18M6 8l6-4 6 4M6 16l6 4 6-4"/></svg>`,
    ANCHOR: `<svg viewBox="0 0 24 24" ${S}><path d="M12 4v16M8 20h8M12 8a3 3 0 1 0 0-.1M6 14c2 4 10 4 12 0"/></svg>`,
    SILENCE: `<svg viewBox="0 0 24 24" ${S}><path d="M4 12h8M12 6v12M16 8l4 8M20 8l-4 8"/></svg>`,
    NULL: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="7"/><path d="M7 7l10 10"/></svg>`,
    DELAY: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 3"/></svg>`,
    IF: `<svg viewBox="0 0 24 24" ${S}><path d="M12 4l8 8-8 8-8-8z"/></svg>`
};

export function iconFor(token: string): string {
    return ICONS[token] ?? ICONS["?"]!;
}

export type TelegraphCard =
    | { kind: "glyph"; token: string; family: CardFamily; label: string }
    | { kind: "family"; family: CardFamily; label: string }
    | { kind: "hidden"; family: undefined; label: "?" };

export function telegraphCards(slots: readonly TelegraphSlot[]): TelegraphCard[] {
    return slots.map(slot => {
        if (slot.kind === "glyph") return { kind: "glyph", token: slot.token, family: FAMILY_OF[slot.token] ?? "action", label: slot.token };
        if (slot.kind === "family") {
            const family: CardFamily = slot.family === "boundary" ? "target" : (slot.family as CardFamily);
            return { kind: "family", family, label: slot.family };
        }
        return { kind: "hidden", family: undefined, label: "?" };
    });
}

export type SpellCard = { token: string; family: CardFamily; marks: string[]; fault: boolean };

export type SpellSentence = {
    cards: SpellCard[];
    /** The sentence parses and the client says it can be cast now. */
    lit: boolean;
    diagnostic?: string;
};

/**
 * The sentence's cards: modifiers that follow the action ride on it as
 * marks; a modifier before any action stands alone. The parser's first
 * diagnostic names the glyph at fault (by id), which goes dark.
 */
export function spellCards(tokens: readonly string[], parsed: ParseResult, castable: boolean): SpellSentence {
    const faultId = parsed.status === "valid" ? undefined : parsed.diagnostics[0]?.glyphId;
    const cards: SpellCard[] = [];
    let action: SpellCard | undefined;
    for (const token of tokens) {
        const family = FAMILY_OF[token] ?? "action";
        const fault = faultId !== undefined && token.toLowerCase() === faultId;
        if (family === "modifier" && action && !fault) {
            action.marks.push(token);
            continue;
        }
        const card: SpellCard = { token, family, marks: [], fault };
        cards.push(card);
        if (family === "action") action = card;
    }
    // A fault the parser blames on a glyph that rode along as a mark: surface it on the action.
    if (faultId && !cards.some(c => c.fault)) {
        const carrier = cards.find(c => c.marks.some(m => m.toLowerCase() === faultId));
        if (carrier) carrier.fault = true;
    }
    return {
        cards,
        lit: parsed.status === "valid" && castable && tokens.length > 0,
        ...(parsed.status !== "valid" && tokens.length > 0 && parsed.diagnostics[0] ? { diagnostic: parsed.diagnostics[0].message } : {})
    };
}

// ------------------------------------------------------------------ DOM

export function renderTelegraphCards(container: HTMLElement, cards: readonly TelegraphCard[]): void {
    const previous = [...container.children] as HTMLElement[];
    container.replaceChildren(
        ...cards.map((card, index) => {
            const el = document.createElement("div");
            el.className = `rune-card ${card.kind === "hidden" ? "face-down" : card.kind}`;
            if (card.family) el.dataset.family = card.family;
            const was = previous[index];
            // A slot that just turned face-up flips.
            if (card.kind === "glyph" && was && !was.classList.contains("glyph")) el.classList.add("flip");
            const icon = document.createElement("span");
            icon.className = "rune-icon";
            icon.innerHTML = card.kind === "glyph" ? iconFor(card.token) : iconFor("?");
            const label = document.createElement("span");
            label.className = "rune-label";
            label.textContent = card.label;
            el.append(icon, label);
            return el;
        })
    );
}

export function renderSpellCards(container: HTMLElement, sentence: SpellSentence, onRemove: (index: number) => void): void {
    container.dataset.lit = sentence.lit ? "true" : "false";
    // Which position in the token list each card started at, so a tap removes the right glyph.
    let position = 0;
    container.replaceChildren(
        ...sentence.cards.map(card => {
            const start = position;
            position += 1 + card.marks.length;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "rune-card glyph spell" + (card.fault ? " fault" : "");
            button.dataset.family = card.family;
            button.dataset.token = card.token;
            button.title = `Remove ${card.token}`;
            button.addEventListener("click", () => onRemove(start));
            const icon = document.createElement("span");
            icon.className = "rune-icon";
            icon.innerHTML = iconFor(card.token);
            const label = document.createElement("span");
            label.className = "rune-label";
            label.textContent = card.token;
            button.append(icon, label);
            if (card.marks.length > 0) {
                const marks = document.createElement("span");
                marks.className = "rune-marks";
                for (const mark of card.marks) {
                    const m = document.createElement("span");
                    m.className = "rune-mark";
                    m.title = mark;
                    m.innerHTML = iconFor(mark);
                    marks.append(m);
                }
                button.append(marks);
            }
            return button;
        })
    );
}
