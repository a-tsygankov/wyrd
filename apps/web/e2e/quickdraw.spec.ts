import { expect, test } from "@playwright/test";
import { openPaused, tick, tickUntil } from "./clock.js";

// Quickdraw (docs/arcade-duel-ideas.md §1 C): the second arcade game, chosen
// in Settings → Game or with ?arcade=quickdraw. `?tempo=slow` stretches the
// three-second ring to nine so the runner can act inside it.

test("Volley is the default arcade game; ?arcade=quickdraw and the Settings choice switch to Quickdraw", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "volley");
    await expect(page.locator("#quickdraw")).toBeHidden();
    await page.goto("/?seed=smoke&stage=2d&arcade=quickdraw");
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "quickdraw");
    await expect(page.locator("#quickdraw")).toBeVisible();
    await expect(page.locator("#volley")).toBeHidden();
    await expect(page.locator(".composer")).toBeHidden();
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-arcade-quickdraw")).toBeChecked();
    await page.locator("#settings-game-arcade").check();
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "volley");
    await expect(page.locator("#volley")).toBeVisible();
    await expect(page.locator("#quickdraw")).toBeHidden();
});

test("a quick draw in the beating colour lands for two hearts when the ring closes", async ({ page }) => {
    // The bot's colour starts as fire; water quenches fire. The player draws in the first second,
    // with the fake clock paused (clock.ts), so the quick window cannot slip by on a slow frame. The clash
    // plays on the stage's Web Animations timeline, which runs on real time, not the fake clock: animations off.
    await openPaused(page, "/?seed=smoke&stage=2d&arcade=quickdraw&animations=off");
    const qd = page.locator("#quickdraw");
    await page.locator("#quickdraw-start").click();
    await tickUntil(page, qd, "data-phase", "draw", 1_000);
    await expect(qd).toHaveAttribute("data-quick-window", "open");
    await page.locator('.quickdraw-pad[data-essence="water"]').click();
    await expect(qd).toHaveAttribute("data-essence-player", "water");
    await tickUntil(page, qd, "data-charge-player", "2", 500);
    await expect(page.locator("#quickdraw-orb-player")).toHaveClass(/quick/);
    await expect(page.locator("#stage-hand-player")).toHaveAttribute("opacity", "1");
    // The ring closes (3 s), the orbs fly, and the round is settled.
    await tickUntil(page, qd, "data-round", "2", 8_000);
    const opponentHearts = await page.locator("#quickdraw-hearts-opponent i.lit").count();
    const playerHearts = await page.locator("#quickdraw-hearts-player i.lit").count();
    expect(opponentHearts + playerHearts).toBeLessThan(10);
});

test("holding Charge grows the orb and a ward stands against a colour it is not beaten by", async ({ page }) => {
    await openPaused(page, "/?seed=smoke&stage=2d&arcade=quickdraw");
    const qd = page.locator("#quickdraw");
    await page.locator("#quickdraw-start").click();
    await tickUntil(page, qd, "data-phase", "draw", 1_000);
    await page.locator('.quickdraw-pad[data-essence="shadow"]').click();
    const charge = page.locator("#quickdraw-charge");
    const box = await charge.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // Two charge steps, a second each, held on the fake clock.
    await tickUntil(page, qd, "data-charge-player", "3", 2_600);
    await page.mouse.up();
    await tick(page, 50);
    await expect(qd).toHaveAttribute("data-charge-player", "3");
    // A ward replaces the draw and costs two Focus.
    await page.locator("#quickdraw-ward").click();
    await expect(qd).toHaveAttribute("data-essence-player", "ward");
    await expect(page.locator("#quickdraw-focus-player i.lit")).toHaveCount(5);
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("opacity", "1");
});

test("the Help section explains Quickdraw", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=quickdraw");
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help")).toContainText("Quickdraw");
    await expect(page.locator("#help")).toContainText("quick draw");
});
