(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReplayGuidedCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function roundToLot(value, lotSize) {
    const number = finite(value);
    const lot = Math.max(1, Math.floor(finite(lotSize) || 1));
    if (number === null || number <= 0) return 0;
    return Math.floor(number / lot) * lot;
  }

  function recentLowHint(rows, cursor, lookback = 20) {
    const source = Array.isArray(rows) ? rows : [];
    if (!source.length) return null;
    const end = clamp(Math.floor(finite(cursor) || 0), 0, source.length - 1);
    const begin = Math.max(0, end - Math.max(5, Math.floor(lookback)) + 1);
    const windowRows = source.slice(begin, end + 1);
    const currentClose = finite(source[end]?.close);
    const pivots = [];

    for (let index = 1; index < windowRows.length - 1; index += 1) {
      const previous = finite(windowRows[index - 1]?.low);
      const current = finite(windowRows[index]?.low);
      const next = finite(windowRows[index + 1]?.low);
      if (current === null || previous === null || next === null) continue;
      if (current <= previous && current <= next && (currentClose === null || current < currentClose)) {
        pivots.push({ row: windowRows[index], price: current, sourceIndex: begin + index, method: "pivot" });
      }
    }

    let selected = pivots.at(-1) || null;
    if (!selected) {
      windowRows.forEach((row, index) => {
        const low = finite(row?.low);
        if (low === null || (currentClose !== null && low >= currentClose)) return;
        if (!selected || low < selected.price) selected = { row, price: low, sourceIndex: begin + index, method: "minimum" };
      });
    }
    if (!selected) return null;

    return {
      price: selected.price,
      date: selected.row?.date || "",
      sourceIndex: selected.sourceIndex,
      method: selected.method,
      distancePct: currentClose && currentClose > 0 ? (selected.price / currentClose - 1) * 100 : null,
    };
  }

  function targetPrice(entry, stop, ratio) {
    const e = finite(entry);
    const s = finite(stop);
    const r = finite(ratio);
    if (e === null || s === null || r === null || s >= e || r <= 0) return null;
    return e + (e - s) * r;
  }

  function rewardRatio(entry, stop, target) {
    const e = finite(entry);
    const s = finite(stop);
    const t = finite(target);
    if (e === null || s === null || t === null || s >= e) return null;
    return (t - e) / (e - s);
  }

  function riskSizing(input) {
    const assets = Math.max(0, finite(input?.assets) || 0);
    const riskPct = Math.max(0, finite(input?.riskPct) || 0);
    const allocationPct = Math.max(0, finite(input?.allocationPct) || 0);
    const entry = finite(input?.entry);
    const stop = finite(input?.stop);
    const cash = Math.max(0, finite(input?.cash) ?? assets);
    const lotSize = Math.max(1, Math.floor(finite(input?.lotSize) || 1));
    const costRate = Math.max(0, finite(input?.costBps) || 0) / 10000;
    const currentShares = Math.max(0, Math.floor(finite(input?.currentShares) || 0));
    const currentAveragePrice = finite(input?.currentAveragePrice);

    const riskBudget = assets * riskPct / 100;
    const allocationBudget = assets * allocationPct / 100;
    if (entry === null || stop === null || stop >= entry || entry <= 0) {
      return {
        riskBudget,
        allocationBudget,
        riskPerShare: null,
        currentRisk: 0,
        remainingRisk: riskBudget,
        maxByRisk: 0,
        maxByAllocation: 0,
        maxByCash: 0,
        recommendedShares: 0,
        plannedLoss: 0,
      };
    }

    const riskPerShare = entry - stop;
    const currentRisk = currentShares > 0 && currentAveragePrice !== null
      ? Math.max(0, currentAveragePrice - stop) * currentShares
      : 0;
    const remainingRisk = Math.max(0, riskBudget - currentRisk);
    const currentCost = currentShares > 0 && currentAveragePrice !== null ? currentAveragePrice * currentShares : 0;
    const remainingAllocation = Math.max(0, allocationBudget - currentCost);
    const unitCost = entry * (1 + costRate);
    const maxByRisk = roundToLot(remainingRisk / riskPerShare, lotSize);
    const maxByAllocation = roundToLot(remainingAllocation / unitCost, lotSize);
    const maxByCash = roundToLot(cash / unitCost, lotSize);
    const recommendedShares = Math.max(0, Math.min(maxByRisk, maxByAllocation, maxByCash));

    return {
      riskBudget,
      allocationBudget,
      riskPerShare,
      currentRisk,
      remainingRisk,
      maxByRisk,
      maxByAllocation,
      maxByCash,
      recommendedShares,
      plannedLoss: recommendedShares * riskPerShare,
    };
  }

  function trancheShares(totalShares, splitCount, lotSize) {
    const total = Math.max(0, Math.floor(finite(totalShares) || 0));
    const splits = [1, 2, 4].includes(Number(splitCount)) ? Number(splitCount) : 1;
    const lot = Math.max(1, Math.floor(finite(lotSize) || 1));
    if (!total) return 0;
    if (splits === 1) return roundToLot(total, lot);
    return Math.max(lot, roundToLot(total / splits, lot));
  }

  function priceProgress(current, entry, stop, target) {
    const c = finite(current);
    const e = finite(entry);
    const s = finite(stop);
    const t = finite(target);
    if ([c, e, s, t].some((value) => value === null) || s >= e || t <= e) return null;
    return {
      toStop: clamp((c - s) / (e - s), 0, 2),
      toTarget: clamp((t - c) / (t - e), -1, 2),
      unrealizedR: (c - e) / (e - s),
    };
  }

  function coachMessage(input) {
    const daysHeld = Math.max(0, Math.floor(finite(input?.daysHeld) || 0));
    const progress = priceProgress(input?.current, input?.entry, input?.stop, input?.target);
    const lastKey = String(input?.lastKey || "");
    const make = (key, character, text) => key === lastKey ? null : { key, character, text };

    if (daysHeld === 0) return make("entry", "lumo", "エントリー完了！ここからは当てるゲームじゃなくて、決めたルールを守る練習だよ✨");
    if (progress && progress.toStop <= 0.3) return make("near-stop", "aile", "損切りが近づいてるよ。不安でも、損切り価格を下へ動かさないようにしよう。");
    if (progress && progress.toTarget <= 0.3) return make("near-target", "aile", "利確位置が近づいてるよ。欲張るか怖がるかじゃなくて、最初の計画を思い出そう。");
    if (progress && progress.unrealizedR >= 0.5) return make("profit", "cosmos", "利益が出ると早く売りたくなることもあるよ。最初に決めた利確理由をもう一度確認しよう🌸");
    if (daysHeld > 0 && daysHeld % 5 === 0) return make(`wait-${daysHeld}`, "lumo", "動かない日も立派な相場だよ！何もしない判断も、取引のひとつ✨");
    if (daysHeld > 0 && daysHeld % 3 === 0) return make(`check-${daysHeld}`, "cosmos", "価格だけじゃなくて、最初の想定がまだ崩れていないかを確認しよう🌸");
    return null;
  }

  function complianceScore(checks) {
    const entries = Object.entries(checks || {});
    const achieved = entries.filter(([, value]) => Boolean(value)).length;
    return { achieved, total: entries.length, ratio: entries.length ? achieved / entries.length : 0 };
  }

  return {
    finite,
    clamp,
    roundToLot,
    recentLowHint,
    targetPrice,
    rewardRatio,
    riskSizing,
    trancheShares,
    priceProgress,
    coachMessage,
    complianceScore,
  };
});
