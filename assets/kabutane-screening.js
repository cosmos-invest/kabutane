(() => {
  CONDITION_LABELS.officialCosmos = "🌸コスモス注目";
  PURPOSES.cosmos = ["officialCosmos"];
  CONDITION_TESTS.officialCosmos = (row) => row.cosmos_focus === true;

  Object.assign(CONDITION_LABELS, {
    rsi: "月足の勢い",
    sepa: "上昇トレンド",
    vcp: "値動きの収束",
    mvp: "勢いの点火",
    high: "高値への近さ",
    finance: "財務の安定",
  });

  const originalFitConditions = fitConditions;
  fitConditions = function fitConditionsWithoutOfficialLabel(row) {
    return originalFitConditions(row).filter((condition) => condition !== "officialCosmos");
  };

  function setPracticeDestination(rows) {
    const preferred = rows.find((row) => row.cosmos_focus === true && row.status === "NEW")
      || rows.find((row) => row.cosmos_focus === true)
      || rows.find((row) => row.status === "NEW")
      || rows[0]
      || simpleState.rows[0];
    if (!preferred?.code) return;
    const href = `replay.html?code=${encodeURIComponent(preferred.code)}`;
    localStorage.setItem("kabutaneReplayCode", String(preferred.code));
    ["homePracticeLink", "navPracticeLink"].forEach((id) => {
      const link = document.getElementById(id);
      if (link) link.href = href;
    });
  }

  renderCards = function renderKabutaneCards(rows) {
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
      const code = encodeURIComponent(row.code);
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
            <div><span>月足RSI14</span><strong>${number(row.rsi14)}</strong></div>
            <div><span>52週高値距離</span><strong class="${metricClass(highDistance)}">${signed(highDistance)}</strong></div>
            <div><span>シグナル後</span><strong class="${metricClass(returnValue)}">${signed(returnValue)}</strong></div>
          </div>
          <div class="candidate-footer">
            <small>当てはまる特徴 ${conditions.length}/6</small>
            <div class="candidate-actions">
              <a class="button detail-button" href="detail.html?code=${code}">詳しく見る</a>
              <a class="button practice-button" href="replay.html?code=${code}">この銘柄で練習</a>
            </div>
          </div>
        </div>
      </article>`;
    }).join("") || `<div class="simple-empty-state"><strong>条件に合う銘柄がありません</strong><p>条件を1つ外すか、「まずは基本」を選んでみてください。</p></div>`;

    els.pageInfo.textContent = `${simpleState.page} / ${totalPages}`;
    els.prevPage.disabled = simpleState.page <= 1;
    els.nextPage.disabled = simpleState.page >= totalPages;
    setPracticeDestination(rows);
  };
})();
