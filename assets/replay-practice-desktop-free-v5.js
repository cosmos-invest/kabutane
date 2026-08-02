(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const THESIS = [
    ["", "選択してね"],
    ["pullback", "押し目・支持線"],
    ["breakout", "高値・抵抗線の突破"],
    ["trend", "移動平均線の並び・傾き"],
    ["volume", "出来高の変化"],
    ["monthly_rsi", "月足RSIの勢い"],
    ["earnings", "決算後の値動き"],
    ["rights", "権利落ち後の値動き"],
    ["other", "その他"],
  ];
  const EVENTS = [
    ["", "選択してね"],
    ["normal", "特別なイベントなし"],
    ["earnings_after", "決算発表直後"],
    ["earnings_cross", "決算を跨ぐ予定"],
    ["rights_before", "権利付き最終日前"],
    ["rights_cross", "権利を跨ぐ予定"],
    ["ex_rights", "権利落ち直後"],
    ["split", "株式分割前後"],
    ["unknown", "イベント情報を未確認"],
  ];
  const PLAN = [
    ["planned", "計画どおり"],
    ["condition_changed", "条件変化で変更"],
    ["emotion", "不安・焦りで変更"],
  ];
  const EXITS = [
    ["", "選択してね"],
    ["planned_target", "予定していた利確位置"],
    ["trend_break", "勢い・トレンドが崩れた"],
    ["earnings_reduce", "決算前後で保有を減らす"],
    ["rights_reduce", "権利日前後で保有を減らす"],
    ["capital_rotation", "別銘柄へ資金を移す"],
    ["planned_stop", "予定していた損切り"],
    ["anxiety", "不安になって売る"],
    ["other", "その他"],
  ];
  const REMAINING = [
    ["", "部分利確時に選択"],
    ["entry", "損切りを建値へ"],
    ["trail", "直近安値へ切り上げ"],
    ["keep", "元の損切りを維持"],
    ["none", "残りもすぐ売る"],
  ];

  let syncQueued = false;
  let lastTradeCount = -1;

  function stateRef() {
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function currentRowSafe() {
    try { return typeof currentRow === "function" ? currentRow() : null; } catch (_) { return null; }
  }

  function metrics() {
    const s = stateRef();
    if (!s || typeof ReplayPro === "undefined") return null;
    try { return ReplayPro.accountMetrics(s.account, currentRowSafe()?.close, s.initialCapital); } catch (_) { return null; }
  }

  function yen(value, signed = false) {
    const number = finite(value);
    if (number === null) return "—";
    const rounded = Math.round(number);
    return `${signed && rounded > 0 ? "+" : ""}${rounded.toLocaleString("ja-JP")}円`;
  }

  function pct(value) {
    const number = finite(value);
    if (number === null) return "—";
    return `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
  }

  function options(list, selected = "") {
    return list.map(([value, label]) => `<option value="${value}"${String(value) === String(selected) ? " selected" : ""}>${label}</option>`).join("");
  }

  function isFree() {
    const s = stateRef();
    return s?.guided?.mode === "free" || document.body.classList.contains("free-replay-mode");
  }

  function practiceVisible() {
    return document.getElementById("practiceArea")?.hidden === false;
  }

  function audit() {
    try {
      const fromApi = window.KabutanePracticeV2?.ensureAudit?.();
      if (fromApi) return fromApi;
    } catch (_) {}
    return stateRef()?.practiceAudit || null;
  }

  function resetPending(kind = "entry") {
    const a = audit();
    if (!a?.pendingDecision) return;
    const split = Number(document.getElementById("autoEntrySlots")?.value || 1);
    a.pendingDecision = {
      thesis: "",
      eventContext: "",
      planStatus: "planned",
      exitReason: "",
      remainingStopDecision: "",
      note: "",
      plannedSplitCount: Number.isFinite(split) ? split : 1,
    };
    if (kind === "exit") a.pendingDecision.thesis = "";
  }

  function setPending(values) {
    const a = audit();
    if (!a?.pendingDecision) return false;
    Object.assign(a.pendingDecision, values);
    return true;
  }

  function clickExisting(selector) {
    const button = document.querySelector(selector);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function ensureFreePanel() {
    let panel = document.getElementById("freePracticeFlowV5");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "freePracticeFlowV5";
    panel.className = "free-practice-flow-v5";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="free-flow-heading-v5">
        <div><span>FREE PRACTICE</span><h2>自由練習コックピット</h2></div>
        <button type="button" data-free-action="advanced">詳細設定</button>
      </div>
      <div class="free-flow-steps-v5" aria-label="自由練習の流れ">
        <span data-free-step="0"><b>1</b>エントリー</span>
        <span data-free-step="1"><b>2</b>保有・追加</span>
        <span data-free-step="2"><b>3</b>利確・撤退</span>
        <span data-free-step="3"><b>4</b>振り返り</span>
      </div>
      <div class="free-flow-coach-v5" data-free-coach="cosmos">
        <div class="free-flow-avatar-v5" aria-hidden="true"></div>
        <div><strong data-free-coach-name>コスモス🌸</strong><p data-free-coach-message>チャートを見て、入る理由がそろったらエントリーしてみよう。</p></div>
      </div>
      <div class="free-flow-metrics-v5">
        <span>保有<strong data-free-shares>—</strong></span>
        <span>平均単価<strong data-free-average>—</strong></span>
        <span>評価損益<strong data-free-pnl>—</strong><small data-free-pnl-pct>—</small></span>
        <span>総損益<strong data-free-total>—</strong></span>
        <span>現在SL<strong data-free-stop>—</strong></span>
      </div>
      <div class="free-flow-actions-v5">
        <button type="button" class="buy" data-free-action="entry">エントリー</button>
        <button type="button" class="sell" data-free-action="exit" disabled>利確・撤退</button>
        <button type="button" data-free-action="step">1日 ▶</button>
        <button type="button" data-free-action="step5">5日 ▶▶</button>
        <button type="button" class="finish" data-free-action="finish">結果を見る</button>
      </div>
      <div class="free-flow-result-v5" data-free-result hidden>
        <div><span>運用実践スコア</span><strong data-free-score>—</strong><small data-free-grade>—</small></div>
        <button type="button" data-free-action="breakdown">点数の内訳を見る</button>
        <button type="button" class="primary" data-free-action="report">レポート画像を作る</button>
      </div>
      <p class="free-flow-status-v5" data-free-status aria-live="polite"></p>`;
    const anchor = document.getElementById("guidedReplayPanel");
    if (anchor) anchor.insertAdjacentElement("afterend", panel);
    else (document.getElementById("practiceArea") || document.body).prepend(panel);
    return panel;
  }

  function ensureFreeSheet() {
    let sheet = document.getElementById("freePracticeSheetV5");
    if (sheet) return sheet;
    sheet = document.createElement("aside");
    sheet.id = "freePracticeSheetV5";
    sheet.className = "free-practice-sheet-v5";
    sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML = `<div class="free-practice-sheet-handle-v5"></div><div class="free-practice-sheet-body-v5" data-free-sheet-body></div>`;
    document.body.appendChild(sheet);
    return sheet;
  }

  function closeSheet() {
    const sheet = ensureFreeSheet();
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
  }

  function openSheet(markup) {
    const sheet = ensureFreeSheet();
    const body = sheet.querySelector("[data-free-sheet-body]");
    body.innerHTML = markup;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
  }

  function entrySheet() {
    resetPending("entry");
    const row = currentRowSafe();
    const split = Number(document.getElementById("autoEntrySlots")?.value || 1);
    const chunk = document.getElementById("slotShares")?.textContent?.trim() || "—";
    openSheet(`
      <div class="free-sheet-heading-v5"><span>ENTRY</span><h2>${Number(stateRef()?.account?.shares || 0) > 0 ? "追加エントリー" : "エントリー"}</h2><p>自由練習でも、入る理由を残してから注文しよう。</p></div>
      <div class="free-sheet-quote-v5"><span>現在値 <strong>${yen(row?.close)}</strong></span><span>1枠の目安 <strong>${chunk}</strong></span></div>
      <div class="free-sheet-grid-v5">
        <label>入る理由<select data-free-entry-thesis>${options(THESIS)}</select></label>
        <label>決算・権利など<select data-free-entry-event>${options(EVENTS)}</select></label>
        <label>計画との関係<select data-free-entry-plan>${options(PLAN, "planned")}</select></label>
        <label>予定した買い方<select data-free-entry-split><option value="1"${split === 1 ? " selected" : ""}>一括</option><option value="2"${split === 2 ? " selected" : ""}>2分割</option><option value="4"${split === 4 ? " selected" : ""}>4分割</option><option value="8"${split === 8 ? " selected" : ""}>8分割</option></select></label>
        <label class="wide">ひと言メモ<input type="text" maxlength="100" data-free-entry-note placeholder="何を見て、なぜ入る？"></label>
      </div>
      <div class="free-sheet-custom-v5"><label>指定株数<input type="number" min="1" step="1" data-free-custom-shares placeholder="例：100"></label></div>
      <div class="free-sheet-actions-v5"><button type="button" data-free-sheet-action="close">戻る</button><button type="button" class="secondary" data-free-entry-submit="custom">指定株数で買う</button><button type="button" class="primary" data-free-entry-submit="chunk">1枠分を買う</button></div>
      <p class="free-sheet-status-v5" data-free-sheet-status></p>`);
  }

  function partialQuantity(shares, ratio, lotSize) {
    const total = Math.max(0, Math.floor(Number(shares) || 0));
    const lot = Math.max(1, Math.floor(Number(lotSize) || 1));
    if (!total) return 0;
    if (ratio >= 1) return total;
    const raw = Math.floor(total * ratio);
    const rounded = Math.floor(raw / lot) * lot;
    return rounded > 0 ? Math.min(total, rounded) : total;
  }

  function exitSheet() {
    resetPending("exit");
    const s = stateRef();
    const shares = Number(s?.account?.shares || 0);
    const lot = Number(s?.lotSize || document.getElementById("lotSize")?.value || 1);
    const quarter = partialQuantity(shares, 0.25, lot);
    const half = partialQuantity(shares, 0.5, lot);
    openSheet(`
      <div class="free-sheet-heading-v5"><span>EXIT</span><h2>利確・撤退を決める</h2><p>売る量と理由、残りをどう守るかを一緒に記録するよ。</p></div>
      <div class="free-sheet-quote-v5"><span>保有 <strong>${shares.toLocaleString("ja-JP")}株</strong></span><span>売買単位 <strong>${lot.toLocaleString("ja-JP")}株</strong></span></div>
      <div class="free-sheet-grid-v5">
        <label>売る理由<select data-free-exit-reason>${options(EXITS)}</select></label>
        <label>計画との関係<select data-free-exit-plan>${options(PLAN, "planned")}</select></label>
        <label class="wide">部分利確後の守り方<select data-free-exit-remaining>${options(REMAINING)}</select></label>
        <label class="wide">ひと言メモ<input type="text" maxlength="100" data-free-exit-note placeholder="なぜ今売る？"></label>
      </div>
      <div class="free-exit-buttons-v5">
        <button type="button" data-free-exit-submit="quarter"${quarter === shares ? " data-one-lot='true'" : ""}>${quarter === shares ? `全株 ${shares}株` : `25%｜${quarter}株`}</button>
        <button type="button" data-free-exit-submit="half"${half === shares ? " data-one-lot='true'" : ""}>${half === shares ? `全株 ${shares}株` : `50%｜${half}株`}</button>
        <button type="button" class="danger" data-free-exit-submit="all">全株｜${shares}株</button>
      </div>
      <div class="free-sheet-actions-v5"><button type="button" data-free-sheet-action="close">まだ保有する</button></div>
      <p class="free-sheet-status-v5" data-free-sheet-status>${lot > 1 ? `${lot}株単位で売却します。1単元しか残っていない場合は部分売却できません。` : ""}</p>`);
  }

  function sheetStatus(message, error = false) {
    const node = document.querySelector("#freePracticeSheetV5 [data-free-sheet-status]");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("negative", error);
  }

  function submitEntry(kind) {
    const sheet = ensureFreeSheet();
    const thesis = sheet.querySelector("[data-free-entry-thesis]")?.value || "";
    const eventContext = sheet.querySelector("[data-free-entry-event]")?.value || "";
    const planStatus = sheet.querySelector("[data-free-entry-plan]")?.value || "";
    const plannedSplitCount = Number(sheet.querySelector("[data-free-entry-split]")?.value || 1);
    const note = sheet.querySelector("[data-free-entry-note]")?.value || "";
    if (!thesis || !eventContext || !planStatus) {
      sheetStatus("入る理由・イベント状況・計画との関係を選んでね。", true);
      return;
    }
    setPending({ thesis, eventContext, planStatus, plannedSplitCount, note, exitReason: "", remainingStopDecision: "" });
    const before = Number(stateRef()?.trades?.length || 0);
    let clicked = false;
    if (kind === "custom") {
      const shares = Number(sheet.querySelector("[data-free-custom-shares]")?.value || 0);
      if (!Number.isFinite(shares) || shares <= 0) {
        sheetStatus("買う株数を入力してね。", true);
        return;
      }
      const source = document.getElementById("customBuyShares");
      if (source) source.value = String(Math.floor(shares));
      clicked = clickExisting("#buyCustomButton");
    } else clicked = clickExisting("#buyChunkButton");
    if (!clicked) {
      sheetStatus("まだ注文できません。買値・損切り・株数の設定を確認してね。", true);
      return;
    }
    setTimeout(() => {
      const succeeded = Number(stateRef()?.trades?.length || 0) > before;
      if (succeeded) {
        resetPending("entry");
        closeSheet();
      } else sheetStatus(document.getElementById("orderMessage")?.textContent || "注文できませんでした。", true);
      queueSync();
    }, 0);
  }

  function submitExit(kind) {
    const sheet = ensureFreeSheet();
    const reason = sheet.querySelector("[data-free-exit-reason]")?.value || "";
    const planStatus = sheet.querySelector("[data-free-exit-plan]")?.value || "";
    const remaining = sheet.querySelector("[data-free-exit-remaining]")?.value || "";
    const note = sheet.querySelector("[data-free-exit-note]")?.value || "";
    const partial = kind !== "all" && !sheet.querySelector(`[data-free-exit-submit="${kind}"]`)?.hasAttribute("data-one-lot");
    if (!reason || !planStatus || (partial && !remaining)) {
      sheetStatus(partial ? "売る理由・計画との関係・残りの守り方を選んでね。" : "売る理由と計画との関係を選んでね。", true);
      return;
    }
    setPending({ exitReason: reason, planStatus, remainingStopDecision: partial ? remaining : "", note, thesis: "" });
    const before = Number(stateRef()?.trades?.length || 0);
    const selector = kind === "quarter" ? "#sellQuarterButton" : kind === "half" ? "#sellHalfButton" : "#sellAllButton";
    if (!clickExisting(selector)) {
      sheetStatus("売却できません。保有株数を確認してね。", true);
      return;
    }
    setTimeout(() => {
      const succeeded = Number(stateRef()?.trades?.length || 0) > before;
      if (succeeded) {
        resetPending("exit");
        closeSheet();
      } else sheetStatus(document.getElementById("orderMessage")?.textContent || "売却できませんでした。", true);
      queueSync();
    }, 0);
  }

  function currentStep() {
    const s = stateRef();
    if (!s) return 0;
    if (s.ended) return 3;
    const trades = s.trades || [];
    const buys = trades.filter((trade) => trade.type === "BUY").length;
    const sells = trades.filter((trade) => trade.type === "SELL").length;
    const shares = Number(s.account?.shares || 0);
    if (!buys) return 0;
    if (shares > 0 && sells === 0) return 1;
    if (shares > 0) return 2;
    return 3;
  }

  function coachFor(step) {
    if (step === 0) return ["cosmos", "コスモス🌸", "チャートを見て、入る理由がそろったらエントリーしてみよう。"];
    if (step === 1) return ["aile", "エール💜", "損益だけでなく、決めた損切りと追加条件を守れているか確認しよう。"];
    if (step === 2) return ["lumo", "ルーモ✨", "利益を受け取る？ まだ伸ばす？ 理由を決めてから利確・撤退しよう。"];
    return ["cosmos", "コスモス🌸", "結果より、どの判断を再現できたかをレポートで振り返ろう。"];
  }

  function scoreResult() {
    try { return window.KabutanePracticeV2?.currentScore?.() || null; } catch (_) { return null; }
  }

  function updatePanel() {
    const panel = ensureFreePanel();
    const s = stateRef();
    const show = Boolean(isFree() && practiceVisible());
    panel.hidden = !show;
    document.body.classList.toggle("free-practice-cockpit-active-v5", show);
    if (!show) {
      closeSheet();
      return;
    }

    const m = metrics() || {};
    const shares = Number(s?.account?.shares || 0);
    const costBasis = finite(s?.account?.costBasis) || 0;
    const unrealized = finite(m.unrealized) || 0;
    const unrealizedPct = costBasis > 0 ? unrealized / costBasis * 100 : 0;
    const step = currentStep();
    const [character, name, message] = coachFor(step);

    panel.querySelectorAll("[data-free-step]").forEach((node) => {
      const index = Number(node.dataset.freeStep);
      node.classList.toggle("active", index === step);
      node.classList.toggle("done", index < step);
    });
    const coach = panel.querySelector("[data-free-coach]");
    coach.dataset.freeCoach = character;
    panel.querySelector("[data-free-coach-name]").textContent = name;
    panel.querySelector("[data-free-coach-message]").textContent = message;

    panel.querySelector("[data-free-shares]").textContent = `${shares.toLocaleString("ja-JP")}株`;
    panel.querySelector("[data-free-average]").textContent = yen(m.averagePrice);
    const pnlNode = panel.querySelector("[data-free-pnl]");
    pnlNode.textContent = yen(unrealized, true);
    pnlNode.classList.toggle("positive", unrealized >= 0);
    pnlNode.classList.toggle("negative", unrealized < 0);
    panel.querySelector("[data-free-pnl-pct]").textContent = pct(unrealizedPct);
    panel.querySelector("[data-free-total]").textContent = yen(m.totalProfit, true);
    panel.querySelector("[data-free-stop]").textContent = yen(s?.plan?.activeStop);

    const entry = panel.querySelector('[data-free-action="entry"]');
    entry.textContent = shares > 0 ? "＋ 追加" : ((s?.trades || []).some((trade) => trade.type === "BUY") ? "次のエントリー" : "エントリー");
    entry.disabled = Boolean(s?.ended);
    panel.querySelector('[data-free-action="exit"]').disabled = shares <= 0 || Boolean(s?.ended);
    panel.querySelector('[data-free-action="step"]').disabled = Boolean(s?.ended);
    panel.querySelector('[data-free-action="step5"]').disabled = Boolean(s?.ended);

    const resultBox = panel.querySelector("[data-free-result]");
    resultBox.hidden = !s?.ended;
    if (s?.ended) {
      const score = scoreResult();
      panel.querySelector("[data-free-score]").textContent = score ? `${score.score}点` : "集計中";
      panel.querySelector("[data-free-grade]").textContent = score?.grade || "";
      panel.querySelector('[data-free-action="finish"]').hidden = true;
    } else panel.querySelector('[data-free-action="finish"]').hidden = false;

    if ((s?.trades || []).length !== lastTradeCount) {
      lastTradeCount = (s?.trades || []).length;
      panel.querySelector("[data-free-status]").textContent = shares > 0 ? "チャートを見ながら、このコックピットだけで次の判断へ進めます。" : "エントリー前に買値・損切り・枚数の設定を確認してね。";
    }
  }

  function advancedTarget() {
    return document.getElementById("workspaceRisk") || document.querySelector(".risk-panel") || document.querySelector(".order-panel");
  }

  function handleAction(action) {
    if (action === "entry") { entrySheet(); return; }
    if (action === "exit") { exitSheet(); return; }
    if (action === "step") { clickExisting("#stepOneButton"); return; }
    if (action === "step5") { clickExisting("#stepFiveButton"); return; }
    if (action === "finish") { clickExisting("#finishButton"); setTimeout(queueSync, 0); return; }
    if (action === "advanced") { advancedTarget()?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "breakdown") {
      const target = document.getElementById("finishSummary");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (action === "report") {
      const button = document.querySelector('[data-share-action="open"]');
      if (button) button.click();
      else document.getElementById("finishSummary")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function patchRenderAll() {
    try {
      if (typeof renderAll !== "function" || window.__kabutanePracticeV5RenderPatched) return;
      window.__kabutanePracticeV5RenderPatched = true;
      const base = renderAll;
      renderAll = function renderAllWithPracticeV5() {
        const value = base.apply(this, arguments);
        queueMicrotask(queueSync);
        return value;
      };
    } catch (_) {}
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      updatePanel();
    });
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-free-action]")?.dataset.freeAction;
    if (action) {
      event.preventDefault();
      handleAction(action);
      setTimeout(queueSync, 0);
      return;
    }
    if (event.target.closest("[data-free-sheet-action='close']")) {
      event.preventDefault();
      closeSheet();
      return;
    }
    const entry = event.target.closest("[data-free-entry-submit]")?.dataset.freeEntrySubmit;
    if (entry) {
      event.preventDefault();
      submitEntry(entry);
      return;
    }
    const exit = event.target.closest("[data-free-exit-submit]")?.dataset.freeExitSubmit;
    if (exit) {
      event.preventDefault();
      submitExit(exit);
      return;
    }
    if (event.target.closest("[data-replay-mode], #startSessionButton, #newSessionButton")) setTimeout(queueSync, 0);
  });

  window.addEventListener("resize", queueSync);
  window.addEventListener("orientationchange", () => setTimeout(queueSync, 120));
  window.addEventListener("kabutane:practice-score", queueSync);
  document.addEventListener("kabutane:practice-score", queueSync);

  patchRenderAll();
  ensureFreePanel();
  ensureFreeSheet();
  setTimeout(queueSync, 0);

  window.KabutanePracticeV5 = {
    queueSync,
    openEntry: entrySheet,
    openExit: exitSheet,
    closeSheet,
  };
})();
