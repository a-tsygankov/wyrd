import { expect, test } from "@playwright/test";

// Balance fix 4: a ward on the GATE. The owner's gate spells pass it.

test("GATE WARD claims the gate; the owner's CLOSE passes it next round", async ({ page }) => {
    // The quill seed keeps the REFLECT lesson second: round 2 leaves the gate alone.
    await page.goto("/?seed=quill&animations=off&admin=1");
    const tray = page.locator("#glyph-tray");
    const pick = async (glyphs: string[]) => {
        for (const glyph of glyphs) await tray.getByRole("button", { name: glyph, exact: true }).click();
    };
    await pick(["GATE", "WARD"]);
    await expect(page.locator("#spell-explain")).toContainText(/GATE/);
    await page.locator("#resolve-round").click();
    await expect(page.locator("#combat-log")).toContainText("A WARD stands on the GATE");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    await expect(page.locator("#stage-ward-gate")).toHaveAttribute("opacity", "1");
    await expect(page.locator("#admin-state")).toContainText("warded by player");
    await page.locator("#next-round").click();
    await pick(["GATE", "CLOSE"]);
    await expect(page.locator("#spell-explain .summary").first()).toContainText(/seal to you/i);
    await page.locator("#resolve-round").click();
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    await expect(page.locator("#stage-ward-gate")).toHaveAttribute("opacity", "1");
});

test("a filtered gate ward is refused before casting", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["GATE", "WARD", "FIRE"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await expect(page.locator("#spell-explain")).toContainText(/takes no essence/i);
    await expect(page.locator("#resolve-round")).toBeDisabled();
});
