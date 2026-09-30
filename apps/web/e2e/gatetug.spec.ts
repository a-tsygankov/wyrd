import { expect, test } from "@playwright/test";
import { openPaused, tick, tickUntil } from "./clock.js";

// Gate tug (docs/arcade-duel-ideas.md §1 D): the fourth arcade game, chosen in
// Settings → Game or with ?arcade=gatetug. Quickdraw's draw pushes the gate
// along a rail. `?tempo=slow` stretches the ring to nine seconds. The bot's
// draw depends on the seed and on what it reads, so these specs assert the
// wiring: the gate drawn where the state says, Ward's cost, the reset.

/** The SVG gate's shift for a rail position: five steps span 70 px (stage.ts live.gate). */
const shift = (gate: number): string => `translate(${(gate / 5) * 70}px, 0px)`;

test("?arcade=gatetug shows Gate tug waiting on Start; Start opens the ring with the gate in the middle", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=gatetug");
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "gatetug");
    const tug = page.locator("#gatetug");
    await expect(tug).toBeVisible();
    await expect(tug).toHaveAttribute("data-phase", "ready");
    await expect(page.locator("#gatetug-rail i")).toHaveCount(11);
    await page.locator("#gatetug-start").click();
    await expect(tug).toHaveAttribute("data-phase", "draw", { timeout: 5_000 });
    await expect(tug).toHaveAttribute("data-gate", "0");
    await expect(page.locator("#gatetug-round")).toContainText("round 1 of 15");
});

test("after a clash the stage's gate stands where the rail says, tinted with the temper that moved it", async ({ page }) => {
    // On the fake clock (clock.ts): the ring and the clash animation run in game time, not real seconds.
    await openPaused(page, "/?seed=smoke&stage=2d&arcade=gatetug");
    const tug = page.locator("#gatetug");
    await page.locator("#gatetug-start").click();
    await tickUntil(page, tug, "data-phase", "draw", 1_000);
    await page.locator('.gatetug-pad[data-essence="fire"]').click();
    await expect(tug).toHaveAttribute("data-essence-player", "fire");
    await tick(page, 50);
    await expect(page.locator("#stage-hand-player")).toHaveAttribute("opacity", "1");
    // The ring closes (3 s), the orbs fly, the gate settles and round 2 opens.
    await tickUntil(page, tug, "data-round", "2", 8_000);
    const gate = Number(await tug.getAttribute("data-gate"));
    expect(await page.locator("#stage-gate").evaluate(el => (el as SVGGElement).style.transform)).toContain(shift(gate));
    const temper = await tug.getAttribute("data-temper");
    expect(await page.locator("#stage-gate").getAttribute("data-temper")).toBe(temper);
    if (gate !== 0) expect(temper).not.toBe("");
});

test("Ward replaces the draw and costs two Focus", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=gatetug&tempo=slow");
    const tug = page.locator("#gatetug");
    await page.locator("#gatetug-start").click();
    await expect(tug).toHaveAttribute("data-phase", "draw", { timeout: 5_000 });
    await page.locator("#gatetug-ward").click();
    await expect(tug).toHaveAttribute("data-essence-player", "ward");
    await expect(tug).toHaveAttribute("data-focus-player", "5");
    await expect(page.locator("#stage-ward-player")).toHaveAttribute("opacity", "1");
});

test("Settings offers Gate tug; Reset returns it to Start, and another game gets the gate back in the middle", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await page.locator("#settings-toggle").click();
    await page.locator("#settings-arcade-gatetug").check();
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "gatetug");
    await expect(page.locator(".topbar h1")).toHaveText("Push the gate home. Mind its temper.");
    await page.locator("#settings-close").click();
    await page.locator("#gatetug-start").click();
    await expect(page.locator("#gatetug")).toHaveAttribute("data-phase", "draw", { timeout: 5_000 });
    await page.locator("#reset-match").click();
    await expect(page.locator("#gatetug")).toHaveAttribute("data-phase", "ready");
    await page.locator("#settings-toggle").click();
    await page.locator("#settings-game-arcade").check();
    await expect(page.locator("#volley")).toBeVisible();
    expect(await page.locator("#stage-gate").evaluate(el => (el as SVGGElement).style.transform)).toContain(shift(0));
});

test("the Help section explains Gate tug", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=gatetug");
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help-rules")).toContainText("Gate tug");
    await expect(page.locator("#help-arcade")).toContainText("Temper");
});
