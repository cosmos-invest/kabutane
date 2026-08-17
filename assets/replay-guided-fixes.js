(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function guidedActive() {
    return typeof state !== "undefined" && state.guided?.mode === "guided";
  }

  function injectResponsiveGuidedFixes() {
    if (document.getElementById("guidedResponsiveFixes")) return;
    const style = document.createElement("style");
    style.id = "guidedResponsiveFixes";
    style.textContent = `
      .guided-monthly-heading {
        margin:14px 0 8px;
        padding:10px 12px;
        border:1px solid #ead8e3;
        border-radius:13px 13px 0 0;
        background:rgba(255,255,255,.86);
      }
      .guided-monthly-heading strong { color:#604757; }
      .guided-monthly-heading small { display:block; margin-top:3px; color:#917987; }
      .guided-monthly-rsi {
        display:block !important;
        height:190px !important;
        margin:0 0 12px;
        padding:8px;
        border:1px solid #ead8e3;
        border-top:0;
        border-radius:0 0 13px 13px;
        background:rgba(255,255,255,.82);
      }
      .guided-replay-mode.terminal-session-active .guided-monthly-heading,
      .guided-replay-mode.terminal-session-active .guided-monthly-rsi {
        display:block !important;
      }
      @media (max-width:1199px), (pointer:coarse) {
        .guided-sheet {
          position:relative !important;
          inset:auto !important;
          width:100% !important;
          max-height:none !important;
          display:none;
          margin:10px 0 14px;
          border-radius:16px !important;
          transform:none !important;
          transition:none !important;
          box-shadow:0 10px 28px rgba(60,38,52,.13) !important;
          backdrop-filter:none !important;
        }
        .guided-sheet.open {
          display:flex !important;
          transform:none !important;
        }
        .guided-sheet-handle { display:none !important; }
        .guided-sheet-body {
          overflow:visible !important;
          max-height:none !important;
          padding:14px !important;
        }
        .guided-replay-mode.terminal-session-active .pro-main-chart {
          width:100% !important;
          min-width:0 !important;
        }
      }
      @media (max-width:760px) {
        .guided-monthly-rsi { height:132px !important; min-height:132px !important; max-height:132px !important; }
        .guided-monthly-rsi canvas { height:116px !important; max-height:116px !important; }
        .guided-monthly-heading { margin-top:10px; }
      }
    `;
    document.head.appendChild(style);
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
    if (!guide.showLines && guide.step !== "seek-entry") return [];
    const constant = (value) => visible.map(() => value);
    const datasets = [];
    if (Number.isFinite(Number(guide.pendingEntry))) {
      datasets.push(lineDataset("エントリー", constant(Number(guide.pendingEntry)), "#8c55c5", { borderWidth: 2, borderDash: [8, 4] }));
    }
    if (Number.isFinite(Number(state.plan.activeStop ?? guide.pendingStop))) {
      datasets.push(lineDataset("損切り", constant(Number(state.plan.activeStop ?? guide.pendingStop)), "#347fa8", { borderWidth: 2, borderDash: [5, 4] }));
    }
    if (["seek-entry", "stop"].includes(guide.step) && typeof ReplayGuidedCore !== "undefined") {
      const hint = ReplayGuidedCore.recentLowHint(state.rows, state.cursor, 20);
      if (Number.isFinite(Number(hint?.price))) {
        datasets.push(lineDataset("直近安値", constant(Number(hint.price)), "#5f9873", { borderWidth: 1.6, borderDash: [3, 4] }));
      }
    }
    if (Number.isFinite(Number(guide.pendingTarget))) {
      datasets.push(lineDataset(`利確 ${Number(guide.targetRatio || 0).toFixed(2)}R`, constant(Number(guide.pendingTarget)), "#db588d", { borderWidth: 1.8, borderDash: [3, 3] }));
    }
    return datasets;
  };

  let monthlyHeading = null;
  let monthlyBox = null;
  let monthlyMarker = null;

  function discoverMonthlyRsi() {
    monthlyBox ||= document.querySelector(".monthly-rsi-chart-box");
    if (!monthlyBox) return false;
    monthlyHeading ||= monthlyBox.previousElementSibling;
    if (!monthlyHeading) return false;
    monthlyHeading.classList.add("guided-monthly-heading");
    monthlyBox.classList.add("guided-monthly-rsi");
    if (!monthlyMarker) {
      monthlyMarker = document.createComment("monthly-rsi-original-position");
      monthlyHeading.parentNode?.insertBefore(monthlyMarker, monthlyHeading);
    }
    return true;
  }

  function syncMonthlyRsiPlacement() {
    if (!discoverMonthlyRsi()) return;
    if (guidedActive()) {
      const mainChart = document.querySelector(".pro-main-chart");
      if (mainChart && monthlyHeading.parentNode !== mainChart.parentNode) {
        mainChart.insertAdjacentElement("afterend", monthlyHeading);
        monthlyHeading.insertAdjacentElement("afterend", monthlyBox);
      }
    } else if (monthlyMarker?.parentNode && monthlyHeading.parentNode !== monthlyMarker.parentNode) {
      monthlyMarker.parentNode.insertBefore(monthlyHeading, monthlyMarker.nextSibling);
      monthlyHeading.insertAdjacentElement("afterend", monthlyBox);
    }
    requestAnimationFrame(() => {
      if (typeof state !== "undefined") state.rsiChart?.resize?.();
    });
  }

  function moveSheetIntoFlow() {
    const panel = document.getElementById("guidedReplayPanel");
    const sheet = document.getElementById("guidedSheet");
    if (panel && sheet && sheet.previousElementSibling !== panel) panel.insertAdjacentElement("afterend", sheet);
  }

  function closeGuidedSheet() {
    const sheet = document.getElementById("guidedSheet");
    if (!sheet) return;
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
  }

  function setGuidedNotice(text) {
    const notice = document.getElementById("guidedNotice");
    if (!notice) return;
    notice.textContent = text;
    notice.classList.remove("negative");
  }

  function beginChartSelection(mode) {
    if (!guidedActive()) return;
    state.guided.selectMode = mode;
    state.guided.showLines = true;
    closeGuidedSheet();
    setGuidedNotice(mode === "stop"
      ? "チャートを全面表示したよ。想定が崩れる損切り価格をタップしてね。"
      : "チャートを全面表示したよ。利確したい価格をタップしてね。");
    if (typeof renderMainChart === "function") renderMainChart();
    requestAnimationFrame(() => document.querySelector(".pro-main-chart")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  function reopenSelectionSheet(mode) {
    const action = document.querySelector(`[data-guided-action="open-${mode}"]`);
    if (!action) return;
    action.click();
    setTimeout(() => document.getElementById("guidedSheet")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  }

  const portraitSources = {
    cosmos: "assets/characters/cosmos-hero.webp",
    lumo: "assets/characters/lumo-guide.webp",
    aile: "assets/characters/aile-guide.webp",
  };
  const portraits = {};
  Object.entries(portraitSources).forEach(([key, source]) => {
    const image = new Image();
    image.src = source;
    portraits[key] = image;
  });

  function reportCharacter() {
    if (!guidedActive()) return "cosmos";
    if (state.guided.outcome === "stop") return "lumo";
    if (state.guided.outcome === "target") return "cosmos";
    return "aile";
  }

  function drawImageCover(ctx, image, x, y, size) {
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, x - (width - size) / 2, y - (height - size) / 2, width, height);
  }

  function decorateReportCanvas(canvas) {
    if (!canvas || canvas.__kabutaneCharacterDecorated) return;
    const character = reportCharacter();
    const image = portraits[character];
    if (!image?.complete || !image.naturalWidth) {
      image?.addEventListener("load", () => decorateReportCanvas(canvas), { once: true });
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const square = canvas.width === canvas.height;
    const radius = square ? 30 : 27;
    const cx = canvas.width - 42;
    const cy = square ? canvas.height - 43 : canvas.height - 42;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fill();
    ctx.strokeStyle = character === "lumo" ? "#85a8d6" : character === "aile" ? "#9d78c8" : "#dc6d9d";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    drawImageCover(ctx, image, cx - radius, cy - radius, radius * 2);
    ctx.restore();
    canvas.__kabutaneCharacterDecorated = true;
  }

  function decorateCurrentReport() {
    queueMicrotask(() => decorateReportCanvas(document.getElementById("replayShareCanvas")));
  }

  function shareStatus(text, error = false) {
    document.querySelectorAll("[data-share-status]").forEach((node) => {
      node.textContent = text;
      node.classList.toggle("negative", error);
    });
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像を作成できなかったよ。")), "image/png"));
  }

  async function fallbackXShare(canvas, file, text) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", text);
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
    shareStatus("画像を保存して投稿文をコピーし、Xを開いたよ。画像を添付すれば完成だよ。");
  }

  async function shareToXWithImage() {
    try {
      if (!window.ReplayShareReport || !window.ReplayShareReportCore) return;
      window.ReplayShareReport.setPlatform("x");
      const canvas = window.ReplayShareReport.renderCanvas();
      decorateReportCanvas(canvas);
      const snapshot = window.ReplayShareReport.snapshot();
      const text = document.getElementById("replayShareText")?.value || window.ReplayShareReport.buildShareText();
      if (ReplayShareReportCore.xWeightedLength(text) > ReplayShareReportCore.X_MAX_WEIGHTED_LENGTH) {
        shareStatus("Xの文字数を超えてるよ。少し短くしてから共有しよう。", true);
        return;
      }
      const blob = await canvasBlob(canvas);
      const format = canvas.width === canvas.height ? "square" : "wide";
      const file = new File([blob], ReplayShareReportCore.fileName(snapshot, format), { type: "image/png" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: "かぶたね 売買練習レポート", text, files: [file] });
        shareStatus("画像と投稿文を共有メニューへ渡したよ。Xを選んで投稿しよう。");
        return;
      }
      await fallbackXShare(canvas, file, text);
    } catch (error) {
      if (error?.name !== "AbortError") shareStatus(error?.message || "Xへ共有できなかったよ。", true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectResponsiveGuidedFixes();
    moveSheetIntoFlow();
    syncMonthlyRsiPlacement();

    new MutationObserver(() => {
      moveSheetIntoFlow();
      syncMonthlyRsiPlacement();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    document.getElementById("finishButton")?.addEventListener("click", (event) => {
      if (!guidedActive() || state.guided.step === "finished") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishSession();
    }, true);

    const xButton = document.querySelector('[data-share-action="x"]');
    if (xButton) xButton.textContent = "Xへ画像つき共有";

    document.addEventListener("click", (event) => {
      const selectButton = event.target.closest('[data-guided-action="select-stop-chart"], [data-guided-action="select-target-chart"]');
      if (selectButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        beginChartSelection(selectButton.dataset.guidedAction === "select-stop-chart" ? "stop" : "target");
        return;
      }

      if (event.target.id === "replayChart" && guidedActive() && state.guided.selectMode) {
        const mode = state.guided.selectMode;
        setTimeout(() => {
          const selected = mode === "stop" ? state.guided.pendingStop : state.guided.pendingTarget;
          if (Number.isFinite(Number(selected))) reopenSelectionSheet(mode);
        }, 90);
      }

      if (event.target.closest('[data-share-action="x"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        shareToXWithImage();
        return;
      }
      if (event.target.closest("[data-share-format], [data-share-platform], [data-share-action='open']")) decorateCurrentReport();
      if (event.target.closest("[data-replay-mode]")) setTimeout(syncMonthlyRsiPlacement, 0);
    }, true);

    document.addEventListener("kabutane:open-share-report", decorateCurrentReport);
  });
})();
