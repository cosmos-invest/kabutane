(() => {
  "use strict";

  const upstreamFetch = window.fetch.bind(window);

  function isDetailDataUrl(value) {
    const url = typeof value === "string" ? value : value?.url || "";
    return /(?:^|\/)data\/(?:charts|daily)\/[^/?]+\.json(?:[?#].*)?$/i.test(String(url));
  }

  function isPremiumOnlyProvisional(signal) {
    return String(signal?.status || "").toUpperCase() === "GC";
  }

  function sanitizePayload(payload) {
    if (!payload || typeof payload !== "object" || !isPremiumOnlyProvisional(payload.provisional_signal)) return payload;
    const next = { ...payload, provisional_signal: null };
    if (payload.record && typeof payload.record === "object") {
      next.record = { ...payload.record };
      delete next.record.provisional_status;
      delete next.record.provisional_month;
    }
    return next;
  }

  function jsonResponse(payload, original) {
    const headers = new Headers(original.headers || {});
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("X-Kabutane-Public-Boundary", "premium-provisional-gc");
    return new Response(JSON.stringify(payload), {
      status: original.status,
      statusText: original.statusText,
      headers,
    });
  }

  window.fetch = async function publicDetailBoundary(input, init) {
    const response = await upstreamFetch(input, init);
    if (!response.ok || !isDetailDataUrl(input)) return response;
    try {
      const payload = await response.clone().json();
      const sanitized = sanitizePayload(payload);
      if (sanitized === payload) return response;
      return jsonResponse(sanitized, response);
    } catch (_) {
      return response;
    }
  };

  window.KabutaneDetailPremiumBoundary = { sanitizePayload, isPremiumOnlyProvisional, isDetailDataUrl };
})();
