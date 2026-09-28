import { expect, test } from "@playwright/test";

// The gate as the scoreboard: a seal lights a notch on the scorer's chain and the gate leans.

test("a seal lights the first notch on your chain and the gate leans your way", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&stage=2d&animations=off");
    for (const id of ["player-1", "player-2", "opponent-1"]) await expect(page.locator(`#stage-notch-${id}`)).toHaveAttribute("opacity", "0.25");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["GATE", "CLOSE"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    await expect(page.locator("#stage-notch-player-1")).toHaveAttribute("opacity", "1");
    await expect(page.locator("#stage-notch-player-2")).toHaveAttribute("opacity", "0.25");
    // Round 1's opponent SEEK also landed (no reaction): their first notch lights too.
    await expect(page.locator("#stage-notch-opponent-1")).toHaveAttribute("opacity", "1");
    const lean = await page.locator("#stage-gate").evaluate(el => (el as HTMLElement).style.transform);
    expect(lean).toMatch(/rotate\(/);
});

test("the arena reports the seals it shows", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit has no WebGL in CI");
    await page.goto("/?game=word&seed=smoke&animations=off");
    const arena = page.locator("#arena");
    await expect(arena).toHaveAttribute("data-renderer", "3d", { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-seals", "0-0");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["GATE", "CLOSE"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 15_000 });
    await expect(arena).toHaveAttribute("data-seals", "1-1");
});
