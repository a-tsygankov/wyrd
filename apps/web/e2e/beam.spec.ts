import { expect, test } from "@playwright/test";

// Beam clash (docs/arcade-duel-ideas.md §1 B): the third arcade game, chosen
// in Settings → Game or with ?arcade=beam. `?tempo=slow` stretches the beat
// to 1.8 s so the runner can act between beats. The bot's taps are seeded
// but land on the beat, so these specs assert what the player's own input
// does (Focus, colour, ward) rather than where the knot ends up.

test("?arcade=beam shows Beam clash, waiting on Start; Start opens the clash with both beams on the stage", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=beam");
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "beam");
    const beam = page.locator("#beam");
    await expect(beam).toBeVisible();
    await expect(page.locator("#volley")).toBeHidden();
    await expect(beam).toHaveAttribute("data-phase", "ready");
    await expect(page.locator("#beam-seals-player i")).toHaveCount(3);
    await page.locator("#beam-start").click();
    await expect(beam).toHaveAttribute("data-phase", "clash");
    await expect(beam).toHaveAttribute("data-knot", "0");
    await expect(page.locator("#stage-beam-player")).toHaveAttribute("opacity", "0.85");
    await expect(page.locator("#stage-beam-opponent")).toHaveAttribute("opacity", "0.85");
    await expect(page.locator("#beam-clock")).toContainText(" s");
});

test("an off-beat push costs a Focus; the beat lights the Push button", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=beam&tempo=slow");
    const beam = page.locator("#beam");
    await page.locator("#beam-start").click();
    // A four-beat count-in, spoken: 4, 3, 2, 1, then Push!
    await expect(page.locator("#beam-caption")).toHaveText("4");
    await expect(page.locator("#beam-caption")).toHaveText("1", { timeout: 8_000 });
    // Past the count-in: wait for a beat to light and go out, then push between beats.
    await expect(beam).toHaveAttribute("data-beat", "on", { timeout: 15_000 });
    await expect(beam).toHaveAttribute("data-beat", "off", { timeout: 5_000 });
    await page.locator("#beam-push").dispatchEvent("pointerdown");
    await expect(beam).toHaveAttribute("data-focus-player", "6");
    await expect(page.locator("#beam-caption")).toContainText("Off the beat");
});

test("the first switch is free and lands after a moment; the next costs two Focus; Ward holds the end", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=beam&tempo=slow");
    const beam = page.locator("#beam");
    await page.locator("#beam-start").click();
    await expect(beam).toHaveAttribute("data-colour-player", "shadow");
    await page.locator('.beam-pad[data-essence="water"]').click();
    await expect(page.locator('.beam-pad[data-essence="water"]')).toHaveClass(/pending/);
    await expect(beam).toHaveAttribute("data-colour-player", "water", { timeout: 3_000 });
    await expect(beam).toHaveAttribute("data-focus-player", "7");
    await expect(beam).toHaveAttribute("data-switch-cost", "2");
    await page.locator('.beam-pad[data-essence="life"]').click();
    await expect(beam).toHaveAttribute("data-focus-player", "5");
    await page.locator("#beam-ward").click();
    await expect(beam).toHaveAttribute("data-focus-player", "3");
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("opacity", "1");
    await expect(page.locator("#beam-ward")).toBeDisabled();
});

test("Settings offers Beam clash, and Reset returns it to Start", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await page.locator("#settings-toggle").click();
    await page.locator("#settings-arcade-beam").check();
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "beam");
    await expect(page.locator("#beam")).toBeVisible();
    await expect(page.locator(".topbar h1")).toHaveText("Push on the beat. Win the wheel.");
    await page.locator("#settings-close").click();
    await page.locator("#beam-start").click();
    await expect(page.locator("#beam")).toHaveAttribute("data-phase", "clash");
    await page.locator("#reset-match").click();
    await expect(page.locator("#beam")).toHaveAttribute("data-phase", "ready");
});

test("the Help section explains Beam clash", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=beam");
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help-rules")).toContainText("Beam clash");
    await expect(page.locator("#help-arcade")).toContainText("Knot");
});
