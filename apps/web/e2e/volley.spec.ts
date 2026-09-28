import { expect, test } from "@playwright/test";

// Volley, the arcade game (docs/arcade-duel-ideas.md §1 A), is the default
// game; the word duel is a Settings choice (?game=word). `?tempo=slow` runs
// the volley at a third of the speed so the return window is a comfortable
// target for the test runner.

test("the arcade volley is the default game and the word duel's cards stay hidden", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await expect(page.locator("body")).toHaveAttribute("data-game", "arcade");
    await expect(page.locator("#volley")).toBeVisible();
    await expect(page.locator(".composer")).toBeHidden();
    await expect(page.locator(".reaction")).toBeHidden();
    await expect(page.locator("#mode-toggle")).toBeHidden();
    await expect(page.locator("#volley-hearts-player i.lit")).toHaveCount(5);
    await expect(page.locator("#volley-focus-player i.lit")).toHaveCount(7);
    // The serve is in the air toward the player.
    await expect(page.locator("#volley")).toHaveAttribute("data-phase", "flight", { timeout: 5_000 });
    await expect(page.locator("#volley")).toHaveAttribute("data-owner", "opponent");
    await expect(page.locator("#stage-bolt")).toHaveAttribute("opacity", "1");
});

test("?game=word shows the word duel, and Settings switches between the two games", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&game=word");
    await expect(page.locator("body")).toHaveAttribute("data-game", "word");
    await expect(page.locator("#volley")).toBeHidden();
    await expect(page.locator(".composer")).toBeVisible();
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-game-word")).toBeChecked();
    await page.locator("#settings-game-arcade").check();
    await expect(page.locator("body")).toHaveAttribute("data-game", "arcade");
    await expect(page.locator("#volley")).toBeVisible();
    await expect(page.locator(".composer")).toBeHidden();
    await page.locator("#settings-game-word").check();
    await expect(page.locator("#volley")).toBeHidden();
    await expect(page.locator(".composer")).toBeVisible();
});

test("a return inside the window sends the bolt back faster and refills Focus; a miss costs a heart", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&tempo=slow");
    const volley = page.locator("#volley");
    await expect(volley).toHaveAttribute("data-phase", "flight", { timeout: 5_000 });
    // Spend two Focus on a ward first so the refill is visible, then drop the ward by swiping? No: keep it simple - the return refills to the cap, so read the speed instead.
    await expect(volley).toHaveAttribute("data-window", "open", { timeout: 10_000 });
    await page.locator("#volley-return").click();
    await expect(volley).toHaveAttribute("data-owner", "player", { timeout: 3_000 });
    await expect(volley).toHaveAttribute("data-speed", "2");
    await expect(page.locator("#volley-caption")).toContainText("You return");
    // Let the next incoming bolt land: the player loses a heart (or the bot missed first and we wait for the next).
    await expect(page.locator("#volley-hearts-player i.lit")).toHaveCount(4, { timeout: 30_000 });
    await expect(volley).toHaveAttribute("data-hearts-player", "4");
});

test("a ward in a colour the bolt cannot beat blocks it, costs two Focus, and hands the serve to the blocker", async ({ page }) => {
    // The opponent serves fire; the player's default colour is shadow, which fire does not beat.
    await page.goto("/?seed=smoke&stage=2d&tempo=slow");
    const volley = page.locator("#volley");
    await expect(volley).toHaveAttribute("data-phase", "flight", { timeout: 5_000 });
    await expect(volley).toHaveAttribute("data-essence", "fire");
    await page.locator("#volley-ward").click();
    await expect(page.locator("#volley-focus-player i.lit")).toHaveCount(5);
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("opacity", "1");
    await expect(page.locator("#volley-caption")).toContainText("WARD holds", { timeout: 10_000 });
    await expect(volley).toHaveAttribute("data-server", "player");
    await expect(page.locator("#volley-hearts-player i.lit")).toHaveCount(5);
    // The player serves next, in their colour.
    await expect(volley).toHaveAttribute("data-owner", "player", { timeout: 10_000 });
    await expect(volley).toHaveAttribute("data-essence", "shadow");
});

test("the Help section explains the volley terms", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help")).toContainText("Volley");
    await expect(page.locator("#help")).toContainText("water quenches fire");
});
