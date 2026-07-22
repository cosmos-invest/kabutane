(function () {
  "use strict";

  if (typeof document === "undefined" || typeof ReplayShareReportCore === "undefined") return;
  const Core = ReplayShareReportCore;
  const PLATFORM_FORMAT = { x: "wide", threads: "square", note: "wide" };
  let selectedFormat = "wide";
  let selectedPlatform = "x";
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
    ctx.save();
    ctx.font = `${options.weight || 700} ${options.size || 28}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
    const chars = [...String(value || "")];
    const lines = [];
    let line = "";
    chars.forEach((character) => {
      const candidate = line + character;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = character;
      } else line = candidate;
    });
    if (line) lines.push(line);
    const clipped = lines.slice(0, maxLines);
    if (lines.length > maxLines) clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, -1)}…`;
    ctx.restore();
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

  function markerColor(type) {
    return type === "BUY" ? "#d95f98" : "#4b91b4";
  }

  function drawTriangle(ctx, x, y, size, type) {
    ctx.beginPath();
    if (type === "BUY") {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size);
      ctx.lineTo(x - size, y + size);
    } else {
      ctx.moveTo(x, y + size);
      ctx.lineTo(x + size, y - size);
      ctx.lineTo(x - size, y - size);
    }
    ctx.closePath();
  }

  function drawTradeMarker(ctx, marker, px, py, bounds) {
    const color = markerColor(marker.type);
    const size = 9;
    const labelY = marker.type === "BUY"
      ? Math.min(bounds.bottom - 12, py + 27)
      : Math.max(bounds.top + 13, py - 27);
    const labelWidth = Math.max(36, 15 + [...marker.label].length * 15);
    const labelX = Math.min(bounds.right - labelWidth / 2, Math.max(bounds.left + labelWidth / 2, px));

    ctx.save();
    drawTriangle(ctx, px, py, size, marker.type);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.stroke();

    roundedRect(ctx, labelX - labelWidth / 2, labelY - 12, labelWidth, 24, 12);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, marker.label, labelX, labelY + 1, { size: 14, weight: 950, color: "#fff", align: "center", baseline: "middle" });
    ctx.restore();
  }

  function drawTradeLegend(ctx, x, y) {
    text(ctx, "▲ 買い", x, y, { size: 14, weight: 850, color: "#d95f98" });
    text(ctx, "▼ 売り", x + 70, y, { size: 14, weight: 850, color: "#4b91b4" });
  }

  function drawSparkline(ctx, snap, x, y, width, height) {
    const series = snap.series.filter((row) => Number.isFinite(row.close));
    const markers = (snap.tradeMarkers || Core.aggregateTradeMarkers(snap.trades))
      .filter((marker) => Number.isFinite(marker.price));
    roundedRect(ctx, x, y, width, height, 24);
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(119,75,101,.10)";
    ctx.stroke();
    if (series.length < 2) {
      text(ctx, "チャートデータなし", x + width / 2, y + height / 2, { size: 22, align: "center", color: "#9b8492" });
      return;
    }

    const values = [...series.map((row) => row.close), ...markers.map((marker) => marker.price)];
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, Math.abs(maximum) * .01, 1);
    const padding = { left: 28, right: 28, top: 38, bottom: 36 };
    const bounds = {
      left: x + padding.left,
      right: x + width - padding.right,
      top: y + padding.top,
      bottom: y + height - padding.bottom,
    };
    const xForIndex = (index) => bounds.left + index / Math.max(1, series.length - 1) * (bounds.right - bounds.left);
    const yForPrice = (price) => bounds.bottom - (price - minimum) / range * (bounds.bottom - bounds.top);
    const dateIndex = new Map(series.map((row, index) => [row.date, index]));

    ctx.save();
    ctx.strokeStyle = "rgba(137,101,124,.10)";
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((ratio) => {
      const gy = bounds.top + (bounds.bottom - bounds.top) * ratio;
      ctx.beginPath();
      ctx.moveTo(bounds.left, gy);
      ctx.lineTo(bounds.right, gy);
      ctx.stroke();
    });

    ctx.beginPath();
    series.forEach((row, index) => {
      const px = xForIndex(index);
      const py = yForPrice(row.close);
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

    markers.forEach((marker) => {
      const index = dateIndex.get(marker.date);
      if (index === undefined) return;
      drawTradeMarker(ctx, marker, xForIndex(index), yForPrice(marker.price), bounds);
    });

    drawTradeLegend(ctx, x + 22, y + 25);
    text(ctx, snap.startDate, bounds.left, y + height - 8, { size: 15, color: "#907887" });
    text(ctx, snap.endDate, bounds.right, y + height - 8, { size: 15, color: "#907887", align: "right" });
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
    text(ctx, snap.reportMessageLabel, 780, 378, { size: 19, weight: 900, color: "#8e5575" });
    wrapText(ctx, snap.reportMessage, 780, 420, 300, 35, 3, { size: 24, weight: 800, color: "#513b4a" });
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
    text(ctx, snap.reportMessageLabel, 116, 856, { size: 20, weight: 900, color: "#8e5575" });
    wrapText(ctx, snap.reportMessage, 116, 896, 820, 34, 2, { size: 25, weight: 800, color: "#513b4a" });
    text(ctx, snap.tagline, 84, 1000, { size: 23, weight: 950, color: "#b1497c" });
    text(ctx, "#かぶたね  #未来の1株", 966, 1000, { size: 18, weight: 850, color: "#8a6d7e", align: "right" });
    return canvas;
  }

  function shareOptions() {
    return {
      platform: selectedPlatform,
      includeHandles: Boolean(document.getElementById("shareMentionEnabled")?.checked),
      handles: document.getElementById("shareMentionHandle")?.value || Core.DEFAULT_X_HANDLE,
      url: (latestSnapshot || snapshot()).url,
    };
  }

  function currentPost(snap = latestSnapshot || snapshot()) {
    return Core.buildPlatformPost(snap, shareOptions());
  }

  function postFromEditor(snap = latestSnapshot || snapshot()) {
    const generated = currentPost(snap);
    const edited = document.getElementById("replayShareText")?.value;
    if (!edited || edited === generated.combined) return generated;
    let body = edited;
    if (generated.url && body.includes(generated.url)) body = body.replace(generated.url, "").trimEnd();
    const weightedLength = Core.xWeightedLength(edited);
    return {
      ...generated,
      body,
      combined: edited,
      weightedLength,
      remaining: Core.X_MAX_WEIGHTED_LENGTH - weightedLength,
      valid: weightedLength <= Core.X_MAX_WEIGHTED_LENGTH,
    };
  }

  function updateXCounter(value) {
    const counter = document.getElementById("replayXCount");
    if (!counter) return;
    const weightedLength = Core.xWeightedLength(value);
    const remaining = Core.X_MAX_WEIGHTED_LENGTH - weightedLength;
    counter.hidden = selectedPlatform !== "x";
    counter.classList.toggle("negative", remaining < 0);
    counter.classList.toggle("positive", remaining >= 0);
    counter.innerHTML = `<strong>${weightedLength} / ${Core.X_MAX_WEIGHTED_LENGTH}</strong><span>${remaining >= 0 ? `残り${remaining}` : `${Math.abs(remaining)}超過`}｜日本語は原則2、URLは23で計算</span>`;
  }

  function syncShareText() {
    latestSnapshot ||= snapshot();
    const post = currentPost(latestSnapshot);
    const textBox = document.getElementById("replayShareText");
    if (textBox) textBox.value = post.combined;
    updateXCounter(post.combined);
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
    syncShareText();
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
      const post = postFromEditor(snap);
      if (selectedPlatform === "x" && !post.valid) {
        setStatus("Xの文字数を超えています。文章を短くしてから共有してください。", true);
        return;
      }
      const blob = await canvasBlob(canvas);
      const file = new File([blob], Core.fileName(snap, selectedFormat), { type: "image/png" });
      const data = { title: "かぶたね 売買練習レポート", text: post.body, url: post.url, files: [file] };
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share(data);
        setStatus("端末の共有メニューを開きました。投稿先を選んで、そのまま宣伝できます。");
      } else {
        await downloadImage();
        await copyText();
        setStatus("画像を保存し、投稿文をコピーしました。");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(error.message || "共有できませんでした。", true);
    }
  }

  async function copyText() {
    const value = document.getElementById("replayShareText")?.value || currentPost().combined;
    if (selectedPlatform === "x" && Core.xWeightedLength(value) > Core.X_MAX_WEIGHTED_LENGTH) {
      setStatus("Xの文字数を超えています。文章を短くしてからコピーしてください。", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus("投稿文をコピーしました。そのまま貼り付けて投稿できます。");
    } catch (error) {
      const textarea = document.getElementById("replayShareText");
      textarea?.select();
      document.execCommand("copy");
      setStatus("投稿文をコピーしました。");
    }
  }

  function openX() {
    setPlatform("x", false);
    const snap = latestSnapshot || snapshot();
    const generated = Core.buildXPost(snap, shareOptions());
    const edited = postFromEditor(snap);
    const post = selectedPlatform === "x" ? edited : generated;
    if (!post.valid) {
      setStatus("Xの文字数を超えています。文章を短くしてください。", true);
      return;
    }
    const url = new URL("https://twitter.com/intent/tweet");
    url.searchParams.set("text", post.body);
    if (post.url) url.searchParams.set("url", post.url);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    setStatus("Xの投稿画面を開きました。保存した画像を添付すれば完成です。");
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

  function setPlatform(platform, applyRecommendedFormat = true) {
    selectedPlatform = ["x", "threads", "note"].includes(platform) ? platform : "x";
    const dialog = document.getElementById("replayShareDialog");
    if (dialog) dialog.dataset.platform = selectedPlatform;
    document.querySelectorAll("[data-share-platform]").forEach((button) => button.classList.toggle("active", button.dataset.sharePlatform === selectedPlatform));
    document.querySelector(".replay-share-mention")?.toggleAttribute("hidden", selectedPlatform === "note");
    if (applyRecommendedFormat) {
      selectedFormat = PLATFORM_FORMAT[selectedPlatform];
      document.querySelectorAll("[data-share-format]").forEach((button) => button.classList.toggle("active", button.dataset.shareFormat === selectedFormat));
      renderCanvas();
    } else syncShareText();
  }

  function installUi() {
    if (document.getElementById("replayShareDialog")) return;
    const summary = document.getElementById("workspaceResultSummary") || document.querySelector(".account-panel");
    if (summary) {
      const card = document.createElement("section");
      card.className = "replay-share-card";
      card.innerHTML = `
        <span class="mini-kicker">SHARE YOUR PRACTICE</span>
        <h3>売買ポイント入りの結果画像をシェア</h3>
        <p>買い・売り位置が分かる画像と、かぶたねを試したくなる投稿文をX・Threads・note向けに自動作成します。</p>
        <div class="replay-share-actions">
          <button type="button" class="button" data-share-action="open">画像と投稿文を作る</button>
          <button type="button" class="button secondary" data-share-action="share">今すぐ共有</button>
          <button type="button" class="button ghost-button" data-share-action="copy">投稿文をコピー</button>
        </div>
        <p class="replay-share-status" data-share-status aria-live="polite"></p>`;
      summary.appendChild(card);
    }

    const dialog = document.createElement("dialog");
    dialog.id = "replayShareDialog";
    dialog.className = "replay-share-dialog";
    dialog.dataset.platform = selectedPlatform;
    dialog.innerHTML = `
      <div class="replay-share-dialog-header"><h2>かぶたね 売買練習レポート</h2><button type="button" class="replay-share-dialog-close" data-share-action="close" aria-label="閉じる">×</button></div>
      <div class="replay-share-dialog-body">
        <div id="replaySharePreview" class="replay-share-preview"></div>
        <div class="replay-share-controls">
          <div><strong>投稿先</strong><div class="replay-share-platform"><button type="button" class="active" data-share-platform="x">X</button><button type="button" data-share-platform="threads">Threads</button><button type="button" data-share-platform="note">note</button></div></div>
          <div><strong>画像サイズ</strong><div class="replay-share-format"><button type="button" class="active" data-share-format="wide">横長｜X・note</button><button type="button" data-share-format="square">正方形｜Threads</button></div></div>
          <div class="replay-share-mention">
            <label><input id="shareMentionEnabled" type="checkbox"> 開発者へ知らせる</label>
            <input id="shareMentionHandle" type="text" value="${Core.DEFAULT_X_HANDLE}" maxlength="40" aria-label="通知するXユーザー名">
            <small>通知負荷を抑えるため初期OFFです。別アカウントから投稿するときだけONがおすすめです。</small>
          </div>
          <button type="button" class="button primary-action" data-share-action="share">画像と投稿文を端末から共有</button>
          <button type="button" class="button" data-share-action="download">PNG画像を保存</button>
          <button type="button" class="button secondary replay-x-only" data-share-action="x">X投稿画面を開く</button>
          <button type="button" class="button ghost-button" data-share-action="copy">投稿文をコピー</button>
          <textarea id="replayShareText" aria-label="投稿文"></textarea>
          <div id="replayXCount" class="replay-x-count" aria-live="polite"></div>
          <p class="replay-share-note">投稿文は宣伝用に最適化しています。Xは文字数内へ自動短縮し、URLを23文字として計算します。</p>
          <p class="replay-share-status" data-share-status aria-live="polite"></p>
        </div>
      </div>`;
    document.body.appendChild(dialog);
  }

  document.addEventListener("kabutane:open-share-report", openDialog);
  document.addEventListener("click", (event) => {
    const platform = event.target.closest("[data-share-platform]");
    if (platform) { setPlatform(platform.dataset.sharePlatform); return; }
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

  document.addEventListener("input", (event) => {
    if (event.target.id === "replayShareText") updateXCounter(event.target.value);
    if (event.target.id === "shareMentionHandle") syncShareText();
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "shareMentionEnabled") syncShareText();
  });

  installUi();
  window.ReplayShareReport = {
    snapshot,
    renderCanvas,
    openDialog,
    buildShareText: () => currentPost(snapshot()).combined,
    setPlatform,
  };
})();
