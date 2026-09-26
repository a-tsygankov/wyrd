import { expect, test } from "@playwright/test";

// Runs against E2E_BASE_URL (a Pages preview in CI, the production site by
// default) on WebKit-as-iPhone and Chromium-as-Pixel: the two platforms the
// product ships on. Read-only apart from the duel it plays client-side.

test("the duel board loads with its version footer", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Wyrd Duel POC");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#version-line")).toContainText(/web v\d+\.\d+\.\d+/);
});

test("a spell can be cast and scores a seal", async ({ page }) => {
    await page.goto("/");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) {
        await tray.getByRole("button", { name: glyph, exact: true }).click();
    }
    await expect(page.locator("#spell-preview")).toContainText("FIRE → SEEK → ENEMY");
    const cast = page.locator("#resolve-round");
    await expect(cast).toBeEnabled();
    await cast.click();
    // The round resolves both spells; the player's SEEK always lands
    // against the round-1 opponent script, so one seal is deterministic.
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#combat-log li")).not.toHaveCount(1);
    await expect(page.locator("#next-round")).toBeVisible();
});

test("the service worker installs and the shell reloads offline", async ({ page, context, browserName }) => {
    await page.goto("/");
    const state = await page.evaluate(() =>
        "serviceWorker" in navigator
            ? Promise.race([
                  navigator.serviceWorker.ready.then(() => "ready"),
                  new Promise<string>(resolve => setTimeout(() => resolve("timeout"), 8000))
              ])
            : "unsupported"
    );
    expect(state).toBe("ready");
    // Playwright's offline emulation is Chromium-only; WebKit stops at
    // "the worker installed", which is still the iOS-relevant half.
    test.skip(browserName !== "chromium", "offline emulation needs Chromium");
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.setOffline(false);
});
