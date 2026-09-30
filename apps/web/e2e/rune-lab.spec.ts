import { expect, test, type Page } from "@playwright/test";

// Rune Lab (docs/rune-lab.md): the opponent writes a rune stroke by stroke,
// you read it and ready a counter before it lands; drawing again adjusts the
// answer or finishes a combo. Rune Parry shows only the opening of their
// stroke. The rules are unit-tested in test/rune_duel.test.mjs.
//
// The duel is a real-time loop, and CI renders its WebGL in software, where
// every mouse move waits on a slow frame: specs that raced the real clock
// failed there however slow the game was set. So time is Playwright's fake
// clock, paused from the start: strokes are drawn with time standing still,
// and `tick` advances it exactly to the moment a spec needs. Stepping the
// clock by a second rendered sixty software-WebGL frames at once and
// Chromium's page fell over in CI, so every spec but the camera ones opens
// with `?arena=off` (no 3D arena, same data attributes).

const T0 = new Date("2026-01-01T00:00:00Z").getTime();

/** Open the Rune Lab with time paused at T0; without the 3D arena unless `arena3d`. */
async function open(page: Page, arena3d = false): Promise<void> {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0 + 10);
    await page.goto(arena3d ? "/rune-lab.html" : "/rune-lab.html?arena=off");
    await expect(page.getByText("WYRD · RUNE LAB")).toBeVisible();
}
/** Advance the paused clock: timers and frames run as if `ms` had passed. */
const tick = (page: Page, ms: number): Promise<void> => page.clock.runFor(ms);
/** The first exchange opens 700 ms after the duel starts (1× speed). */
const toFirstRune = (page: Page): Promise<void> => tick(page, 800);

/** Draw one stroke on the rune panel: `f` maps t in [0, 1] to a point relative to the panel's top-left. */
async function stroke(page: Page, f: (t: number, w: number, h: number) => { x: number; y: number }, steps = 16): Promise<void> {
    const box = await page.locator("#rune-canvas").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const at = (t: number): { x: number; y: number } => {
        const p = f(t, box.width, box.height);
        return { x: box.x + p.x, y: box.y + p.y };
    };
    await page.mouse.move(at(0).x, at(0).y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(at(i / steps).x, at(i / steps).y);
    await page.mouse.up();
}
const line = (page: Page): Promise<void> => stroke(page, (t, w, h) => ({ x: 35 + t * Math.min(180, w - 80), y: h * 0.65 }), 8);
const loop = (page: Page): Promise<void> => stroke(page, (t, w, h) => ({ x: w / 2 + Math.cos(Math.PI * 2 * t - Math.PI / 2) * 45, y: h / 2 + Math.sin(Math.PI * 2 * t - Math.PI / 2) * 45 }), 20);
const arcUp = (page: Page): Promise<void> => stroke(page, (t, w, h) => ({ x: 45 + t * Math.min(180, w - 90), y: h * 0.7 - Math.sin(Math.PI * t) * 75 }), 14);

test.beforeEach(async ({ page }, testInfo) => {
    // The camera and view specs need the real 3D arena; the rest test rules and HUD.
    await open(page, /views|camera/.test(testInfo.title));
});

test("switches and persists all arena views", async ({ page }) => {
    await page.getByRole("button", { name: "View" }).click();
    for (const view of ["Side", "Top", "Abstract", "Behind"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await expect(page.locator("#arena")).toHaveAttribute("data-camera", view.toLowerCase());
    }
    await page.getByRole("button", { name: "Top", exact: true }).click();
    await page.reload();
    await expect(page.getByText("WYRD · RUNE LAB")).toBeVisible();
    await expect(page.locator("#arena")).toHaveAttribute("data-camera", "top");
});

test("their rune is written stroke by stroke, and the read sharpens from sensing to its name", async ({ page }) => {
    await toFirstRune(page);
    await expect(page.locator("#enemy-intent")).toHaveClass(/show/);
    await expect(page.locator("#their-rune")).toBeVisible();
    await expect(page.locator("#arena")).toHaveAttribute("data-read", "sensing");
    const early = Number(await page.locator("#their-rune").getAttribute("data-progress"));
    expect(early).toBeLessThan(0.2);
    await tick(page, 1200); // 40% written
    await expect(page.locator("#arena")).toHaveAttribute("data-read", "hint");
    await tick(page, 1200); // 80% written
    await expect(page.locator("#arena")).toHaveAttribute("data-read", "named");
    expect(Number(await page.locator("#their-rune").getAttribute("data-progress"))).toBeGreaterThan(0.7);
    expect(Number(await page.locator("#arena").getAttribute("data-opponent-progress"))).toBeGreaterThan(0.7);
});

test("a drawn rune is readied with a charge and resolves at impact", async ({ page }) => {
    await toFirstRune(page);
    await line(page);
    await expect(page.locator("#recognized")).toHaveText("PIERCE");
    await expect(page.locator("#confidence")).toContainText("Confidence");
    await expect(page.locator("#quality")).toContainText("Execution");
    await expect(page.locator("#readied")).toContainText("PIERCE");
    await expect(page.locator("#readied")).toContainText("charge");
    // Nothing resolves on lift: the exchange lands at impact, 3.6 s after it opened.
    await expect(page.locator("#result")).not.toHaveClass(/show/);
    await tick(page, 3700);
    await expect(page.locator("#result")).toHaveClass(/show/);
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.locator("#combat-log")).toContainText("Readied");
    await expect(page.locator("#combat-log")).toContainText(/Counter/);
});

test("drawing again adjusts the answer; a Ward then a Redirect is the Reflect combo", async ({ page }) => {
    await toFirstRune(page);
    await line(page);
    await expect(page.locator("#readied")).toContainText("PIERCE");
    await loop(page);
    await expect(page.locator("#readied")).toContainText("WARD");
    await arcUp(page);
    await expect(page.locator("#readied")).toContainText("COMBO REFLECT");
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.locator("#combat-log")).toContainText("Adjusted");
    await expect(page.locator("#combat-log")).toContainText("Combo REFLECT");
});

