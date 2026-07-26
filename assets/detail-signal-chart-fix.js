(function () {
  "use strict";

  if (typeof window === "undefined" || typeof Chart === "undefined" || typeof ProvisionalMonthlyRsiCore === "undefined") return;
  if (typeof window.renderCharts !== "function") return;

  const Core = ProvisionalMonthlyRsiCore;
  const baseRenderCharts = window.renderCharts;
  const formalRsi = (row) => Core.finite(row?.monthly_rsi14 ?? row?.rsi5);
  const formalMa = (row) => Core.finite(row?.monthly_rsi_ma5 ?? row?.rsi14);

  window.renderCharts = function renderChartsWithCanonicalAndProvisionalLines(payload) {
    baseRenderCharts(payload);
    const chart = Chart.getChart("rsiChart");
    if (!chart) return;
    const rows = Array.isArray(payload?.daily) ? payload.daily : [];
    const datasets = chart.data.datasets || [];
    if (datasets[0]) {
      datasets[0].label = "月足RSI14（確定）";
      datasets[0].data = rows.map(formalRsi);
    }
    if (datasets[1]) {
      datasets[1].label = "RSI14・5か月MA（確定）";
      datasets[1].data = rows.map(formalMa);
    }
    const provisional = Core.fromPayload(payload);
    if (provisional) {
      const month = provisional.month;
      datasets.push({
        label: "月足RSI14（進行中・暫定）",
        data: rows.map((row) => Core.monthKey(row.date) === month ? provisional.monthly_rsi14 : null),
        borderColor: datasets[0]?.borderColor || "#059669",
        borderWidth: 2.2,
        borderDash: [7, 5],
        pointRadius: 0,
        spanGaps: false,
      });
      datasets.push({
        label: "5か月MA（進行中・暫定）",
        data: rows.map((row) => Core.monthKey(row.date) === month ? provisional.monthly_rsi_ma5 : null),
        borderColor: datasets[1]?.borderColor || "#8b5cf6",
        borderWidth: 2.2,
        borderDash: [7, 5],
        pointRadius: 0,
        spanGaps: false,
      });
    }
    chart.update("none");
  };
})();
