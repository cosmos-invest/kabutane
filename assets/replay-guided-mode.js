(function () {
  "use strict";

  if (typeof document === "undefined" || typeof ReplayGuidedCore === "undefined") return;
  const GuideCore = ReplayGuidedCore;
  const GUIDE_STEPS = ["探す", "損切り", "利確", "枚数", "確認", "見守る", "判断", "振り返り", "共有"];
  const CHARACTER_NAMES = { cosmos: "コスモス🌸", lumo: "ルーモ✨", aile: "エール💜" };

  function guidedState() {
    if (!state.guided) {
      state.guided = {
        mode: localStorage.getItem("kabutane-replay-mode") === "free" ? "free" : "guided",
        step: "seek-entry",
        pendingEntry: null,
        pendingStop: null,
        pendingTarget: null,
        targetRatio: 2,
        splitCount: 1,
        totalShares: 0,
        trancheShares: 0,
        remainingTranches: 0,
        showLines: false,
        selectMode: null,
        targetTriggered: false,
        daysHeld: 0,
        entryCursor: null,
        lastCoachKey: "",
        outcome: "",
        checks: {
          stopBeforeEntry: false,
          rewardPlanned: false,
          riskSized: false,
          stopHeld: true,
          exitDecision: false,
          reviewed: false,
        },
      };
    }
    return state.guided;
  }

  function isGuided() {
    return guidedState().mode === "guided";
  }

  function formatPrice(value) {
    const number = GuideCore.finite(value);
    return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`;
  }

  function formatPct(value) {
    const number = GuideCore.finite(value);
    return number === null ? "—" : `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
  }

  function setCoach(character, text, key = "") {
    const guide = guidedState();
    if (key) guide.lastCoachKey = key;
    const root = document.getElementById("guidedCoach");
    if (!root) return;
    root.dataset.character = character;
    root.querySelector("[data-guide-character]").textContent = CHARACTER_NAMES[character] || CHARACTER_NAMES.cosmos;
    root.querySelector("[data-guide-message]").textContent = text;
  }

  function currentStepIndex() {
    const step = guidedState().step;
    return ({
      "seek-entry": 0,
      stop: 1,
      target: 2,
      size: 3,
      review: 4,
      observe: 5,
      targetDecision: 6,
      decision: 6,
      finished: 7,
    })[step] ?? 0;
  }

  function installModeSelector() {
    const setup = document.getElementById("setupPanel");
    const grid = setup?.querySelector(".setup-grid");
    if (!setup || !grid || document.getElementById("replayModeSelector")) return;
    const selected = guidedState().mode;
    grid.insertAdjacentHTML("beforebegin", `
      <section id="replayModeSelector" class="replay-mode-selector" aria-label="練習モード">
        <button type="button" data-replay-mode="guided" class="${selected === "guided" ? "active" : ""}">
          <span>🔰 はじめてモード</span><small>1つずつ判断して、取引の順番を身につける</small>
        </button>
        <button type="button" data-replay-mode="free" class="${selected === "free" ? "active" : ""}">
          <span>🛠️ 自由練習モード</span><small>詳細な注文・分割・指標を自分で設定する</small>
        </button>
      </section>`);
  }

  function installGuidePanel() {
    const workspace = document.getElementById("replayWorkspace") || document.getElementById("practiceArea");
    if (!workspace || document.getElementById("guidedReplayPanel")) return;
    const panel = document.createElement("section");
    panel.id = "guidedReplayPanel";
    panel.className = "guided-replay-panel panel";
    panel.innerHTML = `
      <div class="guided-step-strip" aria-label="練習の進み具合">
        ${GUIDE_STEPS.map((label, index) => `<span data-guide-step="${index}"><b>${index + 1}</b>${label}</span>`).join("")}
      </div>
      <div id="guidedCoach" class="guided-coach" data-character="lumo">
        <div class="guided-character-image" aria-hidden="true"></div>
        <div class="guided-coach-copy"><strong data-guide-character>ルーモ✨</strong><p data-guide-message>チャートを1日ずつ進めて、「ここで入りたい」と思う場所を探そう！</p></div>
      </div>
      <div class="guided-status-line">
        <div><span>いまの手順</span><strong id="guidedStepTitle">エントリー候補を探す</strong></div>
        <button id="guidedLineToggle" type="button" class="guided-small-button">ライン確認</button>
      </div>
      <div id="guidedActionArea" class="guided-action-area"></div>
      <p id="guidedNotice" class="guided-notice" aria-live="polite"></p>`;
    const toolbar = workspace.querySelector("#unifiedToolbar");
    if (toolbar?.nextSibling) workspace.insertBefore(panel, toolbar.nextSibling);
    else workspace.prepend(panel);

    const sheet = document.createElement("aside");
    sheet.id = "guidedSheet";
    sheet.className = "guided-sheet";
    sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML = `<div class="guided-sheet-handle"></div><div id="guidedSheetBody" class="guided-sheet-body"></div>`;
    document.body.appendChild(sheet);
  }

  function setMode(mode) {
    const guide = guidedState();
    guide.mode = mode === "free" ? "free" : "guided";
    localStorage.setItem("kabutane-replay-mode", guide.mode);
    document.querySelectorAll("[data-replay-mode]").forEach((button) => button.classList.toggle("active", button.dataset.replayMode === guide.mode));
    document.body.classList.toggle("guided-replay-mode", guide.mode === "guided");
    document.body.classList.toggle("free-replay-mode", guide.mode === "free");
    if (els?.showPlanLines) els.showPlanLines.checked = guide.mode === "free";
    if (els?.showAverage && guide.mode === "guided") els.showAverage.checked = false;
    closeSheet();
    renderGuidedUi();
    if (typeof renderMainChart === "function" && !els?.practiceArea?.hidden) renderMainChart();
  }

  function resetGuide() {
    const mode = guidedState().mode;
    state.guided = null;
    const guide = guidedState();
    guide.mode = mode;
    guide.step = "seek-entry";
    guide.lastCoachKey = "start";
    guide.showLines = false;
    guide.selectMode = null;
    setCoach("lumo", "未来はまだ見えないよ。1日ずつ進めて、『ここで入りたい』と思う場所を探そう✨", "start");
  }

  function clearPlanForNextTrade() {
    const guide = guidedState();
    guide.step = "seek-entry";
    guide.pendingEntry = null;
    guide.pendingStop = null;
    guide.pendingTarget = null;
    guide.targetRatio = 2;
    guide.splitCount = 1;
    guide.totalShares = 0;
    guide.trancheShares = 0;
    guide.remainingTranches = 0;
    guide.showLines = false;
    guide.selectMode = null;
    guide.targetTriggered = false;
    guide.daysHeld = 0;
    guide.entryCursor = null;
    guide.outcome = "";
    state.plan.armed = false;
    state.plan.entry = null;
    state.plan.initialStop = null;
    state.plan.activeStop = null;
    state.plan.entryDate = null;
    state.plan.tpPrices = [];
    state.plan.hitTargets = [false, false, false, false];
    if (els?.entryPrice) els.entryPrice.value = "";
    if (els?.stopPrice) els.stopPrice.value = "";
    setCoach("lumo", "つぎのチャンスを探そう！焦って買わなくて大丈夫だよ✨", `next-${state.cursor}`);
    renderAll();
  }

  function setNotice(text, error = false) {
    const notice = document.getElementById("guidedNotice");
    if (!notice) return;
    notice.textContent = text || "";
    notice.classList.toggle("negative", error);
  }

  function openSheet(markup) {
    const sheet = document.getElementById("guidedSheet");
    const body = document.getElementById("guidedSheetBody");
    if (!sheet || !body) return;
    body.innerHTML = markup;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
  }

  function closeSheet() {
    const sheet = document.getElementById("guidedSheet");
    if (!sheet) return;
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    guidedState().selectMode = null;
  }

  function beginEntryChoice() {
    const guide = guidedState();
    const row = currentRow();
    if (!row) return;
    guide.pendingEntry = GuideCore.finite(row.close);
    guide.step = "stop";
    guide.showLines = true;
    guide.selectMode = "stop";
    state.plan.entry = guide.pendingEntry;
    state.plan.initialStop = null;
    state.plan.activeStop = null;
    state.plan.tpPrices = [];
    els.entryPrice.value = guide.pendingEntry.toFixed(2);
    els.stopPrice.value = "";
    setCoach("lumo", "ここで入りたいと思ったんだね！でも、まだ買わないよ。先に逃げ道を決めよう✨", "choose-entry");
    showStopSheet();
    renderAll();
  }

  function stopHint() {
    return GuideCore.recentLowHint(state.rows, state.cursor, 20);
  }

  function showStopSheet() {
    const guide = guidedState();
    const hint = stopHint();
    openSheet(`
      <div class="guided-sheet-heading"><span>STEP 2</span><h2>損切り価格はどこ？</h2><p>今回の予想が外れたと判断する価格を、買う前に決めよう。</p></div>
      <div class="guided-sheet-price"><label>損切り価格<input id="guidedStopInput" type="number" min="0" step="0.1" value="${guide.pendingStop ?? ""}"></label><button type="button" data-guided-action="select-stop-chart">チャートで選ぶ</button></div>
      <label class="guided-hint-toggle"><input id="guidedStopHintToggle" type="checkbox"> 直近安値のヒントを見る</label>
      <div id="guidedStopHint" class="guided-hint-box" hidden>${hint ? `${hint.date}の${formatPrice(hint.price)}付近で一度下げ止まってるよ。現在値から${formatPct(hint.distancePct)}の位置だよ。` : "はっきりした直近安値が見つからなかったよ。チャートを見て、想定が崩れる場所を考えよう。"}</div>
      <div class="guided-risk-note"><strong>エール💜</strong><p>近すぎると小さな揺れで損切りになりやすいよ。遠すぎると買える株数が少なくなるよ。</p></div>
      <div class="guided-sheet-actions"><button type="button" class="secondary" data-guided-action="back-entry">戻る</button><button type="button" class="primary" data-guided-action="confirm-stop">この損切りで進む</button></div>`);
  }

  function confirmStop() {
    const guide = guidedState();
    const input = document.getElementById("guidedStopInput");
    const stop = GuideCore.finite(input?.value ?? guide.pendingStop);
    if (stop === null || stop <= 0 || stop >= guide.pendingEntry) {
      setNotice("損切りはエントリー価格より下に置いてね。", true);
      return;
    }
    guide.pendingStop = stop;
    guide.checks.stopBeforeEntry = true;
    guide.step = "target";
    guide.selectMode = null;
    state.plan.initialStop = stop;
    state.plan.activeStop = stop;
    els.stopPrice.value = stop.toFixed(2);
    setCoach("aile", "逃げ道を先に決められたね。次は、どこまで上がったら利益を受け取るか決めよう💜", "stop-set");
    showTargetSheet();
    renderAll();
  }

  function chooseRatio(ratio) {
    const guide = guidedState();
    guide.targetRatio = Number(ratio);
    guide.pendingTarget = GuideCore.targetPrice(guide.pendingEntry, guide.pendingStop, guide.targetRatio);
    state.plan.ratios = [guide.targetRatio, 3, 4, 5];
    state.plan.tpPrices = [guide.pendingTarget];
    document.querySelectorAll("[data-guide-ratio]").forEach((button) => button.classList.toggle("active", Number(button.dataset.guideRatio) === guide.targetRatio));
    const input = document.getElementById("guidedTargetInput");
    if (input && guide.pendingTarget !== null) input.value = guide.pendingTarget.toFixed(2);
    updateRewardPreview();
    renderMainChart();
  }

  function updateRewardPreview() {
    const guide = guidedState();
    const preview = document.getElementById("guidedRewardPreview");
    const warning = document.getElementById("guidedRewardWarning");
    if (!preview) return;
    const target = GuideCore.finite(document.getElementById("guidedTargetInput")?.value ?? guide.pendingTarget);
    const ratio = GuideCore.rewardRatio(guide.pendingEntry, guide.pendingStop, target);
    preview.textContent = ratio === null ? "R倍率 —" : `利益候補 ${formatPrice(target)}・約${ratio.toFixed(2)}R`;
    if (warning) {
      warning.hidden = ratio === null || ratio >= 1.5;
      warning.textContent = ratio !== null && ratio < 1 ? "損失候補より利益候補が小さい設定だよ。少なくとも1R以上を考えよう。" : "1.5R未満だよ。勝率が高くないと資産を増やしにくい設定になるよ。";
    }
  }

  function showTargetSheet() {
    const guide = guidedState();
    if (guide.pendingTarget === null) guide.pendingTarget = GuideCore.targetPrice(guide.pendingEntry, guide.pendingStop, guide.targetRatio);
    openSheet(`
      <div class="guided-sheet-heading"><span>STEP 3</span><h2>利確位置を選ぼう</h2><p>損失1に対して、どれくらいの利益を狙うか決めよう。</p></div>
      <div class="guided-ratio-buttons"><button type="button" data-guide-ratio="1.5">1.5R</button><button type="button" class="active" data-guide-ratio="2">2R おすすめ</button><button type="button" data-guide-ratio="3">3R</button></div>
      <div class="guided-sheet-price"><label>利確候補<input id="guidedTargetInput" type="number" min="0" step="0.1" value="${guide.pendingTarget?.toFixed(2) || ""}"></label><button type="button" data-guided-action="select-target-chart">チャートで選ぶ</button></div>
      <strong id="guidedRewardPreview" class="guided-reward-preview"></strong><p id="guidedRewardWarning" class="guided-warning" hidden></p>
      <div class="guided-risk-note"><strong>コスモス🌸</strong><p>高い目標ほど良いわけじゃないよ。過去の高値や上値の重そうな場所も一緒に見よう🌸</p></div>
      <div class="guided-sheet-actions"><button type="button" class="secondary" data-guided-action="back-stop">戻る</button><button type="button" class="primary" data-guided-action="confirm-target">この利確で進む</button></div>`);
    chooseRatio(guide.targetRatio || 2);
  }

  function confirmTarget() {
    const guide = guidedState();
    const target = GuideCore.finite(document.getElementById("guidedTargetInput")?.value ?? guide.pendingTarget);
    const ratio = GuideCore.rewardRatio(guide.pendingEntry, guide.pendingStop, target);
    if (target === null || target <= guide.pendingEntry || ratio === null || ratio < 1) {
      setNotice("利確候補はエントリーより上で、少なくとも1R以上にしよう。", true);
      return;
    }
    guide.pendingTarget = target;
    guide.targetRatio = ratio;
    guide.checks.rewardPlanned = true;
    guide.step = "size";
    guide.selectMode = null;
    state.plan.ratios = [ratio, Math.max(3, ratio + 1), Math.max(4, ratio + 2), Math.max(5, ratio + 3)];
    state.plan.tpPrices = [target];
    setCoach("cosmos", "入口と出口が決まったね。次は、負けても困らない枚数にしよう🌸", "target-set");
    showSizeSheet();
    renderAll();
  }

  function sizing() {
    const guide = guidedState();
    const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
    return GuideCore.riskSizing({
      assets: state.initialCapital,
      riskPct: state.riskPct,
      allocationPct: state.allocationPct,
      entry: guide.pendingEntry,
      stop: guide.pendingStop,
      cash: state.account.cash,
      lotSize: state.lotSize,
      costBps: state.costBps,
      currentShares: state.account.shares,
      currentAveragePrice: metrics.averagePrice,
    });
  }

  function showSizeSheet() {
    const guide = guidedState();
    const plan = sizing();
    guide.totalShares = plan.recommendedShares;
    guide.trancheShares = GuideCore.trancheShares(plan.recommendedShares, guide.splitCount, state.lotSize);
    openSheet(`
      <div class="guided-sheet-heading"><span>STEP 4</span><h2>何株までなら大丈夫？</h2><p>損切りになっても、許容損失率を超えない株数を計算したよ。</p></div>
      <div class="guided-sizing-grid">
        <article><span>許容損失額</span><strong>${formatPrice(plan.riskBudget)}</strong></article>
        <article><span>1株のリスク</span><strong>${formatPrice(plan.riskPerShare)}</strong></article>
        <article><span>推奨上限</span><strong>${plan.recommendedShares.toLocaleString("ja-JP")}株</strong></article>
        <article><span>想定最大損失</span><strong>${formatPrice(plan.plannedLoss)}</strong></article>
      </div>
      <div class="guided-split-choice"><strong>買い方を選ぼう</strong><div><button type="button" class="active" data-guide-split="1">一括</button><button type="button" data-guide-split="2">2分割</button><button type="button" data-guide-split="4">4分割</button></div><p id="guidedSplitPreview"></p></div>
      <div class="guided-risk-note"><strong>エール💜</strong><p>分割しても、合計の損失上限は増やさないよ。追加で買う時も、残りのリスクを毎回計算するよ。</p></div>
      <div class="guided-sheet-actions"><button type="button" class="secondary" data-guided-action="back-target">戻る</button><button type="button" class="primary" data-guided-action="confirm-size" ${plan.recommendedShares <= 0 ? "disabled" : ""}>この枚数で確認する</button></div>`);
    selectSplit(guide.splitCount || 1);
  }

  function selectSplit(splitCount) {
    const guide = guidedState();
    guide.splitCount = [1, 2, 4].includes(Number(splitCount)) ? Number(splitCount) : 1;
    guide.trancheShares = GuideCore.trancheShares(guide.totalShares, guide.splitCount, state.lotSize);
    document.querySelectorAll("[data-guide-split]").forEach((button) => button.classList.toggle("active", Number(button.dataset.guideSplit) === guide.splitCount));
    const preview = document.getElementById("guidedSplitPreview");
    if (preview) preview.textContent = guide.splitCount === 1
      ? `${guide.totalShares.toLocaleString("ja-JP")}株を一度に購入するよ。`
      : `初回${guide.trancheShares.toLocaleString("ja-JP")}株。残りは最大${guide.splitCount - 1}回に分けるよ。`;
  }

  function confirmSize() {
    const guide = guidedState();
    const plan = sizing();
    if (plan.recommendedShares <= 0) {
      setNotice("この条件では買える株数がないよ。損切りや資金設定を見直そう。", true);
      return;
    }
    guide.totalShares = plan.recommendedShares;
    guide.trancheShares = GuideCore.trancheShares(plan.recommendedShares, guide.splitCount, state.lotSize);
    guide.remainingTranches = Math.max(0, guide.splitCount - 1);
    guide.checks.riskSized = true;
    guide.step = "review";
    showReviewSheet();
    renderGuidedUi();
  }

  function showReviewSheet() {
    const guide = guidedState();
    const plan = sizing();
    openSheet(`
      <div class="guided-sheet-heading"><span>STEP 5</span><h2>注文前の最終確認</h2><p>買ってから考えるのではなく、買う前に全部決められたよ。</p></div>
      <dl class="guided-review-list">
        <div><dt>エントリー</dt><dd>${formatPrice(guide.pendingEntry)}</dd></div>
        <div><dt>損切り</dt><dd>${formatPrice(guide.pendingStop)}</dd></div>
        <div><dt>利確候補</dt><dd>${formatPrice(guide.pendingTarget)}・${guide.targetRatio.toFixed(2)}R</dd></div>
        <div><dt>推奨上限</dt><dd>${guide.totalShares.toLocaleString("ja-JP")}株</dd></div>
        <div><dt>初回購入</dt><dd>${guide.trancheShares.toLocaleString("ja-JP")}株・${guide.splitCount}分割</dd></div>
        <div><dt>想定最大損失</dt><dd>${formatPrice(plan.plannedLoss)}・総資産の${formatPct(plan.plannedLoss / state.initialCapital * 100)}</dd></div>
      </dl>
      <div class="guided-risk-note"><strong>コスモス🌸</strong><p>損切りになっても、この金額までなら次の練習へ進めるか確認しよう🌸</p></div>
      <div class="guided-sheet-actions"><button type="button" class="secondary" data-guided-action="back-size">修正する</button><button type="button" class="primary guided-entry-confirm" data-guided-action="confirm-entry">この内容でエントリー</button></div>`);
  }

  function confirmEntry() {
    const guide = guidedState();
    const slots = Math.max(1, Math.floor(ReplayPro.MAX_SLOTS / guide.splitCount));
    state.plan.entry = guide.pendingEntry;
    state.plan.initialStop = guide.pendingStop;
    state.plan.activeStop = guide.pendingStop;
    state.plan.tpPrices = [guide.pendingTarget];
    state.plan.ratios = [guide.targetRatio, Math.max(3, guide.targetRatio + 1), Math.max(4, guide.targetRatio + 2), Math.max(5, guide.targetRatio + 3)];
    state.plan.armed = false;
    const result = executeBuy(guide.trancheShares, guide.pendingEntry, "ガイドエントリー", slots);
    if (!result.ok) {
      setNotice(result.error || "エントリーできなかったよ。", true);
      return;
    }
    state.plan.entryDate = currentRow().date;
    state.plan.initialAutoShares = guide.totalShares;
    state.plan.hitTargets = [false, false, false, false];
    guide.entryCursor = state.cursor;
    guide.daysHeld = 0;
    guide.targetTriggered = false;
    guide.step = "observe";
    guide.showLines = false;
    guide.selectMode = null;
    els.sessionState.textContent = "見守り中";
    closeSheet();
    setCoach("lumo", "エントリー完了！ここからは当てるゲームじゃなくて、決めたルールを守る練習だよ✨", "entry");
    message(`${result.shares.toLocaleString("ja-JP")}株を購入したよ。損切り${formatPrice(guide.pendingStop)}、利確候補${formatPrice(guide.pendingTarget)}を見守ろう。`);
    renderAll();
  }

  function additionalEntry() {
    const guide = guidedState();
    if (guide.remainingTranches <= 0 || state.account.shares <= 0) return;
    const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
    const plan = GuideCore.riskSizing({
      assets: state.initialCapital,
      riskPct: state.riskPct,
      allocationPct: state.allocationPct,
      entry: currentRow().close,
      stop: state.plan.activeStop,
      cash: state.account.cash,
      lotSize: state.lotSize,
      costBps: state.costBps,
      currentShares: state.account.shares,
      currentAveragePrice: metrics.averagePrice,
    });
    const shares = Math.min(guide.trancheShares, plan.recommendedShares);
    if (shares <= 0) {
      setNotice("残りの許容損失では追加購入できないよ。無理に枚数を増やさないでおこう。", true);
      return;
    }
    const slots = Math.max(1, Math.floor(ReplayPro.MAX_SLOTS / guide.splitCount));
    const result = executeBuy(shares, currentRow().close, "ガイド追加エントリー", slots);
    if (!result.ok) {
      setNotice(result.error, true);
      return;
    }
    guide.remainingTranches -= 1;
    setCoach("aile", `${result.shares.toLocaleString("ja-JP")}株を追加したよ。合計の許容損失は超えていないから、ここからまた落ち着いて見守ろう。`, `add-${state.cursor}`);
    renderAll();
  }

  function handleStopHit(price) {
    const guide = guidedState();
    const result = executeSell(state.account.shares, price, "ガイド損切り");
    guide.outcome = "stop";
    guide.step = "decision";
    guide.checks.exitDecision = true;
    guide.showLines = false;
    stopPlayback();
    els.sessionState.textContent = "損切り完了";
    message(`${formatPrice(price)}で損切りしたよ。実現損益${formatPrice(result.realized)}。`);
    setCoach("lumo", "損切りできた！つぎつぎー！✨ 損を出したことより、決めた上限で止められたことが大事だよ！", `stop-${state.cursor}`);
  }

  function handleTargetHit() {
    const guide = guidedState();
    guide.targetTriggered = true;
    guide.step = "targetDecision";
    stopPlayback();
    els.sessionState.textContent = "利確判断";
    setCoach("aile", "利確候補に届いたよ！うれしい時ほど、どれくらい利益を受け取るか落ち着いて決めよう💜", `target-${state.cursor}`);
    showTargetDecisionSheet();
  }

  function showTargetDecisionSheet() {
    const guide = guidedState();
    openSheet(`
      <div class="guided-sheet-heading"><span>STEP 7</span><h2>利確候補へ到達したよ</h2><p>${formatPrice(guide.pendingTarget)}へ届いたよ。どれくらい利益を確定する？</p></div>
      <div class="guided-exit-buttons"><button type="button" data-guided-exit="0.25">25％利確</button><button type="button" data-guided-exit="0.5">50％利確</button><button type="button" data-guided-exit="1">全利確</button><button type="button" data-guided-exit="0">利確せず継続</button></div>
      <label class="guided-hint-toggle"><input id="guidedRaiseStop" type="checkbox" checked> 残りの損切りを買値まで上げる</label>
      <div class="guided-risk-note"><strong>エール💜</strong><p>部分利確したら、残りをどう守るかも一緒に決めよう。利益が出た後に損切りを遠ざけるのは避けようね。</p></div>`);
  }

  function decideTargetExit(ratio) {
    const guide = guidedState();
    const value = Number(ratio);
    if (value > 0) {
      let shares = value >= 1 ? state.account.shares : ReplayPro.roundToLot(state.account.shares * value, state.lotSize);
      if (shares <= 0) shares = state.account.shares;
      const result = executeSell(shares, guide.pendingTarget, value >= 1 ? "ガイド全利確" : `ガイド${Math.round(value * 100)}％利確`);
      if (!result.ok) {
        setNotice(result.error, true);
        return;
      }
      guide.checks.exitDecision = true;
    }
    if (state.account.shares > 0 && document.getElementById("guidedRaiseStop")?.checked) {
      state.plan.activeStop = Math.max(state.plan.activeStop || 0, guide.pendingEntry);
    }
    closeSheet();
    if (state.account.shares <= 0) {
      guide.outcome = "target";
      guide.step = "decision";
      guide.showLines = false;
      setCoach("cosmos", "計画した利益を受け取れたね。結果だけじゃなく、順番どおり判断できたことも振り返ろう🌸", `exit-${state.cursor}`);
    } else {
      guide.step = "observe";
      setCoach("lumo", "一部を利確して、残りはもう一度見守りだね！守るラインも忘れずにいこう✨", `partial-${state.cursor}`);
    }
    renderAll();
  }

  function closePositionAndDecide() {
    const guide = guidedState();
    if (state.account.shares > 0) executeSell(state.account.shares, currentRow().close, "ガイド手動終了");
    guide.outcome = guide.outcome || "manual";
    guide.step = "decision";
    guide.checks.exitDecision = true;
    guide.showLines = false;
    stopPlayback();
    setCoach("cosmos", "ここで区切る判断も立派だよ。次へ進むか、今回を振り返るか決めよう🌸", `manual-${state.cursor}`);
    renderAll();
  }

  function finishGuidedSession() {
    const guide = guidedState();
    if (state.account.shares > 0) executeSell(state.account.shares, currentRow().close, "練習終了");
    guide.checks.reviewed = true;
    guide.step = "finished";
    guide.showLines = false;
    closeSheet();
    baseFinishSessionGuided();
    const score = GuideCore.complianceScore(guide.checks);
    setCoach("aile", `ルール達成は${score.achieved}/${score.total}だよ。利益だけじゃなく、守れた手順を次の練習にも持っていこう💜`, "finished");
    renderGuidedUi();
  }

  function coachDuringObservation() {
    const guide = guidedState();
    if (guide.step !== "observe" || state.account.shares <= 0) return;
    guide.daysHeld = guide.entryCursor === null ? 0 : Math.max(0, state.cursor - guide.entryCursor);
    const coach = GuideCore.coachMessage({
      daysHeld: guide.daysHeld,
      current: currentRow()?.close,
      entry: guide.pendingEntry,
      stop: state.plan.activeStop,
      target: guide.pendingTarget,
      lastKey: guide.lastCoachKey,
    });
    if (coach) setCoach(coach.character, coach.text, coach.key);
  }

  function processGuidedOrders(row) {
    const guide = guidedState();
    if (guide.step !== "observe" || state.account.shares <= 0) return;
    const stop = GuideCore.finite(state.plan.activeStop);
    const target = GuideCore.finite(guide.pendingTarget);
    const low = GuideCore.finite(row?.low);
    const high = GuideCore.finite(row?.high);
    if (stop !== null && low !== null && low <= stop) {
      handleStopHit(stop);
      return;
    }
    if (!guide.targetTriggered && target !== null && high !== null && high >= target) handleTargetHit();
  }

  function selectChartPrice(event) {
    const guide = guidedState();
    if (!isGuided()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!guide.selectMode || !state.chart?.scales?.y) return;
    const canvas = document.getElementById("replayChart");
    const rect = canvas.getBoundingClientRect();
    const pixelY = event.clientY - rect.top;
    const price = GuideCore.finite(state.chart.scales.y.getValueForPixel(pixelY));
    if (price === null) return;
    if (guide.selectMode === "stop") {
      guide.pendingStop = price;
      state.plan.initialStop = price;
      state.plan.activeStop = price;
      els.stopPrice.value = price.toFixed(2);
      const input = document.getElementById("guidedStopInput");
      if (input) input.value = price.toFixed(2);
      setNotice(`${formatPrice(price)}を損切り候補にしたよ。`);
    } else if (guide.selectMode === "target") {
      guide.pendingTarget = price;
      guide.targetRatio = GuideCore.rewardRatio(guide.pendingEntry, guide.pendingStop, price) || 0;
      state.plan.tpPrices = [price];
      const input = document.getElementById("guidedTargetInput");
      if (input) input.value = price.toFixed(2);
      updateRewardPreview();
      setNotice(`${formatPrice(price)}を利確候補にしたよ。`);
    }
    renderMainChart();
  }

  function renderGuidedUi() {
    const guide = guidedState();
    const panel = document.getElementById("guidedReplayPanel");
    if (!panel) return;
    document.body.classList.toggle("guided-replay-mode", isGuided());
    document.body.classList.toggle("free-replay-mode", !isGuided());
    panel.hidden = !isGuided() || Boolean(els?.practiceArea?.hidden);
    if (panel.hidden) return;

    const index = currentStepIndex();
    panel.querySelectorAll("[data-guide-step]").forEach((node) => {
      const stepIndex = Number(node.dataset.guideStep);
      node.classList.toggle("active", stepIndex === index);
      node.classList.toggle("done", stepIndex < index);
    });
    const title = document.getElementById("guidedStepTitle");
    const actions = document.getElementById("guidedActionArea");
    const toggle = document.getElementById("guidedLineToggle");
    if (toggle) {
      toggle.textContent = guide.showLines ? "ラインを隠す" : "ライン確認";
      toggle.hidden = !["stop", "target", "review", "observe", "targetDecision"].includes(guide.step);
    }

    const actionButton = (label, action, className = "") => `<button type="button" class="${className}" data-guided-action="${action}">${label}</button>`;
    if (guide.step === "seek-entry") {
      title.textContent = "エントリー候補を探す";
      actions.innerHTML = `${actionButton("1日進める", "step-one")}${actionButton("5日進める", "step-five", "secondary")}${actionButton("ここで入りたい", "choose-entry", "primary")}`;
    } else if (["stop", "target", "size", "review"].includes(guide.step)) {
      title.textContent = ({ stop: "損切りを決める", target: "利確位置を決める", size: "枚数を決める", review: "注文前に確認する" })[guide.step];
      actions.innerHTML = `<p>下のガイドに沿って、今の判断だけに集中しよう。</p>${actionButton("入力パネルを開く", `open-${guide.step}`, "primary")}`;
    } else if (guide.step === "observe") {
      title.textContent = "計画を守って見守る";
      const metrics = ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
      actions.innerHTML = `
        <div class="guided-live-metrics"><span>保有 <strong>${state.account.shares.toLocaleString("ja-JP")}株</strong></span><span>評価損益 <strong class="${metrics.unrealized >= 0 ? "positive" : "negative"}">${formatPrice(metrics.unrealized)}</strong></span><span>${guide.daysHeld}営業日目</span></div>
        ${actionButton("1日進める", "step-one", "primary")}${actionButton("5日進める", "step-five", "secondary")}${actionButton(state.timer ? "一時停止" : "自動再生", "toggle-play", "secondary")}
        ${guide.remainingTranches > 0 ? actionButton(`追加購入（残り${guide.remainingTranches}回）`, "add-entry") : ""}${actionButton("ここで取引を終える", "close-position", "ghost")}`;
    } else if (guide.step === "targetDecision") {
      title.textContent = "利確量を決める";
      actions.innerHTML = `${actionButton("利確の選択を開く", "open-targetDecision", "primary")}`;
    } else if (guide.step === "decision") {
      title.textContent = "次へ進むか振り返る";
      actions.innerHTML = `${actionButton("同じ銘柄で次を探す", "continue", "primary")}${actionButton("終了してレポート", "finish", "secondary")}`;
    } else if (guide.step === "finished") {
      title.textContent = "結果を振り返って共有する";
      const score = GuideCore.complianceScore(guide.checks);
      actions.innerHTML = `<div class="guided-finish-score"><span>ルール達成</span><strong>${score.achieved} / ${score.total} 🌱</strong></div>${actionButton("レポート画像を作る", "share", "primary")}${actionButton("もう一度練習", "restart", "secondary")}`;
    }
  }

  function handleAction(action) {
    const guide = guidedState();
    setNotice("");
    if (action === "step-one") advance(1);
    else if (action === "step-five") advance(5);
    else if (action === "toggle-play") togglePlayback();
    else if (action === "choose-entry") beginEntryChoice();
    else if (action === "select-stop-chart") { guide.selectMode = "stop"; guide.showLines = true; setNotice("チャート上の損切り候補をタップしてね。"); }
    else if (action === "select-target-chart") { guide.selectMode = "target"; guide.showLines = true; setNotice("チャート上の利確候補をタップしてね。"); }
    else if (action === "confirm-stop") confirmStop();
    else if (action === "confirm-target") confirmTarget();
    else if (action === "confirm-size") confirmSize();
    else if (action === "confirm-entry") confirmEntry();
    else if (action === "add-entry") additionalEntry();
    else if (action === "close-position") closePositionAndDecide();
    else if (action === "continue") clearPlanForNextTrade();
    else if (action === "finish") finishGuidedSession();
    else if (action === "share") document.dispatchEvent(new CustomEvent("kabutane:open-share-report"));
    else if (action === "restart") resetToSetup();
    else if (action === "open-stop") showStopSheet();
    else if (action === "open-target") showTargetSheet();
    else if (action === "open-size") showSizeSheet();
    else if (action === "open-review") showReviewSheet();
    else if (action === "open-targetDecision") showTargetDecisionSheet();
    else if (action === "back-entry") { guide.step = "seek-entry"; guide.showLines = false; guide.pendingEntry = null; closeSheet(); renderAll(); }
    else if (action === "back-stop") { guide.step = "stop"; showStopSheet(); }
    else if (action === "back-target") { guide.step = "target"; showTargetSheet(); }
    else if (action === "back-size") { guide.step = "size"; showSizeSheet(); }
  }

  function bindGuideEvents() {
    document.addEventListener("click", (event) => {
      const mode = event.target.closest("[data-replay-mode]");
      if (mode) { setMode(mode.dataset.replayMode); return; }
      const ratio = event.target.closest("[data-guide-ratio]");
      if (ratio) { chooseRatio(ratio.dataset.guideRatio); return; }
      const split = event.target.closest("[data-guide-split]");
      if (split) { selectSplit(split.dataset.guideSplit); return; }
      const exit = event.target.closest("[data-guided-exit]");
      if (exit) { decideTargetExit(exit.dataset.guidedExit); return; }
      const action = event.target.closest("[data-guided-action]")?.dataset.guidedAction;
      if (action) handleAction(action);
    });
    document.addEventListener("input", (event) => {
      const guide = guidedState();
      if (event.target.id === "guidedStopInput") {
        guide.pendingStop = GuideCore.finite(event.target.value);
        state.plan.initialStop = guide.pendingStop;
        state.plan.activeStop = guide.pendingStop;
        els.stopPrice.value = event.target.value;
        renderMainChart();
      }
      if (event.target.id === "guidedTargetInput") {
        guide.pendingTarget = GuideCore.finite(event.target.value);
        state.plan.tpPrices = guide.pendingTarget === null ? [] : [guide.pendingTarget];
        updateRewardPreview();
        renderMainChart();
      }
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "guidedStopHintToggle") {
        const box = document.getElementById("guidedStopHint");
        if (box) box.hidden = !event.target.checked;
        const hint = stopHint();
        if (event.target.checked && hint) {
          const input = document.getElementById("guidedStopInput");
          if (input && !input.value) {
            input.value = hint.price.toFixed(2);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }
    });
    document.getElementById("guidedLineToggle")?.addEventListener("click", () => {
      const guide = guidedState();
      guide.showLines = !guide.showLines;
      renderGuidedUi();
      renderMainChart();
    });
    document.getElementById("replayChart")?.addEventListener("click", selectChartPrice, true);
  }

  const basePlanLineDatasetsGuided = planLineDatasets;
  planLineDatasets = function planLineDatasetsGuided(visible) {
    if (!isGuided()) return basePlanLineDatasetsGuided(visible);
    if (!guidedState().showLines) return [];
    return basePlanLineDatasetsGuided(visible);
  };

  const basePriceViewportBoundsGuided = priceViewportBounds;
  priceViewportBounds = function priceViewportBoundsGuided(rows) {
    if (!isGuided() || guidedState().showLines) return basePriceViewportBoundsGuided(rows);
    const values = [];
    rows.forEach((row) => {
      [row.low, row.high].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
      if (els.showSma?.checked) [row.sma25, row.sma75, row.sma200].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
      if (els.showEma?.checked) [row.ema20, row.ema50].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
      if (els.showBollinger?.checked) [row.bbUpper, row.bbLower].forEach((value) => { const parsed = finite(value); if (parsed !== null) values.push(parsed); });
      if (els.showSupertrend?.checked) { const parsed = finite(row.supertrend); if (parsed !== null) values.push(parsed); }
      if (els.showHigh52?.checked) { const parsed = finite(row.high52); if (parsed !== null) values.push(parsed); }
    });
    if (!values.length) return {};
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    const rawRange = Math.max(maximum - minimum, Math.max(Math.abs(maximum), 1) * 0.02);
    minimum -= rawRange * 0.08;
    maximum += rawRange * 0.08;
    const baseRange = maximum - minimum;
    const center = (minimum + maximum) / 2 + state.chartView.yPan * baseRange;
    const scaledRange = baseRange * ReplayPro.clamp(state.chartView.yScale, 0.18, 8);
    return { min: center - scaledRange / 2, max: center + scaledRange / 2 };
  };

  const baseRenderMainChartGuided = renderMainChart;
  renderMainChart = function renderMainChartGuided() {
    baseRenderMainChartGuided();
    if (isGuided() && state.chart) {
      state.chart.options.plugins.legend.display = false;
      state.chart.update("none");
    }
  };

  const baseProcessAutomaticOrdersGuided = processAutomaticOrders;
  processAutomaticOrders = function processAutomaticOrdersGuided(row) {
    if (!isGuided()) return baseProcessAutomaticOrdersGuided(row);
    processGuidedOrders(row);
  };

  const baseAdvanceOneGuided = advanceOne;
  advanceOne = function advanceOneGuided() {
    const result = baseAdvanceOneGuided();
    if (result && isGuided()) coachDuringObservation();
    return result;
  };

  const baseRenderAllGuided = renderAll;
  renderAll = function renderAllGuided() {
    baseRenderAllGuided();
    if (isGuided()) {
      coachDuringObservation();
      renderGuidedUi();
    }
  };

  const baseStartSessionGuided = startSession;
  startSession = function startSessionGuided() {
    baseStartSessionGuided();
    if (!isGuided() || els.practiceArea.hidden) return;
    resetGuide();
    els.entryPrice.value = "";
    els.stopPrice.value = "";
    els.showPlanLines.checked = false;
    els.showAverage.checked = false;
    state.plan.entry = null;
    state.plan.initialStop = null;
    state.plan.activeStop = null;
    state.plan.tpPrices = [];
    document.body.classList.add("guided-replay-mode");
    message("チャートを1日ずつ進めて、入りたい場所を探そう。まだ注文ラインは表示しないよ。");
    renderAll();
  };

  const baseResetToSetupGuided = resetToSetup;
  resetToSetup = function resetToSetupGuided() {
    closeSheet();
    baseResetToSetupGuided();
    renderGuidedUi();
  };

  const baseFinishSessionGuided = finishSession;
  finishSession = function finishSessionGuided() {
    if (isGuided() && guidedState().step !== "finished") {
      closePositionAndDecide();
      return;
    }
    baseFinishSessionGuided();
  };

  document.addEventListener("DOMContentLoaded", () => {
    installModeSelector();
    installGuidePanel();
    bindGuideEvents();
    setMode(guidedState().mode);
  });
})();
