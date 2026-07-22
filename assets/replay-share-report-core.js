(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReplayShareReportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const X_MAX_WEIGHTED_LENGTH = 280;
  const X_URL_WEIGHT = 23;
  const DEFAULT_X_HANDLE = "@_cosmos_note";
  const URL_PATTERN = /https?:\/\/[^\s]+/giu;

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

  function shortDate(value) {
    const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!match) return String(value || "—");
    return `${Number(match[1])}/${Number(match[2])}`;
  }

  function riskScore(totalReturn, maxDrawdown) {
    const gain = finite(totalReturn) || 0;
    const drawdown = Math.abs(finite(maxDrawdown) || 0);
    return clamp(Math.round(70 + gain - drawdown * 1.5), 0, 100);
  }

  function normalizeTradeMemo(trades) {
    return [...(Array.isArray(trades) ? trades : [])]
      .reverse()
      .map((trade) => String(trade?.memo || "").trim())
      .find(Boolean) || "";
  }

  function normalizeHandles(value) {
    const unique = new Set();
    String(value || "")
      .split(/[\s,、]+/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const handle = item.startsWith("@") ? item : `@${item}`;
        if (/^@[A-Za-z0-9_]{1,15}$/u.test(handle)) unique.add(handle);
      });
    return [...unique];
  }

  function characterWeight(character) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 4351) return 1;
    if (codePoint >= 8192 && codePoint <= 8205) return 1;
    if (codePoint >= 8208 && codePoint <= 8223) return 1;
    if (codePoint >= 8242 && codePoint <= 8247) return 1;
    return 2;
  }

  function plainWeightedLength(value) {
    return [...String(value || "")].reduce((sum, character) => sum + characterWeight(character), 0);
  }

  function xWeightedLength(value) {
    const text = String(value || "");
    let total = 0;
    let cursor = 0;
    URL_PATTERN.lastIndex = 0;
    let match = URL_PATTERN.exec(text);
    while (match) {
      total += plainWeightedLength(text.slice(cursor, match.index));
      total += X_URL_WEIGHT;
      cursor = match.index + match[0].length;
      match = URL_PATTERN.exec(text);
    }
    total += plainWeightedLength(text.slice(cursor));
    return total;
  }

  function aggregateTradeMarkers(trades) {
    const source = Array.isArray(trades) ? trades : [];
    const grouped = new Map();
    source.forEach((trade, index) => {
      const type = trade?.type === "SELL" ? "SELL" : trade?.type === "BUY" ? "BUY" : "";
      const date = String(trade?.date || "");
      const price = finite(trade?.price);
      if (!type || !date || price === null) return;
      const key = `${date}|${type}`;
      if (!grouped.has(key)) grouped.set(key, { date, type, prices: [], firstIndex: index });
      grouped.get(key).prices.push(price);
    });

    const markers = [...grouped.values()]
      .sort((left, right) => left.date.localeCompare(right.date) || left.firstIndex - right.firstIndex)
      .map((group) => ({
        date: group.date,
        type: group.type,
        price: group.prices.reduce((sum, price) => sum + price, 0) / group.prices.length,
        count: group.prices.length,
      }));

    const totals = {
      BUY: markers.filter((marker) => marker.type === "BUY").length,
      SELL: markers.filter((marker) => marker.type === "SELL").length,
    };
    const sequence = { BUY: 0, SELL: 0 };
    return markers.map((marker) => {
      sequence[marker.type] += 1;
      const base = marker.type === "BUY" ? "買" : "売";
      const order = totals[marker.type] > 1 ? sequence[marker.type] : "";
      const count = marker.count > 1 ? `×${marker.count}` : "";
      return { ...marker, sequence: sequence[marker.type], label: `${base}${order}${count}` };
    });
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
    const learning = normalizeTradeMemo(trades);

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
      learning,
      reportMessageLabel: learning ? "今回の学び" : "かぶたねでできること",
      reportMessage: learning || "未来を隠して、買い時・売り時を何度でも練習できます。",
      series,
      trades: trades.map((trade) => ({
        date: trade?.date || "",
        type: trade?.type || "",
        price: finite(trade?.price),
      })),
      tradeMarkers: aggregateTradeMarkers(trades),
      url: input?.url || "",
      generatedAt: input?.generatedAt || new Date().toISOString(),
    };
  }

  function compactSecurityName(snapshot, maxLength = 18) {
    const name = String(snapshot?.name || "銘柄");
    const compact = [...name].slice(0, maxLength).join("");
    const suffix = [...name].length > maxLength ? "…" : "";
    return `${compact}${suffix}${snapshot?.code ? `(${snapshot.code})` : ""}`;
  }

  function buildXPost(snapshot, options = {}) {
    const url = String(options.url || snapshot?.url || "").trim();
    const mentionLine = options.includeHandles
      ? normalizeHandles(options.handles || DEFAULT_X_HANDLE).join(" ")
      : "";
    const security = compactSecurityName(snapshot, 16);
    const period = `${shortDate(snapshot?.startDate)}-${shortDate(snapshot?.endDate)}`;
    const performance = `損益${formatPercent(snapshot?.totalReturn)} / DD${formatPercent(snapshot?.maxDrawdown)}`;
    const promotionalLines = [
      "未来を隠して、買い時・売り時を何度でも練習。",
      "買い・売り位置つきレポートも自動作成。無料で試せます👇",
    ];
    const candidates = [
      ["かぶたねで売買練習🌱", `${security} ${period}`, performance, ...promotionalLines, "#かぶたね"],
      ["かぶたねで売買練習🌱", security, performance, "未来を隠して売買を練習。結果画像も自動作成👇", "#かぶたね"],
      ["かぶたねで練習🌱", security, performance, "買い時・売り時を無料で練習できます👇", "#かぶたね"],
      ["かぶたね🌱", security, performance, "未来を隠して売買練習👇", "#かぶたね"],
    ];

    let selected = candidates.at(-1);
    for (const candidate of candidates) {
      const lines = mentionLine ? [...candidate, mentionLine] : candidate;
      const body = lines.join("\n");
      const combined = [body, url].filter(Boolean).join("\n");
      if (xWeightedLength(combined) <= X_MAX_WEIGHTED_LENGTH) {
        selected = candidate;
        break;
      }
    }
    const lines = mentionLine ? [...selected, mentionLine] : selected;
    const body = lines.join("\n");
    const combined = [body, url].filter(Boolean).join("\n");
    const weightedLength = xWeightedLength(combined);
    return {
      platform: "x",
      body,
      url,
      combined,
      weightedLength,
      remaining: X_MAX_WEIGHTED_LENGTH - weightedLength,
      valid: weightedLength <= X_MAX_WEIGHTED_LENGTH,
    };
  }

  function buildThreadsPost(snapshot, options = {}) {
    const url = String(options.url || snapshot?.url || "").trim();
    const mentionLine = options.includeHandles
      ? normalizeHandles(options.handles || DEFAULT_X_HANDLE).join(" ")
      : "";
    const code = snapshot?.code ? `（${snapshot.code}）` : "";
    const lines = [
      "かぶたねで、未来を隠した売買練習をしました🌱",
      "",
      `${snapshot?.name || "銘柄"}${code}`,
      `期間：${snapshot?.startDate || "—"}〜${snapshot?.endDate || "—"}`,
      `損益：${formatPercent(snapshot?.totalReturn)} / 最大DD：${formatPercent(snapshot?.maxDrawdown)}`,
      "",
      "どこで買い、どこで売ったかも画像で振り返れます。",
      "『銘柄は見つけた。でも買い方・売り方が分からない』",
      "そんな方は、無料のかぶたねで何度でも練習してみてください👇",
      "",
      "#かぶたね #未来の1株 #投資初心者",
    ];
    if (mentionLine) lines.push(mentionLine);
    const body = lines.join("\n");
    return { platform: "threads", body, url, combined: [body, url].filter(Boolean).join("\n") };
  }

  function buildNotePost(snapshot, options = {}) {
    const url = String(options.url || snapshot?.url || "").trim();
    const code = snapshot?.code ? `（${snapshot.code}）` : "";
    const lines = [
      "かぶたねで、未来を隠した売買練習をしてみました🌱",
      "",
      `銘柄：${snapshot?.name || "銘柄"}${code}`,
      `期間：${snapshot?.startDate || "—"}〜${snapshot?.endDate || "—"}`,
      `総損益率：${formatPercent(snapshot?.totalReturn)}`,
      `最大DD：${formatPercent(snapshot?.maxDrawdown)}`,
    ];
    if (snapshot?.learning) lines.push("", `今回の振り返り：${snapshot.learning}`);
    lines.push(
      "",
      "買った位置と売った位置が分かるレポート画像も、自動で作れるようになりました。",
      "『良さそうな銘柄は見つかった。でも、どこで買ってどこで売ればいいか分からない』",
      "そんなときは、実際のお金を動かす前に、無料のかぶたねで何度でも練習してみてください👇",
      "",
      "#かぶたね #未来の1株 #投資初心者",
    );
    const body = lines.join("\n");
    return { platform: "note", body, url, combined: [body, url].filter(Boolean).join("\n") };
  }

  function buildPlatformPost(snapshot, options = {}) {
    if (options.platform === "x") return buildXPost(snapshot, options);
    if (options.platform === "note") return buildNotePost(snapshot, options);
    return buildThreadsPost(snapshot, options);
  }

  function buildShareText(snapshot, options = {}) {
    return buildPlatformPost(snapshot, options).combined;
  }

  function fileName(snapshot, format) {
    const code = snapshot.code || "practice";
    const date = String(snapshot.endDate || "").replaceAll("-", "") || "report";
    const suffix = format === "square" ? "square" : "wide";
    return `kabutane-${code}-${date}-${suffix}.png`;
  }

  return {
    X_MAX_WEIGHTED_LENGTH,
    X_URL_WEIGHT,
    DEFAULT_X_HANDLE,
    finite,
    clamp,
    formatPercent,
    formatYen,
    shortDate,
    riskScore,
    normalizeTradeMemo,
    normalizeHandles,
    xWeightedLength,
    aggregateTradeMarkers,
    createSnapshot,
    buildXPost,
    buildThreadsPost,
    buildNotePost,
    buildPlatformPost,
    buildShareText,
    fileName,
  };
});
