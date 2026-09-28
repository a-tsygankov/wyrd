import { expect, test } from "@playwright/test";

// Telegraph cards and the lit spell sentence.

test("the telegraph shows rune cards: face-up glyphs and a face-down target", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&animations=off");
    const cards = page.locator("#telegraph-cards .rune-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute("data-family", "essence");
    await expect(cards.nth(0)).toContainText("FIRE");
    await expect(cards.nth(1)).toHaveAttribute("data-family", "action");
    await expect(cards.nth(2)).toHaveClass(/face-down/);
    await expect(cards.nth(2)).toBeVisible();
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
});

test("Scry flips the hidden card face-up", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&rules=teeth&animations=off");
    await page.locator("#scry").click();
    const cards = page.locator("#telegraph-cards .rune-card");
    await expect(cards.nth(2)).toHaveClass(/glyph/);
    await expect(cards.nth(2)).toContainText("ENEMY");
});

test("the spell sentence lights when it parses, marks the glyph at fault, carries modifiers as marks, and a tap removes a glyph", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&animations=off");
    const tray = page.locator("#glyph-tray");
    const strip = page.locator("#spell-cards");
    await expect(strip).toHaveAttribute("data-lit", "false");
    await tray.getByRole("button", { name: "FIRE", exact: true }).click();
    await tray.getByRole("button", { name: "SEEK", exact: true }).click();
    await expect(strip.locator(".rune-card")).toHaveCount(2);
    await expect(strip.locator(".rune-card.fault")).toHaveAttribute("data-token", "SEEK");
    await expect(strip).toHaveAttribute("data-lit", "false");
    await tray.getByRole("button", { name: "ENEMY", exact: true }).click();
    await expect(strip).toHaveAttribute("data-lit", "true");
    await expect(strip.locator(".rune-card.fault")).toHaveCount(0);
    await tray.getByRole("button", { name: "AMPLIFY", exact: true }).click();
    await expect(strip.locator(".rune-card")).toHaveCount(3, { timeout: 3_000 });
    await expect(strip.locator('.rune-card[data-token="SEEK"] .rune-mark')).toHaveCount(1);
    await expect(page.locator("#spell-preview")).toContainText("FIRE → SEEK → ENEMY → AMPLIFY");
    // Tapping the SEEK card removes SEEK and its mark; the sentence goes dark.
    await strip.locator('.rune-card[data-token="SEEK"]').click();
    await expect(page.locator("#spell-preview")).toContainText("FIRE → ENEMY");
    await expect(strip).toHaveAttribute("data-lit", "false");
});
