function stopPlayback() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  els.playButton.textContent = "▶ 再生";
}

function advanceOne() {
  if (state.ended || state.cursor >= state.rows.length - 1) return false;
  state.cursor += 1;
  processAutomaticOrders(currentRow());
  if (state.cursor >= state.rows.length - 1) stopPlayback();
  return true;
}

function advance(days = 1) {
  for (let count = 0; count < days; count += 1) {
    if (!advanceOne()) break;
  }
  renderAll();
}

function togglePlayback() {
  if (state.timer) { stopPlayback(); return; }
  const speed = Number(els.playSpeed.value) || 500;
  els.playButton.textContent = "⏸ 一時停止";
  state.timer = setInterval(() => {
    if (!advanceOne()) stopPlayback();
    renderAll();
  }, speed);
}

function finishSession() {
  stopPlayback();
  state.ended = true;
  const metrics = ReplayPro.accountMetrics(state.account, currentRow().close, state.initialCapital);
  els.sessionState.textContent = "練習終了";
  els.finishSummary.hidden = false;
  els.finishSummary.innerHTML = `<h3>今回の結果</h3><p><strong class="${performanceClass(metrics.totalProfit)}">${yen(metrics.totalProfit)}（${percent(metrics.totalReturn)}）</strong></p><p>購入${state.trades.filter((trade) => trade.type === "BUY").length}回、売却${state.trades.filter((trade) => trade.type === "SELL").length}回、手数料${yen(state.account.fees)}。終了時保有${state.account.shares.toLocaleString("ja-JP")}株。</p><p>TP設定：${state.plan.ratios.map((ratio) => `${ratio.toFixed(1)}R`).join(" / ")}、最大ドローダウン${percent(state.maxDrawdown)}。</p>`;
  renderAll();
  els.finishSummary.scrollIntoView({ behavior: "smooth", block: "center" });
}

function chooseStartIndex() {
  const minIndex = Math.min(240, Math.max(0, state.rows.length - 80));
  const maxIndex = Math.max(minIndex, state.rows.length - 50);
  if (els.startMode.value === "date" && els.startDate.value) {
    const found = state.rows.findIndex((row) => row.date >= els.startDate.value);
    return ReplayPro.clamp(found >= 0 ? found : minIndex, minIndex, maxIndex);
  }
  return minIndex + Math.floor(Math.random() * (maxIndex - minIndex + 1));
}

function resetPlanPrices() {
  const row = currentRow();
  if (!row) return;
  els.entryPrice.value = Number(row.close).toFixed(2);
  els.stopPrice.value = Number(row.close * 0.95).toFixed(2);
  state.plan.armed = false;
  recalculatePlan();
}

function startSession() {
  if (state.rows.length < 80) { els.setupNotice.textContent = "練習に必要な日足データが不足しています。"; return; }
  const assets = Number(els.totalAssets.value);
  const allocation = Number(els.allocationPct.value);
  const risk = Number(els.riskPct.value);
  if (!Number.isFinite(assets) || assets < 100000) { els.setupNotice.textContent = "保有資産額を10万円以上で入力してください。"; return; }
  if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) { els.setupNotice.textContent = "配分割合を1〜100%で入力してください。"; return; }
  if (!Number.isFinite(risk) || risk <= 0 || risk > 20) { els.setupNotice.textContent = "許容損失を0.1〜20%で入力してください。"; return; }
  stopPlayback();
  state.initialCapital = assets;
  state.allocationPct = allocation;
  state.riskPct = risk;
  state.lotSize = Number(els.lotSize.value);
  state.costBps = Number(els.costBps.value);
  state.startIndex = chooseStartIndex();
  state.cursor = state.startIndex;
  state.account = { cash: assets, shares: 0, costBasis: 0, grossBasis: 0, realized: 0, fees: 0 };
  state.availableSlots = ReplayPro.MAX_SLOTS;
  state.trades = [];
  state.buySequence = 0;
  state.sellSequence = 0;
  state.peakValue = assets;
  state.maxDrawdown = 0;
  state.ended = false;
  state.plan.armed = false;
  state.plan.entryDate = null;
  state.plan.hitTargets = [false, false, false, false];
  state.plan.initialAutoShares = 0;
  resetPlanPrices();
  els.setupPanel.hidden = true;
  els.practiceArea.hidden = false;
  els.finishSummary.hidden = true;
  els.sessionState.textContent = "練習中";
  message("チャートをクリックしてエントリーと損切りを置くか、数値を入力してください。未来の足は隠れています。");
  renderAll();
}

