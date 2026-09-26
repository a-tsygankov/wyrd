const CACHE = "wyrd-poc-v1";
const ASSETS = ["./", "./index.html", "./style.css", "./manifest.webmanifest"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;
    event.respondWith(
        caches.match(event.request).then(cached => cached ?? fetch(event.request))
    );
});
