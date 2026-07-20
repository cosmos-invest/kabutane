const ReplayPro = (() => {
  const MAX_SLOTS = 8;
  const TP_COUNT = 4;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundToLot(shares, lotSize = 1) {
    const lot = Math.max(1, Math.floor(finite(lotSize) || 1));
    return Math.floor(Math.max(0, finite(shares) || 0) / lot) * lot;
  }

  function sma(values, period) {
    const result = Array(values.length).fill(null);
    let sum = 0;
    let count = 0;
    for (let index = 0; index < values.length; index += 1) {
      const value = finite(values[index]);
      if (value !== null) { sum += value; count += 1; }
      if (index >= period) {
        const removed = finite(values[index - period]);
        if (removed !== null) { sum -= removed; count -= 1; }
      }
      if (index >= period - 1 && count === period) result[index] = sum / period;
    }
    return result;
  }

  function ema(values, period) {
    const result = Array(values.length).fill(null);
    const seed = [];
    const alpha = 2 / (period + 1);
    let previous = null;
    values.forEach((raw, index) => {
      const value = finite(raw);
      if (value === null) return;
      if (previous === null) {
        seed.push(value);
        if (seed.length === period) {
          previous = seed.reduce((sum, item) => sum + item, 0) / period;
          result[index] = previous;
        }
      } else {
        previous = previous + alpha * (value - previous);
        result[index] = previous;
      }
    });
    return result;
  }

  function wilder(values, period) {
    const result = Array(values.length).fill(null);
    const seed = [];
    let previous = null;
    values.forEach((raw, index) => {
      const value = finite(raw);
      if (value === null) return;
      if (previous === null) {
        seed.push(value);
        if (seed.length === period) {
          previous = seed.reduce((sum, item) => sum + item, 0) / period;
          result[index] = previous;
        }
      } else {
        previous = (previous * (period - 1) + value) / period;
        result[index] = previous;
      }
    });
    return result;
  }

  function rsi(values, period = 14) {
    const gains = Array(values.length).fill(null);
    const losses = Array(values.length).fill(null);
    for (let index = 1; index < values.length; index += 1) {
      const current = finite(values[index]);
      const previous = finite(values[index - 1]);
      if (current === null || previous === null) continue;
      const change = current - previous;
      gains[index] = Math.max(change, 0);
      losses[index] = Math.max(-change, 0);
    }
    const avgGain = wilder(gains, period);
    const avgLoss = wilder(losses, period);
    return values.map((_, index) => {
      if (avgGain[index] === null || avgLoss[index] === null) return null;
      if (avgLoss[index] === 0 && avgGain[index] === 0) return 50;
      if (avgLoss[index] === 0) return 100;
      if (avgGain[index] === 0) return 0;
      const rs = avgGain[index] / avgLoss[index];
      return 100 - 100 / (1 + rs);
    });
  }

  function trueRange(rows) {
    return rows.map((row, index) => {
      const high = finite(row.high);
      const low = finite(row.low);
      const previousClose = index > 0 ? finite(rows[index - 1].close) : null;
      if (high === null || low === null) return null;
      return previousClose === null
        ? high - low
        : Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    });
  }

  function atr(rows, period = 14) {
    return wilder(trueRange(rows), period);
  }

  function rollingStd(values, period) {
    const result = Array(values.length).fill(null);
    for (let index = period - 1; index < values.length; index += 1) {
      const window = values.slice(index - period + 1, index + 1).map(finite);
      if (window.some((value) => value === null)) continue;
      const mean = window.reduce((sum, value) => sum + value, 0) / period;
      result[index] = Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
    }
    return result;
  }

  function rollingHigh(values, period) {
    const result = Array(values.length).fill(null);
    for (let index = period - 1; index < values.length; index += 1) {
      const window = values.slice(index - period + 1, index + 1).map(finite);
      if (window.some((value) => value === null)) continue;
      result[index] = Math.max(...window);
    }
    return result;
  }

  function heikinAshi(rows) {
    let previousOpen = null;
    let previousClose = null;
    return rows.map((row) => {
      const open = finite(row.open);
      const high = finite(row.high);
      const low = finite(row.low);
      const close = finite(row.close);
      if ([open, high, low, close].some((value) => value === null)) return { ...row };
      const haClose = (open + high + low + close) / 4;
      const haOpen = previousOpen === null ? (open + close) / 2 : (previousOpen + previousClose) / 2;
      const converted = {
        ...row,
        rawOpen: open,
        rawHigh: high,
        rawLow: low,
        rawClose: close,
        open: haOpen,
        high: Math.max(high, haOpen, haClose),
        low: Math.min(low, haOpen, haClose),
        close: haClose,
      };
      previousOpen = haOpen;
      previousClose = haClose;
      return converted;
    });
  }

  function supertrend(rows, period = 10, multiplier = 3) {
    const atrValues = atr(rows, period);
    const line = Array(rows.length).fill(null);
    const up = Array(rows.length).fill(null);
    let finalUpper = null;
    let finalLower = null;
    let previousTrendUp = true;
    rows.forEach((row, index) => {
      const high = finite(row.high);
      const low = finite(row.low);
      const close = finite(row.close);
      const previousClose = index > 0 ? finite(rows[index - 1].close) : null;
      const atrValue = atrValues[index];
      if ([high, low, close, atrValue].some((value) => value === null)) return;
      const middle = (high + low) / 2;
      const basicUpper = middle + multiplier * atrValue;
      const basicLower = middle - multiplier * atrValue;
      finalUpper = finalUpper === null || basicUpper < finalUpper || (previousClose !== null && previousClose > finalUpper)
        ? basicUpper : finalUpper;
      finalLower = finalLower === null || basicLower > finalLower || (previousClose !== null && previousClose < finalLower)
        ? basicLower : finalLower;
      let trendUp = previousTrendUp;
      if (previousTrendUp && close < finalLower) trendUp = false;
      else if (!previousTrendUp && close > finalUpper) trendUp = true;
      line[index] = trendUp ? finalLower : finalUpper;
      up[index] = trendUp;
      previousTrendUp = trendUp;
    });
    return { line, up };
  }

  function enrichRows(sourceRows) {
    const rows = sourceRows
      .filter((row) => finite(row.close) !== null)
      .map((row) => ({ ...row }));
    const closes = rows.map((row) => finite(row.close));
    const highs = rows.map((row) => finite(row.high));
    const volumes = rows.map((row) => finite(row.volume));
    const sma25 = rows.map((row) => finite(row.sma25));
    const sma75 = rows.map((row) => finite(row.sma75));
    const sma200 = rows.map((row) => finite(row.sma200));
    const calculatedSma25 = sma(closes, 25);
    const calculatedSma75 = sma(closes, 75);
    const calculatedSma200 = sma(closes, 200);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const dailyRsi14 = rsi(closes, 14);
    const atr10 = atr(rows, 10);
    const atr14 = atr(rows, 14);
    const atr20 = atr(rows, 20);
    const bbMid = sma(closes, 20);
    const bbStd = rollingStd(closes, 20);
    const volumeSma20 = sma(volumes, 20);
    const high52 = rollingHigh(highs, 252);
    const st = supertrend(rows, 10, 3);
    const macd = closes.map((_, index) => (
      ema12[index] !== null && ema26[index] !== null ? ema12[index] - ema26[index] : null
    ));
    const macdSignal = ema(macd, 9);
    const stochasticK = Array(rows.length).fill(null);
    for (let index = 13; index < rows.length; index += 1) {
      const window = rows.slice(index - 13, index + 1);
      const windowHighs = window.map((row) => finite(row.high));
      const windowLows = window.map((row) => finite(row.low));
      const close = closes[index];
      if (windowHighs.some((value) => value === null) || windowLows.some((value) => value === null) || close === null) continue;
      const highest = Math.max(...windowHighs);
      const lowest = Math.min(...windowLows);
      stochasticK[index] = highest === lowest ? 50 : (close - lowest) / (highest - lowest) * 100;
    }
    const stochasticD = sma(stochasticK, 3);

    return rows.map((row, index) => {
      const s25 = sma25[index] ?? calculatedSma25[index];
      const s75 = sma75[index] ?? calculatedSma75[index];
      const s200 = sma200[index] ?? calculatedSma200[index];
      const close = closes[index];
      const volumeRatio = volumeSma20[index] && volumes[index] !== null ? volumes[index] / volumeSma20[index] : null;
      const highDistance = high52[index] && close ? (close / high52[index] - 1) * 100 : null;
      const atrPct = atr14[index] && close ? atr14[index] / close * 100 : null;
      const contraction = atr10[index] !== null && atr20[index] ? atr10[index] / atr20[index] : null;
      const stage2 = [s25, s75, s200].every((value) => value !== null)
        && s25 > s75 && s75 > s200
        && index >= 20 && calculatedSma200[index - 20] !== null && s200 > calculatedSma200[index - 20];
      const vcpTight = contraction !== null && contraction <= 0.85 && s25 !== null && close > s25;
      const mvpSignal = s25 !== null && close > s25 && volumeRatio !== null && volumeRatio >= 1.5
        && dailyRsi14[index] !== null && dailyRsi14[index] >= 55;
      return {
        ...row,
        sma25: s25,
        sma75: s75,
        sma200: s200,
        ema20: ema20[index],
        ema50: ema50[index],
        dailyRsi14: dailyRsi14[index],
        atr14: atr14[index],
        atrPct,
        bbMid: bbMid[index],
        bbUpper: bbMid[index] !== null && bbStd[index] !== null ? bbMid[index] + 2 * bbStd[index] : null,
        bbLower: bbMid[index] !== null && bbStd[index] !== null ? bbMid[index] - 2 * bbStd[index] : null,
        macd: macd[index],
        macdSignal: macdSignal[index],
        macdHist: macd[index] !== null && macdSignal[index] !== null ? macd[index] - macdSignal[index] : null,
        stochasticK: stochasticK[index],
        stochasticD: stochasticD[index],
        volumeSma20: volumeSma20[index],
        volumeRatio,
        high52: high52[index],
        high52DistancePct: highDistance,
        supertrend: st.line[index],
        supertrendUp: st.up[index],
        stage2,
        vcpTight,
        mvpSignal,
        monthlyRsi14: finite(row.monthly_rsi14 ?? row.rsi5),
        monthlyRsiMa5: finite(row.monthly_rsi_ma5 ?? row.rsi14),
      };
    });
  }

  function tpPrices(entry, stop, ratios) {
    const entryPrice = finite(entry);
    const stopPrice = finite(stop);
    if (entryPrice === null || stopPrice === null || stopPrice >= entryPrice) return [];
    const risk = entryPrice - stopPrice;
    return ratios.map((ratio) => entryPrice + risk * clamp(finite(ratio) || 0, 0, 100));
  }

  function normalizeRatios(values) {
    const ratios = values.map((value) => clamp(Math.round((finite(value) || 1.5) * 10) / 10, 1.5, 5));
    for (let index = 1; index < ratios.length; index += 1) {
      if (ratios[index] <= ratios[index - 1]) ratios[index] = Math.min(5, Math.round((ratios[index - 1] + 0.1) * 10) / 10);
    }
    return ratios;
  }

  function positionPlan({ assets, allocationPct, riskPct, entry, stop, lotSize, costBps = 0, slots = MAX_SLOTS }) {
    const capital = Math.max(0, finite(assets) || 0);
    const entryPrice = finite(entry);
    const stopPrice = finite(stop);
    const allocationBudget = capital * Math.max(0, finite(allocationPct) || 0) / 100;
    const riskBudget = capital * Math.max(0, finite(riskPct) || 0) / 100;
    if (entryPrice === null || entryPrice <= 0) {
      return { allocationBudget, riskBudget, maxByAllocation: 0, maxByRisk: 0, recommendedShares: 0, slotShares: 0, riskPerShare: null };
    }
    const feeRate = Math.max(0, finite(costBps) || 0) / 10000;
    const maxByAllocation = roundToLot(allocationBudget / (entryPrice * (1 + feeRate)), lotSize);
    const riskPerShare = stopPrice !== null && stopPrice > 0 && stopPrice < entryPrice ? entryPrice - stopPrice : null;
    const maxByRisk = riskPerShare ? roundToLot(riskBudget / riskPerShare, lotSize) : maxByAllocation;
    const recommendedShares = Math.min(maxByAllocation, maxByRisk);
    return {
      allocationBudget,
      riskBudget,
      maxByAllocation,
      maxByRisk,
      recommendedShares,
      slotShares: roundToLot(recommendedShares / slots, lotSize),
      riskPerShare,
    };
  }

  function applyBuy(account, shares, price, costBps = 0) {
    const quantity = Math.floor(finite(shares) || 0);
    const executionPrice = finite(price);
    if (quantity <= 0 || executionPrice === null || executionPrice <= 0) return { ok: false, error: "購入条件が不正です。" };
    const gross = quantity * executionPrice;
    const fee = gross * Math.max(0, finite(costBps) || 0) / 10000;
    const total = gross + fee;
    if (total > account.cash + 0.0001) return { ok: false, error: "現金が不足しています。" };
    return {
      ok: true,
      fee,
      account: {
        ...account,
        cash: account.cash - total,
        shares: account.shares + quantity,
        costBasis: account.costBasis + total,
        grossBasis: account.grossBasis + gross,
        fees: account.fees + fee,
      },
    };
  }

  function applySell(account, shares, price, costBps = 0) {
    const quantity = Math.min(account.shares, Math.floor(finite(shares) || 0));
    const executionPrice = finite(price);
    if (quantity <= 0 || executionPrice === null || executionPrice <= 0) return { ok: false, error: "売却条件が不正です。" };
    const averageCost = account.shares > 0 ? account.costBasis / account.shares : 0;
    const averageGross = account.shares > 0 ? account.grossBasis / account.shares : 0;
    const allocatedCost = averageCost * quantity;
    const allocatedGross = averageGross * quantity;
    const gross = quantity * executionPrice;
    const fee = gross * Math.max(0, finite(costBps) || 0) / 10000;
    const proceeds = gross - fee;
    const realizedDelta = proceeds - allocatedCost;
    const remaining = account.shares - quantity;
    return {
      ok: true,
      realizedDelta,
      fee,
      account: {
        ...account,
        cash: account.cash + proceeds,
        shares: remaining,
        costBasis: remaining ? Math.max(0, account.costBasis - allocatedCost) : 0,
        grossBasis: remaining ? Math.max(0, account.grossBasis - allocatedGross) : 0,
        realized: account.realized + realizedDelta,
        fees: account.fees + fee,
      },
    };
  }

  function accountMetrics(account, price, initialCapital) {
    const current = finite(price) || 0;
    const marketValue = account.shares * current;
    const totalValue = account.cash + marketValue;
    const unrealized = marketValue - account.costBasis;
    return {
      averagePrice: account.shares ? account.grossBasis / account.shares : null,
      averageCost: account.shares ? account.costBasis / account.shares : null,
      marketValue,
      totalValue,
      unrealized,
      unrealizedPct: account.costBasis ? unrealized / account.costBasis * 100 : null,
      totalProfit: totalValue - initialCapital,
      totalReturn: initialCapital ? (totalValue / initialCapital - 1) * 100 : null,
    };
  }

  function barTouches(row, price) {
    const target = finite(price);
    const low = finite(row?.low);
    const high = finite(row?.high);
    return target !== null && low !== null && high !== null && low <= target && target <= high;
  }

  function stopFillPrice(row, stop) {
    const open = finite(row?.open);
    const stopPrice = finite(stop);
    if (open !== null && stopPrice !== null && open < stopPrice) return open;
    return stopPrice;
  }

  function targetFillPrice(row, target) {
    const open = finite(row?.open);
    const targetPrice = finite(target);
    if (open !== null && targetPrice !== null && open > targetPrice) return open;
    return targetPrice;
  }

  function evaluateBracketBar({ row, entryArmed, positionOpen, entry, stop, tpLevels, hitTargets = [], entryJustFilled = false }) {
    if (!positionOpen && entryArmed && barTouches(row, entry)) return { action: "ENTRY", price: finite(entry) };
    if (!positionOpen) return { action: "NONE" };
    const low = finite(row.low);
    const high = finite(row.high);
    if (low !== null && finite(stop) !== null && low <= stop) return { action: "STOP", price: stopFillPrice(row, stop) };
    if (entryJustFilled) return { action: "NONE" };
    const targets = [];
    tpLevels.forEach((price, index) => {
      if (!hitTargets[index] && high !== null && price !== null && high >= price) {
        targets.push({ index, price: targetFillPrice(row, price) });
      }
    });
    return targets.length ? { action: "TARGETS", targets } : { action: "NONE" };
  }

  return {
    MAX_SLOTS,
    TP_COUNT,
    finite,
    clamp,
    roundToLot,
    sma,
    ema,
    rsi,
    atr,
    heikinAshi,
    supertrend,
    enrichRows,
    tpPrices,
    normalizeRatios,
    positionPlan,
    applyBuy,
    applySell,
    accountMetrics,
    barTouches,
    evaluateBracketBar,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ReplayPro;
if (typeof globalThis !== 'undefined') globalThis.ReplayPro = ReplayPro;
