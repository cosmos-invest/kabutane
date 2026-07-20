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

  function maxAffordableShares(cash, price, lotSize, costBps = 0) {
    const amount = Math.max(0, finite(cash) || 0);
    const executionPrice = finite(price);
    if (executionPrice === null || executionPrice <= 0) return 0;
    const costRate = (Number(costBps) || 0) / 10000;
    return roundToLot(amount / (executionPrice * (1 + costRate)), lotSize);
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
        costBasis: (account.costBasis || 0) + total,
        grossBasis: (account.grossBasis || 0) + gross,
        fees: (account.fees || 0) + fee,
      },
    };
  }

  function applySell(account, shares, price, costBps = 0) {
    const quantity = Math.floor(Number(shares) || 0);
    const executionPrice = finite(price);
    if (quantity <= 0 || executionPrice === null || executionPrice <= 0) return { ok: false, error: "売却株数または価格が不正です。" };
    if (quantity > account.shares) return { ok: false, error: "保有株数を超えています。" };
    const averageCost = account.shares > 0 ? (account.costBasis || 0) / account.shares : 0;
    const averageGross = account.shares > 0 ? (account.grossBasis || account.costBasis || 0) / account.shares : 0;
    const allocatedCost = averageCost * quantity;
    const allocatedGross = averageGross * quantity;
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
        costBasis: remainingShares > 0 ? Math.max(0, (account.costBasis || 0) - allocatedCost) : 0,
        grossBasis: remainingShares > 0 ? Math.max(0, (account.grossBasis || account.costBasis || 0) - allocatedGross) : 0,
        realized: (account.realized || 0) + realizedDelta,
        fees: (account.fees || 0) + fee,
      },
    };
  }

  function metrics(account, price, initialCapital) {
    const currentPrice = finite(price) || 0;
    const marketValue = account.shares * currentPrice;
    const totalValue = account.cash + marketValue;
    const unrealized = marketValue - (account.costBasis || 0);
    const unrealizedPct = account.costBasis > 0 ? unrealized / account.costBasis * 100 : null;
    const totalProfit = totalValue - initialCapital;
    const totalReturn = initialCapital > 0 ? totalProfit / initialCapital * 100 : null;
    return {
      averagePrice: account.shares > 0 ? (account.grossBasis || account.costBasis || 0) / account.shares : null,
      averageCost: account.shares > 0 ? (account.costBasis || 0) / account.shares : null,
      marketValue,
      totalValue,
      unrealized,
      unrealizedPct,
      totalProfit,
      totalReturn,
    };
  }

  function restoreSlots(current, amount, maximum = 8) {
    return Math.min(maximum, Math.max(0, Number(current) || 0) + Math.max(0, Number(amount) || 0));
  }

  function positionPlan({ assets, allocationPct, riskPct, entryPrice, stopPrice, targetPrice, lotSize, costBps = 0, slots = 8 }) {
    const totalAssets = Math.max(0, finite(assets) || 0);
    const entry = finite(entryPrice);
    const stop = finite(stopPrice);
    const target = finite(targetPrice);
    const allocationBudget = totalAssets * Math.max(0, finite(allocationPct) || 0) / 100;
    const riskBudget = totalAssets * Math.max(0, finite(riskPct) || 0) / 100;
    if (entry === null || entry <= 0) return { allocationBudget, riskBudget, maxByAllocation: 0, maxByRisk: null, recommendedShares: 0, slotShares: 0, riskPerShare: null, rewardPerShare: null, riskReward: null, plannedLoss: null, plannedReward: null };
    const maxByAllocation = maxAffordableShares(allocationBudget, entry, lotSize, costBps);
    const riskPerShare = stop !== null && stop > 0 && stop < entry ? entry - stop : null;
    const rewardPerShare = target !== null && target > entry ? target - entry : null;
    const maxByRisk = riskPerShare ? roundToLot(riskBudget / riskPerShare, lotSize) : null;
    const recommendedShares = maxByRisk === null ? maxByAllocation : Math.min(maxByAllocation, maxByRisk);
    const slotShares = roundToLot(recommendedShares / Math.max(1, Number(slots) || 8), lotSize);
    const plannedLoss = riskPerShare ? recommendedShares * riskPerShare : null;
    const plannedReward = rewardPerShare ? recommendedShares * rewardPerShare : null;
    const riskReward = riskPerShare && rewardPerShare ? rewardPerShare / riskPerShare : null;
    return { allocationBudget, riskBudget, maxByAllocation, maxByRisk, recommendedShares, slotShares, riskPerShare, rewardPerShare, riskReward, plannedLoss, plannedReward };
  }

  function sma(values, period) {
    const result = Array(values.length).fill(null);
    let sum = 0;
    let valid = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = finite(values[i]);
      if (value !== null) { sum += value; valid += 1; }
      if (i >= period) {
        const removed = finite(values[i - period]);
        if (removed !== null) { sum -= removed; valid -= 1; }
      }
      if (i >= period - 1 && valid === period) result[i] = sum / period;
    }
    return result;
  }

  function ema(values, period) {
    const result = Array(values.length).fill(null);
    const multiplier = 2 / (period + 1);
    const seed = [];
    let previous = null;
    for (let i = 0; i < values.length; i += 1) {
      const value = finite(values[i]);
      if (value === null) continue;
      if (previous === null) {
        seed.push(value);
        if (seed.length === period) {
          previous = seed.reduce((sum, item) => sum + item, 0) / period;
          result[i] = previous;
        }
      } else {
        previous = (value - previous) * multiplier + previous;
        result[i] = previous;
      }
    }
    return result;
  }

  function rsi(values, period = 14) {
    const result = Array(values.length).fill(null);
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i < values.length; i += 1) {
      const current = finite(values[i]);
      const previous = finite(values[i - 1]);
      if (current === null || previous === null) continue;
      const change = current - previous;
      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);
      if (i <= period) {
        avgGain += gain;
        avgLoss += loss;
        if (i === period) {
          avgGain /= period;
          avgLoss /= period;
          result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
        }
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }
    return result;
  }

  function atr(rows, period = 14) {
    const tr = rows.map((row, index) => {
      const high = finite(row.high);
      const low = finite(row.low);
      const previousClose = index > 0 ? finite(rows[index - 1].close) : null;
      if (high === null || low === null) return null;
      return previousClose === null ? high - low : Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    });
    const result = Array(rows.length).fill(null);
    let previous = null;
    for (let i = 0; i < tr.length; i += 1) {
      const value = finite(tr[i]);
      if (value === null) continue;
      if (i === period - 1) {
        const seed = tr.slice(0, period).map(finite);
        if (seed.every((item) => item !== null)) {
          previous = seed.reduce((sum, item) => sum + item, 0) / period;
          result[i] = previous;
        }
      } else if (i >= period && previous !== null) {
        previous = (previous * (period - 1) + value) / period;
        result[i] = previous;
      }
    }
    return result;
  }

  function rollingStd(values, period) {
    const result = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i += 1) {
      const window = values.slice(i - period + 1, i + 1).map(finite);
      if (window.some((value) => value === null)) continue;
      const mean = window.reduce((sum, value) => sum + value, 0) / period;
      const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
      result[i] = Math.sqrt(variance);
    }
    return result;
  }

  function enrichRows(rows) {
    const closes = rows.map((row) => finite(row.close));
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macd = closes.map((_, index) => ema12[index] !== null && ema26[index] !== null ? ema12[index] - ema26[index] : null);
    const macdSignal = ema(macd, 9);
    const dailyRsi14 = rsi(closes, 14);
    const atr14 = atr(rows, 14);
    const bbMid = sma(closes, 20);
    const bbStd = rollingStd(closes, 20);
    const volumeSma20 = sma(rows.map((row) => finite(row.volume)), 20);
    const stochasticK = Array(rows.length).fill(null);
    for (let i = 13; i < rows.length; i += 1) {
      const window = rows.slice(i - 13, i + 1);
      const highs = window.map((row) => finite(row.high));
      const lows = window.map((row) => finite(row.low));
      const close = finite(rows[i].close);
      if (highs.some((value) => value === null) || lows.some((value) => value === null) || close === null) continue;
      const highest = Math.max(...highs);
      const lowest = Math.min(...lows);
      stochasticK[i] = highest === lowest ? 50 : (close - lowest) / (highest - lowest) * 100;
    }
    const stochasticD = sma(stochasticK, 3);
    return rows.map((row, index) => ({
      ...row,
      ema20: ema20[index], ema50: ema50[index], dailyRsi14: dailyRsi14[index], atr14: atr14[index],
      atrPct: atr14[index] !== null && closes[index] ? atr14[index] / closes[index] * 100 : null,
      bbMid: bbMid[index],
      bbUpper: bbMid[index] !== null && bbStd[index] !== null ? bbMid[index] + 2 * bbStd[index] : null,
      bbLower: bbMid[index] !== null && bbStd[index] !== null ? bbMid[index] - 2 * bbStd[index] : null,
      macd: macd[index], macdSignal: macdSignal[index],
      macdHist: macd[index] !== null && macdSignal[index] !== null ? macd[index] - macdSignal[index] : null,
      stochasticK: stochasticK[index], stochasticD: stochasticD[index], volumeSma20: volumeSma20[index],
    }));
  }

  return { finite, roundToLot, maxAffordableShares, applyBuy, applySell, metrics, restoreSlots, positionPlan, sma, ema, rsi, atr, enrichRows };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ReplayEngine;

