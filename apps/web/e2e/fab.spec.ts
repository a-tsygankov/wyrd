import { expect, test } from "@playwright/test";

// The floating next-round action: hidden while a round is open, visible top
// right once it resolves, and a rematch once the duel is decided.

test("the floating Next round button appears after a round and advances it", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    const fab = page.locator("#next-round-fab");
    await expect(fab).toBeHidden();
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(fab).toBeVisible();
    await expect(fab).toHaveText(/Next round/);
    const box = await fab.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x + box!.width).toBeGreaterThan(viewport.width * 0.6);
    expect(box!.y + box!.height).toBeGreaterThan(viewport.height * 0.75, "bottom right, clear of the pinned stage");
    await fab.click();
    await expect(page.locator("#round-number")).toHaveText("2");
    await expect(fab).toBeHidden();
});
