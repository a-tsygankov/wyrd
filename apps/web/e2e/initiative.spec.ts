import { expect, test } from "@playwright/test";

// Balance fix 3: initiative by Focus and the contested gate.

test("the cheaper spell resolves first and the verdict says so", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    // Round 1: the opponent's FIRE SEEK ENEMY costs 3; SEEK ENEMY costs 2 and goes first.
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#combat-log .reason").first()).toContainText(/resolved first/);
    await expect(page.locator("#combat-log .reason").first()).toContainText(/2 Focus/);
    // The log itself is in resolution order: the player's spell heads it.
    await expect(page.locator("#combat-log li:not(.verdict):not(.reason):not(.quip)").first()).toContainText(/^You:/);
});

test("two gate spells in one hot-seat round leave the gate where it was", async ({ page }) => {
    await page.goto("/?mode=hotseat&seed=smoke&animations=off");
    const tray = page.locator("#glyph-tray");
    const primary = page.locator("#resolve-round");
    const pick = async (glyphs: string[]) => {
        for (const glyph of glyphs) await tray.getByRole("button", { name: glyph, exact: true }).click();
    };
    await pick(["GATE", "CLOSE"]);
    await primary.click();
    await page.locator("#handoff-ready").click();
    await pick(["GATE", "CLOSE"]);
    await primary.click();
    await page.locator("#handoff-ready").click();
    await primary.click();
    await expect(page.locator("#combat-log")).toContainText("shudders and holds");
    await expect(page.locator("#player-seals")).toHaveText("0");
    await expect(page.locator("#opponent-seals")).toHaveText("0");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    await expect(page.locator("#stage-gate")).not.toHaveClass(/closed/);
});
