import { expect, test } from "@playwright/test";

// Personality props on the stage and the commit ritual before the replay.

test("the opponent's persona shows on the flat stage from round one", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    await expect(page.locator("#stage-name-player")).toHaveText("You");
    await expect(page.locator("#stage-name-opponent")).toHaveText(/^the (Adept|Aggressor|Warden|Trickster|Gatekeeper)$/);
    const hat = page.locator("#stage-mage-opponent .hat");
    await expect(hat).not.toHaveAttribute("fill", "#a34a8a");
});

test("the commit ritual cracks the seals and names who resolves first, then the rim stays on that mage", async ({ page }) => {
    await page.goto("/?seed=smoke");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    const ritual = page.locator("#commit-ritual");
    await expect(ritual).toBeVisible();
    await expect(ritual.locator(".ritual-card")).toHaveCount(2);
    await expect(ritual.locator(".ritual-card.first")).toHaveAttribute("data-side", "player", { timeout: 3_000 });
    await expect(ritual.locator(".ritual-first")).toContainText(/Your SEEK ENEMY resolves first: the cheaper spell/);
    await expect(ritual).toBeHidden({ timeout: 5_000 });
    await expect(page.locator("#stage-priority-player")).toHaveAttribute("opacity", "1");
    await expect(page.locator("#stage-priority-opponent")).toHaveAttribute("opacity", "0");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 15_000 });
    await page.locator("#next-round").click();
    await expect(page.locator("#stage-priority-player")).toHaveAttribute("opacity", "0");
});

test("reduced motion skips the ritual and still marks the first mover", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#commit-ritual")).toBeHidden();
    await expect(page.locator("#stage-priority-player")).toHaveAttribute("opacity", "1");
});

test("the arena shows the persona nameplate and the gold rim", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit has no WebGL in CI");
    await page.goto("/?seed=smoke&stage=3d&animations=off");
    const arena = page.locator("#arena");
    await expect(arena).toHaveAttribute("data-renderer", "3d", { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-persona-player", "You");
    await expect(arena).toHaveAttribute("data-persona-opponent", /^the /);
});
