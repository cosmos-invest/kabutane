(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function replaceSummaryToDropInternalObservers() {
    const current = document.getElementById("finishSummary");
    if (!current || current.dataset.practiceStable === "true") return current;
    const replacement = current.cloneNode(true);
    replacement.dataset.practiceStable = "true";
    current.replaceWith(replacement);
    if (typeof els !== "undefined") els.finishSummary = replacement;
    return replacement;
  }

  function renderAfterFinish() {
    setTimeout(() => window.KabutanePracticeV2?.renderScore?.(), 0);
  }

  function resetBeforeStart() {
    window.KabutanePracticeV2?.ensureAudit?.(true);
  }

  function init() {
    replaceSummaryToDropInternalObservers();
    document.getElementById("startSessionButton")?.addEventListener("click", resetBeforeStart, true);
    document.getElementById("finishButton")?.addEventListener("click", renderAfterFinish, true);
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-guided-action="finish"]')) renderAfterFinish();
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
