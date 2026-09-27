import { expect, test } from "@playwright/test";

// The Three.js arena behind the "3D arena" setting: mounts with WebGL, plays
// the same beats to the same timings, and yields to the flat stage when off.

test("the 3D arena mounts, plays a round and can be switched back", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit has no WebGL in CI");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/?seed=smoke&stage=3d&animations=off");
    const arena = page.locator("#arena");
    await expect(arena).toBeVisible();
    await expect(arena.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-renderer", "3d", { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-fx", "full");
    await expect(page.locator("#stage")).toBeHidden();

    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 15_000 });
    await expect(page.locator("#combat-log")).toContainText("SEEK reached");

    // Off again: the flat stage returns without a reload.
    await page.locator("#settings-toggle").click();
    await page.locator("#settings-arena3d").uncheck();
    await expect(page.locator("#stage")).toBeVisible();
    await expect(arena).toBeHidden();
    expect(errors, errors.join("\n")).toEqual([]);
});

test("?fx=light mounts the arena without the post-processing chain and the switch rebuilds it", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit has no WebGL in CI");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/?seed=smoke&stage=3d&fx=light&animations=off");
    const arena = page.locator("#arena");
    await expect(arena).toHaveAttribute("data-renderer", "3d", { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-fx", "light");
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-arena-fx")).not.toBeChecked();
    await page.locator("#settings-arena-fx").check();
    await expect(arena).toHaveAttribute("data-fx", "full", { timeout: 20_000 });
    await expect(arena.locator("canvas")).toHaveCount(1);
    expect(errors, errors.join("\n")).toEqual([]);
});

test("with ?stage=2d the flat stage renders and no 3D module is fetched", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", request => requests.push(request.url()));
    await page.goto("/?seed=smoke&stage=2d&animations=off");
    await expect(page.locator("#stage")).toBeVisible();
    await expect(page.locator("#arena")).toBeHidden();
    expect(requests.some(url => url.includes("/vendor/three/") || url.includes("/assets/arena/"))).toBe(false);
});
