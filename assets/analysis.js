const state = {
  data: null, rows: [], pattern: "ALL", sortKey: "start_month", sortDirection: "desc", page: 1, pageSize: 50,
};

const els = {};
function $(id) { return document.getElementById(id); }
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function escapeHtml(value) { return String(value ?? "—").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function number(value, digits = 2) { const parsed = finite(value); return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits }); }
function signed(value) { const parsed = finite(value); return parsed === null ? "—" : `${parsed > 0 ? "+" : ""}${number(parsed)}%`; }
function performanceClass(value) { const parsed = finite(value); return parsed === null || parsed === 0 ? "" : parsed > 0 ? "positive" : "negative"; }
function directionLabel(value) { return value === true ? "上向き" : value === false ? "横ばい・下向き" : "—"; }
function positionLabel(value) { return value === true ? "株価が上" : value === false ? "株価が下" : "—"; }
function yesNoLabel(value) { return value === true ? "適合" : value === false ? "条件外" : "—"; }
function booleanClass(value) { return value === true ? "positive" : value === false ? "negative" : ""; }
function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date);
}
function inputNumber(element) { return element.value.trim() === "" ? null : finite(element.value); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function stats(rows) {
  const values = rows.map((row) => finite(row.return_pct)).filter((value) => value !== null);
  return {
    count: rows.length, valued: values.length, average: mean(values), median: median(values),
    winRate: values.length ? values.filter((value) => value > 0).length / values.length * 100 : null,
    max: values.length ? Math.max(...values) : null, min: values.length ? Math.min(...values) : null,
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
    "generatedAt", "priceBasis", "technicalBasis", "fundamentalBasis", "startMonth", "endMonth", "researchPeriod",
    "rsi5Min", "rsi5Max", "rsi14Min", "rsi14Max", "rsi5Trend", "rsi14Trend", "returnMin", "returnMax", "searchInput",
    "priceVsSma25", "priceVsSma75", "priceVsSma200", "perfectOrder", "sma25Trend", "sma75Trend", "sma200Trend",
    "high52DistanceMin", "high52DistanceMax", "high52Breakout", "volumeRatioMin", "volumeRatioMax", "atrPctMin", "atrPctMax",
    "atrRatioMin", "atrRatioMax", "vcpTight", "stageFilter", "supertrendFilter", "mvpFilter", "presetHighZone", "presetBreakout", "presetVcpTrend",
    "roeMin", "roeMax", "revenueGrowthMin", "revenueGrowthMax", "equityRatioMin", "equityRatioMax", "operatingCf", "freeCf",
    "marketCapMin", "marketCapMax", "volumeMin", "volumeMax", "presetArticle", "resetFilters",
    "allAverage", "allDetail", "closedAverage", "closedDetail", "activeAverage", "activeDetail",
    "statCount", "statAverage", "statMedian", "statWinRate", "statMax", "statMin", "returnBuckets", "distributionCaption",
    "benchmarkNotice", "benchmarkCards", "performanceChart", "costBps", "strategyRankingBody", "rankingPeriodCaption",
    "cohortBody", "resultSummary", "pageSize", "episodeTable", "prevPage", "nextPage", "pageInfo",
  ].forEach((id) => { els[id] = $(id); });
  els.tbody = els.episodeTable.querySelector("tbody");
  els.headers = [...els.episodeTable.querySelectorAll("th[data-key]")];
  els.patternCards = [...document.querySelectorAll("[data-pattern]")];
}

function populateMonths() {
  const months = [...new Set(state.rows.map((row) => row.start_month))].sort();
  [els.startMonth, els.endMonth].forEach((select) => { select.innerHTML = ""; });
  months.forEach((month) => [els.startMonth, els.endMonth].forEach((select) => {
    const option = document.createElement("option"); option.value = month; option.textContent = month; select.appendChild(option);
  }));
  if (months.length) { els.startMonth.value = months[0]; els.endMonth.value = months[months.length - 1]; }
}
function previousMonth(month) {
  const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function applyResearchPeriod() {
  const months = [...els.startMonth.options].map((option) => option.value);
  if (!months.length) return;
  const validationStart = state.data?.validation_start_month || months[Math.floor(months.length / 2)];
  if (els.researchPeriod.value === "train") { els.startMonth.value = months[0]; els.endMonth.value = previousMonth(validationStart); }
  else if (els.researchPeriod.value === "validate") { els.startMonth.value = validationStart; els.endMonth.value = months[months.length - 1]; }
  else { els.startMonth.value = months[0]; els.endMonth.value = months[months.length - 1]; }
}

function matchesRange(row, key, minimumElement, maximumElement) {
  const value = finite(row[key]); const minimum = inputNumber(minimumElement); const maximum = inputNumber(maximumElement);
  if (minimum !== null && (value === null || value < minimum)) return false;
  if (maximum !== null && (value === null || value > maximum)) return false;
  return true;
}
function matchesDirection(value, selection) {
  if (selection === "all") return true; if (value !== true && value !== false) return false;
  return selection === "up" ? value === true : value === false;
}
function matchesPosition(value, selection) {
  if (selection === "all") return true; if (value !== true && value !== false) return false;
  return selection === "above" ? value === true : value === false;
}
function matchesYesNo(value, selection) {
  if (selection === "all") return true; if (value !== true && value !== false) return false;
  return selection === "yes" ? value === true : value === false;
}
function matchesPositive(value, selection) {
  if (selection === "all") return true; const parsed = finite(value); if (parsed === null) return false;
  return selection === "positive" ? parsed > 0 : parsed <= 0;
}
function inSelectedMonths(row) {
  return (!els.startMonth.value || row.start_month >= els.startMonth.value) && (!els.endMonth.value || row.start_month <= els.endMonth.value);
}
function technicalRows() {
  return state.rows.filter((row) => {
    if (!inSelectedMonths(row)) return false;
    if (!matchesRange(row, "start_rsi5", els.rsi5Min, els.rsi5Max) || !matchesRange(row, "start_rsi14", els.rsi14Min, els.rsi14Max)) return false;
    if (!matchesDirection(row.start_rsi5_up, els.rsi5Trend.value) || !matchesDirection(row.start_rsi14_up, els.rsi14Trend.value)) return false;
    if (!matchesPosition(row.start_price_above_sma25, els.priceVsSma25.value) || !matchesPosition(row.start_price_above_sma75, els.priceVsSma75.value) || !matchesPosition(row.start_price_above_sma200, els.priceVsSma200.value)) return false;
    if (!matchesYesNo(row.start_perfect_order, els.perfectOrder.value)) return false;
    if (!matchesDirection(row.start_sma25_up, els.sma25Trend.value) || !matchesDirection(row.start_sma75_up, els.sma75Trend.value) || !matchesDirection(row.start_sma200_up, els.sma200Trend.value)) return false;
    if (!matchesRange(row, "start_high52_distance_pct", els.high52DistanceMin, els.high52DistanceMax)) return false;
    if (!matchesYesNo(row.start_high52_breakout, els.high52Breakout.value)) return false;
    if (!matchesRange(row, "start_volume_ratio_5_30", els.volumeRatioMin, els.volumeRatioMax)) return false;
    if (!matchesRange(row, "start_atr14_pct", els.atrPctMin, els.atrPctMax) || !matchesRange(row, "start_atr_ratio_10_20", els.atrRatioMin, els.atrRatioMax)) return false;
    if (!matchesRange(row, "start_avg_volume30", els.volumeMin, els.volumeMax)) return false;
    if (!matchesYesNo(row.start_vcp_tight, els.vcpTight.value)) return false;
    if (els.stageFilter.value !== "all" && finite(row.start_stage) !== Number(els.stageFilter.value)) return false;
    if (!matchesDirection(row.start_supertrend_up, els.supertrendFilter.value)) return false;
    if (!matchesYesNo(row.start_mvp_signal, els.mvpFilter.value)) return false;
    return true;
  });
}
function baseRows() {
  const query = els.searchInput.value.trim().toLowerCase();
  return technicalRows().filter((row) => {
    if (!matchesRange(row, "return_pct", els.returnMin, els.returnMax)) return false;
    if (!matchesRange(row, "roe_pct", els.roeMin, els.roeMax) || !matchesRange(row, "revenue_growth_pct", els.revenueGrowthMin, els.revenueGrowthMax) || !matchesRange(row, "equity_ratio_pct", els.equityRatioMin, els.equityRatioMax)) return false;
    if (!matchesRange(row, "market_cap_oku", els.marketCapMin, els.marketCapMax)) return false;
    if (!matchesPositive(row.operating_cashflow_oku, els.operatingCf.value) || !matchesPositive(row.free_cashflow_oku, els.freeCf.value)) return false;
    return !query || `${row.code ?? ""} ${row.ticker ?? ""} ${row.name ?? ""}`.toLowerCase().includes(query);
  });
}
function baselineRows(start = els.startMonth.value, end = els.endMonth.value) { return state.rows.filter((row) => (!start || row.start_month >= start) && (!end || row.start_month <= end)); }
function patternRows(rows, pattern = state.pattern) { return pattern === "ALL" ? rows : rows.filter((row) => row.status === pattern); }

function renderComparison(rows) {
  [["ALL", els.allAverage, els.allDetail], ["CLOSED", els.closedAverage, els.closedDetail], ["ACTIVE", els.activeAverage, els.activeDetail]].forEach(([pattern, averageElement, detailElement]) => {
    const result = stats(patternRows(rows, pattern)); averageElement.textContent = signed(result.average); averageElement.className = performanceClass(result.average);
    detailElement.textContent = `${result.count.toLocaleString("ja-JP")}件 / プラス ${result.winRate === null ? "—" : `${number(result.winRate, 1)}%`}`;
  });
}
function renderStats(rows) {
  const result = stats(rows); els.statCount.textContent = result.count.toLocaleString("ja-JP"); els.statAverage.textContent = signed(result.average); els.statAverage.className = performanceClass(result.average);
  els.statMedian.textContent = signed(result.median); els.statWinRate.textContent = result.winRate === null ? "—" : `${number(result.winRate, 1)}%`; els.statMax.textContent = signed(result.max); els.statMin.textContent = signed(result.min);
  els.distributionCaption.textContent = `平均保有 ${result.averageDuration === null ? "—" : number(result.averageDuration, 1)}か月 / ${result.valued}件を騰落率帯別に集計`;
}
function renderBuckets(rows) {
  const buckets = [
    { label: "−20%未満", test: (v) => v < -20 }, { label: "−20～−10%", test: (v) => v >= -20 && v < -10 }, { label: "−10～0%", test: (v) => v >= -10 && v < 0 },
    { label: "0～+10%", test: (v) => v >= 0 && v < 10 }, { label: "+10～+20%", test: (v) => v >= 10 && v < 20 }, { label: "+20～+50%", test: (v) => v >= 20 && v < 50 }, { label: "+50%以上", test: (v) => v >= 50 },
  ];
  const values = rows.map((row) => finite(row.return_pct)).filter((value) => value !== null);
  els.returnBuckets.innerHTML = buckets.map((bucket) => { const count = values.filter(bucket.test).length; const share = values.length ? count / values.length * 100 : 0; return `<article class="bucket-card"><span>${bucket.label}</span><strong>${count.toLocaleString("ja-JP")}件</strong><small>${number(share, 1)}%</small></article>`; }).join("");
}
function renderCohorts(rows) {
  const grouped = new Map(); rows.forEach((row) => { if (!grouped.has(row.start_month)) grouped.set(row.start_month, []); grouped.get(row.start_month).push(row); });
  els.cohortBody.innerHTML = [...grouped.keys()].sort().reverse().map((month) => { const cohort = grouped.get(month); const result = stats(cohort); return `<tr><td>${escapeHtml(month)}</td><td class="num">${cohort.length}</td><td class="num">${cohort.filter((row) => row.status === "CLOSED").length}</td><td class="num">${cohort.filter((row) => row.status === "ACTIVE").length}</td><td class="num ${performanceClass(result.average)}">${signed(result.average)}</td><td class="num">${result.winRate === null ? "—" : `${number(result.winRate, 1)}%`}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty-state">条件に合う実績がありません。</td></tr>`;
}

function costAdjusted(point, costBps) {
  let value = finite(point.return_pct); if (value === null) return null; const cost = costBps / 100;
  if (point.entry) value -= cost; if (point.exit) value -= cost; return value;
}
function portfolioSeries(rows, start, end, costBps) {
  const grouped = new Map();
  rows.forEach((row) => (row.monthly_returns || []).forEach((point) => {
    if (point.month <= start || point.month > end) return; const value = costAdjusted(point, costBps); if (value === null) return;
    if (!grouped.has(point.month)) grouped.set(point.month, []); grouped.get(point.month).push(value);
  }));
  return [...grouped.keys()].sort().map((month) => ({ month, return_pct: mean(grouped.get(month)), holdings: grouped.get(month).length }));
}
function benchmarkSeries(key, start, end) {
  const points = state.data?.benchmarks?.[key]?.returns || [];
  return points.filter((point) => point.month > start && point.month <= end).map((point) => ({ ...point, holdings: null }));
}
function portfolioMetrics(series) {
  let wealth = 1; let peak = 1; let maxDrawdown = 0;
  const path = series.map((point) => { wealth *= 1 + point.return_pct / 100; peak = Math.max(peak, wealth); maxDrawdown = Math.min(maxDrawdown, (wealth / peak - 1) * 100); return { month: point.month, cumulative: (wealth - 1) * 100 }; });
  return { cumulative: series.length ? (wealth - 1) * 100 : null, maxDrawdown: series.length ? maxDrawdown : null, months: series.length, averageHoldings: mean(series.map((point) => point.holdings).filter((value) => value !== null)), path };
}
function chartSvg(seriesList) {
  const available = seriesList.filter((series) => series.metrics.path.length);
  if (!available.length) return `<text x="480" y="180" text-anchor="middle" class="chart-empty">データ更新後に比較チャートを表示します</text>`;
  const months = [...new Set(available.flatMap((series) => series.metrics.path.map((point) => point.month)))].sort();
  const values = [0, ...available.flatMap((series) => series.metrics.path.map((point) => point.cumulative))];
  let minimum = Math.min(...values); let maximum = Math.max(...values); if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const width = 860; const height = 270; const left = 72; const top = 38;
  const x = (month) => left + (months.indexOf(month) / Math.max(1, months.length - 1)) * width;
  const y = (value) => top + (maximum - value) / (maximum - minimum) * height;
  const grid = Array.from({ length: 5 }, (_, index) => { const value = maximum - index * (maximum - minimum) / 4; return `<line x1="${left}" y1="${y(value)}" x2="${left + width}" y2="${y(value)}" class="chart-grid"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" class="chart-label">${number(value, 0)}%</text>`; }).join("");
  const lines = available.map((series) => `<polyline points="${series.metrics.path.map((point) => `${x(point.month)},${y(point.cumulative)}`).join(" ")}" fill="none" stroke="${series.color}" stroke-width="3" vector-effect="non-scaling-stroke"/>`).join("");
  const legends = available.map((series, index) => `<circle cx="${left + index * 170}" cy="20" r="5" fill="${series.color}"/><text x="${left + 10 + index * 170}" y="24" class="chart-legend">${series.label}</text>`).join("");
  const xLabels = months.filter((_, index) => index === 0 || index === months.length - 1 || index % Math.max(1, Math.floor(months.length / 5)) === 0).map((month) => `<text x="${x(month)}" y="${top + height + 27}" text-anchor="middle" class="chart-label">${month}</text>`).join("");
  return `${grid}${lines}${legends}${xLabels}`;
}
function renderBenchmark() {
  const hasPaths = state.rows.some((row) => Array.isArray(row.monthly_returns)); const hasBenchmarks = (state.data?.benchmarks?.TOPIX?.returns || []).length > 0;
  if (!hasPaths || !hasBenchmarks) {
    els.benchmarkNotice.textContent = "新しい検証データは未生成です。コード反映後に『Update monthly RSI data』を実行すると表示されます。";
    els.benchmarkCards.innerHTML = ""; els.performanceChart.innerHTML = chartSvg([]); return;
  }
  els.benchmarkNotice.textContent = "比較成績にはNEW時点で確定した項目だけを使用。財務・結果の騰落率・銘柄検索は除外し、月次等金額で計算します。";
  const start = els.startMonth.value; const end = els.endMonth.value; const costBps = Math.max(0, finite(els.costBps.value) || 0);
  const configs = [
    { label: "月足RSIのみ", color: "#94a3b8", series: portfolioSeries(baselineRows(start, end), start, end, costBps) },
    { label: "選択条件", color: "#38bdf8", series: portfolioSeries(technicalRows(), start, end, costBps) },
    { label: "TOPIX", color: "#34d399", series: benchmarkSeries("TOPIX", start, end) },
    { label: "日経平均", color: "#f59e0b", series: benchmarkSeries("NIKKEI225", start, end) },
  ].map((config) => ({ ...config, metrics: portfolioMetrics(config.series) }));
  els.benchmarkCards.innerHTML = configs.map((config) => `<article class="portfolio-card" style="--series-color:${config.color}"><span>${config.label}</span><strong class="${performanceClass(config.metrics.cumulative)}">${signed(config.metrics.cumulative)}</strong><small>最大下落 ${signed(config.metrics.maxDrawdown)} / ${config.metrics.months}か月${config.metrics.averageHoldings === null ? "" : ` / 平均${number(config.metrics.averageHoldings, 1)}銘柄`}</small></article>`).join("");
  els.performanceChart.innerHTML = chartSvg(configs);
}

const CANDIDATES = [
  { name: "月足RSIのみ", condition: "追加条件なし", test: () => true },
  { name: "高値圏10", condition: "52週高値から−10%以内", test: (r) => finite(r.start_high52_distance_pct) !== null && finite(r.start_high52_distance_pct) >= -10 },
  { name: "高値圏5", condition: "52週高値から−5%以内", test: (r) => finite(r.start_high52_distance_pct) !== null && finite(r.start_high52_distance_pct) >= -5 },
  { name: "新高値", condition: "52週高値更新", test: (r) => r.start_high52_breakout === true },
  { name: "出来高加速", condition: "5日÷30日出来高 ≥ 1.2", test: (r) => finite(r.start_volume_ratio_5_30) >= 1.2 },
  { name: "VCP", condition: "ATR10＜ATR20", test: (r) => r.start_vcp_tight === true },
  { name: "MVP", condition: "株価上昇・出来高急増・RSR Momプラス", test: (r) => r.start_mvp_signal === true },
  { name: "高値＋出来高", condition: "高値−10%以内・出来高倍率≥1.2", test: (r) => finite(r.start_high52_distance_pct) !== null && finite(r.start_high52_distance_pct) >= -10 && finite(r.start_volume_ratio_5_30) >= 1.2 },
  { name: "収束上昇", condition: "高値−10%以内・VCP・ST上向き", test: (r) => finite(r.start_high52_distance_pct) !== null && finite(r.start_high52_distance_pct) >= -10 && r.start_vcp_tight === true && r.start_supertrend_up === true },
  { name: "ブレイク加速", condition: "新高値・出来高倍率≥1.2・ST上向き", test: (r) => r.start_high52_breakout === true && finite(r.start_volume_ratio_5_30) >= 1.2 && r.start_supertrend_up === true },
  { name: "高値圏MVP", condition: "高値−10%以内・MVP点火", test: (r) => finite(r.start_high52_distance_pct) !== null && finite(r.start_high52_distance_pct) >= -10 && r.start_mvp_signal === true },
  { name: "第2ステージ高値圏", condition: "Stage2・高値−10%以内・ST上向き", test: (r) => finite(r.start_stage) === 2 && finite(r.start_high52_distance_pct) !== null && finite(r.start_high52_distance_pct) >= -10 && r.start_supertrend_up === true },
];
function renderStrategyRanking() {
  if (!state.rows.some((row) => Array.isArray(row.monthly_returns)) || !(state.data?.benchmarks?.TOPIX?.returns || []).length) {
    els.strategyRankingBody.innerHTML = `<tr><td colspan="7" class="empty-state">データ更新後に検証結果を表示します。</td></tr>`; return;
  }
  const first = state.data.available_start_month; const validation = state.data.validation_start_month; const trainEnd = previousMonth(validation); const last = state.data.available_end_month; const costBps = Math.max(0, finite(els.costBps.value) || 0);
  const topixTrain = portfolioMetrics(benchmarkSeries("TOPIX", first, trainEnd)); const topixValidate = portfolioMetrics(benchmarkSeries("TOPIX", validation, last));
  const results = CANDIDATES.map((candidate) => {
    const rows = state.rows.filter(candidate.test); const trainRows = rows.filter((row) => row.start_month >= first && row.start_month <= trainEnd); const validationRows = rows.filter((row) => row.start_month >= validation && row.start_month <= last);
    const train = portfolioMetrics(portfolioSeries(trainRows, first, trainEnd, costBps)); const validate = portfolioMetrics(portfolioSeries(validationRows, validation, last, costBps));
    return { ...candidate, trainExcess: train.cumulative === null || topixTrain.cumulative === null ? null : train.cumulative - topixTrain.cumulative, validateExcess: validate.cumulative === null || topixValidate.cumulative === null ? null : validate.cumulative - topixValidate.cumulative, validateReturn: validate.cumulative, entries: validationRows.length };
  }).sort((a, b) => (finite(b.validateExcess) ?? -Infinity) - (finite(a.validateExcess) ?? -Infinity));
  els.strategyRankingBody.innerHTML = results.map((result, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(result.name)}</strong></td><td>${escapeHtml(result.condition)}</td><td class="num ${performanceClass(result.trainExcess)}">${signed(result.trainExcess)}</td><td class="num ${performanceClass(result.validateExcess)}">${signed(result.validateExcess)}</td><td class="num ${performanceClass(result.validateReturn)}">${signed(result.validateReturn)}</td><td class="num">${result.entries.toLocaleString("ja-JP")}</td></tr>`).join("");
}

function sortableValue(row, key) { const value = key === "end_month" ? (row.end_month || row.valuation_date) : row[key]; const numeric = finite(value); return numeric === null ? String(value ?? "").toLowerCase() : numeric; }
function sortedRows(rows) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => { const left = sortableValue(a, state.sortKey); const right = sortableValue(b, state.sortKey); if (typeof left === "number" && typeof right === "number") return (left - right) * direction; return String(left).localeCompare(String(right), "ja", { numeric: true }) * direction; });
}
function renderRows(rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize)); state.page = Math.min(state.page, totalPages); const start = (state.page - 1) * state.pageSize; const pageRows = rows.slice(start, start + state.pageSize);
  els.tbody.innerHTML = pageRows.map((row) => { const status = row.status === "CLOSED" ? `<span class="badge out">OUT済み</span>` : `<span class="badge continue">継続中</span>`; return `<tr>
    <td>${escapeHtml(row.start_month)}</td><td>${escapeHtml(row.code)}</td><td class="company-name">${escapeHtml(row.name)}</td><td>${status}</td>
    <td class="num">${number(row.start_rsi5)}</td><td class="num">${number(row.start_rsi14)}</td><td class="${booleanClass(row.start_rsi5_up)}">${directionLabel(row.start_rsi5_up)}</td><td class="${booleanClass(row.start_rsi14_up)}">${directionLabel(row.start_rsi14_up)}</td>
    <td class="num">${number(row.start_price)}</td><td class="num">${number(row.start_sma25)}</td><td class="num">${number(row.start_sma75)}</td><td class="num">${number(row.start_sma200)}</td>
    <td class="${booleanClass(row.start_price_above_sma25)}">${positionLabel(row.start_price_above_sma25)}</td><td class="${booleanClass(row.start_price_above_sma75)}">${positionLabel(row.start_price_above_sma75)}</td><td class="${booleanClass(row.start_price_above_sma200)}">${positionLabel(row.start_price_above_sma200)}</td><td class="${booleanClass(row.start_perfect_order)}">${yesNoLabel(row.start_perfect_order)}</td>
    <td class="${booleanClass(row.start_sma25_up)}">${directionLabel(row.start_sma25_up)}</td><td class="${booleanClass(row.start_sma75_up)}">${directionLabel(row.start_sma75_up)}</td><td class="${booleanClass(row.start_sma200_up)}">${directionLabel(row.start_sma200_up)}</td><td class="num">${number(row.start_avg_volume30, 0)}</td>
    <td class="num ${performanceClass(row.start_high52_distance_pct)}">${signed(row.start_high52_distance_pct)}</td><td class="${booleanClass(row.start_high52_breakout)}">${row.start_high52_breakout === true ? "更新" : row.start_high52_breakout === false ? "未更新" : "—"}</td><td class="num">${number(row.start_volume_ratio_5_30)}</td>
    <td class="num">${number(row.start_atr14_pct)}</td><td class="num">${number(row.start_atr_ratio_10_20)}</td><td class="${booleanClass(row.start_vcp_tight)}">${yesNoLabel(row.start_vcp_tight)}</td><td class="num">${number(row.start_stage, 0)}</td><td class="${booleanClass(row.start_supertrend_up)}">${row.start_supertrend_up === true ? "上" : row.start_supertrend_up === false ? "下" : "—"}</td><td class="num ${performanceClass(row.start_rsr_momentum)}">${number(row.start_rsr_momentum)}</td><td class="${booleanClass(row.start_mvp_signal)}">${row.start_mvp_signal === true ? "点火" : row.start_mvp_signal === false ? "平常" : "—"}</td>
    <td class="num">${number(row.roe_pct)}</td><td class="num">${number(row.revenue_growth_pct)}</td><td class="num">${number(row.equity_ratio_pct)}</td><td class="num ${performanceClass(row.operating_cashflow_oku)}">${number(row.operating_cashflow_oku)}</td><td class="num ${performanceClass(row.free_cashflow_oku)}">${number(row.free_cashflow_oku)}</td><td class="num">${number(row.market_cap_oku)}</td>
    <td>${escapeHtml(row.end_month || row.valuation_date || "最新")}</td><td class="num">${number(row.end_price)}</td><td class="num">${number(row.duration_months, 0)}</td><td class="num ${performanceClass(row.return_pct)}">${signed(row.return_pct)}</td></tr>`; }).join("") || `<tr><td colspan="38" class="empty-state">条件に合う実績がありません。</td></tr>`;
  els.resultSummary.textContent = `${rows.length.toLocaleString("ja-JP")}件（${state.pattern === "ALL" ? "全体" : state.pattern === "CLOSED" ? "OUT済み" : "継続中"}）`; els.pageInfo.textContent = `${state.page} / ${totalPages}`; els.prevPage.disabled = state.page <= 1; els.nextPage.disabled = state.page >= totalPages;
  els.headers.forEach((header) => { header.classList.remove("sort-asc", "sort-desc"); if (header.dataset.key === state.sortKey) header.classList.add(state.sortDirection === "asc" ? "sort-asc" : "sort-desc"); });
}
function render() {
  const base = baseRows(); const selected = sortedRows(patternRows(base)); renderComparison(base); renderStats(selected); renderBuckets(selected); renderCohorts(selected); renderRows(selected); renderBenchmark(); renderStrategyRanking();
}

const numberInputs = ["rsi5Min", "rsi5Max", "rsi14Min", "rsi14Max", "returnMin", "returnMax", "searchInput", "high52DistanceMin", "high52DistanceMax", "volumeRatioMin", "volumeRatioMax", "atrPctMin", "atrPctMax", "atrRatioMin", "atrRatioMax", "roeMin", "roeMax", "revenueGrowthMin", "revenueGrowthMax", "equityRatioMin", "equityRatioMax", "marketCapMin", "marketCapMax", "volumeMin", "volumeMax"];
const selectInputs = ["rsi5Trend", "rsi14Trend", "priceVsSma25", "priceVsSma75", "priceVsSma200", "perfectOrder", "sma25Trend", "sma75Trend", "sma200Trend", "high52Breakout", "vcpTight", "stageFilter", "supertrendFilter", "mvpFilter", "operatingCf", "freeCf"];
function resetFilters() {
  populateMonths(); els.researchPeriod.value = "all"; numberInputs.forEach((id) => { els[id].value = ""; }); selectInputs.forEach((id) => { els[id].value = "all"; }); state.page = 1; render();
}
function resetMomentum() { ["high52DistanceMin", "high52DistanceMax", "volumeRatioMin", "volumeRatioMax", "atrPctMin", "atrPctMax", "atrRatioMin", "atrRatioMax"].forEach((id) => { els[id].value = ""; }); ["high52Breakout", "vcpTight", "stageFilter", "supertrendFilter", "mvpFilter"].forEach((id) => { els[id].value = "all"; }); }
function applyArticlePreset() { resetFilters(); els.roeMin.value = "10"; els.revenueGrowthMin.value = "5"; els.equityRatioMin.value = "50"; els.operatingCf.value = "positive"; els.freeCf.value = "positive"; els.perfectOrder.value = "yes"; els.priceVsSma200.value = "above"; els.priceVsSma25.value = "below"; els.volumeMin.value = "100000"; els.marketCapMin.value = "300"; render(); }
function applyMomentumPreset(kind) {
  resetMomentum();
  if (kind === "high") els.high52DistanceMin.value = "-10";
  if (kind === "breakout") { els.high52Breakout.value = "yes"; els.volumeRatioMin.value = "1.2"; els.supertrendFilter.value = "up"; }
  if (kind === "vcp") { els.high52DistanceMin.value = "-10"; els.vcpTight.value = "yes"; els.stageFilter.value = "2"; els.supertrendFilter.value = "up"; }
  state.page = 1; render();
}
function bindEvents() {
  ["startMonth", "endMonth", ...selectInputs].forEach((id) => els[id].addEventListener("change", () => { els.researchPeriod.value = id === "startMonth" || id === "endMonth" ? "all" : els.researchPeriod.value; state.page = 1; render(); }));
  numberInputs.forEach((id) => els[id].addEventListener("input", () => { state.page = 1; render(); }));
  els.researchPeriod.addEventListener("change", () => { applyResearchPeriod(); state.page = 1; render(); }); els.costBps.addEventListener("input", render);
  els.presetArticle.addEventListener("click", applyArticlePreset); els.resetFilters.addEventListener("click", resetFilters); els.presetHighZone.addEventListener("click", () => applyMomentumPreset("high")); els.presetBreakout.addEventListener("click", () => applyMomentumPreset("breakout")); els.presetVcpTrend.addEventListener("click", () => applyMomentumPreset("vcp"));
  els.patternCards.forEach((card) => card.addEventListener("click", () => { els.patternCards.forEach((item) => item.classList.remove("active")); card.classList.add("active"); state.pattern = card.dataset.pattern; state.page = 1; render(); }));
  els.pageSize.addEventListener("change", () => { state.pageSize = Number(els.pageSize.value); state.page = 1; render(); }); els.prevPage.addEventListener("click", () => { state.page -= 1; render(); }); els.nextPage.addEventListener("click", () => { state.page += 1; render(); });
  els.headers.forEach((header) => header.addEventListener("click", () => { const key = header.dataset.key; if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc"; else { state.sortKey = key; state.sortDirection = ["code", "name", "status", "start_month", "end_month"].includes(key) ? "asc" : "desc"; } render(); }));
}
function showError(error) { const banner = document.createElement("div"); banner.className = "error-banner"; banner.textContent = `分析データを読み込めませんでした: ${error.message}`; document.querySelector("main").prepend(banner); }
async function init() {
  cacheElements();
  try {
    state.data = await fetchJson("data/analysis.json"); const profiles = state.data.profiles || {}; state.rows = (state.data.episodes || []).map((row) => ({ ...(profiles[row.ticker] || {}), ...row }));
    els.generatedAt.textContent = `データ生成: ${formatDate(state.data.generated_at)}`; els.priceBasis.textContent = state.data.price_basis || "判定月の月末終値"; els.technicalBasis.textContent = state.data.technical_basis || "NEW判定月末の日足"; els.fundamentalBasis.textContent = state.data.fundamental_basis || "データ生成時点の最新財務情報";
    if (state.data.validation_start_month) els.rankingPeriodCaption.textContent = `条件探し ${state.data.available_start_month}〜${previousMonth(state.data.validation_start_month)} / 答え合わせ ${state.data.validation_start_month}〜${state.data.available_end_month}`;
    populateMonths(); bindEvents(); render();
  } catch (error) { showError(error); els.resultSummary.textContent = "分析データ未生成です。データ更新を実行してください。"; }
}
document.addEventListener("DOMContentLoaded", init);
