(function (root) {
  "use strict";

  function monthKey(value) {
    return String(value || "").slice(0, 7);
  }

  function findNextMonthEndIndex(rows, cursor) {
    if (!Array.isArray(rows) || !rows.length) return -1;
    const safeCursor = Math.max(0, Math.min(Number(cursor) || 0, rows.length - 1));
    if (safeCursor >= rows.length - 1) return safeCursor;

    const currentMonth = monthKey(rows[safeCursor]?.date);
    let index = safeCursor + 1;

    while (index < rows.length && monthKey(rows[index]?.date) === currentMonth) index += 1;
    if (index - 1 > safeCursor) return index - 1;

    if (index >= rows.length) return safeCursor;
    const nextMonth = monthKey(rows[index]?.date);
    while (index + 1 < rows.length && monthKey(rows[index + 1]?.date) === nextMonth) index += 1;
    return index;
  }

  const api = { monthKey, findNextMonthEndIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReplayMonthEnd = api;

  if (typeof document === "undefined") return;

  function getReplayState() {
    return typeof state !== "undefined" ? state : null;
  }

  function canUseReplayFunctions() {
    return typeof advanceOne === "function" && typeof renderAll === "function" && typeof stopPlayback === "function";
  }

  function buttonMarkup(id, label, className) {
    return `<button id="${id}" class="${className}" type="button">${label}</button>`;
  }

  function injectButtons() {
    const desktop = document.querySelector(".playback-controls");
    if (desktop && !document.getElementById("skipMonthEndButton")) {
      const finish = document.getElementById("finishButton");
      const holder = document.createElement("div");
      holder.innerHTML = buttonMarkup("skipMonthEndButton", "次の月末へ", "button secondary month-end-skip-button");
      const button = holder.firstElementChild;
      if (finish) desktop.insertBefore(button, finish);
      else desktop.appendChild(button);
    }

    const mobile = document.querySelector(".mobile-terminal-nav");
    if (mobile && !document.getElementById("mobileMonthEndButton")) {
      const holder = document.createElement("div");
      holder.innerHTML = buttonMarkup("mobileMonthEndButton", "月末へ", "month-end-mobile-button");
      const button = holder.firstElementChild;
      const play = document.getElementById("mobilePlayButton");
      if (play?.nextSibling) mobile.insertBefore(button, play.nextSibling);
      else mobile.appendChild(button);
    }

    if (!document.getElementById("monthEndSkipStyle")) {
      const style = document.createElement("style");
      style.id = "monthEndSkipStyle";
      style.textContent = `
        .month-end-skip-button { white-space: nowrap; }
        @media (max-width: 680px) {
          .mobile-terminal-nav { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; }
          .month-end-mobile-button { min-width: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  function updateButtons() {
    const replayState = getReplayState();
    const disabled = !replayState
      || replayState.ended
      || !Array.isArray(replayState.rows)
      || replayState.cursor >= replayState.rows.length - 1
      || document.getElementById("practiceArea")?.hidden;
    ["skipMonthEndButton", "mobileMonthEndButton"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = Boolean(disabled);
    });
  }

  function skipToNextMonthEnd() {
    const replayState = getReplayState();
    if (!replayState || !canUseReplayFunctions()) return;
    const target = findNextMonthEndIndex(replayState.rows, replayState.cursor);
    if (target < 0 || target <= replayState.cursor) {
      updateButtons();
      return;
    }

    stopPlayback();
    while (replayState.cursor < target) {
      if (!advanceOne()) break;
    }
    renderAll();

    const date = replayState.rows[replayState.cursor]?.date || "月末";
    if (typeof message === "function") {
      message(`${date}まで進めました。途中の利確・損切り・自動注文も、日足順に判定しています。`);
    }
    updateButtons();
  }

  function bind() {
    injectButtons();
    ["skipMonthEndButton", "mobileMonthEndButton"].forEach((id) => {
      const button = document.getElementById(id);
      if (button && button.dataset.bound !== "true") {
        button.dataset.bound = "true";
        button.addEventListener("click", skipToNextMonthEnd);
      }
    });

    const date = document.getElementById("currentDate");
    if (date && !date.dataset.monthEndObserved) {
      date.dataset.monthEndObserved = "true";
      new MutationObserver(updateButtons).observe(date, { childList: true, characterData: true, subtree: true });
    }
    const practice = document.getElementById("practiceArea");
    if (practice && !practice.dataset.monthEndObserved) {
      practice.dataset.monthEndObserved = "true";
      new MutationObserver(updateButtons).observe(practice, { attributes: true, attributeFilter: ["hidden"] });
    }
    updateButtons();
  }

  function init() {
    bind();
    let attempts = 0;
    const timer = setInterval(() => {
      bind();
      attempts += 1;
      if ((document.getElementById("skipMonthEndButton") && document.getElementById("mobileMonthEndButton")) || attempts >= 30) {
        clearInterval(timer);
      }
    }, 100);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);
