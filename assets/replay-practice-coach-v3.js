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
    "stop-before-entry": "買う前に損切り価格を決めてから注文すると、事前計画と資金管理の両方が安定するよ。",
    "target-before-entry": "買う前に利確候補も置いて、損失1に対してどれくらい狙うかを先に決めよう。",
    "entry-thesis": "買う理由を1つ言葉にしてからエントリーしよう。押し目・高値突破・月足RSIなど、主役の根拠を決めるだけでOK。",
    "event-awareness": "決算・権利日・分割などのイベントを確認してから入ると、想定外の値動きを減らせるよ。",
    "plan-status": "その売買が計画どおりか、条件変化による変更かを毎回残そう。後から再現性を判断しやすくなるよ。",
    "risk-cap": "許容損失率を超えた時は、損切りを遠ざけず株数を減らそう。ここは10点配点なので最優先。",
    "allocation-cap": "1銘柄への投入上限を先に決め、上限を超える時は株数を減らそう。",
    "stop-held": "買った後に損切りを遠ざけないこと。外れた時に小さく負けるルールを守ろう。",
    "share-cap": "計画した最大株数を超えないよう、追加購入前に残り株数を確認しよう。",
    "thesis-consistency": "初回購入の理由を明確にして、途中で別の理由へすり替えないようにしよう。",
    "split-discipline": "一括・2分割・4分割のどれで入るか先に決め、その回数を守ろう。",
    "addition-reasons": "追加購入は『下がったから』だけでなく、最初の根拠が継続しているかを確認してからにしよう。",
    "event-sizing": "決算跨ぎなど値動きが大きくなりやすい時は、通常より株数を落としてリスクを一定にしよう。",
    "holding-stop": "保有中も損切りは下げず、必要なら建値や直近安値へ切り上げよう。",
    "change-record": "計画を変えた時は『何が変わったから』を一言残そう。感情と条件変化を分けられるよ。",
    "event-decision": "保有中も決算・権利などのイベントを意識し、跨ぐ・減らす・撤退の判断を記録しよう。",
    "activity": "売買回数を増やしすぎず、根拠がある場面だけで追加・利確しよう。",
    "exit-reason": "売る時も理由を残そう。予定利確、トレンド崩れ、資金移動などを言語化すると次に活きるよ。",
    "exit-discipline": "予定した利確・損切り、または条件変化に沿って撤退しよう。感情だけの全決済を減らせるよ。",
    "remaining-stop": "部分利確したら、残りをどこで守るかを必ず決めよう。建値・直近安値・元の損切りのどれかを選ぼう。",
    "no-panic": "全部売る前に『計画どおりか』『条件が変わったか』を確認しよう。",
    "review": "最後に1行だけでも振り返りを残そう。次回の同じ場面で使えるルールに変わるよ。",
  };

  let scheduled = false;

  function getState() {
    try {
      return typeof state !== "undefined" ? state : null;
    } catch (_) {
      return null;
    }
  }

  function currentScore() {
    try {
      return window.KabutanePracticeV2?.currentScore?.() || null;
    } catch (_) {
      return null;
    }
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
        if (item.ok) return;
        const priority = item.points + (group.name === "リスク・資金管理" ? 100 : 0);
        misses.push({ ...item, group: group.name, priority });
      });
    });
    misses.sort((a, b) => b.priority - a.priority || b.points - a.points);
    return misses[0] || null;
  }

  function commentFor(result, character) {
    if (character === "cosmos") {
      const value = (ratio(result, "事前計画") + ratio(result, "エントリー・追加判断")) / 2;
      if (value >= 0.85) return "入る前の計画と根拠がかなり揃ってるね🌸 この形を自分の型として残していこう。";
      if (value >= 0.65) return "方向はいいよ🌸 次は『なぜここで入るか』と分割回数を先に決めると、もっと再現しやすくなるよ。";
      return "まずは買う前に、理由・損切り・利確候補の3つを決めよう🌸 入口を整えるだけで点数が大きく変わるよ。";
    }
    if (character === "aile") {
      const value = ratio(result, "リスク・資金管理");
      if (value >= 0.9) return "損失上限と株数管理がとても良いね💜 利益より先に守りを決められているのが強いよ。";
      if (value >= 0.7) return "資金管理はあと一歩だね💜 損切りを広げず、許容損失から株数を逆算するところを徹底しよう。";
      return "ここを最優先で直そう💜 1回の損失額を固定して、その範囲に収まる株数だけ買うのが基本だよ。";
    }
    const value = (ratio(result, "保有中の規律") + ratio(result, "利確・撤退判断")) / 2;
    if (value >= 0.85) return `持っている間と売る時の判断がきれいだね✨ ${result.timingMessage || "この調子でルールを再現しよう。"}`;
    if (value >= 0.65) return "途中の判断は悪くないよ✨ 部分利確した後に『残りをどこで守るか』までセットで決めるともっと強くなる！";
    return "売った後より、売る前のルールを作ろう✨ 部分利確・全利確・撤退の条件を先に決めておくと迷いにくいよ。";
  }

  function polygonPoint(cx, cy, radius, index, count) {
    const angle = -Math.PI / 2 + Math.PI * 2 * index / count;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle };
  }

  function drawPolygon(ctx, cx, cy, radius, count) {
    ctx.beginPath();
    for (let index = 0; index < count; index += 1) {
      const point = polygonPoint(cx, cy, radius, index, count);
      if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
  }

  function drawRadar(ctx, result, box) {
    const values = RADAR_AXES.map(([, categoryName]) => Math.max(0, Math.min(1, ratio(result, categoryName))));
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2 + 4;
    const radius = Math.min(box.width, box.height) * 0.32;
    ctx.save();
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach((level) => {
      ctx.strokeStyle = level === 1 ? "#cfbcca" : "#eadde5";
      drawPolygon(ctx, cx, cy, radius * level, 6);
      ctx.stroke();
    });
    for (let index = 0; index < 6; index += 1) {
      const edge = polygonPoint(cx, cy, radius, index, 6);
      ctx.strokeStyle = "#eadde5";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(edge.x, edge.y);
      ctx.stroke();
    }
    ctx.beginPath();
    values.forEach((value, index) => {
      const point = polygonPoint(cx, cy, radius * value, index, 6);
      if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(201,88,148,.23)";
    ctx.strokeStyle = "#b65388";
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    values.forEach((value, index) => {
      const point = polygonPoint(cx, cy, radius * value, index, 6);
      ctx.fillStyle = "#8d5fc1";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
      const labelPoint = polygonPoint(cx, cy, radius + 34, index, 6);
      ctx.fillStyle = "#5d4855";
      ctx.font = "800 13px system-ui, -apple-system, sans-serif";
      ctx.textAlign = Math.cos(labelPoint.angle) > 0.35 ? "left" : Math.cos(labelPoint.angle) < -0.35 ? "right" : "center";
      ctx.textBaseline = Math.sin(labelPoint.angle) > 0.55 ? "top" : Math.sin(labelPoint.angle) < -0.55 ? "bottom" : "middle";
      ctx.fillText(`${RADAR_AXES[index][0]} ${Math.round(value * 100)}%`, labelPoint.x, labelPoint.y);
    });
    ctx.restore();
  }

  function drawRadarCanvas(canvas, result) {
    if (!canvas || !result) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRadar(ctx, result, { x: 20, y: 8, width: canvas.width - 40, height: canvas.height - 16 });
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const chars = Array.from(String(text || ""));
    const lines = [];
    let line = "";
    chars.forEach((char) => {
      const candidate = line + char;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((item, index) => {
      const suffix = index === maxLines - 1 && lines.length > maxLines ? "…" : "";
      ctx.fillText(item + suffix, x, y + index * lineHeight);
    });
  }

  function buildEvaluationReport(result) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 675;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 1200, 675);
    gradient.addColorStop(0, "#fff8fb");
    gradient.addColorStop(1, "#f4f0ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1200, 675);
    ctx.fillStyle = "#5a4250";
    ctx.font = "900 34px system-ui, -apple-system, sans-serif";
    ctx.fillText("かぶたね｜運用実践レポート", 56, 58);
    ctx.fillStyle = "#8c7180";
    ctx.font = "700 18px system-ui, -apple-system, sans-serif";
    ctx.fillText("利益より、計画・資金管理・撤退の規律を評価", 56, 88);

    const line = scoreLine(result.score);
    ctx.fillStyle = "#b65388";
    ctx.font = "950 96px system-ui, -apple-system, sans-serif";
    ctx.fillText(String(result.score), 62, 196);
    ctx.fillStyle = "#6a5261";
    ctx.font = "900 26px system-ui, -apple-system, sans-serif";
    ctx.fillText(`点｜${line.label}（${line.range}）`, 180, 172);
    ctx.font = "700 18px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#8b7482";
    ctx.fillText(line.note, 184, 202);

    drawRadar(ctx, result, { x: 500, y: 76, width: 620, height: 420 });

    const missed = strongestMiss(result);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#e3d2df";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(56, 254, 400, 160, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8c6da0";
    ctx.font = "900 17px system-ui, -apple-system, sans-serif";
    ctx.fillText("次に伸ばすワンポイント", 78, 286);
    ctx.fillStyle = "#5b4553";
    ctx.font = "850 20px system-ui, -apple-system, sans-serif";
    const adviceTitle = missed ? `${missed.group}｜あと最大 +${missed.points}点` : "大きな取りこぼしなし";
    ctx.fillText(adviceTitle, 78, 319);
    ctx.fillStyle = "#75616e";
    ctx.font = "700 16px system-ui, -apple-system, sans-serif";
    wrapText(ctx, missed ? (ADVICE[missed.key] || `${missed.label}を次回は意識しよう。`) : "今回守れたルールを、次回も同じ順番で再現しよう。", 78, 350, 350, 24, 3);

    const comments = [
      ["コスモス🌸", commentFor(result, "cosmos")],
      ["ルーモ✨", commentFor(result, "lumo")],
      ["エール💜", commentFor(result, "aile")],
    ];
    comments.forEach(([name, text], index) => {
      const x = 56 + index * 370;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#ead8e2";
      ctx.beginPath();
      ctx.roundRect(x, 462, 344, 156, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#604957";
      ctx.font = "900 18px system-ui, -apple-system, sans-serif";
      ctx.fillText(name, x + 18, 494);
      ctx.fillStyle = "#76616e";
      ctx.font = "700 15px system-ui, -apple-system, sans-serif";
      wrapText(ctx, text, x + 18, 525, 308, 22, 4);
    });
    return canvas.toDataURL("image/png");
  }

  function renderBreakdown(result) {
    return (result.categories || []).map((group) => {
      const items = (group.items || []).map((item) => `<div class="practice-score-item ${item.ok ? "ok" : "missed"}"><span class="practice-score-item-mark">${item.ok ? "✓" : "○"}</span><span>${item.label}</span><b>${item.ok ? item.points : 0} / ${item.points}</b></div>`).join("");
      return `<details ${group.name === "リスク・資金管理" ? "open" : ""}><summary><span>${group.name}</span><b>${group.earned} / ${group.max}</b></summary><div class="practice-score-items">${items}</div></details>`;
    }).join("");
  }

  function enhanceScore(result) {
    const card = document.querySelector("#finishSummary .practice-score-card");
    if (!card || card.dataset.coachV3 === "true") return;
    card.dataset.coachV3 = "true";
    const current = scoreLine(result.score);
    const missed = strongestMiss(result);
    const section = document.createElement("div");
    section.className = "practice-score-coach-v3";
    section.innerHTML = `
      <div class="practice-score-thresholds" aria-label="スコア目安">
        ${SCORE_LINES.map((line) => `<div class="practice-score-threshold ${line === current ? "current" : ""}"><strong>${line.range}｜${line.label}</strong><small>${line.note}</small></div>`).join("")}
      </div>
      <div class="practice-score-breakdown"><h4>点数の内訳</h4>${renderBreakdown(result)}</div>
      <section class="practice-radar-block"><h4>6つの運用力</h4><canvas id="practiceRadarCanvas" class="practice-radar-canvas" width="680" height="460" aria-label="運用実践スコアのレーダーチャート"></canvas><small>タイミングボーナスは結果要因なのでレーダーから除外しています。</small></section>
      <div class="practice-score-comments">
        <article class="practice-score-comment"><strong>コスモス🌸</strong><p>${commentFor(result, "cosmos")}</p></article>
        <article class="practice-score-comment"><strong>ルーモ✨</strong><p>${commentFor(result, "lumo")}</p></article>
        <article class="practice-score-comment"><strong>エール💜</strong><p>${commentFor(result, "aile")}</p></article>
      </div>
      <div class="practice-score-advice"><span>NEXT +POINT</span><strong>${missed ? `${missed.group}｜あと最大 +${missed.points}点` : "大きな取りこぼしなし"}</strong><p>${missed ? (ADVICE[missed.key] || `${missed.label}を次回は意識しよう。`) : "今回守れたルールを次回も同じ順番で再現しよう。"}</p></div>
      <div class="practice-report-actions"><button id="practiceBuildEvaluationReport" class="primary" type="button">六角形の評価レポート画像を表示</button></div>
      <img id="practiceEvaluationReportPreview" class="practice-evaluation-preview" alt="運用実践スコアの評価レポート画像" hidden>`;
    card.appendChild(section);
    drawRadarCanvas(section.querySelector("#practiceRadarCanvas"), result);
    section.querySelector("#practiceBuildEvaluationReport")?.addEventListener("click", () => {
      const preview = section.querySelector("#practiceEvaluationReportPreview");
      if (!preview) return;
      preview.src = buildEvaluationReport(result);
      preview.hidden = false;
      preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function fixMonthlyRsi() {
    const details = document.getElementById("unifiedIndicatorDetails");
    const box = document.querySelector(".monthly-rsi-chart-box");
    if (!details || !box) return;
    if (!details.open) details.open = true;
    const summaryText = details.querySelector("summary span");
    if (summaryText) summaryText.textContent = "月足RSI・指標";
    requestAnimationFrame(() => {
      try {
        if (typeof renderSynchronizedCharts === "function") renderSynchronizedCharts();
        const appState = getState();
        appState?.rsiChart?.resize?.();
        appState?.rsiChart?.draw?.();
      } catch (_) {}
    });
  }

  function updateFreeExitGuide() {
    const shares = Number(getState()?.account?.shares || 0);
    const quarter = document.getElementById("sellQuarterButton");
    const half = document.getElementById("sellHalfButton");
    const all = document.getElementById("sellAllButton");
    if (quarter) quarter.textContent = "残りの25%を売る";
    if (half) half.textContent = "残りの50%を売る";
    if (all) all.textContent = "残りを全部売る";
    const buttons = all?.closest(".sell-buttons");
    if (!buttons) return;
    let guide = document.getElementById("practiceExitGuide");
    if (!guide) {
      guide = document.createElement("div");
      guide.id = "practiceExitGuide";
      guide.className = "practice-exit-guide";
      buttons.insertAdjacentElement("afterend", guide);
    }
    guide.innerHTML = shares > 0
      ? `<strong>現在 ${shares.toLocaleString("ja-JP")}株。</strong> 50%利確は何度でも押せます。例：100株→50株→25株。最後は「残りを全部売る」で終了できます。`
      : "部分利確後も、残った株数に対して25%・50%を繰り返せます。最後に全株売るとポジション終了です。";
  }

  function updateGuidedExitGuide() {
    const appState = getState();
    const actionArea = document.getElementById("guidedActionArea");
    if (!appState || !actionArea || appState.guided?.mode !== "guided") return;
    const shares = Number(appState.account?.shares || 0);
    const closeButton = actionArea.querySelector('[data-guided-action="close-position"]');
    if (closeButton && shares > 0) closeButton.textContent = "残りを全部売って振り返る";
    actionArea.querySelector("#guidedFollowupExit")?.remove();
    if (!(shares > 0 && appState.guided?.step === "observe" && appState.guided?.targetTriggered)) return;
    const helper = document.createElement("div");
    helper.id = "guidedFollowupExit";
    helper.className = "guided-followup-exit";
    helper.innerHTML = `<p><strong>部分利確後：残り ${shares.toLocaleString("ja-JP")}株</strong><br>まだ全部売らなくて大丈夫。残った株に対して、さらに半分利確を繰り返せるよ。</p><button type="button" data-practice-exit-action="half">残りの50%を追加利確</button><button type="button" class="primary" data-practice-exit-action="all">残りを全部売って振り返る</button>`;
    actionArea.appendChild(helper);
  }

  function syncUi() {
    scheduled = false;
    fixMonthlyRsi();
    updateFreeExitGuide();
    updateGuidedExitGuide();
    const score = currentScore();
    if (score) enhanceScore(score);
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(syncUi);
  }

  document.addEventListener("kabutane:practice-score", (event) => enhanceScore(event.detail));
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-practice-exit-action]")?.dataset.practiceExitAction;
    if (action === "half") {
      document.getElementById("sellHalfButton")?.click();
      setTimeout(scheduleSync, 0);
    } else if (action === "all") {
      const guidedClose = document.querySelector('[data-guided-action="close-position"]');
      if (guidedClose) guidedClose.click(); else document.getElementById("sellAllButton")?.click();
      setTimeout(scheduleSync, 0);
    } else if (event.target.closest("#startSessionButton, #stepOneButton, #stepFiveButton, #playButton, .order-button, [data-guided-action], [data-guided-exit]")) {
      setTimeout(scheduleSync, 0);
    }
  });

  new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleSync);
  scheduleSync();
})();
