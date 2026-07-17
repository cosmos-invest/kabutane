let priceChart;
let rsiChart;

function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function text(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function number(value, digits = 2) {
  const n = finite(value);
  return n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}
function signed(value, suffix = "%") {
  const n = finite(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${suffix}`;
}
function perfClass(value) {
  const n = finite(value);
  if (n === null || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}
function statusBadge(status) {
  const normalized = text(status).toUpperCase();
  const css = normalized === "NEW" ? "new" : normalized === "OUT" ? "out" : "continue";
  return `<span class="badge ${css}">${normalized === "CONTINUE" ? "継続" : normalized}</span>`;
}
function queryCode() {
  return new URLSearchParams(window.location.search).get("code")?.trim() || "";
}
async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} の読込に失敗しました (${response.status})`);
  return response.json();
}

function addStat(container, label, value, css = "") {
  const card = document.createElement("article");
  card.className = "stat-card";
  card.innerHTML = `<span>${label}</span><strong class="${css}">${value}</strong>`;
  container.appendChild(card);
}

function renderHeader(payload) {
  const record = payload.record || {};
  document.title = `${text(payload.name)} (${text(payload.code)}) | 月足RSIクロス・スキャナー`;
  document.getElementById("detailTitle").textContent = `${text(payload.name)}（${text(payload.code)}）`;
  document.getElementById("detailSubtitle").textContent = `${text(record.sector)} / ${text(record.industry)} / 判定月 ${text(record.signal_month)}`;
  document.getElementById("detailStatus").innerHTML = statusBadge(record.status);

  const stats = document.getElementById("detailStats");
  stats.innerHTML = "";
  addStat(stats, "現在値", number(record.current_price));
  addStat(stats, "RSI14", number(record.rsi14));
  addStat(stats, "RSI5", number(record.rsi5));
  addStat(stats, "RSI乖離", signed(record.diff, ""), perfClass(record.diff));
  addStat(stats, "GC後騰落", signed(record.return_since_gc_pct), perfClass(record.return_since_gc_pct));
  addStat(stats, "GC月", text(record.gc_month));
  addStat(stats, "GC価格", number(record.gc_price));
  addStat(stats, "継続月", `${number(record.months_active, 0)}か月`);
  addStat(stats, "前月終値比", signed(record.change_from_signal_month_pct), perfClass(record.change_from_signal_month_pct));
  addStat(stats, "データ充足率", `${number(record.data_completeness_pct, 1)}%`);
}

const gcMarkerPlugin = {
  id: "gcMarker",
  afterDatasetsDraw(chart, args, options) {
    const events = options.events || [];
    if (!events.length) return;
    const labels = chart.data.labels || [];
    const ctx = chart.ctx;
    const area = chart.chartArea;
    ctx.save();
    ctx.strokeStyle = "rgba(94, 230, 168, .78)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.fillStyle = "rgba(94, 230, 168, .95)";
    ctx.font = "700 11px system-ui";
    events.forEach((event) => {
      const index = labels.findIndex((label) => String(label).startsWith(event.month));
      if (index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.fillText("GC", x + 4, area.top + 14);
    });
    ctx.restore();
  },
};

function chartTheme() {
  const style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue("--text").trim() || "#f6f8fc",
    muted: style.getPropertyValue("--muted").trim() || "#9eb0c8",
    line: style.getPropertyValue("--line").trim() || "#29405f",
    accent: style.getPropertyValue("--accent").trim() || "#7dd3fc",
    accent2: style.getPropertyValue("--accent-2").trim() || "#a78bfa",
    positive: style.getPropertyValue("--positive").trim() || "#5ee6a8",
  };
}

function commonOptions(theme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: theme.text, usePointStyle: true } },
      tooltip: { callbacks: {} },
    },
    scales: {
      x: {
        ticks: { color: theme.muted, maxTicksLimit: 12, maxRotation: 0 },
        grid: { color: "rgba(100, 130, 165, .12)" },
      },
      y: {
        ticks: { color: theme.muted },
        grid: { color: "rgba(100, 130, 165, .15)" },
      },
    },
  };
}

