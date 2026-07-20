function renderMainChart() {
  const rawVisible = visibleRows();
  const visible = state.priceMode === "heikin" ? ReplayPro.heikinAshi(rawVisible) : rawVisible;
  const labels = visible.map((row) => row.date);
  const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
  const datasets = [
    { label: state.priceMode === "heikin" ? "平均足" : "ローソク足", data: visible.map((row) => row.close), borderColor: "rgba(0,0,0,0)", pointRadius: 0, borderWidth: 0 },
    { type: "bar", label: "出来高", data: rawVisible.map((row) => row.volume), backgroundColor: "rgba(176,126,178,.15)", yAxisID: "yVolume", borderWidth: 0 },
  ];
  if (els.showSma.checked) {
    datasets.push(lineDataset("SMA25", rawVisible.map((row) => row.sma25), "#dc6a9f"));
    datasets.push(lineDataset("SMA75", rawVisible.map((row) => row.sma75), "#9a78d4"));
    datasets.push(lineDataset("SMA200", rawVisible.map((row) => row.sma200), "#68afd4", { borderWidth: 1.8 }));
  }
  if (els.showEma.checked) {
    datasets.push(lineDataset("EMA20", rawVisible.map((row) => row.ema20), "#f29a62", { borderDash: [5, 3] }));
    datasets.push(lineDataset("EMA50", rawVisible.map((row) => row.ema50), "#6ba98f", { borderDash: [5, 3] }));
  }
  if (els.showBollinger.checked) {
    datasets.push(lineDataset("BB上限", rawVisible.map((row) => row.bbUpper), "rgba(177,126,211,.75)", { borderWidth: 1 }));
    datasets.push(lineDataset("BB中心", rawVisible.map((row) => row.bbMid), "rgba(177,126,211,.42)", { borderWidth: 1 }));
    datasets.push(lineDataset("BB下限", rawVisible.map((row) => row.bbLower), "rgba(177,126,211,.75)", { borderWidth: 1 }));
  }
  if (els.showSupertrend.checked) datasets.push(lineDataset("Supertrend", rawVisible.map((row) => row.supertrend), "#2f9b7a", { borderWidth: 1.8 }));
  if (els.showHigh52.checked) datasets.push(lineDataset("52週高値", rawVisible.map((row) => row.high52), "#d89a32", { borderDash: [7, 4] }));
  if (els.showAverage.checked && metrics.averagePrice !== null) datasets.push(lineDataset("平均約定", rawVisible.map(() => metrics.averagePrice), "#b23b78", { borderWidth: 2.2, borderDash: [8, 4] }));
  datasets.push(...planLineDatasets(rawVisible));

  if (state.chart) state.chart.destroy();
  Chart.register(candlePlugin, tradeMarkerPlugin);
  state.chart = new Chart(els.replayChart, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      onClick(event) {
        const yScale = state.chart?.scales?.y;
        if (!yScale) return;
        const price = yScale.getValueForPixel(event.y);
        if (!Number.isFinite(price)) return;
        if (state.toolMode === "stop") els.stopPrice.value = price.toFixed(2);
        else els.entryPrice.value = price.toFixed(2);
        state.plan.armed = false;
        recalculatePlan();
        renderAll();
      },
      plugins: {
        legend: { labels: { color: "#654f60", usePointStyle: true, boxWidth: 9 } },
        proCandles: { rows: visible },
        proTrades: { trades: state.trades },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const row = rawVisible[items[0]?.dataIndex];
              return row ? [
                `始値 ${formatNumber(row.open)}`,
                `高値 ${formatNumber(row.high)}`,
                `安値 ${formatNumber(row.low)}`,
                `終値 ${formatNumber(row.close)}`,
                `出来高 ${formatNumber(row.volume, 0)}`,
              ] : [];
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#806b79", maxTicksLimit: 10, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.10)" } },
        y: { position: "left", ticks: { color: "#806b79" }, grid: { color: "rgba(170,120,150,.13)" } },
        yVolume: { position: "right", display: false, min: 0, max: Math.max(...rawVisible.map((row) => finite(row.volume) || 0), 1) * 4 },
      },
    },
  });
}

