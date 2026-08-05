(() => {
  "use strict";

  const rows = document.getElementById("premiumRows");
  const empty = document.getElementById("premiumEmpty");
  const summary = document.getElementById("premiumSummary");
  const date = document.getElementById("premiumDataDate");
  const search = document.getElementById("premiumSearch");
  const scope = document.getElementById("premiumScope");
  const grade = document.getElementById("premiumGrade");
  let payload = null;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function pct(value, invert = false) {
    const number = finite(value);
    if (number === null) return "—";
    const shown = invert ? -number : number;
    return `${shown > 0 ? "+" : ""}${shown.toFixed(1)}%`;
  }

  function shares(value) {
    const number = finite(value);
    return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}株`;
  }

  function ratio(value) {
    const number = finite(value);
    return number === null ? "—" : `${number.toFixed(2)}倍`;
  }

  function gradeClass(value) {
    return value === "S" ? "grade-s" : value === "A" ? "grade-a" : "grade-b";
  }

  function scopeLabel(value) {
    if (value === "core") return "通常対象";
    if (value === "extended") return "拡張対象";
    return "未分類";
  }

  function scopeClass(value) {
    return value === "extended" ? "scope-chip extended" : "scope-chip";
  }

  function candidateHref(item) {
    const code = encodeURIComponent(item.code || "");
    return item.scope === "extended" ? `extended-universe.html?code=${code}` : `detail.html?code=${code}`;
  }

  function gradePass(itemGrade, filter) {
    if (filter === "all") return true;
    const rank = { S: 3, A: 2, B: 1 };
    return (rank[itemGrade] || 0) >= (rank[filter] || 0);
  }

  function renderSummary() {
    if (!payload || !summary) return;
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const sCount = candidates.filter((item) => item.grade === "S").length;
    const aCount = candidates.filter((item) => item.grade === "A").length;
    const cards = [
      ["信用残高を走査", `${Number(payload.screened_codes || 0).toLocaleString("ja-JP")}銘柄`],
      ["4週以上の比較可能", `${Number(payload.eligible_codes || 0).toLocaleString("ja-JP")}銘柄`],
      ["改善候補", `${Number(payload.candidate_count || 0).toLocaleString("ja-JP")}銘柄`],
      ["S / A候補", `${sCount} / ${aCount}`],
    ];
    summary.innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    if (date) date.textContent = payload.latest_date ? `基準日 ${payload.latest_date}` : "基準日 —";
  }

  function renderRows() {
    if (!payload || !rows) return;
    const query = String(search?.value || "").trim().toLowerCase();
    const scopeValue = scope?.value || "all";
    const gradeValue = grade?.value || "all";
    const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []).filter((item) => {
      if (scopeValue !== "all" && String(item.scope || "unknown") !== scopeValue) return false;
      if (!gradePass(String(item.grade || "B"), gradeValue)) return false;
      if (query) {
        const haystack = `${item.code || ""} ${item.name || ""} ${item.market || ""} ${item.sector || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    rows.innerHTML = candidates.map((item) => {
      const reasons = (Array.isArray(item.reasons) ? item.reasons : []).map((reason) => `<span>${reason}</span>`).join("");
      return `<tr>
        <td><span class="grade ${gradeClass(item.grade)}">${item.grade || "B"}</span></td>
        <td><a class="premium-stock-link" href="${candidateHref(item)}">${item.code || "—"} ${item.name || ""}<small>${item.market || item.instrument_type || ""}</small></a></td>
        <td><span class="${scopeClass(item.scope)}">${scopeLabel(item.scope)}</span></td>
        <td><span class="premium-score">${finite(item.score)?.toFixed(1) || "—"}</span><br><small>${shares(item.buy_balance)} / ${ratio(item.ratio)}</small></td>
        <td>${pct(item.buy_reduction_pct, true)}</td>
        <td>${pct(item.sell_change_pct)}</td>
        <td>${pct(item.ratio_reduction_pct, true)}</td>
        <td><div class="premium-reasons">${reasons || "—"}</div></td>
      </tr>`;
    }).join("");
    if (empty) empty.hidden = candidates.length > 0;
  }

  async function init() {
    try {
      const response = await fetch(`data/premium/supply-demand-screen.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status}`);
      payload = await response.json();
      renderSummary();
      renderRows();
    } catch (error) {
      if (date) date.textContent = "データ未生成";
      if (summary) summary.innerHTML = `<article><span>状態</span><strong>準備中</strong></article>`;
      if (empty) {
        empty.hidden = false;
        empty.textContent = `需給改善データを読み込めませんでした（${String(error.message || error)}）。`;
      }
    }
  }

  [search, scope, grade].forEach((element) => element?.addEventListener("input", renderRows));
  init();
})();
