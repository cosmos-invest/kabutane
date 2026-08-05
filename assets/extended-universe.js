(() => {
  "use strict";

  const rows = document.getElementById("extendedRows");
  const empty = document.getElementById("extendedEmpty");
  const summary = document.getElementById("extendedSummary");
  const updated = document.getElementById("extendedUpdated");
  const search = document.getElementById("extendedSearch");
  const type = document.getElementById("extendedType");
  const status = document.getElementById("extendedStatus");
  let payload = null;

  const typeLabels = {
    etf: "ETF",
    etn: "ETN",
    reit: "REIT",
    infrastructure_fund: "インフラ",
    tokyo_pro: "TOKYO PRO",
    foreign_stock: "外国株",
    venture_fund: "ベンチャーファンド",
    country_fund: "カントリーファンド",
    preferred_equity: "優先出資等",
    other_stock: "その他株式",
    other: "その他",
  };

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function number(value, digits = 2) {
    const parsed = finite(value);
    return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function signalLabel(value) {
    if (value === "CONTINUE") return "継続";
    if (value === "INACTIVE") return "対象外";
    return value || "—";
  }

  function populateTypes() {
    if (!payload || !type) return;
    const values = [...new Set((payload.records || []).map((item) => item.instrument_type).filter(Boolean))].sort();
    type.innerHTML = '<option value="all">すべて</option>' + values.map((value) => `<option value="${value}">${typeLabels[value] || value}</option>`).join("");
  }

  function renderSummary() {
    if (!payload || !summary) return;
    const statusCounts = payload.status_counts || {};
    const cards = [
      ["拡張対象", `${Number(payload.requested || 0).toLocaleString("ja-JP")}銘柄`],
      ["月足取得成功", `${Number(payload.covered || 0).toLocaleString("ja-JP")}銘柄`],
      ["取得率", `${number(payload.coverage_pct, 1)}%`],
      ["NEW / 継続", `${Number(statusCounts.NEW || 0)} / ${Number(statusCounts.CONTINUE || 0)}`],
    ];
    summary.innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    if (updated) updated.textContent = `月足のみ・${payload.batch_count || 0} batch`;
  }

  function renderRows() {
    if (!payload || !rows) return;
    const query = String(search?.value || "").trim().toLowerCase();
    const typeValue = type?.value || "all";
    const statusValue = status?.value || "all";
    const visible = (payload.records || []).filter((item) => {
      if (typeValue !== "all" && item.instrument_type !== typeValue) return false;
      if (statusValue !== "all" && item.status !== statusValue) return false;
      if (query) {
        const haystack = `${item.code || ""} ${item.name || ""} ${item.market || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    rows.innerHTML = visible.map((item) => `<tr data-code="${item.code || ""}">
      <td><span class="extended-code">${item.code || "—"}</span></td>
      <td>${item.name || "—"}</td>
      <td><span class="extended-type">${typeLabels[item.instrument_type] || item.instrument_type || "その他"}</span></td>
      <td><span class="extended-signal ${item.status || ""}">${signalLabel(item.status)}</span></td>
      <td>${number(item.close)}</td>
      <td>${number(item.monthly_rsi14)}</td>
      <td>${number(item.monthly_rsi_ma5)}</td>
      <td>${number(item.spread)}</td>
      <td>${item.latest_month || "—"}</td>
    </tr>`).join("");
    if (empty) empty.hidden = visible.length > 0;
    const highlight = new URLSearchParams(location.search).get("code")?.trim().toUpperCase();
    if (highlight) {
      requestAnimationFrame(() => rows.querySelector(`tr[data-code="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: "center" }));
    }
  }

  async function init() {
    try {
      const response = await fetch(`data/extended/latest.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status}`);
      payload = await response.json();
      populateTypes();
      renderSummary();
      renderRows();
    } catch (error) {
      if (updated) updated.textContent = "データ準備中";
      if (summary) summary.innerHTML = '<article><span>状態</span><strong>準備中</strong></article>';
      if (empty) {
        empty.hidden = false;
        empty.textContent = `拡張対象の月足データを読み込めませんでした（${String(error.message || error)}）。`;
      }
    }
  }

  [search, type, status].forEach((element) => element?.addEventListener("input", renderRows));
  init();
})();
