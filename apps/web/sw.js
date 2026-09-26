// Service worker for the Wyrd POC shell.
//
// The cache name carries the web tier version (stamped by
// scripts/build_web.mjs), so every deploy installs a fresh worker whose
// activate step drops the previous shell. Without that, an installed
// home-screen app could keep serving a stale index.html indefinitely.
const CACHE = "wyrd-web-v__WEB_VERSION__";
// The shell is cached under "./", never "./index.html": Cloudflare Pages
// answers /index.html with a 308 to /, and a cached *redirected* response
// cannot be used for a navigation (redirect mode "manual") - Chromium
// fails the reload with net::ERR_FAILED. Seen in the offline smoke test.
const SHELL_URL = "./";
const SHELL = [SHELL_URL, "./style.css", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    // /api/* is proxied to the worker and must always be live: versions,
    // telemetry and (later) duel rooms are never served from cache.
    if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

    if (request.mode === "navigate") {
        // Network first for the page itself so a deploy shows up on the
        // next open; the cached shell is the offline fallback.
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok && !response.redirected) {
                        const copy = response.clone();
                        caches.open(CACHE).then(cache => cache.put(SHELL_URL, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(SHELL_URL))
        );
        return;
    }

    // Everything else (scripts, styles, manifest, icons): network first with
    // the cache as the offline fallback. Cache-first paired a fresh
    // index.html with a stale style.css right after a deploy (seen on an
    // iPhone 2026-09-26: the settings panel rendered unstyled). Online the
    // page always gets assets that match it; offline the shell still loads.
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request).then(cached => cached ?? Response.error()))
    );
});
