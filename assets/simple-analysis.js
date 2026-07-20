const simpleState = {
  data: null,
  rows: [],
  selected: new Set(["rsi"]),
  purpose: "starter",
  page: 1,
  pageSize: 18,
};

const CONDITION_LABELS = {
  rsi: "RSI",
  sepa: "SEPA型",
  vcp: "VCP",
  mvp: "MVP",
  high: "高値位置",
  finance: "財務",
};

const PURPOSES = {
  starter: ["rsi"],
  trend: ["rsi", "sepa"],
  vcp: ["rsi", "sepa", "vcp"],
  mvp: ["rsi", "mvp"],
  high: ["rsi", "sepa", "high"],
  balance: ["rsi", "sepa", "high", "finance"],
};

const els = {};
const $ = (id) => document.getElementById(id);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value) {
  return String(value ?? "—").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function number(value, digits = 1) {
  const parsed = finite(value);
  return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function signed(value) {
  const parsed = finite(value);
  if (parsed === null) return "—";
  return `${parsed > 0 ? "+" : ""}${number(parsed)}%`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo",
  }).format(date);
}

function isRsi(row) {
  return finite(row.rsi5) >= 60 && row.rsi14_up === true;
}

function isSepa(row) {
  return row.perfect_order === true
    && row.price_above_sma25 === true
    && row.price_above_sma75 === true
    && row.price_above_sma200 === true
    && row.sma200_up === true
    && finite(row.stage) === 2
    && row.supertrend_up === true;
}

function isVcp(row) {
  return row.vcp_tight === true && row.supertrend_up === true;
}

function isMvp(row) {
  return row.mvp_signal === true;
}

function isHigh(row) {
  const distance = finite(row.high52_distance_pct);
  return distance !== null && distance >= -10;
}

function isFinance(row) {
  const cashflow = finite(row.operating_cashflow_oku);
  const equity = finite(row.equity_ratio_pct);
  return cashflow !== null && cashflow > 0 && equity !== null && equity >= 40;
}

const CONDITION_TESTS = {
  rsi: isRsi,
  sepa: isSepa,
  vcp: isVcp,
  mvp: isMvp,
  high: isHigh,
  finance: isFinance,
};

function rowMatches(row) {
  return [...simpleState.selected].every((condition) => CONDITION_TESTS[condition](row));
}

function fitConditions(row) {
  return Object.keys(CONDITION_TESTS).filter((condition) => CONDITION_TESTS[condition](row));
}

function financeScore(row) {
  let score = 0;
  if (finite(row.operating_cashflow_oku) > 0) score += 45;
  const equity = finite(row.equity_ratio_pct);
  if (equity !== null) score += Math.min(35, equity * 0.5);
  const roe = finite(row.roe_pct);
  if (roe !== null && roe > 0) score += Math.min(20, roe);
  return score;
}

function recommendationScore(row) {
  let score = 0;
  if (isRsi(row)) score += 30;
  if (isSepa(row)) score += 25;
  if (isVcp(row)) score += 12;
  if (isMvp(row)) score += 13;
  if (isHigh(row)) score += 10;
  if (isFinance(row)) score += 10;
  const distance = finite(row.high52_distance_pct);
  if (distance !== null) score += Math.max(0, 5 - Math.abs(distance) / 10);
  return score;
}

