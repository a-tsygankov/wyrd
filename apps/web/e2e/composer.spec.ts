import { expect, test } from "@playwright/test";

// The composer marks which glyph can come next, and the new modifiers
// (WEAKEN, SPLIT, REVERSE) resolve with their own log lines.

const glyph = (page: import("@playwright/test").Page, name: string) =>
    page.locator("#glyph-tray").getByRole("button", { name, exact: true });

test("the tray highlights what completes the spell and dims what cannot follow", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    await expect(glyph(page, "AMPLIFY")).toHaveAttribute("data-fit", "incompatible");
    await expect(glyph(page, "FIRE")).toHaveAttribute("data-fit", "open");
    await glyph(page, "FIRE").click();
    await expect(glyph(page, "WATER")).toHaveAttribute("data-fit", "incompatible");
    await expect(glyph(page, "SEEK")).toHaveAttribute("data-fit", "open");
    await expect(glyph(page, "CLOSE")).toHaveAttribute("data-fit", "incompatible");
    await glyph(page, "SEEK").click();
    await expect(glyph(page, "ENEMY")).toHaveAttribute("data-fit", "complete");
    await expect(glyph(page, "GATE")).toHaveAttribute("data-fit", "incompatible");
    // A dimmed glyph is still tappable, and the parser says why it fails.
    await glyph(page, "GATE").click();
    await expect(page.locator("#spell-diagnostic")).toContainText(/GATE/);
    await expect(page.locator("#resolve-round")).toBeDisabled();
    await page.locator("#undo-glyph").click();
    await glyph(page, "ENEMY").click();
    await expect(page.locator("#resolve-round")).toBeEnabled();
});

test("REVERSE turns OPEN into CLOSE and the log says so", async ({ page }) => {
    await page.goto("/?seed=smoke&animations=off");
    for (const name of ["GATE", "OPEN", "REVERSE"]) await glyph(page, name).click();
    await expect(page.locator("#spell-explain")).toContainText(/OPEN into CLOSE/);
    await expect(page.locator("#spell-explain .summary").first()).toContainText(/seal to you/i);
    await page.locator("#resolve-round").click();
    await expect(page.locator("#combat-log")).toContainText("REVERSE changed OPEN into CLOSE");
    await expect(page.locator("#player-seals")).toHaveText("1");
});

test("SPLIT explains its two branches and REFLECT's half answer", async ({ page }) => {
    await page.goto("/?seed=smoke&rules=teeth&animations=off");
    for (const name of ["FIRE", "SEEK", "ENEMY", "SPLIT"]) await glyph(page, name).click();
    await expect(page.locator("#spell-explain")).toContainText(/two branches/i);
    await expect(page.locator("#spell-explain")).toContainText(/REFLECT/);
    await page.locator("#glyph-help-toggle").click();
    await expect(page.locator("#glyph-help-list")).toContainText("SPLIT");
});