function resetToSetup() {
  stopPlayback();
  els.practiceArea.hidden = true;
  els.setupPanel.hidden = false;
  els.sessionState.textContent = "条件設定";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setTool(mode) {
  state.toolMode = mode;
  els.setEntryTool.classList.toggle("active", mode === "entry");
  els.setStopTool.classList.toggle("active", mode === "stop");
}

function setPriceMode(mode) {
  state.priceMode = mode;
  els.priceModeCandle.classList.toggle("active", mode === "candle");
  els.priceModeHeikin.classList.toggle("active", mode === "heikin");
  renderMainChart();
}

function bindEvents() {
  els.startMode.addEventListener("change", () => { els.startDate.disabled = els.startMode.value !== "date"; });
  els.startSessionButton.addEventListener("click", startSession);
  els.newSessionButton.addEventListener("click", resetToSetup);
  els.stepOneButton.addEventListener("click", () => advance(1));
  els.stepFiveButton.addEventListener("click", () => advance(5));
  els.playButton.addEventListener("click", togglePlayback);
  els.finishButton.addEventListener("click", finishSession);
  els.buyChunkButton.addEventListener("click", manualBuyChunk);
  els.buyCustomButton.addEventListener("click", manualBuyCustom);
  els.sellQuarterButton.addEventListener("click", () => manualSell(0.25));
  els.sellHalfButton.addEventListener("click", () => manualSell(0.5));
  els.sellAllButton.addEventListener("click", () => manualSell(1));
  els.armBracketButton.addEventListener("click", armBracket);
  els.cancelBracketButton.addEventListener("click", cancelBracket);
  els.setEntryTool.addEventListener("click", () => setTool("entry"));
  els.setStopTool.addEventListener("click", () => setTool("stop"));
  els.priceModeCandle.addEventListener("click", () => setPriceMode("candle"));
  els.priceModeHeikin.addEventListener("click", () => setPriceMode("heikin"));
  [els.entryPrice, els.stopPrice, els.rr1, els.rr2, els.rr3, els.rr4, els.autoEntrySlots, els.trailMode].forEach((element) => {
    element.addEventListener("change", () => { state.plan.armed = false; recalculatePlan(); renderAll(); });
    element.addEventListener("input", () => { if (!els.practiceArea.hidden) { recalculatePlan(); renderPlan(); renderMainChart(); } });
  });
  [els.showSma, els.showEma, els.showBollinger, els.showSupertrend, els.showHigh52, els.showAverage, els.showPlanLines].forEach((element) => element.addEventListener("change", renderMainChart));
  els.oscillatorSelect.addEventListener("change", renderOscillatorChart);
}

async function init() {
  ids.forEach((id) => { els[id] = $(id); });
  bindEvents();
  state.code = queryCode();
  if (!state.code) {
    els.setupNotice.textContent = "URLに銘柄コードがありません。銘柄詳細から開いてください。";
    els.startSessionButton.disabled = true;
    return;
  }
  try {
    state.payload = await fetchJson(`data/charts/${encodeURIComponent(state.code)}.json`);
    state.rows = ReplayPro.enrichRows(state.payload.daily || []);
    els.replayTitle.textContent = `${state.payload.name}（${state.payload.code}）売買練習🌸`;
    els.replaySubtitle.textContent = `${state.rows[0]?.date || "—"}〜${state.rows.at(-1)?.date || "—"}の日足から、平均足・月足RSI・テクニカル指標を使って練習できます。`;
    els.detailBackLink.href = `detail.html?code=${encodeURIComponent(state.code)}`;
    const minIndex = Math.min(240, Math.max(0, state.rows.length - 80));
    const maxIndex = Math.max(minIndex, state.rows.length - 50);
    els.startDate.min = state.rows[minIndex]?.date || "";
    els.startDate.max = state.rows[maxIndex]?.date || "";
    els.startDate.value = state.rows[minIndex]?.date || "";
    els.sessionState.textContent = "条件設定";
  } catch (error) {
    els.setupNotice.textContent = `データを読み込めませんでした：${error.message}`;
    els.startSessionButton.disabled = true;
  }
}

/* Trading terminal viewport and mobile UI */
function defaultViewportBars() {
  if (window.innerWidth <= 430) return 34;
  if (window.innerWidth <= 680) return 46;
  if (window.innerWidth <= 1000) return 64;
  return 88;
}

state.chartView = {
  bars: defaultViewportBars(),
  pan: 0,
  followLatest: true,
  yScale: 1,
  yPan: 0,
  userSizedX: false,
  pointers: new Map(),
  gesture: null,
  moved: false,
  frame: null,
};

function viewportRange() {
  const bars = ReplayPro.clamp(Math.round(state.chartView.bars || defaultViewportBars()), 12, 220);
  const maximumPan = Math.max(0, state.cursor);
  const pan = ReplayPro.clamp(Math.round(state.chartView.pan || 0), 0, maximumPan);
  const end = ReplayPro.clamp(state.cursor - pan, 0, Math.max(0, state.rows.length - 1));
  const begin = Math.max(0, end - bars + 1);
  return { begin, end, bars, pan };
}

visibleRows = function visibleRowsTerminal() {
  const range = viewportRange();
  return state.rows.slice(range.begin, range.end + 1);
};

function priceViewportBounds(rows) {
  const values = [];
  rows.forEach((row) => {
    [row.low, row.high].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
    if (els.showSma?.checked) [row.sma25, row.sma75, row.sma200].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
    if (els.showEma?.checked) [row.ema20, row.ema50].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
    if (els.showBollinger?.checked) [row.bbUpper, row.bbLower].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
    if (els.showSupertrend?.checked) { const parsed = finite(row.supertrend); if (parsed !== null) values.push(parsed); }
    if (els.showHigh52?.checked) { const parsed = finite(row.high52); if (parsed !== null) values.push(parsed); }
  });
  const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
  [state.plan.entry, state.plan.activeStop, ...state.plan.tpPrices, metrics.averagePrice].forEach((value) => {
    const parsed = finite(value);
    if (parsed !== null) values.push(parsed);
  });
  if (!values.length) return {};
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  const rawRange = Math.max(maximum - minimum, Math.max(Math.abs(maximum), 1) * 0.02);
  minimum -= rawRange * 0.08;
  maximum += rawRange * 0.08;
  const baseRange = maximum - minimum;
  const center = (minimum + maximum) / 2 + state.chartView.yPan * baseRange;
  const scaledRange = baseRange * ReplayPro.clamp(state.chartView.yScale, 0.18, 8);
  return { min: center - scaledRange / 2, max: center + scaledRange / 2 };
}

function updateViewportLabel() {
  if (!els.chartRangeLabel) return;
  const range = viewportRange();
  const first = state.rows[range.begin]?.date || "—";
  const last = state.rows[range.end]?.date || "—";
  els.chartRangeLabel.textContent = `${first}〜${last}・${range.end - range.begin + 1}本${state.chartView.followLatest ? "・最新追従" : ""}`;
  els.chartLatestButton?.classList.toggle("active", state.chartView.followLatest);
}

function renderSynchronizedCharts() {
  renderMainChart();
  renderMonthlyRsiChart();
  renderOscillatorChart();
  updateViewportLabel();
}

function scheduleViewportRender() {
  if (state.chartView.frame) return;
  state.chartView.frame = requestAnimationFrame(() => {
    state.chartView.frame = null;
    renderSynchronizedCharts();
  });
}

function shiftHorizontal(deltaBars) {
  state.chartView.pan = ReplayPro.clamp(state.chartView.pan + deltaBars, 0, Math.max(0, state.cursor));
  state.chartView.followLatest = state.chartView.pan <= 0;
  scheduleViewportRender();
}

function zoomHorizontal(factor) {
  state.chartView.bars = ReplayPro.clamp(Math.round(state.chartView.bars * factor), 12, 220);
  state.chartView.userSizedX = true;
  scheduleViewportRender();
}

function zoomVertical(factor) {
  state.chartView.yScale = ReplayPro.clamp(state.chartView.yScale * factor, 0.18, 8);
  scheduleViewportRender();
}

function panVertical(delta) {
  state.chartView.yPan = ReplayPro.clamp(state.chartView.yPan + delta, -6, 6);
  scheduleViewportRender();
}

function followLatestChart() {
  state.chartView.pan = 0;
  state.chartView.followLatest = true;
  scheduleViewportRender();
}

function resetChartViewport() {
  state.chartView.bars = defaultViewportBars();
  state.chartView.pan = 0;
  state.chartView.followLatest = true;
  state.chartView.yScale = 1;
  state.chartView.yPan = 0;
  state.chartView.userSizedX = false;
  scheduleViewportRender();
}

renderMainChart = function renderMainChartTerminal() {
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
  const bounds = priceViewportBounds(rawVisible);

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
        x: { offset: true, ticks: { color: "#806b79", maxTicksLimit: 8, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.10)" } },
        y: { position: "left", min: bounds.min, max: bounds.max, ticks: { color: "#806b79" }, grid: { color: "rgba(170,120,150,.13)" } },
        yVolume: { position: "right", display: false, min: 0, max: Math.max(...rawVisible.map((row) => finite(row.volume) || 0), 1) * 4 },
      },
    },
  });
  updateViewportLabel();
};

