(() => {
  "use strict";

  const finite = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const format = (value, digits = 1) => {
    const number = finite(value);
    return number === null ? "—" : number.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  };
  const signed = (value, suffix = "%") => {
    const number = finite(value);
    return number === null ? "—" : `${number > 0 ? "+" : ""}${format(number, 1)}${suffix}`;
  };
  const code = () => new URLSearchParams(location.search).get("code")?.trim().toUpperCase() || "";
  const shard = (securityCode) => String(securityCode).slice(0, 2).toUpperCase();

  async function jsonOrNull(path) {
    try {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      return response.ok ? response.json() : null;
    } catch (_) {
      return null;
    }
  }

  function heroLabel(summary) {
    const streak = Number(summary?.consecutive_increase_years || 0);
    if (streak >= 2) return `${streak}年連続増配`;
    if (streak === 1) return "2年連続で増配";
    const cuts = Number(summary?.cut_count_5y || 0);
    if (summary?.no_cut_5y === true) return "直近5年 減配なし";
    if (cuts > 0) return "減配履歴あり";
    return "配当実績を観察";
  }

  function metricCard(label, value, note = "", className = "") {
    return `<article class="dividend-metric ${className}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</article>`;
  }

  function historyMarkup(history) {
    const rows = Array.isArray(history) ? history.slice(-6) : [];
    if (!rows.length) return '<p class="dividend-empty">年次配当をまだ集計できていません。</p>';
    const max = Math.max(...rows.map((row) => finite(row.annual_dividend) || 0), 1);
    return `<div class="dividend-history-list">${rows.map((row, index) => {
      const amount = finite(row.annual_dividend) || 0;
      const previous = index > 0 ? finite(rows[index - 1].annual_dividend) : null;
      const change = previous !== null && previous > 0 ? (amount / previous - 1) * 100 : null;
      const changeText = change === null ? "" : `<em class="${change > 0.05 ? "up" : change < -0.05 ? "down" : "flat"}">${Math.abs(change) <= 0.05 ? "据置" : signed(change)}</em>`;
      const width = Math.max(3, amount / max * 100);
      return `<div class="dividend-history-row"><span class="dividend-year">${row.year}</span><div class="dividend-bar-track"><span class="dividend-bar" style="width:${width}%"></span></div><strong>${format(amount, 2)}円</strong>${changeText}</div>`;
    }).join("")}</div>`;
  }

  function render(panel, summary, finance) {
    panel.classList.add("dividend-growth-panel");
    const heading = panel.querySelector(".section-heading > div");
    if (heading) heading.innerHTML = `<h2>配当の育ち方・株式分割</h2><p>利回りだけでなく、<strong>配当が増えてきたか・減配していないか</strong>を過去実績から確認します。ここは評価スコアには使わず、会社を見る補助材料として表示します。</p>`;

    let root = panel.querySelector("#dividendGrowthInsights");
    if (!root) {
      root = document.createElement("div");
      root.id = "dividendGrowthInsights";
      root.className = "dividend-growth-insights";
      panel.querySelector("#corporateEvents")?.insertAdjacentElement("beforebegin", root);
    }

    if (!summary) {
      const yieldPct = finite(finance?.dividend_yield_pct);
      root.innerHTML = `<div class="dividend-pending"><strong>🌱 配当の育ち方を準備中</strong><p>${yieldPct === null ? "" : `現在の配当利回りは ${format(yieldPct, 2)}%。`} 次回の全銘柄データ更新から、連続増配や直近5年の増配・減配履歴もここに表示します。</p></div>`;
      return;
    }

    const streak = Number(summary.consecutive_increase_years || 0);
    const increases = Number(summary.increase_count_5y || 0);
    const cuts = Number(summary.cut_count_5y || 0);
    const flats = Number(summary.flat_count_5y || 0);
    const yieldPct = finite(finance?.dividend_yield_pct);
    const payout = finite(finance?.payout_ratio_pct);
    const cagr5 = finite(summary.cagr_5y_pct);
    const latest = finite(summary.latest_annual_dividend);
    const heroClass = cuts === 0 && (streak > 0 || summary.no_cut_5y === true) ? "steady" : cuts > 0 ? "caution" : "neutral";

    root.innerHTML = `
      <div class="dividend-hero ${heroClass}">
        <div><span>DIVIDEND HISTORY</span><strong>${heroLabel(summary)}</strong><small>暦年・分割調整後の実績</small></div>
        <div class="dividend-hero-note">配当実績は<strong>スコア対象外</strong>です。高配当だけで判断せず、FCF・配当性向・業績と一緒に確認します。</div>
      </div>
      <div class="dividend-metrics">
        ${metricCard("連続増配", streak > 0 ? `${streak}年` : "—", "直近の増配継続")}
        ${metricCard("直近5年", `増 ${increases} / 据 ${flats} / 減 ${cuts}`, summary.no_cut_5y ? "減配なし" : "増配・減配回数")}
        ${metricCard("5年配当成長", cagr5 === null ? "—" : `${signed(cagr5)}/年`, "年平均の伸び")}
        ${metricCard("配当利回り", yieldPct === null ? "—" : `${format(yieldPct, 2)}%`, "現在の参考値")}
      </div>
      <div class="dividend-secondary">
        <span>最新年間配当 <strong>${latest === null ? "—" : `${format(latest, 2)}円`}</strong></span>
        <span>配当性向 <strong>${payout === null ? "—" : `${format(payout, 1)}%`}</strong></span>
        <span>観測年数 <strong>${Number(summary.observation_years || 0)}年</strong></span>
      </div>
      <div class="dividend-history-heading"><div><span>ANNUAL DIVIDEND</span><h3>年ごとの年間配当</h3></div><small>直近6年</small></div>
      ${historyMarkup(summary.history)}
      <p class="dividend-basis-note">Yahoo Financeの配当・株式分割データを権利落ち日ベースで暦年集計し、後から行われた株式分割を調整しています。会社の会計年度ベースの配当実績とはずれる場合があります。最終確認は企業IRで行ってください。</p>`;

    const events = panel.querySelector("#corporateEvents");
    if (events && !panel.querySelector(".dividend-event-caption")) {
      const caption = document.createElement("div");
      caption.className = "dividend-event-caption";
      caption.innerHTML = `<span>EVENTS</span><h3>直近の配当・権利・株式分割</h3>`;
      events.insertAdjacentElement("beforebegin", caption);
    }
  }

  async function init() {
    const securityCode = code();
    const corporateEvents = document.getElementById("corporateEvents");
    const panel = corporateEvents?.closest(".panel");
    if (!securityCode || !panel) return;
    const prefix = shard(securityCode);
    const [dividendShard, financeShard] = await Promise.all([
      jsonOrNull(`data/core/dividends/${prefix}.json`),
      jsonOrNull(`data/core/fundamentals/${prefix}.json`),
    ]);
    const summary = dividendShard?.records?.[securityCode] || null;
    const finance = financeShard?.records?.[securityCode] || null;
    render(panel, summary, finance);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
