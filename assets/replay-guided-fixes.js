(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function guidedActive() {
    return typeof state !== "undefined" && state.guided?.mode === "guided";
  }

  const baseRecalculatePlan = recalculatePlan;
  recalculatePlan = function recalculateGuidedPlan() {
    baseRecalculatePlan();
    if (!guidedActive()) return;
    const guide = state.guided;
    state.plan.entry = guide.pendingEntry ?? null;
    state.plan.initialStop = guide.pendingStop ?? null;
    if (state.account.shares <= 0 || !state.plan.entryDate) state.plan.activeStop = guide.pendingStop ?? null;
    const ratio = Number.isFinite(Number(guide.targetRatio)) && Number(guide.targetRatio) > 0 ? Number(guide.targetRatio) : 2;
    state.plan.ratios = [ratio, Math.max(3, ratio + 1), Math.max(4, ratio + 2), Math.max(5, ratio + 3)];
    state.plan.tpPrices = Number.isFinite(Number(guide.pendingTarget)) ? [Number(guide.pendingTarget)] : [];
  };

  const inheritedPlanLineDatasets = planLineDatasets;
  planLineDatasets = function guidedPlanLineDatasets(visible) {
    if (!guidedActive()) return inheritedPlanLineDatasets(visible);
    const guide = state.guided;
    if (!guide.showLines) return [];
    const constant = (value) => visible.map(() => value);
    const datasets = [];
    if (Number.isFinite(Number(guide.pendingEntry))) {
      datasets.push(lineDataset("エントリー", constant(Number(guide.pendingEntry)), "#8c55c5", { borderWidth: 2, borderDash: [8, 4] }));
    }
    if (Number.isFinite(Number(state.plan.activeStop ?? guide.pendingStop))) {
      datasets.push(lineDataset("損切り", constant(Number(state.plan.activeStop ?? guide.pendingStop)), "#347fa8", { borderWidth: 2, borderDash: [5, 4] }));
    }
    if (Number.isFinite(Number(guide.pendingTarget))) {
      datasets.push(lineDataset(`利確 ${Number(guide.targetRatio || 0).toFixed(2)}R`, constant(Number(guide.pendingTarget)), "#db588d", { borderWidth: 1.8, borderDash: [3, 3] }));
    }
    return datasets;
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("finishButton")?.addEventListener("click", (event) => {
      if (!guidedActive() || state.guided.step === "finished") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishSession();
    }, true);
  });
})();
