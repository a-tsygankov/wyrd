import { expect, test } from "@playwright/test";

// The installed app checks version.json (never cached by the service worker)
// against the version stamped into the page: on load, when it comes back to
// the foreground, and on a timer. A newer served version shows a banner with
// Reload; the same version shows nothing. Routes fake the newer deploy.

const NEWER = JSON.stringify({ web: "999.0.0" });

// Once the service worker claims the page, WebKit's route() no longer sees
// its fetches. The worker's bypass for version.json is guarded in
// test/build_web.test.mjs; here the client's check is what is under test.
test.use({ serviceWorkers: "block" });

test("the same served version shows no update banner", async ({ page }) => {
    const checked = page.waitForRequest(req => new URL(req.url()).pathname === "/version.json");
    await page.goto("/?seed=smoke&stage=2d");
    await checked;
    await page.waitForTimeout(500);
    await expect(page.locator("#update-banner")).toBeHidden();
});

test("a newer served version shows the banner, and Reload loads the page again", async ({ page }) => {
    await page.route("**/version.json", route => route.fulfill({ contentType: "application/json", body: NEWER }));
    await page.goto("/?seed=smoke&stage=2d");
    const banner = page.locator("#update-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("999.0.0");
    await page.evaluate(() => ((window as unknown as { beforeReload: boolean }).beforeReload = true));
    await page.unroute("**/version.json");
    await Promise.all([page.waitForEvent("load"), page.locator("#update-reload").click()]);
    expect(await page.evaluate(() => (window as unknown as { beforeReload?: boolean }).beforeReload)).toBeUndefined();
    await expect(page.locator("#update-banner")).toBeHidden();
});

test("coming back to the foreground checks again, and Later hides the banner", async ({ page }) => {
    await page.goto("/?seed=smoke&stage=2d");
    await page.waitForTimeout(500);
    await expect(page.locator("#update-banner")).toBeHidden();
    await page.route("**/version.json", route => route.fulfill({ contentType: "application/json", body: NEWER }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator("#update-banner")).toBeVisible();
    await page.locator("#update-dismiss").click();
    await expect(page.locator("#update-banner")).toBeHidden();
});
