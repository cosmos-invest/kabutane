(function replayStockSelect() {
  "use strict";

  const RESULT_LIMIT = 20;
  let records = [];
  let filter = "all";

  function normalize(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s　]+/gu, "");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function selectedCode() {
    return new URLSearchParams(location.search).get("selected")?.trim()
      || localStorage.getItem("kabutaneReplayCode")
      || "";
  }

  function rank(row, query, selected) {
    if (!query) {
      if (String(row.code) === String(selected)) return 0;
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

  function matchesFilter(row) {
    if (filter === "focus") return row.cosmos_focus === true;
    if (filter === "new") return row.status === "NEW";
    return true;
  }

  function results(query) {
    const normalizedQuery = normalize(query);
    const selected = selectedCode();
    return records
      .filter(matchesFilter)
      .map((row) => ({ ...row, __rank: rank(row, normalizedQuery, selected) }))
      .filter((row) => row.__rank < 99)
      .sort((left, right) => left.__rank - right.__rank
        || Number(Boolean(right.cosmos_focus)) - Number(Boolean(left.cosmos_focus))
        || (left.status === "NEW" ? -1 : right.status === "NEW" ? 1 : 0)
        || String(left.code).localeCompare(String(right.code), "ja"))
      .slice(0, RESULT_LIMIT);
  }

  function replayUrl(code) {
    const url = new URL("replay.html", location.href);
    url.searchParams.set("code", String(code));
    return url.toString();
  }

  function render() {
    const input = document.getElementById("replayStockSearch");
    const status = document.getElementById("replayStockStatus");
    const holder = document.getElementById("replayStockResults");
    if (!input || !status || !holder) return;
    const visible = results(input.value);
    const selected = selectedCode();
    holder.innerHTML = visible.length
      ? visible.map((row) => `
          <a class="replay-stock-result" href="${replayUrl(row.code)}" data-replay-code="${escapeHtml(row.code)}"${String(row.code) === String(selected) ? ' aria-current="true"' : ""}>
            <span>${row.cosmos_focus ? "🌸" : row.status === "NEW" ? "NEW" : "銘柄"}</span>
            <strong>${escapeHtml(row.code)}</strong>
            <b>${escapeHtml(row.name || "")}</b>
            <em>${String(row.code) === String(selected) ? "選択中" : "練習する"}</em>
          </a>`).join("")
      : '<div class="replay-stock-empty">該当する銘柄が見つからないよ。検索文字か絞り込みを変えてみてね。</div>';
    const filterLabel = filter === "focus" ? "コスモス注目" : filter === "new" ? "NEW" : "全銘柄";
    status.textContent = `${filterLabel}から${visible.length}件を表示中。会社をタップすると練習画面へ進むよ。`;
  }

  async function init() {
    const input = document.getElementById("replayStockSearch");
    const clear = document.getElementById("replayStockClear");
    const status = document.getElementById("replayStockStatus");
    try {
      const response = await fetch(`data/latest.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      records = (payload.records || []).filter((row) => row && row.code);
      input.disabled = false;
      input.addEventListener("input", render);
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const first = document.querySelector("#replayStockResults [data-replay-code]");
        if (!first) return;
        event.preventDefault();
        first.click();
      });
      clear?.addEventListener("click", () => { input.value = ""; input.focus(); render(); });
      document.querySelectorAll("[data-stock-filter]").forEach((button) => button.addEventListener("click", () => {
        filter = button.dataset.stockFilter;
        document.querySelectorAll("[data-stock-filter]").forEach((node) => node.classList.toggle("active", node === button));
        render();
      }));
      document.addEventListener("click", (event) => {
        const link = event.target.closest("[data-replay-code]");
        if (link) localStorage.setItem("kabutaneReplayCode", link.dataset.replayCode);
      });
      render();
      input.focus({ preventScroll: true });
    } catch (error) {
      status.textContent = `銘柄一覧を読み込めなかったよ。通信を確認して再読み込みしてね。（${error.message}）`;
      status.classList.add("negative");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
