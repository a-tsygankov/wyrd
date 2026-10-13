import { expect, test } from "@playwright/test";

test("POC launcher lists every gameplay prototype with an illustration and play link", async ({ page }) => {
    await page.goto("/pocs.html");

    await expect(page.getByRole("heading", { name: "Choose a Wyrd POC." })).toBeVisible();
    const cards = page.locator("article.poc");
    await expect(cards).toHaveCount(10);

    for (const title of [
        "Word Duel",
        "Rune Fencing",
        "Rune Parry",
        "Volley",
        "Quickdraw",
        "Beam Clash",
        "Gate Tug",
        "Ward Rhythm",
        "Rune Trace + Arcane Parry",
        "Sigil Weave"
    ]) {
        const heading = page.getByRole("heading", { name: title, exact: true });
        await expect(heading).toBeVisible();
        const card = heading.locator("xpath=ancestor::article[contains(concat(' ', normalize-space(@class), ' '), ' poc ')]");
        await expect(card.locator("svg")).toHaveCount(1);
        await expect(card.getByRole("link", { name: /Play/ }).first()).toBeVisible();
    }

    await expect(page.getByRole("link", { name: "Play Volley →" })).toHaveAttribute("href", "./?game=arcade&arcade=volley");
    await expect(page.getByRole("link", { name: "Play Quickdraw →" })).toHaveAttribute("href", "./?game=arcade&arcade=quickdraw");
    await expect(page.getByRole("link", { name: "Play Beam Clash →" })).toHaveAttribute("href", "./?game=arcade&arcade=beam");
    await expect(page.getByRole("link", { name: "Play Gate Tug →" })).toHaveAttribute("href", "./?game=arcade&arcade=gatetug");
    await expect(page.getByRole("link", { name: "Play Ward Rhythm →" })).toHaveAttribute("href", "./?game=arcade&arcade=wardrhythm");
});

test("Rune Lab launcher links open the requested mode directly", async ({ page }) => {
    await page.goto("/rune-lab.html?mode=parry");
    await expect(page.locator(".tab[data-mode='parry']")).toHaveClass(/active/);
    await expect(page.locator("#mode-title")).toContainText("Simultaneous rune parry");

    await page.goto("/rune-lab.html?mode=fencing");
    await expect(page.locator(".tab[data-mode='fencing']")).toHaveClass(/active/);
    await expect(page.locator("#mode-title")).toContainText("Real-time spell fencing");
});
