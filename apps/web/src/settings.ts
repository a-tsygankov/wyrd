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
};

export const DEFAULT_SETTINGS: Settings = { ruleset: "classic", timers: true, telemetry: true, glyphHelpOpen: false };

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const KEY = "wyrd.settings";

function isRuleset(value: unknown): value is RulesetId {
    return typeof value === "string" && (rulesetIds as readonly string[]).includes(value);
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
    return settings;
}

export function saveSettings(storage: StorageLike, settings: Settings): void {
    try {
        storage.setItem(KEY, JSON.stringify(settings));
    } catch {
        // Private mode: the choice lasts for this page load.
    }
}
