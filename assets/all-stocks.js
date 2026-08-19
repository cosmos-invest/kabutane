(() => {
  "use strict";

  function injectDividendControls() {
    const grid = document.querySelector(".expert-grid");
    if (grid && !document.getElementById("allStocksDividendStreakMin")) {
      grid.insertAdjacentHTML("beforeend", `
        <label>配当利回り 最低%
          <input id="allStocksDividendYieldMin" type="number" inputmode="decimal" placeholder="例 3" step="0.5" min="0">
        </label>
        <label>連続増配
          <select id="allStocksDividendStreakMin">
            <option value="">指定なし</option>
            <option value="1">1年以上</option>
            <option value="2">2年以上</option>
            <option value="3">3年以上</option>
            <option value="5">5年以上</option>
          </select>
        </label>
        <label>直近5年の減配
          <select id="allStocksDividendNoCut">
            <option value="all">指定なし</option>
            <option value="yes">減配なし</option>
          </select>
        </label>
        <label>5年配当成長率 最低%
          <select id="allStocksDividendGrowthMin">
            <option value="">指定なし</option>
            <option value="0">0%以上</option>
            <option value="3">3%以上 / 年</option>
            <option value="5">5%以上 / 年</option>
            <option value="10">10%以上 / 年</option>
          </select>
        </label>`);
    }
    const sort = document.getElementById("allStocksSort");
    if (sort && !sort.querySelector('option[value="dividend-streak"]')) {
      sort.insertAdjacentHTML("beforeend", '<option value="dividend-streak">連続増配が長い順</option><option value="dividend-growth">5年配当成長率が高い順</option><option value="dividend-yield">配当利回りが高い順</option>');
    }
    const lastHeader = document.querySelector(".all-stocks-table thead th:last-child");
    if (lastHeader && lastHeader.textContent.trim() === "財務") lastHeader.textContent = "財務・配当";
  }

  injectDividendControls();

  const rowsEl = document.getElementById("allStocksRows");
  const emptyEl = document.getElementById("allStocksEmpty");
  const totalEl = document.getElementById("allStocksTotal");
  const coverageEl = document.getElementById("allStocksCoverage");
  const dataDateEl = document.getElementById("allStocksDataDate");
  const resultTextEl = document.getElementById("allStocksResultText");
  const summaryEl = document.getElementById("allStocksSummary");
  const searchEl = document.getElementById("allStocksSearch");
  const marketEl = document.getElementById("allStocksMarket");
  const signalEl = document.getElementById("allStocksSignal");
  const sma200El = document.getElementById("allStocksSma200");
  const perfectEl = document.getElementById("allStocksPerfect");
  const volumeMinEl = document.getElementById("allStocksVolumeMin");
  const highMinEl = document.getElementById("allStocksHighMin");
  const financeEl = document.getElementById("allStocksFinance");
  const roeMinEl = document.getElementById("allStocksRoeMin");
  const equityMinEl = document.getElementById("allStocksEquityMin");
  const revenueMinEl = document.getElementById("allStocksRevenueMin");
  const perMaxEl = document.getElementById("allStocksPerMax");
  const fcfEl = document.getElementById("allStocksFcf");
  const dividendYieldMinEl = document.getElementById("allStocksDividendYieldMin");
  const dividendStreakMinEl = document.getElementById("allStocksDividendStreakMin");
  const dividendNoCutEl = document.getElementById("allStocksDividendNoCut");
  const dividendGrowthMinEl = document.getElementById("allStocksDividendGrowthMin");
  const sortEl = document.getElementById("allStocksSort");
  const moreEl = document.getElementById("allStocksMore");
  const guideResetEl = document.getElementById("allStocksGuideReset");
  const expertResetEl = document.getElementById("allStocksExpertReset");
  const guideButtons = [...document.querySelectorAll("[data-guide]")];

  let payload = null;
  let guideFilter = "all";
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

  function signed(value, suffix = "%", digits = 1) {
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

  function publicStatus(item) {
    const raw = String(item?.provisional_status || "UNKNOWN").toUpperCase();
    if (raw === "GC") {
      const confirmed = String(item?.confirmed_status || "OUT").toUpperCase();
      return ["NEW", "CONTINUE"].includes(confirmed) ? "CONTINUE" : "OUT";
    }
    return ["NEAR_GC", "CONTINUE", "DC", "OUT", "UNKNOWN"].includes(raw) ? raw : "UNKNOWN";
  }

  function signalLabel(value) {
    return ({ NEAR_GC: "GC接近", CONTINUE: "継続", DC: "暫定DC", OUT: "OUT側", UNKNOWN: "判定待ち" })[value] || "判定待ち";
  }

  function signalClass(value) {
    return ({ NEAR_GC: "signal-near", CONTINUE: "signal-continue", DC: "signal-dc", OUT: "signal-out", UNKNOWN: "signal-unknown" })[value] || "signal-unknown";
  }

  function marketLabel(value) {
    const text = String(value || "");
    if (text.includes("プライム")) return "プライム";
    if (text.includes("スタンダード")) return "スタンダード";
    if (text.includes("グロース")) return "グロース";
    return text || "—";
  }

  function guidePass(item, guide) {
    const status = publicStatus(item);
    const volume = finite(item.volume_ratio_5_30);
    const high = finite(item.high52_distance_pct);
    if (guide === "cosmos") return status === "CONTINUE" && item.above_sma200 === true && item.perfect_order === true && high !== null && high >= -15;
    if (guide === "lumo") return ["NEAR_GC", "CONTINUE"].includes(status) && item.above_sma25 === true && item.above_sma75 === true && volume !== null && volume >= 1.2 && high !== null && high >= -12;
    if (guide === "aile") {
      if (item.fundamentals_available !== true || item.above_sma200 !== true) return false;
      const checks = [
        finite(item.equity_ratio_pct) !== null && finite(item.equity_ratio_pct) >= 40,
        finite(item.roe_pct) !== null && finite(item.roe_pct) >= 8,
        finite(item.free_cashflow_oku) !== null && finite(item.free_cashflow_oku) > 0,
        finite(item.revenue_growth_pct) !== null && finite(item.revenue_growth_pct) >= 0,
      ];
      return checks.filter(Boolean).length >= 3;
    }
    return true;
  }

  function expertFilters() {
    return {
      market: marketEl?.value || "all",
      signal: signalEl?.value || "ALL",
      sma200: sma200El?.value || "all",
      perfect: perfectEl?.value || "all",
      volumeMin: finite(volumeMinEl?.value),
      highMin: finite(highMinEl?.value),
      finance: financeEl?.value || "all",
      roeMin: finite(roeMinEl?.value),
      equityMin: finite(equityMinEl?.value),
      revenueMin: finite(revenueMinEl?.value),
      perMax: finite(perMaxEl?.value),
      fcf: fcfEl?.value || "all",
      dividendYieldMin: finite(dividendYieldMinEl?.value),
      dividendStreakMin: finite(dividendStreakMinEl?.value),
      dividendNoCut: dividendNoCutEl?.value || "all",
      dividendGrowthMin: finite(dividendGrowthMinEl?.value),
      sort: sortEl?.value || "code",
    };
  }

  function expertPass(item, filters) {
    if (filters.market !== "all" && !String(item.market || "").includes(filters.market)) return false;
    if (filters.signal !== "ALL" && publicStatus(item) !== filters.signal) return false;
    if (filters.sma200 === "above" && item.above_sma200 !== true) return false;
    if (filters.sma200 === "below" && item.above_sma200 !== false) return false;
    if (filters.perfect === "yes" && item.perfect_order !== true) return false;
    if (filters.perfect === "no" && item.perfect_order === true) return false;
    if (filters.volumeMin !== null && (finite(item.volume_ratio_5_30) === null || finite(item.volume_ratio_5_30) < filters.volumeMin)) return false;
    if (filters.highMin !== null && (finite(item.high52_distance_pct) === null || finite(item.high52_distance_pct) < filters.highMin)) return false;
    if (filters.finance === "yes" && item.fundamentals_available !== true) return false;
    if (filters.roeMin !== null && (finite(item.roe_pct) === null || finite(item.roe_pct) < filters.roeMin)) return false;
    if (filters.equityMin !== null && (finite(item.equity_ratio_pct) === null || finite(item.equity_ratio_pct) < filters.equityMin)) return false;
    if (filters.revenueMin !== null && (finite(item.revenue_growth_pct) === null || finite(item.revenue_growth_pct) < filters.revenueMin)) return false;
    if (filters.perMax !== null && (finite(item.per) === null || finite(item.per) > filters.perMax)) return false;
    if (filters.fcf === "positive" && (finite(item.free_cashflow_oku) === null || finite(item.free_cashflow_oku) <= 0)) return false;
    if (filters.dividendYieldMin !== null && (finite(item.dividend_yield_pct) === null || finite(item.dividend_yield_pct) < filters.dividendYieldMin)) return false;
    if (filters.dividendStreakMin !== null && (finite(item.consecutive_dividend_increase_years) === null || finite(item.consecutive_dividend_increase_years) < filters.dividendStreakMin)) return false;
    if (filters.dividendNoCut === "yes" && item.dividend_no_cut_5y !== true) return false;
    if (filters.dividendGrowthMin !== null && (finite(item.dividend_cagr_5y_pct) === null || finite(item.dividend_cagr_5y_pct) < filters.dividendGrowthMin)) return false;
    return true;
  }

  function currentQuery() { return String(searchEl?.value || "").trim().toLowerCase(); }

  function filteredRows() {
    if (!payload) return [];
    const query = currentQuery();
    const filters = expertFilters();
    const result = (Array.isArray(payload.records) ? payload.records : []).filter((item) => {
      if (["cosmos", "lumo", "aile"].includes(guideFilter) && !guidePass(item, guideFilter)) return false;
      if (!expertPass(item, filters)) return false;
      if (query) {
        const haystack = `${item.code || ""} ${item.name || ""} ${item.market || ""} ${item.sector || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      if (filters.sort === "volume") return (finite(b.volume_ratio_5_30) ?? -9999) - (finite(a.volume_ratio_5_30) ?? -9999);
      if (filters.sort === "high") return (finite(b.high52_distance_pct) ?? -9999) - (finite(a.high52_distance_pct) ?? -9999);
      if (filters.sort === "price") return (finite(b.current_price) ?? -9999) - (finite(a.current_price) ?? -9999);
      if (filters.sort === "roe") return (finite(b.roe_pct) ?? -9999) - (finite(a.roe_pct) ?? -9999);
      if (filters.sort === "equity") return (finite(b.equity_ratio_pct) ?? -9999) - (finite(a.equity_ratio_pct) ?? -9999);
      if (filters.sort === "per") return (finite(a.per) ?? 999999) - (finite(b.per) ?? 999999);
      if (filters.sort === "dividend-streak") return (finite(b.consecutive_dividend_increase_years) ?? -1) - (finite(a.consecutive_dividend_increase_years) ?? -1);
      if (filters.sort === "dividend-growth") return (finite(b.dividend_cagr_5y_pct) ?? -9999) - (finite(a.dividend_cagr_5y_pct) ?? -9999);
      if (filters.sort === "dividend-yield") return (finite(b.dividend_yield_pct) ?? -9999) - (finite(a.dividend_yield_pct) ?? -9999);
      return String(a.code || "").localeCompare(String(b.code || ""), "ja", { numeric: true });
    });
    return result;
  }

  function renderGuideCounts(records) {
    [["cosmos", "cosmosGuideCount"], ["lumo", "lumoGuideCount"], ["aile", "aileGuideCount"]].forEach(([guide, id]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = `${records.filter((item) => guidePass(item, guide)).length.toLocaleString("ja-JP")}社`;
    });
  }

  function renderSummary() {
    if (!payload) return;
    const records = Array.isArray(payload.records) ? payload.records : [];
    const total = Number(payload.core_count || records.length || 0);
    const monthly = Number(payload.monthly_coverage || 0);
    const daily = Number(payload.daily_coverage || 0);
    const dividendCoverage = Number(payload.dividend_history_coverage || 0);
    const priceDate = latestPriceDate(records);
    if (totalEl) totalEl.textContent = total.toLocaleString("ja-JP");
    if (coverageEl) coverageEl.textContent = `日足 ${daily.toLocaleString("ja-JP")} / 月足RSI ${monthly.toLocaleString("ja-JP")}${dividendCoverage ? ` / 配当履歴 ${dividendCoverage.toLocaleString("ja-JP")}` : ""}`;
    if (dataDateEl) dataDateEl.textContent = `株価 ${priceDate || "—"}`;
    renderGuideCounts(records);

    if (summaryEl) {
      const counts = { NEAR_GC: 0, CONTINUE: 0, DC: 0, OUT: 0, UNKNOWN: 0 };
      records.forEach((item) => { counts[publicStatus(item)] = (counts[publicStatus(item)] || 0) + 1; });
      const cards = [["GC接近", counts.NEAR_GC, "NEAR_GC", "signal-near"], ["継続", counts.CONTINUE, "CONTINUE", "signal-continue"], ["暫定DC", counts.DC, "DC", "signal-dc"], ["OUT側", counts.OUT, "OUT", "signal-out"], ["判定待ち", counts.UNKNOWN, "UNKNOWN", "signal-unknown"]];
      summaryEl.innerHTML = cards.map(([label, value, signal, cls]) => `<button type="button" data-summary-signal="${signal}" class="${cls}"><span>${label}</span><strong>${Number(value || 0).toLocaleString("ja-JP")}</strong></button>`).join("");
      summaryEl.querySelectorAll("[data-summary-signal]").forEach((button) => button.addEventListener("click", () => {
        setGuide("custom", false);
        if (signalEl) signalEl.value = button.dataset.summarySignal || "ALL";
        visibleLimit = 100;
        syncUrl();
        renderRows();
      }));
    }
  }

  function renderFinance(item) {
    const chips = [];
    if (item.fundamentals_available === true) {
      chips.push(`PER ${number(item.per, 1)}`, `ROE ${number(item.roe_pct, 1)}%`, `自己資本 ${number(item.equity_ratio_pct, 1)}%`);
    }
    const yieldPct = finite(item.dividend_yield_pct);
    const streak = finite(item.consecutive_dividend_increase_years);
    if (yieldPct !== null) chips.push(`配当 ${number(yieldPct, 2)}%`);
    if (streak !== null && streak > 0) chips.push(`${number(streak, 0)}年増配`);
    else if (item.dividend_no_cut_5y === true) chips.push("5年減配なし");
    return chips.length ? `<div class="finance-mini">${chips.map((value) => `<span>${value}</span>`).join("")}</div>` : '<span class="finance-muted">取得待ち / 取得不可</span>';
  }

  function renderRows() {
    if (!payload || !rowsEl) return;
    const all = filteredRows();
    const shown = all.slice(0, visibleLimit);
    rowsEl.innerHTML = shown.map((item) => {
      const volume = finite(item.volume_ratio_5_30);
      const highDistance = finite(item.high52_distance_pct);
      const status = publicStatus(item);
      const trend = [item.above_sma200 === true ? "SMA200上" : item.above_sma200 === false ? "SMA200下" : "SMA200 —", item.perfect_order === true ? "上昇配列" : "配列未成立"];
      return `<tr>
        <td class="stock-main"><a class="all-stock-link" href="detail.html?code=${encodeURIComponent(item.code || "")}"><strong>${item.code || "—"} ${item.name || ""}</strong><small>${item.sector || "セクター —"}</small></a></td>
        <td><span class="market-chip">${marketLabel(item.market)}</span></td>
        <td><strong>${number(item.current_price, 2)}円</strong><small class="cell-sub">${item.price_date || "—"}</small></td>
        <td><span class="signal-chip ${signalClass(status)}">${signalLabel(status)}</span><small class="cell-sub">確定 ${item.confirmed_status || "—"} / ${item.confirmed_month || "—"}</small></td>
        <td><div class="mini-stack">${trend.map((value) => `<span>${value}</span>`).join("")}</div></td>
        <td><strong class="${volume !== null && volume >= 1.2 ? "positive" : ""}">${volume === null ? "—" : `${volume.toFixed(2)}倍`}</strong><small class="cell-sub">5日 / 30日平均</small></td>
        <td><strong>${highDistance === null ? "—" : signed(highDistance, "%", 1)}</strong><small class="cell-sub">直近52週高値比</small></td>
        <td>${renderFinance(item)}</td>
      </tr>`;
    }).join("");
    const guideName = ({ cosmos: "コスモス🌸", lumo: "ルーモ✨", aile: "エール💜", custom: "玄人設定", all: "全銘柄" })[guideFilter] || "全銘柄";
    if (resultTextEl) resultTextEl.textContent = `${guideName}：${all.length.toLocaleString("ja-JP")}銘柄 / ${Math.min(visibleLimit, all.length).toLocaleString("ja-JP")}件表示`;
    if (emptyEl) emptyEl.hidden = all.length > 0;
    if (moreEl) {
      moreEl.hidden = all.length <= visibleLimit;
      moreEl.textContent = `さらに100件表示（残り ${Math.max(0, all.length - visibleLimit).toLocaleString("ja-JP")}）`;
    }
  }

  function updateGuideButtons() {
    guideButtons.forEach((button) => {
      const active = button.dataset.guide === guideFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function resetExpertInputs() {
    if (marketEl) marketEl.value = "all";
    if (signalEl) signalEl.value = "ALL";
    if (sma200El) sma200El.value = "all";
    if (perfectEl) perfectEl.value = "all";
    if (volumeMinEl) volumeMinEl.value = "";
    if (highMinEl) highMinEl.value = "";
    if (financeEl) financeEl.value = "all";
    if (roeMinEl) roeMinEl.value = "";
    if (equityMinEl) equityMinEl.value = "";
    if (revenueMinEl) revenueMinEl.value = "";
    if (perMaxEl) perMaxEl.value = "";
    if (fcfEl) fcfEl.value = "all";
    if (dividendYieldMinEl) dividendYieldMinEl.value = "";
    if (dividendStreakMinEl) dividendStreakMinEl.value = "";
    if (dividendNoCutEl) dividendNoCutEl.value = "all";
    if (dividendGrowthMinEl) dividendGrowthMinEl.value = "";
    if (sortEl) sortEl.value = "code";
  }

  function syncUrl() {
    const url = new URL(location.href);
    if (["cosmos", "lumo", "aile"].includes(guideFilter)) url.searchParams.set("guide", guideFilter); else url.searchParams.delete("guide");
    const signal = signalEl?.value || "ALL";
    if (signal !== "ALL") url.searchParams.set("signal", signal); else url.searchParams.delete("signal");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function setGuide(value, resetExpert = true) {
    guideFilter = ["cosmos", "lumo", "aile", "custom", "all"].includes(value) ? value : "all";
    if (resetExpert && guideFilter !== "custom") resetExpertInputs();
    updateGuideButtons();
    visibleLimit = 100;
    syncUrl();
    renderRows();
  }

  function onExpertChange() {
    guideFilter = "custom";
    updateGuideButtons();
    visibleLimit = 100;
    syncUrl();
    renderRows();
  }

  function initialStateFromUrl() {
    const url = new URL(location.href);
    const guide = url.searchParams.get("guide");
    const signal = url.searchParams.get("signal");
    if (["cosmos", "lumo", "aile"].includes(guide)) guideFilter = guide;
    if (["NEAR_GC", "CONTINUE", "DC", "OUT", "UNKNOWN"].includes(signal)) {
      if (signalEl) signalEl.value = signal;
      guideFilter = "custom";
    }
  }

  async function init() {
    initialStateFromUrl();
    updateGuideButtons();
    try {
      const response = await fetch(`data/core/public-radar.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
      renderSummary();
      renderRows();
    } catch (error) {
      if (dataDateEl) dataDateEl.textContent = "データ読込エラー";
      if (resultTextEl) resultTextEl.textContent = "全銘柄データを読み込めませんでした。";
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = `全銘柄一覧を読み込めませんでした（${String(error.message || error)}）。`; }
    }
  }

  guideButtons.forEach((button) => button.addEventListener("click", () => setGuide(button.dataset.guide || "all")));
  guideResetEl?.addEventListener("click", () => setGuide("all"));
  expertResetEl?.addEventListener("click", () => { resetExpertInputs(); setGuide("all", false); });
  searchEl?.addEventListener("input", () => { visibleLimit = 100; renderRows(); });
  [marketEl, signalEl, sma200El, perfectEl, volumeMinEl, highMinEl, financeEl, roeMinEl, equityMinEl, revenueMinEl, perMaxEl, fcfEl, dividendYieldMinEl, dividendStreakMinEl, dividendNoCutEl, dividendGrowthMinEl, sortEl].forEach((element) => {
    element?.addEventListener(element?.tagName === "INPUT" ? "input" : "change", onExpertChange);
  });
  moreEl?.addEventListener("click", () => { visibleLimit += 100; renderRows(); });

  window.KabutaneAllStocks = { filteredRows, latestPriceDate, publicStatus, signalLabel, guidePass, expertPass };
  init();
})();
