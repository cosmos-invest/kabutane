const ReplayEngine = (() => {
  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function roundToLot(shares, lotSize) {
    const lot = Math.max(1, Number(lotSize) || 1);
    return Math.floor(Math.max(0, Number(shares) || 0) / lot) * lot;
  }

  function applyBuy(account, shares, price, costBps = 0) {
    const quantity = Math.floor(Number(shares) || 0);
    const executionPrice = finite(price);
    if (quantity <= 0 || executionPrice === null || executionPrice <= 0) return { ok: false, error: "購入株数または価格が不正です。" };
    const gross = quantity * executionPrice;
    const fee = gross * (Number(costBps) || 0) / 10000;
    const total = gross + fee;
    if (total > account.cash + 0.0001) return { ok: false, error: "現金が不足しています。" };
    return {
      ok: true,
      fee,
      gross,
      account: {
        ...account,
        cash: account.cash - total,
        shares: account.shares + quantity,
        costBasis: account.costBasis + total,
        fees: (account.fees || 0) + fee,
      },
    };
  }

  function applySell(account, shares, price, costBps = 0) {
    const quantity = Math.floor(Number(shares) || 0);
    const executionPrice = finite(price);
    if (quantity <= 0 || executionPrice === null || executionPrice <= 0) return { ok: false, error: "売却株数または価格が不正です。" };
    if (quantity > account.shares) return { ok: false, error: "保有株数を超えています。" };
    const averageCost = account.shares > 0 ? account.costBasis / account.shares : 0;
    const allocatedCost = averageCost * quantity;
    const gross = quantity * executionPrice;
    const fee = gross * (Number(costBps) || 0) / 10000;
    const proceeds = gross - fee;
    const realizedDelta = proceeds - allocatedCost;
    const remainingShares = account.shares - quantity;
    return {
      ok: true,
      fee,
      gross,
      proceeds,
      realizedDelta,
      account: {
        ...account,
        cash: account.cash + proceeds,
        shares: remainingShares,
        costBasis: remainingShares > 0 ? Math.max(0, account.costBasis - allocatedCost) : 0,
        realized: (account.realized || 0) + realizedDelta,
        fees: (account.fees || 0) + fee,
      },
    };
  }

  function metrics(account, price, initialCapital) {
    const currentPrice = finite(price) || 0;
    const marketValue = account.shares * currentPrice;
    const totalValue = account.cash + marketValue;
    const unrealized = marketValue - account.costBasis;
    const unrealizedPct = account.costBasis > 0 ? unrealized / account.costBasis * 100 : null;
    const totalProfit = totalValue - initialCapital;
    const totalReturn = initialCapital > 0 ? totalProfit / initialCapital * 100 : null;
    return {
      averagePrice: account.shares > 0 ? account.costBasis / account.shares : null,
      marketValue,
      totalValue,
      unrealized,
      unrealizedPct,
      totalProfit,
      totalReturn,
    };
  }

  return { finite, roundToLot, applyBuy, applySell, metrics };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ReplayEngine;

if (typeof document !== "undefined") {
  const state = {
    payload: null,
    rows: [],
    code: "",
    startIndex: 0,
    cursor: 0,
    initialCapital: 3000000,
    lotSize: 100,
    costBps: 10,
    account: { cash: 3000000, shares: 0, costBasis: 0, realized: 0, fees: 0 },
    buyStages: 0,
    trades: [],
    chart: null,
    timer: null,
    peakValue: 3000000,
    maxDrawdown: 0,
    ended: false,
  };

  const els = {};
  const $ = (id) => document.getElementById(id);
  const ids = [
    "detailBackLink", "replayTitle", "replaySubtitle", "sessionState", "newSessionButton", "setupPanel",
    "startMode", "startDate", "initialCapital", "lotSize", "costBps", "playSpeed", "startSessionButton",
    "setupNotice", "practiceArea", "currentDate", "currentPrice", "cashValue", "shareValue", "averagePrice",
    "unrealizedValue", "realizedValue", "totalValue", "dayProgress", "indicatorRsi", "indicatorSma",
    "indicatorVolume", "replayChart", "stepOneButton", "stepFiveButton", "playButton", "finishButton",
    "buyStageStatus", "tradeMemo", "buyChunkButton", "customBuyShares", "buyCustomButton", "sellQuarterButton",
    "sellHalfButton", "sellAllButton", "orderMessage", "totalReturn", "totalProfit", "marketValue",
    "remainingBuys", "peakValue", "maxDrawdown", "finishSummary", "tradeHistoryBody",
  ];

  function finite(value) { return ReplayEngine.finite(value); }
  function yen(value) {
    const number = finite(value);
    return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`;
  }
  function number(value, digits = 2) {
    const parsed = finite(value);
    return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }
  function percent(value) {
    const parsed = finite(value);
    return parsed === null ? "—" : `${parsed > 0 ? "+" : ""}${number(parsed)}%`;
  }
  function performanceClass(value) {
    const parsed = finite(value);
    return parsed === null || parsed === 0 ? "" : parsed > 0 ? "positive" : "negative";
  }
  function queryCode() { return new URLSearchParams(window.location.search).get("code")?.trim() || ""; }
  async function fetchJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} の読込に失敗しました (${response.status})`);
    return response.json();
  }

  const candlePlugin = {
    id: "replayCandles",
    beforeDatasetsDraw(chart, args, options) {
      const rows = options.rows || [];
      if (!rows.length || !chart.scales.x || !chart.scales.y) return;
      const ctx = chart.ctx; const xScale = chart.scales.x; const yScale = chart.scales.y;
      const sampleWidth = rows.length > 1 ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) : 8;
      const bodyWidth = Math.max(1, Math.min(8, sampleWidth * 0.66));
      ctx.save();
      rows.forEach((row, index) => {
        const open = finite(row.open); const high = finite(row.high); const low = finite(row.low); const close = finite(row.close);
        if ([open, high, low, close].some((value) => value === null)) return;
        const x = xScale.getPixelForValue(index); const rising = close >= open;
        const color = rising ? "#d65796" : "#4b91b4";
        const top = yScale.getPixelForValue(Math.max(open, close)); const bottom = yScale.getPixelForValue(Math.min(open, close));
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, yScale.getPixelForValue(high)); ctx.lineTo(x, yScale.getPixelForValue(low)); ctx.stroke();
        ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top));
      });
      ctx.restore();
    },
  };

  const tradeMarkerPlugin = {
    id: "replayTrades",
    afterDatasetsDraw(chart, args, options) {
      const trades = options.trades || []; const labels = chart.data.labels || [];
      if (!trades.length || !labels.length) return;
      const ctx = chart.ctx; const yScale = chart.scales.y; const xScale = chart.scales.x;
      ctx.save(); ctx.font = "800 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      trades.forEach((trade) => {
        const index = labels.indexOf(trade.date); if (index < 0) return;
        const x = xScale.getPixelForValue(index); const y = yScale.getPixelForValue(trade.price);
        const buy = trade.type === "BUY"; ctx.fillStyle = buy ? "#a855c7" : "#e34f7e";
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillText(trade.label, x, y);
      });
      ctx.restore();
    },
  };

  function currentRow() { return state.rows[state.cursor] || null; }
  function updatePeak(totalValue) {
    state.peakValue = Math.max(state.peakValue, totalValue);
    const drawdown = state.peakValue > 0 ? (totalValue / state.peakValue - 1) * 100 : 0;
    state.maxDrawdown = Math.min(state.maxDrawdown, drawdown);
  }

  function renderChart() {
    const begin = Math.max(0, Math.min(state.startIndex - 80, state.cursor - 119));
    const visible = state.rows.slice(begin, state.cursor + 1);
    const labels = visible.map((row) => row.date);
    if (state.chart) state.chart.destroy();
    Chart.register(candlePlugin, tradeMarkerPlugin);
    state.chart = new Chart(els.replayChart, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "終値", data: visible.map((row) => row.close), borderColor: "rgba(0,0,0,0)", pointRadius: 0, borderWidth: 0 },
          { label: "SMA25", data: visible.map((row) => row.sma25), borderColor: "#dc6a9f", pointRadius: 0, borderWidth: 1.7, spanGaps: true },
          { label: "SMA75", data: visible.map((row) => row.sma75), borderColor: "#9a78d4", pointRadius: 0, borderWidth: 1.7, spanGaps: true },
          { label: "SMA200", data: visible.map((row) => row.sma200), borderColor: "#68afd4", pointRadius: 0, borderWidth: 1.7, spanGaps: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#654f60", usePointStyle: true } },
          replayCandles: { rows: visible }, replayTrades: { trades: state.trades },
          tooltip: { callbacks: { afterBody(items) { const row = visible[items[0]?.dataIndex]; return row ? [`始値 ${number(row.open)}`, `高値 ${number(row.high)}`, `安値 ${number(row.low)}`, `出来高 ${number(row.volume, 0)}`] : []; } } },
        },
        scales: {
          x: { ticks: { color: "#806b79", maxTicksLimit: 10, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.10)" } },
          y: { ticks: { color: "#806b79" }, grid: { color: "rgba(170,120,150,.13)" } },
        },
      },
    });
  }

  function renderHistory() {
    els.tradeHistoryBody.innerHTML = state.trades.map((trade) => `
      <tr class="${trade.type === "BUY" ? "buy-row" : "sell-row"}">
        <td>${trade.date}</td><td><strong>${trade.label}</strong> ${trade.type === "BUY" ? "購入" : "売却"}</td>
        <td class="num">${number(trade.price)}</td><td class="num">${trade.shares.toLocaleString("ja-JP")}</td>
        <td class="num ${performanceClass(trade.realized)}">${trade.type === "SELL" ? yen(trade.realized) : "—"}</td><td>${trade.memo || "—"}</td>
      </tr>`).join("") || '<tr><td colspan="6" class="empty-state">売買すると、ここに履歴が表示されます。</td></tr>';
  }

  function renderAccount() {
    const row = currentRow(); if (!row) return;
    const metrics = ReplayEngine.metrics(state.account, row.close, state.initialCapital);
    updatePeak(metrics.totalValue);
    els.currentDate.textContent = row.date;
    els.currentPrice.textContent = yen(row.close);
    els.cashValue.textContent = yen(state.account.cash);
    els.shareValue.textContent = `${state.account.shares.toLocaleString("ja-JP")}株`;
    els.averagePrice.textContent = yen(metrics.averagePrice);
    els.unrealizedValue.textContent = `${yen(metrics.unrealized)}（${percent(metrics.unrealizedPct)}）`;
    els.unrealizedValue.className = performanceClass(metrics.unrealized);
    els.realizedValue.textContent = yen(state.account.realized);
    els.realizedValue.className = performanceClass(state.account.realized);
    els.totalValue.textContent = yen(metrics.totalValue);
    els.totalReturn.textContent = percent(metrics.totalReturn); els.totalReturn.className = performanceClass(metrics.totalReturn);
    els.totalProfit.textContent = yen(metrics.totalProfit); els.totalProfit.className = performanceClass(metrics.totalProfit);
    els.marketValue.textContent = yen(metrics.marketValue);
    els.remainingBuys.textContent = `${Math.max(0, 5 - state.buyStages)}回`;
    els.peakValue.textContent = yen(state.peakValue);
    els.maxDrawdown.textContent = percent(state.maxDrawdown); els.maxDrawdown.className = performanceClass(state.maxDrawdown);
    els.buyStageStatus.textContent = `${state.buyStages} / 5`;
  }

  function renderIndicators() {
    const row = currentRow(); if (!row) return;
    els.indicatorRsi.textContent = `月足RSI5 ${number(row.rsi5)} / RSI14 ${number(row.rsi14)}`;
    els.indicatorSma.textContent = `SMA25 ${number(row.sma25)} / 75 ${number(row.sma75)} / 200 ${number(row.sma200)}`;
    els.indicatorVolume.textContent = `出来高 ${number(row.volume, 0)}`;
    els.dayProgress.textContent = `開始から ${state.cursor - state.startIndex + 1}営業日目。表示済み ${state.cursor + 1}/${state.rows.length}日`; 
  }

  function renderButtons() {
    const noShares = state.account.shares <= 0; const noFuture = state.cursor >= state.rows.length - 1; const buyingDone = state.buyStages >= 5;
    els.buyChunkButton.disabled = state.ended || buyingDone;
    els.buyCustomButton.disabled = state.ended || buyingDone;
    [els.sellQuarterButton, els.sellHalfButton, els.sellAllButton].forEach((button) => { button.disabled = state.ended || noShares; });
    [els.stepOneButton, els.stepFiveButton, els.playButton].forEach((button) => { button.disabled = state.ended || noFuture; });
  }

  function render() {
    renderChart(); renderAccount(); renderIndicators(); renderHistory(); renderButtons();
  }

  function orderMessage(message, error = false) {
    els.orderMessage.textContent = message;
    els.orderMessage.classList.toggle("negative", error);
  }

  function buyShares(requestedShares) {
    if (state.ended || state.buyStages >= 5) return orderMessage("購入は最大5回までです。", true);
    const row = currentRow(); const shares = ReplayEngine.roundToLot(requestedShares, state.lotSize);
    if (shares <= 0) return orderMessage("購入できる株数がありません。売買単位や資金を確認してください。", true);
    const result = ReplayEngine.applyBuy(state.account, shares, row.close, state.costBps);
    if (!result.ok) return orderMessage(result.error, true);
    state.account = result.account; state.buyStages += 1;
    state.trades.push({ date: row.date, type: "BUY", label: `B${state.buyStages}`, price: row.close, shares, realized: null, memo: els.tradeMemo.value.trim() });
    els.tradeMemo.value = ""; orderMessage(`${shares.toLocaleString("ja-JP")}株を${yen(row.close)}で購入しました。`); render();
  }

  function buyChunk() {
    const row = currentRow(); const costRate = state.costBps / 10000;
    const budget = Math.min(state.initialCapital / 5, state.account.cash);
    const shares = ReplayEngine.roundToLot(Math.floor(budget / (row.close * (1 + costRate))), state.lotSize);
    buyShares(shares);
  }

  function sellRatio(ratio) {
    if (state.ended || state.account.shares <= 0) return orderMessage("売却できる保有株がありません。", true);
    const row = currentRow(); let shares;
    if (ratio >= 1) shares = state.account.shares;
    else {
      shares = ReplayEngine.roundToLot(Math.floor(state.account.shares * ratio), state.lotSize);
      if (shares <= 0) shares = Math.min(state.account.shares, state.lotSize);
    }
    const result = ReplayEngine.applySell(state.account, shares, row.close, state.costBps);
    if (!result.ok) return orderMessage(result.error, true);
    state.account = result.account;
    const sellNumber = state.trades.filter((trade) => trade.type === "SELL").length + 1;
    state.trades.push({ date: row.date, type: "SELL", label: `S${sellNumber}`, price: row.close, shares, realized: result.realizedDelta, memo: els.tradeMemo.value.trim() });
    els.tradeMemo.value = ""; orderMessage(`${shares.toLocaleString("ja-JP")}株を売却。実現損益 ${yen(result.realizedDelta)}。`); render();
  }

  function stopPlayback() {
    if (state.timer) clearInterval(state.timer); state.timer = null; els.playButton.textContent = "▶ 再生";
  }

  function advance(days = 1) {
    if (state.ended) return;
    state.cursor = Math.min(state.rows.length - 1, state.cursor + days);
    if (state.cursor >= state.rows.length - 1) { stopPlayback(); orderMessage("利用できる最新日まで到達しました。結果を確定してください。"); }
    render();
  }

  function togglePlayback() {
    if (state.timer) { stopPlayback(); return; }
    const speed = Number(els.playSpeed.value) || 500; els.playButton.textContent = "⏸ 一時停止";
    state.timer = setInterval(() => { if (state.cursor >= state.rows.length - 1 || state.ended) stopPlayback(); else advance(1); }, speed);
  }

  function finishSession() {
    stopPlayback(); state.ended = true; const row = currentRow(); const metrics = ReplayEngine.metrics(state.account, row.close, state.initialCapital);
    els.sessionState.textContent = "練習終了";
    els.finishSummary.hidden = false;
    els.finishSummary.innerHTML = `<h3>今回の結果</h3><p><strong class="${performanceClass(metrics.totalProfit)}">${yen(metrics.totalProfit)}（${percent(metrics.totalReturn)}）</strong></p><p>購入 ${state.buyStages}回、売却 ${state.trades.filter((trade) => trade.type === "SELL").length}回、手数料 ${yen(state.account.fees)}。終了時に${state.account.shares.toLocaleString("ja-JP")}株を保有しています。</p>`;
    renderButtons(); els.finishSummary.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function chooseStartIndex() {
    const minIndex = Math.min(220, Math.max(0, state.rows.length - 60));
    const maxIndex = Math.max(minIndex, state.rows.length - 45);
    if (els.startMode.value === "date" && els.startDate.value) {
      const found = state.rows.findIndex((row) => row.date >= els.startDate.value);
      return Math.min(maxIndex, Math.max(minIndex, found >= 0 ? found : minIndex));
    }
    return minIndex + Math.floor(Math.random() * (maxIndex - minIndex + 1));
  }

  function startSession() {
    if (state.rows.length < 60) return orderMessage("練習に必要な日足データが不足しています。", true);
    stopPlayback(); state.initialCapital = Number(els.initialCapital.value); state.lotSize = Number(els.lotSize.value); state.costBps = Number(els.costBps.value);
    state.startIndex = chooseStartIndex(); state.cursor = state.startIndex; state.account = { cash: state.initialCapital, shares: 0, costBasis: 0, realized: 0, fees: 0 };
    state.buyStages = 0; state.trades = []; state.peakValue = state.initialCapital; state.maxDrawdown = 0; state.ended = false;
    els.setupPanel.hidden = true; els.practiceArea.hidden = false; els.finishSummary.hidden = true; els.sessionState.textContent = "練習中"; orderMessage("チャートを見て、最初の判断をしてください。"); render();
  }

  function resetToSetup() {
    stopPlayback(); els.practiceArea.hidden = true; els.setupPanel.hidden = false; els.sessionState.textContent = "条件設定"; window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindEvents() {
    els.startMode.addEventListener("change", () => { els.startDate.disabled = els.startMode.value !== "date"; });
    els.startSessionButton.addEventListener("click", startSession); els.newSessionButton.addEventListener("click", resetToSetup);
    els.stepOneButton.addEventListener("click", () => advance(1)); els.stepFiveButton.addEventListener("click", () => advance(5)); els.playButton.addEventListener("click", togglePlayback); els.finishButton.addEventListener("click", finishSession);
    els.buyChunkButton.addEventListener("click", buyChunk); els.buyCustomButton.addEventListener("click", () => buyShares(Number(els.customBuyShares.value)));
    els.sellQuarterButton.addEventListener("click", () => sellRatio(.25)); els.sellHalfButton.addEventListener("click", () => sellRatio(.5)); els.sellAllButton.addEventListener("click", () => sellRatio(1));
  }

  async function init() {
    ids.forEach((id) => { els[id] = $(id); }); bindEvents(); state.code = queryCode();
    if (!state.code) { els.setupNotice.textContent = "URLに銘柄コードがありません。銘柄詳細から開いてください。"; els.startSessionButton.disabled = true; return; }
    try {
      state.payload = await fetchJson(`data/charts/${encodeURIComponent(state.code)}.json`); state.rows = (state.payload.daily || []).filter((row) => finite(row.close) !== null);
      els.replayTitle.textContent = `${state.payload.name}（${state.payload.code}）売買練習🌸`;
      els.replaySubtitle.textContent = `${state.rows[0]?.date || "—"}〜${state.rows.at(-1)?.date || "—"}の日足から練習できます。未来の足は開始後に隠れます。`;
      els.detailBackLink.href = `detail.html?code=${encodeURIComponent(state.code)}`;
      const minIndex = Math.min(220, Math.max(0, state.rows.length - 60)); const maxIndex = Math.max(minIndex, state.rows.length - 45);
      els.startDate.min = state.rows[minIndex]?.date || ""; els.startDate.max = state.rows[maxIndex]?.date || ""; els.startDate.value = state.rows[minIndex]?.date || "";
      els.sessionState.textContent = "条件設定";
    } catch (error) {
      els.setupNotice.textContent = `データを読み込めませんでした: ${error.message}`; els.startSessionButton.disabled = true;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
}