function installTerminalUi() {
  const chartBox = document.querySelector(".pro-main-chart");
  if (chartBox && !document.getElementById("chartViewportToolbar")) {
    chartBox.insertAdjacentHTML("beforebegin", `
      <div id="chartViewportToolbar" class="chart-viewport-toolbar" aria-label="チャート表示範囲">
        <button id="chartOlderButton" class="chart-view-button" type="button" title="過去へ移動">← 過去</button>
        <button id="chartLatestButton" class="chart-view-button active" type="button" title="最新足へ戻る">最新</button>
        <button id="chartZoomXIn" class="chart-view-button" type="button" title="横方向を拡大">横＋</button>
        <button id="chartZoomXOut" class="chart-view-button" type="button" title="横方向を縮小">横−</button>
        <button id="chartZoomYIn" class="chart-view-button" type="button" title="縦方向を拡大">縦＋</button>
        <button id="chartZoomYOut" class="chart-view-button" type="button" title="縦方向を縮小">縦−</button>
        <button id="chartPanUp" class="chart-view-button" type="button" title="価格軸を上へ">↑</button>
        <button id="chartPanDown" class="chart-view-button" type="button" title="価格軸を下へ">↓</button>
        <button id="chartResetButton" class="chart-view-button" type="button" title="表示範囲をリセット">リセット</button>
        <span id="chartRangeLabel" class="chart-range-label">表示範囲 —</span>
      </div>`);
  }
  const practice = document.getElementById("practiceArea");
  if (practice && !document.getElementById("mobileTradingTerminal")) {
    practice.insertAdjacentHTML("beforeend", `
      <section id="mobileTradingTerminal" class="mobile-trading-terminal" aria-label="スマホ取引パネル">
        <div class="mobile-terminal-quote"><span>現在値</span><strong id="mobileCurrentPrice">—</strong><small id="mobileCurrentDate">—</small></div>
        <div class="mobile-terminal-metrics">
          <div><span>建玉</span><strong id="mobileShares">—</strong></div>
          <div><span>余力</span><strong id="mobileCash">—</strong></div>
          <div><span>評価損益</span><strong id="mobileUnrealized">—</strong></div>
          <div><span>空き枠</span><strong id="mobileSlots">8</strong></div>
        </div>
        <div class="mobile-terminal-order"><span>注文</span><strong id="mobileOrderSummary">E — / SL — / TP —</strong></div>
        <div class="mobile-terminal-actions">
          <button id="mobileBuyButton" class="mobile-trade-button buy" type="button"><span>買う</span><small id="mobileBuyHint">1枠</small></button>
          <button id="mobileSellButton" class="mobile-trade-button sell" type="button"><span>売る</span><small>全決済</small></button>
        </div>
        <div class="mobile-terminal-nav">
          <button id="mobileStepButton" type="button">＋1日</button>
          <button id="mobilePlayButton" type="button">▶ 再生</button>
          <button id="mobileLatestButton" type="button">最新足</button>
          <button id="mobileOrderSettings" type="button">注文設定</button>
        </div>
      </section>`);
  }
  [
    "chartOlderButton", "chartLatestButton", "chartZoomXIn", "chartZoomXOut", "chartZoomYIn", "chartZoomYOut",
    "chartPanUp", "chartPanDown", "chartResetButton", "chartRangeLabel", "mobileTradingTerminal", "mobileCurrentPrice",
    "mobileCurrentDate", "mobileShares", "mobileCash", "mobileUnrealized", "mobileSlots", "mobileOrderSummary",
    "mobileBuyButton", "mobileSellButton", "mobileBuyHint", "mobileStepButton", "mobilePlayButton", "mobileLatestButton",
    "mobileOrderSettings",
  ].forEach((id) => { if (!ids.includes(id)) ids.push(id); });
}

