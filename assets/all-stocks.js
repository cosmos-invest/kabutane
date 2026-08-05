(() => {
  "use strict";

  const rowsEl = document.getElementById("allStocksRows");
  const emptyEl = document.getElementById("allStocksEmpty");
  const totalEl = document.getElementById("allStocksTotal");
  const coverageEl = document.getElementById("allStocksCoverage");
  const dataDateEl = document.getElementById("allStocksDataDate");
  const resultTextEl = document.getElementById("allStocksResultText");
  const summaryEl = document.getElementById("allStocksSummary");
  const searchEl = document.getElementById("allStocksSearch");
  const marketEl = document.getElementById("allStocksMarket");
  const trendEl = document.getElementById("allStocksTrend");
  const sortEl = document.getElementById("allStocksSort");
  const moreEl = document.getElementById("allStocksMore");
  const signalButtons = [...document.querySelectorAll("[data-signal]")];

  let payload = null;
  let signalFilter = "ALL";
  let visibleLimit = 100;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function number(value, digits = 1) {
    const n = finite(value);
    return n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function signed(value, suffix = "pt", digits = 1) {
    const n = finite(value);
    if (n === null) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  }

  function latestPriceDate(records) {
    return (Array.isArray(records) ? records : []).reduce((latest, item) => {
      const value = String(item?.price_date || "");
      return value > latest ? value : latest;
    }, "");
  }

  function signalLabel(value) {
    return ({
      GC: "暫定GC",
      NEAR_GC: "GC接近",
      CONTINUE: "暫定継続",
      DC: "暫定DC",
      OUT: "OUT側",
      UNKNOWN: "判定待ち",
    })[value] || value || "判定待ち";
  }

  function signalClass(value) {
    return ({
      GC: "signal-gc",
      NEAR_GC: "signal-near",
      CONTINUE: "signal-continue",
      DC: "signal-dc",
      OUT: "signal-out",
      UNKNOWN: "signal-unknown",
    })[value] || "signal-unknown";
  }

  function marketLabel(value) {
    const text = String(value || "");
    if (text.includes("プライム")) return "プライム";
    if (text.includes("スタンダード")) return "スタンダード";
    if (text.includes("グロース")) return "グロース";
    return text || "—";
  }

  function trendPass(item, filter) {
    if (filter === "above200") return item.above_sma200 === true;
    if (filter === "perfect") return item.perfect_order === true;
    if (filter === "volume") return (finite(item.volume_ratio_5_30) ?? 0) >= 1.2;
    if (filter === "finance") return item.fundamentals_available === true;
    return true;
  }

  function filteredRows() {
    if (!payload) return [];
    const query = String(searchEl?.value || "").trim().toLowerCase();
    const market = marketEl?.value || "all";
    const trend = trendEl?.value || "all";
    const sort = sortEl?.value || "code";

    const result = (Array.isArray(payload.records) ? payload.records : []).filter((item) => {
      if (signalFilter !== "ALL" && String(item.provisional_status || "UNKNOWN") !== signalFilter) return false;
      if (market !== "all" && !String(item.market || "").includes(market)) return false;
      if (!trendPass(item, trend)) return false;
      if (query) {
        const haystack = `${item.code || ""} ${item.name || ""} ${item.market || ""} ${item.sector || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      if (sort === "spread_desc") return (finite(b.monthly_rsi_spread) ?? -9999) - (finite(a.monthly_rsi_spread) ?? -9999);
      if (sort === "spread_asc") return (finite(a.monthly_rsi_spread) ?? 9999) - (finite(b.monthly_rsi_spread) ?? 9999);
      if (sort === "volume") return (finite(b.volume_ratio_5_30) ?? -9999) - (finite(a.volume_ratio_5_30) ?? -9999);
      if (sort === "high") return (finite(b.high52_distance_pct) ?? -9999) - (finite(a.high52_distance_pct) ?? -9999);
      if (sort === "price") return (finite(b.current_price) ?? -9999) - (finite(a.current_price) ?? -9999);
      return String(a.code || "").localeCompare(String(b.code || ""), "ja", { numeric: true });
    });
    return result;
  }

  function renderSummary() {
    if (!payload) return;
    const records = Array.isArray(payload.records) ? payload.records : [];
    const counts = payload.status_counts || {};
    const total = Number(payload.core_count || records.length || 0);
    const monthly = Number(payload.monthly_coverage || 0);
    const daily = Number(payload.daily_coverage || 0);
    const priceDate = latestPriceDate(records);

    if (totalEl) totalEl.textContent = total.toLocaleString("ja-JP");
    if (coverageEl) coverageEl.textContent = `日足 ${daily.toLocaleString("ja-JP")} / 月足RSI ${monthly.toLocaleString("ja-JP")}`;
    if (dataDateEl) dataDateEl.textContent = `株価 ${priceDate || "—"}`;
    if (summaryEl) {
      const cards = [
        ["暫定GC", counts.GC || 0, "signal-gc"],
        ["GC接近", counts.NEAR_GC || 0, "signal-near"],
        ["暫定継続", counts.CONTINUE || 0, "signal-continue"],
        ["暫定DC", counts.DC || 0, "signal-dc"],
        ["OUT側", counts.OUT || 0, "signal-out"],
      ];
      summaryEl.innerHTML = cards.map(([label, value, cls]) => `<button type="button" data-summary-signal="${label === "暫定GC" ? "GC" : label === "GC接近" ? "NEAR_GC" : label === "暫定継続" ? "CONTINUE" : label === "暫定DC" ? "DC" : "OUT"}" class="${cls}"><span>${label}</span><strong>${Number(value).toLocaleString("ja-JP")}</strong></button>`).join("");
      summaryEl.querySelectorAll("[data-summary-signal]").forEach((button) => {
        button.addEventListener("click", () => setSignalFilter(button.dataset.summarySignal || "ALL"));
      });
    }
  }

  function renderRows() {
    if (!payload || !rowsEl) return;
    const all = filteredRows();
    const shown = all.slice(0, visibleLimit);

    rowsEl.innerHTML = shown.map((item) => {
      const spread = finite(item.monthly_rsi_spread);
      const volume = finite(item.volume_ratio_5_30);
      const highDistance = finite(item.high52_distance_pct);
      const signal = String(item.provisional_status || "UNKNOWN");
      const trend = [
        item.above_sma200 === true ? "SMA200上" : item.above_sma200 === false ? "SMA200下" : "SMA200 —",
        item.perfect_order === true ? "上昇配列" : "配列未成立",
      ];
      return `<tr>
        <td class="stock-main"><a class="all-stock-link" href="detail.html?code=${encodeURIComponent(item.code || "")}"><strong>${item.code || "—"} ${item.name || ""}</strong><small>${item.sector || "セクター —"}</small></a></td>
        <td><span class="market-chip">${marketLabel(item.market)}</span></td>
        <td><strong>${number(item.current_price, 2)}円</strong><small class="cell-sub">${item.price_date || "—"}</small></td>
        <td><span class="signal-chip ${signalClass(signal)}">${signalLabel(signal)}</span><small class="cell-sub">確定 ${item.confirmed_status || "—"} / ${item.confirmed_month || "—"}</small></td>
        <td><strong>${number(item.monthly_rsi14, 1)}</strong><small class="cell-sub">MA5 ${number(item.monthly_rsi_ma5, 1)} / <span class="${spread !== null && spread < 0 ? "negative" : spread !== null && spread > 0 ? "positive" : ""}">${signed(spread)}</span></small></td>
        <td><div class="mini-stack">${trend.map((value) => `<span>${value}</span>`).join("")}</div></td>
        <td><strong class="${volume !== null && volume >= 1.2 ? "positive" : ""}">${volume === null ? "—" : `${volume.toFixed(2)}倍`}</strong><small class="cell-sub">5日 / 30日平均</small></td>
        <td><strong>${highDistance === null ? "—" : signed(highDistance, "%", 1)}</strong><small class="cell-sub">直近52週高値比</small></td>
      </tr>`;
    }).join("");

    if (resultTextEl) resultTextEl.textContent = `${all.length.toLocaleString("ja-JP")}銘柄に絞り込み / ${Math.min(visibleLimit, all.length).toLocaleString("ja-JP")}件表示`;
    if (emptyEl) emptyEl.hidden = all.length > 0;
    if (moreEl) {
      moreEl.hidden = all.length <= visibleLimit;
      moreEl.textContent = `さらに100件表示（残り ${Math.max(0, all.length - visibleLimit).toLocaleString("ja-JP")}）`;
    }
  }

  function setSignalFilter(value) {
    signalFilter = value || "ALL";
    signalButtons.forEach((button) => {
      const active = button.dataset.signal === signalFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    visibleLimit = 100;
    const url = new URL(location.href);
    if (signalFilter === "ALL") url.searchParams.delete("signal");
    else url.searchParams.set("signal", signalFilter);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    renderRows();
  }

  function resetVisible() {
    visibleLimit = 100;
    renderRows();
  }

  function initialSignalFromUrl() {
    const value = new URL(location.href).searchParams.get("signal");
    return ["GC", "NEAR_GC", "CONTINUE", "DC", "OUT", "UNKNOWN"].includes(value) ? value : "ALL";
  }

  async function init() {
    signalFilter = initialSignalFromUrl();
    signalButtons.forEach((button) => {
      const active = button.dataset.signal === signalFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    try {
      const response = await fetch(`data/core/radar.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
      renderSummary();
      renderRows();
    } catch (error) {
      if (dataDateEl) dataDateEl.textContent = "データ読込エラー";
      if (resultTextEl) resultTextEl.textContent = "全銘柄データを読み込めませんでした。";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = `全銘柄一覧を読み込めませんでした（${String(error.message || error)}）。`;
      }
    }
  }

  signalButtons.forEach((button) => button.addEventListener("click", () => setSignalFilter(button.dataset.signal || "ALL")));
  searchEl?.addEventListener("input", resetVisible);
  marketEl?.addEventListener("change", resetVisible);
  trendEl?.addEventListener("change", resetVisible);
  sortEl?.addEventListener("change", resetVisible);
  moreEl?.addEventListener("click", () => { visibleLimit += 100; renderRows(); });

  window.KabutaneAllStocks = { filteredRows, latestPriceDate, signalLabel, trendPass };
  init();
})();
