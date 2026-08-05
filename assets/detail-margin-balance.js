(() => {
  "use strict";

  const code = new URLSearchParams(location.search).get("code")?.trim().toUpperCase() || "";
  const panel = document.getElementById("marginBalancePanel");
  const status = document.getElementById("marginBalanceStatus");
  const stats = document.getElementById("marginBalanceStats");
  const summary = document.getElementById("marginBalanceSummary");
  const canvas = document.getElementById("marginBalanceChart");
  let chart = null;
  let recordsCache = [];
  let visibleLabelsCache = [];
  let lastRenderKey = "";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatShares(value) {
    const number = finite(value);
    if (number === null) return "—";
    return `${Math.round(number).toLocaleString("ja-JP")}株`;
  }

  function formatChange(value) {
    const number = finite(value);
    if (number === null) return "前週比 —";
    const sign = number > 0 ? "+" : "";
    return `前週比 ${sign}${Math.round(number).toLocaleString("ja-JP")}株`;
  }

  function formatRatio(record) {
    const sell = finite(record?.sell_balance);
    const ratio = finite(record?.ratio);
    if (sell === 0) return "—（売り残0）";
    return ratio === null ? "—" : `${ratio.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}倍`;
  }

  function shortDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[2])}/${Number(match[3])}` : String(value || "");
  }

  function currentPriceLabels() {
    const labels = window.Chart?.getChart?.("priceChart")?.data?.labels;
    if (Array.isArray(labels) && labels.length) return labels.map((label) => String(label));
    const viewportLabels = window.DetailChartViewport?.getVisibleDates?.();
    return Array.isArray(viewportLabels) ? viewportLabels.map((label) => String(label)) : [];
  }

  async function fetchJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      const error = new Error(`${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function renderUnavailable(message, label = "データなし") {
    if (panel) panel.classList.add("margin-balance-empty");
    if (status) status.textContent = label;
    if (stats) stats.innerHTML = "";
    if (summary) summary.textContent = message;
    if (canvas) canvas.hidden = true;
  }

  function trendText(record, previous) {
    if (!record) return "";
    const buyChange = finite(record.buy_change);
    const sellChange = finite(record.sell_change);
    const parts = [];
    if (buyChange !== null) parts.push(`買い残は前週から${buyChange > 0 ? "増加" : buyChange < 0 ? "減少" : "横ばい"}`);
    if (sellChange !== null) parts.push(`売り残は${sellChange > 0 ? "増加" : sellChange < 0 ? "減少" : "横ばい"}`);
    const currentRatio = finite(record.ratio);
    const previousRatio = finite(previous?.ratio);
    if (currentRatio !== null && previousRatio !== null) {
      parts.push(`信用倍率は${currentRatio > previousRatio ? "上昇" : currentRatio < previousRatio ? "低下" : "横ばい"}`);
    } else if (finite(record.sell_balance) === 0) {
      parts.push("売り残が0株のため信用倍率は算出していません");
    }
    return parts.join("、") + "。";
  }

  function recordsInRange(records, labels) {
    if (!labels.length) return records;
    const start = labels[0];
    const end = labels.at(-1);
    return records.filter((record) => String(record.date) >= start && String(record.date) <= end);
  }

  function renderStats(records, labels) {
    if (!stats) return;
    const visibleRecords = recordsInRange(records, labels);
    if (!visibleRecords.length) {
      stats.innerHTML = '<article class="margin-balance-no-range"><span>表示期間</span><strong>週次データなし</strong><small>日足を最新側へ移動すると確認できます</small></article>';
      if (summary) summary.textContent = "現在の日足表示期間にはJPX週次信用残高がありません。信用残高は週次公表のため、日足のすべての日付に値があるわけではありません。";
      return;
    }

    const latest = visibleRecords.at(-1);
    const previous = visibleRecords.length > 1 ? visibleRecords.at(-2) : records.filter((record) => String(record.date) < String(latest.date)).at(-1) || null;
    const cards = [
      ["信用買い残", formatShares(latest.buy_balance), formatChange(latest.buy_change)],
      ["信用売り残", formatShares(latest.sell_balance), formatChange(latest.sell_change)],
      ["信用倍率", formatRatio(latest), "買い残 ÷ 売り残"],
      ["表示期間の基準日", latest.date, "JPX週末残高"],
    ];
    stats.innerHTML = cards.map(([label, value, note]) => `
      <article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
    if (summary) {
      summary.textContent = `${trendText(latest, previous)} 日足チャートと同じ表示期間に同期しています。信用残高は週次データなので、日足の間は空白のままです。倍率の高低だけで判断せず、価格と出来高の流れと一緒に確認してください。`;
    }
  }

  function nearestPriorLabelIndex(labels, target) {
    let low = 0;
    let high = labels.length - 1;
    let answer = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (labels[mid] <= target) {
        answer = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return answer;
  }

  function alignRecordsToLabels(records, labels) {
    const buy = new Array(labels.length).fill(null);
    const sell = new Array(labels.length).fill(null);
    const ratio = new Array(labels.length).fill(null);
    const meta = new Array(labels.length).fill(null);
    if (!labels.length) return { buy, sell, ratio, meta, count: 0 };

    const start = labels[0];
    const end = labels.at(-1);
    const exact = new Map(labels.map((label, index) => [label, index]));
    let count = 0;
    records.forEach((record) => {
      const date = String(record?.date || "");
      if (!date || date < start || date > end) return;
      let index = exact.get(date);
      if (index === undefined) index = nearestPriorLabelIndex(labels, date);
      if (index < 0) return;
      buy[index] = finite(record.buy_balance);
      sell[index] = finite(record.sell_balance);
      ratio[index] = finite(record.ratio);
      meta[index] = record;
      count += 1;
    });
    return { buy, sell, ratio, meta, count };
  }

  function renderChart(records, labels) {
    if (!canvas || !window.Chart) return;
    const syncedLabels = labels.length ? labels : records.map((record) => String(record.date));
    if (!syncedLabels.length) return;
    const aligned = labels.length
      ? alignRecordsToLabels(records, syncedLabels)
      : {
          buy: records.map((record) => finite(record.buy_balance)),
          sell: records.map((record) => finite(record.sell_balance)),
          ratio: records.map((record) => finite(record.ratio)),
          meta: records.slice(),
          count: records.length,
        };

    canvas.hidden = false;
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: syncedLabels,
        datasets: [
          {
            type: "bar",
            label: "信用買い残",
            data: aligned.buy,
            backgroundColor: "rgba(214,87,150,.50)",
            borderColor: "rgba(214,87,150,.88)",
            borderWidth: 1,
            maxBarThickness: labels.length ? 10 : 24,
            yAxisID: "yShares",
          },
          {
            type: "bar",
            label: "信用売り残",
            data: aligned.sell,
            backgroundColor: "rgba(75,145,180,.45)",
            borderColor: "rgba(75,145,180,.88)",
            borderWidth: 1,
            maxBarThickness: labels.length ? 10 : 24,
            yAxisID: "yShares",
          },
          {
            type: "line",
            label: "信用倍率",
            data: aligned.ratio,
            borderColor: "rgba(126,87,194,.95)",
            backgroundColor: "rgba(126,87,194,.12)",
            borderWidth: 2,
            pointRadius: (context) => aligned.meta[context.dataIndex] ? 3 : 0,
            pointHoverRadius: 5,
            spanGaps: true,
            yAxisID: "yRatio",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { usePointStyle: true, boxWidth: 9, color: "#654f60" } },
          tooltip: {
            filter(context) {
              return aligned.meta[context.dataIndex] !== null && context.raw !== null;
            },
            callbacks: {
              title(items) {
                const index = items?.[0]?.dataIndex;
                const record = Number.isInteger(index) ? aligned.meta[index] : null;
                return record?.date ? `JPX基準日 ${record.date}` : String(items?.[0]?.label || "");
              },
              label(context) {
                if (context.dataset.yAxisID === "yRatio") {
                  const raw = finite(context.raw);
                  return `${context.dataset.label}: ${raw === null ? "—" : `${raw.toFixed(2)}倍`}`;
                }
                return `${context.dataset.label}: ${formatShares(context.raw)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(170,120,150,.08)" },
            ticks: {
              color: "#806b79",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
              callback(value, index) { return shortDate(syncedLabels[index]); },
            },
          },
          yShares: {
            position: "left",
            beginAtZero: true,
            grid: { color: "rgba(170,120,150,.10)" },
            ticks: {
              color: "#806b79",
              callback(value) {
                const number = Number(value);
                if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
                if (Math.abs(number) >= 1000) return `${Math.round(number / 1000)}k`;
                return number;
              },
            },
          },
          yRatio: {
            position: "right",
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: { color: "#806b79", callback: (value) => `${value}倍` },
          },
        },
      },
    });

    if (status) status.textContent = `JPX週次・全${records.length}週｜表示中${aligned.count}週・日足同期`;
  }

  function syncToPriceRange(labels = currentPriceLabels()) {
    if (!recordsCache.length) return;
    const normalized = Array.isArray(labels) ? labels.map((label) => String(label)).filter(Boolean) : [];
    const key = normalized.join("|");
    if (key && key === lastRenderKey) return;
    visibleLabelsCache = normalized;
    lastRenderKey = key;
    panel?.classList.remove("margin-balance-empty");
    renderStats(recordsCache, normalized);
    renderChart(recordsCache, normalized);
  }

  async function init() {
    if (!panel || !code || !/^[0-9A-Z]{4}$/.test(code)) return;
    try {
      if (status) status.textContent = "JPX週次データを読込中…";
      const index = await fetchJson("data/margin/latest.json");
      if (index?.ready === false || !index?.latest_date) {
        renderUnavailable("信用残高データは現在準備中です。JPX週次データの初回更新が完了すると自動で表示されます。", "準備中");
        return;
      }
      const shard = await fetchJson(`data/margin/${encodeURIComponent(code.slice(0, 2))}.json`);
      const records = Array.isArray(shard?.records?.[code]) ? shard.records[code].slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
      if (!records.length) {
        renderUnavailable("この銘柄のJPX週次信用残高は取得できていません。信用取引の対象外・新規掲載直後などの可能性があります。");
        return;
      }
      recordsCache = records;
      panel.classList.remove("margin-balance-empty");
      syncToPriceRange(currentPriceLabels());
      if (!visibleLabelsCache.length) {
        renderStats(recordsCache, []);
        renderChart(recordsCache, []);
      }
    } catch (error) {
      if (error.status === 404) {
        renderUnavailable("この銘柄のJPX週次信用残高は取得できていません。対象外または初回データ更新前の可能性があります。");
      } else {
        renderUnavailable(`信用残高を読み込めませんでした（${String(error.message || error)}）。`);
      }
    }
  }

  window.addEventListener("kabutane:detail-range-change", (event) => {
    const labels = Array.isArray(event.detail?.labels) ? event.detail.labels : [];
    syncToPriceRange(labels);
  });

  window.KabutaneMarginBalance = { formatRatio, trendText, alignRecordsToLabels, syncToPriceRange };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
