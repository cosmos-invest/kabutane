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
    const cx = square ? canvas.width - 42 : canvas.width - 42;
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
    document.getElementById("finishButton")?.addEventListener("click", (event) => {
      if (!guidedActive() || state.guided.step === "finished") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishSession();
    }, true);

    const xButton = document.querySelector('[data-share-action="x"]');
    if (xButton) xButton.textContent = "Xへ画像つき共有";

    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-share-action="x"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        shareToXWithImage();
        return;
      }
      if (event.target.closest("[data-share-format], [data-share-platform], [data-share-action='open']")) decorateCurrentReport();
    }, true);

    document.addEventListener("kabutane:open-share-report", decorateCurrentReport);
  });
})();
