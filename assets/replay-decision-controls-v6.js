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
    window.addEventListener("beforeunload", () => window.clearInterval(timer), { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