function renderMobileTerminal() {
  if (!els.mobileTradingTerminal || els.practiceArea.hidden) return;
  const row = currentRow();
  if (!row) return;
  const metrics = ReplayPro.accountMetrics(state.account, row.close, state.initialCapital);
  const plan = currentPositionPlan();
  const nextTargetIndex = state.plan.hitTargets.findIndex((hit) => !hit);
  const nextTarget = nextTargetIndex >= 0 ? state.plan.tpPrices[nextTargetIndex] : null;
  els.mobileCurrentPrice.textContent = yen(row.close);
  els.mobileCurrentDate.textContent = row.date;
  els.mobileShares.textContent = `${state.account.shares.toLocaleString("ja-JP")}株`;
  els.mobileCash.textContent = yen(state.account.cash);
  els.mobileUnrealized.textContent = `${yen(metrics.unrealized)} ${percent(metrics.unrealizedPct)}`;
  els.mobileUnrealized.className = performanceClass(metrics.unrealized);
  els.mobileSlots.textContent = `${state.availableSlots}/8`;
  els.mobileOrderSummary.textContent = `E ${yen(state.plan.entry)} / SL ${yen(state.plan.activeStop)} / ${nextTargetIndex >= 0 ? `TP${nextTargetIndex + 1} ${yen(nextTarget)}` : "TP完了"}`;
  els.mobileBuyHint.textContent = plan.slotShares > 0 ? `1枠 ${plan.slotShares.toLocaleString("ja-JP")}株` : "購入不可";
  els.mobileBuyButton.disabled = state.ended || state.plan.armed || state.availableSlots <= 0 || plan.slotShares <= 0;
  els.mobileSellButton.disabled = state.ended || state.account.shares <= 0;
  els.mobileStepButton.disabled = state.ended || state.cursor >= state.rows.length - 1;
  els.mobilePlayButton.disabled = state.ended || state.cursor >= state.rows.length - 1;
  els.mobilePlayButton.textContent = state.timer ? "⏸ 停止" : "▶ 再生";
}

