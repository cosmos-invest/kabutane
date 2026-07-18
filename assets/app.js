const state = {
  latest: null,
  monthIndex: [],
  monthData: null,
  selectedMonth: null,
  tab: "active",
  sortKey: "diff",
  sortDirection: "desc",
  page: 1,
  pageSize: 50,
};

const els = {};

function $(id) { return document.getElementById(id); }
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function text(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function number(value, digits = 2) {
  const parsed = finite(value);
  return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}
function signed(value, suffix = "%") {
  const parsed = finite(value);
  if (parsed === null) return "—";
  return `${parsed > 0 ? "+" : ""}${parsed.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${suffix}`;
}
function performanceValue(row) {
  return finite(row.return_since_gc_pct ?? row.return_at_exit_pct);
}
function currentValue(row) {
  return finite(row.current_price ?? row.exit_price ?? row.period_price ?? row.signal_month_close);
}
function statusBadge(status) {
  const normalized = text(status, "—").toUpperCase();
  const css = normalized === "NEW" ? "new" : normalized === "OUT" ? "out" : "continue";
  const label = normalized === "CONTINUE" ? "継続" : normalized;
  return `<span class="badge ${css}">${label}</span>`;
}
function cosmosFocusBadge(row) {
  if (row.cosmos_focus !== true) return "";
  const type = row.cosmos_focus_type === "MVP" ? "MVP加速型" : row.cosmos_focus_type === "BREAKOUT" ? "新高値型" : "両方適合";
  return `<span class="badge cosmos-focus" title="月足RSIツインエンジン戦略：${type}">🌸 コスモス注目</span>`;
}
function performanceClass(value) {
  const parsed = finite(value);
  if (parsed === null || parsed === 0) return "";
  return parsed > 0 ? "positive" : "negative";
}
function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date);
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} の読込に失敗しました (${response.status})`);
  return response.json();
}

function cacheElements() {
  [
    "generatedAt", "signalMonth", "activeCount", "newCount", "outCount", "upCount", "downCount", "cosmosFocusCount", "errorCount",
    "searchInput", "monthSelect", "statusFilter", "performanceFilter", "rsiFilter", "pageSize", "resultSummary",
    "csvDownload", "resultTable", "prevPage", "nextPage", "pageInfo",
  ].forEach((id) => { els[id] = $(id); });
  els.tbody = els.resultTable.querySelector("tbody");
  els.headers = [...els.resultTable.querySelectorAll("th[data-key]")];
  els.tabs = [...document.querySelectorAll(".tab")];
}

function populateMonthSelect() {
  els.monthSelect.innerHTML = "";
  const months = state.monthIndex.length
    ? state.monthIndex
    : [{ month: state.latest.signal_month }];
  months.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.month;
    option.textContent = `${item.month}（対象 ${item.active_count ?? "—"} / NEW ${item.new_count ?? "—"} / OUT ${item.out_count ?? "—"}）`;
    els.monthSelect.appendChild(option);
  });
  state.selectedMonth = state.latest.signal_month;
  els.monthSelect.value = state.selectedMonth;
}

async function selectMonth(month) {
  state.selectedMonth = month;
  state.page = 1;
  if (month === state.latest.signal_month) {
    state.monthData = state.latest;
  } else {
    state.monthData = await fetchJson(`data/months/${month}.json`);
  }
  updateHeader();
  render();
}

function updateHeader() {
  const data = state.monthData || state.latest;
  const summary = data.summary || {};
  els.generatedAt.textContent = state.latest?.generated_at ? `データ生成: ${formatDate(state.latest.generated_at)}` : "データ生成日時 —";
  els.signalMonth.textContent = `判定月 ${state.selectedMonth || state.latest?.signal_month || "—"}`;
  els.activeCount.textContent = number(summary.active_count, 0);
  els.newCount.textContent = number(summary.new_count, 0);
  els.outCount.textContent = number(summary.out_count, 0);
  els.upCount.textContent = number(summary.up_count, 0);
  els.downCount.textContent = number(summary.down_count, 0);
  const focusReady = Object.prototype.hasOwnProperty.call(summary, "cosmos_focus_count");
  els.cosmosFocusCount.textContent = focusReady ? number(summary.cosmos_focus_count, 0) : "更新待ち";
  els.errorCount.textContent = number(state.latest?.summary?.error_count, 0);
}

function sourceRows() {
  const data = state.monthData || state.latest || {};
  const statusFilter = els.statusFilter.value;
  const wantsOut = state.tab === "out" || statusFilter === "OUT";
  let rows = wantsOut ? [...(data.out_records || [])] : [...(data.records || [])];

  if (state.tab === "new") rows = rows.filter((row) => row.status === "NEW");
  if (state.tab === "cosmos") rows = rows.filter((row) => row.cosmos_focus === true);
  if (state.tab === "up") rows = rows.filter((row) => (performanceValue(row) ?? -Infinity) >= 0);
  if (state.tab === "down") rows = rows.filter((row) => (performanceValue(row) ?? Infinity) < 0);

  if (statusFilter !== "ALL" && statusFilter !== "OUT") {
    rows = rows.filter((row) => row.status === statusFilter);
  }

  const performanceFilter = els.performanceFilter.value;
  if (performanceFilter === "UP") rows = rows.filter((row) => (performanceValue(row) ?? -Infinity) >= 0);
  if (performanceFilter === "DOWN") rows = rows.filter((row) => (performanceValue(row) ?? Infinity) < 0);

  const rsiFilter = els.rsiFilter.value;
  if (rsiFilter === "OVER50") rows = rows.filter((row) => (finite(row.rsi14) ?? -Infinity) >= 50);
  if (rsiFilter === "UNDER50") rows = rows.filter((row) => (finite(row.rsi14) ?? Infinity) < 50);

  const query = els.searchInput.value.trim().toLowerCase();
  if (query) {
    rows = rows.filter((row) => `${row.code ?? ""} ${row.name ?? ""} ${row.ticker ?? ""}`.toLowerCase().includes(query));
  }
  return rows;
}

function sortableValue(row, key) {
  if (key === "current_price") return currentValue(row);
  if (key === "return_since_gc_pct") return performanceValue(row);
  const value = row[key];
  const numeric = finite(value);
  return numeric === null ? text(value, "").toLowerCase() : numeric;
}

function sortedRows(rows) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const left = sortableValue(a, state.sortKey);
    const right = sortableValue(b, state.sortKey);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right), "ja", { numeric: true }) * direction;
  });
}

function renderRows(rows) {
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  els.tbody.innerHTML = "";

  if (!pageRows.length) {
    const tr = document.createElement("tr");
    const data = state.monthData || state.latest || {};
    const focusReady = (data.records || []).some((row) => Object.prototype.hasOwnProperty.call(row, "cosmos_focus"));
    const message = state.tab === "cosmos" && !focusReady
      ? "🌸判定データは更新待ちです。マージ後に Update monthly RSI data を実行してください。"
      : "条件に合う銘柄がありません。";
    tr.innerHTML = `<td colspan="19" class="empty-state">${message}</td>`;
    els.tbody.appendChild(tr);
    return;
  }

  pageRows.forEach((row) => {
    const tr = document.createElement("tr");
    const perf = performanceValue(row);
    const code = text(row.code);
    const detailAllowed = state.selectedMonth === state.latest.signal_month && row.status !== "OUT";
    if (detailAllowed) {
      tr.classList.add("clickable");
      tr.addEventListener("click", (event) => {
        if (event.target.closest("a")) return;
        window.location.href = `detail.html?code=${encodeURIComponent(code)}`;
      });
    }
    if (row.cosmos_focus === true) tr.classList.add("cosmos-focus-row");
    tr.innerHTML = `
      <td>${detailAllowed ? `<a class="code-link" href="detail.html?code=${encodeURIComponent(code)}">${code}</a>` : code}</td>
      <td class="company-name">${row.cosmos_focus === true ? "🌸 " : ""}${text(row.name)}</td>
      <td>${statusBadge(row.status)}</td>
      <td>${cosmosFocusBadge(row)}</td>
      <td class="num">${number(row.months_active, 0)}</td>
      <td class="num">${number(row.rsi14)}</td>
      <td class="num">${number(row.rsi5)}</td>
      <td class="num ${performanceClass(row.diff)}">${signed(row.diff, "")}</td>
      <td>${text(row.gc_month)}</td>
      <td class="num">${number(row.gc_price)}</td>
      <td class="num">${number(currentValue(row))}</td>
      <td class="num ${performanceClass(perf)}">${signed(perf)}</td>
      <td class="num">${number(row.per)}</td>
      <td class="num">${number(row.pbr)}</td>
      <td class="num">${number(row.dividend_yield_pct)}</td>
      <td class="num">${number(row.roe_pct)}</td>
      <td class="num">${number(row.equity_ratio_pct)}</td>
      <td class="num">${number(row.market_cap_oku, 0)}</td>
      <td class="num ${performanceClass(row.operating_cashflow_oku)}">${number(row.operating_cashflow_oku, 0)}</td>
    `;
    els.tbody.appendChild(tr);
  });
}

function updateSortHeaders() {
  els.headers.forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
    if (header.dataset.key === state.sortKey) header.classList.add(state.sortDirection === "asc" ? "sort-asc" : "sort-desc");
  });
}

function updateDownloadLink() {
  const isOut = state.tab === "out" || els.statusFilter.value === "OUT";
  if (state.selectedMonth === state.latest.signal_month) {
    els.csvDownload.href = isOut ? "out.csv" : "result.csv";
  } else {
    els.csvDownload.href = `history/${state.selectedMonth}${isOut ? "-out" : ""}.csv`;
  }
}

function render() {
  const rows = sortedRows(sourceRows());
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  renderRows(rows);
  updateSortHeaders();
  updateDownloadLink();
  els.resultSummary.textContent = `${rows.length.toLocaleString("ja-JP")}件を表示（${state.selectedMonth}）`;
  els.pageInfo.textContent = `${state.page} / ${totalPages}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= totalPages;
}

