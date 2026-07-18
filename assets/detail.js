let priceChart;
let rsiChart;
let chartPayload;
let priceMode = "candle";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
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
  const focus = document.getElementById("detailFocus");
  if (record.cosmos_focus === true) {
    const type = record.cosmos_focus_type === "MVP" ? "MVP加速型" : record.cosmos_focus_type === "BREAKOUT" ? "新高値型" : "両方適合";
    focus.hidden = false;
    focus.textContent = `🌸 コスモス注目・${type}`;
  } else {
    focus.hidden = true;
  }

  const stats = document.getElementById("detailStats");
  stats.innerHTML = "";
  addStat(stats, "現在値", number(record.current_price));
  addStat(stats, "RSI14", number(record.rsi14));
  addStat(stats, "RSI5", number(record.rsi5));
  addStat(stats, "RSI14方向", record.rsi14_up === true ? "上向き ↑" : record.rsi14_up === false ? "下向き ↓" : "—", record.rsi14_up === true ? "positive" : record.rsi14_up === false ? "negative" : "");
  addStat(stats, "RSI5方向", record.rsi5_up === true ? "上向き ↑" : record.rsi5_up === false ? "下向き ↓" : "—", record.rsi5_up === true ? "positive" : record.rsi5_up === false ? "negative" : "");
  addStat(stats, "RSI乖離", signed(record.diff, ""), perfClass(record.diff));
  addStat(stats, "GC後騰落", signed(record.return_since_gc_pct), perfClass(record.return_since_gc_pct));
  addStat(stats, "GC月", text(record.gc_month));
  addStat(stats, "GC価格", number(record.gc_price));
  addStat(stats, "継続月", `${number(record.months_active, 0)}か月`);
  addStat(stats, "前月終値比", signed(record.change_from_signal_month_pct), perfClass(record.change_from_signal_month_pct));
  addStat(stats, "データ充足率", `${number(record.data_completeness_pct, 1)}%`);

  const explanation = document.getElementById("rsiExplanation");
  if (record.rsi5_up === true && record.rsi14_up === false) {
    explanation.innerHTML = "<strong>RSI5が上向き、RSI14が下向きでも矛盾ではありません。</strong> RSI5は直近5か月、RSI14は直近14か月の上げ幅・下げ幅を別々に計算します。短期の弱い月が計算外へ抜ける一方、14か月側では過去の大きな上昇月が抜けると、この組み合わせが起こります。";
  } else {
    explanation.textContent = "RSI5とRSI14は、それぞれ異なる期間の値動きから独立して計算しています。";
  }
}

const crossMarkerPlugin = {
  id: "crossMarker",
  afterDatasetsDraw(chart, args, options) {
    const events = options.events || [];
    if (!events.length) return;
    const labels = chart.data.labels || [];
    const ctx = chart.ctx;
    const area = chart.chartArea;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.font = "700 11px system-ui";
    events.forEach((event) => {
      const index = labels.findIndex((label) => String(label) === event.date);
      if (index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      const isGc = event.type === "GC";
      ctx.strokeStyle = isGc ? "rgba(15, 159, 112, .85)" : "rgba(225, 29, 72, .82)";
      ctx.fillStyle = isGc ? "rgba(5, 120, 87, 1)" : "rgba(190, 18, 60, 1)";
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.fillText(event.type, x + 4, area.top + (isGc ? 14 : 29));
    });
    ctx.restore();
  },
};

const corporateMarkerPlugin = {
  id: "corporateMarker",
  afterDatasetsDraw(chart, args, options) {
    const events = options.events || [];
    const labels = chart.data.labels || [];
    if (!events.length || !labels.length) return;
    const eventLabels = { EARNINGS: "決算", RIGHTS: "権利", DIVIDEND: "配当", SPLIT: "分割" };
    const eventColors = { EARNINGS: "#2563eb", RIGHTS: "#db2777", DIVIDEND: "#d97706", SPLIT: "#7c3aed" };
    const ctx = chart.ctx;
    const area = chart.chartArea;
    const visible = events.filter((event) => event.date >= labels[0] && event.date <= labels[labels.length - 1]);
    ctx.save();
    ctx.font = "700 10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    visible.forEach((event, eventIndex) => {
      // 決算日が休場日の場合は、直後の取引日に寄せて表示する。
      let index = labels.findIndex((label) => String(label) >= event.date);
      if (index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      const y = area.bottom - 14 - (eventIndex % 3) * 18;
      const label = eventLabels[event.type] || "情報";
      const color = eventColors[event.type] || "#475569";
      const width = Math.max(30, ctx.measureText(label).width + 12);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - width / 2, y - 8, width, 16, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x, y);
    });
    ctx.restore();
  },
};

