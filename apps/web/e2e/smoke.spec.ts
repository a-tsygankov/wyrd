import { expect, test } from "@playwright/test";

// Runs against E2E_BASE_URL (a Pages preview in CI, the production site by
// default) on WebKit-as-iPhone and Chromium-as-Pixel: the two platforms the
// product ships on. Read-only apart from the duel it plays client-side.

test("the duel board loads with its version footer", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Wyrd Duel POC");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#version-line")).toContainText(/web v\d+\.\d+\.\d+/);
});

test("a spell can be cast and scores a seal", async ({ page }) => {
    await page.goto("/");
    // Round 1 is the deck's teaching scenario on the high-information
    // telegraph: essence and action shown, target hidden.
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
    await expect(page.locator("#scenario-note")).toContainText("Scenario 1/");
    const tray = page.locator("#glyph-tray");
    // Each glyph explains itself behind one tap-to-expand row; the summary
    // of what the cast will do stays open.
    await expect(page.locator("#glyph-help")).toBeHidden();
    await tray.getByRole("button", { name: "FIRE", exact: true }).click();
    await expect(page.locator("#glyph-help-toggle")).toHaveText("What FIRE does");
    await expect(page.locator("#glyph-help-list li").first()).toBeHidden();
    await page.locator("#glyph-help-toggle").click();
    await expect(page.locator("#glyph-help-list li").first()).toContainText("Essence");
    await expect(page.locator("#spell-explain .summary")).toContainText(/not yet castable/i);
    for (const glyph of ["SEEK", "ENEMY"]) {
        await tray.getByRole("button", { name: glyph, exact: true }).click();
    }
    await expect(page.locator("#spell-preview")).toContainText("FIRE → SEEK → ENEMY");
    await expect(page.locator("#glyph-help-toggle")).toHaveText("What FIRE, SEEK, ENEMY do");
    await expect(page.locator("#glyph-help-list li")).toHaveCount(3);
    await expect(page.locator("#spell-explain .summary").first()).toContainText(/seal to you/i);
    await expect(page.locator("#spell-explain")).toContainText(/open to REFLECT/i);
    // The reaction explanation follows the selection.
    await expect(page.locator("#reaction-explain")).toContainText(/no reaction/i);
    await page.locator('#reaction-tray [data-reaction="reflect"]').click();
    await expect(page.locator("#reaction-explain")).toContainText(/REFLECT.*SEEK/);
    await page.locator('#reaction-tray [data-reaction=""]').click();
    const cast = page.locator("#resolve-round");
    await expect(cast).toBeEnabled();
    await cast.click();
    // The round resolves both spells; the player's SEEK always lands
    // against the round-1 opponent script, so one seal is deterministic.
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#combat-log li")).not.toHaveCount(1);
    await expect(page.locator("#combat-log .lesson")).toContainText("Lesson");
    // Round verdict on top of the log: 1-1 in round 1 without a reaction.
    await expect(page.locator("#combat-log .verdict").first()).toContainText(/even round/i);
    await expect(page.locator("#combat-log .reason").first()).toContainText(/gained a seal/i);
    await expect(page.locator("#next-round")).toBeVisible();
});

test("a full match through the scenario deck is won by reading the telegraph", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // A fixed seed pins the medium-information telegraphs and the bot's
    // rolls, so the walkthrough below is deterministic.
    await page.goto("/?seed=smoke");
    const tray = page.locator("#glyph-tray");
    const cast = async (glyphs: string[], reaction?: string) => {
        for (const glyph of glyphs) await tray.getByRole("button", { name: glyph, exact: true }).click();
        if (reaction) await page.locator(`#reaction-tray [data-reaction="${reaction}"]`).click();
        await page.locator("#resolve-round").click();
        await expect(page.locator("#combat-log .lesson")).toBeVisible();
    };

    // Round 1 (direct threat): no reaction, the opponent's SEEK lands; ours does too.
    // Resolving a round fires one anonymous telemetry batch; only that it is
    // sent is asserted - the worker's answer must never matter to the player.
    const telemetryRequest = page.waitForRequest(request => request.url().includes("/api/telemetry") && request.method() === "POST");
    await cast(["FIRE", "SEEK", "ENEMY"]);
    const body = (await telemetryRequest).postDataJSON() as { events: Array<Record<string, unknown>> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
        event: "round",
        matchSeed: "smoke",
        round: 1,
        scenarioId: "direct-threat",
        telegraph: "FIRE → SEEK → ?",
        playerSpell: ["FIRE", "SEEK", "ENEMY"],
        playerReaction: null,
        playerGained: 1,
        opponentGained: 1
    });
    expect(typeof body.events[0]!["timeToCommitMs"]).toBe("number");
    await expect(page.locator("#player-seals")).toHaveText("1");
    await expect(page.locator("#opponent-seals")).toHaveText("1");
    await page.locator("#next-round").click();

    // Round 2 (open route): REFLECT the amplified SEEK for a seal, then take
    // the GATE objective, which the opponent's fixed SILENCE cannot stop.
    await expect(page.locator("#scenario-note")).toContainText("Scenario 2/");
    await expect(page.locator("#telegraph")).toHaveText("SHADOW → SEEK → ? → ?");
    await cast(["GATE", "CLOSE"], "reflect");
    await expect(page.locator("#player-seals")).toHaveText("3");
    await expect(page.locator("#opponent-seals")).toHaveText("1");
    await expect(page.locator("#match-status")).toHaveText("You win the duel");
    await expect(page.locator("#combat-log .verdict").first()).toContainText(/You win the duel 3–1/);
    await expect(page.locator("#combat-log .verdict").first()).toContainText(/REFLECT/);
    await expect(page.locator("#next-round")).toBeHidden();

    // Reset with the same seed replays the same opening telegraph.
    await page.locator("#reset-match").click();
    await expect(page.locator("#telegraph")).toHaveText("FIRE → SEEK → ?");
    await expect(page.locator("#scenario-note")).toContainText("seed smoke");
    expect(errors).toEqual([]);
});

test("the service worker installs and the shell reloads offline", async ({ page, context, browserName }) => {
    await page.goto("/");
    const state = await page.evaluate(() =>
        "serviceWorker" in navigator
            ? Promise.race([
                  navigator.serviceWorker.ready.then(() => "ready"),
                  new Promise<string>(resolve => setTimeout(() => resolve("timeout"), 8000))
              ])
            : "unsupported"
    );
    expect(state).toBe("ready");
    // Playwright's offline emulation is Chromium-only; WebKit stops at
    // "the worker installed", which is still the iOS-relevant half.
    test.skip(browserName !== "chromium", "offline emulation needs Chromium");
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.setOffline(false);
});
