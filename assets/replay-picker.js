(function installReplayPicker() {
  "use strict";

  if (typeof init !== "function") return;
  const originalInit = init;
  const RESULT_LIMIT = 24;
  document.removeEventListener("DOMContentLoaded", originalInit);

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
      .replace(/[\s　]+/gu, "");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function recordLabel(row) {
    const flags = `${row?.cosmos_focus ? "🌸 " : ""}${row?.status === "NEW" ? "NEW " : ""}`;
    return `${flags}${row?.code || ""} ${row?.name || ""}`.trim();
  }

  function preferredRecord(records) {
    const saved = localStorage.getItem("kabutaneReplayCode");
    const savedRecord = records.find((row) => String(row.code) === saved);
    if (savedRecord) return savedRecord;
    return records.find((row) => row.cosmos_focus === true && row.status === "NEW")
      || records.find((row) => row.cosmos_focus === true)
      || records.find((row) => row.status === "NEW")
      || records[0]
      || null;
  }

  async function loadCandidates() {
    const response = await fetch(`data/latest.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`候補一覧の読込に失敗しました (${response.status})`);
    const payload = await response.json();
    return (payload.records || []).filter((row) => row && row.code);
  }

  function resultRank(row, query) {
    if (!query) {
      if (row.__selected) return 0;
      if (row.cosmos_focus && row.status === "NEW") return 1;
      if (row.cosmos_focus) return 2;
      if (row.status === "NEW") return 3;
      return 4;
    }
    const code = normalize(row.code);
    const name = normalize(row.name);
    if (code === query) return 0;
    if (code.startsWith(query)) return 1;
    if (name.startsWith(query)) return 2;
    if (code.includes(query)) return 3;
    if (name.includes(query)) return 4;
    return 99;
  }

  function matchingRecords(records, query, selectedCode) {
    const normalizedQuery = normalize(query);
    return records
      .map((row) => ({ ...row, __selected: String(row.code) === String(selectedCode), __rank: resultRank(row, normalizedQuery) }))
      .filter((row) => row.__rank < 99)
      .sort((left, right) => left.__rank - right.__rank
        || Number(Boolean(right.cosmos_focus)) - Number(Boolean(left.cosmos_focus))
        || (left.status === "NEW" ? -1 : right.status === "NEW" ? 1 : 0)
        || String(left.code).localeCompare(String(right.code), "ja"))
      .slice(0, RESULT_LIMIT);
  }

  function replayUrl(code) {
    const url = new URL(window.location.href);
    url.searchParams.set("code", code);
    url.hash = "";
    return url.toString();
  }

  function populateSelect(records, selectedCode) {
    const select = document.getElementById("replaySymbolSelect");
    if (!select) return;
    const selected = records.find((row) => String(row.code) === String(selectedCode)) || preferredRecord(records);

    // Keep the original select available to the legacy replay code, but never ask
    // a mobile browser to render more than a thousand native options.
    select.innerHTML = selected ? `<option value="${escapeHtml(selected.code)}">${escapeHtml(recordLabel(selected))}</option>` : "";
    select.value = selected ? String(selected.code) : "";
    const originalLabel = select.closest("label");
    if (originalLabel) originalLabel.hidden = true;

    let picker = document.getElementById("replaySymbolPicker");
    if (!picker) {
      picker = document.createElement("div");
      picker.id = "replaySymbolPicker";
      picker.className = "replay-symbol-picker-field";
      picker.innerHTML = `
        <span class="replay-symbol-picker-label">練習する銘柄</span>
        <div class="replay-symbol-current" aria-live="polite">
          <span>選択中</span><strong id="replaySymbolCurrent">—</strong>
        </div>
        <div class="replay-symbol-search-wrap">
          <input id="replaySymbolSearch" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="証券コード・会社名で検索" aria-controls="replaySymbolResults" aria-expanded="false">
          <button id="replaySymbolClear" type="button" aria-label="検索文字を消す">×</button>
        </div>
        <div id="replaySymbolResults" class="replay-symbol-results" role="listbox" hidden></div>
        <small>全銘柄から検索できるよ。表示候補はスマホが固まらないよう最大${RESULT_LIMIT}件に絞っているよ。</small>`;
      (originalLabel || select).insertAdjacentElement("afterend", picker);
    }

    const current = document.getElementById("replaySymbolCurrent");
    const input = document.getElementById("replaySymbolSearch");
    const clear = document.getElementById("replaySymbolClear");
    const results = document.getElementById("replaySymbolResults");
    if (!input || !results) return;
    if (current) current.textContent = selected ? recordLabel(selected) : "未選択";

    let activeIndex = -1;
    let visible = [];

    function closeResults() {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }

    function setActive(index) {
      const buttons = [...results.querySelectorAll("[data-replay-code]")];
      if (!buttons.length) return;
      activeIndex = Math.max(0, Math.min(index, buttons.length - 1));
      buttons.forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === activeIndex));
      buttons[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function openCode(code) {
      if (!code) return;
      localStorage.setItem("kabutaneReplayCode", String(code));
      input.disabled = true;
      input.value = "読み込み中…";
      window.location.assign(replayUrl(String(code)));
    }

    function renderResults(query = "") {
      visible = matchingRecords(records, query, selected?.code || selectedCode);
      results.innerHTML = visible.length
        ? visible.map((row) => `<button type="button" role="option" data-replay-code="${escapeHtml(row.code)}"><span>${row.cosmos_focus ? "🌸" : row.status === "NEW" ? "NEW" : "銘柄"}</span><strong>${escapeHtml(row.code)}</strong><b>${escapeHtml(row.name || "")}</b></button>`).join("")
        : `<p class="replay-symbol-empty">該当する銘柄が見つからないよ。コードか会社名の一部を変えてみてね。</p>`;
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
      activeIndex = -1;
    }

    input.addEventListener("focus", () => renderResults(input.value));
    input.addEventListener("input", () => renderResults(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (results.hidden) renderResults(input.value);
        setActive(activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(activeIndex <= 0 ? visible.length - 1 : activeIndex - 1);
      } else if (event.key === "Enter") {
        const code = results.querySelectorAll("[data-replay-code]")[activeIndex]?.dataset.replayCode || visible[0]?.code;
        if (code) {
          event.preventDefault();
          openCode(code);
        }
      } else if (event.key === "Escape") closeResults();
    });
    clear?.addEventListener("click", () => {
      input.value = "";
      input.focus();
      renderResults("");
    });
    results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-replay-code]");
      if (button) openCode(button.dataset.replayCode);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!picker.contains(event.target)) closeResults();
    });
  }

  async function initWithCandidate() {
    let records = [];
    try {
      records = await loadCandidates();
      const params = new URLSearchParams(window.location.search);
      let code = params.get("code")?.trim() || "";
      if (!code || !records.some((row) => String(row.code) === code)) {
        code = preferredRecord(records)?.code || "";
        if (code) {
          params.set("code", code);
          history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
        }
      }
      if (code) localStorage.setItem("kabutaneReplayCode", code);
      await originalInit();
      populateSelect(records, state.code || code);
    } catch (error) {
      await originalInit();
      const notice = document.getElementById("setupNotice");
      if (notice && !state.code) notice.textContent = `練習する銘柄を準備できませんでした：${error.message}`;
    }
  }

  document.addEventListener("DOMContentLoaded", initWithCandidate);
})();