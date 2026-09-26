import { expect, test } from "@playwright/test";

// The stage replays the resolver's steps; these checks pin the wiring, not
// the pixels: beats fire in order, the last beat of a landing round is the
// seal, wards appear when the state has them, a tap skips, reduced motion
// still completes.

test("a cast plays through to the seal and the stage returns to idle", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=on");
    const stage = page.locator("#stage");
    await expect(stage).toBeVisible();
    await expect(page.locator("#stage-mage-player")).toBeVisible();
    await expect(page.locator("#stage-mage-opponent")).toBeVisible();
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("opacity", "0");

    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(stage).toHaveAttribute("data-playing", "1");
    // Both SEEKs land in round 1: the final beat is the player's seal.
    await expect(stage).toHaveAttribute("data-last-beat", "seal", { timeout: 15_000 });
    await expect(stage).not.toHaveAttribute("data-playing", "1", { timeout: 15_000 });
    await expect(page.locator("#stage-caption")).toHaveText("");
});

test("a ward shows on the stage once it exists", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["SELF", "WARD", "SHADOW"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 15_000 });
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("opacity", "1");
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("stroke", "#a56bff");
});

test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the timeline still completes and lands on the result", async ({ page }) => {
        await page.goto("/?seed=smoke");
        const tray = page.locator("#glyph-tray");
        for (const glyph of ["GATE", "CLOSE"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
        await page.locator("#resolve-round").click();
        await expect(page.locator("#stage")).toHaveAttribute("data-last-beat", "seal", { timeout: 5_000 });
        await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 5_000 });
        await expect(page.locator("#stage-gate-door")).toHaveAttribute("opacity", "1");
    });
});

test("the Stage settings group has animation and sound switches", async ({ page }) => {
    await page.goto("/?seed=smoke");
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-animations")).toBeChecked();
    await expect(page.locator("#settings-sound")).not.toBeChecked();
    await page.locator("#settings-animations").uncheck();
    await page.reload();
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-animations")).not.toBeChecked();
});
