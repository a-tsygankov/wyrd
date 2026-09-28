import { expect, test } from "@playwright/test";

// The arcade games wait for the player: nothing flies until Start is pressed,
// and Reset returns to that ready state. The fullscreen toggle lives in the
// stage corner and only shows in the arcade; it always applies the immersive
// layout (body[data-fullscreen]) and asks for real fullscreen where the
// browser has the API (Safari on iPhone does not).

test("Volley waits on Start: no serve until pressed, then the bolt flies", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    const volley = page.locator("#volley");
    await expect(volley).toHaveAttribute("data-phase", "ready");
    await expect(page.locator("#volley-start")).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(volley).toHaveAttribute("data-phase", "ready");
    await expect(page.locator("#volley-hearts-player i.lit")).toHaveCount(5);
    await page.locator("#volley-start").click();
    await expect(page.locator("#volley-start")).toBeHidden();
    await expect(volley).toHaveAttribute("data-phase", "flight", { timeout: 5_000 });
});

test("Reset puts Volley back on the Start button", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    const volley = page.locator("#volley");
    await page.locator("#volley-start").click();
    await expect(volley).toHaveAttribute("data-phase", "flight", { timeout: 5_000 });
    await page.locator("#reset-match").click();
    await expect(volley).toHaveAttribute("data-phase", "ready");
    await expect(page.locator("#volley-start")).toBeVisible();
});

test("Quickdraw waits on Start: the ring opens only when pressed", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d&arcade=quickdraw");
    const qd = page.locator("#quickdraw");
    await expect(qd).toHaveAttribute("data-phase", "ready");
    await page.waitForTimeout(1_500);
    await expect(qd).toHaveAttribute("data-phase", "ready");
    await page.locator("#quickdraw-start").click();
    await expect(page.locator("#quickdraw-start")).toBeHidden();
    await expect(qd).toHaveAttribute("data-phase", "draw", { timeout: 5_000 });
});

test("the fullscreen toggle shows in the arcade, turns the immersive layout on and off, and hides in the word duel", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    const toggle = page.locator("#fullscreen-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(page.locator("body")).toHaveAttribute("data-fullscreen", "1");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator("#volley-start")).toBeVisible();
    await toggle.click();
    await expect(page.locator("body")).not.toHaveAttribute("data-fullscreen", "1");
    await expect(page.locator(".topbar")).toBeVisible();
    await page.goto("/?seed=smoke&stage=2d&game=word");
    await expect(toggle).toBeHidden();
});
