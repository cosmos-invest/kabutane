(() => {
  "use strict";

  const BIN_COUNT = 28;
  const VALUE_AREA_RATIO = 0.7;
  const PERIODS = {
    "6m": { months: 6, label: "直近6か月" },
    "1y": { months: 12, label: "直近1年" },
    "3y": { months: 36, label: "直近3年" },
  };
  const state = {
    enabled: true,
    period: "1y",
    profile: null,
    currentPrice: null,
    activeBin: null,
    requestGeneration: 0,
    dataPromise: null,
  };

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

  async function fetchJson(path, optional = false) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`${path} (${response.status})`);
    }
    return response.json();
  }

  function rowsByDate(...groups) {
    const merged = new Map();
    groups.flat().forEach((row) => {
      if (row?.date) merged.set(String(row.date), row);
    });
    return [...merged.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  }

  function filterPeriod(rows, period) {
    if (!rows.length) return rows;
    const config = PERIODS[period] || PERIODS["1y"];
    const latest = new Date(`${rows.at(-1).date}T00:00:00`);
    const cutoff = new Date(latest);
    cutoff.setMonth(cutoff.getMonth() - config.months);
    return rows.filter((row) => new Date(`${row.date}T00:00:00`) >= cutoff);
  }

  function buildProfile(rows) {
    const valid = rows.filter((row) => {
      const high = finite(row.high);
      const low = finite(row.low);
      const volume = finite(row.volume);
      return high !== null && low !== null && volume !== null && volume > 0 && high >= low;
    });
    if (!valid.length) return null;

    const minimum = Math.min(...valid.map((row) => finite(row.low)));
    const maximum = Math.max(...valid.map((row) => finite(row.high)));
    if (!(maximum > minimum)) return null;
    const step = (maximum - minimum) / BIN_COUNT;
    const bins = Array.from({ length: BIN_COUNT }, (_, index) => ({
      index,
      low: minimum + step * index,
      high: minimum + step * (index + 1),
      volume: 0,
    }));

    valid.forEach((row) => {
      const low = finite(row.low);
      const high = finite(row.high);
      const volume = finite(row.volume);
      if (high === low) {
        const index = clamp(Math.floor((low - minimum) / step), 0, BIN_COUNT - 1);
        bins[index].volume += volume;
        return;
      }
      const range = high - low;
      bins.forEach((bin) => {
        const overlap = Math.max(0, Math.min(high, bin.high) - Math.max(low, bin.low));
        if (overlap > 0) bin.volume += volume * (overlap / range);
      });
    });

    const total = bins.reduce((sum, bin) => sum + bin.volume, 0);
    if (!(total > 0)) return null;
    const poc = bins.reduce((best, bin) => (bin.volume > best.volume ? bin : best), bins[0]);
    const selected = new Set([poc.index]);
    let accumulated = poc.volume;
    let lower = poc.index - 1;
    let upper = poc.index + 1;
    while (accumulated < total * VALUE_AREA_RATIO && (lower >= 0 || upper < bins.length)) {
      const lowerVolume = lower >= 0 ? bins[lower].volume : -1;
      const upperVolume = upper < bins.length ? bins[upper].volume : -1;
      if (upperVolume >= lowerVolume) {
        selected.add(upper);
        accumulated += bins[upper].volume;
        upper += 1;
      } else {
        selected.add(lower);
        accumulated += bins[lower].volume;
        lower -= 1;
      }
    }
    const selectedBins = bins.filter((bin) => selected.has(bin.index));
    return {
      bins,
      total,
      poc,
      valueLow: Math.min(...selectedBins.map((bin) => bin.low)),
      valueHigh: Math.max(...selectedBins.map((bin) => bin.high)),
      maxVolume: Math.max(...bins.map((bin) => bin.volume)),
      firstDate: valid[0].date,
      lastDate: valid.at(-1).date,
      sourceVolume: valid.reduce((sum, row) => sum + finite(row.volume), 0),
    };
  }

  function positionLabel(price, profile) {
    if (price === null) return "現在値を取得できません";
    if (price > profile.valueHigh) return "商いの中心帯より上";
    if (price < profile.valueLow) return "商いの中心帯より下";
    return "商いの中心帯の中";
  }

  function isValueArea(bin, profile) {
    return bin.low >= profile.valueLow && bin.high <= profile.valueHigh;
  }

  function isPriceChart(chart) {
    return chart?.canvas?.id === "priceChart";
  }

  function profileGeometry(chart) {
    if (!isPriceChart(chart) || !state.enabled || !state.profile || !chart?.chartArea) return null;
    const area = chart.chartArea;
    const mobile = chart.width <= 760;
    const left = area.right + (mobile ? 6 : 10);
    const right = chart.width - (mobile ? 5 : 10);
    if (right - left < (mobile ? 54 : 70)) return null;
    return { mobile, left, right, top: area.top, bottom: area.bottom };
  }

  function chartWidth() {
    return document.querySelector(".price-chart-box")?.clientWidth || window.innerWidth || 0;
  }

  function desiredDesktopPadding(width = chartWidth()) {
    if (!state.enabled) return 0;
    if (width <= 760) return Math.round(clamp(width * 0.25, 82, 112));
    return Math.round(clamp(width * 0.22, 150, 220));
  }

  function withProfilePadding(callback) {
    const padding = window.Chart?.defaults?.layout?.padding;
    if (!padding || typeof padding !== "object") return callback();
    const previousRight = padding.right;
    padding.right = desiredDesktopPadding();
    try {
      return callback();
    } finally {
      padding.right = previousRight;
    }
  }

  function redrawProfile(chart = window.Chart?.getChart?.("priceChart")) {
    if (!chart) return false;
    chart.draw();
    return true;
  }

  function updateBinDetail(bin) {
    state.activeBin = bin || null;
    const detail = document.getElementById("volumeProfileBinDetail");
    if (!detail) return;
    if (!bin || !state.profile) {
      detail.textContent = "右側の棒に触れると、その価格帯の推定出来高を確認できます。";
      return;
    }
    const suffix = bin.index === state.profile.poc.index
      ? "・推定POC"
      : isValueArea(bin, state.profile) ? "・70%バリューエリア内" : "";
    detail.textContent = `${formatPrice(bin.low)}〜${formatPrice(bin.high)}：${formatVolume(bin.volume)}${suffix}`;
  }

  const volumeProfilePlugin = {
    id: "kabutaneVolumeProfile",
    afterDatasetsDraw(chart) {
      if (!isPriceChart(chart)) return;
      const profile = state.profile;
      const yScale = chart?.scales?.y;
      const geometry = profileGeometry(chart);
      if (!profile || !yScale || !geometry) return;
      const ctx = chart.ctx;
      const fullWidth = geometry.right - geometry.left;
      ctx.save();
      ctx.strokeStyle = "rgba(100,116,139,.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(geometry.left - 4, geometry.top);
      ctx.lineTo(geometry.left - 4, geometry.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(geometry.left, geometry.top, fullWidth, geometry.bottom - geometry.top);
      ctx.clip();
      profile.bins.forEach((bin) => {
        const top = Math.max(geometry.top, yScale.getPixelForValue(bin.high));
        const bottom = Math.min(geometry.bottom, yScale.getPixelForValue(bin.low));
        if (!(bottom > top)) return;
        const ratio = profile.maxVolume > 0 ? bin.volume / profile.maxVolume : 0;
        const width = Math.max(1, fullWidth * ratio);
        const left = geometry.left;
        const poc = bin.index === profile.poc.index;
        const valueArea = isValueArea(bin, profile);
        ctx.fillStyle = poc
          ? "rgba(249,115,22,.88)"
          : valueArea
            ? "rgba(16,185,129,.56)"
            : "rgba(99,102,241,.30)";
        ctx.fillRect(left, top + 0.5, width, Math.max(1, bottom - top - 1));
        if (state.activeBin?.index === bin.index) {
          ctx.strokeStyle = "rgba(71,85,105,.92)";
          ctx.lineWidth = 1.2;
          ctx.strokeRect(left, top + 0.5, width, Math.max(1, bottom - top - 1));
        }
        if (poc && bottom - top >= 10 && width >= 30) {
          ctx.fillStyle = "rgba(255,255,255,.98)";
          ctx.font = "700 10px system-ui";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText("POC", geometry.left + 4, (top + bottom) / 2);
        }
      });
      ctx.restore();
    },
    afterEvent(chart, args) {
      if (!isPriceChart(chart)) return;
      const geometry = profileGeometry(chart);
      const yScale = chart?.scales?.y;
      if (!geometry || !yScale || !state.profile) return;
      const event = args.event;
      const inside = event.x >= geometry.left - 4 && event.x <= geometry.right + 4
        && event.y >= geometry.top && event.y <= geometry.bottom;
      if (!inside) {
        if (state.activeBin !== null && (event.type === "mouseout" || event.type === "mousemove" || event.type === "click")) {
          updateBinDetail(null);
          args.changed = true;
        }
        return;
      }
      const price = yScale.getValueForPixel(event.y);
      const bin = state.profile.bins.find((item, index) => price >= item.low && (price < item.high || index === state.profile.bins.length - 1)) || null;
      if (bin?.index !== state.activeBin?.index) {
        updateBinDetail(bin);
        args.changed = true;
      }
    },
  };

  function renderStats(profile, currentPrice) {
    const stats = document.getElementById("volumeProfileStats");
    const summary = document.getElementById("volumeProfileSummary");
    if (!stats || !summary) return;
    if (!profile) {
      stats.innerHTML = "";
      summary.textContent = "価格帯別出来高を計算できる日足データがありません。";
      return;
    }
    const cards = [
      ["推定POC", `${formatPrice(profile.poc.low)}–${formatPrice(profile.poc.high)}`],
      ["70%バリューエリア", `${formatPrice(profile.valueLow)}–${formatPrice(profile.valueHigh)}`],
      ["現在値の位置", positionLabel(currentPrice, profile)],
      ["集計期間", `${profile.firstDate}〜${profile.lastDate}`],
    ];
    stats.innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    summary.textContent = currentPrice === null
      ? "価格の集中帯は、支持・抵抗を考えるための参考情報です。"
      : `現在値 ${formatPrice(currentPrice)} は「${positionLabel(currentPrice, profile)}」です。POCや中心帯だけで売買を決めず、トレンド・直近出来高・損切り位置と合わせて確認してください。`;
  }

  function setActiveControls() {
    document.querySelectorAll("[data-volume-profile-period]").forEach((button) => {
      const active = button.dataset.volumeProfilePeriod === state.period;
      button.classList.toggle("active", active);
      button.classList.toggle("secondary", !active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const toggle = document.getElementById("volumeProfileToggle");
    if (toggle) {
      toggle.classList.toggle("active", state.enabled);
      toggle.classList.toggle("secondary", !state.enabled);
      toggle.setAttribute("aria-pressed", state.enabled ? "true" : "false");
      toggle.textContent = state.enabled ? "価格帯別出来高 ON" : "価格帯別出来高 OFF";
    }
  }

  function loadData() {
    if (state.dataPromise) return state.dataPromise;
    const code = new URLSearchParams(location.search).get("code")?.trim();
    if (!code) return Promise.resolve(null);
    state.dataPromise = Promise.all([
      fetchJson(`data/charts/${encodeURIComponent(code)}.json`),
      fetchJson(`data/daily/${encodeURIComponent(code)}.json`, true),
    ]).then(([base, overlay]) => ({
      rows: rowsByDate(base?.daily || [], overlay?.daily || []),
      currentPrice: finite(overlay?.record?.current_price ?? base?.record?.current_price),
    }));
    return state.dataPromise;
  }

  async function activatePeriod(period = "1y") {
    state.period = PERIODS[period] ? period : "1y";
    const generation = ++state.requestGeneration;
    const status = document.getElementById("volumeProfileStatus");
    setActiveControls();
    if (status) status.textContent = "計算中…";
    try {
      const source = await loadData();
      if (generation !== state.requestGeneration || !source) return;
      const rows = filterPeriod(source.rows, state.period);
      state.currentPrice = source.currentPrice ?? finite(rows.at(-1)?.close);
      state.profile = buildProfile(rows);
      updateBinDetail(null);
      renderStats(state.profile, state.currentPrice);
      if (status) status.textContent = `${PERIODS[state.period].label}・${rows.length.toLocaleString("ja-JP")}営業日`;
      redrawProfile();
    } catch (error) {
      if (generation !== state.requestGeneration) return;
      state.profile = null;
      renderStats(null, null);
      if (status) status.textContent = `読込失敗：${String(error.message || error)}`;
      redrawProfile();
    }
  }

  function toggleProfile() {
    state.enabled = !state.enabled;
    updateBinDetail(null);
    setActiveControls();
    redrawProfile();
  }

  function patchRenderCharts() {
    const base = window.renderCharts;
    if (typeof base !== "function" || base.__kabutaneVolumeProfileWrapped) return;
    function renderChartsWithVolumeProfile() {
      const args = arguments;
      return withProfilePadding(() => base.apply(this, args));
    }
    renderChartsWithVolumeProfile.__kabutaneVolumeProfileWrapped = true;
    window.renderCharts = renderChartsWithVolumeProfile;
  }

  function init() {
    if (window.Chart?.register) window.Chart.register(volumeProfilePlugin);
    patchRenderCharts();
    document.querySelectorAll("[data-volume-profile-period]").forEach((button) => {
      button.addEventListener("click", () => activatePeriod(button.dataset.volumeProfilePeriod));
    });
    document.getElementById("volumeProfileToggle")?.addEventListener("click", toggleProfile);
    window.addEventListener("resize", () => window.requestAnimationFrame(() => redrawProfile()));
    setActiveControls();
    activatePeriod("1y");
    [250, 700, 1500].forEach((delay) => window.setTimeout(() => redrawProfile(), delay));
  }

  window.KabutaneVolumeProfile = { buildProfile, filterPeriod, rowsByDate, activatePeriod, desiredDesktopPadding };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();