function bindEvents() {
  els.searchInput.addEventListener("input", () => { state.page = 1; render(); });
  [els.statusFilter, els.performanceFilter, els.rsiFilter].forEach((element) => {
    element.addEventListener("change", () => { state.page = 1; render(); });
  });
  els.pageSize.addEventListener("change", () => {
    state.pageSize = Number(els.pageSize.value);
    state.page = 1;
    render();
  });
  els.monthSelect.addEventListener("change", async () => {
    try { await selectMonth(els.monthSelect.value); }
    catch (error) { showError(error); }
  });
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.tab = tab.dataset.tab;
      state.page = 1;
      render();
    });
  });
  els.headers.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.key;
      if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDirection = ["code", "name", "status", "gc_month"].includes(key) ? "asc" : "desc";
      }
      render();
    });
  });
  els.prevPage.addEventListener("click", () => { state.page -= 1; render(); });
  els.nextPage.addEventListener("click", () => { state.page += 1; render(); });
}

function showError(error) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = `データを読み込めませんでした: ${error.message}`;
  document.querySelector("main").prepend(banner);
  console.error(error);
}

async function init() {
  cacheElements();
  bindEvents();
  try {
    const [latest, monthIndex] = await Promise.all([
      fetchJson("data/latest.json"),
      fetchJson("data/months/index.json").catch(() => []),
    ]);
    state.latest = latest;
    state.monthIndex = monthIndex;
    state.monthData = latest;
    populateMonthSelect();
    updateHeader();
    render();
  } catch (error) {
    showError(error);
    els.resultSummary.textContent = "データ未生成です。GitHub Actionsを実行してください。";
  }
}

document.addEventListener("DOMContentLoaded", init);
