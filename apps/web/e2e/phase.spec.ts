import { expect, test } from "@playwright/test";

// Layout A: the phase strip under the pinned stage follows the round, and
// the 3D arena's camera follows the phase.

test("the phase strip advances read → react → shape → cast → verdict as the player acts", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    const active = page.locator("#phase-strip li.active");
    await expect(active).toHaveText("Read");
    await expect(page.locator("body")).toHaveAttribute("data-phase", "read");
    await page.locator('#reaction-tray [data-reaction="reflect"]').click();
    await expect(active).toHaveText("React");
    const tray = page.locator("#glyph-tray");
    await tray.getByRole("button", { name: "FIRE", exact: true }).click();
    await expect(active).toHaveText("Shape");
    await expect(page.locator(".composer.card")).toHaveClass(/phase-target/);
    for (const glyph of ["SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await expect(active).toHaveText("Cast");
    await page.locator("#resolve-round").click();
    await expect(active).toHaveText("Verdict", { timeout: 10_000 });
    await expect(page.locator(".log.card")).toHaveClass(/phase-target/);
    // A tap on a phase scrolls its card into view.
    await page.locator("#phase-strip button", { hasText: "Read" }).click();
    await expect(page.locator(".opponent.card")).toBeInViewport();
});

test("the arena's camera follows the phase", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit has no WebGL in CI");
    await page.goto("/?seed=smoke&stage=3d&animations=off");
    const arena = page.locator("#arena");
    await expect(arena).toHaveAttribute("data-renderer", "3d", { timeout: 20_000 });
    await expect(arena).toHaveAttribute("data-camera", "read");
    await page.locator("#glyph-tray").getByRole("button", { name: "GATE", exact: true }).click();
    await expect(arena).toHaveAttribute("data-camera", "shape");
    await page.locator("#glyph-tray").getByRole("button", { name: "CLOSE", exact: true }).click();
    await expect(arena).toHaveAttribute("data-camera", "cast");
    await page.locator("#resolve-round").click();
    await expect(arena).toHaveAttribute("data-camera", "verdict", { timeout: 15_000 });
});
