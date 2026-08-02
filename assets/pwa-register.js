(function () {
  "use strict";

  const PRACTICE_V2_SCRIPTS = [
    "assets/replay-practice-score-v2.js",
    "assets/replay-practice-ux-v2.js",
    "assets/replay-practice-ux-v2-stability.js",
    "assets/replay-stop-guard-v3.js",
    "assets/replay-score-report-v2.js",
    "assets/replay-practice-coach-v3.js",
    "assets/replay-practice-coach-v4.js",
    "assets/replay-practice-desktop-free-v5.js",
  ];
  let practiceV2Promise = null;

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
        if (existing.dataset.kabutaneLoaded === "true" || existing.readyState === "complete") resolve();
        else {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        }
        return;
      }
      const script = document.createElement("script");
      script.src = source;
      script.async = false;
      script.addEventListener("load", () => {
        script.dataset.kabutaneLoaded = "true";
        resolve();
      }, { once: true });
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

  async function loadReplayPracticeV2() {
    if (practiceV2Promise) return practiceV2Promise;
    loadStyle("assets/replay-practice-ux-v2.css");
    loadStyle("assets/replay-practice-coach-v3.css");
    loadStyle("assets/replay-practice-coach-v4.css");
    loadStyle("assets/replay-practice-desktop-free-v5.css");

    practiceV2Promise = (async () => {
      const NativeMutationObserver = window.MutationObserver;
      class ScopedMutationObserver extends NativeMutationObserver {
        constructor(callback) {
          super(callback);
          this.kabutaneCallbackName = callback?.name || "";
        }

        observe(target, options) {
          const isLegacyWholePageStopWatcher = target === document.body
            && this.kabutaneCallbackName === "updateStopLabel"
            && options?.childList === true
            && options?.subtree === true;
          if (isLegacyWholePageStopWatcher) return;
          return super.observe(target, options);
        }
      }

      window.MutationObserver = ScopedMutationObserver;
      try {
        await loadScriptsInOrder(PRACTICE_V2_SCRIPTS);
        window.__kabutanePracticeV2Ready = true;
      } finally {
        window.MutationObserver = NativeMutationObserver;
      }
    })();

    try {
      await practiceV2Promise;
    } catch (error) {
      practiceV2Promise = null;
      throw error;
    }
  }

  function ensureReplayPracticeV2() {
    if (!document.body?.classList.contains("replay-page")) return;
    loadStyle("assets/replay-picker.css");

    const startButton = document.getElementById("startSessionButton");
    if (!startButton || startButton.dataset.practiceV2Loader === "true") return;
    startButton.dataset.practiceV2Loader = "true";

    let loading = false;
    startButton.addEventListener("click", async (event) => {
      if (window.__kabutanePracticeV2Ready) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (loading) return;

      loading = true;
      const originalText = startButton.textContent;
      startButton.disabled = true;
      startButton.textContent = "練習画面を準備中…";
      const notice = document.getElementById("setupNotice");
      if (notice) notice.textContent = "チャート操作と運用実践スコアを読み込んでいるよ。";

      try {
        await loadReplayPracticeV2();
        startButton.disabled = false;
        startButton.textContent = originalText;
        loading = false;
        startButton.click();
      } catch (error) {
        loading = false;
        startButton.disabled = false;
        startButton.textContent = originalText;
        if (notice) notice.textContent = `練習画面を準備できませんでした。再読み込みしてね：${error.message}`;
        console.warn("Kabutane practice v2 loading failed", error);
      }
    }, true);
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
