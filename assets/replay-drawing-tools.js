(function () {
  "use strict";

  if (typeof document === "undefined" || typeof ReplayDrawingCore === "undefined" || typeof Chart === "undefined") return;

  const Core = ReplayDrawingCore;
  const TOOLS = {
    cursor: { label: "移動・閲覧", instruction: "ドラッグで移動、ピンチやホイールで拡大縮小します。チャートタップだけでは注文線を変更しません。" },
    horizontal: { label: "水平線", instruction: "価格を1回タップすると、分析用の水平線を追加します。注文線より細く、先頭に『分析』と表示します。" },
    trend: { label: "トレンドライン", instruction: "始点と終点を順番にタップします。高値同士・安値同士を結ぶ練習に使います。" },
    fibonacci: { label: "フィボナッチ", instruction: "起点と終点を順番にタップします。0〜100%と主要な戻り目安を表示します。" },
    riskReward: { label: "RR目安", instruction: "建値の目安、損切りの目安を順番にタップします。1R・2R・3Rを分析用として表示し、実際の注文には反映しません。" },
    erase: { label: "消しゴム", instruction: "消したい分析線の近くをタップします。注文線は削除されません。" },
  };
  const COLORS = {
    horizontal: "#9b7a48",
    trend: "#3f8f72",
    fibonacci: "#7d6bb2",
    rrEntry: "#a57735",
    rrStop: "#a66b67",
    rrTarget: "#438a78",
    text: "#5e4c59",
  };

  function addId(id) {
    if (typeof ids !== "undefined" && !ids.includes(id)) ids.push(id);
  }

  function installDrawingUi() {
    const controls = document.querySelector(".pro-indicator-controls");
    if (!controls || document.getElementById("analysisDrawingPanel")) return;
    controls.insertAdjacentHTML("afterend", `
      <section id="analysisDrawingPanel" class="analysis-drawing-panel" aria-label="分析用チャート描画">
        <div class="analysis-drawing-heading">
          <div><span class="mini-kicker">CHART DRAWING</span><strong>分析用の描画</strong><small>太い紫・青・ピンクは注文線。細い『分析』線はメモ用で、売買判定に影響しません。</small></div>
          <span id="drawingCount" class="drawing-count">0本</span>
        </div>
        <div class="analysis-drawing-toolbar" role="toolbar" aria-label="描画ツール">
          <button class="drawing-kit-button active" type="button" data-drawing-tool="cursor">↔ 移動</button>
          <button class="drawing-kit-button" type="button" data-drawing-tool="horizontal">— 水平線</button>
          <button class="drawing-kit-button" type="button" data-drawing-tool="trend">／ トレンド</button>
          <button class="drawing-kit-button" type="button" data-drawing-tool="fibonacci">Fib</button>
          <button class="drawing-kit-button" type="button" data-drawing-tool="riskReward">R:R</button>
          <button class="drawing-kit-button" type="button" data-drawing-tool="erase">⌫ 消す</button>
          <label class="drawing-label-input">ラベル<input id="drawingLabel" type="text" maxlength="18" placeholder="例：前回高値"></label>
          <label class="drawing-strength-select">線の強さ<select id="drawingStrength"><option value="soft">補助・薄い</option><option value="normal" selected>標準</option><option value="strong">強調</option></select></label>
          <label class="drawing-visible-toggle"><input id="showAnalysisDrawings" type="checkbox" checked> 表示</label>
          <button id="drawingUndo" class="drawing-kit-button secondary" type="button">1つ戻す</button>
          <button id="drawingClear" class="drawing-kit-button secondary" type="button">全削除</button>
        </div>
        <p id="drawingInstruction" class="drawing-instruction">${TOOLS.cursor.instruction}</p>
        <div class="drawing-line-legend" aria-label="線の見分け方"><span class="order-line-sample">注文線</span><span class="analysis-line-sample">分析線</span><small>分析線は細く半透明、注文線は太く鮮明に表示します。</small></div>
      </section>`);
  }

  installDrawingUi();
  [
    "analysisDrawingPanel", "drawingCount", "drawingLabel", "drawingStrength", "showAnalysisDrawings",
    "drawingUndo", "drawingClear", "drawingInstruction",
  ].forEach(addId);

  state.drawing = {
    tool: "cursor",
    strength: "normal",
    items: [],
    draft: null,
    visible: true,
  };

  function viewport() {
    if (typeof viewportRange === "function") return viewportRange();
    const rows = typeof visibleRows === "function" ? visibleRows() : [];
    const end = Math.max(0, state.cursor || rows.length - 1);
    return { begin: Math.max(0, end - rows.length + 1), end };
  }

  function rgba(hex, alpha) {
    const value = hex.replace("#", "");
    const normalized = value.length === 3 ? value.split("").map((character) => character + character).join("") : value;
    const parsed = Number.parseInt(normalized, 16);
    return `rgba(${(parsed >> 16) & 255},${(parsed >> 8) & 255},${parsed & 255},${alpha})`;
  }

  function relativePosition(event, chart) {
    if (Chart.helpers?.getRelativePosition) return Chart.helpers.getRelativePosition(event, chart);
    const rect = chart.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function eventAnchor(event) {
    const chart = state.chart;
    if (!chart?.scales?.x || !chart?.scales?.y) return null;
    const point = relativePosition(event, chart);
    const visibleIndex = Math.round(chart.scales.x.getValueForPixel(point.x));
    const price = chart.scales.y.getValueForPixel(point.y);
    const rows = visibleRows();
    if (!Number.isFinite(visibleIndex) || !Number.isFinite(price) || !rows.length) return null;
    const local = Core.clamp(visibleIndex, 0, rows.length - 1);
    const range = viewport();
    const row = rows[local];
    return { index: range.begin + local, price, date: row?.date || null };
  }

  function anchorPixel(chart, anchor) {
    if (!anchor) return null;
    const range = viewport();
    const visibleIndex = anchor.index - range.begin;
    return {
      x: chart.scales.x.getPixelForValue(visibleIndex),
      y: chart.scales.y.getPixelForValue(anchor.price),
      visibleIndex,
    };
  }

  function drawingLabel(item, fallback) {
    return item.label ? `分析 ${item.label}` : `分析 ${fallback}`;
  }

  function setStroke(ctx, color, item, dashOverride = null) {
    const style = Core.strengthStyle(item.strength);
    ctx.strokeStyle = rgba(color, style.alpha);
    ctx.lineWidth = style.width;
    ctx.setLineDash(dashOverride || style.dash);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function drawTag(ctx, chartArea, y, text, color, alpha = 0.9) {
    if (!Number.isFinite(y) || y < chartArea.top - 12 || y > chartArea.bottom + 12) return;
    ctx.save();
    ctx.font = "800 10px system-ui, sans-serif";
    const width = Math.min(150, ctx.measureText(text).width + 12);
    const x = chartArea.right - width - 4;
    const top = Core.clamp(y - 10, chartArea.top + 1, chartArea.bottom - 21);
    ctx.fillStyle = rgba("#fffafc", 0.94);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(x, top, width, 20, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 6, top + 10, width - 10);
    ctx.restore();
  }

  function horizontalLine(ctx, chart, price, color, item, label, xStart = null, xEnd = null, dash = null) {
    const y = chart.scales.y.getPixelForValue(price);
    const area = chart.chartArea;
    if (!Number.isFinite(y)) return;
    setStroke(ctx, color, item, dash);
    ctx.beginPath();
    ctx.moveTo(xStart ?? area.left, y);
    ctx.lineTo(xEnd ?? area.right, y);
    ctx.stroke();
    if (label) drawTag(ctx, area, y, label, color, Core.strengthStyle(item.strength).alpha);
  }

  function drawHorizontal(ctx, chart, item) {
    const price = item.anchors?.[0]?.price;
    if (!Number.isFinite(price)) return;
    horizontalLine(ctx, chart, price, COLORS.horizontal, item, drawingLabel(item, "水平"));
  }

  function drawTrend(ctx, chart, item) {
    const start = anchorPixel(chart, item.anchors?.[0]);
    const end = anchorPixel(chart, item.anchors?.[1]);
    if (!start || !end) return;
    setStroke(ctx, COLORS.trend, item);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(COLORS.trend, Core.strengthStyle(item.strength).alpha);
    [start, end].forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2); ctx.fill(); });
    drawTag(ctx, chart.chartArea, end.y, drawingLabel(item, "トレンド"), COLORS.trend);
  }

  function drawFibonacci(ctx, chart, item) {
    const start = anchorPixel(chart, item.anchors?.[0]);
    const end = anchorPixel(chart, item.anchors?.[1]);
    const levels = Core.fibonacciLevels(item);
    if (!start || !end || !levels.length) return;
    const area = chart.chartArea;
    const xStart = Math.max(area.left, Math.min(start.x, end.x));
    const xEnd = area.right;
    const level382 = levels.find((level) => level.ratio === 0.382);
    const level618 = levels.find((level) => level.ratio === 0.618);
    if (level382 && level618) {
      const y1 = chart.scales.y.getPixelForValue(level382.price);
      const y2 = chart.scales.y.getPixelForValue(level618.price);
      ctx.fillStyle = rgba(COLORS.fibonacci, 0.055);
      ctx.fillRect(xStart, Math.min(y1, y2), Math.max(0, xEnd - xStart), Math.abs(y2 - y1));
    }
    levels.forEach((level) => {
      const percent = `${Math.round(level.ratio * 1000) / 10}%`;
      horizontalLine(ctx, chart, level.price, COLORS.fibonacci, item, `分析 Fib ${percent}`, xStart, xEnd, level.ratio === 0.5 ? [] : [4, 4]);
    });
  }

  function drawRiskReward(ctx, chart, item) {
    const anchor = anchorPixel(chart, item.anchors?.[0]);
    const levels = Core.riskRewardLevels(item);
    if (!anchor || !levels) return;
    const area = chart.chartArea;
    const xStart = Core.clamp(anchor.x, area.left, area.right);
    const xEnd = area.right;
    const entryY = chart.scales.y.getPixelForValue(levels.entry);
    const stopY = chart.scales.y.getPixelForValue(levels.stop);
    const finalTarget = levels.targets.at(-1)?.price;
    const targetY = chart.scales.y.getPixelForValue(finalTarget);
    ctx.fillStyle = rgba(COLORS.rrStop, 0.07);
    ctx.fillRect(xStart, Math.min(entryY, stopY), Math.max(0, xEnd - xStart), Math.abs(stopY - entryY));
    ctx.fillStyle = rgba(COLORS.rrTarget, 0.06);
    ctx.fillRect(xStart, Math.min(entryY, targetY), Math.max(0, xEnd - xStart), Math.abs(targetY - entryY));
    horizontalLine(ctx, chart, levels.entry, COLORS.rrEntry, item, drawingLabel(item, "RR 建値"), xStart, xEnd, [8, 4]);
    horizontalLine(ctx, chart, levels.stop, COLORS.rrStop, item, "分析 RR 損切り", xStart, xEnd, [4, 4]);
    levels.targets.forEach((target) => horizontalLine(ctx, chart, target.price, COLORS.rrTarget, item, `分析 RR ${target.ratio}R`, xStart, xEnd, [3, 4]));
  }

  function drawItem(ctx, chart, item) {
    if (!item?.anchors?.length) return;
    if (item.type === "horizontal") drawHorizontal(ctx, chart, item);
    else if (item.type === "trend") drawTrend(ctx, chart, item);
    else if (item.type === "fibonacci") drawFibonacci(ctx, chart, item);
    else if (item.type === "riskReward") drawRiskReward(ctx, chart, item);
  }

  function draftItem() {
    const draft = state.drawing.draft;
    if (!draft?.start || !draft?.preview) return null;
    const options = { id: "drawing-preview", label: els.drawingLabel?.value || "", strength: state.drawing.strength };
    if (draft.type === "trend") return Core.createTrend(draft.start, draft.preview, options);
    if (draft.type === "fibonacci") return Core.createFibonacci(draft.start, draft.preview, options);
    if (draft.type === "riskReward") return Core.createRiskReward(draft.start, draft.preview, options);
    return null;
  }

  const drawingOverlayPlugin = {
    id: "kabutaneAnalysisDrawings",
    afterDatasetsDraw(chart) {
      if (chart.canvas?.id !== "replayChart" || !state.drawing?.visible) return;
      const ctx = chart.ctx;
      const area = chart.chartArea;
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      ctx.clip();
      state.drawing.items.forEach((item) => drawItem(ctx, chart, item));
      const preview = draftItem();
      if (preview) drawItem(ctx, chart, preview);
      ctx.restore();
    },
  };
  Chart.register(drawingOverlayPlugin);

  function updateDrawingUi() {
    document.querySelectorAll("[data-drawing-tool]").forEach((button) => button.classList.toggle("active", button.dataset.drawingTool === state.drawing.tool));
    if (els.drawingInstruction) {
      const draft = state.drawing.draft;
      els.drawingInstruction.textContent = draft ? `${TOOLS[draft.type].label}：2点目をタップしてください。Escで中止できます。` : TOOLS[state.drawing.tool].instruction;
    }
    if (els.drawingCount) els.drawingCount.textContent = `${state.drawing.items.length}本`;
    if (els.drawingUndo) els.drawingUndo.disabled = state.drawing.items.length === 0;
    if (els.drawingClear) els.drawingClear.disabled = state.drawing.items.length === 0;
    els.replayChart?.classList.toggle("drawing-active", state.drawing.tool !== "cursor");
  }

  function setDrawingTool(tool) {
    state.drawing.tool = Object.prototype.hasOwnProperty.call(TOOLS, tool) ? tool : "cursor";
    state.drawing.draft = null;
    if (state.drawing.tool !== "cursor") state.toolMode = "view";
    updateDrawingUi();
    state.chart?.draw();
  }

  function itemOptions() {
    return {
      label: els.drawingLabel?.value || "",
      strength: els.drawingStrength?.value || "normal",
    };
  }

  function addDrawing(item) {
    if (!item?.anchors?.length) return;
    state.drawing.items.push(item);
    state.drawing.draft = null;
    updateDrawingUi();
    renderMainChart();
  }

  function eraseNearest(anchor) {
    const bounds = state.chart?.scales?.y;
    const range = viewport();
    const priceRange = bounds ? Math.abs(bounds.max - bounds.min) : Math.abs(anchor.price || 1);
    const item = Core.nearestItem(state.drawing.items, anchor, {
      index: Math.max(2, Math.round((range.end - range.begin + 1) * 0.035)),
      price: Math.max(priceRange * 0.025, Math.abs(anchor.price) * 0.004),
    });
    if (!item) {
      if (els.drawingInstruction) els.drawingInstruction.textContent = "近くに削除できる分析線がありません。線の近くをタップしてください。";
      return;
    }
    state.drawing.items = state.drawing.items.filter((candidate) => candidate.id !== item.id);
    updateDrawingUi();
    renderMainChart();
  }

  function handleDrawingPoint(anchor) {
    const tool = state.drawing.tool;
    if (tool === "horizontal") {
      addDrawing(Core.createHorizontal(anchor, itemOptions()));
      return;
    }
    if (tool === "erase") {
      eraseNearest(anchor);
      return;
    }
    if (!["trend", "fibonacci", "riskReward"].includes(tool)) return;
    if (!state.drawing.draft) {
      state.drawing.draft = { type: tool, start: anchor, preview: anchor };
      updateDrawingUi();
      state.chart?.draw();
      return;
    }
    const start = state.drawing.draft.start;
    const options = itemOptions();
    if (tool === "trend") addDrawing(Core.createTrend(start, anchor, options));
    else if (tool === "fibonacci") addDrawing(Core.createFibonacci(start, anchor, options));
    else {
      const item = Core.createRiskReward(start, anchor, options);
      const levels = Core.riskRewardLevels(item);
      if (!levels || levels.direction !== "long") {
        state.drawing.draft = null;
        updateDrawingUi();
        if (els.drawingInstruction) els.drawingInstruction.textContent = "買い練習では、2点目の損切りを建値より下へ置いてください。";
        state.chart?.draw();
        return;
      }
      addDrawing(item);
    }
  }

  function bindDrawingPointerCapture() {
    const canvas = els.replayChart;
    if (!canvas || canvas.dataset.drawingBound === "true") return;
    canvas.dataset.drawingBound = "true";

    canvas.addEventListener("pointerdown", (event) => {
      if (state.drawing.tool === "cursor") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.setPointerCapture?.(event.pointerId);
      const anchor = eventAnchor(event);
      if (anchor) handleDrawingPoint(anchor);
    }, true);

    canvas.addEventListener("pointermove", (event) => {
      if (state.drawing.tool === "cursor" || !state.drawing.draft) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const anchor = eventAnchor(event);
      if (!anchor) return;
      state.drawing.draft.preview = anchor;
      state.chart?.draw();
    }, true);

    canvas.addEventListener("pointerup", (event) => {
      if (state.drawing.tool !== "cursor") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // The chart tab is for analysis. A simple tap must not move an order line;
      // the risk tab keeps the existing explicit entry/stop placement behavior.
      if (state.workspaceTab === "chart" && state.chartView) state.chartView.moved = true;
    }, true);

    canvas.addEventListener("pointercancel", (event) => {
      if (state.drawing.tool === "cursor") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  const baseSetToolDrawing = setTool;
  setTool = function setToolDrawing(mode) {
    setDrawingTool("cursor");
    baseSetToolDrawing(mode);
  };

  const baseStartSessionDrawing = startSession;
  startSession = function startSessionDrawing() {
    state.drawing.items = [];
    state.drawing.draft = null;
    setDrawingTool("cursor");
    return baseStartSessionDrawing();
  };

  const baseResetToSetupDrawing = resetToSetup;
  resetToSetup = function resetToSetupDrawing() {
    state.drawing.draft = null;
    setDrawingTool("cursor");
    return baseResetToSetupDrawing();
  };

  const basePriceViewportBoundsDrawing = priceViewportBounds;
  priceViewportBounds = function priceViewportBoundsDrawing(rows) {
    const bounds = basePriceViewportBoundsDrawing(rows);
    if (!bounds || Math.abs((state.chartView?.yScale || 1) - 1) > 0.01 || Math.abs(state.chartView?.yPan || 0) > 0.01) return bounds;
    const prices = Core.collectPrices(state.drawing?.items || []);
    if (!prices.length || !Number.isFinite(bounds.min) || !Number.isFinite(bounds.max)) return bounds;
    const minimum = Math.min(bounds.min, ...prices);
    const maximum = Math.max(bounds.max, ...prices);
    const padding = Math.max(maximum - minimum, Math.abs(maximum) * 0.02) * 0.04;
    return { min: minimum - padding, max: maximum + padding };
  };

  const baseBindEventsDrawing = bindEvents;
  bindEvents = function bindEventsDrawing() {
    baseBindEventsDrawing();
    bindDrawingPointerCapture();
    document.querySelectorAll("[data-drawing-tool]").forEach((button) => button.addEventListener("click", () => setDrawingTool(button.dataset.drawingTool)));
    els.drawingStrength.addEventListener("change", () => {
      state.drawing.strength = Core.normalizeStrength(els.drawingStrength.value);
      state.chart?.draw();
    });
    els.showAnalysisDrawings.addEventListener("change", () => {
      state.drawing.visible = els.showAnalysisDrawings.checked;
      renderMainChart();
    });
    els.drawingUndo.addEventListener("click", () => {
      state.drawing.draft = null;
      state.drawing.items.pop();
      updateDrawingUi();
      renderMainChart();
    });
    els.drawingClear.addEventListener("click", () => {
      if (state.drawing.items.length && !window.confirm("分析用の描画をすべて削除しますか？")) return;
      state.drawing.items = [];
      state.drawing.draft = null;
      updateDrawingUi();
      renderMainChart();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.drawing.draft) {
        state.drawing.draft = null;
        updateDrawingUi();
        state.chart?.draw();
      }
    });
    updateDrawingUi();
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