function heikinAshi(rows) {
  let previousOpen = null;
  let previousClose = null;
  return rows.map((row) => {
    const open = finite(row.open); const high = finite(row.high); const low = finite(row.low); const close = finite(row.close);
    if ([open, high, low, close].some((value) => value === null)) return { ...row };
    const haClose = (open + high + low + close) / 4;
    const haOpen = previousOpen === null ? (open + close) / 2 : (previousOpen + previousClose) / 2;
    const converted = { ...row, open: haOpen, high: Math.max(high, haOpen, haClose), low: Math.min(low, haOpen, haClose), close: haClose };
    previousOpen = haOpen; previousClose = haClose;
    return converted;
  });
}

const candlePlugin = {
  id: "candles",
  beforeDatasetsDraw(chart, args, options) {
    const rows = options.rows || [];
    if (!rows.length || !chart.scales.x || !chart.scales.y) return;
    const ctx = chart.ctx; const xScale = chart.scales.x; const yScale = chart.scales.y;
    const sampleWidth = rows.length > 1 ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) : 8;
    const bodyWidth = Math.max(1, Math.min(9, sampleWidth * 0.68));
    ctx.save();
    rows.forEach((row, index) => {
      const open = finite(row.open); const high = finite(row.high); const low = finite(row.low); const close = finite(row.close);
      if ([open, high, low, close].some((value) => value === null)) return;
      const x = xScale.getPixelForValue(index); const rising = close >= open;
      const color = rising ? "#059669" : "#e11d48";
      const top = yScale.getPixelForValue(Math.max(open, close)); const bottom = yScale.getPixelForValue(Math.min(open, close));
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yScale.getPixelForValue(high)); ctx.lineTo(x, yScale.getPixelForValue(low)); ctx.stroke();
      ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top));
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
    negative: style.getPropertyValue("--negative").trim() || "#fb7185",
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
  Chart.register(crossMarkerPlugin, corporateMarkerPlugin, candlePlugin);

  if (priceChart) priceChart.destroy();
  if (rsiChart) rsiChart.destroy();

  const priceRows = priceMode === "heikin" ? heikinAshi(daily) : daily;
  const highs = priceRows.map((row) => finite(row.high)).filter((value) => value !== null);
  const lows = priceRows.map((row) => finite(row.low)).filter((value) => value !== null);
  const volumes = daily.map((row) => finite(row.volume) || 0);
  const priceMin = lows.length ? Math.min(...lows) : undefined;
  const priceMax = highs.length ? Math.max(...highs) : undefined;
  const pricePadding = priceMin !== undefined && priceMax !== undefined ? (priceMax - priceMin) * 0.04 : 0;

  const priceOptions = commonOptions(theme);
  priceOptions.plugins.crossMarker = { events: payload.cross_events || [] };
  priceOptions.plugins.corporateMarker = { events: payload.corporate_events || [] };
  priceOptions.plugins.candles = { rows: priceRows };
  priceOptions.plugins.tooltip.callbacks.label = (context) => {
    const row = priceRows[context.dataIndex] || {};
    if (context.dataset.yAxisID === "volume") return `出来高: ${number(row.volume, 0)}`;
    if (String(context.dataset.label).startsWith("SMA")) return `${context.dataset.label}: ${number(context.parsed.y)}円`;
    return [`始値: ${number(row.open)}円`, `高値: ${number(row.high)}円`, `安値: ${number(row.low)}円`, `終値: ${number(row.close)}円`];
  };
  priceOptions.scales.y.suggestedMin = priceMin === undefined ? undefined : priceMin - pricePadding;
  priceOptions.scales.y.suggestedMax = priceMax === undefined ? undefined : priceMax + pricePadding;
  priceOptions.scales.volume = {
    display: false,
    position: "right",
    beginAtZero: true,
    max: Math.max(1, ...volumes) * 4,
    grid: { display: false },
  };

  priceChart = new Chart(document.getElementById("priceChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: priceMode === "heikin" ? "平均足" : "ローソク足",
          data: priceRows.map((row) => row.close),
          borderColor: "rgba(0,0,0,0)", backgroundColor: "rgba(0,0,0,0)", borderWidth: 0,
          pointRadius: 0, pointHitRadius: 8,
        },
        { label: "SMA25", data: daily.map((row) => row.sma25), borderColor: "#f59e0b", borderWidth: 1.4, pointRadius: 0, spanGaps: true },
        { label: "SMA75", data: daily.map((row) => row.sma75), borderColor: "#3b82f6", borderWidth: 1.4, pointRadius: 0, spanGaps: true },
        { label: "SMA200", data: daily.map((row) => row.sma200), borderColor: "#a855f7", borderWidth: 1.7, pointRadius: 0, spanGaps: true },
        {
          type: "bar", label: "出来高", data: volumes, yAxisID: "volume",
          backgroundColor: daily.map((row) => finite(row.close) >= finite(row.open) ? "rgba(5,150,105,.28)" : "rgba(225,29,72,.24)"),
          borderWidth: 0, barPercentage: 1, categoryPercentage: 1,
        },
      ],
    },
    options: priceOptions,
  });

  const rsiOptions = commonOptions(theme);
  rsiOptions.scales.y.min = 0;
  rsiOptions.scales.y.max = 100;
  rsiOptions.scales.y.ticks.stepSize = 20;
  rsiOptions.plugins.crossMarker = { events: payload.cross_events || [] };
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

