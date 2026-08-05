(() => {
  "use strict";

  const tableBody = document.getElementById("dcRows");
  const empty = document.getElementById("dcEmpty");
  const count = document.getElementById("dcCount");
  const dataDate = document.getElementById("dcDataDate");
  const summary = document.getElementById("dcSummary");
  const search = document.getElementById("dcSearch");
  const market = document.getElementById("dcMarket");
  const sort = document.getElementById("dcSort");
  const more = document.getElementById("dcMore");

  let payload = null;
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
    return records.reduce((latest, item) => {
      const value = String(item?.price_date || "");
      return value > latest ? value : latest;
    }, "");
  }

  function dcRows(records) {
    return (Array.isArray(records) ? records : []).filter((item) => item?.provisional_status === "DC");
  }

  function marketLabel(value) {
    const text = String(value || "");
    if (text.includes("プライム")) return "プライム";
    if (text.includes("スタンダード")) return "スタンダード";
    if (text.includes("グロース")) return "グロース";
    return text || "—";
  }

  function filteredRows() {
    if (!payload) return [];
    const query = String(search?.value || "").trim().toLowerCase();
    const marketValue = market?.value || "all";
    const sortValue = sort?.value || "spread";
    const rows = dcRows(payload.records).filter((item) => {
      if (marketValue !== "all" && !String(item.market || "").includes(marketValue)) return false;
      if (!query) return true;
      return `${item.code || ""} ${item.name || ""} ${item.market || ""}`.toLowerCase().includes(query);
    });

    rows.sort((a, b) => {
      if (sortValue === "volume") return (finite(b.volume_ratio_5_30) ?? -9999) - (finite(a.volume_ratio_5_30) ?? -9999);
      if (sortValue === "high") return (finite(b.high52_distance_pct) ?? -9999) - (finite(a.high52_distance_pct) ?? -9999);
      if (sortValue === "code") return String(a.code || "").localeCompare(String(b.code || ""), "ja");
      return (finite(a.monthly_rsi_spread) ?? 9999) - (finite(b.monthly_rsi_spread) ?? 9999);
    });
    return rows;
  }

  function renderSummary() {
    if (!payload) return;
    const all = Array.isArray(payload.records) ? payload.records : [];
    const dcs = dcRows(all);
    const priceDate = latestPriceDate(all);
    if (count) count.textContent = dcs.length.toLocaleString("ja-JP");
    if (dataDate) dataDate.textContent = `株価 ${priceDate || "—"} / 進行中月 ${dcs[0]?.provisional_month || "—"}`;
    if (summary) {
      const core = Number(payload.core_count || all.length || 0);
      const monthly = Number(payload.monthly_coverage || 0);
      const below200 = dcs.filter((item) => item.above_sma200 === false).length;
      const volumeUp = dcs.filter((item) => (finite(item.volume_ratio_5_30) ?? 0) >= 1.2).length;
      summary.innerHTML = [
        ["全通常株", `${core.toLocaleString("ja-JP")}銘柄`],
        ["月足RSI判定可", `${monthly.toLocaleString("ja-JP")}銘柄`],
        ["暫定DC", `${dcs.length.toLocaleString("ja-JP")}銘柄`],
        ["うちSMA200下", `${below200.toLocaleString("ja-JP")}銘柄`],
        ["出来高1.2倍以上", `${volumeUp.toLocaleString("ja-JP")}銘柄`],
      ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    }
  }

  function renderRows() {
    if (!payload || !tableBody) return;
    const all = filteredRows();
    const shown = all.slice(0, visibleLimit);
    tableBody.innerHTML = shown.map((item) => {
      const spread = finite(item.monthly_rsi_spread);
      const volumeRatio = finite(item.volume_ratio_5_30);
      const highDistance = finite(item.high52_distance_pct);
      const trend = [
        item.above_sma200 === true ? "SMA200上" : item.above_sma200 === false ? "SMA200下" : "SMA200 —",
        item.perfect_order === true ? "上昇配列" : "上昇配列なし",
      ];
      return `<tr>
        <td><span class="dc-chip">暫定DC</span><div class="dc-mini"><span>確定 ${item.confirmed_status || "—"}</span><span>${item.confirmed_month || "—"} → ${item.provisional_month || "—"}</span></div></td>
        <td><a class="dc-stock-link" href="detail.html?code=${encodeURIComponent(item.code || "")}">${item.code || "—"} ${item.name || ""}<small>${marketLabel(item.market)}</small></a></td>
        <td><strong>${number(item.current_price, 2)}円</strong><div class="dc-mini"><span>${item.price_date || "—"}</span></div></td>
        <td><strong>${number(item.monthly_rsi14, 1)}</strong><div class="dc-mini"><span>MA5 ${number(item.monthly_rsi_ma5, 1)}</span><span class="${spread !== null && spread < 0 ? "dc-negative" : "dc-muted"}">差 ${signed(spread)}</span></div></td>
        <td><div class="dc-mini">${trend.map((value) => `<span>${value}</span>`).join("")}</div></td>
        <td><div class="dc-mini"><strong class="${volumeRatio !== null && volumeRatio >= 1.2 ? "dc-positive" : ""}">${volumeRatio === null ? "—" : `${volumeRatio.toFixed(2)}倍`}</strong><span>5日平均 / 30日平均</span></div></td>
        <td><div class="dc-mini"><strong>${highDistance === null ? "—" : signed(highDistance, "%", 1)}</strong><span>直近52週高値比</span></div></td>
      </tr>`;
    }).join("");

    if (empty) {
      empty.hidden = all.length > 0;
      empty.textContent = "条件に合う暫定DC銘柄はありません。";
    }
    if (more) {
      more.hidden = all.length <= visibleLimit;
      more.textContent = `さらに表示（残り ${Math.max(0, all.length - visibleLimit).toLocaleString("ja-JP")}）`;
    }
  }

  function resetVisible() {
    visibleLimit = 100;
    renderRows();
  }

  async function init() {
    try {
      const response = await fetch(`data/core/radar.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
      renderSummary();
      renderRows();
    } catch (error) {
      if (dataDate) dataDate.textContent = "データ読込エラー";
      if (count) count.textContent = "—";
      if (empty) {
        empty.hidden = false;
        empty.textContent = `月足DC一覧を読み込めませんでした（${String(error.message || error)}）。`;
      }
    }
  }

  search?.addEventListener("input", resetVisible);
  market?.addEventListener("change", resetVisible);
  sort?.addEventListener("change", resetVisible);
  more?.addEventListener("click", () => { visibleLimit += 100; renderRows(); });

  window.KabutaneMonthlyDC = { dcRows, latestPriceDate };
  init();
})();
