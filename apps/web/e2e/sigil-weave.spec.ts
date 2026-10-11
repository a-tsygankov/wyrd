import { expect, test } from "@playwright/test";

test("Sigil Weave teaches and completes Aegis Spiral step by step", async ({ page }) => {
    await page.goto("/sigil-weave.html?seed=7&parry=off");

    await expect(page.getByRole("heading", { name: "Sigil Weave" })).toBeVisible();
    await expect(page.locator("#sigil-arena")).toBeVisible();
    await expect(page.getByText("six-anchor field")).toBeVisible();
    await expect(page.locator("#parry-toggle")).not.toBeChecked();

    await expect(page.locator("#recipe-title")).toHaveText("AEGIS SPIRAL");
    await expect(page.locator("#weave-steps")).toContainText("WARD → anchor 1");
    await expect(page.locator("#instruction")).toContainText("WARD");
    await expect(page.locator('[data-anchor="0"]')).toHaveClass(/next/);

    await page.locator('[data-anchor="0"]').click();
    await expect(page.locator("#weave-result")).toContainText("Layer locked");
    await expect(page.locator("#weave-steps li.done")).toHaveCount(1);
    await expect(page.locator("#instruction")).toContainText("REDIRECT");
    await expect(page.locator('[data-rune="arc"]')).toHaveClass(/active/);

    await page.locator('[data-anchor="2"]').click();
    await expect(page.locator("#weave-steps li.done")).toHaveCount(2);
    await expect(page.locator("#instruction")).toContainText("POWER");

    await page.locator('[data-anchor="4"]').click();
    await expect(page.locator("#weave-status")).toHaveText("READY");
    await expect(page.getByRole("button", { name: "Release sigil" })).toBeEnabled();

    await page.getByRole("button", { name: "Release sigil" }).click();
    await expect(page.locator("#sigil-weave")).toHaveAttribute("data-phase", "released");
    await expect(page.locator("#weave-result")).toContainText("AEGIS SPIRAL released");
});

test("Sigil Weave exposes multiple guided gameplays and Free Weave", async ({ page }) => {
    await page.goto("/sigil-weave.html?parry=off");

    await page.getByRole("button", { name: /BREACH KNOT/ }).click();
    await expect(page.locator("#recipe-title")).toHaveText("BREACH KNOT");
    await expect(page.locator("#weave-steps")).toContainText("PIERCE → anchor 6");

    await page.getByRole("button", { name: /MIRROR CROWN/ }).click();
    await expect(page.locator("#recipe-title")).toHaveText("MIRROR CROWN");
    await expect(page.locator("#weave-steps li")).toHaveCount(4);
    await expect(page.locator("#weave-steps")).toContainText("ABSORB → anchor 3");

    await page.getByRole("button", { name: /FREE WEAVE/ }).click();
    await expect(page.locator("#recipe-title")).toHaveText("FREE WEAVE");
    await expect(page.locator("#weave-steps")).toContainText("Place at least 3 runes");
});

test("Arcade Parry is optional and interrupts the weave when enabled", async ({ page }) => {
    await page.goto("/sigil-weave.html?seed=7");

    await expect(page.locator("#parry-toggle")).toBeChecked();
    await page.locator('[data-anchor="0"]').click();
    await page.locator('[data-anchor="2"]').click();

    await expect(page.locator("#sigil-weave")).toHaveAttribute("data-phase", "parry");
    await expect(page.locator("#parry-panel")).toBeVisible();
    await expect(page.locator("#parry-spell")).not.toHaveText("Incoming spell");
    await expect(page.locator("#parry-hint")).toContainText("successful parry");

    await page.reload();
    await page.locator("#parry-toggle").uncheck();
    await page.locator('[data-anchor="0"]').click();
    await page.locator('[data-anchor="2"]').click();
    await expect(page.locator("#sigil-weave")).toHaveAttribute("data-phase", "weave");
    await expect(page.locator("#parry-panel")).toBeHidden();
});

test("instructions can be hidden and restored", async ({ page }) => {
    await page.goto("/sigil-weave.html?parry=off");
    await expect(page.locator("#help-card")).toContainText("Why this is different from Rune Trace");
    await page.getByRole("button", { name: "Hide instructions" }).click();
    await expect(page.locator("#help-card")).toBeHidden();
    await page.getByRole("button", { name: "Instructions" }).click();
    await expect(page.locator("#help-card")).toBeVisible();
});
