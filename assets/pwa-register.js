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
      favicon.href = "assets/icons/kabutane-wordmark-v3.svg";
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

  function loadScript(source) {
    if (document.querySelector(`script[src="${source}"]`)) return;
    const script = document.createElement("script");
    script.src = source;
    script.async = false;
    document.head.appendChild(script);
  }

  function loadScriptsInOrder(sources) {
    return sources.reduce((chain, source) => chain.then(() => new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${source}"]`);
      if (existing) {
        if (existing.dataset.kabutaneLoaded === "true") resolve();
        else {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
          setTimeout(resolve, 0);
        }
        return;
      }
      const script = document.createElement("script");
      script.src = source;
      script.async = false;
      script.addEventListener("load", () => { script.dataset.kabutaneLoaded = "true"; resolve(); }, { once: true });
      script.addEventListener("error", () => reject(new Error(`読み込みに失敗しました: ${source}`)), { once: true });
      document.head.appendChild(script);
    })), Promise.resolve());
  }

  function loadStyle(source) {
    if (document.querySelector(`link[href="${source}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = source;
    document.head.appendChild(link);
  }

  function ensureSiteUpgrades() {
    loadScript("assets/site-upgrades.js");
  }

  function ensureCopyAudit() {
    loadScript("assets/copy-audit.js");
  }

  function ensureReplayHistory() {
    if (!document.body?.classList.contains("replay-page")) return;
    loadScriptsInOrder(["assets/practice-history-core.js", "assets/practice-history.js"]).catch(console.warn);
  }

  function ensureReplayDrawingTools() {
    if (!document.body?.classList.contains("replay-page")) return;
    loadStyle("assets/replay-drawing-tools.css");
    loadScript("assets/replay-drawing-tools.js");
  }

  function ensureReplayPracticeV2() {
    if (!document.body?.classList.contains("replay-page")) return;
    loadStyle("assets/replay-picker.css");
    loadStyle("assets/replay-practice-ux-v2.css");
    loadScriptsInOrder([
      "assets/replay-practice-score-v2.js",
      "assets/replay-practice-ux-v2.js",
      "assets/replay-practice-ux-v2-stability.js",
      "assets/replay-score-report-v2.js",
    ]).catch((error) => console.warn("Kabutane practice v2 loading failed", error));
  }

  function separateAnalysisFromOrderPlacement() {
    if (!document.body?.classList.contains("replay-page")) return;
    document.addEventListener("pointerup", (event) => {
      if (event.target?.id !== "replayChart") return;
      if (window.ReplayDrawingTools?.model?.mode !== "cursor") return;
      if (typeof state === "undefined" || state.workspaceTab !== "chart" || !state.chartView) return;
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
  ensureSiteUpgrades();
  ensureCopyAudit();
  ensureReplayHistory();
  ensureReplayDrawingTools();
  ensureReplayPracticeV2();
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
