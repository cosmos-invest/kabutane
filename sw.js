const CACHE_VERSION = "kabutane-pwa-v12";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./detail.html",
  "./replay.html",
  "./backtest.html",
  "./howto.html",
  "./learn.html",
  "./signal-method.html",
  "./ranking.html",
  "./ranking/",
  "./ranking/index.html",
  "./monthly-report.html",
  "./monthly-report/",
  "./monthly-report/index.html",
  "./history.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/pastel.css",
  "./assets/kabutane.css",
  "./assets/howto-visual.css",
  "./assets/market-insights.css",
  "./assets/site-upgrades.js",
  "./assets/copy-audit.js",
  "./assets/market-pages.js",
  "./assets/practice-history-core.js",
  "./assets/practice-history.js",
  "./assets/practice-history-page.js",
  "./assets/tutorials/howto-replay-entry.svg",
  "./assets/tutorials/howto-replay-stop.svg",
  "./assets/detail-enhancements.css",
  "./assets/detail-signal-status.css",
  "./assets/provisional-monthly-rsi-core.js",
  "./assets/detail-signal-status.js",
  "./assets/detail-signal-chart-fix.js",
  "./assets/detail-chart-viewport.css",
  "./assets/detail-chart-viewport-core.js",
  "./assets/detail-chart-viewport.js",
  "./assets/replay.css",
  "./assets/replay-v2.css",
  "./assets/replay-workspace.css",
  "./assets/replay-unified.css",
  "./assets/replay-guided-mode.css",
  "./assets/replay-share-report.css",
  "./assets/replay-drawing-tools.css",
  "./assets/replay-drawing-tools.js",
  "./assets/replay-unified-workspace.js",
  "./assets/replay-guided-core.js",
  "./assets/replay-guided-mode.js",
  "./assets/replay-guided-fixes.js",
  "./assets/replay-share-report-core.js",
  "./assets/replay-share-report.js",
  "./assets/pwa-register.js",
  "./assets/kabutane-links.css",
  "./assets/icons/kabutane-wordmark-v3.svg",
  "./assets/icons/kabutane-192.png?v=1"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function routeAlternatives(url) {
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/ranking") || pathname.endsWith("/ranking.html")) {
    return ["./ranking/", "./ranking/index.html", "./ranking.html"];
  }
  if (pathname.endsWith("/monthly-report") || pathname.endsWith("/monthly-report.html")) {
    return ["./monthly-report/", "./monthly-report/index.html", "./monthly-report.html"];
  }
  return [];
}

async function routeFallback(request, cache) {
  const alternatives = routeAlternatives(new URL(request.url));
  for (const path of alternatives) {
    const cached = await cache.match(path);
    if (cached) return cached;
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) {
        cache.put(path, response.clone());
        return response;
      }
    } catch (_) {
      // Try the next compatible route.
    }
  }
  return null;
}

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    const fallback = await routeFallback(request, cache);
    return fallback || response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await routeFallback(request, cache);
    if (fallback) return fallback;
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
