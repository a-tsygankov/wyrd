import { rulesetIds, type RulesetId } from "../../../packages/wyrd-content/src/rulesets.js";

/**
 * Player settings: which ruleset to play, whether timers run (accessibility
 * and the deck's teaching rounds), whether telemetry is sent. Persisted per
 * device; `?rules=`, `?timers=`, `?telemetry=` override for one visit so a
 * link can put a tester straight into a ruleset.
 */
export type Settings = {
    ruleset: RulesetId;
    timers: boolean;
    telemetry: boolean;
    /** Show glyph help expanded instead of behind the tap-to-expand row. */
    glyphHelpOpen: boolean;
    /** Play the stage animation for each resolution. */
    animations: boolean;
    /** Synthesised sound cues on stage beats. */
    sound: boolean;
    /** Render the duel in the Three.js arena instead of the SVG stage; on by default, `?stage=2d` opts out. */
    arena3d: boolean;
    /** Playtest options (docs/duel-engagement-options.md §H, ideas doc §J), off by default: weather every third round, sudden death at 2-2, press the round. */
    weather: boolean;
    suddenDeath: boolean;
    press: boolean;
    /**
     * Play the nine-scenario teaching deck at the start of a solo match. On
     * for a device's first match; the client turns it off when that match
     * ends, so every match after meets the heuristic opponent from round 1.
     * `?deck=on|off` pins it for a visit.
     */
    deck: boolean;
    /** The arena's full graphics pass (bloom, soft shadows, embers); off keeps the geometry and skips the post-processing. `?fx=light|full`. */
    arenaFx: boolean;
    /** Which game the page plays: the arcade Volley (default) or the word duel. `?game=arcade|word`. */
    game: Game;
    /** Which arcade game plays: Volley (default), Quickdraw, Beam clash, Gate tug or Ward rhythm. `?arcade=volley|quickdraw|beam|gatetug|wardrhythm`. */
    arcadeMode: ArcadeMode;
};

export type Game = "arcade" | "word";
export const GAMES: readonly Game[] = ["arcade", "word"];
export type ArcadeMode = "volley" | "quickdraw" | "beam" | "gatetug" | "wardrhythm";
export const ARCADE_MODES: readonly ArcadeMode[] = ["volley", "quickdraw", "beam", "gatetug", "wardrhythm"];

export const DEFAULT_SETTINGS: Settings = {
    ruleset: "classic",
    timers: true,
    telemetry: true,
    glyphHelpOpen: false,
    animations: true,
    sound: false,
    arena3d: true,
    weather: false,
    suddenDeath: false,
    press: false,
    deck: true,
    arenaFx: true,
    game: "arcade",
    arcadeMode: "volley"
};

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const KEY = "wyrd.settings";

function isRuleset(value: unknown): value is RulesetId {
    return typeof value === "string" && (rulesetIds as readonly string[]).includes(value);
}

function isGame(value: unknown): value is Game {
    return typeof value === "string" && (GAMES as readonly string[]).includes(value);
}

function isArcadeMode(value: unknown): value is ArcadeMode {
    return typeof value === "string" && (ARCADE_MODES as readonly string[]).includes(value);
}

function parseSwitch(value: string | null): boolean | undefined {
    if (value === "off" || value === "0" || value === "false") return false;
    if (value === "on" || value === "1" || value === "true") return true;
    return undefined;
}

export function loadSettings(storage: StorageLike, params: URLSearchParams): Settings {
    const settings: Settings = { ...DEFAULT_SETTINGS };
    try {
        const raw = storage.getItem(KEY);
        if (raw) {
            const saved = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
            if (isRuleset(saved.ruleset)) settings.ruleset = saved.ruleset;
            if (typeof saved.timers === "boolean") settings.timers = saved.timers;
            if (typeof saved.telemetry === "boolean") settings.telemetry = saved.telemetry;
            if (typeof saved.glyphHelpOpen === "boolean") settings.glyphHelpOpen = saved.glyphHelpOpen;
            if (typeof saved.animations === "boolean") settings.animations = saved.animations;
            if (typeof saved.sound === "boolean") settings.sound = saved.sound;
            if (typeof saved.arena3d === "boolean") settings.arena3d = saved.arena3d;
            if (typeof saved.weather === "boolean") settings.weather = saved.weather;
            if (typeof saved.suddenDeath === "boolean") settings.suddenDeath = saved.suddenDeath;
            if (typeof saved.press === "boolean") settings.press = saved.press;
            if (typeof saved.deck === "boolean") settings.deck = saved.deck;
            if (typeof saved.arenaFx === "boolean") settings.arenaFx = saved.arenaFx;
            if (isGame(saved.game)) settings.game = saved.game;
            if (isArcadeMode(saved.arcadeMode)) settings.arcadeMode = saved.arcadeMode;
        }
    } catch {
        // Unreadable storage or corrupt JSON: defaults.
    }
    const rules = params.get("rules");
    if (isRuleset(rules)) settings.ruleset = rules;
    const timers = parseSwitch(params.get("timers"));
    if (timers !== undefined) settings.timers = timers;
    const telemetry = parseSwitch(params.get("telemetry"));
    if (telemetry !== undefined) settings.telemetry = telemetry;
    const animations = parseSwitch(params.get("animations"));
    if (animations !== undefined) settings.animations = animations;
    const sound = parseSwitch(params.get("sound"));
    if (sound !== undefined) settings.sound = sound;
    const weather = parseSwitch(params.get("weather"));
    if (weather !== undefined) settings.weather = weather;
    const sudden = parseSwitch(params.get("sudden"));
    if (sudden !== undefined) settings.suddenDeath = sudden;
    const press = parseSwitch(params.get("press"));
    if (press !== undefined) settings.press = press;
    const deck = parseSwitch(params.get("deck"));
    if (deck !== undefined) settings.deck = deck;
    const game = params.get("game");
    if (isGame(game)) settings.game = game;
    const arcade = params.get("arcade");
    if (isArcadeMode(arcade)) settings.arcadeMode = arcade;
    const fx = params.get("fx");
    if (fx === "light") settings.arenaFx = false;
    if (fx === "full") settings.arenaFx = true;
    const stage = params.get("stage");
    if (stage === "3d") settings.arena3d = true;
    if (stage === "2d") settings.arena3d = false;
    return settings;
}

export function saveSettings(storage: StorageLike, settings: Settings): void {
    try {
        storage.setItem(KEY, JSON.stringify(settings));
    } catch {
        // Private mode: the choice lasts for this page load.
    }
}
