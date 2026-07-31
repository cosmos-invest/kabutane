(function () {
  "use strict";

  if (typeof document === "undefined" || typeof recalculatePlan !== "function") return;
  if (window.__kabutaneRecalculateStopGuardV3) return;
  window.__kabutaneRecalculateStopGuardV3 = true;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function activeStop() {
    return finite(state?.plan?.activeStop ?? state?.guided?.pendingStop ?? els?.stopPrice?.value);
  }

  function restoreActiveStop(value) {
    const stop = finite(value);
    if (stop === null) return;
    state.plan.activeStop = stop;
    if (state.guided) state.guided.pendingStop = stop;
    if (els?.stopPrice) els.stopPrice.value = stop.toFixed(2);
  }

  const baseRecalculatePlan = recalculatePlan;
  recalculatePlan = function recalculatePlanWithActiveStopGuard() {
    const sharesBefore = Number(state?.account?.shares || 0);
    const stopBefore = activeStop();
    const result = baseRecalculatePlan();

    // While a position is open, recalculation may refresh entry sizing and TP
    // values, but it must not silently replace the user's active stop. Explicit
    // SL buttons, input and chart dragging update activeStop before the next
    // recalculation, so those intentional changes remain valid.
    if (sharesBefore > 0 && stopBefore !== null) restoreActiveStop(stopBefore);
    return result;
  };

  window.KabutaneStopGuardV3 = {
    activeStop,
    restoreActiveStop,
  };
})();
