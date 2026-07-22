(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const MODES = {
    cursor: { label: "選択" },
    horizontal: { label: "水平線" },
    trend: { label: "トレンドライン" },
    fibonacci: { label: "フィボナッチ" },
    riskreward: { label: "リスクリワード" },
  };
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const model = {
    mode: "cursor",
    drawings: [],
    pending: null,
    selectedId: null,
    sequence: 0,
  };

  function finite(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function visibleChartRows() {
    if (typeof visibleRows === "function") return visibleRows();
    return [];
  }

  function nextId() {
    model.sequence += 1;
    return `drawing-${Date.now()}-${model.sequence}`;
  }

  function installToolbar() {
    const chartPanel = document.querySelector(".pro-chart-panel");
    const chartBox = chartPanel?.querySelector(".pro-main-chart");
    if (!chartPanel || !chartBox || document.getElementById("drawingToolsPanel")) return;
    chartBox.insertAdjacentHTML("beforebegin", `
      <section id="drawingToolsPanel" class="chart-drawing-panel" aria-label="チャート描画ツール">
        <div class="chart-drawing-heading">
          <div><strong>描画ツール</strong><small>分析用の補助線です。注文ラインとは色・太さ・ラベルを分けています。</small></div>
          <span id="drawingStatus" class="drawing-status">選択</span>
        </div>
        <div class="chart-drawing-toolbar" role="toolbar" aria-label="描画ツール選択">
          <button type="button" class="drawing-mode active" data-drawing-mode="cursor">↖ 選択</button>
          <button type="button" class="drawing-mode" data-drawing-mode="horizontal">─ 水平線</button>
          <button type="button" class="drawing-mode" data-drawing-mode="trend">╱ トレンド</button>
          <button type="button" class="drawing-mode" data-drawing-mode="fibonacci">≋ フィボ</button>
          <button type="button" class="drawing-mode" data-drawing-mode="riskreward">▥ R:R</button>
          <button id="drawingUndo" type="button" class="drawing-command">元に戻す</button>
          <button id="drawingDelete" type="button" class="drawing-command" disabled>選択を削除</button>
          <button id="drawingClear" type="button" class="drawing-command danger">すべて消す</button>
        </div>
        <div class="chart-drawing-legend">
          <span class="legend-order">太い色線＝注文</span>
          <span class="legend-analysis">細い灰線＝分析</span>
          <span class="legend-fib">金色破線＝フィボ</span>
          <span class="legend-rr">半透明帯＝R:R</span>
        </div>
      </section>`);
  }

  function setStatus(text) {
    const status = document.getElementById("drawingStatus");
    if (status) status.textContent = text;
  }

  function setMode(mode) {
    model.mode = MODES[mode] ? mode : "cursor";
    model.pending = null;
    document.querySelectorAll("[data-drawing-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.drawingMode === model.mode);
    });
    const hint = model.mode === "horizontal"
      ? "価格を1回タップ"
      : ["trend", "fibonacci", "riskreward"].includes(model.mode)
        ? "始点と終点を2回タップ"
        : model.selectedId ? "描画を選択中" : "選択";
    setStatus(`${MODES[model.mode].label}・${hint}`);
    redraw();
  }

  function chartPoint(event) {
    if (typeof state === "undefined" || !state.chart) return null;
    const canvas = document.getElementById("replayChart");
    const rect = canvas?.getBoundingClientRect();
    const xScale = state.chart.scales?.x;
    const yScale = state.chart.scales?.y;
    const rows = visibleChartRows();
    if (!canvas || !rect || !xScale || !yScale || !rows.length) return null;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const rawIndex = xScale.getValueForPixel(px);
    const index = Math.max(0, Math.min(rows.length - 1, Math.round(finite(rawIndex) ?? 0)));
    const price = finite(yScale.getValueForPixel(py));
    if (price === null) return null;
    return { index, date: rows[index]?.date || "", price };
  }

  function addDrawing(type, start, end = null) {
    const drawing = { id: nextId(), type, start, end, createdAt: Date.now() };
    model.drawings.push(drawing);
    model.selectedId = drawing.id;
    model.pending = null;
    setMode("cursor");
    persist();
    redraw();
  }

  function handleCanvasPointer(event) {
    if (model.mode === "cursor") {
      const point = chartPoint(event);
      if (!point) return;
      const selected = findNearestDrawing(point);
      model.selectedId = selected?.id || null;
      document.getElementById("drawingDelete")?.toggleAttribute("disabled", !model.selectedId);
      setStatus(model.selectedId ? `${drawingName(selected)}を選択` : "選択");
      redraw();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = chartPoint(event);
    if (!point) return;
    if (model.mode === "horizontal") {
      addDrawing("horizontal", point);
      return;
    }
    if (!model.pending) {
      model.pending = { type: model.mode, start: point };
      setStatus(`${MODES[model.mode].label}・終点をタップ`);
      redraw();
      return;
    }
    addDrawing(model.pending.type, model.pending.start, point);
  }

  function drawingName(drawing) {
    return ({ horizontal: "水平線", trend: "トレンドライン", fibonacci: "フィボナッチ", riskreward: "R:R目安" })[drawing?.type] || "描画";
  }

  function linePriceAt(drawing, index) {
    if (drawing.type === "horizontal" || !drawing.end) return drawing.start.price;
    const dx = drawing.end.index - drawing.start.index;
    if (!dx) return drawing.start.price;
    const ratio = (index - drawing.start.index) / dx;
    return drawing.start.price + (drawing.end.price - drawing.start.price) * ratio;
  }

  function findNearestDrawing(point) {
    let best = null;
    let distance = Infinity;
    const chart = state?.chart;
    const yScale = chart?.scales?.y;
    if (!yScale) return null;
    const threshold = Math.max(4, Math.abs(yScale.getValueForPixel(0) - yScale.getValueForPixel(12)));
    model.drawings.forEach((drawing) => {
      let candidateDistance;
      if (drawing.type === "fibonacci" && drawing.end) {
        const low = Math.min(drawing.start.price, drawing.end.price);
        const high = Math.max(drawing.start.price, drawing.end.price);
        candidateDistance = Math.min(...FIB_LEVELS.map((level) => Math.abs(point.price - (low + (high - low) * level))));
      } else if (drawing.type === "riskreward" && drawing.end) {
        candidateDistance = Math.min(Math.abs(point.price - drawing.start.price), Math.abs(point.price - drawing.end.price));
      } else {
        candidateDistance = Math.abs(point.price - linePriceAt(drawing, point.index));
      }
      if (candidateDistance < distance && candidateDistance <= threshold) {
        best = drawing;
        distance = candidateDistance;
      }
    });
    return best;
  }

  function persist() {
    try {
      const code = typeof state !== "undefined" ? state.code : "default";
      localStorage.setItem(`kabutane-drawings-${code || "default"}`, JSON.stringify(model.drawings));
    } catch (_) {}
  }

  function restore() {
    try {
      const code = typeof state !== "undefined" ? state.code : "default";
      const stored = JSON.parse(localStorage.getItem(`kabutane-drawings-${code || "default"}`) || "[]");
      model.drawings = Array.isArray(stored) ? stored.filter((drawing) => drawing?.type && drawing?.start) : [];
    } catch (_) {
      model.drawings = [];
    }
  }

  function pricePixel(chart, price) {
    return chart.scales.y.getPixelForValue(price);
  }

  function indexPixel(chart, index) {
    return chart.scales.x.getPixelForValue(index);
  }

  function label(ctx, text, x, y, selected = false) {
    ctx.save();
    ctx.font = "800 10px system-ui";
    const width = ctx.measureText(text).width + 12;
    ctx.fillStyle = selected ? "rgba(72,55,70,.94)" : "rgba(255,255,255,.92)";
    ctx.strokeStyle = selected ? "rgba(255,255,255,.8)" : "rgba(91,74,87,.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y - 11, width, 20, 6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = selected ? "#fff" : "#63515f";
    ctx.fillText(text, x + 6, y + 3);
    ctx.restore();
  }

  function drawHorizontal(ctx, chart, drawing, selected) {
    const area = chart.chartArea;
    const y = pricePixel(chart, drawing.start.price);
    ctx.save();
    ctx.strokeStyle = selected ? "rgba(76,59,73,.95)" : "rgba(87,80,86,.66)";
    ctx.lineWidth = selected ? 2 : 1.2;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(area.left, y); ctx.lineTo(area.right, y); ctx.stroke();
    ctx.restore();
    label(ctx, `分析 H ${Math.round(drawing.start.price).toLocaleString("ja-JP")}`, area.left + 5, y - 8, selected);
  }

  function drawTrend(ctx, chart, drawing, selected) {
    if (!drawing.end) return;
    const x1 = indexPixel(chart, drawing.start.index);
    const y1 = pricePixel(chart, drawing.start.price);
    const x2 = indexPixel(chart, drawing.end.index);
    const y2 = pricePixel(chart, drawing.end.price);
    ctx.save();
    ctx.strokeStyle = selected ? "rgba(54,49,54,.98)" : "rgba(70,66,70,.78)";
    ctx.lineWidth = selected ? 2.4 : 1.5;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    [ [x1,y1], [x2,y2] ].forEach(([x,y]) => { ctx.beginPath(); ctx.arc(x,y, selected ? 4 : 3,0,Math.PI*2); ctx.fill(); });
    ctx.restore();
    label(ctx, "分析 TREND", Math.min(x1, x2) + 5, Math.min(y1, y2) - 8, selected);
  }

  function drawFibonacci(ctx, chart, drawing, selected) {
    if (!drawing.end) return;
    const area = chart.chartArea;
    const low = Math.min(drawing.start.price, drawing.end.price);
    const high = Math.max(drawing.start.price, drawing.end.price);
    const x1 = Math.min(indexPixel(chart, drawing.start.index), indexPixel(chart, drawing.end.index));
    const x2 = Math.max(indexPixel(chart, drawing.start.index), indexPixel(chart, drawing.end.index));
    ctx.save();
    FIB_LEVELS.forEach((level) => {
      const price = low + (high - low) * level;
      const y = pricePixel(chart, price);
      ctx.strokeStyle = selected ? "rgba(173,115,20,.92)" : "rgba(196,144,55,.72)";
      ctx.lineWidth = selected ? 1.8 : 1.1;
      ctx.setLineDash(level === 0 || level === 1 ? [] : [6, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(Math.max(x2, area.right), y); ctx.stroke();
      ctx.fillStyle = "rgba(131,92,31,.9)";
      ctx.font = "700 9px system-ui";
      ctx.fillText(`${(level * 100).toFixed(level === 0 || level === 1 ? 0 : 1)}%`, x1 + 4, y - 3);
    });
    ctx.restore();
    label(ctx, "分析 FIB", x1 + 4, pricePixel(chart, high) - 13, selected);
  }

  function drawRiskReward(ctx, chart, drawing, selected) {
    if (!drawing.end) return;
    const area = chart.chartArea;
    const x1 = Math.min(indexPixel(chart, drawing.start.index), indexPixel(chart, drawing.end.index));
    const x2 = Math.max(indexPixel(chart, drawing.start.index), indexPixel(chart, drawing.end.index));
    const entry = drawing.start.price;
    const stop = drawing.end.price;
    const risk = Math.abs(entry - stop);
    const direction = entry >= stop ? 1 : -1;
    const target = entry + risk * 2 * direction;
    const entryY = pricePixel(chart, entry);
    const stopY = pricePixel(chart, stop);
    const targetY = pricePixel(chart, target);
    const left = Math.max(area.left, x1);
    const right = Math.min(area.right, Math.max(x2, left + 80));
    ctx.save();
    ctx.fillStyle = "rgba(67,151,126,.12)";
    ctx.fillRect(left, Math.min(entryY, targetY), right - left, Math.abs(targetY - entryY));
    ctx.fillStyle = "rgba(210,92,121,.12)";
    ctx.fillRect(left, Math.min(entryY, stopY), right - left, Math.abs(stopY - entryY));
    [
      [entryY, "rgba(94,79,91,.78)", "ENTRY"],
      [stopY, "rgba(190,68,98,.78)", "STOP"],
      [targetY, "rgba(48,137,111,.78)", "2R"],
    ].forEach(([y, color, text]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 2 : 1.25;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = color; ctx.font = "800 9px system-ui"; ctx.fillText(text, right + 4, y + 3);
    });
    ctx.restore();
    label(ctx, "分析 R:R 1:2", left + 4, Math.min(targetY, stopY) - 10, selected);
  }

  function drawPending(ctx, chart) {
    if (!model.pending) return;
    const x = indexPixel(chart, model.pending.start.index);
    const y = pricePixel(chart, model.pending.start.price);
    ctx.save();
    ctx.fillStyle = "rgba(91,72,88,.9)";
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(91,72,88,.5)";
    ctx.beginPath(); ctx.moveTo(chart.chartArea.left, y); ctx.lineTo(chart.chartArea.right, y); ctx.stroke();
    ctx.restore();
  }

  const drawingPlugin = {
    id: "kabutaneDrawings",
    afterDatasetsDraw(chart) {
      if (!chart?.chartArea || chart.canvas?.id !== "replayChart") return;
      const ctx = chart.ctx;
      model.drawings.forEach((drawing) => {
        const selected = drawing.id === model.selectedId;
        if (drawing.type === "horizontal") drawHorizontal(ctx, chart, drawing, selected);
        else if (drawing.type === "trend") drawTrend(ctx, chart, drawing, selected);
        else if (drawing.type === "fibonacci") drawFibonacci(ctx, chart, drawing, selected);
        else if (drawing.type === "riskreward") drawRiskReward(ctx, chart, drawing, selected);
      });
      drawPending(ctx, chart);
    },
  };

  function redraw() {
    if (typeof state !== "undefined" && state.chart) state.chart.draw();
  }

  function bind() {
    installToolbar();
    document.querySelectorAll("[data-drawing-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.drawingMode));
    });
    document.getElementById("drawingUndo")?.addEventListener("click", () => {
      model.drawings.pop(); model.selectedId = null; persist(); redraw();
    });
    document.getElementById("drawingDelete")?.addEventListener("click", () => {
      if (!model.selectedId) return;
      model.drawings = model.drawings.filter((drawing) => drawing.id !== model.selectedId);
      model.selectedId = null; persist(); redraw();
      document.getElementById("drawingDelete")?.setAttribute("disabled", "");
      setStatus("選択");
    });
    document.getElementById("drawingClear")?.addEventListener("click", () => {
      model.drawings = []; model.pending = null; model.selectedId = null; persist(); redraw();
      document.getElementById("drawingDelete")?.setAttribute("disabled", "");
      setStatus("すべて消去しました");
    });
    const canvas = document.getElementById("replayChart");
    canvas?.addEventListener("pointerup", handleCanvasPointer, true);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setMode("cursor");
      if ((event.key === "Delete" || event.key === "Backspace") && model.selectedId && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
        event.preventDefault();
        document.getElementById("drawingDelete")?.click();
      }
    });
  }

  function init() {
    if (typeof Chart !== "undefined") Chart.register(drawingPlugin);
    restore();
    bind();
  }

  window.ReplayDrawingTools = {
    model,
    setMode,
    clear() { model.drawings = []; persist(); redraw(); },
    exportDrawings() { return JSON.parse(JSON.stringify(model.drawings)); },
  };
  document.addEventListener("DOMContentLoaded", init);
})();
