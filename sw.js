const CACHE_VERSION = "kabutane-pwa-v26";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// These files are required for the detail page to boot. If even one cannot be
// cached, the new service worker must not replace the last working version.
const CRITICAL_ASSETS = [
  "./",
  "./detail.html",
  "./manifest.webmanifest",
  "./assets/style.css?v=13",
  "./assets/detail-enhancements.css?v=13",
  "./assets/detail-signal-status.css?v=13",
  "./assets/detail-chart-viewport.css?v=13",
  "./assets/provisional-monthly-rsi-core.js?v=13",
  "./assets/detail-chart-viewport-core.js?v=13",
  "./assets/core-detail-fallback.js?v=2",
  "./assets/detail.js?v=13",
  "./assets/daily-overlay.js?v=13",
  "./assets/detail-chart-viewport.js?v=14",
  "./assets/detail-enhancements.js?v=13",
  "./assets/detail-signal-status.js?v=13",
  "./assets/detail-signal-chart-fix.js?v=13",
  "./assets/characters.js?v=13",
];

const OPTIONAL_ASSETS = [
  "./index.html",
  "./today.html",
  "./all-stocks.html",
  "./monthly-dc.html",
  "./replay.html",
  "./replay-select.html",
  "./backtest.html",
  "./howto.html",
  "./learn.html",
  "./large-holdings.html",
  "./signal-method.html",
  "./ranking.html",
  "./ranking/",
  "./ranking/index.html",
  "./monthly-strategy.html?v=16",
  "./monthly-strategy.html",
  "./monthly-report.html",
  "./monthly-report/",
  "./monthly-report/index.html",
  "./history.html",
  "./shikiho-summer-2026.html",
  "./data/curated/shikiho-2026-summer.json",
  "./data/curated/shikiho-2026-summer-performance.json",
  // Compatibility for already-open pages while the v25 worker is activating.
  "./assets/provisional-monthly-rsi-core.js",
  "./assets/detail-chart-viewport-core.js",
  "./assets/core-detail-fallback.js",
  "./assets/detail.js",
  "./assets/daily-overlay.js",
  "./assets/detail-chart-viewport.js",
  "./assets/detail-enhancements.js",
  "./assets/detail-signal-status.js",
  "./assets/detail-signal-chart-fix.js",
  "./assets/characters.js",
  "./assets/kabutane-world.js",
  "./assets/kabutane-world.css",
  "./assets/monthly-report.css",
  "./assets/monthly-strategy-v16.css",
  "./assets/market-insights.css",
  "./assets/shikiho-room.css",
  "./assets/shikiho-room.js",
  "./assets/today-kabutane.css",
  "./assets/today-kabutane.js",
  "./assets/all-stocks.css?v=2",
  "./assets/all-stocks.js?v=2",
  "./assets/all-stocks.css",
  "./assets/all-stocks.js",
  "./assets/monthly-dc.css",
  "./assets/monthly-dc.js",
  "./assets/large-holdings.css",
  "./assets/large-holdings.js",
  "./assets/detail-large-holdings.css",
  "./assets/detail-large-holdings.js",
  "./assets/detail-fundamentals.css",
  "./assets/watchlist-large-holdings.css",
  "./assets/style.css?v=16",
  "./assets/pastel.css?v=16",
  "./assets/kabutane.css?v=16",
  "./assets/kabutane-links.css?v=16",
  "./assets/market-insights.css?v=16",
  "./assets/monthly-report.css?v=16",
  "./assets/monthly-strategy-v16.css?v=16",
  "./assets/kabutane-world.css?v=16",
  "./assets/market-pages.js?v=16",
  "./assets/characters.js?v=16",
  "./assets/kabutane-world.js?v=16",
  "./assets/detail-enhancements.css",
  "./assets/detail-signal-status.css",
  "./assets/detail-chart-viewport.css",
  "./assets/pastel.css",
  "./assets/kabutane.css",
  "./assets/howto-visual.css",
  "./assets/site-upgrades.js",
  "./assets/copy-audit.js",
  "./assets/market-pages.js",
  "./assets/practice-history-core.js",
  "./assets/practice-history.js",
  "./assets/practice-history-page.js",
  "./assets/tutorials/howto-replay-entry.svg",
  "./assets/tutorials/howto-replay-stop.svg",
  "./assets/replay.css",
  "./assets/replay-v2.css",
  "./assets/replay-workspace.css",
  "./assets/replay-unified.css",
  "./assets/replay-guided-mode.css",
  "./assets/replay-share-report.css",
  "./assets/replay-picker.css",
  "./assets/replay-picker.js",
  "./assets/replay-stock-select.js",
  "./assets/replay-drawing-tools.css",
  "./assets/replay-drawing-tools.js",
  "./assets/replay-unified-workspace.js",
  "./assets/replay-guided-core.js",
  "./assets/replay-guided-mode.js",
  "./assets/replay-guided-fixes.js",
  "./assets/replay-share-report-core.js",
  "./assets/replay-share-report.js",
  "./assets/replay-practice-ux-v2.css",
  "./assets/replay-practice-coach-v3.css",
  "./assets/replay-practice-coach-v4.css",
  "./assets/replay-practice-score-v2.js",
  "./assets/replay-practice-ux-v2.js",
  "./assets/replay-practice-ux-v2-stability.js",
  "./assets/replay-score-report-v2.js",
  "./assets/replay-practice-coach-v3.js",
  "./assets/replay-practice-coach-v4.js",
  "./assets/pwa-register.js",
  "./assets/kabutane-links.css",
  "./assets/icons/kabutane-wordmark-v3.svg",
  "./assets/icons/kabutane-192.png?v=1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(async (cache) => {
        await cache.addAll(CRITICAL_ASSETS);
        await Promise.allSettled(OPTIONAL_ASSETS.map((asset) => cache.add(asset)));
      })
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
    return ["./ranking.html", "./ranking/", "./ranking/index.html"];
  }
  if (
    pathname.endsWith("/monthly-report") ||
    pathname.endsWith("/monthly-report.html") ||
    pathname.endsWith("/monthly-strategy") ||
    pathname.endsWith("/monthly-strategy.html")
  ) {
    return ["./monthly-strategy.html?v=16", "./monthly-strategy.html", "./monthly-report.html", "./monthly-report/", "./monthly-report/index.html"];
  }
  if (pathname.endsWith("/shikiho-summer-2026") || pathname.endsWith("/shikiho-summer-2026.html")) {
    return ["./shikiho-summer-2026.html"];
  }
  if (pathname.endsWith("/replay-select") || pathname.endsWith("/replay-select.html")) {
    return ["./replay-select.html"];
  }
  if (pathname.endsWith("/today") || pathname.endsWith("/today.html")) {
    return ["./today.html"];
  }
  if (pathname.endsWith("/all-stocks") || pathname.endsWith("/all-stocks.html")) {
    return ["./all-stocks.html"];
  }
  if (pathname.endsWith("/monthly-dc") || pathname.endsWith("/monthly-dc.html")) {
    return ["./monthly-dc.html"];
  }
  if (pathname.endsWith("/large-holdings") || pathname.endsWith("/large-holdings.html")) {
    return ["./large-holdings.html"];
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
    if (fallback) return fallback;
    const cached = await cache.match(request);
    return cached || response;
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

  const isNavigation = event.request.mode === "navigate";
  const isFreshData = url.pathname.includes("/data/") || url.pathname.endsWith(".json");
  const isRuntimeCode = /\.(?:js|css)$/.test(url.pathname);
  if (isNavigation || isFreshData || isRuntimeCode) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event.request));
});
