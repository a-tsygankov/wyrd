import { expect, test } from "@playwright/test";

// Progressive telegraph reveal (timers) and Scry (1 Focus, reaction-cost rulesets).

test("Scry buys one hidden glyph for 1 Focus under Teeth", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=teeth&animations=off");
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
    const scry = page.locator("#scry");
    await expect(scry).toBeVisible();
    await expect(scry).toContainText("1 hidden");
    await scry.click();
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ENEMY");
    await expect(scry).toBeHidden();
    await expect(page.locator("#focus-budget")).toHaveText("6");
    // The composer budget honours the spend: a 6-Focus pair no longer fits.
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY", "ANCHOR"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator('#reaction-tray [data-reaction="reflect"]').click();
    await expect(page.locator("#resolve-round")).toBeDisabled();
    await expect(page.locator("#spell-diagnostic")).toContainText(/not enough Focus/i);
});

test("no Scry under Classic, where reactions are free", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=classic&animations=off");
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
    await expect(page.locator("#scry")).toBeHidden();
});

test("under Pulse timers the hidden glyph flips face-up during the reaction window", async ({ page }) => {
    // Hot-seat has timers on every turn; the deck's teaching rounds do not.
    await page.goto("/?seed=smoke&rules=pulse&mode=hotseat&animations=off");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await page.locator("#handoff-ready").click();
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
    // One hidden glyph flips at half the 8-second window.
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ENEMY", { timeout: 9_000 });
    await expect(page.locator("#scry")).toBeHidden();
});
