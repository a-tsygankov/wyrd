import { expect, test } from "@playwright/test";

// The Help section: every glyph, reaction, term and control, rule-aware.

test("Help lists all glyphs, reactions, terms and controls for the current rules", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&rules=teeth&animations=off");
    await expect(page.locator("#help")).toBeHidden();
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help")).toBeVisible();
    await expect(page.locator("#help-rules")).toContainText("Teeth");
    // 30 registry glyphs: 26 in the glyph group (19 castable + 7 pending) and 4 reactions (incl. SPELL).
    await expect(page.locator("#help-glyphs .help-list li")).toHaveCount(26);
    await expect(page.locator("#help-glyphs .help-list li.pending")).toHaveCount(7);
    await expect(page.locator("#help-reactions .help-list li")).toHaveCount(4);
    await expect(page.locator("#help-reactions")).toContainText("Costs 3 Focus");
    await expect(page.locator("#help-terms")).toContainText("Telegraph");
    await expect(page.locator("#help-terms")).toContainText("Integrity");
    await expect(page.locator("#help-controls")).toContainText("Undo");
    await page.locator("#help-nav a", { hasText: "Controls" }).click();
    await page.locator("#help-close").click();
    await expect(page.locator("#help")).toBeHidden();
});

test("Help follows the ruleset: reactions are free under Classic", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&rules=classic&animations=off");
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help-reactions")).toContainText("Free under these rules");
});
