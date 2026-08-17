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
    ["capital_rotation", "別銘柄へ資金を移す"], ["planned_stop", "予定していた損切り"], ["hold", "まだ売らずに見守る"],
    ["anxiety", "不安になって売った"], ["other", "その他"],
  ];
  const REMAINING_OPTIONS = [
    ["", "部分利確時に選ぶ"], ["entry", "損切りを建値へ"], ["trail", "直近安値へ切り上げ"],
    ["keep", "元の損切りを維持"], ["none", "残りもすぐ売る"],
  ];

  let currentScore = null;
  let draggingStop = null;
  let scoreRenderScheduled = false;

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function optionMarkup(options) {
    return options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function defaultDecision() {
    return {
      thesis: "",
      eventContext: "",
      planStatus: "planned",
      exitReason: "",
      remainingStopDecision: "",
      note: "",
      plannedSplitCount: 1,
    };
  }

  function ensureAudit(reset = false) {
    if (reset || !state.practiceAudit) {
      state.practiceAudit = {
        version: 2,
        pendingDecision: defaultDecision(),
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

  function field(key, label, options, prefix) {
    return `<label>${label}<select data-decision-field="${key}" id="${prefix}${key}">${optionMarkup(options)}</select></label>`;
  }

  function noteField(prefix) {
    return `<label class="practice-decision-note">ひと言メモ<input data-decision-field="note" id="${prefix}note" type="text" maxlength="100" placeholder="何を見て、どう考えたか"></label>`;
  }

  function entryDecisionFields(prefix, compact = false) {
    if (compact) return `<div class="practice-decision-grid practice-decision-grid-simple">
      ${field("thesis", "入る理由を1つ選ぶ", THESIS_OPTIONS, prefix)}
      ${noteField(prefix)}
    </div><p class="practice-decision-status">自由記述は任意だよ。まず理由を1つ選べば進めます。</p>`;
    return `<div class="practice-decision-grid">
      ${field("thesis", "エントリー・追加の理由", THESIS_OPTIONS, prefix)}
      ${field("eventContext", "決算・権利など", EVENT_OPTIONS, prefix)}
      ${field("planStatus", "計画との関係", PLAN_OPTIONS, prefix)}
      <label>予定した買い方<select data-decision-field="plannedSplitCount" id="${prefix}plannedSplitCount"><option value="1">一括</option><option value="2">2分割</option><option value="4">4分割</option></select></label>
      ${noteField(prefix)}
    </div>${compact ? "" : '<p class="practice-decision-status">選んだ内容は、次の買い履歴に一緒に保存されるよ。</p>'}`;
  }

  function exitDecisionFields(prefix, compact = false) {
    if (compact) return `<div class="practice-decision-grid practice-decision-grid-simple">
      ${field("exitReason", "売る理由を1つ選ぶ", EXIT_OPTIONS, prefix)}
      ${noteField(prefix)}
    </div><p class="practice-decision-status">エントリー時と同じ形で、理由を1つだけ残します。自由記述は任意です。</p>`;
    return `<div class="practice-decision-grid">
      ${field("exitReason", "売却・継続の理由", EXIT_OPTIONS, prefix)}
      ${field("remainingStopDecision", "部分利確後の守り方", REMAINING_OPTIONS, prefix)}
      ${field("planStatus", "計画との関係", PLAN_OPTIONS, prefix)}
      ${field("eventContext", "決算・権利など", EVENT_OPTIONS, prefix)}
      ${noteField(prefix)}
    </div>${compact ? "" : '<p class="practice-decision-status">選んだ内容は、次の売り履歴に一緒に保存されるよ。</p>'}`;
  }

  function freeDecisionFields(prefix) {
    return `<div class="practice-decision-grid">
      ${field("thesis", "エントリー・追加の理由", THESIS_OPTIONS, prefix)}
      ${field("eventContext", "決算・権利など", EVENT_OPTIONS, prefix)}
      ${field("planStatus", "計画との関係", PLAN_OPTIONS, prefix)}
      <label>予定した買い方<select data-decision-field="plannedSplitCount" id="${prefix}plannedSplitCount"><option value="1">一括</option><option value="2">2分割</option><option value="4">4分割</option></select></label>
      ${field("exitReason", "売却・継続の理由", EXIT_OPTIONS, prefix)}
      ${field("remainingStopDecision", "部分利確後の守り方", REMAINING_OPTIONS, prefix)}
      ${noteField(prefix)}
    </div><p class="practice-decision-status">買う時は上段、売る時は売却理由を選んでね。判断が履歴と採点に残るよ。</p>`;
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
    const panel = document.createElement("section");
    panel.id = "practiceDecisionPanel";
    panel.className = "practice-decision-panel";
    panel.innerHTML = `<div class="practice-decision-heading"><strong>今回の判断を残す</strong><small>自由練習でも採点対象</small></div>${freeDecisionFields("practice")}`;
    orderPanel.querySelector(".memo-label")?.insertAdjacentElement("beforebegin", panel);
    syncDecisionControls(panel);
  }

  function injectGuidedDecisionCard() {
    const body = document.getElementById("guidedSheetBody");
    if (!body) return;
    const entryButton = body.querySelector('[data-guided-action="confirm-entry"], [data-guided-action="confirm-add-entry"]');
    const isExit = Boolean(body.querySelector("[data-guided-exit], [data-guided-action='confirm-manual-exit']"));
    if (!entryButton && !isExit) return;
    const wantedKind = entryButton ? "entry" : "exit";
    const existing = body.querySelector(".guided-decision-card");
    if (existing?.dataset.kind === wantedKind) return;
    existing?.remove();
    const card = document.createElement("section");
    card.className = "guided-decision-card";
    card.dataset.kind = wantedKind;
    const decision = ensureAudit().pendingDecision;
    decision.planStatus ||= "planned";
    if (entryButton) decision.eventContext ||= "unknown";
    card.innerHTML = entryButton
      ? `<strong>どうして今、入るの？</strong>${entryDecisionFields("guidedEntry", true)}`
      : `<strong>どうして今、売るの？</strong>${exitDecisionFields("guidedExit", true)}`;
    body.querySelector(".guided-sheet-actions")?.insertAdjacentElement("beforebegin", card);
    if (!body.querySelector(".guided-sheet-actions")) body.querySelector(".guided-risk-note")?.insertAdjacentElement("beforebegin", card);
    syncDecisionControls(card);
  }

  function currentStop() {
    return toNumber(state.plan?.activeStop ?? state.plan?.initialStop ?? state.guided?.pendingStop ?? els?.stopPrice?.value);
  }

  function currentEntry() {
    return toNumber(state.plan?.entry ?? state.guided?.pendingEntry ?? els?.entryPrice?.value);
  }

  function stopStep() {
    const mode = document.getElementById("practiceStopStep")?.value || "yen";
    const row = typeof currentRow === "function" ? currentRow() : null;
    const price = currentStop() ?? toNumber(row?.close) ?? 1;
    if (mode === "pct") return Math.max(0.1, price * 0.001);
    if (mode === "atr") {
      const atrPct = toNumber(row?.atr14_pct ?? row?.atr14Pct ?? row?.atrPct);
      return atrPct !== null ? Math.max(0.1, Number(row.close) * atrPct / 100 * 0.25) : Math.max(0.1, price * 0.0025);
    }
    return price < 100 ? 0.1 : 1;
  }

  function showNotice(text, error = false) {
    [document.getElementById("guidedNotice"), document.getElementById("riskPlanNotice"), document.getElementById("orderMessage")]
      .filter(Boolean)
      .forEach((node) => { node.textContent = text; node.classList.toggle("negative", error); });
  }

  function updateStopLabel() {
    const valueNode = document.getElementById("practiceStopValue");
    const stop = currentStop();
    if (valueNode) valueNode.textContent = stop === null ? "—" : `${Math.round(stop * 100) / 100}円`;
    document.querySelectorAll("[data-stop-adjust]").forEach((button) => { button.disabled = stop === null; });
  }

  function updateStopValue(value, options = {}) {
    const next = toNumber(value);
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
    updateStopLabel();
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
    setTimeout(() => state.chart?.resize?.(), 30);
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
      <p class="practice-chart-help"><b>ローソク足を上下にドラッグ</b>すると、ラインを変えずに見える価格帯だけ動くよ。<b>青いSLタグ付近</b>をドラッグすると、損切りラインだけ動くよ。</p>`;
    chartBox.insertAdjacentElement("beforebegin", tools);
    applyChartShape(localStorage.getItem("kabutane-replay-chart-shape") || "auto");
    updateStopLabel();
  }

  function scoreInput() {
    const audit = ensureAudit();
    const row = typeof currentRow === "function" ? currentRow() : null;
    const metrics = typeof ReplayPro !== "undefined" ? ReplayPro.accountMetrics(state.account, row?.close, state.initialCapital) : {};
    audit.reviewed = audit.reviewed || state.trades.some((trade) => String(trade.memo || "").trim() || String(trade?.decision?.note || "").trim());
    return { trades: state.trades, rows: state.rows, audit, plan: state.plan, riskPct: state.riskPct, allocationPct: state.allocationPct, initialCapital: state.initialCapital, metrics, maxDrawdown: state.maxDrawdown };
  }

  function calculateScore() {
    currentScore = ReplayPracticeScoreV2.calculate(scoreInput());
    return currentScore;
  }

  function updateGuidedFinishScore(result) {
    const box = document.querySelector(".guided-finish-score");
    if (!box) return;
    box.innerHTML = `<span>運用実践スコア v2</span><strong>${result.score}点 🌱</strong><small>${result.grade}</small>`;
  }

  function renderScore() {
    const holder = document.getElementById("finishSummary");
    if (!holder || holder.hidden || scoreRenderScheduled) return;
    scoreRenderScheduled = true;
    requestAnimationFrame(() => {
      scoreRenderScheduled = false;
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
      updateGuidedFinishScore(result);
      window.dispatchEvent(new CustomEvent("kabutane:practice-score", { detail: result }));
    });
  }

  function decisionSnapshot(action, reason, sharesBefore) {
    const audit = ensureAudit();
    const pending = { ...audit.pendingDecision };
    const stop = currentStop();
    const target = toNumber(state.guided?.pendingTarget ?? state.plan?.tpPrices?.find((value) => toNumber(value) !== null));
    let plannedShares = toNumber(audit.plannedShares);
    if (plannedShares === null) {
      plannedShares = toNumber(state.guided?.totalShares);
      if (plannedShares === null && typeof currentPositionPlan === "function") plannedShares = toNumber(currentPositionPlan()?.recommendedShares);
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
      allowedRiskPct: toNumber(state.riskPct),
      allowedAllocationPct: toNumber(state.allocationPct),
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
    const stop = toNumber(trade?.decision?.stopAtDecision ?? currentStop());
    if (stop !== null && metrics.averagePrice !== null && state.initialCapital > 0) {
      const risk = Math.max(0, metrics.averagePrice - stop) * state.account.shares / state.initialCapital * 100;
      audit.positionRiskPct = Math.max(Number(audit.positionRiskPct || 0), risk);
      trade.decision.positionRiskPct = risk;
      trade.decision.allocationUsedPct = state.account.costBasis / state.initialCapital * 100;
    }
    audit.previousStop = currentStop();
  }

  function decisionLabel(trade) {
    const decision = trade?.decision || {};
    const options = trade?.type === "BUY" ? THESIS_OPTIONS : EXIT_OPTIONS;
    const key = trade?.type === "BUY" ? decision.thesis : decision.exitReason;
    return options.find(([value]) => value === key)?.[1] || trade?.reason || "手動";
  }

  function installDecisionHistory() {
    if (window.__kabutaneDecisionHistoryV2 || typeof renderHistory !== "function") return;
    window.__kabutaneDecisionHistoryV2 = true;
    const baseRenderHistory = renderHistory;
    renderHistory = function renderHistoryWithDecisionReason() {
      baseRenderHistory();
      const rows = els?.tradeHistoryBody?.querySelectorAll("tr") || [];
      state.trades.forEach((trade, index) => {
        const cells = rows[index]?.cells;
        if (!cells?.length) return;
        cells[2].textContent = decisionLabel(trade);
        cells[6].textContent = String(trade?.decision?.note || trade?.memo || "—");
      });
    };
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
        [row.low, row.high].forEach((value) => { const parsed = toNumber(value); if (parsed !== null) values.push(parsed); });
        if (els.showSma?.checked) [row.sma25, row.sma75, row.sma200].forEach((value) => { const parsed = toNumber(value); if (parsed !== null) values.push(parsed); });
        if (els.showEma?.checked) [row.ema20, row.ema50].forEach((value) => { const parsed = toNumber(value); if (parsed !== null) values.push(parsed); });
        if (els.showBollinger?.checked) [row.bbUpper, row.bbLower].forEach((value) => { const parsed = toNumber(value); if (parsed !== null) values.push(parsed); });
        if (els.showSupertrend?.checked) { const parsed = toNumber(row.supertrend); if (parsed !== null) values.push(parsed); }
        if (els.showHigh52?.checked) { const parsed = toNumber(row.high52); if (parsed !== null) values.push(parsed); }
      });
      const includePlan = Boolean(els.showPlanLines?.checked || state.guided?.showLines || state.guided?.selectMode);
      if (includePlan) [state.plan?.entry, state.plan?.activeStop, ...(state.plan?.tpPrices || [])].forEach((value) => { const parsed = toNumber(value); if (parsed !== null) values.push(parsed); });
      if (els.showAverage?.checked) {
        const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
        const average = toNumber(metrics.averagePrice); if (average !== null) values.push(average);
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
      ctx.fillStyle = "#347fa8"; roundedRectPath(ctx, area.right - width, y - 15, width, 30, 9); ctx.fill();
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
      draggingStop = null;
      canvas.classList.remove("practice-sl-dragging");
      event.preventDefault(); event.stopImmediatePropagation();
      if (typeof renderAll === "function") renderAll();
    };
    canvas.addEventListener("pointerup", finish, true);
    canvas.addEventListener("pointercancel", finish, true);
  }

  function prepareGuidedExitDecision(exitButton) {
    const audit = ensureAudit();
    const ratio = Number(exitButton.dataset.guidedExit);
    audit.pendingDecision.exitReason ||= ratio > 0 ? "planned_target" : "hold";
    audit.pendingDecision.planStatus ||= "planned";
    if (ratio > 0 && ratio < 1) audit.pendingDecision.remainingStopDecision = document.getElementById("guidedRaiseStop")?.checked ? "entry" : "keep";
    syncDecisionControls();
  }

  function bindEvents() {
    document.addEventListener("input", (event) => {
      const decisionField = event.target.closest("[data-decision-field]");
      if (decisionField) {
        const audit = ensureAudit();
        audit.pendingDecision[decisionField.dataset.decisionField] = decisionField.dataset.decisionField === "plannedSplitCount" ? Number(decisionField.value) : decisionField.value;
        syncDecisionControls();
      }
      if (event.target.id === "stopPrice" || event.target.id === "guidedStopInput") {
        const next = toNumber(event.target.value);
        if (next !== null) updateStopValue(next, { silent: true });
        else updateStopLabel();
      }
    });

    document.addEventListener("click", (event) => {
      const shape = event.target.closest("[data-chart-shape]");
      if (shape) { applyChartShape(shape.dataset.chartShape); return; }
      if (event.target.closest("#practiceChartFocus")) { toggleChartFocus(); return; }
      const pan = event.target.closest("[data-price-pan]");
      if (pan && typeof panVertical === "function") { panVertical(pan.dataset.pricePan === "up" ? 0.12 : -0.12); return; }
      if (event.target.closest("[data-price-reset]") && typeof resetChartViewport === "function") { resetChartViewport(); return; }
      const stopButton = event.target.closest("[data-stop-adjust]");
      if (stopButton) { adjustStop(stopButton.dataset.stopAdjust === "up" ? 1 : -1); return; }

      const guidedExit = event.target.closest("[data-guided-exit]");
      if (guidedExit) prepareGuidedExitDecision(guidedExit);

      const confirmEntry = event.target.closest('[data-guided-action="confirm-entry"]');
      if (confirmEntry) {
        const decision = ensureAudit().pendingDecision;
        if (!decision.thesis) {
          event.preventDefault(); event.stopImmediatePropagation();
          showNotice("まず、入る理由を1つ選んでね。自由記述は空欄でも進めるよ。", true);
        }
      }

      const confirmAddEntry = event.target.closest('[data-guided-action="confirm-add-entry"]');
      if (confirmAddEntry && !ensureAudit().pendingDecision.thesis) {
        event.preventDefault(); event.stopImmediatePropagation();
        showNotice("まず、追加する理由を1つ選んでね。自由記述は空欄でも進めるよ。", true);
      }

      const confirmManualExit = event.target.closest('[data-guided-action="confirm-manual-exit"]');
      if (confirmManualExit && !ensureAudit().pendingDecision.exitReason) {
        event.preventDefault(); event.stopImmediatePropagation();
        showNotice("まず、ここで売る理由を1つ選んでね。自由記述は空欄でも進めるよ。", true);
      }

      const closePosition = event.target.closest('[data-guided-action="close-position"]');
      if (closePosition && !ensureAudit().pendingDecision.exitReason) {
        event.preventDefault(); event.stopImmediatePropagation();
        showNotice("ここで終える理由を『今回の判断』から選んでね。", true);
        document.querySelector(".order-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    installDecisionHistory();
    installBoundsFix();
    injectDecisionPanel();
    injectChartTools();
    injectGuidedDecisionCard();
    installStopDrag();
    bindEvents();
    observeGuidedSheet();
    const summary = document.getElementById("finishSummary");
    if (summary) new MutationObserver(() => { if (!summary.hidden) renderScore(); }).observe(summary, { childList: true, subtree: true, attributes: true });
    new MutationObserver(updateStopLabel).observe(document.body, { childList: true, subtree: true });
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
