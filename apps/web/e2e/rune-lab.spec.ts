import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.goto("/rune-lab.html");
    await expect(page.getByText("WYRD · RUNE LAB")).toBeVisible();
});

test("switches and persists all arena views", async ({ page }) => {
    await page.getByRole("button", { name: "View" }).click();
    for (const view of ["Side", "Top", "Abstract", "Behind"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await expect(page.locator("#arena")).toHaveAttribute("data-camera", view.toLowerCase());
    }
    await page.getByRole("button", { name: "Top", exact: true }).click();
    await page.reload();
    await expect(page.locator("#arena")).toHaveAttribute("data-camera", "top");
});

test("fencing accepts a drawn line and resolves combat feedback", async ({ page }) => {
    await expect(page.locator("#enemy-intent")).toHaveClass(/show/, { timeout: 3_000 });\n    await expect(page.locator("#arena")).toHaveAttribute("data-opponent-rune-visible", "true");
    await page.waitForTimeout(1_450);
    const box = await page.locator("#rune-canvas").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + 35, box.y + box.height * .65);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 35 + i * 20, box.y + box.height * .65);
    await page.mouse.up();
    await expect(page.locator("#recognized")).toHaveText("PIERCE");
    await expect(page.locator("#quality")).toContainText("%");
    await expect(page.locator("#result")).toHaveClass(/show/);
});

test("parry starts a four-second hidden commit and reset restarts it", async ({ page }) => {
    await page.getByRole("button", { name: "RUNE PARRY" }).click();
    await expect(page.locator("#mode-title")).toHaveText("Simultaneous rune parry");
    await expect(page.locator("#enemy-intent")).toHaveText("ENEMY CAST HIDDEN");\n    await expect(page.locator("#arena")).toHaveAttribute("data-opponent-rune-visible", "false");
    await expect(page.locator("#cast-label")).toHaveText("COMMIT BEFORE REVEAL");
    await expect(page.locator("#timer")).toHaveText(/^[34]\./);
    await page.getByRole("button", { name: "RESET" }).click();
    await expect(page.locator("#timer")).toHaveText(/^[34]\./);
});
