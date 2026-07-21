(function attachKabutaneDailyOverlay(globalScope) {
  "use strict";

  function mergeRows(baseRows, overlayRows) {
    const rows = new Map();
    [...(baseRows || []), ...(overlayRows || [])].forEach((row) => {
      if (row && row.date) rows.set(String(row.date), row);
    });
    return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function mergeEvents(baseEvents, overlayEvents) {
    const events = new Map();
    [...(baseEvents || []), ...(overlayEvents || [])]
      .filter((event) => event && ["DIVIDEND", "SPLIT"].includes(String(event.type || "")))
      .forEach((event) => {
        const key = [event.date, event.type, event.detail || ""].join("|");
        events.set(key, event);
      });
    return [...events.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function mergePayload(payload, overlay) {
    const base = payload && typeof payload === "object" ? payload : {};
    const extra = overlay && typeof overlay === "object" ? overlay : {};
    return {
      ...base,
      daily: mergeRows(base.daily, extra.daily),
      record: { ...(base.record || {}), ...(extra.record || {}) },
      corporate_events: mergeEvents(base.corporate_events, extra.corporate_events),
      daily_generated_at: extra.generated_at || base.daily_generated_at || null,
      daily_price_date: extra.price_date || base.daily_price_date || null,
    };
  }

  const api = { mergeRows, mergeEvents, mergePayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.KabutaneDaily = api;

  if (typeof globalScope.fetchJson !== "function") return;
  const baseFetchJson = globalScope.fetchJson;
  globalScope.fetchJson = async function fetchJsonWithDailyOverlay(path) {
    const payload = await baseFetchJson(path);
    const match = String(path).match(/data\/charts\/([^/?]+)\.json/i);
    if (!match) return payload;
    const sanitized = mergePayload(payload, null);
    try {
      const overlay = await baseFetchJson(`data/daily/${encodeURIComponent(match[1])}.json`);
      return mergePayload(sanitized, overlay);
    } catch (error) {
      return sanitized;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
