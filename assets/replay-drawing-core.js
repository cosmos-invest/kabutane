(function (root) {
  "use strict";

  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const RR_LEVELS = [1, 2, 3];
  const STRENGTHS = {
    soft: { width: 1, alpha: 0.46, dash: [4, 5] },
    normal: { width: 1.35, alpha: 0.72, dash: [6, 4] },
    strong: { width: 1.8, alpha: 0.92, dash: [] },
  };
  let sequence = 0;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeStrength(value) {
    return Object.prototype.hasOwnProperty.call(STRENGTHS, value) ? value : "normal";
  }

  function strengthStyle(value) {
    return { ...STRENGTHS[normalizeStrength(value)] };
  }

  function normalizeAnchor(value) {
    const index = Math.max(0, Math.round(finite(value?.index) || 0));
    const price = finite(value?.price);
    if (price === null) return null;
    return { index, price, date: value?.date || null };
  }

  function createId(type) {
    sequence += 1;
    return `${type}-${Date.now()}-${sequence}`;
  }

  function baseDrawing(type, anchors, options = {}) {
    return {
      id: options.id || createId(type),
      type,
      anchors: anchors.map(normalizeAnchor).filter(Boolean),
      label: String(options.label || "").trim(),
      strength: normalizeStrength(options.strength),
      createdAt: options.createdAt || Date.now(),
    };
  }

  function createHorizontal(anchor, options = {}) {
    return baseDrawing("horizontal", [anchor], options);
  }

  function createTrend(start, end, options = {}) {
    return baseDrawing("trend", [start, end], options);
  }

  function createFibonacci(start, end, options = {}) {
    return baseDrawing("fibonacci", [start, end], options);
  }

  function createRiskReward(entry, stop, options = {}) {
    return baseDrawing("riskReward", [entry, stop], options);
  }

  function fibonacciLevels(item) {
    const start = item?.anchors?.[0];
    const end = item?.anchors?.[1];
    if (!start || !end) return [];
    const delta = end.price - start.price;
    return FIB_LEVELS.map((ratio) => ({ ratio, price: start.price + delta * ratio }));
  }

  function riskRewardLevels(item) {
    const entry = item?.anchors?.[0];
    const stop = item?.anchors?.[1];
    if (!entry || !stop) return null;
    const unit = entry.price - stop.price;
    if (!Number.isFinite(unit) || unit === 0) return null;
    return {
      direction: unit > 0 ? "long" : "short",
      entry: entry.price,
      stop: stop.price,
      unit: Math.abs(unit),
      targets: RR_LEVELS.map((ratio) => ({ ratio, price: entry.price + unit * ratio })),
    };
  }

  function trendPriceAt(item, index) {
    const start = item?.anchors?.[0];
    const end = item?.anchors?.[1];
    const target = finite(index);
    if (!start || !end || target === null) return null;
    if (end.index === start.index) return end.price;
    const slope = (end.price - start.price) / (end.index - start.index);
    return start.price + slope * (target - start.index);
  }

  function drawingPrices(item) {
    if (!item) return [];
    if (item.type === "fibonacci") return fibonacciLevels(item).map((level) => level.price);
    if (item.type === "riskReward") {
      const levels = riskRewardLevels(item);
      return levels ? [levels.entry, levels.stop, ...levels.targets.map((target) => target.price)] : [];
    }
    return (item.anchors || []).map((anchor) => finite(anchor.price)).filter((price) => price !== null);
  }

  function collectPrices(items) {
    return (Array.isArray(items) ? items : []).flatMap(drawingPrices).filter(Number.isFinite);
  }

  function nearestItem(items, point, tolerance = {}) {
    const list = Array.isArray(items) ? items : [];
    const indexTolerance = Math.max(1, finite(tolerance.index) || 3);
    const priceTolerance = Math.max(0.000001, finite(tolerance.price) || Math.abs(point?.price || 1) * 0.015);
    const targetIndex = finite(point?.index);
    const targetPrice = finite(point?.price);
    if (targetIndex === null || targetPrice === null) return null;

    let nearest = null;
    let best = Infinity;
    list.forEach((item) => {
      let candidates = [];
      if (item.type === "horizontal") candidates = [{ index: targetIndex, price: item.anchors?.[0]?.price }];
      else if (item.type === "trend") candidates = [{ index: targetIndex, price: trendPriceAt(item, targetIndex) }];
      else if (item.type === "fibonacci") candidates = fibonacciLevels(item).map((level) => ({ index: targetIndex, price: level.price }));
      else if (item.type === "riskReward") {
        const levels = riskRewardLevels(item);
        if (levels) candidates = [levels.entry, levels.stop, ...levels.targets.map((target) => target.price)].map((price) => ({ index: targetIndex, price }));
      }
      candidates.forEach((candidate) => {
        const price = finite(candidate.price);
        if (price === null) return;
        const indexDistance = Math.abs((candidate.index ?? targetIndex) - targetIndex) / indexTolerance;
        const priceDistance = Math.abs(price - targetPrice) / priceTolerance;
        const score = Math.sqrt(indexDistance ** 2 + priceDistance ** 2);
        if (score < best) {
          best = score;
          nearest = item;
        }
      });
    });
    return best <= 1 ? nearest : null;
  }

  const api = {
    FIB_LEVELS,
    RR_LEVELS,
    STRENGTHS,
    finite,
    clamp,
    normalizeStrength,
    strengthStyle,
    normalizeAnchor,
    createHorizontal,
    createTrend,
    createFibonacci,
    createRiskReward,
    fibonacciLevels,
    riskRewardLevels,
    trendPriceAt,
    drawingPrices,
    collectPrices,
    nearestItem,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReplayDrawingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
