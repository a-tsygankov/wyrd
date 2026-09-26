import { expect, test } from "@playwright/test";

// The admin console: hidden by default, opened by a triple-tap on the title
// (or ?admin=1), showing the hidden opponent spell, best-move advice with
// the resolver's explanations, and the client log.

test("the console is hidden until the title is tapped three times", async ({ page }) => {
    await page.goto("/?seed=smoke");
    const console_ = page.locator("#admin-console");
    await expect(console_).toBeHidden();
    const title = page.locator("#title-block");
    await title.click({ clickCount: 3 });
    await expect(console_).toBeVisible();
    await page.locator("#admin-close").click();
    await expect(console_).toBeHidden();
});

test("advice reveals the round-1 threat and recommends REFLECT with a reason", async ({ page }) => {
    await page.goto("/?seed=smoke&admin=1");
    const console_ = page.locator("#admin-console");
    await expect(console_).toBeVisible();
    await expect(page.locator("#admin-state")).toContainText("FIRE SEEK ENEMY");
    await expect(page.locator("#admin-state")).toContainText("direct-threat");
    const best = page.locator("#admin-reactions li").first();
    await expect(best).toContainText("REFLECT");
    await expect(best).toContainText("seal");
    await expect(best.locator(".why")).toContainText(/redirected|caster/i);
    // Spell advice lists expected value and the reaction breakdown.
    const spells = page.locator("#admin-spells li");
    await expect(spells).not.toHaveCount(0);
    await expect(spells.first()).toContainText(/EV [+-]?\d/);
    // The log records the round plan and, after a cast, the resolution.
    await expect(page.locator("#admin-log li")).not.toHaveCount(0);
    await expect(page.locator("#admin-log")).toContainText("round 1");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await page.locator("#glyph-tray").getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#admin-log")).toContainText("resolved");
});