function renderCharts(payload) {
  const daily = payload.daily || [];
  const labels = daily.map((row) => row.date);
  const theme = chartTheme();
  Chart.register(gcMarkerPlugin);

  const priceOptions = commonOptions(theme);
  priceOptions.plugins.gcMarker = { events: payload.gc_events || [] };
  priceOptions.plugins.tooltip.callbacks.label = (context) => `終値: ${number(context.parsed.y)}円`;

  priceChart = new Chart(document.getElementById("priceChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "日足終値",
        data: daily.map((row) => row.close),
        borderColor: theme.accent,
        backgroundColor: "rgba(125, 211, 252, .12)",
        borderWidth: 1.6,
        pointRadius: 0,
        pointHitRadius: 8,
        fill: true,
        tension: 0.06,
      }],
    },
    options: priceOptions,
  });

  const rsiOptions = commonOptions(theme);
  rsiOptions.scales.y.min = 0;
  rsiOptions.scales.y.max = 100;
  rsiOptions.scales.y.ticks.stepSize = 20;
  rsiOptions.plugins.annotation = undefined;
  rsiOptions.plugins.tooltip.callbacks.label = (context) => `${context.dataset.label}: ${number(context.parsed.y)}`;

  rsiChart = new Chart(document.getElementById("rsiChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "月足RSI5",
          data: daily.map((row) => row.rsi5),
          borderColor: theme.positive,
          borderWidth: 2,
          pointRadius: 0,
          stepped: "before",
          spanGaps: true,
        },
        {
          label: "月足RSI14",
          data: daily.map((row) => row.rsi14),
          borderColor: theme.accent2,
          borderWidth: 2,
          pointRadius: 0,
          stepped: "before",
          spanGaps: true,
        },
      ],
    },
    options: rsiOptions,
  });
}

function renderEpisodes(episodes) {
  const tbody = document.querySelector("#episodeTable tbody");
  tbody.innerHTML = "";
  if (!episodes?.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">過去実績を取得できませんでした。</td></tr>`;
    return;
  }
  [...episodes].reverse().forEach((episode) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${text(episode.start_month)}</td>
      <td class="num">${number(episode.start_price)}</td>
      <td>${text(episode.end_month, "継続中")}</td>
      <td class="num">${number(episode.end_price)}</td>
      <td class="num ${perfClass(episode.return_pct)}">${signed(episode.return_pct)}</td>
      <td class="num positive">${signed(episode.max_return_pct)}</td>
      <td class="num negative">${signed(episode.min_return_pct)}</td>
      <td class="num">${number(episode.duration_months, 0)}か月</td>
      <td>${episode.status === "ACTIVE" ? '<span class="badge new">継続中</span>' : '<span class="badge neutral">終了</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFundamentals(record) {
  const grid = document.getElementById("fundamentalsGrid");
  const items = [
    ["PER", number(record.per)],
    ["予想PER", number(record.forward_per)],
    ["PBR", number(record.pbr)],
    ["BPS", number(record.book_value)],
    ["配当利回り", `${number(record.dividend_yield_pct)}%`],
    ["配当性向", `${number(record.payout_ratio_pct)}%`],
    ["ROE", `${number(record.roe_pct)}%`],
    ["ROA", `${number(record.roa_pct)}%`],
    ["自己資本比率", `${number(record.equity_ratio_pct)}%`],
    ["流動比率", number(record.current_ratio)],
    ["当座比率", number(record.quick_ratio)],
    ["D/E", `${number(record.debt_to_equity_pct)}%`],
    ["売上成長率", `${number(record.revenue_growth_pct)}%`],
    ["利益成長率", `${number(record.earnings_growth_pct)}%`],
    ["利益率", `${number(record.profit_margin_pct)}%`],
    ["営業利益率", `${number(record.operating_margin_pct)}%`],
    ["時価総額", `${number(record.market_cap_oku, 0)}億円`],
    ["EV", `${number(record.enterprise_value_oku, 0)}億円`],
    ["営業CF", `${number(record.operating_cashflow_oku, 0)}億円`],
    ["FCF", `${number(record.free_cashflow_oku, 0)}億円`],
    ["現金", `${number(record.total_cash_oku, 0)}億円`],
    ["有利子負債", `${number(record.total_debt_oku, 0)}億円`],
    ["EBITDA", `${number(record.ebitda_oku, 0)}億円`],
    ["β", number(record.beta)],
  ];
  grid.innerHTML = items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
}

function showError(error) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = `銘柄詳細を読み込めませんでした: ${error.message}`;
  document.querySelector("main").prepend(banner);
  console.error(error);
}

async function init() {
  const code = queryCode();
  if (!code) {
    showError(new Error("URLに銘柄コードがありません。"));
    return;
  }
  try {
    const payload = await fetchJson(`data/charts/${encodeURIComponent(code)}.json`);
    renderHeader(payload);
    renderCharts(payload);
    renderEpisodes(payload.episodes || []);
    renderFundamentals(payload.record || {});
  } catch (error) {
    showError(error);
    document.getElementById("detailSubtitle").textContent = "この銘柄の詳細データは現在対象銘柄の更新時に生成されます。";
  }
}

document.addEventListener("DOMContentLoaded", init);
