(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const finite = (value) => { const number = Number(value); return Number.isFinite(number) ? number : null; };
  const money = (value) => { const number = finite(value); return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`; };
  const pct = (value) => { const number = finite(value); return number === null ? "—" : `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`; };
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

  function scoreLabel(row) {
    if (finite(row.operationScore) !== null && Number(row.scoreVersion) >= 2) return `${Math.round(row.operationScore)}点`;
    return row.ruleTotal ? `${row.ruleAchieved}/${row.ruleTotal}` : "旧式";
  }

  function render() {
    const rows = PracticeHistoryCore.read();
    const summary = PracticeHistoryCore.summary(rows);
    const v2Scores = rows.map((row) => finite(row.operationScore)).filter((value) => value !== null);
    const averageScore = v2Scores.length ? v2Scores.reduce((sum, value) => sum + value, 0) / v2Scores.length : null;
    $("#historySummary").innerHTML = `
      <article><span>練習回数</span><strong>${summary.total}回</strong></article>
      <article><span>利益が出た練習</span><strong>${summary.profits}回</strong></article>
      <article><span>損切りを実行</span><strong>${summary.stops}回</strong></article>
      <article><span>運用実践スコア平均</span><strong>${averageScore === null ? "—" : `${averageScore.toFixed(0)}点`}</strong></article>`;

    $("#historyList").innerHTML = rows.map((row) => `
      <article class="history-card">
        <div class="history-card-head">
          <div><h3>${esc(row.name)} <small>(${esc(row.code)})</small></h3><small>${esc(row.startDate)}〜${esc(row.endDate)}｜${row.mode === "guided" ? "はじめてモード" : "自由練習"}</small></div>
          <button type="button" class="button ghost-button" data-delete-history="${esc(row.id)}">削除</button>
        </div>
        <div class="history-metrics">
          <div><span>総損益率</span><strong class="${finite(row.totalReturn) >= 0 ? "positive" : "negative"}">${pct(row.totalReturn)}</strong></div>
          <div><span>総損益</span><strong>${money(row.totalProfit)}</strong></div>
          <div><span>最大DD</span><strong>${pct(row.maxDrawdown)}</strong></div>
          <div><span>${Number(row.scoreVersion) >= 2 ? "運用実践スコア" : "旧ルール達成"}</span><strong>${scoreLabel(row)}</strong></div>
        </div>
        ${Number(row.scoreVersion) >= 2 ? `<p class="mini-dialogue">${esc(row.operationGrade || "")}｜タイミング加点 ${finite(row.timingBonus) ?? 0}/5｜損切りを遠ざけた ${row.audit?.stopWidened ? "あり" : "なし"}</p>` : ""}
        <p class="mini-dialogue">買い ${row.buyCount || 0}回 / 売り ${row.sellCount || 0}回｜終了理由 ${esc(row.outcome || "—")}</p>
      </article>`).join("") || '<div class="history-empty"><strong>まだ練習履歴がないよ</strong><p>売買練習を最後まで終えると、この端末へ自動保存されます。</p><a class="button" href="replay.html">はじめてモードで練習する</a></div>';
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-history]");
    if (!button) return;
    PracticeHistoryCore.remove(button.dataset.deleteHistory);
    render();
  });

  $("#historyExport").addEventListener("click", () => {
    const blob = new Blob([PracticeHistoryCore.exportText(PracticeHistoryCore.read())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kabutane-practice-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("#historyImport").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { PracticeHistoryCore.importText(await file.text()); render(); }
    catch (error) { alert(error.message || "読み込めませんでした。"); }
  });

  $("#historyClear").addEventListener("click", () => {
    if (confirm("この端末の練習履歴をすべて削除しますか？")) { PracticeHistoryCore.clear(); render(); }
  });

  render();
})();