function filteredRows() {
  const status = els.statusFilter.value;
  const query = els.searchInput.value.trim().toLowerCase();
  return simpleState.rows.filter((row) => {
    if (!rowMatches(row)) return false;
    if (status !== "ALL" && row.status !== status) return false;
    if (query && !`${row.code ?? ""} ${row.name ?? ""} ${row.ticker ?? ""}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function sortedRows(rows) {
  const sort = els.sortSelect.value;
  return [...rows].sort((a, b) => {
    if (sort === "newest") {
      if (a.status !== b.status) return a.status === "NEW" ? -1 : 1;
      return (finite(a.months_active) ?? 999) - (finite(b.months_active) ?? 999);
    }
    if (sort === "rsi") return (finite(b.rsi5) ?? -Infinity) - (finite(a.rsi5) ?? -Infinity);
    if (sort === "high") return (finite(b.high52_distance_pct) ?? -Infinity) - (finite(a.high52_distance_pct) ?? -Infinity);
    if (sort === "return") return (finite(b.return_since_gc_pct) ?? -Infinity) - (finite(a.return_since_gc_pct) ?? -Infinity);
    if (sort === "finance") return financeScore(b) - financeScore(a);
    return recommendationScore(b) - recommendationScore(a)
      || (finite(b.rsi5) ?? -Infinity) - (finite(a.rsi5) ?? -Infinity);
  });
}

function statusBadge(row) {
  if (row.status === "NEW") return '<span class="simple-badge new">NEW</span>';
  return `<span class="simple-badge continue">継続 ${number(row.months_active, 0)}か月</span>`;
}

function metricClass(value) {
  const parsed = finite(value);
  return parsed === null || parsed === 0 ? "" : parsed > 0 ? "positive" : "negative";
}

function renderSelectedConditions() {
  els.selectedConditions.innerHTML = [...simpleState.selected]
    .map((condition) => `<span>${escapeHtml(CONDITION_LABELS[condition])}</span>`).join("")
    || '<span class="empty-chip">条件なし</span>';
}

function renderConditionButtons() {
  document.querySelectorAll("[data-condition]").forEach((button) => {
    const selected = simpleState.selected.has(button.dataset.condition);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const check = button.querySelector(".condition-check");
    if (check) check.textContent = selected ? "✓" : "＋";
  });
}

function renderPurposeCards() {
  document.querySelectorAll("[data-purpose]").forEach((button) => {
    button.classList.toggle("active", button.dataset.purpose === simpleState.purpose);
  });
}

function renderStats(rows) {
  els.candidateCount.textContent = rows.length.toLocaleString("ja-JP");
  els.newCount.textContent = rows.filter((row) => row.status === "NEW").length.toLocaleString("ja-JP");
  const returns = rows.map((row) => finite(row.return_since_gc_pct)).filter((value) => value !== null);
  const result = median(returns);
  els.medianReturn.textContent = signed(result);
  els.medianReturn.className = metricClass(result);
}

function renderCards(rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / simpleState.pageSize));
  simpleState.page = Math.min(simpleState.page, totalPages);
  const start = (simpleState.page - 1) * simpleState.pageSize;
  const pageRows = rows.slice(start, start + simpleState.pageSize);

  els.candidateGrid.innerHTML = pageRows.map((row, index) => {
    const conditions = fitConditions(row);
    const rank = start + index + 1;
    const returnValue = finite(row.return_since_gc_pct);
    const highDistance = finite(row.high52_distance_pct);
    return `<article class="candidate-card">
      <div class="candidate-rank">${rank}</div>
      <div class="candidate-main">
        <div class="candidate-title-row">
          <div><span class="candidate-code">${escapeHtml(row.code)}</span><h3>${escapeHtml(row.name)}</h3></div>
          ${statusBadge(row)}
        </div>
        <div class="fit-row" aria-label="適合条件">
          ${conditions.map((condition) => `<span class="fit-badge ${condition}">${escapeHtml(CONDITION_LABELS[condition])}</span>`).join("")}
        </div>
        <div class="candidate-metrics">
          <div><span>RSI5</span><strong>${number(row.rsi5)}</strong></div>
          <div><span>52週高値まで</span><strong>${highDistance === null ? "—" : `${number(Math.abs(highDistance))}%`}</strong></div>
          <div><span>GC後騰落</span><strong class="${metricClass(returnValue)}">${signed(returnValue)}</strong></div>
        </div>
        <div class="candidate-footer">
          <small>条件一致 ${conditions.length}/6</small>
          <a class="button detail-button" href="detail.html?code=${encodeURIComponent(row.code)}">詳しく見る</a>
        </div>
      </div>
    </article>`;
  }).join("") || `<div class="simple-empty-state"><strong>条件に合う銘柄がありません</strong><p>条件を1つ外すか、「まずは基本」を選んでみてください。</p></div>`;

  els.pageInfo.textContent = `${simpleState.page} / ${totalPages}`;
  els.prevPage.disabled = simpleState.page <= 1;
  els.nextPage.disabled = simpleState.page >= totalPages;
}

function render() {
  const rows = sortedRows(filteredRows());
  const labels = [...simpleState.selected].map((key) => CONDITION_LABELS[key]).join(" ＋ ") || "条件なし";
  els.resultSummary.textContent = `${labels}で ${rows.length.toLocaleString("ja-JP")}銘柄を抽出`;
  renderSelectedConditions();
  renderConditionButtons();
  renderPurposeCards();
  renderStats(rows);
  renderCards(rows);
}

function applyPurpose(purpose) {
  simpleState.purpose = purpose;
  simpleState.selected = new Set(PURPOSES[purpose] || PURPOSES.starter);
  simpleState.page = 1;
  render();
}

function toggleCondition(condition) {
  simpleState.purpose = "custom";
  if (simpleState.selected.has(condition)) simpleState.selected.delete(condition);
  else simpleState.selected.add(condition);
  simpleState.page = 1;
  render();
}

function cacheElements() {
  [
    "generatedAt", "signalMonth", "resetSimpleFilters", "statusFilter", "sortSelect", "searchInput",
    "selectedConditions", "candidateCount", "newCount", "medianReturn", "candidateGrid",
    "resultSummary", "prevPage", "nextPage", "pageInfo",
  ].forEach((id) => { els[id] = $(id); });
}

function bindEvents() {
  document.querySelectorAll("[data-purpose]").forEach((button) => {
    button.addEventListener("click", () => applyPurpose(button.dataset.purpose));
  });
  document.querySelectorAll("[data-condition]").forEach((button) => {
    button.addEventListener("click", () => toggleCondition(button.dataset.condition));
  });
  els.resetSimpleFilters.addEventListener("click", () => {
    els.statusFilter.value = "ALL";
    els.sortSelect.value = "recommended";
    els.searchInput.value = "";
    applyPurpose("starter");
  });
  [els.statusFilter, els.sortSelect].forEach((element) => element.addEventListener("change", () => {
    simpleState.page = 1;
    render();
  }));
  els.searchInput.addEventListener("input", () => {
    simpleState.page = 1;
    render();
  });
  els.prevPage.addEventListener("click", () => {
    simpleState.page = Math.max(1, simpleState.page - 1);
    render();
    document.getElementById("resultTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.nextPage.addEventListener("click", () => {
    simpleState.page += 1;
    render();
    document.getElementById("resultTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function init() {
  cacheElements();
  bindEvents();
  try {
    const response = await fetch(`data/latest.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`データの読込に失敗しました (${response.status})`);
    simpleState.data = await response.json();
    simpleState.rows = simpleState.data.records || [];
    els.generatedAt.textContent = `データ生成: ${formatDate(simpleState.data.generated_at)}`;
    els.signalMonth.textContent = `判定月 ${simpleState.data.signal_month || "—"}`;
    render();
  } catch (error) {
    els.resultSummary.textContent = error.message;
    els.candidateGrid.innerHTML = `<div class="simple-empty-state"><strong>データを読み込めませんでした</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
