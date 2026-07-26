(function () {
  "use strict";

  if (typeof document === "undefined" || typeof DetailChartViewportCore === "undefined" || typeof window.renderCharts !== "function") return;
  const Core = DetailChartViewportCore;
  const baseRenderCharts = window.renderCharts;
  const minimumPoints = 12;
  let fullPayload = null;
  let range = null;
  let yScale = 1;
  let yPan = 0;
  let heightMode = localStorage.getItem("kabutane-detail-chart-height") || "standard";
  let frame = 0;
  const pointers = new Map();
  let gesture = null;

  function preferredPoints() {
    if (window.innerWidth <= 520) return 55;
    if (window.innerWidth <= 900) return 80;
    return 120;
  }

  function totalRows() {
    return Array.isArray(fullPayload?.daily) ? fullPayload.daily.length : 0;
  }

  function ensureRange() {
    const total = totalRows();
    if (!range || range.end >= total || range.span <= 0) range = Core.latestRange(total, preferredPoints(), minimumPoints);
    else range = Core.normalizeRange(total, range.start, range.end, minimumPoints);
    return range;
  }

  function displayedRows() {
    if (!fullPayload?.daily?.length || !range?.span) return [];
    return fullPayload.daily.slice(range.start, range.end + 1);
  }

  function priceValues(rows) {
    const values = [];
    rows.forEach((row) => {
      [row.low, row.high, row.close, row.sma25, row.sma75, row.sma200].forEach((value) => {
        const parsed = Core.finite(value);
        if (parsed !== null) values.push(parsed);
      });
    });
    return values;
  }

  function applyVerticalViewport() {
    if (!window.priceChart) return;
    const bounds = Core.verticalBounds(priceValues(displayedRows()), yScale, yPan, 0.055);
    if (Number.isFinite(bounds.min) && Number.isFinite(bounds.max)) {
      window.priceChart.options.scales.y.min = bounds.min;
      window.priceChart.options.scales.y.max = bounds.max;
    }
    window.priceChart.update("none");
  }

  function formatDate(value) {
    if (!value) return "—";
    const [year, month, day] = String(value).split("-");
    return year && month && day ? `${year}/${Number(month)}/${Number(day)}` : String(value);
  }

  function updateToolbar() {
    const rows = displayedRows();
    const total = totalRows();
    const first = rows[0]?.date;
    const last = rows.at(-1)?.date;
    const latest = fullPayload?.daily_price_date || fullPayload?.daily?.at(-1)?.date || last;
    const status = document.getElementById("detailChartViewportStatus");
    if (status) status.textContent = `表示 ${formatDate(first)}〜${formatDate(last)}｜${range?.span || 0}/${total}営業日｜最新日足 ${formatDate(latest)}`;
    const height = document.querySelector('[data-detail-chart-action="height"]');
    if (height) height.textContent = `高さ：${heightMode === "compact" ? "小" : heightMode === "tall" ? "大" : "標準"}`;
    document.body.dataset.detailChartHeight = heightMode;
    const rsiStatus = document.getElementById("detailRsiSyncStatus");
    if (rsiStatus) rsiStatus.textContent = `日足チャートと同じ期間を表示中：${formatDate(first)}〜${formatDate(last)}`;
  }

  function renderViewport() {
    if (!fullPayload) return;
    ensureRange();
    window.renderCharts(fullPayload);
  }

  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderViewport();
    });
  }

  window.renderCharts = function renderChartsWithViewport(payload) {
    if (payload && Array.isArray(payload.daily)) {
      if (!payload.__detailViewportSlice) fullPayload = payload;
      else if (!fullPayload) fullPayload = payload;
    }
    if (!fullPayload) return baseRenderCharts(payload);
    ensureRange();
    const sliced = Core.slicePayload(fullPayload, range);
    sliced.__detailViewportSlice = true;
    baseRenderCharts(sliced);
    applyVerticalViewport();
    updateToolbar();
  };

  function zoom(factor, anchorRatio = 0.5) {
    ensureRange();
    const anchor = range.start + (range.span - 1) * Core.clamp(anchorRatio, 0, 1);
    range = Core.zoomRange(range, factor, anchor, totalRows(), minimumPoints);
    scheduleRender();
  }

  function pan(delta) {
    ensureRange();
    range = Core.panRange(range, delta, totalRows(), minimumPoints);
    scheduleRender();
  }

  function latest() {
    ensureRange();
    range = Core.latestRange(totalRows(), range.span, minimumPoints);
    scheduleRender();
  }

  function reset() {
    range = Core.latestRange(totalRows(), preferredPoints(), minimumPoints);
    yScale = 1;
    yPan = 0;
    scheduleRender();
  }

  function showAll() {
    range = Core.normalizeRange(totalRows(), 0, totalRows() - 1, minimumPoints);
    scheduleRender();
  }

  function changeHeight() {
    heightMode = Core.nextHeightMode(heightMode);
    localStorage.setItem("kabutane-detail-chart-height", heightMode);
    document.body.dataset.detailChartHeight = heightMode;
    updateToolbar();
    requestAnimationFrame(() => {
      window.priceChart?.resize?.();
      window.rsiChart?.resize?.();
    });
  }

  function handleAction(action) {
    ensureRange();
    if (action === "zoom-in") zoom(0.72);
    else if (action === "zoom-out") zoom(1.38);
    else if (action === "older") pan(-Math.max(1, Math.round(range.span * 0.28)));
    else if (action === "newer") pan(Math.max(1, Math.round(range.span * 0.28)));
    else if (action === "latest") latest();
    else if (action === "all") showAll();
    else if (action === "vertical-in") { yScale = Core.clamp(yScale * 0.78, 0.25, 5); scheduleRender(); }
    else if (action === "vertical-out") { yScale = Core.clamp(yScale * 1.28, 0.25, 5); scheduleRender(); }
    else if (action === "height") changeHeight();
    else if (action === "reset") reset();
  }

  function installToolbar() {
    const pricePanel = document.querySelector(".price-chart-box")?.closest(".chart-panel");
    const rsiPanel = document.querySelector(".rsi-chart-box")?.closest(".chart-panel");
    if (!pricePanel || document.getElementById("detailChartViewportToolbar")) return;
    const toolbar = document.createElement("div");
    toolbar.id = "detailChartViewportToolbar";
    toolbar.className = "detail-chart-viewport-toolbar";
    toolbar.innerHTML = `
      <div class="detail-chart-viewport-actions" role="group" aria-label="チャートの表示範囲を操作">
        <button type="button" data-detail-chart-action="zoom-in" aria-label="期間を拡大">＋拡大</button>
        <button type="button" data-detail-chart-action="zoom-out" aria-label="期間を縮小">−縮小</button>
        <button type="button" data-detail-chart-action="older" aria-label="過去へ移動">← 過去</button>
        <button type="button" data-detail-chart-action="newer" aria-label="新しい日付へ移動">最新方向 →</button>
        <button type="button" data-detail-chart-action="latest">最新</button>
        <button type="button" data-detail-chart-action="all">全期間</button>
        <button type="button" data-detail-chart-action="vertical-in" aria-label="ローソク足を縦方向に拡大">縦＋</button>
        <button type="button" data-detail-chart-action="vertical-out" aria-label="ローソク足を縦方向に縮小">縦−</button>
        <button type="button" data-detail-chart-action="height">高さ：標準</button>
        <button type="button" data-detail-chart-action="reset">戻す</button>
      </div>
      <div class="detail-chart-viewport-meta">
        <strong id="detailChartViewportStatus">表示期間を準備中…</strong>
        <small>チャートを左右へドラッグ。2本指のピンチ、またはCtrl＋ホイールでも拡大縮小できます。</small>
      </div>`;
    const chartBox = pricePanel.querySelector(".price-chart-box");
    pricePanel.insertBefore(toolbar, chartBox);
    pricePanel.classList.add("detail-chart-interactive");
    rsiPanel?.classList.add("detail-chart-interactive", "detail-rsi-synced");
    if (rsiPanel) {
      const sync = document.createElement("p");
      sync.id = "detailRsiSyncStatus";
      sync.className = "detail-rsi-sync-status";
      rsiPanel.insertBefore(sync, rsiPanel.querySelector(".rsi-chart-box"));
    }
    document.body.dataset.detailChartHeight = heightMode;
  }

  function pointerPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width };
  }

  function beginGesture(event, canvas) {
    pointers.set(event.pointerId, pointerPosition(event, canvas));
    canvas.setPointerCapture?.(event.pointerId);
    const values = [...pointers.values()];
    ensureRange();
    if (values.length === 1) {
      gesture = { type: "pan", startRange: { ...range }, startX: values[0].x, width: values[0].width, moved: false };
    } else if (values.length === 2) {
      const distance = Math.abs(values[1].x - values[0].x) || 1;
      gesture = {
        type: "pinch",
        startRange: { ...range },
        distance,
        midpoint: (values[0].x + values[1].x) / 2,
        width: values[0].width,
      };
    }
  }

  function moveGesture(event, canvas) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointerPosition(event, canvas));
    const values = [...pointers.values()];
    if (values.length >= 2) {
      const distance = Math.abs(values[1].x - values[0].x) || 1;
      if (!gesture || gesture.type !== "pinch") {
        gesture = { type: "pinch", startRange: { ...range }, distance, midpoint: (values[0].x + values[1].x) / 2, width: values[0].width };
        return;
      }
      const midpoint = (values[0].x + values[1].x) / 2;
      const anchorRatio = Core.clamp(midpoint / Math.max(1, gesture.width), 0, 1);
      const anchor = gesture.startRange.start + (gesture.startRange.span - 1) * anchorRatio;
      range = Core.zoomRange(gesture.startRange, gesture.distance / distance, anchor, totalRows(), minimumPoints);
      event.preventDefault();
      scheduleRender();
      return;
    }
    if (!gesture || gesture.type !== "pan" || values.length !== 1) return;
    const dx = values[0].x - gesture.startX;
    if (Math.abs(dx) < 7 && !gesture.moved) return;
    gesture.moved = true;
    const candleDelta = Math.round(-dx / Math.max(1, gesture.width) * gesture.startRange.span);
    range = Core.panRange(gesture.startRange, candleDelta, totalRows(), minimumPoints);
    event.preventDefault();
    scheduleRender();
  }

  function endGesture(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size) gesture = null;
    else {
      const value = [...pointers.values()][0];
      gesture = { type: "pan", startRange: { ...range }, startX: value.x, width: value.width, moved: false };
    }
  }

  function bindCanvas(canvas) {
    if (!canvas || canvas.dataset.viewportBound === "true") return;
    canvas.dataset.viewportBound = "true";
    canvas.addEventListener("pointerdown", (event) => beginGesture(event, canvas));
    canvas.addEventListener("pointermove", (event) => moveGesture(event, canvas));
    canvas.addEventListener("pointerup", endGesture);
    canvas.addEventListener("pointercancel", endGesture);
    canvas.addEventListener("lostpointercapture", endGesture);
    canvas.addEventListener("wheel", (event) => {
      if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchorRatio = Core.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      zoom(event.deltaY < 0 ? 0.82 : 1.22, anchorRatio);
    }, { passive: false });
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-detail-chart-action]")?.dataset.detailChartAction;
    if (action) handleAction(action);
  });

  installToolbar();
  bindCanvas(document.getElementById("priceChart"));
  bindCanvas(document.getElementById("rsiChart"));
  window.addEventListener("resize", () => {
    window.priceChart?.resize?.();
    window.rsiChart?.resize?.();
  });

  window.DetailChartViewport = {
    reset,
    latest,
    showAll,
    zoomIn: () => zoom(0.72),
    zoomOut: () => zoom(1.38),
    getRange: () => ({ ...ensureRange() }),
  };
})();
