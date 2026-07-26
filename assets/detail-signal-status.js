(function () {
  "use strict";

  if (typeof window === "undefined" || typeof ProvisionalMonthlyRsiCore === "undefined") return;

  const Core = ProvisionalMonthlyRsiCore;
  let sourcePayload = null;
  let renderHookInstalled = false;
  let retryTimer = 0;

  function finite(value) {
    return Core.finite(value);
  }

  function number(value, digits = 2) {
    const parsed = finite(value);
    return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function signed(value) {
    const parsed = finite(value);
    return parsed === null ? "—" : `${parsed > 0 ? "+" : ""}${number(parsed)}`;
  }

  function formatMonth(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    return match ? `${match[1]}年${Number(match[2])}月` : String(value || "—");
  }

  function formatDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : String(value || "—");
  }

  function formalRecord(record) {
    return {
      rsi: finite(record?.monthly_rsi14 ?? record?.rsi5),
      ma: finite(record?.monthly_rsi_ma5 ?? record?.rsi14),
      rsiUp: record?.monthly_rsi14_up ?? record?.rsi5_up,
      maUp: record?.monthly_rsi_ma5_up ?? record?.rsi14_up,
      spread: finite(record?.monthly_rsi_spread ?? record?.diff),
    };
  }

  function formalRowRsi(row) {
    return finite(row?.monthly_rsi14 ?? row?.rsi5);
  }

  function formalRowMa(row) {
    return finite(row?.monthly_rsi_ma5 ?? row?.rsi14);
  }

  function confirmedLabel(status) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "NEW") return "確定NEW";
    if (normalized === "OUT") return "確定OUT";
    return "確定：継続";
  }

  function statusClass(status) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "NEW" || normalized === "GC") return "signal-positive";
    if (normalized === "OUT" || normalized === "DC") return "signal-negative";
    return "signal-neutral";
  }

  function relation(rsi, ma) {
    if (rsi === null || ma === null) return "—";
    return rsi > ma ? ">" : "≤";
  }

  function ensurePanel() {
    let panel = document.getElementById("monthlySignalSnapshot");
    if (panel) return panel;
    const stats = document.getElementById("detailStats");
    if (!stats) return null;
    panel = document.createElement("section");
    panel.id = "monthlySignalSnapshot";
    panel.className = "panel monthly-signal-snapshot";
    panel.innerHTML = `
      <div class="monthly-signal-heading">
        <div><span class="eyebrow">CONFIRMED & IN PROGRESS</span><h2>確定シグナルと進行中月の暫定値</h2></div>
        <p>正式なNEW・CONTINUE・OUTは月末確定値だけで判定します。暫定値は最新日足までで計算した観察情報です。</p>
      </div>
      <div id="monthlySignalCards" class="monthly-signal-cards"></div>
      <p class="monthly-signal-disclaimer">暫定GC・暫定DCは月末までに消える場合があります。ランキング、月初レポート、確定ステータスには反映しません。</p>`;
    stats.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function provisionalMessage(signal) {
    if (!signal) return "進行中月の暫定値をまだ計算できません。日次データがそろうと表示されます。";
    if (signal.status === "DC") return "進行中の月足では5か月MA以下です。ただし月末未確定なので、正式なOUTではありません。";
    if (signal.status === "GC") return "進行中の月足では5か月MAを上回っています。ただし月末未確定なので、正式なNEWではありません。";
    if (signal.active) return "現時点では確定シグナルと同じく上側です。月末までは数値が動きます。";
    return "現時点では5か月MA以下です。月末までは数値が動きます。";
  }

  function renderPanel(payload) {
    const panel = ensurePanel();
    if (!panel) return;
    const record = payload?.record || {};
    const confirmed = formalRecord(record);
    const provisional = Core.fromPayload(payload);
    const cards = document.getElementById("monthlySignalCards");
    if (!cards) return;
    const confirmedStatus = String(record.status || "CONTINUE").toUpperCase();
    const provisionalMarkup = provisional ? `
      <article class="monthly-signal-card provisional ${statusClass(provisional.status)} ${provisional.changed_from_confirmed ? "signal-changed" : ""}">
        <div class="monthly-signal-card-head"><span>進行中の${formatMonth(provisional.month)}</span><strong>${Core.statusLabel(provisional)}</strong></div>
        <p class="monthly-signal-date">${formatDate(provisional.price_date)}終値時点・月末未確定</p>
        <div class="monthly-signal-values"><b>RSI14 ${number(provisional.monthly_rsi14)}</b><em>${relation(provisional.monthly_rsi14, provisional.monthly_rsi_ma5)}</em><b>5か月MA ${number(provisional.monthly_rsi_ma5)}</b></div>
        <p>${provisionalMessage(provisional)}</p>
      </article>` : `
      <article class="monthly-signal-card provisional signal-neutral">
        <div class="monthly-signal-card-head"><span>進行中月</span><strong>暫定値なし</strong></div>
        <p>${provisionalMessage(null)}</p>
      </article>`;
    cards.innerHTML = `
      <article class="monthly-signal-card confirmed ${statusClass(confirmedStatus)}">
        <div class="monthly-signal-card-head"><span>正式な確定シグナル</span><strong>${confirmedLabel(confirmedStatus)}</strong></div>
        <p class="monthly-signal-date">${formatMonth(record.signal_month)}末の終値で確定</p>
        <div class="monthly-signal-values"><b>RSI14 ${number(confirmed.rsi)}</b><em>${relation(confirmed.rsi, confirmed.ma)}</em><b>5か月MA ${number(confirmed.ma)}</b></div>
        <p>ランキングとNEW・OUT判定には、この確定値だけを使います。</p>
      </article>
      ${provisionalMarkup}`;
  }

  function updateStatusBadge(record) {
    const badge = document.getElementById("detailStatus");
    if (!badge) return;
    const status = String(record?.status || "CONTINUE").toUpperCase();
    badge.className = `badge ${status === "NEW" ? "new" : status === "OUT" ? "out" : "continue"}`;
    badge.textContent = confirmedLabel(status);
    badge.title = `${formatMonth(record?.signal_month)}末の確定判定`;
  }

  function updateCanonicalStats(record) {
    const stats = document.getElementById("detailStats");
    if (!stats) return;
    const values = formalRecord(record);
    const cards = [...stats.querySelectorAll(".stat-card")];
    if (cards.length < 6) return;
    const replace = (index, label, value, css = "") => {
      const card = cards[index];
      const span = card?.querySelector("span");
      const strong = card?.querySelector("strong");
      if (span) span.textContent = label;
      if (strong) {
        strong.textContent = value;
        strong.className = css;
      }
    };
    replace(1, "月足RSI14（確定）", number(values.rsi));
    replace(2, "RSI14・5か月MA（確定）", number(values.ma));
    replace(3, "RSI14方向", values.rsiUp === true ? "上向き ↑" : values.rsiUp === false ? "下向き ↓" : "—", values.rsiUp === true ? "positive" : values.rsiUp === false ? "negative" : "");
    replace(4, "5か月MA方向", values.maUp === true ? "上向き ↑" : values.maUp === false ? "下向き ↓" : "—", values.maUp === true ? "positive" : values.maUp === false ? "negative" : "");
    replace(5, "RSI14 − 5か月MA", signed(values.spread), values.spread === null || values.spread === 0 ? "" : values.spread > 0 ? "positive" : "negative");
  }

  function explanationText(payload) {
    const provisional = Core.fromPayload(payload);
    const base = "実線は月末確定済みの月足RSI14と、そのRSI14の5か月単純移動平均です。縦の緑線は確定GC、縦の赤線は確定DCを翌月最初の取引日に表示します。";
    if (!provisional) return `${base} 進行中月の暫定値は、最新日足がそろうと点線で表示します。`;
    return `${base} 点線は${formatDate(provisional.price_date)}終値までで計算した${formatMonth(provisional.month)}の暫定値で、月末までに変わる場合があります。`;
  }

  function updateExplanation(payload) {
    const explanation = document.getElementById("rsiExplanation");
    if (!explanation) return;
    explanation.textContent = explanationText(payload);
    explanation.dataset.signalCanonical = "true";
    explanation.dataset.provisionalCopy = "true";
  }

  function chartRowsForVisibleLabels(chart, payload) {
    const rows = Array.isArray(payload?.daily) ? payload.daily : [];
    const byDate = new Map(rows.map((row) => [String(row.date), row]));
    return (chart?.data?.labels || []).map((label) => byDate.get(String(label)) || null);
  }

  function enhanceRsiChart(visiblePayload, fullPayload = sourcePayload) {
    const chart = window.Chart?.getChart?.("rsiChart");
    if (!chart || !fullPayload) return false;
    const visibleRows = chartRowsForVisibleLabels(chart, visiblePayload || fullPayload);
    const datasets = (chart.data.datasets || []).filter((dataset) => dataset.kabutaneSignalLayer !== "provisional");
    chart.data.datasets = datasets;
    if (datasets[0]) {
      datasets[0].label = "月足RSI14（確定）";
      datasets[0].data = visibleRows.map(formalRowRsi);
    }
    if (datasets[1]) {
      datasets[1].label = "RSI14・5か月MA（確定）";
      datasets[1].data = visibleRows.map(formalRowMa);
    }
    const provisional = Core.fromPayload(fullPayload);
    if (provisional) {
      const month = provisional.month;
      datasets.push({
        label: "月足RSI14（進行中・暫定）",
        data: visibleRows.map((row) => row && Core.monthKey(row.date) === month ? provisional.monthly_rsi14 : null),
        borderColor: datasets[0]?.borderColor || "#059669",
        borderWidth: 2.2,
        borderDash: [7, 5],
        pointRadius: 0,
        spanGaps: false,
        kabutaneSignalLayer: "provisional",
      });
      datasets.push({
        label: "5か月MA（進行中・暫定）",
        data: visibleRows.map((row) => row && Core.monthKey(row.date) === month ? provisional.monthly_rsi_ma5 : null),
        borderColor: datasets[1]?.borderColor || "#8b5cf6",
        borderWidth: 2.2,
        borderDash: [7, 5],
        pointRadius: 0,
        spanGaps: false,
        kabutaneSignalLayer: "provisional",
      });
    }
    chart.update("none");
    return true;
  }

  function applyEnhancements(payload, visiblePayload = payload) {
    if (!payload) return false;
    updateStatusBadge(payload.record || {});
    updateCanonicalStats(payload.record || {});
    renderPanel(payload);
    updateExplanation(payload);
    return enhanceRsiChart(visiblePayload, payload);
  }

  function installPostRenderHook() {
    if (renderHookInstalled || typeof window.renderCharts !== "function") return;
    const baseRenderCharts = window.renderCharts;
    window.renderCharts = function renderChartsThenEnhance(payload) {
      const result = baseRenderCharts(payload);
      window.setTimeout(() => applyEnhancements(sourcePayload || payload, payload), 0);
      return result;
    };
    renderHookInstalled = true;
  }

  async function loadPayload() {
    const code = new URLSearchParams(window.location.search).get("code")?.trim() || "";
    if (!code) return null;
    const path = `data/charts/${encodeURIComponent(code)}.json`;
    if (typeof window.fetchJson === "function") return window.fetchJson(path);
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return response.json();
  }

  function startSafeRetry() {
    let attempts = 0;
    retryTimer = window.setInterval(() => {
      attempts += 1;
      const chartReady = Boolean(window.Chart?.getChart?.("rsiChart"));
      const statsReady = document.querySelectorAll("#detailStats .stat-card").length >= 6;
      if (sourcePayload && (chartReady || statsReady)) applyEnhancements(sourcePayload, sourcePayload);
      if (chartReady) installPostRenderHook();
      if ((chartReady && statsReady && attempts >= 8) || attempts >= 40) {
        window.clearInterval(retryTimer);
        retryTimer = 0;
      }
    }, 180);
  }

  async function init() {
    try {
      sourcePayload = await loadPayload();
      if (!sourcePayload) return;
      applyEnhancements(sourcePayload, sourcePayload);
      startSafeRetry();
      [500, 1200, 2200].forEach((delay) => window.setTimeout(() => applyEnhancements(sourcePayload, sourcePayload), delay));
    } catch (error) {
      console.error("detail signal enhancement failed", error);
    }
  }

  window.KabutaneDetailSignalStatus = { applyEnhancements, enhanceRsiChart, init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();