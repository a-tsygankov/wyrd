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
    await expect(page.locator("#enemy-intent")).toHaveClass(/show/, { timeout: 3_000 });
    await expect(page.locator("#arena")).toHaveAttribute("data-opponent-rune-visible", "true");
    await page.waitForTimeout(1_450);
    const box = await page.locator("#rune-canvas").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + 35, box.y + box.height * .65);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 35 + i * 20, box.y + box.height * .65);
    await page.mouse.up();
    await expect(page.locator("#recognized")).toHaveText("PIERCE");
    await expect(page.locator("#confidence")).toContainText("Confidence");
    await expect(page.locator("#quality")).toContainText("Execution");
    await expect(page.locator("#result")).toHaveClass(/show/);
});

test("parry starts a four-second hidden commit and reset restarts it", async ({ page }) => {
    await page.getByRole("button", { name: "RUNE PARRY" }).click();
    await expect(page.locator("#mode-title")).toHaveText("Simultaneous rune parry");
    await expect(page.locator("#enemy-intent")).toHaveText("ENEMY CAST HIDDEN");
    await expect(page.locator("#arena")).toHaveAttribute("data-opponent-rune-visible", "false");
    await expect(page.locator("#cast-label")).toHaveText("COMMIT BEFORE REVEAL");
    await expect(page.locator("#timer")).toHaveText(/^[34]\./);
    await page.getByRole("button", { name: "RESET" }).click();
    await expect(page.locator("#timer")).toHaveText(/^[34]\./);
});

test("speed setting, rune guide and combat log are inspectable", async ({ page }) => {
    await page.getByRole("button", { name: "Runes" }).click();
    await expect(page.locator("#rune-help")).toContainText("Pierce");
    await expect(page.locator("#rune-help")).toContainText("Absorb");
    await page.locator("#speed").selectOption("2");
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.locator("#combat-log")).toContainText("2×");
});

test("zero opponent HP produces victory and closes casting", async ({ page }) => {
    await page.evaluate(() => {
        const hp = document.querySelector("#hp-enemy") as HTMLElement;
        hp.style.width = "1%";
    });
    // Debug build exposes the real win condition through repeated successful combat;
    // use the deterministic test hook rather than relying on random enemy rune selection.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("rune-test-damage", { detail: { side: "enemy", amount: 100 } })));
    await expect(page.locator("#battle-state")).toHaveText("VICTORY");
    await expect(page.locator("#arena")).toHaveClass(/battle-ended/);
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.locator("#combat-log")).toContainText("VICTORY");
});
