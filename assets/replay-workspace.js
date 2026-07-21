(function () {
  "use strict";

  if (typeof document === "undefined" || typeof ReplayRiskLadder === "undefined") return;

  function addId(id) {
    if (typeof ids !== "undefined" && !ids.includes(id)) ids.push(id);
  }

  function stageOptions(selected = 3) {
    return Array.from({ length: 8 }, (_, index) => {
      const value = index + 1;
      return `<option value="${value}"${value === selected ? " selected" : ""}>${value}段階</option>`;
    }).join("");
  }

  function installWorkspaceUi() {
    const setupGrid = document.querySelector("#setupPanel .setup-grid");
    if (setupGrid && !document.getElementById("entryStageCount")) {
      const label = document.createElement("label");
      label.innerHTML = `分割エントリー数<select id="entryStageCount">${stageOptions(3)}</select><small class="field-help">初心者は2〜3段階がおすすめ</small>`;
      const allocation = document.getElementById("allocationPct")?.closest("label");
      if (allocation?.nextSibling) setupGrid.insertBefore(label, allocation.nextSibling);
      else setupGrid.appendChild(label);
    }

    const formula = document.querySelector(".setup-formula");
    if (formula) {
      formula.innerHTML = `<strong>資金を守る計算</strong><span>① 許容損失額＝総資産×許容損失率</span><span>② 最大株数＝許容損失額÷（予定平均買値－損切り）</span><span>③ 配分上限株数と比べ、小さい方を1〜8段階へ配分</span>`;
    }

    const introTitle = document.querySelector(".replay-intro h2");
    if (introTitle) introTitle.textContent = "損失額を先に固定する、分割売買トレーニング";
    const introText = document.querySelector(".replay-intro p");
    if (introText) introText.textContent = "1〜8段階の買値を先に決め、予定平均買値と損切りから各段階の株数を自動計算します。";

    const detailBack = document.getElementById("detailBackLink");
    if (detailBack) detailBack.textContent = "← 銘柄詳細チャートへ";
    const headerMeta = document.querySelector(".replay-header .header-meta");
    if (headerMeta && !document.getElementById("detailChartLink")) {
      const code = new URLSearchParams(location.search).get("code") || "";
      headerMeta.insertAdjacentHTML("afterbegin", `<a id="detailChartLink" class="button secondary" href="detail.html?code=${encodeURIComponent(code)}">銘柄詳細を見る</a>`);
    }

    const bracket = document.querySelector(".bracket-panel");
    const riskInputs = bracket?.querySelector(".risk-inputs");
    if (riskInputs && !document.getElementById("entryLadderPlanner")) {
      riskInputs.insertAdjacentHTML("afterend", `
        <section id="entryLadderPlanner" class="entry-ladder-planner" aria-labelledby="entryLadderHeading">
          <div class="entry-ladder-heading">
            <div><span class="mini-kicker">ENTRY LADDER</span><h3 id="entryLadderHeading">買値ラインと株数</h3><p>上からE1、E2…の順に指値を置きます。株数は総リスク内でほぼ均等に配ります。</p></div>
            <span id="entryAverageBadge" class="entry-average-badge">予定平均 —</span>
          </div>
          <div id="entryLadderRows" class="entry-ladder-rows"></div>
          <p class="ladder-guidance">下の買値だけへ株数を集中させるのではなく、最初に総損失額を固定します。全段階が約定しなくても、約定済み株の平均買値からTPを更新します。</p>
        </section>`);
    }

    const autoSlotsLabel = document.getElementById("autoEntrySlots")?.closest("label");
    if (autoSlotsLabel) autoSlotsLabel.classList.add("legacy-auto-slots");
    const entryLabel = document.getElementById("entryPrice")?.closest("label");
    if (entryLabel) {
      entryLabel.childNodes[0].textContent = "選択中の買値";
      entryLabel.classList.add("selected-entry-field");
    }

    const practice = document.getElementById("practiceArea");
    if (!practice || document.getElementById("replayWorkspace")) return;

    const stats = practice.querySelector(".replay-stats");
    const chart = practice.querySelector(".pro-chart-panel");
    const tradeLayout = practice.querySelector(".trade-layout");
    const manualOrder = tradeLayout?.querySelector(".order-panel");
    const account = tradeLayout?.querySelector(".account-panel");
    const history = practice.querySelector(".trade-history-panel");
    const bracketActions = bracket?.querySelector(".bracket-actions");

    const workspace = document.createElement("section");
    workspace.id = "replayWorkspace";
    workspace.className = "replay-workspace";
    workspace.innerHTML = `
      <div class="workspace-topbar">
        <nav class="workspace-tabs" aria-label="売買練習の画面切り替え">
          <button type="button" class="workspace-tab active" data-workspace-tab="risk">1 リスク設定</button>
          <button type="button" class="workspace-tab" data-workspace-tab="chart">2 チャート</button>
          <button type="button" class="workspace-tab" data-workspace-tab="order">3 注文</button>
          <button type="button" class="workspace-tab" data-workspace-tab="result">4 成績</button>
        </nav>
        <div id="desktopTradingDock" class="desktop-trading-dock" aria-label="取引状況">
          <div><span>現在値</span><strong id="dockPrice">—</strong></div>
          <div><span>保有</span><strong id="dockShares">—</strong></div>
          <div><span>評価損益</span><strong id="dockUnrealized">—</strong></div>
          <div><span>余力</span><strong id="dockCash">—</strong></div>
          <div><span>使用枠</span><strong id="dockSlots">0/3</strong></div>
          <button id="dockBuyButton" class="dock-trade buy" type="button">成行買い</button>
          <button id="dockSellButton" class="dock-trade sell" type="button">成行売り</button>
        </div>
      </div>
      <section id="workspaceRisk" class="workspace-panel active" data-workspace-panel="risk"></section>
      <section id="workspaceChart" class="workspace-panel" data-workspace-panel="chart"></section>
      <section id="workspaceOrder" class="workspace-panel" data-workspace-panel="order">
        <section class="panel order-workspace-panel">
          <div class="order-workspace-heading"><div><span class="step-number">STEP 3</span><h2>注文を選ぶ</h2><p>自動発注と手動発注を切り替えます。約定の仕組みを確認してから注文してください。</p></div>
            <div class="order-mode-switch" role="group" aria-label="注文モード"><button id="autoOrderMode" class="button active" type="button">自動発注</button><button id="manualOrderMode" class="button" type="button">手動発注</button></div>
          </div>
          <div class="order-type-guide">
            <article><strong>成行買い・成行売り</strong><p>この練習では表示中の日足終値で即時約定します。価格より約定を優先する注文です。</p></article>
            <article><strong>指値買い</strong><p>指定価格以下へ到達した時に約定します。下へ窓を開けた場合は始値で約定します。</p></article>
            <article><strong>損切り・TP</strong><p>日足の高値・安値で判定し、同じ足で両方へ触れた場合は損切りを優先します。</p></article>
          </div>
          <section id="autoOrderWorkspace" class="order-mode-panel active">
            <div id="autoOrderSummary" class="auto-order-summary"></div>
            <div id="autoOrderActions"></div>
          </section>
          <section id="manualOrderWorkspace" class="order-mode-panel"></section>
          <section id="manualLimitBox" class="manual-limit-box">
            <div><strong>手動の指値買い</strong><p>指定価格へ触れるまで1件だけ待機します。自動ラダーとは併用できません。</p></div>
            <label>指値価格<input id="manualLimitPrice" type="number" min="0" step="0.1"></label>
            <label>株数<input id="manualLimitShares" type="number" min="1" step="1"></label>
            <button id="placeManualLimit" class="button" type="button">指値を待機</button>
            <button id="cancelManualLimit" class="button ghost-button" type="button">指値を取消</button>
            <span id="manualLimitStatus">注文なし</span>
          </section>
        </section>
      </section>
      <section id="workspaceResult" class="workspace-panel" data-workspace-panel="result">
        <section class="panel result-dashboard"><div><span class="mini-kicker">SESSION RESULT</span><h2>今回の成績</h2><p>利益だけでなく、最大下落・ルール・売買回数を振り返ります。</p></div><div id="workspaceResultSummary" class="workspace-result-summary">練習終了後に結果を表示します。</div></section>
      </section>`;

    practice.insertBefore(workspace, practice.firstChild);
    if (stats) workspace.insertBefore(stats, workspace.querySelector("#workspaceRisk"));
    if (bracket) workspace.querySelector("#workspaceRisk").appendChild(bracket);
    if (chart) workspace.querySelector("#workspaceChart").appendChild(chart);
    if (bracketActions) workspace.querySelector("#autoOrderActions").appendChild(bracketActions);
    if (manualOrder) workspace.querySelector("#manualOrderWorkspace").appendChild(manualOrder);
    if (account) workspace.querySelector("#workspaceOrder").appendChild(account);
    if (history) workspace.querySelector("#workspaceResult").appendChild(history);
    tradeLayout?.remove();

    const finish = document.getElementById("finishSummary");
    if (finish) workspace.querySelector("#workspaceResultSummary").appendChild(finish);

    const manualHeading = manualOrder?.querySelector(".section-heading h2");
    if (manualHeading) manualHeading.textContent = "手動で売買する";
    const manualText = manualOrder?.querySelector(".section-heading p");
    if (manualText) manualText.textContent = "成行注文は表示中の日足終値で約定します。1枠分または株数指定で練習できます。";
  }

  installWorkspaceUi();

  [
    "entryStageCount", "entryLadderPlanner", "entryLadderRows", "entryAverageBadge", "detailChartLink",
    "replayWorkspace", "workspaceRisk", "workspaceChart", "workspaceOrder", "workspaceResult", "desktopTradingDock",
    "dockPrice", "dockShares", "dockUnrealized", "dockCash", "dockSlots", "dockBuyButton", "dockSellButton",
    "autoOrderMode", "manualOrderMode", "autoOrderWorkspace", "manualOrderWorkspace", "autoOrderSummary",
    "manualLimitPrice", "manualLimitShares", "placeManualLimit", "cancelManualLimit", "manualLimitStatus",
    "workspaceResultSummary",
  ].forEach(addId);

  state.maxSlots = ReplayRiskLadder.normalizeStages(document.getElementById("entryStageCount")?.value, 3);
  state.availableSlots = state.maxSlots;
  state.manualLimit = null;
  state.orderMode = "auto";
  state.workspaceTab = "risk";
  state.plan.selectedEntryIndex = 0;
  state.plan.entryLevels = [];
  state.plan.pendingEntries = [];
  state.plan.ladder = null;
  ReplayPro.MAX_SLOTS = state.maxSlots;

  function activeEntryInputs() {
    return [...document.querySelectorAll("[data-entry-level]")];
  }

  function defaultEntryPrices(close, stages) {
    const count = ReplayRiskLadder.normalizeStages(stages, 3);
    const spacing = count >= 6 ? 0.015 : 0.02;
    return Array.from({ length: count }, (_, index) => close * (1 - spacing * index));
  }

  function rebuildEntryRows(prices = null) {
    const holder = document.getElementById("entryLadderRows");
    if (!holder) return;
    const count = state.maxSlots;
    const current = finite(currentRow()?.close) || finite(els.entryPrice?.value) || 1000;
    const previous = activeEntryInputs().map((input) => finite(input.value));
    const values = prices || Array.from({ length: count }, (_, index) => previous[index] ?? defaultEntryPrices(current, count)[index]);
    holder.innerHTML = values.map((price, index) => `
      <article class="entry-ladder-row${index === state.plan.selectedEntryIndex ? " selected" : ""}" data-entry-row="${index}">
        <button class="entry-select-button" type="button" data-select-entry="${index}" aria-label="E${index + 1}をチャート設定対象にする">E${index + 1}</button>
        <label>買値<input data-entry-level="${index}" type="number" min="0" step="0.1" value="${Number(price).toFixed(2)}"></label>
        <div><span>株数</span><strong data-entry-shares="${index}">—</strong></div>
        <div><span>損失</span><strong data-entry-risk="${index}">—</strong></div>
        <span class="entry-order-state" data-entry-state="${index}">未待機</span>
      </article>`).join("");
    const selected = values[state.plan.selectedEntryIndex] ?? values[0];
    if (els.entryPrice && selected !== undefined) els.entryPrice.value = Number(selected).toFixed(2);
  }

  function syncEntrySelection(index) {
    state.plan.selectedEntryIndex = Math.max(0, Math.min(state.maxSlots - 1, Number(index) || 0));
    document.querySelectorAll("[data-entry-row]").forEach((row) => row.classList.toggle("selected", Number(row.dataset.entryRow) === state.plan.selectedEntryIndex));
    const input = document.querySelector(`[data-entry-level="${state.plan.selectedEntryIndex}"]`);
    if (input && els.entryPrice) els.entryPrice.value = input.value;
    setTool("entry");
  }

  function updateEntryRowsFromPlan(plan) {
    (plan?.tranches || []).forEach((tranche) => {
      const shares = document.querySelector(`[data-entry-shares="${tranche.index}"]`);
      const risk = document.querySelector(`[data-entry-risk="${tranche.index}"]`);
      if (shares) shares.textContent = `${tranche.shares.toLocaleString("ja-JP")}株`;
      if (risk) risk.textContent = yen(tranche.risk);
    });
    const badge = document.getElementById("entryAverageBadge");
    if (badge) badge.textContent = `予定平均 ${yen(plan?.averageEntry)}`;
  }

  function setWorkspaceTab(name, scroll = false) {
    state.workspaceTab = name;
    document.querySelectorAll("[data-workspace-tab]").forEach((button) => button.classList.toggle("active", button.dataset.workspaceTab === name));
    document.querySelectorAll("[data-workspace-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.workspacePanel === name));
    if (name === "chart") requestAnimationFrame(renderSynchronizedCharts);
    if (name === "result") renderWorkspaceResult();
    if (scroll) document.getElementById("replayWorkspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setOrderMode(mode) {
    state.orderMode = mode;
    const auto = mode === "auto";
    document.getElementById("autoOrderMode")?.classList.toggle("active", auto);
    document.getElementById("manualOrderMode")?.classList.toggle("active", !auto);
    document.getElementById("autoOrderWorkspace")?.classList.toggle("active", auto);
    document.getElementById("manualOrderWorkspace")?.classList.toggle("active", !auto);
    document.getElementById("manualLimitBox")?.classList.toggle("active", !auto);
  }

  function updateStageCount(value, rebuild = true) {
    const next = ReplayRiskLadder.normalizeStages(value, 3);
    state.maxSlots = next;
    ReplayPro.MAX_SLOTS = next;
    state.availableSlots = Math.min(next, Math.max(0, state.availableSlots));
    state.plan.autoSlots = next;
    if (els.autoEntrySlots) {
      els.autoEntrySlots.innerHTML = `<option value="${next}" selected>${next}段階すべて</option>`;
      els.autoEntrySlots.value = String(next);
    }
    if (rebuild) {
      state.plan.selectedEntryIndex = Math.min(state.plan.selectedEntryIndex, next - 1);
      rebuildEntryRows();
      state.plan.armed = false;
      state.plan.pendingEntries = [];
      recalculatePlan();
      if (!els.practiceArea?.hidden) renderAll();
    }
  }

  const baseResetPlanPricesWorkspace = resetPlanPrices;
  resetPlanPrices = function resetPlanPricesWorkspace() {
    const row = currentRow();
    if (!row) return baseResetPlanPricesWorkspace();
    const close = Number(row.close);
    const prices = defaultEntryPrices(close, state.maxSlots);
    const spacing = state.maxSlots >= 6 ? 0.015 : 0.02;
    const stop = close * (1 - spacing * Math.max(2, state.maxSlots) - 0.02);
    state.plan.selectedEntryIndex = 0;
    rebuildEntryRows(prices);
    els.entryPrice.value = prices[0].toFixed(2);
    els.stopPrice.value = stop.toFixed(2);
    state.plan.armed = false;
    state.plan.pendingEntries = [];
    recalculatePlan();
  };

  recalculatePlan = function recalculatePlanWorkspace() {
    const selectedInput = document.querySelector(`[data-entry-level="${state.plan.selectedEntryIndex}"]`);
    if (selectedInput && els.entryPrice && document.activeElement === els.entryPrice) selectedInput.value = els.entryPrice.value;
    const prices = activeEntryInputs().map((input) => finite(input.value));
    state.plan.initialStop = finite(els.stopPrice.value);
    if (state.account.shares === 0 || !state.plan.entryDate) state.plan.activeStop = state.plan.initialStop;
    state.plan.ratios = ReplayPro.normalizeRatios([els.rr1.value, els.rr2.value, els.rr3.value, els.rr4.value]);
    [els.rr1, els.rr2, els.rr3, els.rr4].forEach((input, index) => { input.value = state.plan.ratios[index].toFixed(1); });
    state.plan.ladder = ReplayRiskLadder.buildEntryLadder({
      assets: state.initialCapital,
      allocationPct: state.allocationPct,
      riskPct: state.riskPct,
      prices,
      stop: state.plan.initialStop,
      lotSize: state.lotSize,
      costBps: state.costBps,
    });
    state.plan.entryLevels = prices;
    const actualAverage = state.account.shares > 0 ? state.account.grossBasis / state.account.shares : null;
    state.plan.entry = actualAverage || state.plan.ladder.averageEntry;
    state.plan.tpPrices = ReplayPro.tpPrices(state.plan.entry, state.plan.initialStop, state.plan.ratios);
    state.plan.autoSlots = state.maxSlots;
    state.plan.trailMode = els.trailMode.value;
    updateEntryRowsFromPlan(state.plan.ladder);
  };

  currentPositionPlan = function currentPositionPlanWorkspace() {
    recalculatePlan();
    return state.plan.ladder || ReplayRiskLadder.buildEntryLadder({ prices: [], stop: null });
  };

  automaticOrderShares = function automaticOrderSharesWorkspace(plan) {
    return Math.max(0, plan?.totalShares || 0);
  };

  slotsForShares = function slotsForSharesWorkspace(shares, plan) {
    if (!plan?.tranches?.length) return state.maxSlots;
    const quantity = Math.max(0, Number(shares) || 0);
    let cumulative = 0;
    for (let index = 0; index < plan.tranches.length; index += 1) {
      cumulative += plan.tranches[index].shares;
      if (quantity <= cumulative) return index + 1;
    }
    return state.maxSlots;
  };

  const baseExecuteSellWorkspace = executeSell;
  executeSell = function executeSellWorkspace(shares, price, reason = "手動") {
    const beforeShares = state.account.shares;
    const beforeAvailable = state.availableSlots;
    const result = baseExecuteSellWorkspace(shares, price, reason);
    if (result.ok) {
      state.availableSlots = ReplayRiskLadder.restoreSlots({
        maxSlots: state.maxSlots,
        availableSlots: beforeAvailable,
        beforeShares,
        afterShares: state.account.shares,
      });
    }
    return result;
  };

  function cancelPendingEntries(label = "取消") {
    (state.plan.pendingEntries || []).forEach((entry) => {
      if (!entry.filled) entry.cancelled = true;
    });
    state.plan.armed = false;
    document.querySelectorAll("[data-entry-state]").forEach((node) => {
      const entry = state.plan.pendingEntries?.[Number(node.dataset.entryState)];
      if (entry?.filled) node.textContent = "約定済み";
      else if (entry?.cancelled) node.textContent = label;
    });
  }

  function updateTpFromActualAverage() {
    if (state.account.shares <= 0) return;
    state.plan.entry = state.account.grossBasis / state.account.shares;
    state.plan.tpPrices = ReplayPro.tpPrices(state.plan.entry, state.plan.initialStop, state.plan.ratios);
    state.plan.initialAutoShares = state.account.shares;
  }

  armBracket = function armBracketWorkspace() {
    recalculatePlan();
    const plan = state.plan.ladder;
    if (state.account.shares > 0) {
      message("自動エントリーは保有株がない状態で待機してください。", true);
      return;
    }
    if (!plan?.valid || !plan.totalShares) {
      message(plan?.error || "買値と損切りを確認してください。", true);
      return;
    }
    if (state.manualLimit) {
      message("手動指値を取り消してから自動発注を待機してください。", true);
      return;
    }
    state.plan.pendingEntries = plan.tranches.map((entry) => ({ ...entry, filled: false, cancelled: entry.shares <= 0 }));
    state.plan.armed = true;
    state.plan.activeStop = state.plan.initialStop;
    state.plan.hitTargets = [false, false, false, false];
    state.plan.entryDate = null;
    state.plan.initialAutoShares = 0;
    els.sessionState.textContent = "分割指値待機";
    message(`${state.maxSlots}段階・合計${plan.totalShares.toLocaleString("ja-JP")}株を待機しました。予定損失は${yen(plan.plannedLoss)}です。`);
    renderAll();
    setWorkspaceTab("order", true);
  };

  cancelBracket = function cancelBracketWorkspace() {
    cancelPendingEntries("取消済み");
    state.plan.entryDate = state.account.shares > 0 ? state.plan.entryDate : null;
    state.plan.initialAutoShares = state.account.shares;
    state.plan.hitTargets = state.account.shares > 0 ? state.plan.hitTargets : [false, false, false, false];
    state.plan.activeStop = state.plan.initialStop;
    els.sessionState.textContent = state.account.shares > 0 ? "手動管理" : "練習中";
    message("未約定の自動指値を取り消しました。保有株は手動で管理できます。");
    renderAll();
  };

  function processManualLimit(row) {
    if (!state.manualLimit || state.account.shares > 0 && state.availableSlots <= 0) return false;
    const fill = ReplayRiskLadder.limitBuyFillPrice(row, state.manualLimit.price);
    if (fill === null) return false;
    const result = executeBuy(state.manualLimit.shares, fill, "手動指値", null);
    if (!result.ok) {
      message(`指値注文を約定できませんでした：${result.error}`, true);
      state.manualLimit = null;
      return false;
    }
    message(`${yen(fill)}で手動指値が約定し、${result.shares.toLocaleString("ja-JP")}株を購入しました。`);
    state.manualLimit = null;
    return true;
  }

  function activeTargetCount() {
    const lots = Math.floor(state.plan.initialAutoShares / Math.max(1, state.lotSize));
    return Math.max(1, Math.min(ReplayPro.TP_COUNT, lots));
  }

  processAutomaticOrders = function processAutomaticOrdersWorkspace(row) {
    processManualLimit(row);
    const pending = state.plan.pendingEntries || [];
    let filledThisBar = false;

    if (state.plan.armed) {
      pending.forEach((entry) => {
        if (entry.filled || entry.cancelled || entry.shares <= 0) return;
        const fill = ReplayRiskLadder.limitBuyFillPrice(row, entry.price);
        if (fill === null) return;
        const result = executeBuy(entry.shares, fill, `自動指値 ${entry.label}`, 1);
        if (!result.ok) {
          entry.cancelled = true;
          message(`${entry.label}を約定できませんでした：${result.error}`, true);
          return;
        }
        entry.filled = true;
        filledThisBar = true;
        state.plan.entryDate ||= row.date;
        updateTpFromActualAverage();
      });
      const remaining = pending.some((entry) => !entry.filled && !entry.cancelled);
      state.plan.armed = remaining;
      if (state.account.shares > 0) els.sessionState.textContent = remaining ? "分割約定中" : "自動管理中";

      if (state.account.shares > 0 && finite(row.low) !== null && finite(state.plan.activeStop) !== null && row.low <= state.plan.activeStop) {
        const price = finite(row.open) !== null && row.open < state.plan.activeStop ? row.open : state.plan.activeStop;
        const result = executeSell(state.account.shares, price, "自動損切り（分割約定日含む）");
        cancelPendingEntries("損切り取消");
        els.sessionState.textContent = "損切り完了";
        message(`${yen(price)}で全株を損切りしました。実現損益${yen(result.realized)}。`);
        return;
      }
      if (filledThisBar) {
        message(`指値が約定しました。現在${state.account.shares.toLocaleString("ja-JP")}株、平均買値${yen(state.plan.entry)}。同じ足ではTPを判定しません。`);
        return;
      }
    }

    if (state.account.shares <= 0 || !state.plan.entryDate) return;
    const low = finite(row.low);
    const high = finite(row.high);
    if (low !== null && finite(state.plan.activeStop) !== null && low <= state.plan.activeStop) {
      const price = finite(row.open) !== null && row.open < state.plan.activeStop ? row.open : state.plan.activeStop;
      const result = executeSell(state.account.shares, price, "自動損切り/トレール");
      cancelPendingEntries("損切り取消");
      els.sessionState.textContent = "自動決済完了";
      message(`${yen(price)}へ到達し、全株を自動売却しました。実現損益${yen(result.realized)}。`);
      return;
    }

    if (high === null) return;
    const count = activeTargetCount();
    const messages = [];
    for (let index = 0; index < count; index += 1) {
      const target = state.plan.tpPrices[index];
      if (state.plan.hitTargets[index] || target === undefined || high < target || state.account.shares <= 0) continue;
      if (index === 0) cancelPendingEntries("TPで取消");
      const isLast = index === count - 1;
      let shares = isLast ? state.account.shares : ReplayRiskLadder.roundToLot(state.plan.initialAutoShares / count, state.lotSize);
      if (shares <= 0 || shares > state.account.shares) shares = state.account.shares;
      const fill = finite(row.open) !== null && row.open > target ? row.open : target;
      const result = executeSell(shares, fill, `自動TP${index + 1}`);
      if (!result.ok) continue;
      state.plan.hitTargets[index] = true;
      trailAfterTarget(index);
      messages.push(`TP${index + 1} ${yen(fill)}で${shares.toLocaleString("ja-JP")}株`);
    }
    if (messages.length) {
      if (state.account.shares === 0) els.sessionState.textContent = "TP完了";
      else els.sessionState.textContent = "トレーリング中";
      message(`${messages.join("、")}を利確。新しい損切りは${yen(state.plan.activeStop)}です。`);
    }
  };

  planLineDatasets = function planLineDatasetsWorkspace(visible) {
    if (!els.showPlanLines.checked) return [];
    const datasets = [];
    const constant = (value) => visible.map(() => value);
    (state.plan.ladder?.tranches || []).forEach((entry, index) => {
      if (entry.price !== null) datasets.push(lineDataset(`${entry.label} ${entry.shares}株`, constant(entry.price), index === state.plan.selectedEntryIndex ? "#8c55c5" : "rgba(140,85,197,.58)", { borderWidth: index === state.plan.selectedEntryIndex ? 2.3 : 1.2, borderDash: [7, 4] }));
    });
    if (state.plan.entry !== null) datasets.push(lineDataset("予定/実平均買値", constant(state.plan.entry), "#b23b78", { borderWidth: 2, borderDash: [10, 4] }));
    if (state.plan.activeStop !== null) datasets.push(lineDataset("損切り/トレール", constant(state.plan.activeStop), "#347fa8", { borderWidth: 2, borderDash: [5, 4] }));
    state.plan.tpPrices.forEach((price, index) => {
      if (price !== null) datasets.push(lineDataset(`TP${index + 1} (${state.plan.ratios[index]}R)`, constant(price), ["#e983b1", "#e46e9f", "#db588d", "#ca3e78"][index], { borderWidth: 1.4, borderDash: [3, 3] }));
    });
    return datasets;
  };

  renderSlots = function renderSlotsWorkspace() {
    const used = state.maxSlots - state.availableSlots;
    els.buyStageStatus.textContent = `${used} / ${state.maxSlots}`;
    els.remainingBuys.textContent = `${state.availableSlots}枠`;
    els.slotDots.innerHTML = Array.from({ length: state.maxSlots }, (_, index) => `<span class="${index < used ? "used" : ""}">${index + 1}</span>`).join("");
    const note = els.slotDots.closest(".slot-board")?.querySelector("small");
    if (note) note.textContent = `売却した割合に応じて枠が戻り、全売却で全${state.maxSlots}枠が復活します。`;
  };

  renderPlan = function renderPlanWorkspace() {
    const plan = currentPositionPlan();
    const ratios = state.plan.ratios;
    state.plan.tpPrices.forEach((price, index) => { els[`tp${index + 1}Price`].textContent = price === undefined ? "—" : yen(price); });
    els.positionBudget.textContent = yen(plan.allocationBudget);
    els.riskBudget.textContent = yen(plan.riskBudget);
    els.recommendedShares.textContent = `${plan.totalShares.toLocaleString("ja-JP")}株`;
    els.slotShares.textContent = plan.tranches?.length ? plan.tranches.map((row) => `${row.label}:${row.shares}`).join(" / ") : "—";
    els.plannedLoss.textContent = yen(plan.plannedLoss);
    els.activeStopValue.textContent = yen(state.plan.activeStop);
    els.riskRewardBadge.textContent = `TP ${ratios.map((ratio) => `${ratio.toFixed(1)}R`).join(" / ")}`;
    const validRatios = ratios.every((ratio, index) => index === 0 || ratio > ratios[index - 1]);
    const valid = plan.valid && validRatios;
    els.armBracketButton.disabled = !valid || state.ended || state.account.shares > 0 || Boolean(state.manualLimit);
    if (!valid) els.riskPlanNotice.textContent = plan.error || "買値・損切り・TPを確認してください。";
    else if (state.plan.armed) els.riskPlanNotice.textContent = `待機中：E1〜E${state.maxSlots}の指値を日足ごとに監視しています。`;
    else if (state.account.shares > 0 && state.plan.entryDate) els.riskPlanNotice.textContent = `自動管理中：平均買値${yen(state.plan.entry)}、現在の損切り${yen(state.plan.activeStop)}。`;
    else els.riskPlanNotice.textContent = `合計${plan.totalShares.toLocaleString("ja-JP")}株、予定使用額${yen(plan.capitalUsed)}、予定最大損失${yen(plan.plannedLoss)}。`;
    updateEntryRowsFromPlan(plan);
    renderAutoOrderSummary();
  };

  function renderAutoOrderSummary() {
    const holder = document.getElementById("autoOrderSummary");
    if (!holder) return;
    const plan = state.plan.ladder;
    holder.innerHTML = `
      <div class="auto-order-head"><div><span>自動指値ラダー</span><strong>${state.maxSlots}段階・合計${(plan?.totalShares || 0).toLocaleString("ja-JP")}株</strong></div><div><span>共通損切り</span><strong>${yen(state.plan.initialStop)}</strong></div><div><span>予定損失</span><strong>${yen(plan?.plannedLoss)}</strong></div></div>
      <div class="auto-order-list">${(plan?.tranches || []).map((entry) => `<span>${entry.label} ${yen(entry.price)} × ${entry.shares.toLocaleString("ja-JP")}株</span>`).join("") || "買値を設定してください。"}</div>`;
  }

  const baseRenderAccountWorkspace = renderAccount;
  renderAccount = function renderAccountWorkspace() {
    baseRenderAccountWorkspace();
    const row = currentRow();
    if (!row) return;
    const metrics = ReplayPro.accountMetrics(state.account, row.close, state.initialCapital);
    const set = (id, text, css = "") => { const node = document.getElementById(id); if (node) { node.textContent = text; node.className = css; } };
    set("dockPrice", yen(row.close));
    set("dockShares", `${state.account.shares.toLocaleString("ja-JP")}株`);
    set("dockUnrealized", `${yen(metrics.unrealized)} ${percent(metrics.unrealizedPct)}`, performanceClass(metrics.unrealized));
    set("dockCash", yen(state.account.cash));
    set("dockSlots", `${state.maxSlots - state.availableSlots}/${state.maxSlots}`);
  };

  const baseRenderMobileTerminalWorkspace = renderMobileTerminal;
  renderMobileTerminal = function renderMobileTerminalWorkspace() {
    baseRenderMobileTerminalWorkspace();
    if (els.mobileSlots) els.mobileSlots.textContent = `${state.availableSlots}/${state.maxSlots}`;
  };

  const baseRenderButtonsWorkspace = renderButtons;
  renderButtons = function renderButtonsWorkspace() {
    baseRenderButtonsWorkspace();
    const plan = currentPositionPlan();
    const buyDisabled = state.ended || state.plan.armed || state.availableSlots <= 0 || !plan.slotShares;
    if (els.dockBuyButton) els.dockBuyButton.disabled = buyDisabled;
    if (els.dockSellButton) els.dockSellButton.disabled = state.ended || state.account.shares <= 0;
    if (els.placeManualLimit) els.placeManualLimit.disabled = state.ended || state.plan.armed || Boolean(state.manualLimit);
    if (els.cancelManualLimit) els.cancelManualLimit.disabled = !state.manualLimit;
    if (els.manualLimitStatus) els.manualLimitStatus.textContent = state.manualLimit ? `${yen(state.manualLimit.price)} × ${state.manualLimit.shares.toLocaleString("ja-JP")}株 待機中` : "注文なし";
  };

  function renderWorkspaceResult() {
    const holder = document.getElementById("workspaceResultSummary");
    if (!holder || !currentRow()) return;
    const finish = document.getElementById("finishSummary");
    const metrics = ReplayPro.accountMetrics(state.account, currentRow().close, state.initialCapital);
    const buys = state.trades.filter((trade) => trade.type === "BUY").length;
    const sells = state.trades.filter((trade) => trade.type === "SELL").length;
    const score = Math.max(0, Math.min(100, Math.round(70 + (metrics.totalReturn || 0) - Math.abs(state.maxDrawdown || 0) * 1.5)));
    const summary = `<div class="result-score"><span>リスク管理スコア</span><strong>${score}</strong><small>利益だけでなく最大下落も反映した練習用の目安</small></div><div class="result-metric-grid"><div><span>総損益</span><strong class="${performanceClass(metrics.totalProfit)}">${yen(metrics.totalProfit)}</strong></div><div><span>総損益率</span><strong class="${performanceClass(metrics.totalReturn)}">${percent(metrics.totalReturn)}</strong></div><div><span>最大DD</span><strong>${percent(state.maxDrawdown)}</strong></div><div><span>売買</span><strong>買${buys} / 売${sells}</strong></div><div><span>累計コスト</span><strong>${yen(state.account.fees)}</strong></div><div><span>終了時保有</span><strong>${state.account.shares.toLocaleString("ja-JP")}株</strong></div></div>`;
    [...holder.children].forEach((child) => { if (child !== finish) child.remove(); });
    holder.insertAdjacentHTML("afterbegin", summary);
  }

  const baseFinishSessionWorkspace = finishSession;
  finishSession = function finishSessionWorkspace() {
    cancelPendingEntries("終了取消");
    state.manualLimit = null;
    baseFinishSessionWorkspace();
    renderWorkspaceResult();
    setWorkspaceTab("result", true);
  };

  const baseStartSessionWorkspace = startSession;
  startSession = function startSessionWorkspace() {
    updateStageCount(els.entryStageCount.value, false);
    baseStartSessionWorkspace();
    if (!els.practiceArea.hidden) {
      rebuildEntryRows(defaultEntryPrices(Number(currentRow().close), state.maxSlots));
      resetPlanPrices();
      setWorkspaceTab("risk", false);
      setOrderMode("auto");
      renderAll();
    }
  };

  const baseResetToSetupWorkspace = resetToSetup;
  resetToSetup = function resetToSetupWorkspace() {
    baseResetToSetupWorkspace();
    setWorkspaceTab("risk", false);
  };

  function placeManualLimit() {
    if (state.plan.armed) {
      message("自動発注を解除してから手動指値を置いてください。", true);
      return;
    }
    const price = finite(els.manualLimitPrice.value);
    const shares = ReplayRiskLadder.roundToLot(els.manualLimitShares.value, state.lotSize);
    if (price === null || price <= 0 || shares <= 0) {
      message("指値価格と株数を入力してください。", true);
      return;
    }
    state.manualLimit = { price, shares };
    message(`${yen(price)}で${shares.toLocaleString("ja-JP")}株の指値買いを待機しました。`);
    renderAll();
  }

  function cancelManualLimit() {
    state.manualLimit = null;
    message("手動指値を取り消しました。");
    renderAll();
  }

  const baseBindEventsWorkspace = bindEvents;
  bindEvents = function bindEventsWorkspace() {
    baseBindEventsWorkspace();
    els.entryStageCount.addEventListener("change", () => updateStageCount(els.entryStageCount.value));
    document.getElementById("entryLadderRows")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-select-entry]");
      if (button) syncEntrySelection(button.dataset.selectEntry);
    });
    document.getElementById("entryLadderRows")?.addEventListener("input", (event) => {
      const input = event.target.closest("[data-entry-level]");
      if (!input) return;
      syncEntrySelection(input.dataset.entryLevel);
      els.entryPrice.value = input.value;
      state.plan.armed = false;
      state.plan.pendingEntries = [];
      recalculatePlan();
      renderPlan();
      renderMainChart();
    });
    document.querySelectorAll("[data-workspace-tab]").forEach((button) => button.addEventListener("click", () => setWorkspaceTab(button.dataset.workspaceTab, true)));
    els.autoOrderMode.addEventListener("click", () => setOrderMode("auto"));
    els.manualOrderMode.addEventListener("click", () => setOrderMode("manual"));
    els.placeManualLimit.addEventListener("click", placeManualLimit);
    els.cancelManualLimit.addEventListener("click", cancelManualLimit);
    els.dockBuyButton.addEventListener("click", manualBuyChunk);
    els.dockSellButton.addEventListener("click", () => manualSell(1));
    els.mobileOrderSettings?.addEventListener("click", () => setWorkspaceTab("order", true));
    els.finishButton.addEventListener("click", () => setWorkspaceTab("result", true));
    setOrderMode("auto");
    updateStageCount(els.entryStageCount.value, false);
  };

  // Keep the detail link correct even while the asynchronous chart payload is loading.
  const code = new URLSearchParams(location.search).get("code") || "";
  const detailLink = document.getElementById("detailChartLink");
  if (detailLink) detailLink.href = `detail.html?code=${encodeURIComponent(code)}`;
})();
