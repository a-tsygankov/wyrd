import { expect, test } from "@playwright/test";

// The teaching deck plays for a device's first solo match only; after it the
// heuristic opponent meets the player from round 1. `?deck=` pins it.

const DECK_OPENER = "FIRE → SEEK → ?";

test("after the first match ends, the rematch meets the bot from round 1 and Settings can bring the deck back", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&animations=off");
    const note = page.locator("#scenario-note");
    await expect(note).toContainText("Scenario 1/");
    await expect(page.locator("#telegraph")).toHaveText(DECK_OPENER);
    const tray = page.locator("#glyph-tray");
    const cast = async (glyphs: string[], reaction?: string) => {
        if (reaction) await page.locator(`#reaction-tray [data-reaction="${reaction}"]`).click();
        for (const glyph of glyphs) await tray.getByRole("button", { name: glyph, exact: true }).click();
        await page.locator("#resolve-round").click();
        await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    };
    // Win the first match inside the deck: REFLECT + SEEK is two seals, a second round's SEEK makes three.
    await cast(["SEEK", "ENEMY"], "reflect");
    await expect(page.locator("#player-seals")).toHaveText("2");
    await page.locator("#next-round").click();
    await cast(["SEEK", "ENEMY"], "reflect");
    await expect(page.locator("#match-status")).toContainText("You win");
    // Rematch: no scenario, the personality is named, and the opener is the bot's.
    await page.locator("#rematch-fab").click();
    await expect(note).toContainText("Opponent: the");
    await expect(note).not.toContainText("Scenario");
    await expect(page.locator("#telegraph")).not.toHaveText(DECK_OPENER);
    // The choice is remembered across reloads and can be undone in Settings.
    await page.reload();
    await expect(note).not.toContainText("Scenario");
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-deck")).not.toBeChecked();
    await page.locator("#settings-deck").check();
    await expect(note).toContainText("Scenario 1/");
});

test("?deck=off skips the deck on a fresh device and ?deck=on keeps it after a match", async ({ page }) => {
    await page.goto("/?seed=smoke&deck=off&stage=2d&animations=off");
    await expect(page.locator("#scenario-note")).toContainText("Opponent: the");
    await page.goto("/?seed=smoke&deck=on&stage=2d&animations=off");
    await expect(page.locator("#scenario-note")).toContainText("Scenario 1/");
});
