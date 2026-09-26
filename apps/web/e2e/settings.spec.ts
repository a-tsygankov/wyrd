import { expect, test } from "@playwright/test";

// Settings (one of four rulesets, timers, telemetry) and the Stats panel.

test("the settings panel switches rulesets and the Focus budget follows", async ({ page }) => {
    await page.goto("/?seed=smoke");
    await expect(page.locator("#settings")).toBeHidden();
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings")).toBeVisible();
    await expect(page.locator("#settings-rules .settings-option")).toHaveCount(4);
    await expect(page.locator("#settings-rules .settings-option.selected")).toContainText("Classic");

    // Teeth: reactions cost Focus from the same 7 you compose with.
    await page.locator('#settings-rules input[value="teeth"]').check();
    await expect(page.locator("#settings-rules .settings-option.selected")).toContainText("Teeth");
    await expect(page.locator("#scenario-note")).toContainText("Teeth");
    await expect(page.locator('#reaction-tray [data-reaction="null"]')).toContainText("NULL · 3");
    await expect(page.locator('#reaction-tray [data-reaction="reflect"]')).toContainText("REFLECT · 2");

    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY", "ANCHOR"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await expect(page.locator("#focus-cost")).toHaveText("5");
    await expect(page.locator("#focus-budget")).toHaveText("7");
    await page.locator('#reaction-tray [data-reaction="null"]').click();
    await expect(page.locator("#focus-budget")).toHaveText("4");
    await expect(page.locator("#resolve-round")).toBeDisabled();
    await expect(page.locator("#spell-diagnostic")).toContainText(/not enough Focus/i);
    await page.locator('#reaction-tray [data-reaction="silence"]').click();
    await expect(page.locator("#focus-budget")).toHaveText("6");
    await expect(page.locator("#resolve-round")).toBeEnabled();
    await page.locator("#resolve-round").click();
    // Round 1 of the deck: the opponent's FIRE SEEK ENEMY lands (SILENCE
    // strips nothing), our anchored SEEK lands.
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#combat-log")).toContainText("SILENCE cost 1 Focus");

    // The choice persists across a reload.
    await page.reload();
    await expect(page.locator("#scenario-note")).toContainText("Teeth");
});

test("the Resolve ruleset shows resolve bars and SEEK drains them", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=resolve&timers=off");
    await expect(page.locator("#player-resolve")).toBeVisible();
    await expect(page.locator("#player-resolve .resolve-text")).toHaveText("Resolve 10");
    await expect(page.locator("#scenario-note")).toContainText("Resolve");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    // Both SEEKs land in round 1: 10 → 9 each.
    await expect(page.locator("#player-resolve .resolve-text")).toHaveText("Resolve 9");
    await expect(page.locator("#opponent-resolve .resolve-text")).toHaveText("Resolve 9");
    await expect(page.locator("#combat-log")).toContainText("resolve drops by 1");
});

test("timers are off in the teaching deck and on for the bot when the ruleset has them", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=pulse");
    await expect(page.locator("#timer")).toBeHidden();
    await page.goto("/?seed=smoke&rules=pulse&mode=hotseat");
    await expect(page.locator("#timer")).toBeVisible();
    await expect(page.locator("#timer-text")).toContainText(/Quick cast/);
    await expect(page.locator("#resolve-round")).toHaveClass(/quick/);
    await page.goto("/?seed=smoke&rules=pulse&mode=hotseat&timers=off");
    await expect(page.locator("#timer")).toBeHidden();
});

test("the stats panel shows this device's games and everyone's summary", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=teeth");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#player-seals")).toHaveText("1");
    await page.locator("#stats-toggle").click();
    await expect(page.locator("#stats")).toBeVisible();
    const teethRow = page.locator("#stats-local tr", { hasText: "Teeth" });
    await expect(teethRow).toContainText("1"); // one round
    await expect(teethRow).toContainText("none"); // top reaction
    await expect(page.locator("#stats-streak")).toContainText("Streak");
    // Everyone: either the worker's table or the offline notice; never a hang.
    await expect(page.locator("#stats-global")).not.toContainText("Loading", { timeout: 15_000 });
});
