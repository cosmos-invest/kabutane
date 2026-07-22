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

  function keepSelectedReplayEntryInSync() {
    if (!document.body?.classList.contains("replay-page")) return;
    document.addEventListener("pointerup", (event) => {
      if (event.target?.id !== "replayChart") return;
      if (window.ReplayDrawingTools?.model?.mode !== "cursor") return;
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
  ensureReplayDrawingTools();
  keepSelectedReplayEntryInSync();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((error) => {
        console.warn("Kabutane PWA registration failed", error);
      });
    });
  }
})();
