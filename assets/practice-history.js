(function () {
  "use strict";

  if (typeof document === "undefined" || typeof PracticeHistoryCore === "undefined") return;
  let lastSignature = "";

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function scoreResult() {
    try {
      return window.KabutanePracticeV2?.currentScore?.() || null;
    } catch (_) {
      return null;
    }
  }

  function build() {
    if (typeof state === "undefined" || !state.rows?.length) return null;
    const row = typeof currentRow === "function" ? currentRow() : state.rows[state.cursor];
    const metrics = typeof ReplayPro !== "undefined" ? ReplayPro.accountMetrics(state.account, row?.close, state.initialCapital) : {};
    const guide = state.guided || {};
    const checks = guide.checks || {};
    const achieved = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const buys = (state.trades || []).filter((trade) => String(trade.type).includes("BUY")).length;
    const sells = (state.trades || []).filter((trade) => String(trade.type).includes("SELL")).length;
    const start = state.rows[state.startIndex]?.date || state.rows[0]?.date || "";
    const end = row?.date || "";
    const score = scoreResult();
    const signature = `${state.code}-${start}-${end}-${buys}-${sells}-${metrics.totalProfit}-${score?.score ?? "legacy"}`;
    return {
      id: signature,
      savedAt: new Date().toISOString(),
      code: String(state.code || state.payload?.code || ""),
      name: state.payload?.name || state.code || "",
      startDate: start,
      endDate: end,
      mode: guide.mode || "free",
      outcome: guide.outcome || "manual",
      initialCapital: finite(state.initialCapital),
      totalReturn: finite(metrics.totalReturn),
      totalProfit: finite(metrics.totalProfit),
      maxDrawdown: finite(state.maxDrawdown),
      buyCount: buys,
      sellCount: sells,
      ruleAchieved: achieved,
      ruleTotal: total,
      scoreVersion: score?.version || 1,
      operationScore: score?.score ?? null,
      operationGrade: score?.grade || "",
      scoreCategories: score?.categories?.map((item) => ({ name: item.name, earned: item.earned, max: item.max })) || [],
      timingBonus: score?.timing?.points ?? null,
      audit: state.practiceAudit ? {
        stopWidened: Boolean(state.practiceAudit.stopWidened),
        plannedShares: finite(state.practiceAudit.plannedShares),
        peakShares: finite(state.practiceAudit.peakShares),
        positionRiskPct: finite(state.practiceAudit.positionRiskPct),
        allocationUsedPct: finite(state.practiceAudit.allocationUsedPct),
      } : null,
      trades: (state.trades || []).slice(-60).map((trade) => ({
        date: trade.date,
        type: trade.type,
        price: trade.price,
        shares: trade.shares,
        realized: trade.realized,
        memo: trade.memo || trade.reason || "",
        decision: trade.decision ? {
          thesis: trade.decision.thesis || "",
          eventContext: trade.decision.eventContext || "",
          planStatus: trade.decision.planStatus || "",
          exitReason: trade.decision.exitReason || "",
          remainingStopDecision: trade.decision.remainingStopDecision || "",
          note: trade.decision.note || "",
          stopAtDecision: finite(trade.decision.stopAtDecision),
          targetAtDecision: finite(trade.decision.targetAtDecision),
          plannedSplitCount: finite(trade.decision.plannedSplitCount),
        } : null,
      })),
    };
  }

  function save() {
    const entry = build();
    if (!entry || entry.id === lastSignature) return;
    lastSignature = entry.id;
    PracticeHistoryCore.add(entry);
    const status = document.querySelector("[data-share-status]");
    if (status && !status.textContent) status.textContent = "この練習結果を端末の履歴へ保存したよ。";
  }

  function finished() {
    return typeof state !== "undefined" && (state.ended === true || state.guided?.step === "finished");
  }

  function observe() {
    const target = document.getElementById("finishSummary");
    if (target) new MutationObserver(() => {
      if (!target.hidden || finished()) setTimeout(save, 0);
    }).observe(target, { attributes: true, childList: true, subtree: true });
    document.addEventListener("kabutane:open-share-report", save);
    window.addEventListener("kabutane:practice-score", save);
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-guided-action="finish"],#finishButton')) {
        setTimeout(() => { if (finished()) save(); }, 180);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe); else observe();
  window.KabutanePracticeHistory = { saveCurrent: save };
})();
