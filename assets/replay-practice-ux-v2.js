(function () {
  "use strict";

  if (typeof document === "undefined" || typeof ReplayPracticeScoreV2 === "undefined") return;

  const THESIS_OPTIONS = [
    ["", "選んでね"], ["pullback", "押し目・支持線"], ["breakout", "高値・抵抗線の突破"],
    ["trend", "移動平均線の並び・傾き"], ["volume", "出来高の変化"], ["monthly_rsi", "月足RSIの勢い"],
    ["earnings", "決算後の値動き"], ["rights", "権利落ち後の値動き"], ["other", "その他"],
  ];
  const EVENT_OPTIONS = [
    ["", "選んでね"], ["normal", "特別なイベントなし"], ["earnings_after", "決算発表直後"],
    ["earnings_cross", "決算を跨ぐ予定"], ["rights_before", "権利付き最終日前"], ["rights_cross", "権利を跨ぐ予定"],
    ["ex_rights", "権利落ち直後"], ["split", "株式分割前後"], ["unknown", "イベント情報を確認できていない"],
  ];
  const PLAN_OPTIONS = [
    ["", "選んでね"], ["planned", "計画どおり"], ["condition_changed", "条件が変わったので変更"], ["emotion", "不安・焦りで変更"],
  ];
  const EXIT_OPTIONS = [
    ["", "売る時に選ぶ"], ["planned_target", "予定していた利確位置"], ["trend_break", "移動平均線・勢いが崩れた"],
    ["earnings_reduce", "決算前後で保有を減らす"], ["rights_reduce", "権利日前後で保有を減らす"],
    ["capital_rotation", "別銘柄へ資金を移す"], ["planned_stop", "予定していた損切り"], ["anxiety", "不安になって売った"], ["other", "その他"],
  ];
  const REMAINING_OPTIONS = [["", "部分利確時に選ぶ"], ["entry", "損切りを建値へ"], ["trail", "直近安値へ切り上げ"], ["keep", "元の損切りを維持"], ["none", "残りもすぐ売る"]];

  let currentScore = null;
  let draggingStop = null;
  let renderFrame = null;

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function optionMarkup(options) {
    return options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  }

  function ensureAudit(reset = false) {
    if (reset || !state.practiceAudit) {
      state.practiceAudit = {
        version: 2,
        pendingDecision: { thesis: "", eventContext: "", planStatus: "planned", exitReason: "", remainingStopDecision: "", note: "", plannedSplitCount: 1 },
        stopWidened: false,
        planChanged: false,
        planChangesRecorded: false,
        reviewed: false,
        plannedShares: null,
        peakShares: 0,
        positionRiskPct: null,
        allocationUsedPct: null,
        previousStop: null,
      };
    }
    return state.practiceAudit;
  }

  function decisionFields(prefix = "practice") {
    const audit = ensureAudit();
    const decision = audit.pendingDecision;
    return `
      <div class="practice-decision-grid">
        <label>エントリー・追加の理由<select data-decision-field="thesis" id="${prefix}Thesis">${optionMarkup(THESIS_OPTIONS)}</select></label>
        <label>決算・権利など<select data-decision-field="eventContext" id="${prefix}Event">${optionMarkup(EVENT_OPTIONS)}</select></label>
        <label>計画との関係<select data-decision-field="planStatus" id="${prefix}Plan">${optionMarkup(PLAN_OPTIONS)}</select></label>
        <label>予定した買い方<select data-decision-field="plannedSplitCount" id="${prefix}Split"><option value="1">一括</option><option value="2">2分割</option><option value="4">4分割</option></select></label>
        <label>売却理由<select data-decision-field="exitReason" id="${prefix}Exit">${optionMarkup(EXIT_OPTIONS)}</select></label>
        <label>部分利確後の守り方<select data-decision-field="remainingStopDecision" id="${prefix}Remaining">${optionMarkup(REMAINING_OPTIONS)}</select></label>
        <label class="practice-decision-note">ひと言メモ<input data-decision-field="note" id="${prefix}Note" type="text" maxlength="100" placeholder="何を見て、どう考えたか"></label>
      </div>
      <p class="practice-decision-status">選んだ内容は、次の買い・売り履歴に一緒に保存されるよ。</p>`;
  }

  function syncDecisionControls(root = document) {
    const decision = ensureAudit().pendingDecision;
    root.querySelectorAll("[data-decision-field]").forEach((element) => {
      const key = element.dataset.decisionField;
      if (document.activeElement !== element) element.value = decision[key] ?? "";
    });
  }

  function injectDecisionPanel() {
    const orderPanel = document.querySelector(".order-panel");
    if (!orderPanel || document.getElementById("practiceDecisionPanel")) return;
    const memo = orderPanel.querySelector(".memo-label");
    const panel = document.createElement("section");
    panel.id = "practiceDecisionPanel";
    panel.className = "practice-decision-panel";
    panel.innerHTML = `<div class="practice-decision-heading"><strong>今回の判断を残す</strong><small>自由練習でも採点対象</small></div>${decisionFields("practice")}`;
    memo?.insertAdjacentElement("beforebegin", panel);
    syncDecisionControls(panel);
  }

  function injectGuidedDecisionCard() {
    const body = document.getElementById("guidedSheetBody");
    if (!body || body.querySelector(".guided-decision-card")) return;
    const confirmEntry = body.querySelector('[data-guided-action="confirm-entry"]');
    const guideStep = state.guided?.step;
    if (!confirmEntry && !["targetDecision", "decision"].includes(guideStep)) return;
    const card = document.createElement("section");
    card.className = "guided-decision-card";
    card.innerHTML = `<strong>${confirmEntry ? "入る理由も残そう" : "売る理由も残そう"}</strong>${decisionFields(confirmEntry ? "guidedEntry" : "guidedExit")}`;
    const actions = body.querySelector(".guided-sheet-actions");
    actions?.insertAdjacentElement("beforebegin", card);
    syncDecisionControls(card);
  }

  function currentStop() {
    return number(state.plan?.activeStop ?? state.plan?.initialStop ?? state.guided?.pendingStop ?? els?.stopPrice?.value);
  }

  function currentEntry() {
    return number(state.plan?.entry ?? state.guided?.pendingEntry ?? els?.entryPrice?.value);
  }

  function stopStep() {
    const mode = document.getElementById("practiceStopStep")?.value || "yen";
    const row = typeof currentRow === "function" ? currentRow() : null;
    const price = currentStop() ?? number(row?.close) ?? 1;
    if (mode === "pct") return Math.max(0.1, price * 0.001);
    if (mode === "atr") {
      const atrPct = number(row?.atr14_pct ?? row?.atr14Pct ?? row?.atrPct);
      return atrPct !== null ? Math.max(0.1, Number(row.close) * atrPct / 100 * 0.25) : Math.max(0.1, price * 0.0025);
    }
    return price < 100 ? 0.1 : 1;
  }

  function showNotice(text, error = false) {
    const nodes = [document.getElementById("guidedNotice"), document.getElementById("riskPlanNotice"), document.getElementById("orderMessage")].filter(Boolean);
    nodes.forEach((node) => { node.textContent = text; node.classList.toggle("negative", error); });
  }

  function updateStopValue(value, options = {}) {
    const next = number(value);
    if (next === null || next <= 0) return false;
    const audit = ensureAudit();
    const previous = currentStop();
    const entry = currentEntry();
    const hasPosition = Number(state.account?.shares || 0) > 0;
    const guided = state.guided?.mode === "guided";
    if (!hasPosition && entry !== null && next >= entry) {
      if (!options.silent) showNotice("損切りはエントリー価格より下に置いてね。", true);
      return false;
    }
    if (hasPosition && previous !== null && next < previous - Math.max(0.01, Math.abs(previous) * 0.00001)) {
      audit.planChanged = true;
      if (guided) {
        if (!options.silent) showNotice("はじめてモードでは、買った後に損切りを遠ざけないよ。上へ動かすことはできるよ。", true);
        return false;
      }
      audit.stopWidened = true;
      audit.planChangesRecorded = audit.pendingDecision.planStatus === "condition_changed" && Boolean(String(audit.pendingDecision.note || "").trim());
    }
    if (state.guided) state.guided.pendingStop = next;
    if (!hasPosition) state.plan.initialStop = next;
    state.plan.activeStop = next;
    if (els?.stopPrice) els.stopPrice.value = next.toFixed(2);
    const guidedInput = document.getElementById("guidedStopInput");
    if (guidedInput) guidedInput.value = next.toFixed(2);
    audit.previousStop = next;
    const valueNode = document.getElementById("practiceStopValue");
    if (valueNode) valueNode.textContent = `${Math.round(next * 100) / 100}円`;
    if (!hasPosition && typeof recalculatePlan === "function") recalculatePlan();
    if (options.light && state.chart) state.chart.draw();
    else if (typeof renderAll === "function") renderAll();
    return true;
  }

  function adjustStop(direction) {
    const stop = currentStop();
    if (stop === null) return showNotice("先に損切り価格を置いてね。", true);
    updateStopValue(stop + stopStep() * direction);
  }

  function applyChartShape(shape) {
    const selected = ["auto", "tall", "wide"].includes(shape) ? shape : "auto";
    document.body.dataset.replayChartShape = selected;
    localStorage.setItem("kabutane-replay-chart-shape", selected);
    document.querySelectorAll("[data-chart-shape]").forEach((button) => button.classList.toggle("active", button.dataset.chartShape === selected));
    if (state.chartView && selected !== "auto") {
      state.chartView.bars = selected === "tall" ? 34 : 72;
      state.chartView.userSizedX = true;
    } else if (state.chartView && typeof defaultViewportBars === "function") {
      state.chartView.bars = defaultViewportBars();
      state.chartView.userSizedX = false;
    }
    if (typeof scheduleViewportRender === "function" && !els?.practiceArea?.hidden) scheduleViewportRender();
  }

  function toggleChartFocus() {
    const active = document.body.classList.toggle("replay-chart-focus");
    const button = document.getElementById("practiceChartFocus");
    if (button) button.textContent = active ? "集中表示を終了" : "チャート集中";
    if (active) document.querySelector(".replay-chart-panel")?.scrollTo?.({ top: 0 });
    setTimeout(() => { state.chart?.resize?.(); }, 30);
  }

  function injectChartTools() {
    const chartBox = document.querySelector(".pro-main-chart");
    if (!chartBox || document.getElementById("practiceChartTools")) return;
    const tools = document.createElement("section");
    tools.id = "practiceChartTools";
    tools.className = "practice-chart-tools";
    tools.innerHTML = `
      <div class="practice-chart-tools-row"><strong>スマホ表示</strong><div class="practice-view-modes"><button type="button" class="practice-view-button" data-chart-shape="auto">自動</button><button type="button" class="practice-view-button" data-chart-shape="tall">縦長・価格を置く</button><button type="button" class="practice-view-button" data-chart-shape="wide">横長・流れを見る</button></div><button id="practiceChartFocus" type="button" class="practice-tool-button primary">チャート集中</button></div>
      <div class="practice-chart-tools-row"><strong>見える価格帯</strong><div class="practice-price-controls"><button type="button" class="practice-tool-button" data-price-pan="up">価格帯↑</button><button type="button" class="practice-tool-button" data-price-pan="down">価格帯↓</button><button type="button" class="practice-tool-button" data-price-reset>表示を戻す</button></div></div>
      <div class="practice-chart-tools-row"><strong>損切りライン</strong><div class="practice-stop-controls"><button type="button" class="practice-tool-button" data-stop-adjust="down">SL▼</button><span id="practiceStopValue" class="practice-stop-value">—</span><button type="button" class="practice-tool-button" data-stop-adjust="up">SL▲</button><select id="practiceStopStep" class="practice-stop-step"><option value="yen">1円刻み</option><option value="pct">0.1%</option><option value="atr">0.25ATR</option></select></div></div>
      <p class="practice-chart-help"><b>ローソク足を上下にドラッグ</b>すると表示範囲が動くよ。青いSLタグ付近をドラッグすると、損切り価格だけを動かせるよ。</p>`;
    chartBox.insertAdjacentElement("beforebegin", tools);
    applyChartShape(localStorage.getItem("kabutane-replay-chart-shape") || "auto");
    const stop = currentStop();
    if (stop !== null) document.getElementById("practiceStopValue").textContent = `${Math.round(stop * 100) / 100}円`;
  }

  function scoreInput() {
    const audit = ensureAudit();
    const row = typeof currentRow === "function" ? currentRow() : null;
    const metrics = typeof ReplayPro !== "undefined" ? ReplayPro.accountMetrics(state.account, row?.close, state.initialCapital) : {};
    audit.reviewed = audit.reviewed || state.trades.some((trade) => String(trade.memo || "").trim() || String(trade?.decision?.note || "").trim());
    return {
      trades: state.trades,
      rows: state.rows,
      audit,
      plan: state.plan,
      riskPct: state.riskPct,
      allocationPct: state.allocationPct,
      initialCapital: state.initialCapital,
      metrics,
      maxDrawdown: state.maxDrawdown,
    };
  }

  function calculateScore() {
    currentScore = ReplayPracticeScoreV2.calculate(scoreInput());
    return currentScore;
  }

  function renderScore() {
    const holder = document.getElementById("finishSummary");
    if (!holder || holder.hidden) return;
    const result = calculateScore();
    holder.querySelector(".practice-score-card")?.remove();
    const card = document.createElement("section");
    card.className = "practice-score-card";
    card.innerHTML = `
      <div class="practice-score-head"><div><h3>運用実践スコア v2</h3><p class="practice-score-grade">${result.grade}</p></div><div class="practice-score-number">${result.score}</div></div>
      <div class="practice-score-categories">${result.categories.map((item) => `<div class="practice-score-row"><span>${item.name}</span><b>${item.earned} / ${item.max}</b><div class="practice-score-bar"><i style="width:${item.max ? item.earned / item.max * 100 : 0}%"></i></div></div>`).join("")}</div>
      <p class="practice-timing-message"><strong>ルーモ✨</strong> ${result.timingMessage}</p>
      <p class="practice-score-note">利益の大きさより、事前計画・損失上限・判断理由・撤退の規律を重く採点しているよ。タイミングの結果加点は最大5点だけ。</p>`;
    holder.appendChild(card);
    window.dispatchEvent(new CustomEvent("kabutane:practice-score", { detail: result }));
  }

  function decisionSnapshot(action, reason, sharesBefore) {
    const audit = ensureAudit();
    const pending = { ...audit.pendingDecision };
    const stop = currentStop();
    const entry = currentEntry();
    const target = number(state.guided?.pendingTarget ?? state.plan?.tpPrices?.find((value) => number(value) !== null));
    let plannedShares = number(audit.plannedShares);
    if (plannedShares === null) {
      plannedShares = number(state.guided?.totalShares);
      if (plannedShares === null && typeof currentPositionPlan === "function") plannedShares = number(currentPositionPlan()?.recommendedShares);
      audit.plannedShares = plannedShares;
    }
    const automaticStop = /STOP|損切り/u.test(String(reason || ""));
    const automaticTarget = /TARGET|TP|利確/u.test(String(reason || ""));
    const decision = {
      ...pending,
      action,
      stopAtDecision: stop,
      targetAtDecision: target,
      plannedShares,
      plannedSplitCount: Number(pending.plannedSplitCount) || Number(state.guided?.splitCount) || 1,
      allowedRiskPct: number(state.riskPct),
      allowedAllocationPct: number(state.allocationPct),
      executionKind: automaticStop ? "stop" : automaticTarget ? "target" : "manual",
    };
    if (automaticStop) { decision.exitReason = "planned_stop"; decision.planStatus = "planned"; }
    if (automaticTarget) { decision.exitReason = "planned_target"; decision.planStatus = "planned"; }
    if (action === "sell" && sharesBefore > 0 && !decision.exitReason) decision.exitReason = pending.exitReason;
    return decision;
  }

  function updateAuditAfterTrade(trade) {
    const audit = ensureAudit();
    const row = typeof currentRow === "function" ? currentRow() : null;
    const metrics = ReplayPro.accountMetrics(state.account, row?.close, state.initialCapital);
    audit.peakShares = Math.max(Number(audit.peakShares || 0), Number(state.account.shares || 0));
    audit.allocationUsedPct = Math.max(Number(audit.allocationUsedPct || 0), state.initialCapital > 0 ? state.account.costBasis / state.initialCapital * 100 : 0);
    const stop = number(trade?.decision?.stopAtDecision ?? currentStop());
    if (stop !== null && metrics.averagePrice !== null && state.initialCapital > 0) {
      const risk = Math.max(0, metrics.averagePrice - stop) * state.account.shares / state.initialCapital * 100;
      audit.positionRiskPct = Math.max(Number(audit.positionRiskPct || 0), risk);
      trade.decision.positionRiskPct = risk;
      trade.decision.allocationUsedPct = state.account.costBasis / state.initialCapital * 100;
    }
    audit.previousStop = currentStop();
  }

  function wrapTradingFunctions() {
    if (window.__kabutanePracticeTradingWrapped) return;
    window.__kabutanePracticeTradingWrapped = true;
    if (typeof executeBuy === "function") {
      const baseBuy = executeBuy;
      executeBuy = function executeBuyPracticeV2(shares, price, reason, explicitSlots) {
        const before = Number(state.account?.shares || 0);
        const decision = decisionSnapshot("buy", reason, before);
        const result = baseBuy(shares, price, reason, explicitSlots);
        if (result?.ok) {
          const trade = state.trades.at(-1);
          if (trade) { trade.decision = decision; trade.sharesBefore = before; trade.sharesAfter = Number(state.account.shares || 0); updateAuditAfterTrade(trade); }
        }
        return result;
      };
    }
    if (typeof executeSell === "function") {
      const baseSell = executeSell;
      executeSell = function executeSellPracticeV2(shares, price, reason) {
        const before = Number(state.account?.shares || 0);
        const decision = decisionSnapshot("sell", reason, before);
        const result = baseSell(shares, price, reason);
        if (result?.ok) {
          const trade = state.trades.at(-1);
          if (trade) { trade.decision = decision; trade.sharesBefore = before; trade.remainingSharesAfter = Number(state.account.shares || 0); updateAuditAfterTrade(trade); }
        }
        return result;
      };
    }
    if (typeof startSession === "function") {
      const baseStart = startSession;
      startSession = function startSessionPracticeV2() {
        ensureAudit(true);
        currentScore = null;
        const result = baseStart();
        injectChartTools();
        injectDecisionPanel();
        return result;
      };
    }
    if (typeof finishSession === "function") {
      const baseFinish = finishSession;
      finishSession = function finishSessionPracticeV2() {
        const result = baseFinish();
        setTimeout(renderScore, 0);
        return result;
      };
    }
  }

  function installBoundsFix() {
    if (typeof priceViewportBounds !== "function" || window.__kabutaneBoundsV2) return;
    window.__kabutaneBoundsV2 = true;
    priceViewportBounds = function priceViewportBoundsV2(rows) {
      const values = [];
      (rows || []).forEach((row) => {
        [row.low, row.high].forEach((value) => { const parsed = number(value); if (parsed !== null) values.push(parsed); });
        if (els.showSma?.checked) [row.sma25, row.sma75, row.sma200].forEach((value) => { const parsed = number(value); if (parsed !== null) values.push(parsed); });
        if (els.showEma?.checked) [row.ema20, row.ema50].forEach((value) => { const parsed = number(value); if (parsed !== null) values.push(parsed); });
        if (els.showBollinger?.checked) [row.bbUpper, row.bbLower].forEach((value) => { const parsed = number(value); if (parsed !== null) values.push(parsed); });
        if (els.showSupertrend?.checked) { const parsed = number(row.supertrend); if (parsed !== null) values.push(parsed); }
        if (els.showHigh52?.checked) { const parsed = number(row.high52); if (parsed !== null) values.push(parsed); }
      });
      const includePlan = Boolean(els.showPlanLines?.checked || state.guided?.showLines || state.guided?.selectMode);
      if (includePlan) [state.plan?.entry, state.plan?.activeStop, ...(state.plan?.tpPrices || [])].forEach((value) => { const parsed = number(value); if (parsed !== null) values.push(parsed); });
      if (els.showAverage?.checked) {
        const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
        const average = number(metrics.averagePrice); if (average !== null) values.push(average);
      }
      if (!values.length) return {};
      let minimum = Math.min(...values), maximum = Math.max(...values);
      const rawRange = Math.max(maximum - minimum, Math.max(Math.abs(maximum), 1) * 0.02);
      minimum -= rawRange * 0.08; maximum += rawRange * 0.08;
      const baseRange = maximum - minimum;
      const center = (minimum + maximum) / 2 + Number(state.chartView?.yPan || 0) * baseRange;
      const scaledRange = baseRange * ReplayPro.clamp(Number(state.chartView?.yScale || 1), 0.18, 8);
      return { min: center - scaledRange / 2, max: center + scaledRange / 2 };
    };
  }

  const stopHandlePlugin = {
    id: "practiceStopHandleV2",
    afterDraw(chart) {
      const stop = currentStop();
      const yScale = chart.scales?.y;
      const area = chart.chartArea;
      if (stop === null || !yScale || !area || stop < yScale.min || stop > yScale.max) return;
      const y = yScale.getPixelForValue(stop);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(52,127,168,.8)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(area.left, y); ctx.lineTo(area.right, y); ctx.stroke(); ctx.setLineDash([]);
      const label = `SL ${Math.round(stop * 100) / 100}`;
      ctx.font = "800 12px system-ui";
      const width = Math.max(72, ctx.measureText(label).width + 18);
      ctx.fillStyle = "#347fa8"; ctx.beginPath(); ctx.roundRect(area.right - width, y - 15, width, 30, 9); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, area.right - width / 2, y);
      ctx.restore();
    },
  };

  function installStopDrag() {
    const canvas = document.getElementById("replayChart");
    if (!canvas || canvas.dataset.stopDragV2 === "true") return;
    canvas.dataset.stopDragV2 = "true";
    if (typeof Chart !== "undefined") Chart.register(stopHandlePlugin);
    canvas.addEventListener("pointerdown", (event) => {
      const stop = currentStop();
      const chart = state.chart;
      if (stop === null || !chart?.scales?.y) return;
      const rect = canvas.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const stopY = chart.scales.y.getPixelForValue(stop);
      if (Math.abs(y - stopY) > 20) return;
      draggingStop = { pointerId: event.pointerId };
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add("practice-sl-dragging");
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    canvas.addEventListener("pointermove", (event) => {
      if (!draggingStop || draggingStop.pointerId !== event.pointerId || !state.chart?.scales?.y) return;
      const rect = canvas.getBoundingClientRect();
      const price = state.chart.scales.y.getValueForPixel(event.clientY - rect.top);
      if (Number.isFinite(price)) updateStopValue(price, { light: true, silent: true });
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    const finish = (event) => {
      if (!draggingStop || draggingStop.pointerId !== event.pointerId) return;
      draggingStop = null; canvas.classList.remove("practice-sl-dragging");
      event.preventDefault(); event.stopImmediatePropagation();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = requestAnimationFrame(() => { renderFrame = null; if (typeof renderAll === "function") renderAll(); });
    };
    canvas.addEventListener("pointerup", finish, true);
    canvas.addEventListener("pointercancel", finish, true);
  }

  function bindEvents() {
    document.addEventListener("input", (event) => {
      const field = event.target.closest("[data-decision-field]");
      if (field) {
        const audit = ensureAudit();
        audit.pendingDecision[field.dataset.decisionField] = field.dataset.decisionField === "plannedSplitCount" ? Number(field.value) : field.value;
        syncDecisionControls();
      }
      if (event.target.id === "stopPrice" || event.target.id === "guidedStopInput") {
        const next = number(event.target.value);
        if (next !== null) updateStopValue(next, { silent: true });
      }
    });
    document.addEventListener("click", (event) => {
      const shape = event.target.closest("[data-chart-shape]"); if (shape) return applyChartShape(shape.dataset.chartShape);
      if (event.target.closest("#practiceChartFocus")) return toggleChartFocus();
      const pan = event.target.closest("[data-price-pan]");
      if (pan && typeof panVertical === "function") return panVertical(pan.dataset.pricePan === "up" ? 0.12 : -0.12);
      if (event.target.closest("[data-price-reset]") && typeof resetChartViewport === "function") return resetChartViewport();
      const stop = event.target.closest("[data-stop-adjust]"); if (stop) return adjustStop(stop.dataset.stopAdjust === "up" ? 1 : -1);
      const confirm = event.target.closest('[data-guided-action="confirm-entry"]');
      if (confirm) {
        const decision = ensureAudit().pendingDecision;
        if (!decision.thesis || !decision.eventContext || !decision.planStatus) {
          event.preventDefault(); event.stopImmediatePropagation();
          showNotice("入る理由・イベント状況・計画との関係を選んでね。点数のためではなく、判断を再現するためだよ。", true);
        }
      }
    }, true);
  }

  function observeGuidedSheet() {
    const target = document.getElementById("guidedSheetBody") || document.body;
    new MutationObserver(() => { injectGuidedDecisionCard(); syncDecisionControls(); }).observe(target, { childList: true, subtree: true });
  }

  function init() {
    ensureAudit();
    wrapTradingFunctions();
    installBoundsFix();
    injectDecisionPanel();
    injectChartTools();
    injectGuidedDecisionCard();
    installStopDrag();
    bindEvents();
    observeGuidedSheet();
    const summary = document.getElementById("finishSummary");
    if (summary) new MutationObserver(() => { if (!summary.hidden) setTimeout(renderScore, 0); }).observe(summary, { childList: true, subtree: true, attributes: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.KabutanePracticeV2 = {
    ensureAudit,
    calculateScore,
    currentScore: () => currentScore || calculateScore(),
    updateStopValue,
    applyChartShape,
    renderScore,
  };
})();
