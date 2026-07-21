(function installReplayPicker() {
  "use strict";

  if (typeof init !== "function") return;
  const originalInit = init;
  document.removeEventListener("DOMContentLoaded", originalInit);

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

  function populateSelect(records, selectedCode) {
    const select = document.getElementById("replaySymbolSelect");
    if (!select) return;
    const sorted = [...records].sort((a, b) => {
      if (Boolean(a.cosmos_focus) !== Boolean(b.cosmos_focus)) return a.cosmos_focus ? -1 : 1;
      if (a.status !== b.status) return a.status === "NEW" ? -1 : 1;
      return String(a.code).localeCompare(String(b.code), "ja");
    });
    select.innerHTML = sorted.map((row) => {
      const flags = `${row.cosmos_focus ? "🌸 " : ""}${row.status === "NEW" ? "NEW " : ""}`;
      return `<option value="${String(row.code).replace(/"/g, "&quot;")}">${flags}${row.code} ${row.name || ""}</option>`;
    }).join("");
    select.value = selectedCode;
    select.addEventListener("change", () => {
      const code = select.value;
      if (!code) return;
      localStorage.setItem("kabutaneReplayCode", code);
      window.location.href = `replay.html?code=${encodeURIComponent(code)}`;
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
