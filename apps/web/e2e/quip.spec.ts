import { expect, test } from "@playwright/test";

// The opponent speaks after a round, in character, chosen by the seed.

test("a quip from the opponent's personality follows the verdict, and replays with the seed", async ({ page }) => {
    const cast = async (): Promise<void> => {
        const tray = page.locator("#glyph-tray");
        for (const glyph of ["FIRE", "SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
        await page.locator("#resolve-round").click();
    };
    await page.goto("/?seed=smoke&animations=off");
    await cast();
    const quip = page.locator("#combat-log .quip");
    await expect(quip).toHaveCount(1);
    const text = (await quip.textContent()) ?? "";
    expect(text).toMatch(/Adept|Aggressor|Warden|Trickster|Gatekeeper/);
    await page.goto("/?seed=smoke&animations=off");
    await cast();
    await expect(page.locator("#combat-log .quip")).toHaveText(text);
});
