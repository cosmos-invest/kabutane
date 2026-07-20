const $ = (id) => document.getElementById(id);
const state = {
  payload: null,
  rows: [],
  cursor: 0,
  startIndex: 0,
  code: "",
  chart: null,
  rsiChart: null,
  oscillatorChart: null,
  timer: null,
  ended: false,
  priceMode: "candle",
  toolMode: "entry",
  initialCapital: 3000000,
  allocationPct: 20,
  riskPct: 1,
  lotSize: 100,
  costBps: 10,
  availableSlots: ReplayPro.MAX_SLOTS,
  account: { cash: 3000000, shares: 0, costBasis: 0, grossBasis: 0, realized: 0, fees: 0 },
  trades: [],
  buySequence: 0,
  sellSequence: 0,
  peakValue: 3000000,
  maxDrawdown: 0,
  plan: {
    armed: false,
    entry: null,
    initialStop: null,
    activeStop: null,
    ratios: [2, 3, 4, 5],
    tpPrices: [],
    hitTargets: [false, false, false, false],
    autoSlots: 8,
    initialAutoShares: 0,
    entryDate: null,
    trailMode: "step",
  },
};

const ids = [
  "detailBackLink", "replayTitle", "replaySubtitle", "sessionState", "newSessionButton", "setupPanel",
  "startMode", "startDate", "totalAssets", "allocationPct", "riskPct", "lotSize", "costBps", "playSpeed",
  "startSessionButton", "setupNotice", "practiceArea", "currentDate", "currentPrice", "cashValue", "shareValue",
  "averagePrice", "unrealizedValue", "realizedValue", "totalValue", "entryPrice", "stopPrice", "autoEntrySlots",
  "trailMode", "armBracketButton", "cancelBracketButton", "riskRewardBadge", "positionBudget", "riskBudget",
  "recommendedShares", "slotShares", "plannedLoss", "activeStopValue", "rr1", "rr2", "rr3", "rr4",
  "tp1Price", "tp2Price", "tp3Price", "tp4Price", "riskPlanNotice", "setEntryTool", "setStopTool",
  "priceModeCandle", "priceModeHeikin", "showSma", "showEma", "showBollinger", "showSupertrend", "showHigh52",
  "showAverage", "showPlanLines", "oscillatorSelect", "replayChart", "monthlyRsiChart", "oscillatorChart",
  "dayProgress", "indicatorRsi", "indicatorTrend", "indicatorSetup", "stepOneButton", "stepFiveButton", "playButton",
  "finishButton", "buyStageStatus", "slotDots", "tradeMemo", "buyChunkButton", "customBuyShares", "buyCustomButton",
  "sellQuarterButton", "sellHalfButton", "sellAllButton", "orderMessage", "totalReturn", "totalProfit", "marketValue",
  "remainingBuys", "averageCost", "peakValue", "maxDrawdown", "feeValue", "finishSummary", "tradeHistoryBody",
];
const els = {};

