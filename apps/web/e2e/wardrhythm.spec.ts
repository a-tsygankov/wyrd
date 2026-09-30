import { expect, test, type Page } from "@playwright/test";
import { openPaused, tickUntil } from "./clock.js";

// Ward rhythm (docs/arcade-duel-ideas.md §1 E): the fifth arcade game, chosen
// in Settings → Game or with ?arcade=wardrhythm. The rhythm specs run on the
// fake clock (clock.ts): time stands still while the spec reads the due bolt
// (data-next) and answers, then advances to the next window. They used to
// wait out the beat in real time at ?tempo=slow (24 s a device for a volley).

const BEATER: Record<string, string> = { fire: "water", life: "fire", shadow: "life", water: "shadow" };

/** Press a pad the way a thumb does: pads answer on pointerdown. */
async function pad(page: Page, essence: string): Promise<void> {
    await page.locator(`.wr-pad[data-essence="${essence}"]`).dispatchEvent("pointerdown");
}

/** Answer every bolt of the current volley with the colour that beats it, stepping the clock to each window. */
async function blockVolley(page: Page): Promise<void> {
    const wr = page.locator("#wardrhythm");
    // data-next is the next unanswered bolt's colour, empty once the volley is answered (the phase moves a frame later).
    while ((await wr.getAttribute("data-next")) !== "") {
        await tickUntil(page, wr, "data-window", "open", 5_000);
        const next = await wr.getAttribute("data-next");
        if (next) await pad(page, BEATER[next]!);
        await tickUntil(page, wr, "data-window", "closed", 2_000);
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
    await openPaused(page, "/?seed=smoke&stage=2d&arcade=wardrhythm");
    const wr = page.locator("#wardrhythm");
    await page.locator("#wr-start").click();
    await tickUntil(page, wr, "data-window", "open", 5_000);
    const next = (await wr.getAttribute("data-next"))!;
    await pad(page, BEATER[next]!);
    await expect(page.locator("#wr-caption")).toContainText("Blocked");
    await expect(wr).toHaveAttribute("data-hearts-player", "5");
    // Leave the next bolt alone: it lands and costs a heart.
    await tickUntil(page, wr, "data-hearts-player", "4", 3_000);
});

test("after a clean volley you throw at their ward, and the match moves to the second volley", async ({ page }) => {
    await openPaused(page, "/?seed=smoke&stage=2d&arcade=wardrhythm");
    const wr = page.locator("#wardrhythm");
    await page.locator("#wr-start").click();
    await tickUntil(page, wr, "data-phase", "defend", 1_000);
    await blockVolley(page);
    await tickUntil(page, wr, "data-phase", "attack", 3_000);
    await expect(wr).toHaveAttribute("data-hearts-player", "5");
    const theirs = (await wr.getAttribute("data-ward"))!;
    await expect(page.locator("#wr-ward")).toContainText(theirs.toUpperCase());
    await expect(page.locator("#stage-ward-opponent")).toHaveAttribute("opacity", "1");
    await pad(page, BEATER[theirs]!);
    await expect(page.locator("#wr-caption")).toContainText("You throw");
    await tickUntil(page, wr, "data-exchange", "2", 4_000);
    await tickUntil(page, wr, "data-phase", "defend", 2_000);
    await expect(page.locator("#wr-round")).toContainText("volley 2 of 5");
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
