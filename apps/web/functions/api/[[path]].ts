// Cloudflare Pages Function: transparent proxy /api/* -> the Worker.
// Same proxy as gigsy and feedme2. Keeps the client single-origin (no
// CORS preflight) and lets the Worker live on its own *.workers.dev
// domain. Override per environment with the WORKER_ORIGIN Pages env var.

const DEFAULT_WORKER_ORIGIN = "https://wyrd-api.atsyg-feedme.workers.dev";

interface Env {
    WORKER_ORIGIN?: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
    const origin = (env.WORKER_ORIGIN ?? DEFAULT_WORKER_ORIGIN).replace(/\/+$/, "");
    const incoming = new URL(request.url);
    const upstream = origin + incoming.pathname + incoming.search;

    const init: RequestInit = {
        method: request.method,
        // Forwarded verbatim, Host included. workerd rewrites Host to the
        // upstream URL's authority (it is a forbidden header for fetch), so
        // the *.workers.dev edge routes correctly.
        headers: request.headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        // @ts-expect-error duplex is a valid fetch init key in workerd.
        duplex: "half",
        redirect: "manual"
    };

    return fetch(upstream, init);
};
