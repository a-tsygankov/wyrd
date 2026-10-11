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

test("Rune Trace flows into a timed Arcane Parry", async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0 + 10);
    await page.goto("/stroke-duel.html");

    await expect(page.getByRole("heading", { name: "Rune Trace + Arcane Parry" })).toBeVisible();
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-phase", "trace");
    await expect(page.locator("#stroke-canvas")).toHaveAttribute("data-target", "line");

    const box = await page.locator("#stroke-canvas").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await stroke(
        page,
        { x: box.x + box.width * 0.15, y: box.y + box.height * 0.5 },
        { x: box.x + box.width * 0.85, y: box.y + box.height * 0.5 }
    );

    await expect(page.locator("#stroke-result")).toContainText("PIERCE landed");
    await expect(page.locator("#hp-enemy-label")).not.toHaveText("100");

    await page.clock.runFor(750);
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-phase", "parry");

    // The projectile launches 350 ms into the phase and takes 2.2 s to cross.
    // At +1.45 s it is at the midpoint; cross vertically through that point.
    await page.clock.runFor(1450);
    await stroke(
        page,
        { x: box.x + box.width * 0.5, y: box.y + box.height * 0.22 },
        { x: box.x + box.width * 0.5, y: box.y + box.height * 0.78 }
    );

    await expect(page.locator("#stroke-result")).toContainText("BLOCK");
    await expect(page.locator("#stroke-duel")).toHaveAttribute("data-phase", "round-over");
    await expect(page.getByRole("button", { name: "Next exchange" })).toBeVisible();
});
