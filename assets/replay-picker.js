(function installReplayPicker() {
  "use strict";

  const RESULT_LIMIT = 8;

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
    const params = new URLSearchParams(window.location.search);
    const queryCode = params.get("code")?.trim();
    const saved = localStorage.getItem("kabutaneReplayCode");
    return records.find((row) => String(row.code) === String(queryCode))
      || records.find((row) => String(row.code) === String(saved))
      || records.find((row) => row.cosmos_focus === true && row.status === "NEW")
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

  function resultRank(row, query, selectedCode) {
    if (!query) {
      if (String(row.code) === String(selectedCode)) return 0;
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
      .map((row) => ({ ...row, __rank: resultRank(row, normalizedQuery, selectedCode) }))
      .filter((row) => row.__rank < 99)
      .sort((left, right) => left.__rank - right.__rank
        || Number(Boolean(right.cosmos_focus)) - Number(Boolean(left.cosmos_focus))
        || (left.status === "NEW" ? -1 : right.status === "NEW" ? 1 : 0)
        || String(left.code).localeCompare(String(right.code), "ja"))
      .slice(0, RESULT_LIMIT);
  }

  function replayUrl(code) {
    const url = new URL(window.location.href);
    url.searchParams.set("code", String(code));
    url.hash = "";
    return url.toString();
  }

  function openCode(code, input) {
    if (!code) return;
    localStorage.setItem("kabutaneReplayCode", String(code));
    if (input) {
      input.disabled = true;
      input.value = "読み込み中…";
    }
    window.location.assign(replayUrl(code));
  }

  function installPicker(records) {
    const select = document.getElementById("replaySymbolSelect");
    const setupGrid = document.querySelector("#setupPanel .setup-grid");
    if (!select || !setupGrid || document.getElementById("replaySymbolPicker")) return;

    const selected = preferredRecord(records);
    if (!selected) throw new Error("検索できる銘柄がありません");

    const params = new URLSearchParams(window.location.search);
    const currentCode = params.get("code")?.trim() || "";
    if (!currentCode || !records.some((row) => String(row.code) === String(currentCode))) {
      window.location.replace(replayUrl(selected.code));
      return;
    }

    // The legacy select remains in the DOM for compatibility, but contains only
    // the current stock. Rendering the full universe in a native Android select
    // is intentionally avoided because it can freeze the browser UI.
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = String(selected.code);
    option.textContent = recordLabel(selected);
    option.selected = true;
    select.appendChild(option);

    const originalLabel = select.closest("label");
    const picker = document.createElement("section");
    picker.id = "replaySymbolPicker";
    picker.className = "replay-symbol-picker-field";
    picker.setAttribute("aria-label", "練習する銘柄を検索");
    picker.innerHTML = `
      <div class="replay-symbol-picker-heading">
        <span class="replay-symbol-picker-label">練習する銘柄</span>
        <div class="replay-symbol-current" aria-live="polite"><span>選択中</span><strong id="replaySymbolCurrent">${escapeHtml(recordLabel(selected))}</strong></div>
      </div>
      <div class="replay-symbol-search-wrap">
        <input id="replaySymbolSearch" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="証券コード・会社名で検索" aria-controls="replaySymbolResults">
        <button id="replaySymbolClear" type="button" aria-label="検索文字を消す">×</button>
      </div>
      <p id="replaySymbolStatus" class="replay-symbol-status" aria-live="polite">おすすめと選択中の銘柄を表示しているよ。</p>
      <div id="replaySymbolResults" class="replay-symbol-results" role="listbox"></div>
      <small>全銘柄を検索できるよ。スマホが固まらないよう、画面に出す候補は最大${RESULT_LIMIT}件だけ。</small>`;

    (originalLabel || setupGrid.firstElementChild)?.insertAdjacentElement("afterend", picker);
    if (originalLabel) originalLabel.hidden = true;

    const input = document.getElementById("replaySymbolSearch");
    const clear = document.getElementById("replaySymbolClear");
    const results = document.getElementById("replaySymbolResults");
    const status = document.getElementById("replaySymbolStatus");
    if (!input || !results) return;

    function renderResults(query = "") {
      const visible = matchingRecords(records, query, selected.code);
      results.innerHTML = visible.length
        ? visible.map((row) => `
            <button type="button" role="option" data-replay-code="${escapeHtml(row.code)}"${String(row.code) === String(selected.code) ? ' aria-current="true"' : ""}>
              <span>${row.cosmos_focus ? "🌸" : row.status === "NEW" ? "NEW" : "銘柄"}</span>
              <strong>${escapeHtml(row.code)}</strong>
              <b>${escapeHtml(row.name || "")}</b>
              <em>${String(row.code) === String(selected.code) ? "選択中" : "変更"}</em>
            </button>`).join("")
        : `<p class="replay-symbol-empty">該当する銘柄が見つからないよ。コードか会社名の一部を変えてみてね。</p>`;
      if (status) status.textContent = query
        ? `${visible.length}件の候補を表示中。銘柄をタップするとページを切り替えるよ。`
        : "おすすめと選択中の銘柄を表示しているよ。";
    }

    input.addEventListener("input", () => renderResults(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const first = results.querySelector("[data-replay-code]");
      if (!first) return;
      event.preventDefault();
      openCode(first.dataset.replayCode, input);
    });
    clear?.addEventListener("click", () => {
      input.value = "";
      renderResults("");
      input.focus();
    });
    results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-replay-code]");
      if (!button) return;
      openCode(button.dataset.replayCode, input);
    });

    renderResults("");
  }

  async function bootPicker() {
    try {
      const records = await loadCandidates();
      installPicker(records);
    } catch (error) {
      console.warn("Kabutane replay picker failed:", error);
      const notice = document.getElementById("setupNotice");
      if (notice) notice.textContent = `銘柄検索だけ読み込めませんでした。現在の銘柄では練習できるよ：${error.message}`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootPicker, { once: true });
  else bootPicker();
})();
