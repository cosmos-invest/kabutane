const state = {
  data: null,
  rows: [],
  pattern: "ALL",
  sortKey: "start_month",
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
function escapeHtml(value) {
  return String(value ?? "—").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function number(value, digits = 2) {
  const parsed = finite(value);
  return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}
function signed(value) {
  const parsed = finite(value);
  return parsed === null ? "—" : `${parsed > 0 ? "+" : ""}${number(parsed)}%`;
}
function performanceClass(value) {
  const parsed = finite(value);
  if (parsed === null || parsed === 0) return "";
  return parsed > 0 ? "positive" : "negative";
}
function directionLabel(value) { return value === true ? "上向き" : value === false ? "横ばい・下向き" : "—"; }
function positionLabel(value) { return value === true ? "株価が上" : value === false ? "株価が下" : "—"; }
function yesNoLabel(value) { return value === true ? "適合" : value === false ? "条件外" : "—"; }
function booleanClass(value) { return value === true ? "positive" : value === false ? "negative" : ""; }
function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date);
}
function inputNumber(element) {
  if (element.value.trim() === "") return null;
  return finite(element.value);
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function stats(rows) {
  const values = rows.map((row) => finite(row.return_pct)).filter((value) => value !== null);
  return {
    count: rows.length,
    valued: values.length,
    average: mean(values),
    median: median(values),
    winRate: values.length ? values.filter((value) => value > 0).length / values.length * 100 : null,
    max: values.length ? Math.max(...values) : null,
    min: values.length ? Math.min(...values) : null,
    averageDuration: mean(rows.map((row) => finite(row.duration_months)).filter((value) => value !== null)),
  };
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} の読込に失敗しました (${response.status})`);
  return response.json();
}

function cacheElements() {
  [
    "generatedAt", "priceBasis", "technicalBasis", "fundamentalBasis", "startMonth", "endMonth",
    "rsi5Min", "rsi5Max", "rsi14Min", "rsi14Max", "rsi5Trend", "rsi14Trend", "returnMin", "returnMax", "searchInput",
    "priceVsSma25", "priceVsSma75", "priceVsSma200", "perfectOrder", "sma25Trend", "sma75Trend", "sma200Trend",
    "roeMin", "roeMax", "revenueGrowthMin", "revenueGrowthMax", "equityRatioMin", "equityRatioMax", "operatingCf", "freeCf",
    "marketCapMin", "marketCapMax", "volumeMin", "volumeMax", "presetArticle", "resetFilters",
    "allAverage", "allDetail", "closedAverage", "closedDetail", "activeAverage", "activeDetail",
    "statCount", "statAverage", "statMedian", "statWinRate", "statMax", "statMin", "returnBuckets", "distributionCaption",
    "cohortBody", "resultSummary", "pageSize", "episodeTable", "prevPage", "nextPage", "pageInfo",
  ].forEach((id) => { els[id] = $(id); });
  els.tbody = els.episodeTable.querySelector("tbody");
  els.headers = [...els.episodeTable.querySelectorAll("th[data-key]")];
  els.patternCards = [...document.querySelectorAll("[data-pattern]")];
}

function populateMonths() {
  const months = [...new Set(state.rows.map((row) => row.start_month))].sort();
  [els.startMonth, els.endMonth].forEach((select) => { select.innerHTML = ""; });
  months.forEach((month) => {
    [els.startMonth, els.endMonth].forEach((select) => {
      const option = document.createElement("option");
      option.value = month;
      option.textContent = month;
      select.appendChild(option);
    });
  });
  if (months.length) {
    els.startMonth.value = months[0];
    els.endMonth.value = months[months.length - 1];
  }
}

function matchesRange(row, key, minimumElement, maximumElement) {
  const value = finite(row[key]);
  const minimum = inputNumber(minimumElement);
  const maximum = inputNumber(maximumElement);
  if (minimum !== null && (value === null || value < minimum)) return false;
  if (maximum !== null && (value === null || value > maximum)) return false;
  return true;
}

function matchesDirection(value, selection) {
  if (selection === "all") return true;
  if (value !== true && value !== false) return false;
  return selection === "up" ? value === true : value === false;
}

function matchesPosition(value, selection) {
  if (selection === "all") return true;
  if (value !== true && value !== false) return false;
  return selection === "above" ? value === true : value === false;
}

function matchesYesNo(value, selection) {
  if (selection === "all") return true;
  if (value !== true && value !== false) return false;
  return selection === "yes" ? value === true : value === false;
}

function matchesPositive(value, selection) {
  if (selection === "all") return true;
  const parsed = finite(value);
  if (parsed === null) return false;
  return selection === "positive" ? parsed > 0 : parsed <= 0;
}

function baseRows() {
  const start = els.startMonth.value;
  const end = els.endMonth.value;
  const query = els.searchInput.value.trim().toLowerCase();

  return state.rows.filter((row) => {
    if (start && row.start_month < start) return false;
    if (end && row.start_month > end) return false;
    if (!matchesRange(row, "start_rsi5", els.rsi5Min, els.rsi5Max)) return false;
    if (!matchesRange(row, "start_rsi14", els.rsi14Min, els.rsi14Max)) return false;
    if (!matchesRange(row, "return_pct", els.returnMin, els.returnMax)) return false;
    if (!matchesDirection(row.start_rsi5_up, els.rsi5Trend.value)) return false;
    if (!matchesDirection(row.start_rsi14_up, els.rsi14Trend.value)) return false;
    if (!matchesPosition(row.start_price_above_sma25, els.priceVsSma25.value)) return false;
    if (!matchesPosition(row.start_price_above_sma75, els.priceVsSma75.value)) return false;
    if (!matchesPosition(row.start_price_above_sma200, els.priceVsSma200.value)) return false;
    if (!matchesYesNo(row.start_perfect_order, els.perfectOrder.value)) return false;
    if (!matchesDirection(row.start_sma25_up, els.sma25Trend.value)) return false;
    if (!matchesDirection(row.start_sma75_up, els.sma75Trend.value)) return false;
    if (!matchesDirection(row.start_sma200_up, els.sma200Trend.value)) return false;
    if (!matchesRange(row, "roe_pct", els.roeMin, els.roeMax)) return false;
    if (!matchesRange(row, "revenue_growth_pct", els.revenueGrowthMin, els.revenueGrowthMax)) return false;
    if (!matchesRange(row, "equity_ratio_pct", els.equityRatioMin, els.equityRatioMax)) return false;
    if (!matchesRange(row, "market_cap_oku", els.marketCapMin, els.marketCapMax)) return false;
    if (!matchesRange(row, "start_avg_volume30", els.volumeMin, els.volumeMax)) return false;
    if (!matchesPositive(row.operating_cashflow_oku, els.operatingCf.value)) return false;
    if (!matchesPositive(row.free_cashflow_oku, els.freeCf.value)) return false;
    if (query && !`${row.code ?? ""} ${row.ticker ?? ""} ${row.name ?? ""}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function patternRows(rows, pattern = state.pattern) {
  return pattern === "ALL" ? rows : rows.filter((row) => row.status === pattern);
}

function renderComparison(rows) {
  const configs = [
    ["ALL", els.allAverage, els.allDetail],
    ["CLOSED", els.closedAverage, els.closedDetail],
    ["ACTIVE", els.activeAverage, els.activeDetail],
  ];
  configs.forEach(([pattern, averageElement, detailElement]) => {
    const result = stats(patternRows(rows, pattern));
    averageElement.textContent = signed(result.average);
    averageElement.className = performanceClass(result.average);
    detailElement.textContent = `${result.count.toLocaleString("ja-JP")}件 / プラス ${result.winRate === null ? "—" : `${number(result.winRate, 1)}%`}`;
  });
}

function renderStats(rows) {
  const result = stats(rows);
  els.statCount.textContent = result.count.toLocaleString("ja-JP");
  els.statAverage.textContent = signed(result.average);
  els.statAverage.className = performanceClass(result.average);
  els.statMedian.textContent = signed(result.median);
  els.statWinRate.textContent = result.winRate === null ? "—" : `${number(result.winRate, 1)}%`;
  els.statMax.textContent = signed(result.max);
  els.statMin.textContent = signed(result.min);
  els.distributionCaption.textContent = `平均保有 ${result.averageDuration === null ? "—" : number(result.averageDuration, 1)}か月 / ${result.valued}件を騰落率帯別に集計`;
}

function renderBuckets(rows) {
  const buckets = [
    { label: "−20%未満", test: (v) => v < -20 },
    { label: "−20～−10%", test: (v) => v >= -20 && v < -10 },
    { label: "−10～0%", test: (v) => v >= -10 && v < 0 },
    { label: "0～+10%", test: (v) => v >= 0 && v < 10 },
    { label: "+10～+20%", test: (v) => v >= 10 && v < 20 },
    { label: "+20～+50%", test: (v) => v >= 20 && v < 50 },
    { label: "+50%以上", test: (v) => v >= 50 },
  ];
  const values = rows.map((row) => finite(row.return_pct)).filter((value) => value !== null);
  els.returnBuckets.innerHTML = buckets.map((bucket) => {
    const count = values.filter(bucket.test).length;
    const share = values.length ? count / values.length * 100 : 0;
    return `<article class="bucket-card"><span>${bucket.label}</span><strong>${count.toLocaleString("ja-JP")}件</strong><small>${number(share, 1)}%</small></article>`;
  }).join("");
}

function renderCohorts(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.start_month)) grouped.set(row.start_month, []);
    grouped.get(row.start_month).push(row);
  });
  const months = [...grouped.keys()].sort().reverse();
  els.cohortBody.innerHTML = months.map((month) => {
    const cohort = grouped.get(month);
    const result = stats(cohort);
    return `<tr><td>${escapeHtml(month)}</td><td class="num">${cohort.length}</td><td class="num">${cohort.filter((row) => row.status === "CLOSED").length}</td><td class="num">${cohort.filter((row) => row.status === "ACTIVE").length}</td><td class="num ${performanceClass(result.average)}">${signed(result.average)}</td><td class="num">${result.winRate === null ? "—" : `${number(result.winRate, 1)}%`}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="empty-state">条件に合う実績がありません。</td></tr>`;
}

function sortableValue(row, key) {
  const value = key === "end_month" ? (row.end_month || row.valuation_date) : row[key];
  const numeric = finite(value);
  return numeric === null ? String(value ?? "").toLowerCase() : numeric;
}
function sortedRows(rows) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortableValue(a, state.sortKey);
    const right = sortableValue(b, state.sortKey);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right), "ja", { numeric: true }) * direction;
  });
}
function renderRows(rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  els.tbody.innerHTML = pageRows.map((row) => {
    const status = row.status === "CLOSED" ? `<span class="badge out">OUT済み</span>` : `<span class="badge continue">継続中</span>`;
    return `<tr>
      <td>${escapeHtml(row.start_month)}</td><td>${escapeHtml(row.code)}</td><td class="company-name">${escapeHtml(row.name)}</td><td>${status}</td>
      <td class="num">${number(row.start_rsi5)}</td><td class="num">${number(row.start_rsi14)}</td>
      <td class="${booleanClass(row.start_rsi5_up)}">${directionLabel(row.start_rsi5_up)}</td><td class="${booleanClass(row.start_rsi14_up)}">${directionLabel(row.start_rsi14_up)}</td>
      <td class="num">${number(row.start_price)}</td><td class="num">${number(row.start_sma25)}</td><td class="num">${number(row.start_sma75)}</td><td class="num">${number(row.start_sma200)}</td>
      <td class="${booleanClass(row.start_price_above_sma25)}">${positionLabel(row.start_price_above_sma25)}</td><td class="${booleanClass(row.start_price_above_sma75)}">${positionLabel(row.start_price_above_sma75)}</td><td class="${booleanClass(row.start_price_above_sma200)}">${positionLabel(row.start_price_above_sma200)}</td>
      <td class="${booleanClass(row.start_perfect_order)}">${yesNoLabel(row.start_perfect_order)}</td>
      <td class="${booleanClass(row.start_sma25_up)}">${directionLabel(row.start_sma25_up)}</td><td class="${booleanClass(row.start_sma75_up)}">${directionLabel(row.start_sma75_up)}</td><td class="${booleanClass(row.start_sma200_up)}">${directionLabel(row.start_sma200_up)}</td>
      <td class="num">${number(row.start_avg_volume30, 0)}</td><td class="num">${number(row.roe_pct)}</td><td class="num">${number(row.revenue_growth_pct)}</td><td class="num">${number(row.equity_ratio_pct)}</td>
      <td class="num ${performanceClass(row.operating_cashflow_oku)}">${number(row.operating_cashflow_oku)}</td><td class="num ${performanceClass(row.free_cashflow_oku)}">${number(row.free_cashflow_oku)}</td><td class="num">${number(row.market_cap_oku)}</td>
      <td>${escapeHtml(row.end_month || row.valuation_date || "最新")}</td><td class="num">${number(row.end_price)}</td>
      <td class="num">${number(row.duration_months, 0)}</td><td class="num ${performanceClass(row.return_pct)}">${signed(row.return_pct)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="30" class="empty-state">条件に合う実績がありません。</td></tr>`;
  els.resultSummary.textContent = `${rows.length.toLocaleString("ja-JP")}件（${state.pattern === "ALL" ? "全体" : state.pattern === "CLOSED" ? "OUT済み" : "継続中"}）`;
  els.pageInfo.textContent = `${state.page} / ${totalPages}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= totalPages;
  els.headers.forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
    if (header.dataset.key === state.sortKey) header.classList.add(state.sortDirection === "asc" ? "sort-asc" : "sort-desc");
  });
}

function render() {
  const base = baseRows();
  const selected = sortedRows(patternRows(base));
  renderComparison(base);
  renderStats(selected);
  renderBuckets(selected);
  renderCohorts(selected);
  renderRows(selected);
}

function resetFilters() {
  populateMonths();
  [
    els.rsi5Min, els.rsi5Max, els.rsi14Min, els.rsi14Max, els.returnMin, els.returnMax, els.searchInput,
    els.roeMin, els.roeMax, els.revenueGrowthMin, els.revenueGrowthMax, els.equityRatioMin, els.equityRatioMax,
    els.marketCapMin, els.marketCapMax, els.volumeMin, els.volumeMax,
  ].forEach((element) => { element.value = ""; });
  [
    els.rsi5Trend, els.rsi14Trend, els.priceVsSma25, els.priceVsSma75, els.priceVsSma200, els.perfectOrder,
    els.sma25Trend, els.sma75Trend, els.sma200Trend, els.operatingCf, els.freeCf,
  ].forEach((element) => { element.value = "all"; });
  state.page = 1;
  render();
}

function applyArticlePreset() {
  resetFilters();
  els.roeMin.value = "10";
  els.revenueGrowthMin.value = "5";
  els.equityRatioMin.value = "50";
  els.operatingCf.value = "positive";
  els.freeCf.value = "positive";
  els.perfectOrder.value = "yes";
  els.priceVsSma200.value = "above";
  els.priceVsSma25.value = "below";
  els.volumeMin.value = "100000";
  els.marketCapMin.value = "300";
  state.page = 1;
  render();
}

function bindEvents() {
  [
    els.startMonth, els.endMonth, els.rsi5Trend, els.rsi14Trend, els.priceVsSma25, els.priceVsSma75, els.priceVsSma200,
    els.perfectOrder, els.sma25Trend, els.sma75Trend, els.sma200Trend, els.operatingCf, els.freeCf,
  ].forEach((element) => element.addEventListener("change", () => { state.page = 1; render(); }));
  [
    els.rsi5Min, els.rsi5Max, els.rsi14Min, els.rsi14Max, els.returnMin, els.returnMax, els.searchInput,
    els.roeMin, els.roeMax, els.revenueGrowthMin, els.revenueGrowthMax, els.equityRatioMin, els.equityRatioMax,
    els.marketCapMin, els.marketCapMax, els.volumeMin, els.volumeMax,
  ].forEach((element) => element.addEventListener("input", () => { state.page = 1; render(); }));
  els.presetArticle.addEventListener("click", applyArticlePreset);
  els.resetFilters.addEventListener("click", resetFilters);
  els.patternCards.forEach((card) => card.addEventListener("click", () => {
    els.patternCards.forEach((item) => item.classList.remove("active"));
    card.classList.add("active");
    state.pattern = card.dataset.pattern;
    state.page = 1;
    render();
  }));
  els.pageSize.addEventListener("change", () => { state.pageSize = Number(els.pageSize.value); state.page = 1; render(); });
  els.prevPage.addEventListener("click", () => { state.page -= 1; render(); });
  els.nextPage.addEventListener("click", () => { state.page += 1; render(); });
  els.headers.forEach((header) => header.addEventListener("click", () => {
    const key = header.dataset.key;
    if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    else { state.sortKey = key; state.sortDirection = ["code", "name", "status", "start_month", "end_month"].includes(key) ? "asc" : "desc"; }
    render();
  }));
}

function showError(error) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = `分析データを読み込めませんでした: ${error.message}`;
  document.querySelector("main").prepend(banner);
}

async function init() {
  cacheElements();
  bindEvents();
  try {
    state.data = await fetchJson("data/analysis.json");
    const profiles = state.data.profiles || {};
    state.rows = (state.data.episodes || []).map((row) => ({ ...(profiles[row.ticker] || {}), ...row }));
    els.generatedAt.textContent = `データ生成: ${formatDate(state.data.generated_at)}`;
    els.priceBasis.textContent = state.data.price_basis || "判定月の月末終値";
    els.technicalBasis.textContent = state.data.technical_basis || "NEW判定月末の日足";
    els.fundamentalBasis.textContent = state.data.fundamental_basis || "データ生成時点の最新財務情報";
    populateMonths();
    render();
  } catch (error) {
    showError(error);
    els.resultSummary.textContent = "分析データ未生成です。データ更新を実行してください。";
  }
}

document.addEventListener("DOMContentLoaded", init);
