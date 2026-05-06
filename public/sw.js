/* HotelOps · Service Worker
 * =================================================================
 * Offline-first cache for the static shell. Strategy:
 *   - install: precache the app shell (index, manifest, icon)
 *   - fetch:
 *       * navigation requests → network-first, fall back to cached index.html
 *       * static assets (js/css/png/woff) → cache-first
 *       * everything else → network-first
 *   - activate: purge old caches
 *
 * Note: this only runs in the web/PWA context. Electron uses file:// and
 * doesn't register the worker (the desktop app is already "installed").
 */

const CACHE_VERSION = "hotelops-v1.6.0";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try { await cache.addAll(SHELL); } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Don't cache API calls (Anthropic, Plaid proxies, POS proxies, etc.)
  if (url.host !== self.location.host) return;
  // Don't cache localStorage-backed shell hot paths
  if (req.headers.get("X-HotelOps-Auth")) return;

  // Navigation: network-first, fall back to cached index.html
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match("./index.html")) || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Static assets: cache-first
  if (/\.(?:js|css|png|svg|webp|woff2?|ttf|otf|ico)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }
});
