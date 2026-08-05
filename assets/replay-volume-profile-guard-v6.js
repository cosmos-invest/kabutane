(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function stateRef() {
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }

  function currentRowSafe() {
    try { return typeof currentRow === "function" ? currentRow() : null; } catch (_) { return null; }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatPrice(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}円` : "—";
  }

  function formatVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 100000000) return `${(number / 100000000).toFixed(1)}億株`;
    if (number >= 10000) return `${(number / 10000).toFixed(1)}万株`;
    return `${Math.round(number).toLocaleString("ja-JP")}株`;
  }

  function profileEnabled() {
    const toggle = document.getElementById("replayVolumeToggleV6");
    return !toggle || toggle.checked;
  }

  function geometry(chart) {
    if (!chart?.chartArea || !profileEnabled()) return null;
    const area = chart.chartArea;
    const mobile = chart.width <= 760;
    const ratio = mobile ? 0.28 : 0.20;
    const width = clamp((area.right - area.left) * ratio, mobile ? 72 : 110, mobile ? 122 : 190);
    return { left: area.right - width, right: area.right - 3, top: area.top, bottom: area.bottom };
  }

  function eventPoint(event, chart) {
    const rect = chart?.canvas?.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * (chart.width / rect.width),
      y: (event.clientY - rect.top) * (chart.height / rect.height),
    };
  }

  function isProfileInteraction(event, chart) {
    if (event.target?.id !== "replayChart") return false;
    const area = geometry(chart);
    const point = eventPoint(event, chart);
    if (!area || !point) return false;
    return point.x >= area.left - 6 && point.x <= area.right + 6
      && point.y >= area.top && point.y <= area.bottom;
  }

  function currentProfile() {
    const api = window.KabutaneReplayDecisionV6;
    const s = stateRef();
    const row = currentRowSafe();
    const currentDate = String(row?.date || "");
    if (!api?.buildProfile || !api?.filterPeriod || !s?.rows?.length || !currentDate) return null;
    const period = document.getElementById("replayVolumePeriodV6")?.value || "1y";
    const available = s.rows.filter((item) => item?.date && String(item.date) <= currentDate);
    return api.buildProfile(api.filterPeriod(available, currentDate, period));
  }

  function showProfileBin(event, chart) {
    const profile = currentProfile();
    const detail = document.getElementById("replayVolumeProfileDetailV6");
    const yScale = chart?.scales?.y || Object.values(chart?.scales || {}).find((scale) => scale.axis === "y");
    const point = eventPoint(event, chart);
    if (!profile || !detail || !yScale || !point) return;
    const price = yScale.getValueForPixel(point.y);
    const bin = profile.bins.find((item, index) => price >= item.low && (price < item.high || index === profile.bins.length - 1));
    if (!bin) return;
    const inValueArea = bin.low >= profile.valueLow && bin.high <= profile.valueHigh;
    const suffix = bin.index === profile.poc.index ? "・POC" : inValueArea ? "・70%中心帯" : "";
    detail.textContent = `${formatPrice(bin.low)}〜${formatPrice(bin.high)} ${formatVolume(bin.volume)}${suffix}`;
  }

  function onPointerUp(event) {
    const chart = window.Chart?.getChart?.("replayChart");
    if (!chart || !isProfileInteraction(event, chart)) return;
    const s = stateRef();
    if (s?.chartView) s.chartView.moved = true;
    showProfileBin(event, chart);
  }

  function onClick(event) {
    const chart = window.Chart?.getChart?.("replayChart");
    if (!chart || !isProfileInteraction(event, chart)) return;
    showProfileBin(event, chart);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("click", onClick, true);

  window.KabutaneReplayProfileGuardV6 = { isProfileInteraction };
})();