function bindViewportPointerEvents() {
  const canvas = els.replayChart;
  if (!canvas || canvas.dataset.viewportBound === "true") return;
  canvas.dataset.viewportBound = "true";

  function pointerSnapshot() {
    return [...state.chartView.pointers.values()];
  }
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    state.chartView.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, previousX: event.clientX, previousY: event.clientY });
    state.chartView.moved = false;
    const points = pointerSnapshot();
    if (points.length === 2) {
      state.chartView.gesture = {
        dx: Math.max(20, Math.abs(points[0].x - points[1].x)),
        dy: Math.max(20, Math.abs(points[0].y - points[1].y)),
        bars: state.chartView.bars,
        yScale: state.chartView.yScale,
      };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = state.chartView.pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX; point.y = event.clientY;
    const points = pointerSnapshot();
    if (points.length >= 2 && state.chartView.gesture) {
      const dx = Math.max(20, Math.abs(points[0].x - points[1].x));
      const dy = Math.max(20, Math.abs(points[0].y - points[1].y));
      state.chartView.bars = ReplayPro.clamp(Math.round(state.chartView.gesture.bars / (dx / state.chartView.gesture.dx)), 12, 220);
      state.chartView.yScale = ReplayPro.clamp(state.chartView.gesture.yScale / (dy / state.chartView.gesture.dy), 0.18, 8);
      state.chartView.userSizedX = true;
      state.chartView.moved = true;
      scheduleViewportRender();
      return;
    }
    const deltaX = point.x - point.previousX;
    const deltaY = point.y - point.previousY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
      state.chartView.moved = true;
      const rect = canvas.getBoundingClientRect();
      if (Math.abs(deltaX) >= Math.abs(deltaY) * 0.65) {
        const bars = deltaX / Math.max(rect.width, 1) * state.chartView.bars;
        state.chartView.pan = ReplayPro.clamp(state.chartView.pan + bars, 0, Math.max(0, state.cursor));
        state.chartView.followLatest = state.chartView.pan <= 0;
      }
      if (Math.abs(deltaY) >= Math.abs(deltaX) * 0.45) {
        state.chartView.yPan = ReplayPro.clamp(state.chartView.yPan + deltaY / Math.max(rect.height, 1) * state.chartView.yScale, -6, 6);
      }
      scheduleViewportRender();
    }
    point.previousX = point.x; point.previousY = point.y;
  });
  function finishPointer(event) {
    const wasMoved = state.chartView.moved;
    state.chartView.pointers.delete(event.pointerId);
    if (state.chartView.pointers.size < 2) state.chartView.gesture = null;
    if (!wasMoved && state.chart && event.type === "pointerup") {
      const rect = canvas.getBoundingClientRect();
      const pixelY = event.clientY - rect.top;
      const price = state.chart.scales?.y?.getValueForPixel(pixelY);
      if (Number.isFinite(price)) {
        if (state.toolMode === "stop") els.stopPrice.value = price.toFixed(2);
        else els.entryPrice.value = price.toFixed(2);
        state.plan.armed = false;
        recalculatePlan();
        renderAll();
      }
    }
    if (!state.chartView.pointers.size) state.chartView.moved = false;
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 0.84 : 1.18;
    if (event.shiftKey) zoomHorizontal(factor);
    else if (event.altKey) panVertical(event.deltaY < 0 ? -0.12 : 0.12);
    else if (event.ctrlKey || event.metaKey) { zoomHorizontal(factor); zoomVertical(factor); }
    else zoomVertical(factor);
  }, { passive: false });
  canvas.addEventListener("dblclick", resetChartViewport);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

