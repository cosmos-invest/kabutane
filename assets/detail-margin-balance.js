(() => {
  "use strict";

  const code = new URLSearchParams(location.search).get("code")?.trim().toUpperCase() || "";
  const panel = document.getElementById("marginBalancePanel");
  const status = document.getElementById("marginBalanceStatus");
  const stats = document.getElementById("marginBalanceStats");
  const summary = document.getElementById("marginBalanceSummary");
  const canvas = document.getElementById("marginBalanceChart");
  let chart = null;

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

  async function fetchJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      const error = new Error(`${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function renderUnavailable(message) {
    if (panel) panel.classList.add("margin-balance-empty");
    if (status) status.textContent = "データなし";
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

  function renderStats(records) {
    const latest = records.at(-1);
    if (!latest || !stats) return;
    const cards = [
      ["信用買い残", formatShares(latest.buy_balance), formatChange(latest.buy_change)],
      ["信用売り残", formatShares(latest.sell_balance), formatChange(latest.sell_change)],
      ["信用倍率", formatRatio(latest), "買い残 ÷ 売り残"],
      ["基準日", latest.date, "JPX週末残高"],
    ];
    stats.innerHTML = cards.map(([label, value, note]) => `
      <article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
    const previous = records.length > 1 ? records.at(-2) : null;
    if (summary) {
      summary.textContent = `${trendText(latest, previous)} 信用残高は将来の返済売り・買い戻し圧力を考える材料ですが、倍率の高低だけで上昇・下落を決めません。価格と出来高の流れと一緒に確認してください。`;
    }
  }

  function renderChart(records) {
    if (!canvas || !window.Chart) return;
    canvas.hidden = false;
    if (chart) chart.destroy();
    const labels = records.map((record) => shortDate(record.date));
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "信用買い残",
            data: records.map((record) => finite(record.buy_balance)),
            backgroundColor: "rgba(214,87,150,.50)",
            borderColor: "rgba(214,87,150,.88)",
            borderWidth: 1,
            yAxisID: "yShares",
          },
          {
            type: "bar",
            label: "信用売り残",
            data: records.map((record) => finite(record.sell_balance)),
            backgroundColor: "rgba(75,145,180,.45)",
            borderColor: "rgba(75,145,180,.88)",
            borderWidth: 1,
            yAxisID: "yShares",
          },
          {
            type: "line",
            label: "信用倍率",
            data: records.map((record) => finite(record.ratio)),
            borderColor: "rgba(126,87,194,.95)",
            backgroundColor: "rgba(126,87,194,.12)",
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            spanGaps: false,
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
            callbacks: {
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
          x: { grid: { color: "rgba(170,120,150,.08)" }, ticks: { color: "#806b79", maxRotation: 0 } },
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
  }

  async function init() {
    if (!panel || !code || !/^[0-9A-Z]{4}$/.test(code)) return;
    try {
      if (status) status.textContent = "JPX週次データを読込中…";
      const shard = await fetchJson(`data/margin/${encodeURIComponent(code.slice(0, 2))}.json`);
      const records = Array.isArray(shard?.records?.[code]) ? shard.records[code].slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
      if (!records.length) {
        renderUnavailable("この銘柄のJPX週次信用残高はまだ取得できていません。信用取引の対象外・新規掲載直後・データ更新前などの可能性があります。");
        return;
      }
      panel.classList.remove("margin-balance-empty");
      if (status) status.textContent = `JPX週次・${records.length}週分`;
      renderStats(records);
      renderChart(records);
    } catch (error) {
      if (error.status === 404) {
        renderUnavailable("信用残高データは現在準備中です。JPX週次データの更新後に自動で表示されます。");
      } else {
        renderUnavailable(`信用残高を読み込めませんでした（${String(error.message || error)}）。`);
      }
    }
  }

  window.KabutaneMarginBalance = { formatRatio, trendText };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