function renderMonthlyRsiChart() {
  const visible = visibleRows();
  const labels = visible.map((row) => row.date);
  if (state.rsiChart) state.rsiChart.destroy();
  state.rsiChart = new Chart(els.monthlyRsiChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset("月足RSI14", visible.map((row) => row.monthlyRsi14), "#2f9b7a", { borderWidth: 2.2, stepped: "before" }),
        lineDataset("RSI14・5か月MA", visible.map((row) => row.monthlyRsiMa5), "#8467c5", { borderWidth: 2, stepped: "before" }),
        lineDataset("50", visible.map(() => 50), "rgba(110,90,120,.25)", { borderWidth: 1, borderDash: [4, 4] }),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: "#654f60", usePointStyle: true, boxWidth: 9 } } },
      scales: {
        x: { ticks: { color: "#806b79", maxTicksLimit: 10, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.08)" } },
        y: { min: 0, max: 100, ticks: { color: "#806b79", stepSize: 20 }, grid: { color: "rgba(170,120,150,.12)" } },
      },
    },
  });
}

function renderOscillatorChart() {
  const visible = visibleRows();
  const labels = visible.map((row) => row.date);
  const mode = els.oscillatorSelect.value;
  const reference = (value) => visible.map(() => value);
  let datasets = [];
  let min;
  let max;
  if (mode === "macd") {
    datasets = [
      { type: "bar", label: "ヒストグラム", data: visible.map((row) => row.macdHist), backgroundColor: visible.map((row) => (finite(row.macdHist) || 0) >= 0 ? "rgba(214,87,150,.35)" : "rgba(75,145,180,.35)"), borderWidth: 0 },
      lineDataset("MACD", visible.map((row) => row.macd), "#d65796", { borderWidth: 1.8 }),
      lineDataset("シグナル", visible.map((row) => row.macdSignal), "#7465bd", { borderWidth: 1.5 }),
    ];
  } else if (mode === "stochastic") {
    datasets = [
      lineDataset("%K", visible.map((row) => row.stochasticK), "#d65796"),
      lineDataset("%D", visible.map((row) => row.stochasticD), "#7465bd"),
      lineDataset("80", reference(80), "rgba(214,87,150,.3)", { borderWidth: 1, borderDash: [4, 4] }),
      lineDataset("20", reference(20), "rgba(75,145,180,.3)", { borderWidth: 1, borderDash: [4, 4] }),
    ];
    min = 0; max = 100;
  } else if (mode === "atr") {
    datasets = [lineDataset("ATR%", visible.map((row) => row.atrPct), "#8b68c8", { borderWidth: 1.8, fill: true, backgroundColor: "rgba(139,104,200,.10)" })];
    min = 0;
  } else {
    datasets = [
      lineDataset("日足RSI14", visible.map((row) => row.dailyRsi14), "#d65796"),
      lineDataset("70", reference(70), "rgba(214,87,150,.3)", { borderWidth: 1, borderDash: [4, 4] }),
      lineDataset("30", reference(30), "rgba(75,145,180,.3)", { borderWidth: 1, borderDash: [4, 4] }),
    ];
    min = 0; max = 100;
  }
  if (state.oscillatorChart) state.oscillatorChart.destroy();
  state.oscillatorChart = new Chart(els.oscillatorChart, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: "#654f60", usePointStyle: true, boxWidth: 9 } } },
      scales: {
        x: { ticks: { color: "#806b79", maxTicksLimit: 10, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.08)" } },
        y: { min, max, ticks: { color: "#806b79" }, grid: { color: "rgba(170,120,150,.12)" } },
      },
    },
  });
}