installTerminalUi();

const baseAdvanceOneTerminal = advanceOne;
advanceOne = function advanceOneTerminal() {
  const oldCursor = state.cursor;
  const wasFollowing = state.chartView.followLatest;
  const result = baseAdvanceOneTerminal();
  if (result) {
    const moved = state.cursor - oldCursor;
    if (wasFollowing) state.chartView.pan = 0;
    else state.chartView.pan += moved;
  }
  return result;
};

const baseStartSessionTerminal = startSession;
startSession = function startSessionTerminal() {
  resetChartViewport();
  baseStartSessionTerminal();
  if (!els.practiceArea.hidden) {
    document.body.classList.add("terminal-session-active");
    window.scrollTo({ top: 0, behavior: "auto" });
    renderMobileTerminal();
  }
};

const baseResetToSetupTerminal = resetToSetup;
resetToSetup = function resetToSetupTerminal() {
  document.body.classList.remove("terminal-session-active");
  baseResetToSetupTerminal();
};

const baseRenderAccountTerminal = renderAccount;
renderAccount = function renderAccountTerminal() {
  baseRenderAccountTerminal();
  renderMobileTerminal();
};

const baseRenderPlanTerminal = renderPlan;
renderPlan = function renderPlanTerminal() {
  baseRenderPlanTerminal();
  renderMobileTerminal();
};

const baseRenderButtonsTerminal = renderButtons;
renderButtons = function renderButtonsTerminal() {
  baseRenderButtonsTerminal();
  renderMobileTerminal();
};

const baseBindEventsTerminal = bindEvents;
bindEvents = function bindEventsTerminal() {
  baseBindEventsTerminal();
  els.chartOlderButton.addEventListener("click", () => shiftHorizontal(Math.max(1, Math.round(state.chartView.bars * 0.35))));
  els.chartLatestButton.addEventListener("click", followLatestChart);
  els.chartZoomXIn.addEventListener("click", () => zoomHorizontal(0.8));
  els.chartZoomXOut.addEventListener("click", () => zoomHorizontal(1.25));
  els.chartZoomYIn.addEventListener("click", () => zoomVertical(0.8));
  els.chartZoomYOut.addEventListener("click", () => zoomVertical(1.25));
  els.chartPanUp.addEventListener("click", () => panVertical(-0.15));
  els.chartPanDown.addEventListener("click", () => panVertical(0.15));
  els.chartResetButton.addEventListener("click", resetChartViewport);
  els.mobileBuyButton.addEventListener("click", manualBuyChunk);
  els.mobileSellButton.addEventListener("click", () => manualSell(1));
  els.mobileStepButton.addEventListener("click", () => advance(1));
  els.mobilePlayButton.addEventListener("click", togglePlayback);
  els.mobileLatestButton.addEventListener("click", followLatestChart);
  els.mobileOrderSettings.addEventListener("click", () => document.querySelector(".bracket-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  bindViewportPointerEvents();
  window.addEventListener("resize", () => {
    if (!state.chartView.userSizedX) state.chartView.bars = defaultViewportBars();
    if (!els.practiceArea.hidden) scheduleViewportRender();
  });
};

document.addEventListener("DOMContentLoaded", init);
