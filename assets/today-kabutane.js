const todayState = {
  events: null,
  snapshot: null,
  filter: "all",
};

const TYPE_LABELS = {
  OFFICIAL_NEW: "正式NEW",
  OFFICIAL_OUT: "正式OUT",
  ACTIVE_ADDED: "対象追加",
  ACTIVE_REMOVED: "対象除外",
  PROVISIONAL_GC: "暫定GC",
  PROVISIONAL_DC: "暫定DC",
  PROVISIONAL_RECOVERY: "暫定回復",
  RSI_NEAR_CROSS: "クロス接近",
  TOP10_ENTRY: "TOP10入り",
  RANK_MOVE: "順位変動",
  PRICE_MOVE: "値動き",
  RETURN_MILESTONE: "成績節目",
};

const CATEGORY_LABELS = {
  signal: "シグナル",
  ranking: "順位",
  price: "値動き",
  performance: "成績",
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "—").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
  const number = finite(value);
  if (number === null) return "—";
  return number.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function formatSigned(value, suffix = "") {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${formatNumber(number)}${suffix}`;
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function eventMode(event) {
  if (["OFFICIAL_NEW", "OFFICIAL_OUT"].includes(event.type)) return "official";
  if (String(event.type || "").startsWith("PROVISIONAL_") || event.type === "RSI_NEAR_CROSS") return "provisional";
  return null;
}

function modeLabel(mode) {
  if (mode === "official") return "月足確定";
  if (mode === "provisional") return "月末未確定";
  return "";
}

function formatDiffValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (key === "rank") return `${formatNumber(value, 0)}位`;
  if (key === "move") return `${formatSigned(value)}位`;
  if (key === "spread") return `${formatSigned(value)}pt`;
  if (key === "return_since_gc_pct" || key === "daily_change_pct" || key === "milestone") return formatSigned(value, "%");
  if (key === "current_price" || key === "exit_price") return `${formatNumber(value)}円`;
  return String(value);
}

function keyLabel(key) {
  return ({
    status: "状態",
    rank: "順位",
    move: "順位差",
    spread: "RSI差",
    return_since_gc_pct: "GC後",
    daily_change_pct: "日次",
    milestone: "節目",
    current_price: "株価",
    exit_price: "OUT価格",
    signal_month: "判定月",
    exit_month: "OUT月",
    price_date: "価格日",
  })[key] || key;
}

function renderDiff(before, after) {
  const keys = [...new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])].filter((key) => !["status"].includes(key) || (before || {})[key] !== (after || {})[key]);

  if (!keys.length) return "";
  return `<div class="today-diff-row">${keys.map((key) => {
    const left = (before || {})[key];
    const right = (after || {})[key];
    const hasLeft = left !== null && left !== undefined;
    const hasRight = right !== null && right !== undefined;
    let value = "";
    if (hasLeft && hasRight && String(left) !== String(right)) {
      value = `<strong>${escapeHtml(formatDiffValue(key, left))}</strong><span>→</span><strong>${escapeHtml(formatDiffValue(key, right))}</strong>`;
    } else if (hasRight) {
      value = `<strong>${escapeHtml(formatDiffValue(key, right))}</strong>`;
    } else if (hasLeft) {
      value = `<strong>${escapeHtml(formatDiffValue(key, left))}</strong>`;
    } else {
      return "";
    }
    return `<span class="today-diff-chip"><span>${escapeHtml(keyLabel(key))}</span>${value}</span>`;
  }).join("")}</div>`;
}

function renderEventCard(event) {
  const mode = eventMode(event);
  const category = event.category || "signal";
  const code = String(event.code || "");
  return `<article class="today-event-card ${escapeHtml(event.severity || "low")}" data-category="${escapeHtml(category)}">
    <span class="today-event-accent" aria-hidden="true"></span>
    <div class="today-event-body">
      <div class="today-event-top">
        <div>
          <div class="today-event-badges">
            <span class="today-pill ${escapeHtml(category)}">${escapeHtml(CATEGORY_LABELS[category] || category)}</span>
            ${mode ? `<span class="today-pill ${escapeHtml(mode)}">${escapeHtml(modeLabel(mode))}</span>` : ""}
            <span class="today-pill">${escapeHtml(TYPE_LABELS[event.type] || event.type || "変化")}</span>
          </div>
          <div class="today-event-title-line">
            <span>${escapeHtml(code)}</span>
            <strong>${escapeHtml(event.name || code)}</strong>
          </div>
          <h3 class="today-event-name">${escapeHtml(event.title || "変化を検出")}</h3>
        </div>
        ${code ? `<a class="today-event-link" href="detail.html?code=${encodeURIComponent(code)}">詳しく見る</a>` : ""}
      </div>
      <p class="today-event-detail">${escapeHtml(event.detail || "")}</p>
      ${renderDiff(event.before, event.after)}
    </div>
  </article>`;
}

function filteredEvents() {
  const rows = todayState.events?.events || [];
  if (todayState.filter === "all") return rows;
  return rows.filter((event) => event.category === todayState.filter);
}

function renderEmpty() {
  const state = todayState.events?.comparison_state;
  if (state === "baseline_no_previous") {
    return `<div class="today-empty"><span>🌱</span><strong>今日は比較の1日目です</strong><p>最初のSnapshotを保存しました。次の更新から、正式シグナル・暫定月足・順位・値動きの変化がここに並びます。</p></div>`;
  }
  if (todayState.filter !== "all") {
    return `<div class="today-empty"><span>🍃</span><strong>この分類に大きな変化はありません</strong><p>「すべて」に戻すと、ほかの分類の変化を確認できます。</p></div>`;
  }
  return `<div class="today-empty"><span>🍀</span><strong>前回から大きな変化はありません</strong><p>変化がない日も大切な記録です。候補一覧や練習ページはいつも通り使えます。</p></div>`;
}

function renderEvents() {
  const container = $("eventList");
  const rows = filteredEvents();
  container.innerHTML = rows.length ? rows.map(renderEventCard).join("") : renderEmpty();
  $("eventLead").textContent = todayState.filter === "all"
    ? `${(todayState.events?.summary?.event_count ?? rows.length).toLocaleString("ja-JP")}件の変化を重要度順に表示しています。`
    : `${CATEGORY_LABELS[todayState.filter] || todayState.filter}の変化を ${rows.length.toLocaleString("ja-JP")}件表示しています。`;
}

function renderSummary() {
  const summary = todayState.events?.summary || {};
  const marketCount = (summary.ranking_count || 0) + (summary.price_count || 0) + (summary.performance_count || 0);
  $("summaryTotal").textContent = Number(summary.event_count || 0).toLocaleString("ja-JP");
  $("summaryHigh").textContent = Number(summary.high_count || 0).toLocaleString("ja-JP");
  $("summarySignal").textContent = Number(summary.signal_count || 0).toLocaleString("ja-JP");
  $("summaryMarket").textContent = Number(marketCount).toLocaleString("ja-JP");
}

function renderMeta() {
  const events = todayState.events || {};
  const snapshot = todayState.snapshot || {};
  $("todayUpdatedAt").textContent = `生成: ${formatTimestamp(events.generated_at || snapshot.generated_at)}`;
  $("todaySignalMonth").textContent = `判定月 ${events.signal_month || snapshot.signal_month || "—"}`;
  if (events.comparison_state === "baseline_no_previous") {
    $("comparisonLabel").textContent = `${formatDate(events.snapshot_date)}｜初回記録`;
  } else {
    $("comparisonLabel").textContent = `${formatDate(events.previous_snapshot_date)} → ${formatDate(events.snapshot_date)}`;
  }
  const source = snapshot.source_state === "daily_overlay" ? "日次更新を反映" : "月次基準データ";
  $("sourceStateLabel").textContent = source;
}

function setError(message) {
  $("eventLead").textContent = "イベントFeedをまだ表示できません。";
  $("eventList").innerHTML = `<div class="today-empty"><span>🛠️</span><strong>差分データの初回生成待ちです</strong><p>${escapeHtml(message)}<br>基盤が本番更新に入ると、このページへ自動で変化が表示されます。</p></div>`;
  ["summaryTotal", "summaryHigh", "summarySignal", "summaryMarket"].forEach((id) => { $(id).textContent = "—"; });
  $("comparisonLabel").textContent = "比較データ未生成";
  $("sourceStateLabel").textContent = "";
}

function bindFilters() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      todayState.filter = button.dataset.filter || "all";
      document.querySelectorAll("[data-filter]").forEach((target) => {
        const active = target === button;
        target.classList.toggle("active", active);
        target.setAttribute("aria-pressed", String(active));
      });
      renderEvents();
    });
  });
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} (${response.status})`);
  return response.json();
}

async function initToday() {
  bindFilters();
  try {
    const [events, snapshot] = await Promise.all([
      fetchJson("data/daily-events.json"),
      fetchJson("data/daily-snapshot.json"),
    ]);
    todayState.events = events;
    todayState.snapshot = snapshot;
    if (events.snapshot_date !== snapshot.snapshot_date) {
      throw new Error("Snapshotとイベントの更新日が一致していません。再生成を確認してください。");
    }
    renderMeta();
    renderSummary();
    renderEvents();
  } catch (error) {
    setError(error?.message || "データ読込に失敗しました。");
  }
}

document.addEventListener("DOMContentLoaded", initToday);