function finite(value) { return ReplayPro.finite(value); }
function yen(value) { const number = finite(value); return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`; }
function formatNumber(value, digits = 2) { const number = finite(value); return number === null ? "—" : number.toLocaleString("ja-JP", { maximumFractionDigits: digits }); }
function percent(value) { const number = finite(value); return number === null ? "—" : `${number > 0 ? "+" : ""}${formatNumber(number)}%`; }
function performanceClass(value) { const number = finite(value); return number === null || number === 0 ? "" : number > 0 ? "positive" : "negative"; }
function queryCode() { return new URLSearchParams(window.location.search).get("code")?.trim() || ""; }
async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} の読込に失敗しました (${response.status})`);
  return response.json();
}
function currentRow() { return state.rows[state.cursor] || null; }
function visibleRows() {
  const begin = Math.max(0, Math.min(state.startIndex - 80, state.cursor - 139));
  return state.rows.slice(begin, state.cursor + 1);
}
function planRatios() {
  return ReplayPro.normalizeRatios([els.rr1.value, els.rr2.value, els.rr3.value, els.rr4.value]);
}
function recalculatePlan() {
  state.plan.entry = finite(els.entryPrice.value);
  state.plan.initialStop = finite(els.stopPrice.value);
  if (state.account.shares === 0 || !state.plan.entryDate) state.plan.activeStop = state.plan.initialStop;
  state.plan.ratios = planRatios();
  [els.rr1, els.rr2, els.rr3, els.rr4].forEach((input, index) => { input.value = state.plan.ratios[index].toFixed(1); });
  state.plan.tpPrices = ReplayPro.tpPrices(state.plan.entry, state.plan.initialStop, state.plan.ratios);
  state.plan.autoSlots = Number(els.autoEntrySlots.value) || 8;
  state.plan.trailMode = els.trailMode.value;
}
function currentPositionPlan() {
  recalculatePlan();
  return ReplayPro.positionPlan({
    assets: state.initialCapital,
    allocationPct: state.allocationPct,
    riskPct: state.riskPct,
    entry: state.plan.entry,
    stop: state.plan.initialStop,
    lotSize: state.lotSize,
    costBps: state.costBps,
  });
}

const candlePlugin = {
  id: "proCandles",
  beforeDatasetsDraw(chart, args, options) {
    const rows = options.rows || [];
    if (!rows.length || !chart.scales.x || !chart.scales.y) return;
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const sampleWidth = rows.length > 1 ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) : 8;
    const bodyWidth = Math.max(1, Math.min(9, sampleWidth * 0.68));
    ctx.save();
    rows.forEach((row, index) => {
      const open = finite(row.open); const high = finite(row.high); const low = finite(row.low); const close = finite(row.close);
      if ([open, high, low, close].some((value) => value === null)) return;
      const x = xScale.getPixelForValue(index);
      const rising = close >= open;
      const color = rising ? "#d65796" : "#4b91b4";
      const top = yScale.getPixelForValue(Math.max(open, close));
      const bottom = yScale.getPixelForValue(Math.min(open, close));
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yScale.getPixelForValue(high)); ctx.lineTo(x, yScale.getPixelForValue(low)); ctx.stroke();
      ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top));
    });
    ctx.restore();
  },
};

const tradeMarkerPlugin = {
  id: "proTrades",
  afterDatasetsDraw(chart, args, options) {
    const trades = options.trades || [];
    const labels = chart.data.labels || [];
    if (!trades.length) return;
    const ctx = chart.ctx;
    ctx.save(); ctx.font = "800 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    trades.forEach((trade) => {
      const index = labels.indexOf(trade.date);
      if (index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      const y = chart.scales.y.getPixelForValue(trade.price);
      ctx.fillStyle = trade.type === "BUY" ? "#a855c7" : trade.reason === "STOP" ? "#397fa4" : "#e34f7e";
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(trade.label, x, y);
    });
    ctx.restore();
  },
};

function lineDataset(label, data, color, extra = {}) {
  return { label, data, borderColor: color, backgroundColor: color, pointRadius: 0, borderWidth: 1.6, spanGaps: true, ...extra };
}

function planLineDatasets(visible) {
  if (!els.showPlanLines.checked) return [];
  const datasets = [];
  const constant = (value) => visible.map(() => value);
  if (state.plan.entry !== null) datasets.push(lineDataset("エントリー", constant(state.plan.entry), "#8c55c5", { borderWidth: 2, borderDash: [8, 4] }));
  if (state.plan.activeStop !== null) datasets.push(lineDataset("損切り/トレール", constant(state.plan.activeStop), "#347fa8", { borderWidth: 2, borderDash: [5, 4] }));
  state.plan.tpPrices.forEach((price, index) => {
    if (price !== null) datasets.push(lineDataset(`TP${index + 1} (${state.plan.ratios[index]}R)`, constant(price), ["#e983b1", "#e46e9f", "#db588d", "#ca3e78"][index], { borderWidth: 1.4, borderDash: [3, 3] }));
  });
  return datasets;
}
