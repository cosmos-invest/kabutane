CONDITION_LABELS.officialCosmos = "🌸コスモス注目";
PURPOSES.cosmos = ["officialCosmos"];
CONDITION_TESTS.officialCosmos = (row) => row.cosmos_focus === true;

const originalFitConditionsForCosmos = fitConditions;
fitConditions = function fitConditionsWithoutOfficialLabel(row) {
  return originalFitConditionsForCosmos(row).filter((condition) => condition !== "officialCosmos");
};

renderCards = function renderCardsWithOfficialCosmos(rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / simpleState.pageSize));
  simpleState.page = Math.min(simpleState.page, totalPages);
  const start = (simpleState.page - 1) * simpleState.pageSize;
  const pageRows = rows.slice(start, start + simpleState.pageSize);

  els.candidateGrid.innerHTML = pageRows.map((row, index) => {
    const conditions = fitConditions(row);
    const rank = start + index + 1;
    const returnValue = finite(row.return_since_gc_pct);
    const highDistance = finite(row.high52_distance_pct);
    const officialLabel = row.cosmos_focus === true
      ? '<span class="simple-badge official-cosmos">🌸コスモス注目</span>'
      : "";
    return `<article class="candidate-card">
      <div class="candidate-rank">${rank}</div>
      <div class="candidate-main">
        <div class="candidate-title-row">
          <div><span class="candidate-code">${escapeHtml(row.code)}</span><h3>${escapeHtml(row.name)}</h3></div>
          <div class="candidate-labels">${officialLabel}${statusBadge(row)}</div>
        </div>
        <div class="fit-row" aria-label="適合条件">
          ${conditions.map((condition) => `<span class="fit-badge ${condition}">${escapeHtml(CONDITION_LABELS[condition])}</span>`).join("")}
        </div>
        <div class="candidate-metrics">
          <div><span>RSI5</span><strong>${number(row.rsi5)}</strong></div>
          <div><span>52週高値距離</span><strong class="${metricClass(highDistance)}">${signed(highDistance)}</strong></div>
          <div><span>GC後騰落</span><strong class="${metricClass(returnValue)}">${signed(returnValue)}</strong></div>
        </div>
        <div class="candidate-footer">
          <small>条件一致 ${conditions.length}/6</small>
          <a class="button detail-button" href="detail.html?code=${encodeURIComponent(row.code)}">詳しく見る</a>
        </div>
      </div>
    </article>`;
  }).join("") || `<div class="simple-empty-state"><strong>条件に合う銘柄がありません</strong><p>条件を1つ外すか、「まずは基本」を選んでみてください。</p></div>`;

  els.pageInfo.textContent = `${simpleState.page} / ${totalPages}`;
  els.prevPage.disabled = simpleState.page <= 1;
  els.nextPage.disabled = simpleState.page >= totalPages;
};
