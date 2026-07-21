(function (root) {
  "use strict";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeStages(value, fallback = 3) {
    const parsed = Math.round(finite(value) ?? fallback);
    return clamp(parsed, 1, 8);
  }

  function normalizeLot(value) {
    return Math.max(1, Math.floor(finite(value) || 1));
  }

  function roundToLot(value, lotSize = 1) {
    const lot = normalizeLot(lotSize);
    return Math.floor(Math.max(0, finite(value) || 0) / lot) * lot;
  }

  function normalizePrices(values, stop) {
    const stopPrice = finite(stop);
    return (Array.isArray(values) ? values : [])
      .map(finite)
      .filter((price) => price !== null && price > 0 && (stopPrice === null || price > stopPrice));
  }

  function distributeLots(totalShares, stages, lotSize = 1) {
    const stageCount = normalizeStages(stages, 1);
    const lot = normalizeLot(lotSize);
    const totalLots = Math.floor(Math.max(0, finite(totalShares) || 0) / lot);
    const baseLots = Math.floor(totalLots / stageCount);
    let remainder = totalLots % stageCount;
    const quantities = Array(stageCount).fill(baseLots * lot);
    // Extra lots are placed on the deeper/lower entry levels. This keeps the
    // first (usually highest) entry from carrying more risk than the later ones.
    for (let index = stageCount - 1; index >= 0 && remainder > 0; index -= 1) {
      quantities[index] += lot;
      remainder -= 1;
    }
    return quantities;
  }

  function ladderTotals(prices, quantities, stop, costBps = 0) {
    const stopPrice = finite(stop);
    const feeRate = Math.max(0, finite(costBps) || 0) / 10000;
    let totalShares = 0;
    let gross = 0;
    let fees = 0;
    let plannedLoss = 0;
    prices.forEach((price, index) => {
      const shares = Math.max(0, Math.floor(finite(quantities[index]) || 0));
      totalShares += shares;
      gross += shares * price;
      fees += shares * price * feeRate;
      if (stopPrice !== null && price > stopPrice) plannedLoss += shares * (price - stopPrice);
    });
    return {
      totalShares,
      gross,
      fees,
      capitalUsed: gross + fees,
      plannedLoss,
      averageEntry: totalShares > 0 ? gross / totalShares : null,
    };
  }

  function buildEntryLadder({
    assets,
    allocationPct,
    riskPct,
    prices,
    stop,
    lotSize = 1,
    costBps = 0,
  }) {
    const capital = Math.max(0, finite(assets) || 0);
    const allocationBudget = capital * Math.max(0, finite(allocationPct) || 0) / 100;
    const riskBudget = capital * Math.max(0, finite(riskPct) || 0) / 100;
    const stopPrice = finite(stop);
    const normalized = normalizePrices(prices, stopPrice);
    const stages = normalized.length;
    const lot = normalizeLot(lotSize);

    if (!stages || stopPrice === null) {
      return {
        valid: false,
        error: "すべての買値を損切り価格より上に設定してください。",
        allocationBudget,
        riskBudget,
        stages,
        tranches: [],
        totalShares: 0,
        averageEntry: null,
        plannedLoss: 0,
        capitalUsed: 0,
        maxByAllocation: 0,
        maxByRisk: 0,
      };
    }

    const simpleAverage = normalized.reduce((sum, price) => sum + price, 0) / stages;
    const feeRate = Math.max(0, finite(costBps) || 0) / 10000;
    const averageRisk = simpleAverage - stopPrice;
    if (averageRisk <= 0) {
      return {
        valid: false,
        error: "予定平均買値より下に損切りを置いてください。",
        allocationBudget,
        riskBudget,
        stages,
        tranches: [],
        totalShares: 0,
        averageEntry: simpleAverage,
        plannedLoss: 0,
        capitalUsed: 0,
        maxByAllocation: 0,
        maxByRisk: 0,
      };
    }

    const maxByAllocation = roundToLot(allocationBudget / (simpleAverage * (1 + feeRate)), lot);
    const maxByRisk = roundToLot(riskBudget / averageRisk, lot);
    let totalShares = Math.min(maxByAllocation, maxByRisk);
    let quantities = distributeLots(totalShares, stages, lot);
    let totals = ladderTotals(normalized, quantities, stopPrice, costBps);

    // Rounding and unequal prices can slightly exceed the budget. Remove one
    // lot at a time from the highest-risk entry until both limits are respected.
    let guard = 0;
    while (
      totals.totalShares > 0
      && (totals.capitalUsed > allocationBudget + 0.01 || totals.plannedLoss > riskBudget + 0.01)
      && guard < 100000
    ) {
      let candidate = -1;
      let largestRisk = -Infinity;
      normalized.forEach((price, index) => {
        if (quantities[index] < lot) return;
        const risk = price - stopPrice;
        if (risk > largestRisk) {
          largestRisk = risk;
          candidate = index;
        }
      });
      if (candidate < 0) break;
      quantities[candidate] -= lot;
      totals = ladderTotals(normalized, quantities, stopPrice, costBps);
      guard += 1;
    }

    totalShares = totals.totalShares;
    const tranches = normalized.map((price, index) => ({
      index,
      label: `E${index + 1}`,
      price,
      shares: quantities[index],
      amount: quantities[index] * price,
      risk: quantities[index] * (price - stopPrice),
      filled: false,
      cancelled: false,
    }));

    return {
      valid: totalShares > 0,
      error: totalShares > 0 ? null : "設定した売買単位では購入可能な株数がありません。",
      allocationBudget,
      riskBudget,
      stages,
      stop: stopPrice,
      tranches,
      totalShares,
      averageEntry: totals.averageEntry,
      plannedLoss: totals.plannedLoss,
      capitalUsed: totals.capitalUsed,
      maxByAllocation,
      maxByRisk,
      slotShares: roundToLot(totalShares / stages, lot),
    };
  }

  function restoreSlots({ maxSlots, availableSlots, beforeShares, afterShares }) {
    const maximum = normalizeStages(maxSlots, 1);
    const current = clamp(Math.round(finite(availableSlots) || 0), 0, maximum);
    const before = Math.max(0, finite(beforeShares) || 0);
    const after = Math.max(0, finite(afterShares) || 0);
    if (after <= 0) return maximum;
    if (before <= 0 || after >= before) return current;
    const soldRatio = (before - after) / before;
    const restored = Math.max(1, Math.round(maximum * soldRatio));
    return Math.min(maximum, current + restored);
  }

  function limitBuyFillPrice(row, limitPrice) {
    const limit = finite(limitPrice);
    const open = finite(row?.open);
    const low = finite(row?.low);
    const high = finite(row?.high);
    if (limit === null || low === null || high === null) return null;
    if (open !== null && open <= limit) return open;
    if (low <= limit && limit <= high) return limit;
    return null;
  }

  const api = {
    finite,
    normalizeStages,
    roundToLot,
    normalizePrices,
    distributeLots,
    buildEntryLadder,
    restoreSlots,
    limitBuyFillPrice,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReplayRiskLadder = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
