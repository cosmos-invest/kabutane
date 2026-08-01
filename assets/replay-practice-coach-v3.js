(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const SCORE_LINES = [
    { min: 90, range: "90–100", label: "優秀", note: "再現性の高い運用" },
    { min: 80, range: "80–89", label: "良好", note: "安定した運用" },
    { min: 70, range: "70–79", label: "合格", note: "基本は守れている" },
    { min: 60, range: "60–69", label: "練習中", note: "計画を整える途中" },
    { min: 0, range: "0–59", label: "要改善", note: "資金管理から練習" },
  ];

  const RADAR_AXES = [
    ["事前計画", "事前計画"],
    ["リスク管理", "リスク・資金管理"],
    ["エントリー", "エントリー・追加判断"],
    ["保有規律", "保有中の規律"],
    ["利確・撤退", "利確・撤退判断"],
    ["振り返り", "振り返り"],
  ];

  const ADVICE = {
    "stop-before-entry": "買う前に損切り価格を決めてから注文しよう。",
    "target-before-entry": "買う前に利確候補も置き、損失1に対する利益候補を決めよう。",
    "entry-thesis": "押し目・高値突破・月足RSIなど、主役のエントリー根拠を1つ言葉にしよう。",
    "event-awareness": "決算・権利日・株式分割などのイベントを確認してから入ろう。",
    "plan-status": "計画どおりか、条件変化による変更かを毎回残そう。",
    "risk-cap": "許容損失を超えた時は損切りを広げず、株数を減らそう。ここは10点配点なので最優先。",
    "allocation-cap": "1銘柄への投入上限を先に決め、超える時は株数を減らそう。",
    "stop-held": "買った後に損切りを遠ざけないこと。外れた時に小さく負けよう。",
    "share-cap": "追加購入前に残りの計画株数を確認し、上限を超えないようにしよう。",
    "thesis-consistency": "初回購入の理由を明確にして、途中で理由をすり替えないようにしよう。",
    "split-discipline": "一括・2分割・4分割を先に決め、その回数を守ろう。",
    "addition-reasons": "追加購入は『下がったから』ではなく、最初の根拠が続いているか確認しよう。",
    "event-sizing": "決算跨ぎなどでは通常より株数を落とし、損失額を一定にしよう。",
    "holding-stop": "保有中も損切りは下げず、必要なら建値や直近安値へ切り上げよう。",
    "change-record": "計画を変えた時は『何が変わったから』を一言残そう。",
    "event-decision": "保有中の決算・権利イベントで、跨ぐ・減らす・撤退の判断を残そう。",
    "activity": "売買回数を増やしすぎず、根拠がある場面だけで追加・利確しよう。",
    "exit-reason": "予定利確・トレンド崩れ・資金移動など、売却理由を残そう。",
    "exit-discipline": "予定した利確・損切り、または条件変化に沿って撤退しよう。",
    "remaining-stop": "部分利確したら、残りを建値・直近安値・元の損切りのどこで守るか決めよう。",
    "no-panic": "全決済の前に『計画どおりか』『条件が変わったか』を確認しよう。",
    "review": "最後に1行だけでも振り返りを残し、次回使えるルールに変えよう。",
  };

  let syncQueued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }

  function scoreNow() {
    try { return window.KabutanePracticeV2?.currentScore?.() || null; } catch (_) { return null; }
  }

  function category(result, name) {
    return result?.categories?.find((item) => item.name === name) || null;
  }

  function ratio(result, name) {
    const item = category(result, name);
    return item?.max ? item.earned / item.max : 0;
  }

  function scoreLine(score) {
    return SCORE_LINES.find((line) => Number(score) >= line.min) || SCORE_LINES[SCORE_LINES.length - 1];
  }

  function strongestMiss(result) {
    const misses = [];
    (result?.categories || []).forEach((group) => {
      if (group.name === "タイミングボーナス") return;
      (group.items || []).forEach((item) => {
        if (!item.ok) misses.push({ ...item, group: group.name, priority: item.points + (group.name === "リスク・資金管理" ? 100 : 0) });
      });
    });
    misses.sort((a, b) => b.priority - a.priority || b.points - a.points);
    return misses[0] || null;
  }

  function commentFor(result, character) {
    if (character === "cosmos") {
      const value = (ratio(result, "事前計画") + ratio(result, "エントリー・追加判断")) / 2;
      if (value >= 0.85) return "入る前の計画と根拠がかなり揃ってるね🌸 この形を自分の型として残していこう。";
      if (value >= 0.65) return "方向はいいよ🌸 次は『なぜここで入るか』と分割回数を先に決めると、もっと再現しやすいよ。";
      return "まずは理由・損切り・利確候補の3つを買う前に決めよう🌸 入口を整えるだけで点数が大きく変わるよ。";
    }
    if (character === "aile") {
      const value = ratio(result, "リスク・資金管理");
      if (value >= 0.9) return "損失上限と株数管理がとても良いね💜 利益より先に守りを決められているのが強いよ。";
      if (value >= 0.7) return "資金管理はあと一歩だね💜 損切りを広げず、許容損失から株数を逆算しよう。";
      return "ここを最優先で直そう💜 1回の損失額を固定して、その範囲に収まる株数だけ買うのが基本だよ。";
    }
    const value = (ratio(result, "保有中の規律") + ratio(result, "利確・撤退判断")) / 2;
    if (value >= 0.85) return `持っている間と売る時の判断がきれいだね✨ ${result.timingMessage || "この調子でルールを再現しよう。"}`;
    if (value >= 0.65) return "途中の判断は悪くないよ✨ 部分利確後に『残りをどこで守るか』まで決めるともっと強くなる！";
    return "部分利確・全利確・撤退の条件を先に決めよう✨ 売る時の迷いがかなり減るよ。";
  }

  function polygonPoint(cx, cy, radius, index) {
    const angle = -Math.PI / 2 + Math.PI * 2 * index / 6;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle };
  }

  function polygon(ctx, cx, cy, radius) {
    ctx.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const point = polygonPoint(cx, cy, radius, index);
      if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
  }

  function drawRadar(ctx, result, box) {
    const values = RADAR_AXES.map(([, name]) => Math.max(0, Math.min(1, ratio(result, name))));
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const radius = Math.min(box.width, box.height) * 0.31;
    ctx.save();
    [0.25, 0.5, 0.75, 1].forEach((level) => {
      ctx.strokeStyle = level === 1 ? "#cfbcca" : "#eadde5";
      ctx.lineWidth = 1;
      polygon(ctx, cx, cy, radius * level);
      ctx.stroke();
    });
    for (let index = 0; index < 6; index += 1) {
      const edge = polygonPoint(cx, cy, radius, index);
      ctx.strokeStyle = "#eadde5";
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(edge.x, edge.y); ctx.stroke();
    }
    ctx.beginPath();
    values.forEach((value, index) => {
      const point = polygonPoint(cx, cy, radius * value, index);
      if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(201,88,148,.23)";
    ctx.strokeStyle = "#b65388";
    ctx.lineWidth = 3;
    ctx.fill(); ctx.stroke();
    values.forEach((value, index) => {
      const point = polygonPoint(cx, cy, radius * value, index);
      ctx.fillStyle = "#8d5fc1";
      ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill();
      const label = polygonPoint(cx, cy, radius + 34, index);
      ctx.fillStyle = "#5d4855";
      ctx.font = "800 13px system-ui, -apple-system, sans-serif";
      ctx.textAlign = Math.cos(label.angle) > 0.35 ? "left" : Math.cos(label.angle) < -0.35 ? "right" : "center";
      ctx.textBaseline = Math.sin(label.angle) > 0.55 ? "top" : Math.sin(label.angle) < -0.55 ? "bottom" : "middle";
      ctx.fillText(`${RADAR_AXES[index][0]} ${Math.round(value * 100)}%`, label.x, label.y);
    });
    ctx.restore();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const lines = [];
    let line = "";
    Array.from(String(text || "")).forEach((char) => {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = char; } else line = next;
    });
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((item, index) => ctx.fillText(item + (index === maxLines - 1 && lines.length > maxLines ? "…" : ""), x, y + index * lineHeight));
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
  }

  function buildReport(result) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 675;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 1200, 675);
    gradient.addColorStop(0, "#fff8fb"); gradient.addColorStop(1, "#f4f0ff");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 675);
    ctx.fillStyle = "#5a4250"; ctx.font = "900 34px system-ui, -apple-system, sans-serif"; ctx.fillText("かぶたね｜運用実践レポート", 56, 58);
    ctx.fillStyle = "#8c7180"; ctx.font = "700 18px system-ui, -apple-system, sans-serif"; ctx.fillText("利益より、計画・資金管理・撤退の規律を評価", 56, 88);
    const line = scoreLine(result.score);
    ctx.fillStyle = "#b65388"; ctx.font = "950 96px system-ui, -apple-system, sans-serif"; ctx.fillText(String(result.score), 62, 196);
    ctx.fillStyle = "#6a5261"; ctx.font = "900 26px system-ui, -apple-system, sans-serif"; ctx.fillText(`点｜${line.label}（${line.range}）`, 180, 172);
    ctx.fillStyle = "#8b7482"; ctx.font = "700 18px system-ui, -apple-system, sans-serif"; ctx.fillText(line.note, 184, 202);
    drawRadar(ctx, result, { x: 500, y: 72, width: 620, height: 420 });
    const missed = strongestMiss(result);
    roundedRect(ctx, 56, 254, 400, 160, 18); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#e3d2df"; ctx.stroke();
    ctx.fillStyle = "#8c6da0"; ctx.font = "900 17px system-ui, -apple-system, sans-serif"; ctx.fillText("次に伸ばすワンポイント", 78, 286);
    ctx.fillStyle = "#5b4553"; ctx.font = "850 20px system-ui, -apple-system, sans-serif"; ctx.fillText(missed ? `${missed.group}｜あと最大 +${missed.points}点` : "大きな取りこぼしなし", 78, 319);
    ctx.fillStyle = "#75616e"; ctx.font = "700 16px system-ui, -apple-system, sans-serif"; wrapText(ctx, missed ? (ADVICE[missed.key] || `${missed.label}を次回は意識しよう。`) : "今回守れたルールを次回も同じ順番で再現しよう。", 78, 350, 350, 24, 3);
    [["コスモス🌸", "cosmos"], ["ルーモ✨", "lumo"], ["エール💜", "aile"]].forEach(([name, key], index) => {
      const x = 56 + index * 370;
      roundedRect(ctx, x, 462, 344, 156, 16); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#ead8e2"; ctx.stroke();
      ctx.fillStyle = "#604957"; ctx.font = "900 18px system-ui, -apple-system, sans-serif"; ctx.fillText(name, x + 18, 494);
      ctx.fillStyle = "#76616e"; ctx.font = "700 15px system-ui, -apple-system, sans-serif"; wrapText(ctx, commentFor(result, key), x + 18, 525, 308, 22, 4);
    });
    return canvas.toDataURL("image/png");
  }

  function breakdown(result) {
    return (result.categories || []).map((group) => `<details ${group.name === "リスク・資金管理" ? "open" : ""}><summary><span>${group.name}</span><b>${group.earned} / ${group.max}</b></summary><div class="practice-score-items">${(group.items || []).map((item) => `<div class="practice-score-item ${item.ok ? "ok" : "missed"}"><span class="practice-score-item-mark">${item.ok ? "✓" : "○"}</span><span>${item.label}</span><b>${item.ok ? item.points : 0} / ${item.points}</b></div>`).join("")}</div></details>`).join("");
  }

  function enhanceScore(result) {
    const card = document.querySelector("#finishSummary .practice-score-card");
    if (!card || card.dataset.coachV3 === "true") return;
    card.dataset.coachV3 = "true";
    const current = scoreLine(result.score);
    const missed = strongestMiss(result);
    const block = document.createElement("div");
    block.className = "practice-score-coach-v3";
    block.innerHTML = `<div class="practice-score-thresholds">${SCORE_LINES.map((line) => `<div class="practice-score-threshold ${line === current ? "current" : ""}"><strong>${line.range}｜${line.label}</strong><small>${line.note}</small></div>`).join("")}</div><div class="practice-score-breakdown"><h4>点数の内訳</h4>${breakdown(result)}</div><section class="practice-radar-block"><h4>6つの運用力</h4><canvas class="practice-radar-canvas" width="680" height="460"></canvas><small>タイミングボーナスは結果要因なので、レーダーから除外しています。</small></section><div class="practice-score-comments"><article class="practice-score-comment"><strong>コスモス🌸</strong><p>${commentFor(result, "cosmos")}</p></article><article class="practice-score-comment"><strong>ルーモ✨</strong><p>${commentFor(result, "lumo")}</p></article><article class="practice-score-comment"><strong>エール💜</strong><p>${commentFor(result, "aile")}</p></article></div><div class="practice-score-advice"><span>NEXT +POINT</span><strong>${missed ? `${missed.group}｜あと最大 +${missed.points}点` : "大きな取りこぼしなし"}</strong><p>${missed ? (ADVICE[missed.key] || `${missed.label}を次回は意識しよう。`) : "今回守れたルールを次回も同じ順番で再現しよう。"}</p></div><div class="practice-report-actions"><button class="primary" type="button" data-build-practice-report>六角形の評価レポート画像を表示</button></div><img class="practice-evaluation-preview" alt="運用実践スコアの評価レポート画像" hidden>`;
    card.appendChild(block);
    drawRadar(block.querySelector("canvas"), result, { x: 20, y: 8, width: 640, height: 444 });
    block.querySelector("[data-build-practice-report]")?.addEventListener("click", () => {
      const preview = block.querySelector(".practice-evaluation-preview");
      preview.src = buildReport(result); preview.hidden = false; preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function fixMonthlyRsi() {
    const details = document.getElementById("unifiedIndicatorDetails");
    const box = document.querySelector(".monthly-rsi-chart-box");
    if (!details || !box) return;
    if (!details.open) details.open = true;
    const label = details.querySelector("summary span");
    if (label && label.textContent !== "月足RSI・指標") label.textContent = "月足RSI・指標";
    requestAnimationFrame(() => {
      try {
        if (typeof renderSynchronizedCharts === "function") renderSynchronizedCharts();
        appState()?.rsiChart?.resize?.();
        appState()?.rsiChart?.draw?.();
      } catch (_) {}
    });
  }

  function setButtonText(button, text) {
    if (button && button.textContent !== text) button.textContent = text;
  }

  function partialQuantity(shares, ratio, lotSize) {
    if (shares <= 0) return 0;
    if (ratio >= 1) return shares;
    const lot = Math.max(1, Number(lotSize) || 1);
    const rounded = Math.floor(shares * ratio / lot) * lot;
    return Math.min(shares, rounded > 0 ? rounded : shares);
  }

  function updateExitGuide() {
    const stateRef = appState();
    const shares = Number(stateRef?.account?.shares || 0);
    const lot = Math.max(1, Number(stateRef?.lotSize) || 1);
    const quarterQty = partialQuantity(shares, 0.25, lot);
    const halfQty = partialQuantity(shares, 0.5, lot);
    const quarter = document.getElementById("sellQuarterButton");
    const half = document.getElementById("sellHalfButton");
    const all = document.getElementById("sellAllButton");
    setButtonText(quarter, shares > 0 && quarterQty >= shares ? `残り${shares.toLocaleString("ja-JP")}株を全部売る` : `残りの25%を売る${quarterQty > 0 ? `（${quarterQty.toLocaleString("ja-JP")}株）` : ""}`);
    setButtonText(half, shares > 0 && halfQty >= shares ? `残り${shares.toLocaleString("ja-JP")}株を全部売る` : `残りの50%を売る${halfQty > 0 ? `（${halfQty.toLocaleString("ja-JP")}株）` : ""}`);
    setButtonText(all, shares > 0 ? `残り${shares.toLocaleString("ja-JP")}株を全部売る` : "残りを全部売る");
    const buttons = all?.closest(".sell-buttons");
    if (buttons) {
      let guide = document.getElementById("practiceExitGuide");
      if (!guide) { guide = document.createElement("div"); guide.id = "practiceExitGuide"; guide.className = "practice-exit-guide"; buttons.insertAdjacentElement("afterend", guide); }
      const halfDescription = shares > 0 && halfQty >= shares
        ? "残りが売買単位未満になるため、50%指定でも全株売却になります。"
        : shares > 0 ? `50%なら約${halfQty.toLocaleString("ja-JP")}株を売却し、残りを保有できます。` : "";
      const html = shares > 0
        ? `<strong>現在 ${shares.toLocaleString("ja-JP")}株・売買単位${lot.toLocaleString("ja-JP")}株。</strong> ${halfDescription} 部分利確後は、残った株数に対してもう一度25%・50%を選べます。`
        : "部分利確後も、残った株数に対して25%・50%を繰り返せます。売買単位より小さくなる場合は全株売却になります。";
      if (guide.innerHTML !== html) guide.innerHTML = html;
    }

    const actionArea = document.getElementById("guidedActionArea");
    if (!stateRef || !actionArea || stateRef.guided?.mode !== "guided") return;
    const closeButton = actionArea.querySelector('[data-guided-action="close-position"]');
    if (closeButton && shares > 0) setButtonText(closeButton, `残り${shares.toLocaleString("ja-JP")}株を全部売って振り返る`);
    const existing = actionArea.querySelector("#guidedFollowupExit");
    const shouldShow = shares > 0 && stateRef.guided?.step === "observe" && stateRef.guided?.targetTriggered;
    if (!shouldShow) { existing?.remove(); return; }
    if (existing?.dataset.shares === String(shares) && existing?.dataset.lot === String(lot)) return;
    existing?.remove();
    const helper = document.createElement("div");
    helper.id = "guidedFollowupExit"; helper.className = "guided-followup-exit"; helper.dataset.shares = String(shares); helper.dataset.lot = String(lot);
    const canHalf = halfQty < shares;
    helper.innerHTML = `<p><strong>部分利確後：残り ${shares.toLocaleString("ja-JP")}株</strong><br>${canHalf ? `さらに半分の${halfQty.toLocaleString("ja-JP")}株だけ利確して、残りを持つこともできるよ。` : `売買単位が${lot.toLocaleString("ja-JP")}株なので、ここから50%だけ売ることはできないよ。`}</p><button type="button" data-practice-exit-action="${canHalf ? "half" : "all"}">${canHalf ? `残りの50%（${halfQty.toLocaleString("ja-JP")}株）を追加利確` : "残りを全利確"}</button><button type="button" class="primary" data-practice-exit-action="all">残りを全部売って振り返る</button>`;
    actionArea.appendChild(helper);
  }

  function syncUi() {
    syncQueued = false;
    fixMonthlyRsi(); updateExitGuide();
    const result = scoreNow(); if (result) enhanceScore(result);
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncUi);
  }

  function patchRenderAll() {
    try {
      if (typeof renderAll !== "function" || window.__kabutanePracticeCoachRenderPatched) return;
      window.__kabutanePracticeCoachRenderPatched = true;
      const baseRenderAll = renderAll;
      renderAll = function renderAllWithPracticeCoach() {
        const value = baseRenderAll();
        queueMicrotask(queueSync);
        return value;
      };
    } catch (_) {}
  }

  document.addEventListener("kabutane:practice-score", (event) => enhanceScore(event.detail));
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-practice-exit-action]")?.dataset.practiceExitAction;
    if (action === "half") document.getElementById("sellHalfButton")?.click();
    else if (action === "all") {
      const close = document.querySelector('[data-guided-action="close-position"]');
      if (close) close.click(); else document.getElementById("sellAllButton")?.click();
    }
    setTimeout(queueSync, 0);
  });
  window.addEventListener("resize", queueSync);
  patchRenderAll();
  queueSync();
})();
