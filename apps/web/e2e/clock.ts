import { expect, type Locator, type Page } from "@playwright/test";

// Specs for the real-time games drive Playwright's fake clock instead of
// waiting on real seconds: the page opens with time paused, the spec acts
// with time standing still and advances the clock to the moment it needs.
// Deterministic where the real clock raced slow CI frames (software WebGL),
// and fast: a nine-second ring takes as long as the frames it renders.

const T0 = new Date("2026-01-01T00:00:00Z").getTime();

/** Open `url` with the fake clock installed and paused. */
export async function openPaused(page: Page, url: string): Promise<void> {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0 + 10);
    await page.goto(url);
}

/** Advance the paused clock by `ms`: timers and animation frames run as if that much time had passed. */
export function tick(page: Page, ms: number): Promise<void> {
    return page.clock.runFor(ms);
}

/**
 * Advance in `step` ms slices until `locator` has `attribute` = `value`
 * (for a moment the game reaches on its own: a window opening, a round
 * starting). Fails after `max` ms of game time.
 */
export async function tickUntil(page: Page, locator: Locator, attribute: string, value: string | RegExp, max = 20_000, step = 50): Promise<void> {
    for (let t = 0; t <= max; t += step) {
        const current = (await locator.getAttribute(attribute)) ?? "";
        if (typeof value === "string" ? current === value : value.test(current)) return;
        await page.clock.runFor(step);
    }
    await expect(locator).toHaveAttribute(attribute, value, { timeout: 1 });
}
