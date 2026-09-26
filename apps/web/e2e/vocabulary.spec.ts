import { expect, test } from "@playwright/test";

// The wider tray: 19 glyphs, the gate as a contested objective, BREAK and MEND.

test("the tray offers 19 glyphs and BREAK GATE shatters the objective", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    await expect(page.locator("#glyph-tray button")).toHaveCount(19);
    for (const glyph of ["WATER", "LIFE", "BREAK", "MEND", "OPEN"]) {
        await expect(page.locator("#glyph-tray").getByRole("button", { name: glyph, exact: true })).toBeVisible();
    }
    const tray = page.locator("#glyph-tray");
    await tray.getByRole("button", { name: "GATE", exact: true }).click();
    await tray.getByRole("button", { name: "BREAK", exact: true }).click();
    await expect(page.locator("#spell-explain .summary").first()).toContainText(/shatter/i);
    await page.locator("#glyph-help-toggle").click();
    await expect(page.locator("#glyph-help-list")).toContainText("BREAK GATE shatters the objective");
    await page.locator("#resolve-round").click();
    await expect(page.locator("#combat-log")).toContainText("BREAK shattered the GATE");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    await expect(page.locator("#stage-gate")).toHaveClass(/broken/);
    await expect(page.locator("#admin-state")).toHaveCount(1);
});

test("a closed gate cannot be closed again; OPEN scores instead", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off&admin=1");
    const tray = page.locator("#glyph-tray");
    // Round 1: close it.
    for (const glyph of ["GATE", "CLOSE"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#admin-state")).toContainText("closed");
    await page.locator("#next-round").click();
    // Round 2: CLOSE again fails, the composer says so before casting.
    for (const glyph of ["GATE", "CLOSE"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await expect(page.locator("#spell-explain")).toContainText(/already closed/i);
    await page.locator("#clear-spell").click();
    for (const glyph of ["GATE", "OPEN"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await expect(page.locator("#spell-explain .summary").first()).toContainText(/seal to you/i);
});
