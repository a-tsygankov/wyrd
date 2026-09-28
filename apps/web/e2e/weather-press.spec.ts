import { expect, test } from "@playwright/test";

// Weather rounds (options doc §H) and press the round (ideas doc §J): both
// behind Settings → Rules, off by default, with URL switches for a visit.

const WEATHERS = ["storm", "hush", "ironbound", "opensky"];

test("the playtest options are off by default and the switches sit in the Rules group", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&stage=2d&animations=off");
    await expect(page.locator("#weather-banner")).toBeHidden();
    await expect(page.locator("#stakes")).toBeHidden();
    await page.locator("#settings-toggle").click();
    for (const id of ["settings-weather", "settings-sudden", "settings-press"]) await expect(page.locator(`#${id}`)).not.toBeChecked();
    // Press on: the stake row appears above Cast without a reset.
    await page.locator("#settings-press").check();
    await expect(page.locator("#stakes")).toBeVisible();
    await expect(page.locator("#press-round")).toHaveAttribute("aria-pressed", "false");
});

test("a hot-seat match announces round 3's weather in round 2 and plays it in round 3", async ({ page }) => {
    await page.goto("/?game=word&mode=hotseat&seed=smoke&weather=on&stage=2d&animations=off");
    const banner = page.locator("#weather-banner");
    await expect(banner).toBeHidden();
    const tray = page.locator("#glyph-tray");
    const primary = page.locator("#resolve-round");
    const playRound = async (p2: string[], p1: string[]) => {
        for (const glyph of p2) await tray.getByRole("button", { name: glyph, exact: true }).click();
        await primary.click();
        await page.locator("#handoff-ready").click();
        for (const glyph of p1) await tray.getByRole("button", { name: glyph, exact: true }).click();
        await primary.click();
        await page.locator("#handoff-ready").click();
        await primary.click();
        await expect(page.locator("#stage")).not.toHaveAttribute("data-playing", "1", { timeout: 10_000 });
    };
    // Round 1: nothing to announce. Wards keep the seals at zero so the match runs on.
    await playRound(["SELF", "WARD"], ["SELF", "WARD"]);
    await page.locator("#next-round").click();
    // Round 2 announces round 3's card.
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/upcoming/);
    await expect(banner).toContainText("Next round:");
    const announced = await banner.getAttribute("data-weather");
    expect(WEATHERS).toContain(announced);
    await playRound(["SELF", "MEND"], ["SELF", "MEND"]);
    await page.locator("#next-round").click();
    // Round 3: the announced card is in force.
    await expect(banner).toBeVisible();
    await expect(banner).not.toHaveClass(/upcoming/);
    await expect(banner).toHaveAttribute("data-weather", announced!);
    await expect(banner).not.toContainText("Next round:");
});

test("pressing the round doubles the seal you win it by", async ({ page }) => {
    await page.goto("/?game=word&seed=smoke&press=on&stage=2d&animations=off");
    const press = page.locator("#press-round");
    await expect(page.locator("#stakes")).toBeVisible();
    await expect(page.locator("#retreat-round")).toBeHidden(); // the deck's opponent never presses
    await press.click();
    await expect(press).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#stake-note")).toContainText("You press the round");
    // Round 1: REFLECT the deck's FIRE SEEK ENEMY (a seal for you) and SEEK back (another): 2-0, doubled to 3-0.
    await page.locator('#reaction-tray [data-reaction="reflect"]').click();
    const tray = page.locator("#glyph-tray");
    for (const glyph of ["SEEK", "ENEMY"]) await tray.getByRole("button", { name: glyph, exact: true }).click();
    await page.locator("#resolve-round").click();
    await expect(page.locator("#combat-log")).toContainText("You pressed the round: the seal counts double.");
    await expect(page.locator("#combat-log")).toContainText("You took the round and the stake: 2 seals.");
    await expect(page.locator("#player-seals")).toHaveText("3");
    await expect(page.locator("#opponent-seals")).toHaveText("0");
    await expect(press).toBeDisabled();
});
