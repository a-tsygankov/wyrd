/**
 * Update check for the installed PWA. The page carries the web version it
 * was built with; the server serves the live one at version.json (the
 * service worker never caches it). Pure so it is unit-tested in node
 * (test/update.test.mjs); main.ts does the fetching and shows the banner.
 */
const VERSION = /^\d+(\.\d+)*$/;

/** -1, 0 or 1 as `a` is older than, equal to or newer than `b`; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
}

/**
 * Whether the served version is newer than the running one. Only strictly
 * newer: a rollback or an edge that still answers with the old file must not
 * nag. A dev build (no stamped version) or a malformed answer (an HTML
 * fallback, an empty body) never offers an update.
 */
export function updateAvailable(running: string, served: string | undefined): boolean {
    if (!VERSION.test(running) || served === undefined || !VERSION.test(served)) return false;
    return compareVersions(served, running) > 0;
}
