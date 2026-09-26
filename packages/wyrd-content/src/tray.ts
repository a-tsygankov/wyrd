/**
 * The POC tray: the glyphs the composer exposes. The parser knows all 30
 * registry glyphs; the resolver implements these seven actions
 * (SEEK, BIND, WARD, BREAK, MEND, OPEN, CLOSE), four essences, three
 * targets and two modifiers. Bot pool, help text and tests all derive
 * from this list.
 */
export type TrayFamily = "essence" | "target" | "action" | "modifier";

export const POC_TRAY: readonly string[] = [
    "FIRE",
    "WATER",
    "SHADOW",
    "LIFE",
    "SELF",
    "ENEMY",
    "GATE",
    "SEEK",
    "BIND",
    "WARD",
    "BREAK",
    "MEND",
    "OPEN",
    "CLOSE",
    "AMPLIFY",
    "ANCHOR"
];

export const TRAY_FAMILY: Record<string, TrayFamily> = {
    FIRE: "essence",
    WATER: "essence",
    SHADOW: "essence",
    LIFE: "essence",
    SELF: "target",
    ENEMY: "target",
    GATE: "target",
    SEEK: "action",
    BIND: "action",
    WARD: "action",
    BREAK: "action",
    MEND: "action",
    OPEN: "action",
    CLOSE: "action",
    AMPLIFY: "modifier",
    ANCHOR: "modifier"
};
