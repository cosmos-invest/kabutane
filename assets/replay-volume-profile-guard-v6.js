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

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatPrice(value) {
    const number = finite(value);
    return number === null ? "—" : `${number.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}円`;
  }

  function formatVolume(value) {
    const number = finite(value);
    if (number === null) return "—";
    if (number >= 100000000) return `${(number / 100000000).toFixed(1)}億株`;
    if (number >= 10000) return `${(number / 10000).toFixed(1)}万株`;
    return `${Math.round(number).toLocaleString("ja-JP")}株`;
  }

  function profileEnabled() {
    const toggle = document.getElementById("replayVolumeToggleV6");
    return !toggle || toggle.checked;
  }

  function desiredPadding() {
    if (!profileEnabled()) return 0;
    const width = document.querySelector(".pro-main-chart")?.clientWidth || window.innerWidth || 0;
    if (width <= 760) return Math.round(clamp(width * 0.25, 82, 112));
    return Math.round(clamp(width * 0.22, 150, 220));
  }

  function geometry(chart) {
    if (!chart?.chartArea || !profileEnabled()) return null;
    const area = chart.chartArea;
    const mobile = chart.width <= 760;
    const left = area.right + (mobile ? 6 : 10);
    const right = chart.width - (mobile ? 5 : 10);
    if (right - left < (mobile ? 52 : 70)) return null;
    return { left, right, top: area.top, bottom: area.bottom, mobile };
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
    return point.x >= area.left - 4 && point.x <= area.right + 4
      && point.y >= area.top && point.y <= area.bottom;
  }

  function currentProfile() {
    const api = window.KabutaneReplayDecisionV6;
    const s = stateRef();
    const row = currentRowSafe();
    const currentDate = String(row?.date || "");
    if (!api?.buildProfile || !api?.filterPeriod || !s?.rows?.length || !currentDate || !profileEnabled()) return null;
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

  function drawProfile(chart) {
    const profile = currentProfile();
    const area = geometry(chart);
    const yScale = chart?.scales?.y || Object.values(chart?.scales || {}).find((scale) => scale.axis === "y");
    if (!profile || !area || !yScale) return;
    const ctx = chart.ctx;
    const fullWidth = area.right - area.left;
    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.left - 4, area.top);
    ctx.lineTo(area.left - 4, area.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(area.left, area.top, fullWidth, area.bottom - area.top);
    ctx.clip();
    profile.bins.forEach((bin) => {
      const top = Math.max(area.top, yScale.getPixelForValue(bin.high));
      const bottom = Math.min(area.bottom, yScale.getPixelForValue(bin.low));
      if (!(bottom > top)) return;
      const ratio = profile.maxVolume > 0 ? bin.volume / profile.maxVolume : 0;
      const width = Math.max(1, fullWidth * ratio);
      const poc = bin.index === profile.poc.index;
      const inValueArea = bin.low >= profile.valueLow && bin.high <= profile.valueHigh;
      ctx.fillStyle = poc
        ? "rgba(249,115,22,.86)"
        : inValueArea
          ? "rgba(16,185,129,.50)"
          : "rgba(99,102,241,.28)";
      ctx.fillRect(area.left, top + 0.5, width, Math.max(1, bottom - top - 1));
      if (poc && bottom - top >= 10 && width >= 28) {
        ctx.fillStyle = "rgba(255,255,255,.98)";
        ctx.font = "700 9px system-ui";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("POC", area.left + 3, (top + bottom) / 2);
      }
    });
    ctx.restore();
  }

  function drawSignalDots(chart) {
    const crosses = window.KabutaneReplayDecisionV6?.monthlyCrossings?.() || [];
    if (!crosses.length || !chart?.chartArea) return;
    const xScale = chart.scales?.x || Object.values(chart.scales || {}).find((scale) => scale.axis === "x");
    if (!xScale) return;
    const labels = (chart.data?.labels || []).map((label) => String(label));
    const ctx = chart.ctx;
    const y = chart.chartArea.bottom - 11;
    ctx.save();
    crosses.forEach((cross) => {
      let index = labels.indexOf(cross.date);
      if (index < 0) index = labels.findIndex((label) => label >= cross.date);
      if (index < 0 || index >= labels.length) return;
      const x = xScale.getPixelForValue(index);
      if (x < chart.chartArea.left || x > chart.chartArea.right) return;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = cross.type === "GC" ? "rgba(16,185,129,.95)" : "rgba(244,63,94,.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    ctx.restore();
  }

  const sidePlugin = {
    id: "kabutaneReplaySideProfileV7",
    afterDatasetsDraw(chart) {
      if (chart?.canvas?.id !== "replayChart") return;
      drawProfile(chart);
      drawSignalDots(chart);
    },
  };

  function neutralizeLegacyPlugin() {
    try {
      const legacy = window.Chart?.registry?.plugins?.get?.("kabutaneReplayDecisionV6");
      if (!legacy || legacy.__kabutaneRightGutterNeutralized) return;
      legacy.afterDatasetsDraw = function () {};
      legacy.afterEvent = function () {};
      legacy.__kabutaneRightGutterNeutralized = true;
    } catch (_) {}
  }

  function registerSidePlugin() {
    if (!window.Chart?.register) return;
    neutralizeLegacyPlugin();
    try {
      if (!window.Chart.registry?.plugins?.get?.(sidePlugin.id)) window.Chart.register(sidePlugin);
    } catch (_) {
      try { window.Chart.register(sidePlugin); } catch (_) {}
    }
  }

  function patchMainChartRender() {
    const base = window.renderMainChart;
    if (typeof base !== "function" || base.__kabutaneRightProfileWrapped) return;
    function renderMainChartWithRightProfile() {
      const padding = window.Chart?.defaults?.layout?.padding;
      if (!padding || typeof padding !== "object") return base.apply(this, arguments);
      const previousRight = padding.right;
      padding.right = desiredPadding();
      try {
        return base.apply(this, arguments);
      } finally {
        padding.right = previousRight;
      }
    }
    renderMainChartWithRightProfile.__kabutaneRightProfileWrapped = true;
    window.renderMainChart = renderMainChartWithRightProfile;
  }

  function redrawLayout() {
    try {
      if (typeof renderMainChart === "function") renderMainChart();
      else window.Chart?.getChart?.("replayChart")?.draw?.();
    } catch (_) {}
  }

  function onPointerUp(event) {
    const chart = window.Chart?.getChart?.("replayChart");
    if (!chart || !isProfileInteraction(event, chart)) return;
    const s = stateRef();
    if (s?.chartView) s.chartView.moved = true;
    showProfileBin(event, chart);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event) {
    const chart = window.Chart?.getChart?.("replayChart");
    if (!chart || !isProfileInteraction(event, chart)) return;
    showProfileBin(event, chart);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function boot() {
    patchMainChartRender();
    registerSidePlugin();
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", (event) => {
      if (event.target?.id === "replayVolumeToggleV6") window.setTimeout(redrawLayout, 0);
      else if (event.target?.id === "replayVolumePeriodV6") window.setTimeout(() => window.Chart?.getChart?.("replayChart")?.draw?.(), 0);
    });
    window.addEventListener("resize", () => window.setTimeout(redrawLayout, 30));
  }

  window.KabutaneReplayProfileGuardV6 = { isProfileInteraction, geometry, desiredPadding };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();