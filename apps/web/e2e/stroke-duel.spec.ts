import { expect, test, type Page } from "@playwright/test";

const T0 = new Date("2026-01-01T00:00:00Z").getTime();

async function stroke(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 14
): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await page.mouse.move(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t
        );
    }
    await page.mouse.up();
}

test("dynamic stroke duel randomizes scenarios and advances automatically", async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0 + 10);
    await page.goto("/stroke-duel.html?seed=7");

    await expect(page.getByRole("heading", { name: "Rune Trace + Arcane Parry" })).toBeVisible();
    await expect(page.locator("#dynamic-mode")).toBeChecked();
    await expect(page.locator("#suggestions-mode")).toBeChecked();
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-dynamic", "true");
    await expect(page.locator("#stroke-arena")).toBeVisible();
    await expect(page.getByText("wide establishing view")).toBeVisible();

    await expect(page.locator("#spell-grid")).toContainText("PIERCE");
    await expect(page.locator("#spell-grid")).toContainText("REDIRECT");
    await expect(page.locator("#spell-grid")).toContainText("POWER");
    await expect(page.locator("#stroke-canvas")).toHaveAttribute("data-target", "line");
    await expect(page.locator('.spell-card[data-rune="line"]')).toHaveClass(/active/);

    // Seed 7 deterministically chooses PIERCE + EMBER LANCE for exchange 1.
    await expect(page.locator("#opponent-spell")).toHaveText("EMBER LANCE");
    await expect(page.locator("#opponent-behavior")).toContainText("AGGRESSIVE");
    await expect(page.locator("#opponent-danger")).toHaveText("16 DMG");
    await expect(page.locator("#suggestion")).toContainText("BLOCK");

    await page.locator("#stroke-canvas").scrollIntoViewIfNeeded();
    const box = await page.locator("#stroke-canvas").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await stroke(
        page,
        { x: box.x + box.width * 0.15, y: box.y + box.height * 0.5 },
        { x: box.x + box.width * 0.85, y: box.y + box.height * 0.5 }
    );

    await expect(page.locator("#stroke-result")).toContainText("PIERCE landed");
    await expect(page.locator("#recognized")).toContainText("PIERCE recognized");
    await expect(page.locator("#hp-enemy-label")).not.toHaveText("100");

    await page.clock.runFor(800);
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-phase", "parry");
    await expect(page.locator("#prompt")).toContainText("EMBER LANCE");
    await expect(page.locator("#surface-label")).toContainText("lane 44%");

    // EMBER LANCE launches after 240 ms and travels for 1500 ms.
    // At +990 ms from beginParry it is at the horizontal midpoint.
    await page.clock.runFor(990);
    await stroke(
        page,
        { x: box.x + box.width * 0.5, y: box.y + box.height * 0.16 },
        { x: box.x + box.width * 0.5, y: box.y + box.height * 0.72 }
    );

    await expect(page.locator("#stroke-result")).toContainText("BLOCK");
    await expect(page.locator("#effect")).toContainText("16 damage prevented");
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-phase", "round-over");
    await expect(page.getByRole("button", { name: "Next exchange" })).toBeHidden();

    // Dynamic mode advances without pressing Next.
    await page.clock.runFor(1300);
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-phase", "trace");
    await expect(page.locator("#round")).toHaveText("2");
    await expect(page.locator("#stroke-canvas")).toHaveAttribute("data-target", "triangle");
    await expect(page.locator("#opponent-spell")).toHaveText("HEX SHARD");

    // Manual and suggestion controls remain available.
    await page.locator("#dynamic-mode").uncheck();
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-dynamic", "false");
    await page.locator("#suggestions-mode").uncheck();
    await expect(page.locator("#suggestion")).toBeHidden();
});

test("help still explains gestures and dynamic behavior", async ({ page }) => {
    await page.goto("/stroke-duel.html?seed=7");
    await expect(page.locator("#help-card")).toContainText("Dynamic duel is ON by default");
    await expect(page.getByText("BLOCK", { exact: true })).toBeVisible();
    await expect(page.getByText("DEFLECT", { exact: true })).toBeVisible();
    await expect(page.getByText("REFLECT", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Hide help" }).click();
    await expect(page.locator("#help-card")).toBeHidden();
    await page.getByRole("button", { name: "Help" }).click();
    await expect(page.locator("#help-card")).toBeVisible();
});
