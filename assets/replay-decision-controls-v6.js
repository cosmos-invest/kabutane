(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function stateRef() {
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }

  function currentRowSafe() {
    try { return typeof currentRow === "function" ? currentRow() : null; } catch (_) { return null; }
  }

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatPrice(value) {
    const number = finite(value);
    return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`;
  }

  function clickButton(selector) {
    const button = document.querySelector(selector);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function runAction(action) {
    if (action === "step-one") {
      if (!clickButton('#guidedActionArea [data-guided-action="step-one"]')) clickButton("#stepOneButton");
      return;
    }
    if (action === "step-five") {
      if (!clickButton('#guidedActionArea [data-guided-action="step-five"]')) clickButton("#stepFiveButton");
      return;
    }
    if (action === "choose-entry") {
      clickButton('#guidedActionArea [data-guided-action="choose-entry"]');
      return;
    }
    if (action === "finish") clickButton("#finishButton");
  }

  function ensureControlStyle() {
    if (document.getElementById("replayDecisionControlStyleV6")) return;
    const style = document.createElement("style");
    style.id = "replayDecisionControlStyleV6";
    style.textContent = `
      .replay-advanced-tools-v6{order:-1;border:1px solid #eadbe3;border-radius:11px;background:rgba(255,255,255,.74)}
      .replay-advanced-tools-v6>summary{min-height:34px;display:flex;align-items:center;padding:6px 9px;list-style:none;cursor:pointer;color:#765f6d;font-size:.66rem;font-weight:900}
      .replay-advanced-tools-v6>summary::-webkit-details-marker{display:none}.replay-advanced-tools-v6>summary:after{content:"＋";margin-left:auto;color:#a6688e}.replay-advanced-tools-v6[open]>summary:after{content:"−"}
      .replay-advanced-tools-body-v6{display:grid;gap:7px;padding:0 7px 7px}.replay-advanced-tools-body-v6 #chartViewportToolbar,.replay-advanced-tools-body-v6 #practiceChartTools{margin:0!important}
      @media(max-width:760px){.replay-advanced-tools-v6>summary{min-height:32px;font-size:.62rem}.replay-advanced-tools-body-v6{max-height:46vh;overflow:auto}.replay-advanced-tools-body-v6 #chartViewportToolbar{padding:5px!important}.replay-advanced-tools-body-v6 #practiceChartTools{padding:6px!important}}
    `;
    document.head.appendChild(style);
  }

  function compactMonthlyChart() {
    if (window.innerWidth > 760) return;
    const box = document.getElementById("monthlyRsiChart")?.closest(".monthly-rsi-chart-box");
    const canvas = document.getElementById("monthlyRsiChart");
    if (!box || !canvas || canvas.dataset.decisionCompactV6 === "true") return;
    box.style.setProperty("height", "175px", "important");
    box.style.setProperty("min-height", "175px", "important");
    box.style.setProperty("max-height", "175px", "important");
    canvas.style.setProperty("height", "159px", "important");
    canvas.style.setProperty("min-height", "0", "important");
    canvas.style.setProperty("max-height", "159px", "important");
    canvas.style.setProperty("width", "100%", "important");
    canvas.dataset.decisionCompactV6 = "true";
    window.requestAnimationFrame(() => {
      try { window.Chart?.getChart?.("monthlyRsiChart")?.resize(); } catch (_) {}
    });
  }

  function compactSecondaryTools() {
    const main = document.querySelector(".replay-decision-main-v6");
    if (!main) return;
    const tools = [document.getElementById("chartViewportToolbar"), document.getElementById("practiceChartTools")].filter(Boolean);
    if (!tools.length) return;
    ensureControlStyle();
    let details = document.getElementById("replayAdvancedToolsV6");
    if (!details) {
      details = document.createElement("details");
      details.id = "replayAdvancedToolsV6";
      details.className = "replay-advanced-tools-v6";
      details.innerHTML = '<summary>詳細なチャート操作</summary><div class="replay-advanced-tools-body-v6"></div>';
      const chartSettings = document.getElementById("replayChartSettingsV6");
      if (chartSettings?.nextSibling) main.insertBefore(details, chartSettings.nextSibling);
      else main.prepend(details);
    }
    const body = details.querySelector(".replay-advanced-tools-body-v6");
    tools.forEach((tool) => {
      if (tool.parentElement !== body) body.appendChild(tool);
    });
  }

  function hideEmptyLegacyIndicatorPanel() {
    const details = document.getElementById("unifiedIndicatorDetails");
    if (!details) return;
    const body = document.getElementById("unifiedIndicatorBody");
    const hasMeaningfulContent = Boolean(body?.querySelector(".indicator-controls,.monthly-rsi-chart-box,.oscillator-chart-box,canvas"));
    if (!hasMeaningfulContent) {
      details.hidden = true;
      details.style.setProperty("display", "none", "important");
      details.setAttribute("aria-hidden", "true");
    }
  }

  function ensureControls() {
    const dock = document.getElementById("replayDecisionDockV6");
    if (!dock) return null;
    const source = dock.querySelector(".playback-controls");
    if (source) source.classList.add("playback-controls-v6-source");

    let controls = dock.querySelector(".replay-decision-actions-v6");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "replay-decision-actions-v6";
      controls.innerHTML = `
        <button type="button" class="primary" data-decision-action="step-one">1日 ▶</button>
        <button type="button" data-decision-action="step-five">5日 ▶▶</button>
        <button type="button" class="entry" data-decision-action="choose-entry" hidden>ここで入りたい</button>
        <button type="button" class="finish" data-decision-action="finish">終了</button>`;
      controls.addEventListener("click", (event) => {
        const button = event.target.closest("[data-decision-action]");
        if (!button || button.disabled) return;
        runAction(button.dataset.decisionAction);
      });
      dock.appendChild(controls);
    }
    return controls;
  }

  function sync() {
    const practice = document.getElementById("practiceArea");
    if (!practice || practice.hidden) return;
    compactMonthlyChart();
    compactSecondaryTools();
    hideEmptyLegacyIndicatorPanel();
    const controls = ensureControls();
    if (!controls) return;

    const s = stateRef();
    const guide = s?.guided || null;
    const guided = guide?.mode === "guided" || document.body.classList.contains("guided-replay-mode");
    const choose = controls.querySelector('[data-decision-action="choose-entry"]');
    const guidedChoose = document.querySelector('#guidedActionArea [data-guided-action="choose-entry"]');
    if (choose) {
      const available = Boolean(guided && guide?.step === "seek-entry" && guidedChoose && !guidedChoose.disabled);
      choose.hidden = !available;
      choose.disabled = !available;
    }

    const sourceStepOne = document.getElementById("stepOneButton");
    const sourceStepFive = document.getElementById("stepFiveButton");
    const sourceFinish = document.getElementById("finishButton");
    const guidedStepOne = document.querySelector('#guidedActionArea [data-guided-action="step-one"]');
    const guidedStepFive = document.querySelector('#guidedActionArea [data-guided-action="step-five"]');
    const stepOne = controls.querySelector('[data-decision-action="step-one"]');
    const stepFive = controls.querySelector('[data-decision-action="step-five"]');
    const finish = controls.querySelector('[data-decision-action="finish"]');
    if (stepOne) stepOne.disabled = guided ? !guidedStepOne || guidedStepOne.disabled : Boolean(sourceStepOne?.disabled);
    if (stepFive) stepFive.disabled = guided ? !guidedStepFive || guidedStepFive.disabled : Boolean(sourceStepFive?.disabled);
    if (finish) finish.disabled = Boolean(sourceFinish?.disabled);

    const row = currentRowSafe();
    const date = document.getElementById("replayDecisionDateV6");
    const price = document.getElementById("replayDecisionPriceV6");
    if (date && row?.date) date.textContent = String(row.date);
    if (price) price.textContent = formatPrice(row?.close);
  }

  function boot() {
    sync();
    const timer = window.setInterval(sync, 300);
    window.addEventListener("resize", compactMonthlyChart);
    window.addEventListener("beforeunload", () => window.clearInterval(timer), { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
