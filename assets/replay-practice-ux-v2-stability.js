(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const STOP_EPSILON = 0.005;
  let stopBeforePointer = null;
  let guidedSummaryFrame = null;

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatPrice(value) {
    const number = toNumber(value);
    if (number === null) return "—";
    return `${number.toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}円`;
  }

  function currentStop() {
    if (typeof state === "undefined") return null;
    return toNumber(state.plan?.activeStop ?? state.guided?.pendingStop ?? (typeof els !== "undefined" ? els.stopPrice?.value : null));
  }

  function currentEntry() {
    if (typeof state === "undefined") return null;
    return toNumber(state.plan?.entry ?? state.guided?.pendingEntry ?? (typeof els !== "undefined" ? els.entryPrice?.value : null));
  }

  function writeActiveStop(value) {
    const stop = toNumber(value);
    if (stop === null || typeof state === "undefined") return;
    state.plan.activeStop = stop;
    if (state.guided) state.guided.pendingStop = stop;
    if (typeof els !== "undefined" && els.stopPrice) els.stopPrice.value = stop.toFixed(2);
  }

  function replaceSummaryToDropInternalObservers() {
    const current = document.getElementById("finishSummary");
    if (!current || current.dataset.practiceStable === "true") return current;
    const replacement = current.cloneNode(true);
    replacement.dataset.practiceStable = "true";
    current.replaceWith(replacement);
    if (typeof els !== "undefined") els.finishSummary = replacement;
    return replacement;
  }

  function renderAfterFinish() {
    setTimeout(() => window.KabutanePracticeV2?.renderScore?.(), 0);
  }

  function resetBeforeStart() {
    window.KabutanePracticeV2?.ensureAudit?.(true);
  }

  function feedbackNode() {
    const tools = document.getElementById("practiceChartTools");
    if (!tools) return null;
    let node = document.getElementById("practiceStopFeedback");
    if (!node) {
      node = document.createElement("p");
      node.id = "practiceStopFeedback";
      node.className = "practice-stop-feedback";
      node.setAttribute("aria-live", "polite");
      tools.appendChild(node);
    }
    return node;
  }

  function setStopFeedback(text, tone = "neutral") {
    const node = feedbackNode();
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
  }

  function stepLabels() {
    const mode = document.getElementById("practiceStopStep")?.value || "yen";
    const stop = currentStop();
    if (mode === "pct") return { down: "−0.1%", up: "＋0.1%", description: "現在のSLを0.1%ずつ動かす" };
    if (mode === "atr") return { down: "−0.25ATR", up: "＋0.25ATR", description: "値動き幅（ATR）の4分の1ずつ動かす" };
    const amount = stop !== null && stop < 100 ? "0.1円" : "1円";
    return { down: `−${amount}`, up: `＋${amount}`, description: `${amount}ずつ動かす` };
  }

  function syncStopControls() {
    const controls = document.querySelector(".practice-stop-controls");
    if (!controls || typeof state === "undefined") return;
    const down = controls.querySelector('[data-stop-adjust="down"]');
    const up = controls.querySelector('[data-stop-adjust="up"]');
    const labels = stepLabels();
    if (down) {
      down.textContent = labels.down;
      down.setAttribute("aria-label", `損切り価格を${labels.down.replace("−", "マイナス")}動かす`);
    }
    if (up) {
      up.textContent = labels.up;
      up.setAttribute("aria-label", `損切り価格を${labels.up.replace("＋", "プラス")}動かす`);
    }

    const stop = currentStop();
    const guidedLocked = state.guided?.mode === "guided" && Number(state.account?.shares || 0) > 0;
    if (down) down.disabled = stop === null || guidedLocked;
    if (up) up.disabled = stop === null;

    let context = document.getElementById("practiceStopContext");
    if (!context) {
      context = document.createElement("span");
      context.id = "practiceStopContext";
      context.className = "practice-stop-context";
      controls.insertAdjacentElement("afterend", context);
    }
    const entry = currentEntry();
    const distance = stop !== null && entry !== null && entry > 0 ? (stop / entry - 1) * 100 : null;
    context.textContent = stop === null
      ? "先に損切り価格を決めてね。"
      : `${formatPrice(stop)}${distance === null ? "" : `・買値から${distance.toFixed(2)}%`}・${labels.description}`;

    if (guidedLocked) {
      setStopFeedback("はじめてモードでは、購入後のSLは上へ引き上げられるけど、下へ遠ざけることはできないよ。", "guide");
    } else if (!feedbackNode()?.textContent) {
      setStopFeedback("ボタンを1回押すたびにSLが1段階動くよ。日足を進めても、設定したSLはそのまま維持するよ。", "neutral");
    }

    const help = document.querySelector(".practice-chart-help");
    if (help) help.innerHTML = "<b>価格帯↑／↓</b>はチャートの表示だけを移動するよ。<b>青いSLタグや青い点線の近く</b>を上下にドラッグするとSLを動かせるよ。ボタンなら選んだ刻みで1回ずつ正確に調整できるよ。";
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function registeredPlugin(id) {
    if (typeof Chart === "undefined") return null;
    try {
      return Chart.registry?.getPlugin?.(id) || Chart.registry?.plugins?.get?.(id) || null;
    } catch (_) {
      return null;
    }
  }

  function installLeftStopTag() {
    if (typeof Chart === "undefined" || window.__kabutaneStopTagV3) return;
    window.__kabutaneStopTagV3 = true;
    const previous = registeredPlugin("practiceStopHandleV2");
    if (previous) {
      try { Chart.unregister(previous); } catch (_) {}
    }

    const plugin = {
      id: "practiceStopHandleV3",
      afterDraw(chart) {
        const stop = currentStop();
        const scale = chart.scales?.y;
        const area = chart.chartArea;
        if (stop === null || !scale || !area || stop < scale.min || stop > scale.max) return;
        const rawY = scale.getPixelForValue(stop);
        const y = Math.max(area.top + 17, Math.min(area.bottom - 17, rawY));
        const label = `SL ${stop.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = "800 12px system-ui";
        const width = Math.max(84, ctx.measureText(label).width + 22);
        const x = Math.min(area.right - width - 6, area.left + 8);
        ctx.fillStyle = "#347fa8";
        roundedRectPath(ctx, x, y - 16, width, 32, 10);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + width, y - 5);
        ctx.lineTo(x + width + 8, y);
        ctx.lineTo(x + width, y + 5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + width / 2, y);
        ctx.restore();
      },
    };
    Chart.register(plugin);
    if (typeof state !== "undefined") state.chart?.draw?.();
  }

  function targetsAdvanced(before, after) {
    return after.some((value, index) => Boolean(value) && !Boolean(before[index]));
  }

  function installStopPersistence() {
    if (window.__kabutaneStopPersistenceV3 || typeof processAutomaticOrders !== "function") return;
    window.__kabutaneStopPersistenceV3 = true;
    const baseProcessAutomaticOrders = processAutomaticOrders;
    processAutomaticOrders = function processAutomaticOrdersWithLockedStop(row) {
      const beforeStop = currentStop();
      const beforeShares = Number(state.account?.shares || 0);
      const beforeTargets = [...(state.plan?.hitTargets || [])];
      if (beforeShares > 0 && beforeStop !== null) writeActiveStop(beforeStop);
      const result = baseProcessAutomaticOrders(row);
      const afterTargets = [...(state.plan?.hitTargets || [])];
      const trailedByTarget = targetsAdvanced(beforeTargets, afterTargets);
      if (beforeShares > 0 && Number(state.account?.shares || 0) > 0 && beforeStop !== null && !trailedByTarget) {
        const afterStop = currentStop();
        if (afterStop === null || Math.abs(afterStop - beforeStop) > STOP_EPSILON) {
          writeActiveStop(beforeStop);
          setStopFeedback(`日足を進めたために動いたSLを${formatPrice(beforeStop)}へ戻したよ。SLは明示的に操作した時だけ変更するよ。`, "protected");
        }
      }
      syncStopControls();
      return result;
    };
  }

  function guidedStopSummary() {
    const input = document.getElementById("guidedStopInput");
    if (!input || typeof state === "undefined") return;
    const priceBox = input.closest(".guided-sheet-price");
    if (!priceBox) return;
    let summary = document.getElementById("guidedStopDistance");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "guidedStopDistance";
      summary.className = "guided-stop-distance";
      priceBox.insertAdjacentElement("afterend", summary);
    }
    const entry = toNumber(state.guided?.pendingEntry ?? state.plan?.entry);
    const stop = toNumber(input.value ?? state.guided?.pendingStop);
    let text = "チャートで選ぶか、価格を入力してね。";
    let tone = "neutral";
    if (entry !== null && stop !== null && entry > 0) {
      const distance = (entry - stop) / entry * 100;
      if (stop >= entry) {
        text = `選択中 ${formatPrice(stop)}・買値${formatPrice(entry)}以上なので損切りにできないよ。`;
        tone = "danger";
      } else if (distance < 1) {
        text = `選択中 ${formatPrice(stop)}・買値から−${distance.toFixed(2)}%。かなり近く、小さな値動きでも損切りになりやすいよ。`;
        tone = "warning";
      } else if (distance > 15) {
        text = `選択中 ${formatPrice(stop)}・買値から−${distance.toFixed(2)}%。かなり遠いので、想定損失額を確認してね。`;
        tone = "warning";
      } else {
        text = `選択中 ${formatPrice(stop)}・買値から−${distance.toFixed(2)}%。この価格を確認してから進もう。`;
        tone = "good";
      }
      const confirm = document.querySelector('[data-guided-action="confirm-stop"]');
      if (confirm && stop < entry) confirm.textContent = `この損切り（${formatPrice(stop)}）で進む`;
    }
    if (summary.textContent !== text) summary.textContent = text;
    summary.dataset.tone = tone;
  }

  function scheduleGuidedStopSummary() {
    if (guidedSummaryFrame) return;
    guidedSummaryFrame = requestAnimationFrame(() => {
      guidedSummaryFrame = null;
      guidedStopSummary();
    });
  }

  function installSmallObservers() {
    const body = document.getElementById("guidedSheetBody");
    if (body && body.dataset.stopSummaryObserved !== "true") {
      body.dataset.stopSummaryObserved = "true";
      new MutationObserver(scheduleGuidedStopSummary).observe(body, { childList: true, subtree: true });
    }
  }

  function installRenderSync() {
    if (window.__kabutaneStopRenderSyncV3 || typeof renderAll !== "function") return;
    window.__kabutaneStopRenderSyncV3 = true;
    const baseRenderAll = renderAll;
    renderAll = function renderAllWithStopControls() {
      const result = baseRenderAll();
      queueMicrotask(() => {
        syncStopControls();
        scheduleGuidedStopSummary();
      });
      return result;
    };
  }

  function bindStopFeedback() {
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-stop-adjust]") || event.target.id === "replayChart") stopBeforePointer = currentStop();
    }, true);

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stop-adjust]");
      if (button) {
        const before = stopBeforePointer;
        setTimeout(() => {
          const after = currentStop();
          if (button.disabled) {
            setStopFeedback("この方向には動かせないよ。はじめてモードで購入した後は、SLを下げずに資金を守ろう。", "guide");
          } else if (before !== null && after !== null && Math.abs(after - before) > STOP_EPSILON) {
            const verb = after > before ? "引き上げた" : "引き下げた";
            setStopFeedback(`SLを${formatPrice(before)}から${formatPrice(after)}へ${verb}よ。次の日も${formatPrice(after)}を維持するよ。`, "success");
          } else {
            setStopFeedback("SLが動かなかったよ。買値との位置関係と、現在の練習モードを確認してね。", "warning");
          }
          syncStopControls();
        }, 0);
      }
      if (event.target.closest('[data-guided-action="confirm-stop"]')) setTimeout(syncStopControls, 0);
    });

    document.addEventListener("pointerup", (event) => {
      if (event.target.id !== "replayChart") return;
      const before = stopBeforePointer;
      setTimeout(() => {
        const after = currentStop();
        if (before !== null && after !== null && Math.abs(after - before) > STOP_EPSILON) {
          setStopFeedback(`チャート上でSLを${formatPrice(after)}へ変更したよ。日足を進めてもこの価格を維持するよ。`, "success");
          syncStopControls();
        }
      }, 0);
    });

    document.addEventListener("input", (event) => {
      if (event.target.id === "guidedStopInput") scheduleGuidedStopSummary();
      if (event.target.id === "stopPrice") setTimeout(syncStopControls, 0);
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "practiceStopStep") syncStopControls();
    });
  }

  function injectStyles() {
    if (document.getElementById("practiceStopV3Styles")) return;
    const style = document.createElement("style");
    style.id = "practiceStopV3Styles";
    style.textContent = `
      .practice-stop-controls button{min-width:112px}
      .practice-stop-controls button:disabled{opacity:.48;cursor:not-allowed;background:#f3edf1!important;color:#907b87!important}
      .practice-stop-context{display:block;margin:7px 0 0;color:#6d5664;font-size:.72rem;font-weight:800;line-height:1.45}
      .practice-stop-feedback{margin:9px 0 0;padding:10px 12px;border-radius:11px;background:#f8f4f7;color:#745d6b;font-size:.72rem;font-weight:750;line-height:1.55}
      .practice-stop-feedback[data-tone="success"],.practice-stop-feedback[data-tone="protected"]{background:#eef8f5;color:#376f62}
      .practice-stop-feedback[data-tone="warning"]{background:#fff7e7;color:#8a6224}
      .practice-stop-feedback[data-tone="guide"]{background:#f2effb;color:#66538b}
      .guided-stop-distance{margin:8px 0 12px;padding:10px 12px;border-radius:12px;background:#f7f3f6;color:#735c69;font-size:.76rem;font-weight:800;line-height:1.55}
      .guided-stop-distance[data-tone="good"]{background:#edf8f4;color:#367060}
      .guided-stop-distance[data-tone="warning"]{background:#fff6df;color:#835e20}
      .guided-stop-distance[data-tone="danger"]{background:#fff0f1;color:#9a3f4b}
      @media(max-width:520px){.practice-stop-controls{grid-template-columns:minmax(0,1fr) minmax(88px,.72fr) minmax(0,1fr)!important}.practice-stop-controls button{min-width:0;padding-inline:8px;font-size:.9rem}.practice-stop-context,.practice-stop-feedback{font-size:.69rem}}
    `;
    document.head.appendChild(style);
  }

  function init() {
    replaceSummaryToDropInternalObservers();
    injectStyles();
    installLeftStopTag();
    installStopPersistence();
    installRenderSync();
    installSmallObservers();
    bindStopFeedback();
    syncStopControls();
    scheduleGuidedStopSummary();
    document.getElementById("startSessionButton")?.addEventListener("click", resetBeforeStart, true);
    document.getElementById("finishButton")?.addEventListener("click", renderAfterFinish, true);
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-guided-action="finish"]')) renderAfterFinish();
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
