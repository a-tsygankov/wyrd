import { expect, test } from "@playwright/test";

// Two humans on one phone: Player 2 composes in secret, the phone is passed,
// Player 1 reads the telegraph, reacts and casts, the phone is passed back,
// Player 2 reacts, and both see the resolution.

test("a hot-seat round passes the phone twice and resolves both spells", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/?mode=hotseat&seed=smoke");

    const tray = page.locator("#glyph-tray");
    const primary = page.locator("#resolve-round");
    const overlay = page.locator("#handoff");
    const pick = async (glyphs: string[]) => {
        for (const glyph of glyphs) await tray.getByRole("button", { name: glyph, exact: true }).click();
    };

    // Player 2 composes in secret: no telegraph, no reaction tray.
    await expect(page.locator("#match-status")).toContainText("Player 2");
    await expect(page.locator("#you-label")).toHaveText("Player 1");
    await expect(page.locator("#opp-label")).toHaveText("Player 2");
    await expect(page.locator("#reaction-tray")).toBeHidden();
    await expect(overlay).toBeHidden();
    await pick(["FIRE", "SEEK", "ENEMY"]);
    await expect(primary).toHaveText("LOCK IN SPELL");
    await primary.click();

    // Hand-off to Player 1 covers the board.
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("Player 1");
    await expect(page.locator("#glyph-tray")).toBeHidden();
    await page.locator("#handoff-ready").click();
    await expect(overlay).toBeHidden();

    // Player 1 sees Player 2's telegraph (target hidden), reacts and casts.
    await expect(page.locator("#telegraph-label")).toHaveText("Player 2 telegraph");
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
    await expect(page.locator("#reaction-tray")).toBeVisible();
    await page.locator('#reaction-tray [data-reaction="reflect"]').click();
    await pick(["GATE", "CLOSE"]);
    await expect(primary).toHaveText("COMMIT");
    await primary.click();

    // Hand-off back to Player 2, who reads Player 1's telegraph and reacts.
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("Player 2");
    await page.locator("#handoff-ready").click();
    await expect(page.locator("#telegraph-label")).toHaveText("Player 1 telegraph");
    await expect(page.locator("#telegraph")).toHaveText("? → CLOSE");
    await expect(page.locator(".composer")).toBeHidden();
    await expect(primary).toHaveText("RESOLVE ROUND");
    await primary.click();

    // REFLECT returned Player 2's SEEK (seal to Player 1) and the GATE closed.
    await expect(page.locator("#player-seals")).toHaveText("2");
    await expect(page.locator("#opponent-seals")).toHaveText("0");
    await expect(page.locator("#combat-log li")).not.toHaveCount(1);
    await expect(page.locator("#next-round")).toBeVisible();
    await page.locator("#next-round").click();
    await expect(page.locator("#match-status")).toContainText("Player 2");
    await expect(page.locator("#round-number")).toHaveText("2");
    expect(errors).toEqual([]);
});

test("the mode toggle switches between solo and hot-seat and resets the match", async ({ page }) => {
    await page.goto("/?seed=smoke");
    await expect(page.locator("#mode-toggle")).toHaveText("Hot-seat");
    await expect(page.locator("#scenario-note")).toContainText("Scenario 1/");
    await page.locator("#mode-toggle").click();
    await expect(page.locator("#mode-toggle")).toHaveText("Solo");
    await expect(page.locator("#match-status")).toContainText("Player 2");
    await page.locator("#mode-toggle").click();
    await expect(page.locator("#scenario-note")).toContainText("Scenario 1/");
    await expect(page.locator("#match-status")).toHaveText("Your move");
});
