(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const AXIS_NAMES = [
    "事前計画",
    "リスク・資金管理",
    "エントリー・追加判断",
    "保有中の規律",
    "利確・撤退判断",
    "振り返り",
  ];

  let syncQueued = false;
  let lastScoreSignature = "";

  function stateRef() {
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }

  function finite(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatYen(value, signed = false) {
    const number = finite(value);
    if (number === null) return "—";
    const rounded = Math.round(number);
    const sign = signed && rounded > 0 ? "+" : "";
    return `${sign}${rounded.toLocaleString("ja-JP")}円`;
  }

  function formatPct(value) {
    const number = finite(value);
    if (number === null) return "—";
    return `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
  }

  function currentScore() {
    try { return window.KabutanePracticeV2?.currentScore?.() || null; } catch (_) { return null; }
  }

  function currentMetrics() {
    const s = stateRef();
    if (!s || typeof ReplayPro === "undefined" || typeof currentRow !== "function") return null;
    try { return ReplayPro.accountMetrics(s.account, currentRow()?.close, s.initialCapital); } catch (_) { return null; }
  }

  function fixMonthlyRsiLayout() {
    const details = document.getElementById("unifiedIndicatorDetails");
    const box = document.querySelector(".monthly-rsi-chart-box");
    const canvas = document.getElementById("monthlyRsiChart");
    if (!box || !canvas) return;
    if (details && document.body.classList.contains("guided-replay-mode")) details.open = true;
    box.classList.add("monthly-rsi-v4");
    const chart = stateRef()?.rsiChart;
    if (!chart?.options) return;
    chart.options.maintainAspectRatio = false;
    chart.options.layout = chart.options.layout || {};
    chart.options.layout.padding = { top: 4, right: 8, bottom: 12, left: 2 };
    if (chart.options.scales?.x?.ticks) {
      chart.options.scales.x.ticks.maxTicksLimit = matchMedia("(max-width: 760px)").matches ? 4 : 7;
      chart.options.scales.x.ticks.maxRotation = 0;
      chart.options.scales.x.ticks.minRotation = 0;
      chart.options.scales.x.ticks.padding = 6;
    }
    if (chart.options.scales?.y?.ticks) {
      chart.options.scales.y.ticks.stepSize = 20;
      chart.options.scales.y.ticks.padding = 6;
    }
    requestAnimationFrame(() => {
      try {
        chart.resize();
        chart.update("none");
      } catch (_) {}
    });
  }

  function scoreSignature(result) {
    return `${result?.score || 0}:${(result?.categories || []).map((item) => `${item.name}:${item.earned}`).join("|")}`;
  }

  function categoryMarkup(result, compact = false) {
    const groups = (result?.categories || []).filter((group) => AXIS_NAMES.includes(group.name));
    return groups.map((group) => {
      const pct = group.max ? Math.round(group.earned / group.max * 100) : 0;
      const items = compact ? "" : `<div class="practice-score-axis-items-v4">${(group.items || []).map((item) => `<span class="${item.ok ? "ok" : "miss"}">${item.ok ? "✓" : "○"} ${item.label} <b>${item.ok ? item.points : 0}/${item.points}</b></span>`).join("")}</div>`;
      return `<article class="practice-score-axis-v4"><div class="practice-score-axis-head-v4"><strong>${group.name}</strong><b>${group.earned} / ${group.max}</b></div><div class="practice-score-axis-bar-v4"><i style="width:${pct}%"></i></div>${items}</article>`;
    }).join("");
  }

  function missedPriority(result) {
    const misses = [];
    (result?.categories || []).forEach((group) => {
      if (!AXIS_NAMES.includes(group.name)) return;
      (group.items || []).forEach((item) => {
        if (!item.ok) misses.push({ ...item, group: group.name, priority: item.points + (group.name === "リスク・資金管理" ? 100 : 0) });
      });
    });
    misses.sort((a, b) => b.priority - a.priority || b.points - a.points);
    return misses[0] || null;
  }

  function ensureGuidedScoreBreakdown(result) {
    const actions = document.getElementById("guidedActionArea");
    if (!actions || !result) return;
    const s = stateRef();
    const finished = s?.guided?.step === "finished" || Boolean(actions.querySelector(".guided-finish-score"));
    if (!finished) {
      document.getElementById("guidedScoreBreakdownV4")?.remove();
      return;
    }
    let panel = document.getElementById("guidedScoreBreakdownV4");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "guidedScoreBreakdownV4";
      panel.className = "practice-score-breakdown-v4";
      const anchor = actions.querySelector(".guided-finish-score");
      if (anchor) anchor.insertAdjacentElement("afterend", panel); else actions.prepend(panel);
    }
    const signature = scoreSignature(result);
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    const miss = missedPriority(result);
    const timing = result.categories?.find((group) => group.name === "タイミングボーナス");
    panel.innerHTML = `<div class="practice-score-breakdown-title-v4"><div><span>SCORE BREAKDOWN</span><h3>${result.score}点の内訳</h3></div><small>✓ 達成 / ○ 未達成</small></div>${categoryMarkup(result)}<div class="practice-score-next-v4"><strong>${miss ? `次は「${miss.label}」で最大 +${miss.points}点` : "今回の運用ルールをそのまま再現しよう"}</strong><span>${miss ? `${miss.group}を優先すると点数だけでなく、運用の再現性も上げやすいよ。` : "大きな取りこぼしはありません。"}</span></div>${timing ? `<p class="practice-score-timing-v4">タイミングボーナス ${timing.earned}/${timing.max}点（運用6軸とは別枠）</p>` : ""}`;
  }

  function ensureShareScoreBreakdown(result) {
    const dialog = document.getElementById("replayShareDialog");
    const preview = document.getElementById("replaySharePreview");
    if (!dialog || !preview || !result) return;
    let panel = dialog.querySelector("#shareScoreBreakdownV4");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "shareScoreBreakdownV4";
      panel.className = "share-score-breakdown-v4";
      preview.insertAdjacentElement("afterend", panel);
    }
    const signature = scoreSignature(result);
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    panel.innerHTML = `<div class="share-score-head-v4"><strong>運用実践スコア ${result.score}点</strong><span>${result.grade}</span></div><p>どの判断軸を守れたか</p>${categoryMarkup(result, true)}<details><summary>達成した判定項目まで見る</summary><div class="share-score-items-v4">${categoryMarkup(result)}</div></details>`;
  }

  function ensureQuickDock() {
    let dock = document.getElementById("practiceQuickDockV4");
    if (dock) return dock;
    dock = document.createElement("aside");
    dock.id = "practiceQuickDockV4";
    dock.className = "practice-quick-dock-v4";
    dock.hidden = true;
    dock.innerHTML = `
      <div class="practice-quick-metrics-v4">
        <span>保有 <strong data-quick-shares>—</strong></span>
        <span>評価 <strong data-quick-pnl>—</strong><small data-quick-pnl-pct>—</small></span>
        <span>SL <strong data-quick-stop>—</strong></span>
      </div>
      <div class="practice-quick-actions-v4">
        <button type="button" data-quick-action="add">＋ 追加</button>
        <button type="button" data-quick-action="sell">利確</button>
        <button type="button" class="primary" data-quick-action="step">1日 ▶</button>
      </div>
      <section class="practice-quick-sell-v4" data-quick-sell-menu hidden>
        <div class="practice-quick-sell-grid-v4">
          <label>売る理由<select data-quick-exit-reason><option value="">選択</option><option value="planned_target">予定していた利確</option><option value="trend_break">勢い・トレンドが崩れた</option><option value="earnings_reduce">決算前後で減らす</option><option value="capital_rotation">別銘柄へ資金移動</option><option value="planned_stop">予定していた損切り</option><option value="anxiety">不安になった</option><option value="other">その他</option></select></label>
          <label>計画との関係<select data-quick-plan-status><option value="">選択</option><option value="planned">計画どおり</option><option value="condition_changed">条件変化で変更</option><option value="emotion">不安・焦りで変更</option></select></label>
          <label>残りの守り<select data-quick-remaining-stop><option value="">部分利確時に選択</option><option value="entry">損切りを建値へ</option><option value="trail">直近安値へ切り上げ</option><option value="keep">元の損切りを維持</option><option value="none">残りもすぐ売る</option></select></label>
        </div>
        <div class="practice-quick-sell-buttons-v4"><button type="button" data-quick-sell="quarter">25%</button><button type="button" data-quick-sell="half">50%</button><button type="button" class="danger" data-quick-sell="all">全株</button></div>
        <p data-quick-sell-note>売却理由を選ぶと、採点にも判断として残ります。</p>
      </section>`;
    document.body.appendChild(dock);
    return dock;
  }

  function updateQuickDock() {
    const dock = ensureQuickDock();
    const s = stateRef();
    const shares = Number(s?.account?.shares || 0);
    const practiceVisible = s && document.getElementById("practiceArea")?.hidden === false;
    const finished = s?.guided?.step === "finished";
    const shouldShow = Boolean(practiceVisible && shares > 0 && !finished);
    dock.hidden = !shouldShow;
    document.body.classList.toggle("practice-quick-dock-active-v4", shouldShow);
    if (!shouldShow) return;

    const metrics = currentMetrics();
    const costBasis = finite(s.account?.costBasis) || 0;
    const pnl = finite(metrics?.unrealized) || 0;
    const pnlPct = costBasis > 0 ? pnl / costBasis * 100 : 0;
    dock.querySelector("[data-quick-shares]").textContent = `${shares.toLocaleString("ja-JP")}株`;
    const pnlNode = dock.querySelector("[data-quick-pnl]");
    pnlNode.textContent = formatYen(pnl, true);
    pnlNode.classList.toggle("positive", pnl >= 0);
    pnlNode.classList.toggle("negative", pnl < 0);
    dock.querySelector("[data-quick-pnl-pct]").textContent = formatPct(pnlPct);
    dock.querySelector("[data-quick-stop]").textContent = formatYen(s.plan?.activeStop);

    const add = dock.querySelector('[data-quick-action="add"]');
    const guided = s.guided?.mode === "guided";
    if (guided) {
      const remaining = Number(s.guided?.remainingTranches || 0);
      add.disabled = remaining <= 0;
      add.textContent = remaining > 0 ? `＋ 追加 ${remaining}` : "追加なし";
    } else {
      add.disabled = Boolean(document.getElementById("buyChunkButton")?.disabled);
      add.textContent = "＋ 追加";
    }
  }

  function clickExisting(selector) {
    const button = document.querySelector(selector);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function setQuickDecision(partial) {
    const s = stateRef();
    const audit = s?.practiceAudit;
    if (!audit?.pendingDecision) return true;
    const dock = document.getElementById("practiceQuickDockV4");
    const reason = dock?.querySelector("[data-quick-exit-reason]")?.value || "";
    const planStatus = dock?.querySelector("[data-quick-plan-status]")?.value || "";
    const remaining = dock?.querySelector("[data-quick-remaining-stop]")?.value || "";
    const note = dock?.querySelector("[data-quick-sell-note]");
    if (!reason || !planStatus || (partial && !remaining)) {
      if (note) note.textContent = partial ? "売る理由・計画との関係・残りの守り方を選んでね。" : "売る理由と計画との関係を選んでね。";
      return false;
    }
    audit.pendingDecision.exitReason = reason;
    audit.pendingDecision.planStatus = planStatus;
    if (partial) audit.pendingDecision.remainingStopDecision = remaining;
    return true;
  }

  function handleQuickAction(action) {
    const s = stateRef();
    if (!s) return;
    if (action === "step") {
      if (!clickExisting('#guidedActionArea [data-guided-action="step-one"]')) clickExisting("#stepOneButton");
      return;
    }
    if (action === "add") {
      if (!clickExisting('#guidedActionArea [data-guided-action="add-entry"]')) clickExisting("#buyChunkButton");
      return;
    }
    if (action === "sell") {
      const menu = document.querySelector("#practiceQuickDockV4 [data-quick-sell-menu]");
      if (menu) menu.hidden = !menu.hidden;
    }
  }

  function handleQuickSell(kind) {
    const partial = kind !== "all";
    if (!setQuickDecision(partial)) return;
    const selector = kind === "quarter" ? "#sellQuarterButton" : kind === "half" ? "#sellHalfButton" : "#sellAllButton";
    clickExisting(selector);
    const menu = document.querySelector("#practiceQuickDockV4 [data-quick-sell-menu]");
    if (menu) menu.hidden = true;
    setTimeout(queueSync, 0);
  }

  function syncAll() {
    syncQueued = false;
    fixMonthlyRsiLayout();
    updateQuickDock();
    const result = currentScore();
    if (result) {
      const signature = scoreSignature(result);
      if (signature !== lastScoreSignature || stateRef()?.guided?.step === "finished") {
        ensureGuidedScoreBreakdown(result);
        ensureShareScoreBreakdown(result);
        lastScoreSignature = signature;
      }
    }
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncAll);
  }

  function patchRenderAll() {
    try {
      if (typeof renderAll !== "function" || window.__kabutanePracticeCoachV4RenderPatched) return;
      window.__kabutanePracticeCoachV4RenderPatched = true;
      const base = renderAll;
      renderAll = function renderAllWithPracticeCoachV4() {
        const value = base.apply(this, arguments);
        queueMicrotask(queueSync);
        return value;
      };
    } catch (_) {}
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-quick-action]")?.dataset.quickAction;
    if (action) {
      event.preventDefault();
      handleQuickAction(action);
      setTimeout(queueSync, 0);
      return;
    }
    const sell = event.target.closest("[data-quick-sell]")?.dataset.quickSell;
    if (sell) {
      event.preventDefault();
      handleQuickSell(sell);
      return;
    }
    if (event.target.closest('[data-share-action="open"], [data-guided-action="share"]')) setTimeout(queueSync, 0);
  });

  window.addEventListener("resize", queueSync);
  window.addEventListener("orientationchange", () => setTimeout(queueSync, 100));
  window.addEventListener("kabutane:practice-score", queueSync);
  document.addEventListener("kabutane:practice-score", queueSync);

  patchRenderAll();
  ensureQuickDock();
  const target = document.getElementById("practiceArea") || document.body;
  new MutationObserver(queueSync).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "open"] });
  setTimeout(queueSync, 0);
})();
