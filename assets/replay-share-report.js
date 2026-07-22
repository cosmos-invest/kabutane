(function () {
  "use strict";

  if (typeof document === "undefined" || typeof ReplayShareReportCore === "undefined") return;
  const Core = ReplayShareReportCore;
  let selectedFormat = "wide";
  let latestSnapshot = null;
  let latestCanvas = null;

  function currentMetrics() {
    if (typeof ReplayPro === "undefined" || typeof state === "undefined" || typeof currentRow !== "function") return {};
    return ReplayPro.accountMetrics(state.account, currentRow()?.close, state.initialCapital);
  }

  function snapshot() {
    const metrics = currentMetrics();
    return Core.createSnapshot({
      payload: typeof state !== "undefined" ? state.payload : null,
      code: typeof state !== "undefined" ? state.code : "",
      rows: typeof state !== "undefined" ? state.rows : [],
      startIndex: typeof state !== "undefined" ? state.startIndex : 0,
      cursor: typeof state !== "undefined" ? state.cursor : 0,
      account: typeof state !== "undefined" ? state.account : {},
      initialCapital: typeof state !== "undefined" ? state.initialCapital : null,
      maxDrawdown: typeof state !== "undefined" ? state.maxDrawdown : null,
      trades: typeof state !== "undefined" ? state.trades : [],
      plan: typeof state !== "undefined" ? state.plan : {},
      metrics,
      url: location.href,
    });
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

  function text(ctx, value, x, y, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || "#513b4a";
    ctx.font = `${options.weight || 700} ${options.size || 28}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = options.baseline || "alphabetic";
    if (options.maxWidth) ctx.fillText(String(value), x, y, options.maxWidth);
    else ctx.fillText(String(value), x, y);
    ctx.restore();
  }

  function wrapText(ctx, value, x, y, maxWidth, lineHeight, maxLines, options = {}) {
    const chars = [...String(value || "")];
    const lines = [];
    let line = "";
    chars.forEach((char) => {
      const candidate = line + char;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = char;
      } else line = candidate;
    });
    if (line) lines.push(line);
    const clipped = lines.slice(0, maxLines);
    if (lines.length > maxLines) clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, -1)}…`;
    clipped.forEach((row, index) => text(ctx, row, x, y + index * lineHeight, options));
  }

  function metricCard(ctx, label, value, x, y, width, height, accent) {
    ctx.save();
    roundedRect(ctx, x, y, width, height, 20);
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(119,75,101,.12)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = accent;
    roundedRect(ctx, x, y, 8, height, 4);
    ctx.fill();
    text(ctx, label, x + 24, y + 34, { size: 18, weight: 750, color: "#8b7483" });
    text(ctx, value, x + 24, y + 78, { size: 32, weight: 900, color: "#4d3746", maxWidth: width - 42 });
    ctx.restore();
  }

  function drawSparkline(ctx, snap, x, y, width, height) {
    const series = snap.series.filter((row) => Number.isFinite(row.close));
    roundedRect(ctx, x, y, width, height, 24);
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(119,75,101,.10)";
    ctx.stroke();
    if (series.length < 2) {
      text(ctx, "チャートデータなし", x + width / 2, y + height / 2, { size: 22, align: "center", color: "#9b8492" });
      return;
    }
    const values = series.map((row) => row.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, Math.abs(max) * .01, 1);
    const pad = 28;
    ctx.save();
    ctx.beginPath();
    series.forEach((row, index) => {
      const px = x + pad + index / Math.max(1, series.length - 1) * (width - pad * 2);
      const py = y + height - pad - (row.close - min) / range * (height - pad * 2);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, "#9a68cf");
    gradient.addColorStop(1, "#dd609a");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
    text(ctx, snap.startDate, x + pad, y + height - 8, { size: 15, color: "#907887" });
    text(ctx, snap.endDate, x + width - pad, y + height - 8, { size: 15, color: "#907887", align: "right" });
  }

  function renderWide(snap) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 675;
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 1200, 675);
    bg.addColorStop(0, "#ffe8f1");
    bg.addColorStop(.55, "#f9f4ff");
    bg.addColorStop(1, "#e8f5f0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 675);

    roundedRect(ctx, 34, 30, 1132, 615, 34);
    ctx.fillStyle = "rgba(255,252,254,.93)";
    ctx.fill();
    ctx.strokeStyle = "rgba(130,82,111,.12)";
    ctx.lineWidth = 2;
    ctx.stroke();

    text(ctx, "かぶたね", 72, 82, { size: 30, weight: 950, color: "#b1497c" });
    text(ctx, "売買練習レポート", 210, 82, { size: 22, weight: 850, color: "#765b6b" });
    text(ctx, `${snap.name}${snap.code ? `（${snap.code}）` : ""}`, 72, 140, { size: 36, weight: 950, color: "#4c3544", maxWidth: 720 });
    text(ctx, `${snap.startDate} 〜 ${snap.endDate}`, 72, 174, { size: 18, weight: 700, color: "#927986" });

    roundedRect(ctx, 954, 58, 160, 118, 24);
    ctx.fillStyle = "#fff1f7";
    ctx.fill();
    text(ctx, "リスク管理スコア", 1034, 92, { size: 16, weight: 850, align: "center", color: "#9b657f" });
    text(ctx, snap.score, 1034, 150, { size: 54, weight: 950, align: "center", color: "#b14d7d" });

    metricCard(ctx, "総損益率", Core.formatPercent(snap.totalReturn), 72, 208, 238, 104, "#d95f98");
    metricCard(ctx, "総損益", Core.formatYen(snap.totalProfit), 326, 208, 238, 104, "#9a6bcf");
    metricCard(ctx, "最大DD", Core.formatPercent(snap.maxDrawdown), 580, 208, 238, 104, "#4b91b4");
    metricCard(ctx, "売買回数", `買${snap.buys} / 売${snap.sells}`, 834, 208, 280, 104, "#64a17f");

    drawSparkline(ctx, snap, 72, 338, 660, 190);
    roundedRect(ctx, 752, 338, 362, 190, 24);
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(119,75,101,.10)";
    ctx.stroke();
    text(ctx, "今回の学び", 780, 378, { size: 19, weight: 900, color: "#8e5575" });
    ctx.save();
    ctx.font = `750 24px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
    wrapText(ctx, snap.learning, 780, 420, 300, 35, 3, { size: 24, weight: 800, color: "#513b4a" });
    ctx.restore();
    text(ctx, `損切り ${Core.formatYen(snap.stop)} / 予定損失 ${Core.formatYen(snap.plannedLoss)}`, 780, 502, { size: 15, weight: 750, color: "#8a7481", maxWidth: 300 });

    text(ctx, snap.tagline, 72, 580, { size: 24, weight: 950, color: "#b1497c" });
    text(ctx, "#かぶたね  #未来の1株", 1114, 580, { size: 18, weight: 850, color: "#8a6d7e", align: "right" });
    text(ctx, "学習・練習用の結果です。将来の利益を保証するものではありません。", 72, 616, { size: 14, weight: 650, color: "#a18b97" });
    return canvas;
  }

  function renderSquare(snap) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 1080, 1080);
    bg.addColorStop(0, "#ffe4ef");
    bg.addColorStop(.5, "#f8f2ff");
    bg.addColorStop(1, "#e8f4ef");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1080, 1080);

    roundedRect(ctx, 46, 42, 988, 996, 38);
    ctx.fillStyle = "rgba(255,252,254,.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(130,82,111,.12)";
    ctx.lineWidth = 2;
    ctx.stroke();

    text(ctx, "かぶたね｜売買練習レポート", 84, 106, { size: 28, weight: 950, color: "#b1497c" });
    text(ctx, `${snap.name}${snap.code ? `（${snap.code}）` : ""}`, 84, 170, { size: 42, weight: 950, color: "#4c3544", maxWidth: 820 });
    text(ctx, `${snap.startDate} 〜 ${snap.endDate}`, 84, 210, { size: 20, weight: 700, color: "#927986" });

    roundedRect(ctx, 820, 78, 150, 132, 24);
    ctx.fillStyle = "#fff0f7";
    ctx.fill();
    text(ctx, "リスク管理", 895, 115, { size: 17, weight: 850, align: "center", color: "#9b657f" });
    text(ctx, snap.score, 895, 184, { size: 58, weight: 950, align: "center", color: "#b14d7d" });

    metricCard(ctx, "総損益率", Core.formatPercent(snap.totalReturn), 84, 252, 430, 116, "#d95f98");
    metricCard(ctx, "最大DD", Core.formatPercent(snap.maxDrawdown), 536, 252, 430, 116, "#4b91b4");
    metricCard(ctx, "総損益", Core.formatYen(snap.totalProfit), 84, 388, 430, 116, "#9a6bcf");
    metricCard(ctx, "売買回数", `買${snap.buys} / 売${snap.sells}`, 536, 388, 430, 116, "#64a17f");

    drawSparkline(ctx, snap, 84, 532, 882, 260);
    roundedRect(ctx, 84, 816, 882, 142, 24);
    ctx.fillStyle = "rgba(255,255,255,.84)";
    ctx.fill();
    ctx.strokeStyle = "rgba(119,75,101,.10)";
    ctx.stroke();
    text(ctx, "今回の学び", 116, 856, { size: 20, weight: 900, color: "#8e5575" });
    ctx.save();
    ctx.font = `800 25px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
    wrapText(ctx, snap.learning, 116, 896, 820, 34, 2, { size: 25, weight: 800, color: "#513b4a" });
    ctx.restore();
    text(ctx, snap.tagline, 84, 1000, { size: 23, weight: 950, color: "#b1497c" });
    text(ctx, "#かぶたね  #未来の1株", 966, 1000, { size: 18, weight: 850, color: "#8a6d7e", align: "right" });
    return canvas;
  }

  function renderCanvas() {
    latestSnapshot = snapshot();
    latestCanvas = selectedFormat === "square" ? renderSquare(latestSnapshot) : renderWide(latestSnapshot);
    const holder = document.getElementById("replaySharePreview");
    if (holder) {
      holder.replaceChildren(latestCanvas);
      latestCanvas.id = "replayShareCanvas";
      latestCanvas.setAttribute("aria-label", "売買練習レポート画像プレビュー");
    }
    const textBox = document.getElementById("replayShareText");
    if (textBox) textBox.value = Core.buildShareText(latestSnapshot);
    return latestCanvas;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像を作成できませんでした。")), "image/png"));
  }

  function setStatus(message, error = false) {
    document.querySelectorAll("[data-share-status]").forEach((node) => {
      node.textContent = message;
      node.classList.toggle("negative", error);
    });
  }

  async function downloadImage() {
    try {
      const canvas = latestCanvas || renderCanvas();
      const snap = latestSnapshot || snapshot();
      const blob = await canvasBlob(canvas);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = Core.fileName(snap, selectedFormat);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      setStatus("PNG画像を保存しました。");
    } catch (error) { setStatus(error.message, true); }
  }

  async function shareImage() {
    try {
      const canvas = latestCanvas || renderCanvas();
      const snap = latestSnapshot || snapshot();
      const blob = await canvasBlob(canvas);
      const file = new File([blob], Core.fileName(snap, selectedFormat), { type: "image/png" });
      const data = { title: "かぶたね 売買練習レポート", text: Core.buildShareText(snap), url: location.href, files: [file] };
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share(data);
        setStatus("端末の共有メニューを開きました。X・Threads・noteなどを選べます。");
      } else {
        await downloadImage();
        await copyText();
        setStatus("画像を保存し、共有文をコピーしました。");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(error.message || "共有できませんでした。", true);
    }
  }

  async function copyText() {
    const value = document.getElementById("replayShareText")?.value || Core.buildShareText(latestSnapshot || snapshot());
    try {
      await navigator.clipboard.writeText(value);
      setStatus("共有文をコピーしました。noteの本文やSNS投稿へ貼り付けられます。");
    } catch (error) {
      const textarea = document.getElementById("replayShareText");
      textarea?.select();
      document.execCommand("copy");
      setStatus("共有文をコピーしました。");
    }
  }

  function openX() {
    const snap = latestSnapshot || snapshot();
    const url = new URL("https://twitter.com/intent/tweet");
    url.searchParams.set("text", Core.buildShareText(snap));
    url.searchParams.set("url", location.href);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    setStatus("Xの投稿画面を開きました。画像は保存後に添付してください。");
  }

  function openDialog() {
    const dialog = document.getElementById("replayShareDialog");
    if (!dialog) return;
    renderCanvas();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog() {
    const dialog = document.getElementById("replayShareDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function setFormat(format) {
    selectedFormat = format === "square" ? "square" : "wide";
    document.querySelectorAll("[data-share-format]").forEach((button) => button.classList.toggle("active", button.dataset.shareFormat === selectedFormat));
    renderCanvas();
  }

  function installUi() {
    if (document.getElementById("replayShareDialog")) return;
    const summary = document.getElementById("workspaceResultSummary") || document.querySelector(".account-panel");
    if (summary) {
      const card = document.createElement("section");
      card.className = "replay-share-card";
      card.innerHTML = `
        <span class="mini-kicker">SHARE YOUR PRACTICE</span>
        <h3>練習結果を1枚の画像にする</h3>
        <p>損益だけでなく、最大DDと今回の学びも載せます。X・Threads・noteで共有しやすい2サイズです。</p>
        <div class="replay-share-actions">
          <button type="button" class="button" data-share-action="open">画像を作る</button>
          <button type="button" class="button secondary" data-share-action="share">画像を共有</button>
          <button type="button" class="button ghost-button" data-share-action="copy">共有文をコピー</button>
        </div>
        <p class="replay-share-status" data-share-status aria-live="polite"></p>`;
      summary.appendChild(card);
    }

    const dialog = document.createElement("dialog");
    dialog.id = "replayShareDialog";
    dialog.className = "replay-share-dialog";
    dialog.innerHTML = `
      <div class="replay-share-dialog-header"><h2>かぶたね 売買練習レポート</h2><button type="button" class="replay-share-dialog-close" data-share-action="close" aria-label="閉じる">×</button></div>
      <div class="replay-share-dialog-body">
        <div id="replaySharePreview" class="replay-share-preview"></div>
        <div class="replay-share-controls">
          <div><strong>画像サイズ</strong><div class="replay-share-format"><button type="button" class="active" data-share-format="wide">横長｜X・note</button><button type="button" data-share-format="square">正方形｜Threads</button></div></div>
          <button type="button" class="button primary-action" data-share-action="share">画像を端末から共有</button>
          <button type="button" class="button" data-share-action="download">PNG画像を保存</button>
          <button type="button" class="button secondary" data-share-action="x">X投稿文を開く</button>
          <button type="button" class="button ghost-button" data-share-action="copy">共有文をコピー</button>
          <textarea id="replayShareText" aria-label="共有文"></textarea>
          <p class="replay-share-note">スマホの「画像を端末から共有」では、端末に入っているX・Threads・noteなどを選べます。PCでは画像保存と共有文コピーをご利用ください。</p>
          <p class="replay-share-status" data-share-status aria-live="polite"></p>
        </div>
      </div>`;
    document.body.appendChild(dialog);
  }

  document.addEventListener("kabutane:open-share-report", openDialog);
  document.addEventListener("click", (event) => {
    const format = event.target.closest("[data-share-format]");
    if (format) { setFormat(format.dataset.shareFormat); return; }
    const action = event.target.closest("[data-share-action]")?.dataset.shareAction;
    if (!action) return;
    if (action === "open") openDialog();
    else if (action === "close") closeDialog();
    else if (action === "download") downloadImage();
    else if (action === "share") shareImage();
    else if (action === "copy") copyText();
    else if (action === "x") openX();
  });

  installUi();
  window.ReplayShareReport = { snapshot, renderCanvas, openDialog, buildShareText: () => Core.buildShareText(snapshot()) };
})();
