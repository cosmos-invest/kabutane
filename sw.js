const CACHE_VERSION = "kabutane-pwa-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./replay.html",
  "./backtest.html",
  "./howto.html",
  "./learn.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/pastel.css",
  "./assets/replay.css",
  "./assets/replay-v2.css",
  "./assets/replay-workspace.css",
  "./assets/replay-drawing-tools.css",
  "./assets/replay-drawing-tools.js",
  "./assets/pwa-register.js",
  "./assets/kabutane-links.css",
  "./assets/icons/kabutane-wordmark-v3.svg",
  "./assets/icons/kabutane-192.png?v=1"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || update;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  const isFreshData = url.pathname.includes("/data/") || url.pathname.endsWith(".json") || event.request.mode === "navigate";
  if (isFreshData) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event.request));
});
