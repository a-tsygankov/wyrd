import { expect, test } from "@playwright/test";

// Presentation slice D/I/E (docs/duel-ux-ideas.md): Focus meter, cost pips,
// floor marks that persist, the urgent edge of the reaction window.

test("the Focus meter and the cost pips follow the spell being composed", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    const tray = page.locator("#glyph-tray");
    await expect(tray.getByRole("button", { name: "FIRE", exact: true }).locator(".pips")).toHaveText("●");
    await expect(tray.getByRole("button", { name: "SEEK", exact: true }).locator(".pips")).toHaveText("●●");
    await expect(tray.getByRole("button", { name: "SELF", exact: true }).locator(".pips")).toHaveCount(0);
    await expect(page.locator("#focus-pill")).toHaveAttribute("data-state", "full");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await expect(page.locator("#focus-pill")).toHaveAttribute("data-state", "ok");
    await expect(page.locator("#focus-spell-fill")).toHaveAttribute("style", /width: 43%/);
    await expect(page.locator("#focus-cost")).toHaveText("3");
});

test("a hit scorches the floor and the mark survives the next round", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    // Round 1 (direct threat): the opponent's FIRE SEEK ENEMY lands on you unless you react.
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["SELF", "WARD", "SHADOW"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    await expect(page.locator("#stage-marks ellipse")).toHaveCount(1);
    await expect(page.locator("#stage-marks ellipse").first()).toHaveAttribute("data-side", "player");
    await page.locator("#next-round").click();
    await expect(page.locator("#stage-marks ellipse")).toHaveCount(1, { timeout: 2_000 });
});

test("under Pulse the reaction card turns urgent for the last seconds of the window", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=pulse&mode=hotseat&animations=off");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await page.locator("#handoff-ready").click();
    await expect(page.locator(".reaction")).not.toHaveClass(/urgent/);
    await expect(page.locator(".reaction")).toHaveClass(/urgent/, { timeout: 7_000 });
    await expect(page.locator(".reaction")).not.toHaveClass(/urgent/, { timeout: 5_000 });
});
