(function () {
  "use strict";

  // Kept as a compatibility marker for older cached detail.html files.
  // The active implementation now lives in detail-signal-status.js and is
  // installed only after the base detail chart has rendered successfully.
  if (typeof window !== "undefined") {
    window.KabutaneDetailSignalChartFix = {
      mode: "post-render-safe",
      version: 2,
    };
  }
})();