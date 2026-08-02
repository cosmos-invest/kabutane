(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function scoreResult() {
    try {
      return window.KabutanePracticeV2?.currentScore?.() || null;
    } catch (_) {
      return null;
    }
  }

  function patchSnapshot() {
    const core = window.ReplayShareReportCore;
    if (!core || core.__practiceScoreV2Patched) return;
    core.__practiceScoreV2Patched = true;
    const baseCreateSnapshot = core.createSnapshot;
    core.createSnapshot = function createSnapshotWithPracticeScore(input) {
      const snapshot = baseCreateSnapshot(input);
      const result = scoreResult();
      if (result) {
        snapshot.score = result.score;
        snapshot.scoreVersion = result.version;
        snapshot.scoreLabel = "運用実践スコア";
        snapshot.scoreGrade = result.grade;
        snapshot.timingMessage = result.timingMessage;
      }
      return snapshot;
    };
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function decorate(canvas) {
    if (!canvas || canvas.dataset.practiceScoreV2 === "true") return;
    const result = scoreResult();
    if (!result) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const square = canvas.width === canvas.height;
    const box = square ? { x: 820, y: 78, width: 150, height: 132 } : { x: 954, y: 58, width: 160, height: 118 };
    ctx.save();
    roundedRect(ctx, box.x, box.y, box.width, box.height, 24);
    ctx.fillStyle = "#fff0f7";
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#9b657f";
    ctx.font = `850 ${square ? 15 : 14}px system-ui, -apple-system, sans-serif`;
    ctx.fillText("運用実践スコア", box.x + box.width / 2, box.y + (square ? 31 : 29));
    ctx.fillStyle = "#b14d7d";
    ctx.font = `950 ${square ? 58 : 54}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(String(result.score), box.x + box.width / 2, box.y + (square ? 93 : 82));
    ctx.restore();
    canvas.dataset.practiceScoreV2 = "true";
  }

  function decorateSoon() {
    requestAnimationFrame(() => decorate(document.getElementById("replayShareCanvas")));
  }

  function patchExportedRenderer() {
    const report = window.ReplayShareReport;
    if (!report || report.__practiceScoreV2Patched) return;
    report.__practiceScoreV2Patched = true;
    const baseRender = report.renderCanvas;
    report.renderCanvas = function renderCanvasWithPracticeScore() {
      const canvas = baseRender();
      decorate(canvas);
      return canvas;
    };
  }

  function init() {
    patchSnapshot();
    patchExportedRenderer();
    document.addEventListener("kabutane:open-share-report", decorateSoon);
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-share-action], [data-share-format], [data-share-platform]")) setTimeout(decorateSoon, 0);
    });
    new MutationObserver(() => {
      patchSnapshot();
      patchExportedRenderer();
      decorateSoon();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