if (typeof document !== "undefined") {
  const MAX_SLOTS = 8;
  const state = {
    payload: null, rows: [], code: "", startIndex: 0, cursor: 0, initialCapital: 3000000,
    allocationPct: 20, riskPct: 1, lotSize: 100, costBps: 10,
    account: { cash: 3000000, shares: 0, costBasis: 0, grossBasis: 0, realized: 0, fees: 0 },
    availableSlots: MAX_SLOTS, buySequence: 0, trades: [], chart: null, oscillatorChart: null,
    timer: null, peakValue: 3000000, maxDrawdown: 0, ended: false,
  };

  const els = {};
  const $ = (id) => document.getElementById(id);
  const ids = [
    "detailBackLink", "replayTitle", "replaySubtitle", "sessionState", "newSessionButton", "setupPanel",
    "startMode", "startDate", "totalAssets", "allocationPct", "riskPct", "lotSize", "costBps", "playSpeed",
    "startSessionButton", "setupNotice", "practiceArea", "currentDate", "currentPrice", "cashValue", "shareValue",
    "averagePrice", "averageCostNote", "unrealizedValue", "realizedValue", "totalValue", "plannedEntryPrice",
    "stopPrice", "targetPrice", "resetRiskPrices", "positionBudget", "allocationMaxShares", "riskBudget",
    "riskMaxShares", "recommendedShares", "slotShares", "plannedLoss", "plannedReward", "riskRewardBadge",
    "riskPlanNotice", "dayProgress", "indicatorRsi", "indicatorSma", "indicatorVolume", "showSma", "showEma",
    "showBollinger", "showAverage", "showRiskLines", "oscillatorSelect", "replayChart", "oscillatorChart",
    "stepOneButton", "stepFiveButton", "playButton", "finishButton", "buyStageStatus", "slotDots", "tradeMemo",
    "buyChunkButton", "customBuyShares", "buyCustomButton", "buyAssist", "sellQuarterButton", "sellHalfButton",
    "sellAllButton", "orderMessage", "totalReturn", "totalProfit", "marketValue", "remainingBuys", "averageCost",
    "peakValue", "maxDrawdown", "feeValue", "finishSummary", "tradeHistoryBody",
  ];

  function finite(value) { return ReplayEngine.finite(value); }
  function yen(value) { const n = finite(value); return n === null ? "—" : `${Math.round(n).toLocaleString("ja-JP")}円`; }
  function number(value, digits = 2) { const n = finite(value); return n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: digits }); }
  function percent(value) { const n = finite(value); return n === null ? "—" : `${n > 0 ? "+" : ""}${number(n)}%`; }
  function performanceClass(value) { const n = finite(value); return n === null || n === 0 ? "" : n > 0 ? "positive" : "negative"; }
  function queryCode() { return new URLSearchParams(window.location.search).get("code")?.trim() || ""; }
  async function fetchJson(path) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); if (!response.ok) throw new Error(`${path} の読込に失敗しました (${response.status})`); return response.json(); }

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
        const x = xScale.getPixelForValue(index); const rising = close >= open; const color = rising ? "#d65796" : "#4b91b4";
        const top = yScale.getPixelForValue(Math.max(open, close)); const bottom = yScale.getPixelForValue(Math.min(open, close));
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(x, yScale.getPixelForValue(high)); ctx.lineTo(x, yScale.getPixelForValue(low)); ctx.stroke();
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
        ctx.fillStyle = trade.type === "BUY" ? "#a855c7" : "#e34f7e"; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillText(trade.label, x, y);
      });
      ctx.restore();
    },
  };

  function currentRow() { return state.rows[state.cursor] || null; }
  function currentPlan() {
    return ReplayEngine.positionPlan({
      assets: state.initialCapital, allocationPct: state.allocationPct, riskPct: state.riskPct,
      entryPrice: currentRow()?.close, stopPrice: els.stopPrice.value, targetPrice: els.targetPrice.value,
      lotSize: state.lotSize, costBps: state.costBps, slots: MAX_SLOTS,
    });
  }
  function updatePeak(totalValue) { state.peakValue = Math.max(state.peakValue, totalValue); const drawdown = state.peakValue > 0 ? (totalValue / state.peakValue - 1) * 100 : 0; state.maxDrawdown = Math.min(state.maxDrawdown, drawdown); }
  function visibleRows() { const begin = Math.max(0, Math.min(state.startIndex - 80, state.cursor - 119)); return state.rows.slice(begin, state.cursor + 1); }
  function lineDataset(label, data, color, extra = {}) { return { label, data, borderColor: color, backgroundColor: color, pointRadius: 0, borderWidth: 1.7, spanGaps: true, ...extra }; }

  function renderChart() {
    const visible = visibleRows(); const labels = visible.map((row) => row.date);
    const metrics = ReplayEngine.metrics(state.account, currentRow()?.close, state.initialCapital);
    const datasets = [
      { label: "終値", data: visible.map((row) => row.close), borderColor: "rgba(0,0,0,0)", pointRadius: 0, borderWidth: 0, yAxisID: "y" },
      { type: "bar", label: "出来高", data: visible.map((row) => row.volume), backgroundColor: "rgba(176,126,178,.16)", borderWidth: 0, yAxisID: "yVolume" },
    ];
    if (els.showSma.checked) {
      datasets.push(lineDataset("SMA25", visible.map((row) => row.sma25), "#dc6a9f"));
      datasets.push(lineDataset("SMA75", visible.map((row) => row.sma75), "#9a78d4"));
      datasets.push(lineDataset("SMA200", visible.map((row) => row.sma200), "#68afd4"));
    }
    if (els.showEma.checked) {
      datasets.push(lineDataset("EMA20", visible.map((row) => row.ema20), "#f29a62", { borderDash: [5, 3] }));
      datasets.push(lineDataset("EMA50", visible.map((row) => row.ema50), "#6ba98f", { borderDash: [5, 3] }));
    }
    if (els.showBollinger.checked) {
      datasets.push(lineDataset("BB上限", visible.map((row) => row.bbUpper), "rgba(177,126,211,.75)", { borderWidth: 1 }));
      datasets.push(lineDataset("BB中心", visible.map((row) => row.bbMid), "rgba(177,126,211,.45)", { borderWidth: 1 }));
      datasets.push(lineDataset("BB下限", visible.map((row) => row.bbLower), "rgba(177,126,211,.75)", { borderWidth: 1 }));
    }
    if (els.showAverage.checked && metrics.averagePrice !== null) datasets.push(lineDataset("平均約定", visible.map(() => metrics.averagePrice), "#b23b78", { borderWidth: 2.2, borderDash: [8, 4] }));
    if (els.showRiskLines.checked) {
      const stop = finite(els.stopPrice.value); const target = finite(els.targetPrice.value);
      if (stop !== null) datasets.push(lineDataset("損切り", visible.map(() => stop), "#4b91b4", { borderWidth: 1.5, borderDash: [4, 4] }));
      if (target !== null) datasets.push(lineDataset("目標", visible.map(() => target), "#d65796", { borderWidth: 1.5, borderDash: [4, 4] }));
    }
    if (state.chart) state.chart.destroy();
    Chart.register(candlePlugin, tradeMarkerPlugin);
    state.chart = new Chart(els.replayChart, {
      type: "line", data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#654f60", usePointStyle: true, boxWidth: 9 } }, replayCandles: { rows: visible }, replayTrades: { trades: state.trades },
          tooltip: { callbacks: { afterBody(items) { const row = visible[items[0]?.dataIndex]; return row ? [`始値 ${number(row.open)}`, `高値 ${number(row.high)}`, `安値 ${number(row.low)}`, `出来高 ${number(row.volume, 0)}`] : []; } } },
        },
        scales: {
          x: { ticks: { color: "#806b79", maxTicksLimit: 10, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.10)" } },
          y: { position: "left", ticks: { color: "#806b79" }, grid: { color: "rgba(170,120,150,.13)" } },
          yVolume: { position: "right", display: false, min: 0, max: Math.max(...visible.map((row) => finite(row.volume) || 0), 1) * 4 },
        },
      },
    });
  }

  function renderOscillator() {
    const visible = visibleRows(); const labels = visible.map((row) => row.date); const mode = els.oscillatorSelect.value;
    const reference = (value) => visible.map(() => value);
    let datasets = []; let min; let max;
    if (mode === "macd") {
      datasets = [
        { type: "bar", label: "ヒストグラム", data: visible.map((row) => row.macdHist), backgroundColor: visible.map((row) => (finite(row.macdHist) || 0) >= 0 ? "rgba(214,87,150,.35)" : "rgba(75,145,180,.35)"), borderWidth: 0 },
        lineDataset("MACD", visible.map((row) => row.macd), "#d65796", { borderWidth: 1.8 }),
        lineDataset("シグナル", visible.map((row) => row.macdSignal), "#7465bd", { borderWidth: 1.5 }),
      ];
    } else if (mode === "stochastic") {
      datasets = [lineDataset("%K", visible.map((row) => row.stochasticK), "#d65796"), lineDataset("%D", visible.map((row) => row.stochasticD), "#7465bd"), lineDataset("80", reference(80), "rgba(214,87,150,.35)", { borderWidth: 1, borderDash: [4, 4] }), lineDataset("20", reference(20), "rgba(75,145,180,.35)", { borderWidth: 1, borderDash: [4, 4] })];
      min = 0; max = 100;
    } else if (mode === "atr") {
      datasets = [lineDataset("ATR%", visible.map((row) => row.atrPct), "#8b68c8", { borderWidth: 1.8, fill: true, backgroundColor: "rgba(139,104,200,.10)" })]; min = 0;
    } else {
      datasets = [lineDataset("日足RSI14", visible.map((row) => row.dailyRsi14), "#d65796"), lineDataset("70", reference(70), "rgba(214,87,150,.35)", { borderWidth: 1, borderDash: [4, 4] }), lineDataset("30", reference(30), "rgba(75,145,180,.35)", { borderWidth: 1, borderDash: [4, 4] })];
      min = 0; max = 100;
    }
    if (state.oscillatorChart) state.oscillatorChart.destroy();
    state.oscillatorChart = new Chart(els.oscillatorChart, {
      type: "line", data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#654f60", usePointStyle: true, boxWidth: 9 } } }, scales: { x: { ticks: { color: "#806b79", maxTicksLimit: 10, maxRotation: 0 }, grid: { color: "rgba(170,120,150,.08)" } }, y: { min, max, ticks: { color: "#806b79" }, grid: { color: "rgba(170,120,150,.12)" } } } },
    });
  }

  function renderHistory() {
    els.tradeHistoryBody.innerHTML = state.trades.map((trade) => `<tr class="${trade.type === "BUY" ? "buy-row" : "sell-row"}"><td>${trade.date}</td><td><strong>${trade.label}</strong> ${trade.type === "BUY" ? "購入" : "売却"}</td><td class="num">${number(trade.price)}</td><td class="num">${trade.shares.toLocaleString("ja-JP")}</td><td class="num">${trade.type === "BUY" ? `-${trade.slots}` : `+${trade.slots}`}</td><td class="num ${performanceClass(trade.realized)}">${trade.type === "SELL" ? yen(trade.realized) : "—"}</td><td>${trade.memo || "—"}</td></tr>`).join("") || '<tr><td colspan="7" class="empty-state">売買すると、ここに履歴が表示されます。</td></tr>';
  }

  function renderSlots() {
    const used = MAX_SLOTS - state.availableSlots;
    els.buyStageStatus.textContent = `${used} / ${MAX_SLOTS}`; els.remainingBuys.textContent = `${state.availableSlots}枠`;
    els.slotDots.innerHTML = Array.from({ length: MAX_SLOTS }, (_, index) => `<span class="${index < used ? "used" : ""}">${index + 1}</span>`).join("");
  }

  function renderAccount() {
    const row = currentRow(); if (!row) return;
    const metrics = ReplayEngine.metrics(state.account, row.close, state.initialCapital); updatePeak(metrics.totalValue);
    els.currentDate.textContent = row.date; els.currentPrice.textContent = yen(row.close); els.cashValue.textContent = yen(state.account.cash);
    els.shareValue.textContent = `${state.account.shares.toLocaleString("ja-JP")}株`; els.averagePrice.textContent = yen(metrics.averagePrice);
    els.averageCostNote.textContent = `手数料込 ${yen(metrics.averageCost)}`; els.averageCost.textContent = yen(metrics.averageCost);
    els.unrealizedValue.textContent = `${yen(metrics.unrealized)}（${percent(metrics.unrealizedPct)}）`; els.unrealizedValue.className = performanceClass(metrics.unrealized);
    els.realizedValue.textContent = yen(state.account.realized); els.realizedValue.className = performanceClass(state.account.realized);
    els.totalValue.textContent = yen(metrics.totalValue); els.totalReturn.textContent = percent(metrics.totalReturn); els.totalReturn.className = performanceClass(metrics.totalReturn);
    els.totalProfit.textContent = yen(metrics.totalProfit); els.totalProfit.className = performanceClass(metrics.totalProfit); els.marketValue.textContent = yen(metrics.marketValue);
    els.peakValue.textContent = yen(state.peakValue); els.maxDrawdown.textContent = percent(state.maxDrawdown); els.maxDrawdown.className = performanceClass(state.maxDrawdown);
    els.feeValue.textContent = yen(state.account.fees); renderSlots();
  }

  function renderRiskPlan() {
    const row = currentRow(); if (!row) return;
    els.plannedEntryPrice.value = Number(row.close).toFixed(2);
    const plan = currentPlan();
    els.positionBudget.textContent = yen(plan.allocationBudget); els.allocationMaxShares.textContent = `${plan.maxByAllocation.toLocaleString("ja-JP")}株`;
    els.riskBudget.textContent = yen(plan.riskBudget); els.riskMaxShares.textContent = plan.maxByRisk === null ? "損切り未設定" : `${plan.maxByRisk.toLocaleString("ja-JP")}株`;
    els.recommendedShares.textContent = `${plan.recommendedShares.toLocaleString("ja-JP")}株`; els.slotShares.textContent = plan.slotShares > 0 ? `${plan.slotShares.toLocaleString("ja-JP")}株` : "8分割不可";
    els.plannedLoss.textContent = yen(plan.plannedLoss); els.plannedReward.textContent = yen(plan.plannedReward);
    els.riskRewardBadge.textContent = plan.riskReward === null ? "R:R —" : `R:R 1 : ${number(plan.riskReward, 2)}`;
    els.riskRewardBadge.className = `rr-badge ${plan.riskReward !== null && plan.riskReward >= 2 ? "good" : ""}`;
    const remainingBudget = Math.max(0, plan.allocationBudget - (state.account.costBasis || 0));
    const available = Math.min(ReplayEngine.maxAffordableShares(state.account.cash, row.close, state.lotSize, state.costBps), ReplayEngine.maxAffordableShares(remainingBudget, row.close, state.lotSize, state.costBps));
    els.buyAssist.textContent = `現在の空き予算で最大 ${available.toLocaleString("ja-JP")}株。1枠 ${plan.slotShares.toLocaleString("ja-JP")}株。`;
    if (plan.riskPerShare === null) els.riskPlanNotice.textContent = "損切り価格を現在値より低く設定すると、許容損失から上限株数を計算します。";
    else if (plan.slotShares <= 0) els.riskPlanNotice.textContent = "現在の資産・売買単位では8等分できません。1株単位へ変更するか、配分割合を見直してください。";
    else {
      const stopPct = plan.riskPerShare / row.close * 100; const targetPct = plan.rewardPerShare === null ? null : plan.rewardPerShare / row.close * 100;
      els.riskPlanNotice.textContent = `損切り幅 ${number(stopPct)}%${targetPct === null ? "" : `、目標幅 ${number(targetPct)}%`}。推奨最大株数は配分上限とリスク上限の小さい方です。`;
    }
  }

  function renderIndicators() {
    const row = currentRow(); if (!row) return;
    els.indicatorRsi.textContent = `日足RSI14 ${number(row.dailyRsi14)} / 月足RSI5 ${number(row.rsi5)}`;
    els.indicatorSma.textContent = `SMA25 ${number(row.sma25)} / 75 ${number(row.sma75)} / 200 ${number(row.sma200)}`;
    const volumeRatio = row.volumeSma20 ? row.volume / row.volumeSma20 : null;
    els.indicatorVolume.textContent = `出来高 ${number(row.volume, 0)} / 20日比 ${volumeRatio === null ? "—" : `${number(volumeRatio)}倍`}`;
    els.dayProgress.textContent = `開始から ${state.cursor - state.startIndex + 1}営業日目。未来の${Math.max(0, state.rows.length - state.cursor - 1)}営業日は非表示です。`;
  }

  function renderButtons() {
    const noShares = state.account.shares <= 0; const noFuture = state.cursor >= state.rows.length - 1; const noSlots = state.availableSlots <= 0; const plan = currentPlan();
    els.buyChunkButton.disabled = state.ended || noSlots || plan.slotShares <= 0; els.buyCustomButton.disabled = state.ended || noSlots;
    [els.sellQuarterButton, els.sellHalfButton, els.sellAllButton].forEach((button) => { button.disabled = state.ended || noShares; });
    [els.stepOneButton, els.stepFiveButton, els.playButton].forEach((button) => { button.disabled = state.ended || noFuture; });
  }

  function render() { renderAccount(); renderRiskPlan(); renderIndicators(); renderChart(); renderOscillator(); renderHistory(); renderButtons(); }
  function orderMessage(message, error = false) { els.orderMessage.textContent = message; els.orderMessage.classList.toggle("negative", error); }
  function slotsForOrder(shares, price) { const plan = currentPlan(); const total = shares * price * (1 + state.costBps / 10000); return Math.max(1, Math.ceil(total / Math.max(plan.allocationBudget / MAX_SLOTS, 1))); }

  function buyShares(requestedShares, explicitSlots = null) {
    if (state.ended || state.availableSlots <= 0) return orderMessage("空きエントリー枠がありません。部分売却で枠を復活できます。", true);
    const row = currentRow(); const shares = ReplayEngine.roundToLot(requestedShares, state.lotSize);
    if (shares <= 0) return orderMessage("購入できる株数がありません。売買単位や資金を確認してください。", true);
    const plan = currentPlan(); const remainingBudget = Math.max(0, plan.allocationBudget - (state.account.costBasis || 0));
    const maxByBudget = ReplayEngine.maxAffordableShares(remainingBudget, row.close, state.lotSize, state.costBps);
    if (shares > maxByBudget) return orderMessage(`銘柄配分の上限を超えます。現在購入できるのは最大${maxByBudget.toLocaleString("ja-JP")}株です。`, true);
    const slots = explicitSlots || slotsForOrder(shares, row.close);
    if (slots > state.availableSlots) return orderMessage(`この注文には${slots}枠必要ですが、空きは${state.availableSlots}枠です。`, true);
    const result = ReplayEngine.applyBuy(state.account, shares, row.close, state.costBps); if (!result.ok) return orderMessage(result.error, true);
    state.account = result.account; state.availableSlots -= slots; state.buySequence += 1;
    const warning = plan.maxByRisk !== null && state.account.shares > plan.maxByRisk ? " 許容損失ベースの上限を超えています。" : "";
    state.trades.push({ date: row.date, type: "BUY", label: `B${state.buySequence}`, price: row.close, shares, slots, realized: null, memo: els.tradeMemo.value.trim() });
    els.tradeMemo.value = ""; orderMessage(`${shares.toLocaleString("ja-JP")}株を${yen(row.close)}で購入。${slots}枠を使用しました。${warning}`); render();
  }

  function buyChunk() { buyShares(currentPlan().slotShares, 1); }

  function sellRatio(ratio) {
    if (state.ended || state.account.shares <= 0) return orderMessage("売却できる保有株がありません。", true);
    const row = currentRow(); let shares;
    if (ratio >= 1) shares = state.account.shares;
    else { shares = ReplayEngine.roundToLot(Math.floor(state.account.shares * ratio), state.lotSize); if (shares <= 0) shares = Math.min(state.account.shares, state.lotSize); }
    const result = ReplayEngine.applySell(state.account, shares, row.close, state.costBps); if (!result.ok) return orderMessage(result.error, true);
    state.account = result.account;
    const requestedRestore = ratio >= 1 || state.account.shares === 0 ? MAX_SLOTS : ratio >= 0.5 ? 4 : 2;
    const before = state.availableSlots; state.availableSlots = state.account.shares === 0 ? MAX_SLOTS : ReplayEngine.restoreSlots(state.availableSlots, requestedRestore, MAX_SLOTS);
    const restored = state.availableSlots - before; const sellNumber = state.trades.filter((trade) => trade.type === "SELL").length + 1;
    state.trades.push({ date: row.date, type: "SELL", label: `S${sellNumber}`, price: row.close, shares, slots: restored, realized: result.realizedDelta, memo: els.tradeMemo.value.trim() });
    els.tradeMemo.value = ""; orderMessage(`${shares.toLocaleString("ja-JP")}株を売却。実現損益 ${yen(result.realizedDelta)}。エントリー枠が${restored}枠復活しました。`); render();
  }

  function stopPlayback() { if (state.timer) clearInterval(state.timer); state.timer = null; els.playButton.textContent = "▶ 再生"; }
  function advance(days = 1) { if (state.ended) return; state.cursor = Math.min(state.rows.length - 1, state.cursor + days); if (state.cursor >= state.rows.length - 1) { stopPlayback(); orderMessage("利用できる最新日まで到達しました。結果を確定してください。"); } render(); }
  function togglePlayback() { if (state.timer) { stopPlayback(); return; } const speed = Number(els.playSpeed.value) || 500; els.playButton.textContent = "⏸ 一時停止"; state.timer = setInterval(() => { if (state.cursor >= state.rows.length - 1 || state.ended) stopPlayback(); else advance(1); }, speed); }

  function finishSession() {
    stopPlayback(); state.ended = true; const row = currentRow(); const metrics = ReplayEngine.metrics(state.account, row.close, state.initialCapital); const plan = currentPlan();
    els.sessionState.textContent = "練習終了"; els.finishSummary.hidden = false;
    els.finishSummary.innerHTML = `<h3>今回の結果</h3><p><strong class="${performanceClass(metrics.totalProfit)}">${yen(metrics.totalProfit)}（${percent(metrics.totalReturn)}）</strong></p><p>購入 ${state.trades.filter((trade) => trade.type === "BUY").length}回、売却 ${state.trades.filter((trade) => trade.type === "SELL").length}回、手数料 ${yen(state.account.fees)}。終了時に${state.account.shares.toLocaleString("ja-JP")}株を保有しています。</p><p>最終時点の計画は推奨最大 ${plan.recommendedShares.toLocaleString("ja-JP")}株、${plan.riskReward === null ? "R:R未設定" : `R:R 1:${number(plan.riskReward)}`}でした。</p>`;
    renderButtons(); els.finishSummary.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function chooseStartIndex() {
    const minIndex = Math.min(220, Math.max(0, state.rows.length - 60)); const maxIndex = Math.max(minIndex, state.rows.length - 45);
    if (els.startMode.value === "date" && els.startDate.value) { const found = state.rows.findIndex((row) => row.date >= els.startDate.value); return Math.min(maxIndex, Math.max(minIndex, found >= 0 ? found : minIndex)); }
    return minIndex + Math.floor(Math.random() * (maxIndex - minIndex + 1));
  }

  function resetRiskPrices() { const row = currentRow(); if (!row) return; els.stopPrice.value = (row.close * 0.95).toFixed(2); els.targetPrice.value = (row.close * 1.10).toFixed(2); render(); }

  function startSession() {
    if (state.rows.length < 60) return orderMessage("練習に必要な日足データが不足しています。", true);
    const assets = Number(els.totalAssets.value); const allocation = Number(els.allocationPct.value); const risk = Number(els.riskPct.value);
    if (!Number.isFinite(assets) || assets < 100000) return orderMessage("保有資産額を10万円以上で入力してください。", true);
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) return orderMessage("銘柄への配分割合は1〜100%で入力してください。", true);
    if (!Number.isFinite(risk) || risk <= 0 || risk > 20) return orderMessage("許容損失は0.1〜20%で入力してください。", true);
    stopPlayback(); state.initialCapital = assets; state.allocationPct = allocation; state.riskPct = risk; state.lotSize = Number(els.lotSize.value); state.costBps = Number(els.costBps.value);
    state.startIndex = chooseStartIndex(); state.cursor = state.startIndex; state.account = { cash: state.initialCapital, shares: 0, costBasis: 0, grossBasis: 0, realized: 0, fees: 0 };
    state.availableSlots = MAX_SLOTS; state.buySequence = 0; state.trades = []; state.peakValue = state.initialCapital; state.maxDrawdown = 0; state.ended = false;
    els.setupPanel.hidden = true; els.practiceArea.hidden = false; els.finishSummary.hidden = true; els.sessionState.textContent = "練習中";
    const row = currentRow(); els.stopPrice.value = (row.close * 0.95).toFixed(2); els.targetPrice.value = (row.close * 1.10).toFixed(2);
    orderMessage("資金管理プランを確認して、最初の判断をしてください。"); render();
  }

  function resetToSetup() { stopPlayback(); els.practiceArea.hidden = true; els.setupPanel.hidden = false; els.sessionState.textContent = "条件設定"; window.scrollTo({ top: 0, behavior: "smooth" }); }

  function bindEvents() {
    els.startMode.addEventListener("change", () => { els.startDate.disabled = els.startMode.value !== "date"; });
    els.startSessionButton.addEventListener("click", startSession); els.newSessionButton.addEventListener("click", resetToSetup);
    els.stepOneButton.addEventListener("click", () => advance(1)); els.stepFiveButton.addEventListener("click", () => advance(5)); els.playButton.addEventListener("click", togglePlayback); els.finishButton.addEventListener("click", finishSession);
    els.buyChunkButton.addEventListener("click", buyChunk); els.buyCustomButton.addEventListener("click", () => buyShares(Number(els.customBuyShares.value)));
    els.sellQuarterButton.addEventListener("click", () => sellRatio(0.25)); els.sellHalfButton.addEventListener("click", () => sellRatio(0.5)); els.sellAllButton.addEventListener("click", () => sellRatio(1));
    els.resetRiskPrices.addEventListener("click", resetRiskPrices);
    [els.stopPrice, els.targetPrice].forEach((element) => element.addEventListener("input", () => { if (!els.practiceArea.hidden) render(); }));
    [els.showSma, els.showEma, els.showBollinger, els.showAverage, els.showRiskLines].forEach((element) => element.addEventListener("change", renderChart));
    els.oscillatorSelect.addEventListener("change", renderOscillator);
  }

  async function init() {
    ids.forEach((id) => { els[id] = $(id); }); bindEvents(); state.code = queryCode();
    if (!state.code) { els.setupNotice.textContent = "URLに銘柄コードがありません。銘柄詳細から開いてください。"; els.startSessionButton.disabled = true; return; }
    try {
      state.payload = await fetchJson(`data/charts/${encodeURIComponent(state.code)}.json`);
      state.rows = ReplayEngine.enrichRows((state.payload.daily || []).filter((row) => finite(row.close) !== null));
      els.replayTitle.textContent = `${state.payload.name}（${state.payload.code}）売買練習🌸`;
      els.replaySubtitle.textContent = `${state.rows[0]?.date || "—"}〜${state.rows.at(-1)?.date || "—"}の日足から練習できます。未来の足は開始後に隠れます。`;
      els.detailBackLink.href = `detail.html?code=${encodeURIComponent(state.code)}`;
      const minIndex = Math.min(220, Math.max(0, state.rows.length - 60)); const maxIndex = Math.max(minIndex, state.rows.length - 45);
      els.startDate.min = state.rows[minIndex]?.date || ""; els.startDate.max = state.rows[maxIndex]?.date || ""; els.startDate.value = state.rows[minIndex]?.date || ""; els.sessionState.textContent = "条件設定";
    } catch (error) { els.setupNotice.textContent = `データを読み込めませんでした: ${error.message}`; els.startSessionButton.disabled = true; }
  }

  document.addEventListener("DOMContentLoaded", init);
}
