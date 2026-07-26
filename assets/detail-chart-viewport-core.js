(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DetailChartViewportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeRange(total, start, end, minimumPoints = 12) {
    const count = Math.max(0, Math.floor(finite(total) || 0));
    if (!count) return { start: 0, end: -1, span: 0 };
    const minimum = Math.min(count, Math.max(2, Math.floor(finite(minimumPoints) || 12)));
    let first = Math.floor(finite(start) ?? 0);
    let last = Math.floor(finite(end) ?? (count - 1));
    if (last < first) [first, last] = [last, first];
    let span = Math.max(minimum, last - first + 1);
    span = Math.min(count, span);
    first = clamp(first, 0, Math.max(0, count - span));
    last = first + span - 1;
    if (last >= count) {
      last = count - 1;
      first = Math.max(0, last - span + 1);
    }
    return { start: first, end: last, span: last - first + 1 };
  }

  function latestRange(total, preferredPoints, minimumPoints = 12) {
    const count = Math.max(0, Math.floor(finite(total) || 0));
    const span = Math.min(count, Math.max(minimumPoints, Math.floor(finite(preferredPoints) || count)));
    return normalizeRange(count, count - span, count - 1, minimumPoints);
  }

  function panRange(range, delta, total, minimumPoints = 12) {
    const normalized = normalizeRange(total, range?.start, range?.end, minimumPoints);
    if (!normalized.span) return normalized;
    const movement = Math.round(finite(delta) || 0);
    return normalizeRange(total, normalized.start + movement, normalized.end + movement, minimumPoints);
  }

  function zoomRange(range, factor, anchorIndex, total, minimumPoints = 12) {
    const normalized = normalizeRange(total, range?.start, range?.end, minimumPoints);
    if (!normalized.span) return normalized;
    const zoomFactor = clamp(finite(factor) || 1, 0.15, 8);
    const targetSpan = clamp(Math.round(normalized.span * zoomFactor), Math.min(total, minimumPoints), total);
    const anchor = clamp(finite(anchorIndex) ?? normalized.end, normalized.start, normalized.end);
    const ratio = normalized.span <= 1 ? 1 : (anchor - normalized.start) / (normalized.span - 1);
    const targetStart = Math.round(anchor - ratio * (targetSpan - 1));
    return normalizeRange(total, targetStart, targetStart + targetSpan - 1, minimumPoints);
  }

  function verticalBounds(values, scale = 1, pan = 0, paddingRatio = 0.06) {
    const numbers = (values || []).map(finite).filter((value) => value !== null);
    if (!numbers.length) return {};
    let minimum = Math.min(...numbers);
    let maximum = Math.max(...numbers);
    let baseRange = maximum - minimum;
    if (baseRange <= 0) baseRange = Math.max(Math.abs(maximum) * 0.04, 1);
    const paddedRange = baseRange * (1 + Math.max(0, finite(paddingRatio) || 0) * 2);
    const center = (minimum + maximum) / 2 + (finite(pan) || 0) * paddedRange;
    const scaledRange = paddedRange * clamp(finite(scale) || 1, 0.25, 5);
    return { min: center - scaledRange / 2, max: center + scaledRange / 2 };
  }

  function slicePayload(payload, range) {
    const daily = Array.isArray(payload?.daily) ? payload.daily : [];
    const normalized = normalizeRange(daily.length, range?.start, range?.end);
    return {
      ...(payload || {}),
      daily: normalized.span ? daily.slice(normalized.start, normalized.end + 1) : [],
      viewport: normalized,
    };
  }

  function nextHeightMode(mode) {
    if (mode === "compact") return "standard";
    if (mode === "standard") return "tall";
    return "compact";
  }

  return {
    finite,
    clamp,
    normalizeRange,
    latestRange,
    panRange,
    zoomRange,
    verticalBounds,
    slicePayload,
    nextHeightMode,
  };
});
