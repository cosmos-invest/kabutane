(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const BIN_COUNT = 28;
  const VALUE_AREA_RATIO = 0.7;
  const PERIODS = {
    "6m": { months: 6, label: "6か月" },
    "1y": { months: 12, label: "1年" },
    "3y": { months: 36, label: "3年" },
  };
  const profileState = {
    enabled: true,
    period: localStorage.getItem("kabutane:replay:volumeProfilePeriod") || "1y",
    profile: null,
    currentDate: "",
    activeBin: null,
  };
  let lastSyncKey = "";
  let syncTimer = null;

  function stateRef() {
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }

  function currentRowSafe() {
    try { return typeof currentRow === "function" ? currentRow() : null; } catch (_) { return null; }
  }

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

  function filterPeriod(rows, currentDate, period) {
    if (!rows.length || !currentDate) return rows;
    const config = PERIODS[period] || PERIODS["1y"];
    const latest = new Date(`${currentDate}T00:00:00`);
    if (Number.isNaN(latest.getTime())) return rows;
    const cutoff = new Date(latest);
    cutoff.setMonth(cutoff.getMonth() - config.months);
    return rows.filter((row) => {
      if (!row?.date || String(row.date) > currentDate) return false;
      const date = new Date(`${row.date}T00:00:00`);
      return !Number.isNaN(date.getTime()) && date >= cutoff;
    });
  }

  function buildProfile(rows) {
    const valid = rows.filter((row) => {
      const high = finite(row?.high);
      const low = finite(row?.low);
      const volume = finite(row?.volume);
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
    const valueBins = bins.filter((bin) => selected.has(bin.index));
    return {
      bins,
      total,
      poc,
      valueLow: Math.min(...valueBins.map((bin) => bin.low)),
      valueHigh: Math.max(...valueBins.map((bin) => bin.high)),
      maxVolume: Math.max(...bins.map((bin) => bin.volume)),
      firstDate: valid[0].date,
      lastDate: valid.at(-1).date,
    };
  }

  function isValueArea(bin, profile) {
    return bin.low >= profile.valueLow && bin.high <= profile.valueHigh;
  }

  function replayRowsUpToNow() {
    const s = stateRef();
    const row = currentRowSafe();
    const currentDate = String(row?.date || document.getElementById("currentDate")?.textContent || "").trim();
    if (!s?.rows?.length || !/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) return { rows: [], currentDate };
    const rows = s.rows.filter((item) => item?.date && String(item.date) <= currentDate);
    return { rows: filterPeriod(rows, currentDate, profileState.period), currentDate };
  }

  function profileGeometry(chart) {
    if (!profileState.enabled || !profileState.profile || !chart?.chartArea) return null;
    const area = chart.chartArea;
    const mobile = chart.width <= 760;
    const ratio = mobile ? 0.28 : 0.20;
    const width = clamp((area.right - area.left) * ratio, mobile ? 72 : 110, mobile ? 122 : 190);
    return { mobile, left: area.right - width, right: area.right - 3, top: area.top, bottom: area.bottom };
  }

  function updateBinDetail(bin) {
    profileState.activeBin = bin || null;
    const detail = document.getElementById("replayVolumeProfileDetailV6");
    if (!detail) return;
    if (!bin || !profileState.profile) {
      detail.textContent = profileState.profile
        ? `POC ${formatPrice(profileState.profile.poc.low)}〜${formatPrice(profileState.profile.poc.high)}`
        : "価格帯別出来高を計算中";
      return;
    }
    const suffix = bin.index === profileState.profile.poc.index
      ? "・POC"
      : isValueArea(bin, profileState.profile) ? "・70%中心帯" : "";
    detail.textContent = `${formatPrice(bin.low)}〜${formatPrice(bin.high)} ${formatVolume(bin.volume)}${suffix}`;
  }

  function pointValue(value) {
    if (value && typeof value === "object") return finite(value.y ?? value.value);
    return finite(value);
  }

  function datasetScore(dataset, kind) {
    const label = String(dataset?.label || "");
    const normalized = label.toLowerCase();
    let score = 0;
    if (kind === "rsi" && /rsi\s*14|rsi14/.test(normalized)) score += 20;
    if (kind === "ma" && /(5か月|5ヶ月|5m|sma\s*5|ma\s*5)/.test(normalized)) score += 20;
    if (/確定/.test(label) && !/進行|暫定/.test(label)) score += 8;
    if (/進行|暫定/.test(label)) score -= 8;
    score += (dataset?.data || []).filter((value) => pointValue(value) !== null).length / 1000;
    return score;
  }

  function pickMonthlyDataset(chart, kind) {
    const datasets = chart?.data?.datasets || [];
    return datasets
      .map((dataset) => ({ dataset, score: datasetScore(dataset, kind) }))
      .filter((entry) => entry.score >= 20)
      .sort((left, right) => right.score - left.score)[0]?.dataset || null;
  }

  function monthlyCrossings() {
    const monthlyChart = window.Chart?.getChart?.("monthlyRsiChart");
    if (!monthlyChart) return [];
    const rsi = pickMonthlyDataset(monthlyChart, "rsi");
    const ma = pickMonthlyDataset(monthlyChart, "ma");
    if (!rsi || !ma) return [];
    const labels = monthlyChart.data.labels || [];
    const length = Math.min(labels.length, rsi.data?.length || 0, ma.data?.length || 0);
    const crosses = [];
    let previousDiff = null;
    for (let index = 0; index < length; index += 1) {
      const rsiValue = pointValue(rsi.data[index]);
      const maValue = pointValue(ma.data[index]);
      if (rsiValue === null || maValue === null) continue;
      const diff = rsiValue - maValue;
      if (previousDiff !== null) {
        if (previousDiff <= 0 && diff > 0) crosses.push({ date: String(labels[index]), type: "GC" });
        else if (previousDiff > 0 && diff <= 0) crosses.push({ date: String(labels[index]), type: "DC" });
      }
      previousDiff = diff;
    }
    return crosses;
  }

  function drawVolumeProfile(chart) {
    const profile = profileState.profile;
    const geometry = profileGeometry(chart);
    const yScale = chart?.scales?.y || Object.values(chart?.scales || {}).find((scale) => scale.axis === "y");
    if (!profile || !geometry || !yScale) return;
    const ctx = chart.ctx;
    const fullWidth = geometry.right - geometry.left;
    ctx.save();
    ctx.fillStyle = geometry.mobile ? "rgba(255,255,255,.58)" : "rgba(255,255,255,.42)";
    ctx.fillRect(geometry.left - 3, geometry.top, fullWidth + 6, geometry.bottom - geometry.top);
    ctx.beginPath();
    ctx.rect(geometry.left - 3, geometry.top, fullWidth + 6, geometry.bottom - geometry.top);
    ctx.clip();
    profile.bins.forEach((bin) => {
      const top = Math.max(geometry.top, yScale.getPixelForValue(bin.high));
      const bottom = Math.min(geometry.bottom, yScale.getPixelForValue(bin.low));
      if (!(bottom > top)) return;
      const ratio = profile.maxVolume > 0 ? bin.volume / profile.maxVolume : 0;
      const width = Math.max(1, fullWidth * ratio);
      const left = geometry.right - width;
      const poc = bin.index === profile.poc.index;
      const valueArea = isValueArea(bin, profile);
      ctx.fillStyle = poc
        ? "rgba(249,115,22,.82)"
        : valueArea
          ? "rgba(16,185,129,.46)"
          : "rgba(99,102,241,.20)";
      ctx.fillRect(left, top + 0.5, width, Math.max(1, bottom - top - 1));
      if (profileState.activeBin?.index === bin.index) {
        ctx.strokeStyle = "rgba(77,55,70,.9)";
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top + 0.5, width, Math.max(1, bottom - top - 1));
      }
    });
    ctx.restore();
  }

  function drawSignalDots(chart) {
    const crosses = monthlyCrossings();
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
      const gc = cross.type === "GC";
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = gc ? "rgba(16,185,129,.95)" : "rgba(244,63,94,.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    ctx.restore();
  }

  const decisionPlugin = {
    id: "kabutaneReplayDecisionV6",
    afterDatasetsDraw(chart) {
      if (chart?.canvas?.id !== "replayChart") return;
      drawVolumeProfile(chart);
      drawSignalDots(chart);
    },
    afterEvent(chart, args) {
      if (chart?.canvas?.id !== "replayChart") return;
      const geometry = profileGeometry(chart);
      const yScale = chart?.scales?.y || Object.values(chart?.scales || {}).find((scale) => scale.axis === "y");
      if (!geometry || !yScale || !profileState.profile) return;
      const event = args.event;
      const inside = event.x >= geometry.left - 6 && event.x <= geometry.right + 6
        && event.y >= geometry.top && event.y <= geometry.bottom;
      if (!inside) {
        if (profileState.activeBin !== null && (event.type === "mouseout" || event.type === "mousemove" || event.type === "click")) {
          updateBinDetail(null);
          args.changed = true;
        }
        return;
      }
      const price = yScale.getValueForPixel(event.y);
      const bin = profileState.profile.bins.find((item, index) => price >= item.low && (price < item.high || index === profileState.profile.bins.length - 1)) || null;
      if (bin?.index !== profileState.activeBin?.index) {
        updateBinDetail(bin);
        args.changed = true;
      }
    },
  };

  function registerPlugin() {
    if (!window.Chart?.register) return;
    try {
      const registered = window.Chart.registry?.plugins?.get?.(decisionPlugin.id);
      if (!registered) window.Chart.register(decisionPlugin);
    } catch (_) {
      try { window.Chart.register(decisionPlugin); } catch (_) {}
    }
  }

  function headingForBox(box) {
    let node = box?.previousElementSibling || null;
    while (node && !node.classList?.contains("subchart-heading")) node = node.previousElementSibling;
    return node;
  }

  function ensureChartSettings(mainShell) {
    const controls = document.querySelector(".pro-indicator-controls");
    if (!controls || document.getElementById("replayChartSettingsV6")) return;
    const details = document.createElement("details");
    details.id = "replayChartSettingsV6";
    details.className = "replay-chart-settings-v6";
    details.open = localStorage.getItem("kabutane:replay:chartSettingsSeen") !== "1";
    details.innerHTML = `<summary><span>チャート表示設定</span><small>一度決めたら自動で閉じます</small></summary>`;
    controls.parentNode?.insertBefore(details, controls);
    details.appendChild(controls);
    mainShell?.prepend(details);

    let closeTimer = null;
    const scheduleClose = () => {
      localStorage.setItem("kabutane:replay:chartSettingsSeen", "1");
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => { details.open = false; }, 650);
    };
    controls.addEventListener("change", scheduleClose);
    controls.addEventListener("click", (event) => {
      if (event.target.closest("button")) scheduleClose();
    });
  }

  function ensureOscillatorSettings(oscillatorHeading) {
    if (!oscillatorHeading || oscillatorHeading.querySelector(".oscillator-settings-v6")) return;
    const label = oscillatorHeading.querySelector("label");
    const select = document.getElementById("oscillatorSelect");
    if (!label || !select) return;
    const details = document.createElement("details");
    details.className = "oscillator-settings-v6";
    const summary = document.createElement("summary");
    summary.textContent = select.options[select.selectedIndex]?.textContent || "オシレーター";
    details.appendChild(summary);
    label.parentNode?.insertBefore(details, label);
    details.appendChild(label);
    select.addEventListener("change", () => {
      summary.textContent = select.options[select.selectedIndex]?.textContent || "オシレーター";
      window.setTimeout(() => { details.open = false; }, 180);
    });
  }

  function ensureProfileToolbar(mainShell, chartBox) {
    let toolbar = document.getElementById("replayVolumeProfileV6");
    if (toolbar) return toolbar;
    toolbar = document.createElement("div");
    toolbar.id = "replayVolumeProfileV6";
    toolbar.className = "replay-volume-profile-v6";
    toolbar.innerHTML = `
      <label class="replay-volume-toggle-v6"><input id="replayVolumeToggleV6" type="checkbox" checked><span>価格帯別出来高</span></label>
      <label class="replay-volume-period-v6">集計<select id="replayVolumePeriodV6"><option value="6m">6か月</option><option value="1y">1年</option><option value="3y">3年</option></select></label>
      <span id="replayVolumeProfileDetailV6" class="replay-volume-detail-v6">価格帯別出来高を計算中</span>
      <a class="replay-help-link-v6" href="learn.html#volume-profile" target="_blank" rel="noopener" aria-label="価格帯別出来高の解説">？</a>`;
    if (chartBox?.parentNode === mainShell) mainShell.insertBefore(toolbar, chartBox);
    else mainShell?.prepend(toolbar);

    const toggle = toolbar.querySelector("#replayVolumeToggleV6");
    const period = toolbar.querySelector("#replayVolumePeriodV6");
    period.value = PERIODS[profileState.period] ? profileState.period : "1y";
    profileState.period = period.value;
    toggle.addEventListener("change", () => {
      profileState.enabled = toggle.checked;
      updateProfile(true);
    });
    period.addEventListener("change", () => {
      profileState.period = PERIODS[period.value] ? period.value : "1y";
      localStorage.setItem("kabutane:replay:volumeProfilePeriod", profileState.period);
      updateProfile(true);
    });
    return toolbar;
  }

  function ensurePlaybackDock(mainShell, chartBox) {
    const controls = document.querySelector(".playback-controls");
    if (!controls) return;
    let dock = document.getElementById("replayDecisionDockV6");
    if (!dock) {
      dock = document.createElement("div");
      dock.id = "replayDecisionDockV6";
      dock.className = "replay-decision-dock-v6";
      dock.innerHTML = `<div class="replay-decision-now-v6"><span>現在</span><strong id="replayDecisionDateV6">—</strong><b id="replayDecisionPriceV6">—</b></div>`;
      if (chartBox?.nextSibling) mainShell.insertBefore(dock, chartBox.nextSibling);
      else mainShell.appendChild(dock);
    }
    controls.classList.add("playback-controls-v6");
    dock.appendChild(controls);
  }

  function markCompactStats() {
    const stats = document.querySelector(".replay-stats");
    if (!stats) return;
    const keepIds = new Set(["currentDate", "currentPrice", "unrealizedValue", "realizedValue"]);
    stats.querySelectorAll("article").forEach((article) => {
      const strong = article.querySelector("strong[id]");
      article.classList.toggle("decision-stat-v6", Boolean(strong && keepIds.has(strong.id)));
    });
    stats.classList.add("decision-stats-v6");
  }

  function ensureDecisionLayout() {
    const panel = document.querySelector(".replay-chart-panel");
    const chartBox = document.querySelector(".pro-main-chart") || document.querySelector(".replay-chart-box");
    const oscillatorBox = document.getElementById("oscillatorChart")?.closest(".oscillator-chart-box");
    const monthlyBox = document.getElementById("monthlyRsiChart")?.closest(".monthly-rsi-chart-box");
    if (!panel || !chartBox || !oscillatorBox || !monthlyBox) return false;
    if (document.getElementById("replayDecisionSurfaceV6")) return true;

    const surface = document.createElement("div");
    surface.id = "replayDecisionSurfaceV6";
    surface.className = "replay-decision-surface-v6";
    const oscillatorShell = document.createElement("section");
    oscillatorShell.className = "replay-decision-oscillator-v6";
    const mainShell = document.createElement("section");
    mainShell.className = "replay-decision-main-v6";
    const monthlyShell = document.createElement("section");
    monthlyShell.className = "replay-decision-monthly-v6";
    surface.append(oscillatorShell, mainShell, monthlyShell);

    const heading = panel.querySelector(".replay-chart-heading");
    if (heading?.nextSibling) panel.insertBefore(surface, heading.nextSibling);
    else panel.appendChild(surface);

    const oscillatorHeading = headingForBox(oscillatorBox);
    if (oscillatorHeading) oscillatorShell.appendChild(oscillatorHeading);
    oscillatorShell.appendChild(oscillatorBox);
    ensureOscillatorSettings(oscillatorHeading);

    mainShell.appendChild(chartBox);
    ensureChartSettings(mainShell);
    ensureProfileToolbar(mainShell, chartBox);
    ensurePlaybackDock(mainShell, chartBox);

    const monthlyHeading = headingForBox(monthlyBox);
    if (monthlyHeading) monthlyShell.appendChild(monthlyHeading);
    monthlyShell.appendChild(monthlyBox);

    markCompactStats();
    panel.classList.add("decision-layout-v6-active");
    document.body.classList.add("replay-decision-v6");
    return true;
  }

  function updateProfile(force = false) {
    registerPlugin();
    const source = replayRowsUpToNow();
    if (!source.currentDate) return;
    const key = `${source.currentDate}|${profileState.period}|${profileState.enabled}|${source.rows.length}`;
    if (!force && key === lastSyncKey) return;
    lastSyncKey = key;
    profileState.currentDate = source.currentDate;
    profileState.profile = profileState.enabled ? buildProfile(source.rows) : null;
    updateBinDetail(null);
    const chart = window.Chart?.getChart?.("replayChart");
    if (chart) chart.draw();
    const date = document.getElementById("replayDecisionDateV6");
    const price = document.getElementById("replayDecisionPriceV6");
    const row = currentRowSafe();
    if (date) date.textContent = source.currentDate || "—";
    if (price) price.textContent = formatPrice(row?.close ?? document.getElementById("currentPrice")?.textContent?.replace(/[^0-9.\-]/g, ""));
  }

  function sync() {
    const practice = document.getElementById("practiceArea");
    if (!practice || practice.hidden) return;
    ensureDecisionLayout();
    updateProfile(false);
    const chart = window.Chart?.getChart?.("replayChart");
    if (chart) chart.draw();
  }

  function boot() {
    registerPlugin();
    ensureDecisionLayout();
    syncTimer = window.setInterval(sync, 650);
    window.addEventListener("beforeunload", () => window.clearInterval(syncTimer), { once: true });
  }

  window.KabutaneReplayDecisionV6 = {
    buildProfile,
    filterPeriod,
    monthlyCrossings,
    updateProfile,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
