const PRESETS = {
  rsi: { name: "RSI基本", description: "RSI5≥60・RSI14上向き" },
  cosmos: { name: "コスモス注目", description: "既存の🌸注目条件" },
  trend: { name: "王道トレンド", description: "RSI＋第2ステージ＋上昇トレンド" },
  vcp: { name: "VCP収束", description: "RSI＋VCP＋Supertrend上向き" },
  mvp: { name: "MVP加速", description: "RSI＋MVP点火" },
  high: { name: "高値圏", description: "RSI＋52週高値から10%以内" },
  all: { name: "全NEW", description: "追加条件なし" },
};
const EXIT_RULES = {
  DC: { name: "月足RSIデッドクロス", horizon: null },
  H1: { name: "1か月後の月末", horizon: 1 },
  H3: { name: "3か月後の月末", horizon: 3 },
  H6: { name: "6か月後の月末", horizon: 6 },
};
const state = { data: null, episodes: [], mode: "preset", preset: "rsi", chart: null, currentResult: null };
const els = {};
function $(id) { return document.getElementById(id); }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function escapeHtml(value) { return String(value ?? "—").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function percent(value, digits = 2) { const parsed = finite(value); if (parsed === null) return "—"; return `${parsed > 0 ? "+" : ""}${parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits })}%`; }
function yen(value) { const parsed = finite(value); return parsed === null ? "—" : `${Math.round(parsed).toLocaleString("ja-JP")}円`; }
function performanceClass(value) { const parsed = finite(value); return parsed === null || parsed === 0 ? "" : parsed > 0 ? "positive" : "negative"; }
function median(values) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function formatDate(iso) { if (!iso) return "—"; const date = new Date(iso); if (Number.isNaN(date.getTime())) return iso; return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date); }
function monthToIndex(month) { const [year, value] = String(month).split("-").map(Number); return year * 12 + value - 1; }
function indexToMonth(index) { const year = Math.floor(index / 12); const month = index % 12 + 1; return `${year}-${String(month).padStart(2, "0")}`; }
function addMonths(month, amount) { return indexToMonth(monthToIndex(month) + amount); }
function monthDiff(start, end) { return monthToIndex(end) - monthToIndex(start); }
function monthRange(start, end) { const result = []; for (let index = monthToIndex(start); index <= monthToIndex(end); index += 1) result.push(indexToMonth(index)); return result; }
function cacheElements() {
  ["generatedAt", "availablePeriod", "presetModeButton", "customModeButton", "presetPanel", "customPanel", "rsi5Min", "highZoneSelect", "requireRsi14Up", "requirePerfectOrder", "requireSma200Up", "requireStage2", "requireSupertrend", "requireVcp", "requireMvp", "requireVolume", "exitRule", "horizonMode", "rankBy", "maxPositions", "maxPositionsOutput", "initialCapital", "costBps", "benchmarkSelect", "startMonth", "endMonth", "runBacktest", "ruleSummary", "eligibilityNotice", "resultCaption", "metricCumulative", "metricAnnualized", "metricDrawdown", "metricWinRate", "metricTrades", "metricFinalValue", "equityChart", "matrixBody", "monthlyBody", "tradeBody"].forEach((id) => { els[id] = $(id); });
  els.presetButtons = [...document.querySelectorAll("[data-preset]")];
}
function episodeFlags(episode) {
  const rsi5 = finite(episode.start_rsi5); const highDistance = finite(episode.start_high52_distance_pct); const stage = finite(episode.start_stage);
  const rsi = rsi5 !== null && rsi5 >= 60 && episode.start_rsi14_up === true;
  const trend = episode.start_perfect_order === true && episode.start_sma200_up === true && stage === 2 && episode.start_supertrend_up === true;
  const vcp = episode.start_vcp_tight === true && episode.start_supertrend_up === true;
  const mvp = episode.start_mvp_signal === true;
  const high = highDistance !== null && highDistance >= -10;
  const cosmosCommon = rsi5 !== null && rsi5 >= 60 && episode.start_rsi14_up === true;
  const cosmosAccelerator = episode.start_sma200_up === true && episode.start_mvp_signal === true;
  const cosmosBreakout = episode.start_perfect_order === true && episode.start_high52_breakout === true;
  return { rsi, trend, vcp, mvp, high, cosmos: cosmosCommon && (cosmosAccelerator || cosmosBreakout) };
}
function presetMatches(episode, preset) {
  const flags = episodeFlags(episode);
  if (preset === "all") return true;
  if (preset === "rsi") return flags.rsi;
  if (preset === "cosmos") return flags.cosmos;
  if (preset === "trend") return flags.rsi && flags.trend;
  if (preset === "vcp") return flags.rsi && flags.vcp;
  if (preset === "mvp") return flags.rsi && flags.mvp;
  if (preset === "high") return flags.rsi && flags.high;
  return false;
}
function customMatches(episode) {
  const rsi5 = finite(episode.start_rsi5); const minimumRsi = finite(els.rsi5Min.value);
  if (minimumRsi !== null && (rsi5 === null || rsi5 < minimumRsi)) return false;
  if (els.requireRsi14Up.checked && episode.start_rsi14_up !== true) return false;
  if (els.requirePerfectOrder.checked && episode.start_perfect_order !== true) return false;
  if (els.requireSma200Up.checked && episode.start_sma200_up !== true) return false;
  if (els.requireStage2.checked && finite(episode.start_stage) !== 2) return false;
  if (els.requireSupertrend.checked && episode.start_supertrend_up !== true) return false;
  if (els.requireVcp.checked && episode.start_vcp_tight !== true) return false;
  if (els.requireMvp.checked && episode.start_mvp_signal !== true) return false;
  if (els.requireVolume.checked && (finite(episode.start_volume_ratio_5_30) ?? -Infinity) < 1.2) return false;
  if (els.highZoneSelect.value !== "all") { const distance = finite(episode.start_high52_distance_pct); if (distance === null || distance < Number(els.highZoneSelect.value)) return false; }
  return true;
}
function entryMatches(episode, config) { if (episode.analysis_excluded) return false; return config.entryMode === "custom" ? customMatches(episode) : presetMatches(episode, config.preset); }
function rankScore(episode, rankBy) {
  const rsiStrength = finite(episode.start_rsi_strength) ?? 0; const rsi5 = finite(episode.start_rsi5) ?? 0; const highDistance = finite(episode.start_high52_distance_pct) ?? -100; const momentum = finite(episode.start_rsr_momentum) ?? -10; const volume = finite(episode.start_volume_ratio_5_30) ?? 0;
  if (rankBy === "rsi") return rsiStrength * 2 + rsi5;
  if (rankBy === "high") return highDistance;
  if (rankBy === "momentum") return momentum;
  if (rankBy === "volume") return volume;
  const flags = episodeFlags(episode);
  return rsi5 * 0.28 + rsiStrength * 0.55 + (highDistance + 40) * 0.45 + Math.min(volume, 5) * 5 + momentum * 8 + (flags.trend ? 18 : 0) + (flags.vcp ? 8 : 0) + (flags.mvp ? 15 : 0);
}
function buildPlan(episode, config) {
  const path = [...(episode.monthly_returns || [])].filter((point) => point && point.month && finite(point.return_pct) !== null).sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (!path.length) return null;
  const rule = EXIT_RULES[config.exitRule]; let exitPoint = null; let exitReason = "期間末評価";
  if (!rule.horizon) { exitPoint = path.find((point) => point.exit === true) || null; exitReason = exitPoint ? "RSI DC" : "期間末評価"; }
  else {
    const targetMonth = addMonths(episode.start_month, rule.horizon); const exact = path.find((point) => point.month === targetMonth);
    if (exact) { exitPoint = exact; exitReason = `${rule.horizon}か月月末`; }
    else if (config.horizonMode === "fallback") { const earlyExit = path.filter((point) => point.exit === true && point.month < targetMonth).at(-1); if (earlyExit) { exitPoint = earlyExit; exitReason = "途中DC"; } }
    if (!exitPoint) return null;
  }
  const exitMonth = exitPoint?.month || null; const usablePath = exitMonth ? path.filter((point) => point.month <= exitMonth) : path.filter((point) => point.month <= config.endMonth);
  if (!usablePath.length) return null;
  return { episode, path: usablePath, pathMap: new Map(usablePath.map((point) => [point.month, point])), exitMonth, exitReason, score: rankScore(episode, config.rankBy) };
}
function selectedEntryName(config) { return config.entryMode === "custom" ? "自由設定" : PRESETS[config.preset]?.name || config.preset; }
function readConfig(overrides = {}) { return { entryMode: state.mode, preset: state.preset, exitRule: els.exitRule.value, horizonMode: els.horizonMode.value, rankBy: els.rankBy.value, maxPositions: Number(els.maxPositions.value), initialCapital: Number(els.initialCapital.value), costBps: Number(els.costBps.value), benchmark: els.benchmarkSelect.value, startMonth: els.startMonth.value, endMonth: els.endMonth.value, ...overrides }; }
function simulate(config) {
  const months = monthRange(config.startMonth, config.endMonth); const costRate = config.costBps / 10000;
  const candidateEpisodes = state.episodes.filter((episode) => entryMatches(episode, config) && episode.start_month >= config.startMonth && episode.start_month <= config.endMonth);
  const plans = candidateEpisodes.map((episode) => buildPlan(episode, config)).filter(Boolean); const grouped = new Map();
  plans.forEach((plan) => { if (!grouped.has(plan.episode.start_month)) grouped.set(plan.episode.start_month, []); grouped.get(plan.episode.start_month).push(plan); });
  grouped.forEach((rows) => rows.sort((a, b) => b.score - a.score || String(a.episode.code).localeCompare(String(b.episode.code), "ja", { numeric: true })));
  let cash = config.initialCapital; let positions = []; const trades = []; const curve = []; let previousEquity = config.initialCapital; let skippedCapacity = 0; let peak = config.initialCapital; let maxDrawdown = 0; let utilizationSum = 0;
  months.forEach((month) => {
    let entries = 0; let exits = 0; const survivors = [];
    positions.forEach((position) => {
      const point = position.plan.pathMap.get(month); if (point) position.value *= 1 + Number(point.return_pct) / 100;
      if (position.plan.exitMonth && month === position.plan.exitMonth) {
        position.value *= 1 - costRate; cash += position.value; const tradeReturn = (position.value / position.entryAllocation - 1) * 100;
        trades.push({ code: position.plan.episode.code, name: position.plan.episode.name, entryMonth: position.plan.episode.start_month, exitMonth: month, returnPct: tradeReturn, profitYen: position.value - position.entryAllocation, reason: position.plan.exitReason, holdingMonths: Math.max(1, monthDiff(position.plan.episode.start_month, month)) }); exits += 1;
      } else survivors.push(position);
    });
    positions = survivors;
    const candidates = grouped.get(month) || []; const capacity = Math.max(0, config.maxPositions - positions.length); skippedCapacity += Math.max(0, candidates.length - capacity);
    const totalBeforeEntries = cash + positions.reduce((sum, position) => sum + position.value, 0); const targetAllocation = totalBeforeEntries / config.maxPositions;
    candidates.slice(0, capacity).forEach((plan) => { const allocation = Math.min(cash, targetAllocation); if (allocation < 1000) return; cash -= allocation; positions.push({ plan, entryAllocation: allocation, value: allocation * (1 - costRate) }); entries += 1; });
    const invested = positions.reduce((sum, position) => sum + position.value, 0); const equity = cash + invested; const monthlyReturn = previousEquity ? (equity / previousEquity - 1) * 100 : 0;
    peak = Math.max(peak, equity); maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100); utilizationSum += equity ? invested / equity * 100 : 0;
    curve.push({ month, equity, monthlyReturn, active: positions.length, entries, exits, cash }); previousEquity = equity;
  });
  const finalEquity = curve.at(-1)?.equity ?? config.initialCapital; const totalReturn = (finalEquity / config.initialCapital - 1) * 100; const elapsedMonths = Math.max(1, curve.length - 1); const annualized = (Math.pow(finalEquity / config.initialCapital, 12 / elapsedMonths) - 1) * 100;
  const closedReturns = trades.map((trade) => trade.returnPct); const winRate = closedReturns.length ? closedReturns.filter((value) => value > 0).length / closedReturns.length * 100 : null;
  const benchmarkDefinition = state.data.benchmarks?.[config.benchmark] || {}; const benchmarkMap = new Map((benchmarkDefinition.returns || []).map((point) => [point.month, finite(point.return_pct)])); let benchmarkEquity = config.initialCapital;
  const benchmarkCurve = months.map((month, index) => { if (index > 0) { const value = benchmarkMap.get(month); if (value !== null && value !== undefined) benchmarkEquity *= 1 + value / 100; } return { month, equity: benchmarkEquity }; });
  return { config, candidateCount: candidateEpisodes.length, eligibleCount: plans.length, skippedCapacity, curve, benchmarkCurve, benchmarkName: benchmarkDefinition.name || config.benchmark, trades, openPositions: positions.length, metrics: { cumulative: totalReturn, annualized, maxDrawdown, winRate, trades: trades.length, medianTrade: median(closedReturns), averageTrade: closedReturns.length ? closedReturns.reduce((sum, value) => sum + value, 0) / closedReturns.length : null, averageHolding: trades.length ? trades.reduce((sum, trade) => sum + trade.holdingMonths, 0) / trades.length : null, utilization: curve.length ? utilizationSum / curve.length : null, finalEquity } };
}
function setMetric(element, value, formatter = percent) { element.textContent = formatter(value); element.classList.remove("positive", "negative"); const css = performanceClass(value); if (css) element.classList.add(css); }
function renderChart(result) {
  if (state.chart) state.chart.destroy(); const labels = result.curve.map((point) => point.month); const portfolio = result.curve.map((point) => (point.equity / result.config.initialCapital - 1) * 100); const benchmark = result.benchmarkCurve.map((point) => (point.equity / result.config.initialCapital - 1) * 100);
  state.chart = new Chart(els.equityChart, { type: "line", data: { labels, datasets: [{ label: selectedEntryName(result.config), data: portfolio, borderColor: "#e86ca7", backgroundColor: "rgba(232,108,167,.12)", fill: true, pointRadius: 0, borderWidth: 3, tension: .18 }, { label: result.benchmarkName, data: benchmark, borderColor: "#75bfe8", backgroundColor: "transparent", fill: false, pointRadius: 0, borderWidth: 2, tension: .18 }] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${percent(context.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: "rgba(145,112,133,.12)" }, ticks: { callback: (value) => `${value}%` } } } } });
}
function renderResult(result) {
  state.currentResult = result; setMetric(els.metricCumulative, result.metrics.cumulative); setMetric(els.metricAnnualized, result.metrics.annualized); setMetric(els.metricDrawdown, result.metrics.maxDrawdown); setMetric(els.metricWinRate, result.metrics.winRate);
  els.metricTrades.textContent = `${result.metrics.trades.toLocaleString("ja-JP")}件`; els.metricTrades.className = ""; els.metricFinalValue.textContent = yen(result.metrics.finalEquity); els.metricFinalValue.className = "";
  const rule = EXIT_RULES[result.config.exitRule]; els.resultCaption.textContent = `${selectedEntryName(result.config)} × ${rule.name} / 候補${result.candidateCount}件・採用可能${result.eligibleCount}件・未決済${result.openPositions}件`; renderChart(result);
  els.monthlyBody.innerHTML = result.curve.slice(-18).reverse().map((point) => `<tr><td>${escapeHtml(point.month)}</td><td class="num">${yen(point.equity)}</td><td class="num ${performanceClass(point.monthlyReturn)}">${percent(point.monthlyReturn)}</td><td class="num">${point.active}</td><td class="num">${point.entries}</td><td class="num">${point.exits}</td></tr>`).join("") || `<tr><td colspan="6" class="empty-cell">月次データがありません。</td></tr>`;
  els.tradeBody.innerHTML = [...result.trades].sort((a, b) => b.exitMonth.localeCompare(a.exitMonth)).slice(0, 20).map((trade) => `<tr><td><strong>${escapeHtml(trade.code)}</strong> ${escapeHtml(trade.name)}</td><td>${escapeHtml(trade.entryMonth)}</td><td>${escapeHtml(trade.exitMonth)}</td><td class="num ${performanceClass(trade.returnPct)}" title="${yen(trade.profitYen)}">${percent(trade.returnPct)}</td><td>${escapeHtml(trade.reason)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty-cell">決済済みの取引がありません。</td></tr>`;
}
function renderMatrix(baseConfig) {
  const presetIds = ["rsi", "cosmos", "trend", "vcp", "mvp", "high", "all"]; const exitIds = ["DC", "H1", "H3", "H6"];
  els.matrixBody.innerHTML = presetIds.map((preset) => { const cells = exitIds.map((exitRule) => { const result = simulate({ ...baseConfig, entryMode: "preset", preset, exitRule }); const selected = state.mode === "preset" && state.preset === preset && baseConfig.exitRule === exitRule; return `<td><button class="matrix-cell ${performanceClass(result.metrics.cumulative)}${selected ? " selected" : ""}" type="button" data-matrix-preset="${preset}" data-matrix-exit="${exitRule}">${percent(result.metrics.cumulative, 1)}</button></td>`; }).join(""); return `<tr><td>${escapeHtml(PRESETS[preset].name)}</td>${cells}</tr>`; }).join("");
  els.matrixBody.querySelectorAll("[data-matrix-preset]").forEach((button) => button.addEventListener("click", () => { setMode("preset"); setPreset(button.dataset.matrixPreset); els.exitRule.value = button.dataset.matrixExit; updateRuleSummary(); run(); document.getElementById("resultHeading")?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
}
function updateEligibilityNotice() {
  const rule = EXIT_RULES[els.exitRule.value]; els.horizonMode.disabled = !rule.horizon;
  if (!rule.horizon) els.eligibilityNotice.textContent = "DC出口では、月足RSI5がRSI14以下になった月末で退出します。期間末まで継続中の銘柄は時価評価します。";
  else if (els.horizonMode.value === "strict") els.eligibilityNotice.textContent = `${rule.horizon}か月後までRSIクロスが継続し、対象月の月末価格がある銘柄だけを集計します。これは将来の継続を条件にした観察値であり、事前に再現できる売買ルールではありません。`;
  else els.eligibilityNotice.textContent = `${rule.horizon}か月を上限に保有し、途中でRSIデッドクロスした場合はその月末で早期退出します。対象月まで到達していない直近のNEWは除外します。`;
}
function customSummary() { const parts = [`RSI5≥${els.rsi5Min.value || 0}`]; if (els.requireRsi14Up.checked) parts.push("RSI14上向き"); if (els.requirePerfectOrder.checked) parts.push("PO"); if (els.requireSma200Up.checked) parts.push("SMA200上向き"); if (els.requireStage2.checked) parts.push("第2ステージ"); if (els.requireSupertrend.checked) parts.push("ST上向き"); if (els.requireVcp.checked) parts.push("VCP"); if (els.requireMvp.checked) parts.push("MVP"); if (els.requireVolume.checked) parts.push("出来高1.2倍"); if (els.highZoneSelect.value !== "all") parts.push(`高値${Math.abs(Number(els.highZoneSelect.value))}%以内`); return parts.join("・"); }
function updateRuleSummary() { const entry = state.mode === "custom" ? customSummary() : PRESETS[state.preset].description; const exit = EXIT_RULES[els.exitRule.value].name; els.ruleSummary.textContent = `入口：${entry} ／ 出口：${exit} ／ 上限：${els.maxPositions.value}銘柄 ／ 順位：${els.rankBy.options[els.rankBy.selectedIndex].text}`; updateEligibilityNotice(); }
function setMode(mode) { state.mode = mode; const preset = mode === "preset"; els.presetPanel.hidden = !preset; els.customPanel.hidden = preset; els.presetModeButton.classList.toggle("active", preset); els.presetModeButton.classList.toggle("secondary", !preset); els.customModeButton.classList.toggle("active", !preset); els.customModeButton.classList.toggle("secondary", preset); updateRuleSummary(); }
function setPreset(preset) { state.preset = preset; els.presetButtons.forEach((button) => button.classList.toggle("active", button.dataset.preset === preset)); updateRuleSummary(); }
function populateMonths() {
  const start = state.data.available_start_month; const end = state.data.available_end_month; const months = monthRange(start, end);
  [els.startMonth, els.endMonth].forEach((select) => { select.innerHTML = months.map((month) => `<option value="${month}">${month}</option>`).join(""); });
  els.startMonth.value = start; els.endMonth.value = end; const count = months.length; els.availablePeriod.textContent = `対象 ${start}〜${end}（${count}か月）`; if (count < 60) els.availablePeriod.title = "現在の生成データは5年未満です。次回のデータ更新で60か月へ拡張します。";
}
function run() {
  if (!state.data) return; if (els.startMonth.value > els.endMonth.value) { els.resultCaption.textContent = "開始月は終了月以前にしてください。"; return; }
  document.querySelector(".results-panel")?.classList.add("loading-overlay"); window.setTimeout(() => { const config = readConfig(); const result = simulate(config); renderResult(result); renderMatrix(config); document.querySelector(".results-panel")?.classList.remove("loading-overlay"); }, 0);
}
function bindEvents() {
  els.presetModeButton.addEventListener("click", () => setMode("preset")); els.customModeButton.addEventListener("click", () => setMode("custom")); els.presetButtons.forEach((button) => button.addEventListener("click", () => setPreset(button.dataset.preset)));
  els.maxPositions.addEventListener("input", () => { els.maxPositionsOutput.textContent = `${els.maxPositions.value}銘柄`; updateRuleSummary(); });
  [els.exitRule, els.horizonMode, els.rankBy, els.initialCapital, els.costBps, els.benchmarkSelect, els.startMonth, els.endMonth, els.rsi5Min, els.highZoneSelect, els.requireRsi14Up, els.requirePerfectOrder, els.requireSma200Up, els.requireStage2, els.requireSupertrend, els.requireVcp, els.requireMvp, els.requireVolume].forEach((element) => element.addEventListener("change", updateRuleSummary));
  els.runBacktest.addEventListener("click", run);
}
function showError(error) { els.resultCaption.textContent = `バックテストデータを読み込めませんでした: ${error.message}`; els.ruleSummary.textContent = "データ更新またはPagesの公開状態を確認してください。"; }
async function init() {
  cacheElements(); bindEvents();
  try { const response = await fetch(`data/analysis.json?v=${Date.now()}`, { cache: "no-store" }); if (!response.ok) throw new Error(`data/analysis.json (${response.status})`); state.data = await response.json(); state.episodes = state.data.episodes || []; els.generatedAt.textContent = `データ生成: ${formatDate(state.data.generated_at)}`; populateMonths(); updateRuleSummary(); run(); }
  catch (error) { showError(error); }
}
document.addEventListener("DOMContentLoaded", init);
