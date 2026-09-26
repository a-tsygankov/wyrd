import { expect, test } from "@playwright/test";

// Installability on the two platforms the product ships on. Android Chrome
// only offers "Install" when the manifest has real 192/512 icons and a
// service worker with a fetch handler; iOS uses the apple-touch-icon and
// the meta tags. These checks are what a human would otherwise discover
// on the phone as "no install prompt" or "a screenshot as the app icon".

type Icon = { src: string; sizes: string; type?: string; purpose?: string };
type Manifest = {
    name: string;
    short_name: string;
    start_url: string;
    scope?: string;
    id?: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: Icon[];
};

function pngSize(bytes: Uint8Array): { width: number; height: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // PNG signature (8 bytes) + IHDR length/type (8 bytes) → width, height.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

test("the manifest satisfies Chrome's install criteria", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();
    const manifestUrl = new URL(href!, page.url()).toString();
    const res = await request.get(manifestUrl);
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as Manifest;

    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.id).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);

    const bySize = (size: number, purpose?: string) =>
        manifest.icons.find(i => i.sizes.split(" ").includes(`${size}x${size}`) && (purpose ? (i.purpose ?? "any").includes(purpose) : true));
    expect(bySize(192), "192x192 icon").toBeTruthy();
    expect(bySize(512), "512x512 icon").toBeTruthy();
    expect(bySize(512, "maskable"), "maskable icon for Android's adaptive shapes").toBeTruthy();

    for (const icon of manifest.icons) {
        const iconRes = await request.get(new URL(icon.src, manifestUrl).toString());
        expect(iconRes.ok(), icon.src).toBeTruthy();
        expect(iconRes.headers()["content-type"], icon.src).toContain("image/png");
        const declared = Number(icon.sizes.split("x")[0]);
        const actual = pngSize(new Uint8Array(await iconRes.body()));
        expect(actual, icon.src).toEqual({ width: declared, height: declared });
    }
});

test("iOS home-screen metadata is present", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(touchIcon).toBeTruthy();
    const res = await request.get(new URL(touchIcon!, page.url()).toString());
    expect(res.ok()).toBeTruthy();
    expect(pngSize(new Uint8Array(await res.body()))).toEqual({ width: 180, height: 180 });
});

test("the install coach mark matches the platform", async ({ page, browserName }) => {
    await page.goto("/");
    const banner = page.locator("#install-banner");
    if (browserName === "webkit") {
        // iPhone Safari (not yet installed): manual Add-to-Home-Screen hint,
        // no Install button because iOS has no prompt API.
        await expect(banner).toBeVisible();
        await expect(banner).toContainText("Add to Home Screen");
        await expect(page.locator("#install-now")).toBeHidden();
        await page.locator("#install-dismiss").click();
        await expect(banner).toBeHidden();
        await page.reload();
        await expect(banner).toBeHidden();
    } else {
        // Headless Chromium never fires beforeinstallprompt, so the banner
        // must stay hidden rather than show a button that cannot work.
        await expect(banner).toBeHidden();
    }
});
