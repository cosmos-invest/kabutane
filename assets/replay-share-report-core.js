(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReplayShareReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatPercent(value) {
    const number = finite(value);
    if (number === null) return "—";
    return `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
  }

  function formatYen(value) {
    const number = finite(value);
    return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`;
  }

  function riskScore(totalReturn, maxDrawdown) {
    const gain = finite(totalReturn) || 0;
    const drawdown = Math.abs(finite(maxDrawdown) || 0);
    return clamp(Math.round(70 + gain - drawdown * 1.5), 0, 100);
  }

  function normalizeTradeMemo(trades) {
    const memo = [...(Array.isArray(trades) ? trades : [])]
      .reverse()
      .map((trade) => String(trade?.memo || "").trim())
      .find(Boolean);
    return memo || "決めたルールと実際の行動を振り返りました。";
  }

  function createSnapshot(input) {
    const payload = input?.payload || {};
    const rows = Array.isArray(input?.rows) ? input.rows : [];
    const trades = Array.isArray(input?.trades) ? input.trades : [];
    const startIndex = clamp(Math.floor(finite(input?.startIndex) || 0), 0, Math.max(0, rows.length - 1));
    const cursor = clamp(Math.floor(finite(input?.cursor) || startIndex), startIndex, Math.max(startIndex, rows.length - 1));
    const plan = input?.plan || {};
    const metrics = input?.metrics || {};
    const account = input?.account || {};
    const buys = trades.filter((trade) => trade?.type === "BUY").length;
    const sells = trades.filter((trade) => trade?.type === "SELL").length;
    const series = rows.slice(startIndex, cursor + 1).map((row) => ({
      date: row?.date || "",
      close: finite(row?.close),
    })).filter((row) => row.close !== null);

    return {
      brand: "かぶたね",
      tagline: "株を買う前に、失敗を練習しよう。",
      name: payload.name || input?.name || "銘柄未設定",
      code: String(payload.code || input?.code || "").replace(/\.T$/i, ""),
      startDate: rows[startIndex]?.date || "—",
      endDate: rows[cursor]?.date || "—",
      totalReturn: finite(metrics.totalReturn),
      totalProfit: finite(metrics.totalProfit),
      maxDrawdown: finite(input?.maxDrawdown),
      currentValue: finite(metrics.totalValue),
      initialCapital: finite(input?.initialCapital),
      fees: finite(account.fees),
      shares: Math.max(0, Math.floor(finite(account.shares) || 0)),
      averagePrice: finite(metrics.averagePrice),
      plannedLoss: finite(plan?.ladder?.plannedLoss ?? input?.plannedLoss),
      stop: finite(plan.activeStop ?? plan.initialStop),
      ratios: Array.isArray(plan.ratios) ? plan.ratios.map(finite).filter((value) => value !== null) : [],
      buys,
      sells,
      score: riskScore(metrics.totalReturn, input?.maxDrawdown),
      learning: normalizeTradeMemo(trades),
      series,
      trades: trades.map((trade) => ({
        date: trade?.date || "",
        type: trade?.type || "",
        price: finite(trade?.price),
      })),
      url: input?.url || "",
      generatedAt: input?.generatedAt || new Date().toISOString(),
    };
  }

  function buildShareText(snapshot) {
    const code = snapshot.code ? `（${snapshot.code}）` : "";
    return [
      "かぶたねで、未来を隠した売買練習をしました🌱",
      "",
      `銘柄：${snapshot.name}${code}`,
      `期間：${snapshot.startDate}〜${snapshot.endDate}`,
      `総損益率：${formatPercent(snapshot.totalReturn)}`,
      `最大DD：${formatPercent(snapshot.maxDrawdown)}`,
      `今回の学び：${snapshot.learning}`,
      "",
      "利益を当てるだけでなく、決めたルールを守れたか振り返ります。",
      "#かぶたね #未来の1株 #投資初心者",
    ].join("\n");
  }

  function fileName(snapshot, format) {
    const code = snapshot.code || "practice";
    const date = String(snapshot.endDate || "").replaceAll("-", "") || "report";
    const suffix = format === "square" ? "square" : "wide";
    return `kabutane-${code}-${date}-${suffix}.png`;
  }

  return {
    finite,
    clamp,
    formatPercent,
    formatYen,
    riskScore,
    normalizeTradeMemo,
    createSnapshot,
    buildShareText,
    fileName,
  };
});
