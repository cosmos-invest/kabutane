(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ProvisionalMonthlyRsiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function rounded(value, digits = 2) {
    const number = finite(value);
    if (number === null) return null;
    const scale = 10 ** digits;
    return Math.round((number + Number.EPSILON) * scale) / scale;
  }

  function monthKey(date) {
    const match = String(date || "").match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : "";
  }

  function monthlyCloses(rows) {
    const months = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const month = monthKey(row?.date);
      const close = finite(row?.close);
      if (!month || close === null) return;
      const previous = months.get(month);
      if (!previous || String(row.date) >= previous.date) months.set(month, { month, date: String(row.date), close });
    });
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  function rma(values, length) {
    const output = Array(values.length).fill(null);
    const validIndexes = values.map((value, index) => finite(value) === null ? null : index).filter((value) => value !== null);
    if (validIndexes.length < length) return output;
    const seedIndexes = validIndexes.slice(0, length);
    const seedIndex = seedIndexes.at(-1);
    let previous = seedIndexes.reduce((sum, index) => sum + Number(values[index]), 0) / length;
    output[seedIndex] = previous;
    for (let index = seedIndex + 1; index < values.length; index += 1) {
      const current = finite(values[index]);
      if (current === null) {
        output[index] = previous;
        continue;
      }
      previous = (previous * (length - 1) + current) / length;
      output[index] = previous;
    }
    return output;
  }

  function tradingViewRsi(closes, length = 14) {
    const changes = closes.map((close, index) => index === 0 ? null : finite(close) - finite(closes[index - 1]));
    const gains = changes.map((change) => change === null ? null : Math.max(change, 0));
    const losses = changes.map((change) => change === null ? null : Math.max(-change, 0));
    const averageGain = rma(gains, length);
    const averageLoss = rma(losses, length);
    return closes.map((_, index) => {
      const gain = finite(averageGain[index]);
      const loss = finite(averageLoss[index]);
      if (gain === null || loss === null) return null;
      if (loss === 0 && gain > 0) return 100;
      if (gain === 0 && loss > 0) return 0;
      if (gain === 0 && loss === 0) return 50;
      const rs = gain / loss;
      return 100 - 100 / (1 + rs);
    });
  }

  function simpleMovingAverage(values, length) {
    return values.map((_, index) => {
      if (index + 1 < length) return null;
      const window = values.slice(index - length + 1, index + 1).map(finite);
      if (window.some((value) => value === null)) return null;
      return window.reduce((sum, value) => sum + value, 0) / length;
    });
  }

  function calculate(rows, record, priceDate) {
    const monthly = monthlyCloses(rows);
    if (!monthly.length) return null;
    const closes = monthly.map((row) => row.close);
    const rsi = tradingViewRsi(closes, 14);
    const movingAverage = simpleMovingAverage(rsi, 5);
    const lastIndex = monthly.length - 1;
    const currentRsi = finite(rsi[lastIndex]);
    const currentMa = finite(movingAverage[lastIndex]);
    if (currentRsi === null || currentMa === null) return null;

    const confirmedMonth = String(record?.signal_month || "");
    const currentMonth = monthly[lastIndex].month;
    if (confirmedMonth && currentMonth <= confirmedMonth) return null;

    const confirmedStatus = String(record?.status || "").toUpperCase();
    const confirmedActive = confirmedStatus === "NEW" || confirmedStatus === "CONTINUE";
    const provisionalActive = currentRsi > currentMa;
    let status;
    if (confirmedActive && !provisionalActive) status = "DC";
    else if (!confirmedActive && provisionalActive) status = "GC";
    else status = provisionalActive ? "CONTINUE" : "OUT";

    return {
      month: currentMonth,
      price_date: priceDate || monthly[lastIndex].date || null,
      monthly_rsi14: rounded(currentRsi),
      monthly_rsi_ma5: rounded(currentMa),
      spread: rounded(currentRsi - currentMa),
      active: provisionalActive,
      status,
      changed_from_confirmed: provisionalActive !== confirmedActive,
      confirmed_month: confirmedMonth || null,
      confirmed_status: confirmedStatus || null,
      source: "latest_daily_close",
      is_provisional: true,
    };
  }

  function normalizeStored(value) {
    if (!value || typeof value !== "object") return null;
    if (finite(value.monthly_rsi14) === null || finite(value.monthly_rsi_ma5) === null || !value.month) return null;
    return {
      ...value,
      monthly_rsi14: finite(value.monthly_rsi14),
      monthly_rsi_ma5: finite(value.monthly_rsi_ma5),
      spread: finite(value.spread),
      active: Boolean(value.active),
      is_provisional: true,
    };
  }

  function fromPayload(payload) {
    return normalizeStored(payload?.provisional_signal)
      || calculate(payload?.daily || [], payload?.record || {}, payload?.daily_price_date || payload?.daily?.at?.(-1)?.date);
  }

  function statusLabel(signal) {
    const status = String(signal?.status || "").toUpperCase();
    if (status === "DC") return "暫定DC";
    if (status === "GC") return "暫定GC";
    if (status === "CONTINUE") return "暫定継続";
    if (status === "OUT") return "暫定OUT継続";
    return "暫定値";
  }

  return {
    finite,
    rounded,
    monthKey,
    monthlyCloses,
    rma,
    tradingViewRsi,
    simpleMovingAverage,
    calculate,
    fromPayload,
    statusLabel,
  };
});
