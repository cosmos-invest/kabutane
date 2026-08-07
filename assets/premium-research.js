(() => {
  "use strict";

  const hot = document.getElementById("premiumHotMovers");
  const status = document.getElementById("premiumResearchStatus");
  const portfolio = document.getElementById("premiumPortfolioValidation");
  const buckets = document.getElementById("premiumBucketValidation");
  const experiments = document.getElementById("premiumWeightExperiments");

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function signed(value, suffix = "%", digits = 2) {
    const n = finite(value);
    if (n === null) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  }

  function signalLabel(value) {
    return ({ GC: "暫定GC", NEAR_GC: "GC接近", CONTINUE: "継続", DC: "暫定DC", OUT: "OUT側", UNKNOWN: "判定待ち" })[value] || value || "—";
  }

  function renderStatus(data) {
    if (!status) return;
    const mature = data.mature_cohorts || {};
    const ready = data.recommendation_ready === true;
    status.innerHTML = `
      <article><span>履歴開始</span><strong>${data.history_start || "今日から蓄積"}</strong></article>
      <article><span>保存日数</span><strong>${Number(data.snapshot_day_count ?? data.snapshot_count ?? 0).toLocaleString("ja-JP")}日</strong><small>immutable生成 ${Number(data.snapshot_count || 0)}件</small></article>
      <article><span>5営業日後を検証済み</span><strong>${Number(mature["5d"] || 0)}週</strong></article>
      <article><span>20営業日後を検証済み</span><strong>${Number(mature["20d"] || 0)}週</strong></article>
      <article class="${ready ? "research-ready" : "research-wait"}"><span>重み見直し</span><strong>${ready ? "研究候補を比較可能" : "まだ自動変更しない"}</strong></article>`;
  }

  function renderMovers(data) {
    if (!hot) return;
    const rows = Array.isArray(data.latest_movers) ? data.latest_movers : [];
    if (!rows.length) {
      hot.innerHTML = '<p class="research-empty">2営業日分の履歴がたまると、「昨日より急浮上した銘柄」をここに表示します。</p>';
      return;
    }
    hot.innerHTML = rows.map((item) => {
      const top = Number(item.current_rank || 0) <= 20 ? '<em>🔥 TOP20</em>' : '';
      return `<a class="research-mover-card" href="detail.html?code=${encodeURIComponent(item.code || "")}">
        <div><span>#${item.current_rank || "—"}</span>${top}<strong>${item.code || ""} ${item.name || ""}</strong><small>${item.market || ""}</small></div>
        <dl><div><dt>観察優先度</dt><dd>${finite(item.priority_score)?.toFixed(1) || "—"}</dd></div><div><dt>順位</dt><dd class="hot-up">▲${Number(item.rank_delta || 0)}</dd></div><div><dt>点数</dt><dd class="hot-up">${signed(item.score_delta, "pt", 1)}</dd></div></dl>
        <p>${signalLabel(item.provisional_status)} / ${(item.tags || []).slice(0, 3).join("・") || "変化を検出"}</p>
      </a>`;
    }).join("");
  }

  function validationCell(result) {
    if (!result || !result.cohorts) return '<span class="research-pending">蓄積中</span>';
    return `<strong>${signed(result.portfolio_mean_pct, "%", 2)}</strong><small>市場差 ${signed(result.excess_vs_all_core_pct, "%", 2)} / ${result.cohorts}週</small>`;
  }

  function renderPortfolio(data) {
    if (!portfolio) return;
    const specs = [
      ["top10", "上位10銘柄"], ["top20", "上位20銘柄"], ["top50", "上位50銘柄"],
      ["score_60", "60点以上"], ["score_70", "70点以上"], ["score_80", "80点以上"], ["score_90", "90点以上"],
    ];
    const values = data.portfolios || {};
    portfolio.innerHTML = `<table class="research-table"><thead><tr><th>仮想ポートフォリオ</th><th>1週間後</th><th>1か月後</th></tr></thead><tbody>${specs.map(([key, label]) => `<tr><th>${label}</th><td>${validationCell(values[key]?.["5d"])}</td><td>${validationCell(values[key]?.["20d"])}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderBuckets(data) {
    if (!buckets) return;
    const values = data.score_buckets || {};
    const keys = ["0-49", "50-59", "60-69", "70-79", "80-89", "90-100"];
    buckets.innerHTML = `<table class="research-table"><thead><tr><th>観察優先度</th><th>1週間後 平均</th><th>1か月後 平均</th><th>件数</th></tr></thead><tbody>${keys.map((key) => {
      const d5 = values[key]?.["5d"] || {};
      const d20 = values[key]?.["20d"] || {};
      return `<tr><th>${key}点</th><td>${signed(d5.mean_pct, "%", 2)}</td><td>${signed(d20.mean_pct, "%", 2)}</td><td>${Number(d20.count || d5.count || 0).toLocaleString("ja-JP")}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  function renderExperiments(data) {
    if (!experiments) return;
    const labels = {
      baseline: "現行バランス",
      signal_heavy: "月足シグナル重視",
      supply_heavy: "信用需給重視",
      trend_heavy: "日足・出来高重視",
      quality_heavy: "財務重視",
    };
    const values = data.weight_experiments || {};
    experiments.innerHTML = `<table class="research-table"><thead><tr><th>研究用エンジン</th><th>1週間 TOP20</th><th>1か月 TOP20</th><th>市場超過 1か月</th></tr></thead><tbody>${Object.keys(labels).map((key) => {
      const d5 = values[key]?.["5d"] || {};
      const d20 = values[key]?.["20d"] || {};
      const best = data.recommendation_ready && data.best_challenger === key ? '<em class="research-best">研究候補</em>' : '';
      return `<tr><th>${labels[key]} ${best}</th><td>${signed(d5.top20_mean_pct, "%", 2)}</td><td>${signed(d20.top20_mean_pct, "%", 2)}</td><td>${signed(d20.excess_vs_all_core_pct, "%", 2)}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  async function init() {
    try {
      const response = await fetch(`data/premium/research/summary.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      renderStatus(data);
      renderMovers(data);
      renderPortfolio(data);
      renderBuckets(data);
      renderExperiments(data);
    } catch (_) {
      if (status) status.innerHTML = '<article><span>検証履歴</span><strong>初回データを準備中</strong></article>';
      if (hot) hot.innerHTML = '<p class="research-empty">次回の全銘柄更新から観察優先度の履歴保存を開始します。</p>';
      if (portfolio) portfolio.innerHTML = '<p class="research-empty">5営業日後・20営業日後の成績が確定すると表示します。</p>';
      if (buckets) buckets.innerHTML = '<p class="research-empty">スコア帯別の検証データを蓄積します。</p>';
      if (experiments) experiments.innerHTML = '<p class="research-empty">現行エンジンを勝手に変更せず、複数の重みを並走させて比較します。</p>';
    }
  }

  init();
})();
