(function () {
  "use strict";

  function ensureManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.webmanifest";
    document.head.appendChild(link);
  }

  function ensureTheme() {
    if (document.querySelector('meta[name="theme-color"]')) return;
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#f26fa6";
    document.head.appendChild(meta);
  }

  function ensureAppIcons() {
    if (!document.querySelector('link[rel="icon"]')) {
      const favicon = document.createElement("link");
      favicon.rel = "icon";
      favicon.type = "image/svg+xml";
      favicon.href = "assets/icons/kabutane-wordmark-v2.svg";
      document.head.appendChild(favicon);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      apple.sizes = "192x192";
      apple.href = "assets/icons/kabutane-192.png?v=1";
      document.head.appendChild(apple);
    }
  }

  function ensureReplayDrawingTools() {
    if (!document.body?.classList.contains("replay-page")) return;
    if (!document.querySelector('link[href="assets/replay-drawing-tools.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "assets/replay-drawing-tools.css";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[src="assets/replay-drawing-tools.js"]')) {
      const script = document.createElement("script");
      script.src = "assets/replay-drawing-tools.js";
      script.defer = true;
      document.head.appendChild(script);
    }
  }

  function separateAnalysisFromOrderPlacement() {
    if (!document.body?.classList.contains("replay-page")) return;
    document.addEventListener("pointerup", (event) => {
      if (event.target?.id !== "replayChart") return;
      if (window.ReplayDrawingTools?.model?.mode !== "cursor") return;
      if (typeof state === "undefined" || state.workspaceTab !== "chart" || !state.chartView) return;
      // Keep the viewport pointer lifecycle intact, but mark this tap as an
      // analysis interaction so the existing entry/stop placement handler skips it.
      state.chartView.moved = true;
    }, true);
  }

  function keepSelectedReplayEntryInSync() {
    if (!document.body?.classList.contains("replay-page")) return;
    document.addEventListener("pointerup", (event) => {
      if (event.target?.id !== "replayChart") return;
      if (window.ReplayDrawingTools?.model?.mode !== "cursor") return;
      if (typeof state !== "undefined" && state.workspaceTab === "chart") return;
      window.setTimeout(() => {
        const selected = document.querySelector(".entry-ladder-row.selected [data-entry-level]");
        const source = document.getElementById("entryPrice");
        if (!selected || !source || selected.value === source.value) return;
        selected.value = source.value;
        if (typeof recalculatePlan === "function") recalculatePlan();
        if (typeof renderAll === "function") renderAll();
      }, 0);
    });
  }

  ensureManifest();
  ensureTheme();
  ensureAppIcons();
  ensureReplayDrawingTools();
  separateAnalysisFromOrderPlacement();
  keepSelectedReplayEntryInSync();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((error) => {
        console.warn("Kabutane PWA registration failed", error);
      });
    });
  }
})();
