(() => {
  "use strict";

  const root = document.getElementById("watchlistGrid");
  const empty = document.getElementById("watchlistEmpty");
  const count = document.getElementById("watchlistCount");
  const search = document.getElementById("watchlistSearch");
  const sort = document.getElementById("watchlistSort");
  const updated = document.getElementById("watchlistUpdated");
  const store = window.KabutaneWatchlist;

  let publicPayload = null;
  let detailMap = new Map();

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function number(value, digits = 1) {
    const n = finite(value);
    return n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function signed(value, suffix = "%", digits = 1) {
    const n = finite(value);
    if (n === null) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  }

  function statusLabel(value) {
    return ({ GC: "暫定GC", NEAR_GC: "GC接近", CONTINUE: "継続", DC: "暫定DC", OUT: "OUT側", UNKNOWN: "判定待ち" })[value] || "判定待ち";
  }

  function statusClass(value) {
    return ({ GC: "gc", NEAR_GC: "near", CONTINUE: "continue", DC: "dc", OUT: "out", UNKNOWN: "out" })[value] || "out";
  }

  function prefix(code) {
    const normalized = store?.normalizeCode?.(code) || "";
    return normalized.slice(0, 2);
  }

  async function fetchJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    return response.json();
  }

  async function loadDetails(codes) {
    const groups = [...new Set(codes.map(prefix).filter(Boolean))];
    const shards = await Promise.all(groups.map(async (group) => {
      try {
        return await fetchJson(`data/core/daily/${group}.json`);
      } catch (_) {
        return null;
      }
    }));
    const map = new Map();
    shards.forEach((payload) => {
      Object.entries(payload?.records || {}).forEach(([code, value]) => {
        const normalized = store?.normalizeCode?.(code) || "";
        if (normalized) map.set(normalized, value);
      });
    });
    return map;
  }

  function publicMap() {
    return new Map((publicPayload?.records || []).flatMap((item) => {
      const code = store?.normalizeCode?.(item?.code) || "";
      return code ? [[code, item]] : [];
    }));
  }

  function mergedRows() {
    const byCode = publicMap();
    return (store?.load?.() || []).map((saved) => {
      const pub = byCode.get(saved.code) || {};
      const detail = detailMap.get(saved.code) || {};
      const provisional = detail.provisional_signal || {};
      const technical = detail.technical || {};
      return {
        ...saved,
        ...pub,
        code: saved.code,
        name: String(pub.name || saved.name || "").slice(0, 160),
        current_price: technical.current_price ?? pub.current_price ?? null,
        price_date: String(technical.price_date || detail.price_date || pub.price_date || "").slice(0, 10),
        provisional_status: provisional.status || pub.provisional_status || "UNKNOWN",
        monthly_rsi_spread: provisional.spread ?? null,
        volume_ratio_5_30: technical.volume_ratio_5_30 ?? pub.volume_ratio_5_30 ?? null,
        high52_distance_pct: technical.high52_distance_pct ?? pub.high52_distance_pct ?? null,
        perfect_order: technical.perfect_order ?? pub.perfect_order ?? null,
      };
    });
  }

  function record(rows) {
    rows.forEach((item) => {
      if (!item.price_date) return;
      store.recordObservation(item.code, {
        date: item.price_date,
        price: finite(item.current_price),
        status: item.provisional_status || "UNKNOWN",
        spread: finite(item.monthly_rsi_spread),
        volume: finite(item.volume_ratio_5_30),
      });
    });
  }

  function priorObservation(code, currentDate) {
    const rows = store.observations(code).filter((item) => String(item.date || "") < String(currentDate || ""));
    return rows.at(-1) || null;
  }

  function filteredRows() {
    const query = String(search?.value || "").trim().toLowerCase();
    const mode = sort?.value || "added";
    const rows = mergedRows().filter((item) => {
      if (!query) return true;
      return `${item.code || ""} ${item.name || ""} ${item.market || ""} ${item.sector || ""}`.toLowerCase().includes(query);
    });
    rows.sort((a, b) => {
      if (mode === "code") return String(a.code).localeCompare(String(b.code), "ja", { numeric: true });
      if (mode === "volume") return (finite(b.volume_ratio_5_30) ?? -9999) - (finite(a.volume_ratio_5_30) ?? -9999);
      return String(b.added_at || "").localeCompare(String(a.added_at || ""));
    });
    return rows;
  }

  function render() {
    if (!root || !store) return;
    const all = mergedRows();
    const rows = filteredRows();
    if (count) count.textContent = String(all.length);
    if (empty) empty.hidden = all.length > 0;
    root.hidden = all.length === 0;
    root.innerHTML = rows.map((item) => {
      const code = store.normalizeCode(item.code);
      if (!code) return "";
      const previous = priorObservation(code, item.price_date);
      const price = finite(item.current_price);
      const previousPrice = finite(previous?.price);
      const priceChange = price !== null && previousPrice !== null && previousPrice !== 0 ? (price / previousPrice - 1) * 100 : null;
      const volume = finite(item.volume_ratio_5_30);
      const spread = finite(item.monthly_rsi_spread);
      const safeCode = escapeHtml(code);
      const safeName = escapeHtml(item.name || "");
      const safeMarket = escapeHtml(item.market || "市場 —");
      const safeSector = escapeHtml(item.sector || "セクター —");
      const safeDate = escapeHtml(item.price_date || "—");
      return `<article class="watch-card" data-code="${safeCode}">
        <div class="watch-card-main"><a href="detail.html?code=${encodeURIComponent(code)}">${safeCode} ${safeName}</a><small>${safeMarket} / ${safeSector}</small></div>
        <div class="watch-stat"><span>月足</span><strong class="watch-status ${statusClass(item.provisional_status)}">${statusLabel(item.provisional_status)}</strong>${spread === null ? "" : `<small>RSI差 ${signed(spread, "pt", 1)}</small>`}</div>
        <div class="watch-stat"><span>現在値</span><strong>${number(price, 2)}円</strong>${priceChange === null ? `<small>${safeDate}</small>` : `<small class="${priceChange >= 0 ? "watch-delta-up" : "watch-delta-down"}">前回確認比 ${signed(priceChange, "%", 1)}</small>`}</div>
        <div class="watch-stat"><span>出来高</span><strong>${volume === null ? "—" : `${number(volume, 2)}倍`}</strong><small>5日 / 30日平均</small></div>
        <div class="watch-stat"><span>52週高値比</span><strong>${signed(item.high52_distance_pct, "%", 1)}</strong><small>${item.perfect_order === true ? "上昇配列" : "配列未成立"}</small></div>
        <div class="watch-stat"><span>財務</span><strong>${item.fundamentals_available === true ? `ROE ${number(item.roe_pct, 1)}%` : "取得待ち"}</strong><small>${item.fundamentals_available === true ? `自己資本 ${number(item.equity_ratio_pct, 1)}%` : "—"}</small></div>
        <button type="button" class="watch-remove" data-remove-code="${safeCode}">外す</button>
      </article>`;
    }).join("");
    root.querySelectorAll("[data-remove-code]").forEach((button) => {
      button.addEventListener("click", () => {
        store.remove(button.dataset.removeCode || "");
        render();
      });
    });
  }

  async function init() {
    if (!store) return;
    const saved = store.load();
    if (count) count.textContent = String(saved.length);
    if (!saved.length) {
      render();
      return;
    }
    try {
      [publicPayload, detailMap] = await Promise.all([
        fetchJson("data/core/public-radar.json"),
        loadDetails(saved.map((item) => item.code)),
      ]);
      const rows = mergedRows();
      record(rows);
      if (updated) {
        const latest = rows.reduce((value, item) => String(item.price_date || "") > value ? String(item.price_date) : value, "");
        updated.textContent = latest ? `株価 ${latest}` : "更新日 —";
      }
      render();
    } catch (error) {
      if (updated) updated.textContent = "データ取得に失敗";
      render();
    }
  }

  search?.addEventListener("input", render);
  sort?.addEventListener("change", render);
  window.addEventListener("kabutane:watchlist-change", render);
  init();
})();