function setPriceMode(mode) {
  priceMode = mode;
  document.getElementById("candleMode").classList.toggle("active", mode === "candle");
  document.getElementById("candleMode").classList.toggle("secondary", mode !== "candle");
  document.getElementById("heikinMode").classList.toggle("active", mode === "heikin");
  document.getElementById("heikinMode").classList.toggle("secondary", mode !== "heikin");
  if (chartPayload) renderCharts(chartPayload);
}

function renderCorporateEvents(events) {
  const container = document.getElementById("corporateEvents");
  if (!events?.length) {
    container.innerHTML = '<p class="empty-state">取得できる企業イベントはありません。</p>';
    return;
  }
  const labels = { EARNINGS: "決算", RIGHTS: "権利", DIVIDEND: "配当", SPLIT: "分割" };
  container.innerHTML = [...events].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((event) => `
    <article class="event-card event-${String(event.type || "").toLowerCase()}">
      <time datetime="${text(event.date)}">${text(event.date)}</time>
      <span>${labels[event.type] || "情報"}</span>
      <strong>${text(event.label)}</strong>
      <small>${text(event.detail)}</small>
    </article>`).join("");
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
    chartPayload = payload;
    renderHeader(payload);
    renderCharts(payload);
    renderCorporateEvents(payload.corporate_events || []);
    renderEpisodes(payload.episodes || []);
    renderFundamentals(payload.record || {});
  } catch (error) {
    showError(error);
    document.getElementById("detailSubtitle").textContent = "この銘柄の詳細データは現在対象銘柄の更新時に生成されます。";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("candleMode").addEventListener("click", () => setPriceMode("candle"));
  document.getElementById("heikinMode").addEventListener("click", () => setPriceMode("heikin"));
  init();
});
