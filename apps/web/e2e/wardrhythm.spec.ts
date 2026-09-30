import { expect, test, type Page } from "@playwright/test";

// Ward rhythm (docs/arcade-duel-ideas.md §1 E): the fifth arcade game, chosen
// in Settings → Game or with ?arcade=wardrhythm. `?tempo=slow` stretches the
// beat threefold so the runner can read the due bolt (data-next) and answer
// inside its window.

const BEATER: Record<string, string> = { fire: "water", life: "fire", shadow: "life", water: "shadow" };

/** Press a pad the way a thumb does: pads answer on pointerdown. */
async function pad(page: Page, essence: string): Promise<void> {
    await page.locator(`.wr-pad[data-essence="${essence}"]`).dispatchEvent("pointerdown");
}

/** Answer every bolt of the current volley with the colour that beats it. */
async function blockVolley(page: Page): Promise<void> {
    const wr = page.locator("#wardrhythm");
    while ((await wr.getAttribute("data-phase")) === "defend") {
        await expect(wr).toHaveAttribute("data-window", "open", { timeout: 10_000 }).catch(() => undefined);
        if ((await wr.getAttribute("data-phase")) !== "defend") break;
        const next = await wr.getAttribute("data-next");
        if (next) await pad(page, BEATER[next]!);
        await expect(wr).toHaveAttribute("data-window", "closed", { timeout: 5_000 });
    }
}

test("?arcade=wardrhythm shows Ward rhythm waiting on Start; Start sends the first volley down the lane", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=wardrhythm");
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "wardrhythm");
    const wr = page.locator("#wardrhythm");
    await expect(wr).toBeVisible();
    await expect(wr).toHaveAttribute("data-phase", "ready");
    await page.locator("#wr-start").click();
    await expect(wr).toHaveAttribute("data-phase", "defend");
    await expect(page.locator("#wr-round")).toContainText("volley 1 of 5");
    await expect(page.locator("#wr-lane i:not(.hidden)").first()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("#stage-bolt")).toHaveAttribute("opacity", "1", { timeout: 3_000 });
});

test("the colour that beats the due bolt blocks it; letting one land costs a heart", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=wardrhythm&tempo=slow");
    const wr = page.locator("#wardrhythm");
    await page.locator("#wr-start").click();
    await expect(wr).toHaveAttribute("data-window", "open", { timeout: 15_000 });
    const next = (await wr.getAttribute("data-next"))!;
    await pad(page, BEATER[next]!);
    await expect(page.locator("#wr-caption")).toContainText("Blocked");
    await expect(wr).toHaveAttribute("data-hearts-player", "5");
    // Leave the next bolt alone: it lands and costs a heart.
    await expect(wr).toHaveAttribute("data-hearts-player", "4", { timeout: 15_000 });
});

test("after a clean volley you throw at their ward, and the match moves to the second volley", async ({ page }) => {
    test.slow();
    await page.goto("/?seed=smoke&stage=2d&arcade=wardrhythm&tempo=slow");
    const wr = page.locator("#wardrhythm");
    await page.locator("#wr-start").click();
    await expect(wr).toHaveAttribute("data-phase", "defend");
    await blockVolley(page);
    await expect(wr).toHaveAttribute("data-phase", "attack", { timeout: 10_000 });
    await expect(wr).toHaveAttribute("data-hearts-player", "5");
    const theirs = (await wr.getAttribute("data-ward"))!;
    await expect(page.locator("#wr-ward")).toContainText(theirs.toUpperCase());
    await expect(page.locator("#stage-ward-opponent")).toHaveAttribute("opacity", "1");
    await pad(page, BEATER[theirs]!);
    await expect(page.locator("#wr-caption")).toContainText("You throw");
    await expect(wr).toHaveAttribute("data-exchange", "2", { timeout: 15_000 });
    await expect(page.locator("#wr-round")).toContainText("volley 2 of 5", { timeout: 10_000 });
});

test("Settings offers Ward rhythm, and Reset returns it to Start", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await page.locator("#settings-toggle").click();
    await page.locator("#settings-arcade-wardrhythm").check();
    await expect(page.locator("body")).toHaveAttribute("data-arcade", "wardrhythm");
    await expect(page.locator(".topbar h1")).toHaveText("Ward on the beat. Throw it back.");
    await page.locator("#settings-close").click();
    await page.locator("#wr-start").click();
    await expect(page.locator("#wardrhythm")).toHaveAttribute("data-phase", "defend");
    await page.locator("#reset-match").click();
    await expect(page.locator("#wardrhythm")).toHaveAttribute("data-phase", "ready");
});

test("the Help section explains Ward rhythm", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=wardrhythm");
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help-rules")).toContainText("Ward rhythm");
    await expect(page.locator("#help-arcade")).toContainText("Absorb");
});
