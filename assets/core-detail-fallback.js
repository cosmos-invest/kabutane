(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const cache = new Map();
  const activeFallbackCodes = new Set();
  let fallbackUsed = false;

  function codeFromPath(path, folder) {
    const match = String(path || "").match(new RegExp(`(?:^|/)data/${folder}/([^/?]+)\\.json(?:[?#].*)?$`, "i"));
    return match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
  }

  function shard(code) {
    return String(code || "").slice(0, 2).toUpperCase();
  }

  async function jsonOrNull(path) {
    const key = `json:${path}`;
    if (cache.has(key)) return cache.get(key);
    const promise = nativeFetch(`${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
    cache.set(key, promise);
    return promise;
  }

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isPremiumOnlyProvisional(signal) {
    return String(signal?.status || "").toUpperCase() === "GC";
  }

  function publicProvisional(signal) {
    return isPremiumOnlyProvisional(signal) ? null : signal || null;
  }

  function sanitizePublicPayload(payload) {
    if (!payload || typeof payload !== "object" || !isPremiumOnlyProvisional(payload.provisional_signal)) return payload;
    const sanitized = { ...payload, provisional_signal: null };
    if (payload.record && typeof payload.record === "object") {
      sanitized.record = { ...payload.record };
      delete sanitized.record.provisional_status;
      delete sanitized.record.provisional_month;
    }
    return sanitized;
  }

  async function sanitizeResponse(response) {
    if (!response?.ok) return response;
    try {
      const payload = await response.clone().json();
      const sanitized = sanitizePublicPayload(payload);
      if (sanitized === payload) return response;
      const headers = new Headers(response.headers || {});
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("X-Kabutane-Public-Boundary", "premium-provisional-gc");
      return new Response(JSON.stringify(sanitized), { status: response.status, statusText: response.statusText, headers });
    } catch (_) {
      return response;
    }
  }

  function rowsFromCompact(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      date: row?.[0] || "",
      open: finite(row?.[1]), high: finite(row?.[2]), low: finite(row?.[3]), close: finite(row?.[4]), volume: finite(row?.[5]),
    })).filter((row) => row.date && row.close !== null);
  }

  function mergeRows(...groups) {
    const byDate = new Map();
    groups.flat().forEach((row) => {
      if (row?.date) byDate.set(String(row.date), { ...(byDate.get(String(row.date)) || {}), ...row });
    });
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function rollingAverage(values, length, index) {
    if (index + 1 < length) return null;
    let sum = 0;
    let count = 0;
    for (let i = index - length + 1; i <= index; i += 1) {
      const value = finite(values[i]);
      if (value === null) return null;
      sum += value;
      count += 1;
    }
    return count === length ? sum / length : null;
  }

  function enrichDaily(rows, monthlyRows) {
    const closes = rows.map((row) => finite(row.close));
    const monthly = (Array.isArray(monthlyRows) ? monthlyRows : []).map((row) => ({ month: String(row?.[0] || ""), rsi: finite(row?.[1]), ma: finite(row?.[2]) }));
    return rows.map((row, index) => {
      const month = String(row.date).slice(0, 7);
      const prior = monthly.filter((point) => point.month < month).at(-1) || null;
      return {
        ...row,
        sma25: rollingAverage(closes, 25, index),
        sma75: rollingAverage(closes, 75, index),
        sma200: rollingAverage(closes, 200, index),
        rsi5: prior?.rsi ?? null,
        rsi14: prior?.ma ?? null,
      };
    });
  }

  function eventDates(events, rows) {
    const dates = rows.map((row) => String(row.date));
    return (Array.isArray(events) ? events : []).map((event) => {
      const month = String(event.month || "");
      if (!month) return null;
      const firstAfter = dates.find((date) => date.slice(0, 7) > month);
      return firstAfter ? { ...event, date: firstAfter } : null;
    }).filter(Boolean);
  }

  async function loadPieces(code) {
    const key = `pieces:${code}`;
    if (cache.has(key)) return cache.get(key);
    const prefix = shard(code);
    const promise = Promise.all([
      jsonOrNull(`data/core/charts/${prefix}.json`),
      jsonOrNull(`data/core/daily/${prefix}.json`),
      jsonOrNull(`data/core/fundamentals/${prefix}.json`),
    ]).then(([baseShard, dailyShard, financeShard]) => ({
      base: baseShard?.records?.[code] || null,
      daily: dailyShard?.records?.[code] || null,
      finance: financeShard?.records?.[code] || null,
    }));
    cache.set(key, promise);
    return promise;
  }

  async function buildChartPayload(code) {
    const { base, daily, finance } = await loadPieces(code);
    if (!base) return null;
    const baseRows = rowsFromCompact(base.daily);
    const overlayRows = rowsFromCompact(daily?.daily);
    const merged = enrichDaily(mergeRows(baseRows, overlayRows), base.monthly || []);
    const rawProvisional = daily?.provisional_signal || {};
    const provisional = publicProvisional(rawProvisional);
    const technical = daily?.technical || {};
    const record = {
      ...(base.record || {}),
      ...(finance || {}),
      current_price: technical.current_price ?? base.record?.current_price ?? null,
      provisional_status: provisional?.status || null,
      monthly_rsi14: rawProvisional.confirmed_rsi14 ?? base.record?.monthly_rsi14 ?? null,
      monthly_rsi_ma5: rawProvisional.confirmed_rsi_ma5 ?? base.record?.monthly_rsi_ma5 ?? null,
      data_completeness_pct: finance?.data_completeness_pct ?? null,
      core_universe_fallback: true,
    };
    activeFallbackCodes.add(code);
    fallbackUsed = true;
    window.__kabutaneCoreFallback = { code, provisional, financeAvailable: Boolean(finance?.fundamentals_available) };
    return {
      code,
      ticker: base.ticker,
      name: base.name || code,
      generated_at: daily?.price_date || null,
      record,
      daily: merged,
      cross_events: eventDates(base.cross_events || [], merged),
      gc_events: eventDates((base.cross_events || []).filter((event) => event.type === "GC"), merged),
      dc_events: eventDates((base.cross_events || []).filter((event) => event.type === "DC"), merged),
      corporate_events: base.corporate_events || [],
      episodes: [],
      provisional_signal: provisional,
      core_universe_fallback: true,
    };
  }

  async function buildDailyPayload(code) {
    const { base, daily, finance } = await loadPieces(code);
    if (!base || !daily) return null;
    const rows = enrichDaily(mergeRows(rowsFromCompact(base.daily), rowsFromCompact(daily.daily)), base.monthly || []);
    return {
      code,
      ticker: base.ticker,
      price_date: daily.price_date,
      daily: rows.slice(-40),
      record: { ...(base.record || {}), ...(finance || {}), ...(daily.technical || {}), core_universe_fallback: true },
      provisional_signal: publicProvisional(daily.provisional_signal),
    };
  }

  function synthetic(payload) {
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "X-Kabutane-Core-Fallback": "1" } });
  }

  window.fetch = async function kabutaneFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const chartCode = codeFromPath(url, "charts");
    const dailyCode = codeFromPath(url, "daily");
    if (!chartCode && !dailyCode) return nativeFetch(input, init);

    const original = await nativeFetch(input, init);
    if (original.ok) return sanitizeResponse(original);
    if (original.status !== 404) return original;

    // A normal detail page may legitimately have no incremental daily overlay.
    // Do not probe the all-core shards for that case: doing so creates extra
    // 404s before the initial all-core dataset has been deployed. The chart
    // endpoint is the authoritative switch into fallback mode; its synthetic
    // payload already contains the compact daily overlay and public RSI state.
    if (dailyCode && !activeFallbackCodes.has(dailyCode)) return original;

    const payload = chartCode ? await buildChartPayload(chartCode) : await buildDailyPayload(dailyCode);
    return payload ? synthetic(payload) : original;
  };

  window.addEventListener("load", () => {
    window.setTimeout(() => {
      if (!fallbackUsed) return;
      const notice = document.getElementById("chartDataNotice");
      if (notice) {
        notice.hidden = false;
        notice.textContent = "全銘柄モード：この銘柄は通常シグナル一覧外のため、全対象銘柄用の1年日足＋最新日次差分から表示しています。月足の確定値と公開対象の進行中月観察情報、財務を同じ銘柄コードで確認できます。";
      }
      ["replayLink", "replayCardLink"].forEach((id) => {
        const link = document.getElementById(id);
        if (!link) return;
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.classList.add("disabled");
        link.textContent = "売買練習データは準備中";
      });
    }, 1200);
  });

  window.KabutaneCoreDetailFallback = { sanitizePublicPayload, publicProvisional, isPremiumOnlyProvisional };
})();