test("an answer drawn while their rune is in flight still counts", async ({ page }) => {
    await toFirstRune(page);
    await tick(page, 3200); // written (3 s): the rune is in the air, 0.6 s from landing
    await expect(page.locator("#cast-label")).toHaveText("IN FLIGHT · LAST CHANCE");
    await line(page);
    await expect(page.locator("#readied")).toContainText("PIERCE");
});

test("the combat log reads in order: the duel's start first, the latest entry last", async ({ page }) => {
    await toFirstRune(page);
    await line(page);
    await page.getByRole("button", { name: "Log" }).click();
    const items = page.locator("#combat-log li");
    await expect(items.first()).toContainText("New Rune Fencing duel");
    await expect(items.nth(1)).toContainText("They begin to write");
    await expect(items.last()).toContainText("Readied");
});

test("parry shows only the opening of their stroke, then a four-second commit; reset restarts it", async ({ page }) => {
    await page.getByRole("button", { name: "RUNE PARRY" }).click();
    await expect(page.locator("#mode-title")).toHaveText("Simultaneous rune parry");
    await expect(page.locator("#enemy-intent")).toHaveText("GLIMPSE · THEN HIDDEN");
    await expect(page.locator("#cast-label")).toHaveText("COMMIT BEFORE REVEAL");
    await expect(page.locator("#timer")).toHaveText(/^[34]\./);
    await tick(page, 1200);
    await expect(page.locator("#their-rune")).toHaveAttribute("data-progress", "0.35");
    await tick(page, 1000);
    await expect(page.locator("#their-rune")).toHaveAttribute("data-progress", "0.35");
    await page.getByRole("button", { name: "RESET" }).click();
    await expect(page.locator("#timer")).toHaveText(/^[34]\./);
});

test("speed setting, help and combat log are inspectable", async ({ page }) => {
    await page.getByRole("button", { name: "Help" }).click();
    await expect(page.locator("#rune-help")).toContainText("Pierce");
    await expect(page.locator("#rune-help")).toContainText("Absorb");
    await page.locator("#speed").selectOption("2");
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.locator("#combat-log")).toContainText("2×");
});

test("Help explains the idea, an exchange, what undoes what, the combos and both modes", async ({ page }) => {
    await page.getByRole("button", { name: "Help" }).click();
    const help = page.locator("#rune-help");
    await expect(help.locator("#help-idea")).toContainText("written language");
    await expect(help.locator("#help-idea")).toContainText("while it is still being written");
    await expect(help.locator("#help-exchange")).toContainText("readied");
    await expect(help.locator(".counter-chart tr")).toHaveCount(6);
    await expect(help.locator("#help-counters")).toContainText("Ward blocks it");
    for (const combo of ["EMPOWER", "REFLECT", "SIPHON"]) await expect(help.locator("#help-combos")).toContainText(combo);
    await expect(help.locator("#help-modes")).toContainText("opening");
});

test("zero opponent HP produces victory and closes casting", async ({ page }) => {
    // Use the deterministic test hook rather than relying on random enemy rune selection.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("rune-test-damage", { detail: { side: "enemy", amount: 100 } })));
    await expect(page.locator("#battle-state")).toHaveText("VICTORY");
    await expect(page.locator("#arena")).toHaveClass(/battle-ended/);
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.locator("#combat-log")).toContainText("VICTORY");
});

test("camera controls rotate, zoom and reset the 3D arena", async ({ page }) => {
    await page.getByRole("button", { name: "View" }).click();
    const arena = page.locator("#arena");
    const initialDistance = await arena.getAttribute("data-camera-distance");
    const initialYaw = await arena.getAttribute("data-camera-yaw");
    await page.getByRole("button", { name: "Turn camera right" }).click();
    await expect(arena).not.toHaveAttribute("data-camera-yaw", initialYaw ?? "");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(arena).not.toHaveAttribute("data-camera-distance", initialDistance ?? "");
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(arena).toHaveAttribute("data-camera", "behind");
});

test("rune guide shows drawing instructions including inverted-arc Absorb", async ({ page }) => {
    await page.getByRole("button", { name: "Help" }).click();
    await expect(page.locator("#rune-help")).toContainText("HOW TO DRAW");
    await expect(page.locator("#rune-help")).toContainText("inverse of Redirect");
    await expect(page.locator("#rune-help")).toContainText("Finish close to the starting point");
});

test("downward open arc is recognized as Absorb", async ({ page }) => {
    await toFirstRune(page);
    await stroke(page, (t, w, h) => ({ x: 45 + t * Math.min(180, w - 90), y: h * 0.35 + Math.sin(Math.PI * t) * 75 }), 14);
    await expect(page.locator("#recognized")).toHaveText("ABSORB");
});
