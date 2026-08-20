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
  const isFiscal = (summary) => String(summary?.streak_basis || summary?.basis || "").includes("fiscal_year");

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
    const fiscal = isFiscal(summary);
    const review = summary?.streak_review_required === true;
    const lowerBound = summary?.streak_lower_bound === true && summary?.streak_verified !== true;
    const unit = fiscal ? "期" : "年";
    if (review) return streak > 0 ? `${streak}${unit}まで確認・継続要確認` : "増配継続を要確認";
    if (streak >= 1) return `${streak}${unit}${lowerBound ? "以上" : ""}連続増配`;
    const cuts = Number(summary?.cut_count_5y || 0);
    if (summary?.no_cut_5y === true) return "直近5年 減配なし";
    if (cuts > 0) return "減配履歴あり";
    return "配当実績を観察";
  }

  function metricCard(label, value, note = "", className = "") {
    return `<article class="dividend-metric ${className}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</article>`;
  }

  function historyMarkup(history, fiscalMonth) {
    const rows = Array.isArray(history) ? history.slice(-6) : [];
    if (!rows.length) return '<p class="dividend-empty">年間配当をまだ集計できていません。</p>';
    const known = rows.map((row) => finite(row.annual_dividend)).filter((value) => value !== null);
    const max = Math.max(...known, 1);
    return `<div class="dividend-history-list">${rows.map((row, index) => {
      const amount = finite(row.annual_dividend);
      const previous = index > 0 ? finite(rows[index - 1].annual_dividend) : null;
      const period = fiscalMonth ? `${row.year}/${fiscalMonth}期` : String(row.year);
      if (amount === null) {
        return `<div class="dividend-history-row"><span class="dividend-year">${period}</span><div class="dividend-bar-track"><span class="dividend-bar" style="width:0%"></span></div><strong>—</strong><em class="flat">取得未確認</em></div>`;
      }
      const change = previous !== null && previous > 0 ? (amount / previous - 1) * 100 : null;
      const changeText = change === null ? "" : `<em class="${change > 0.05 ? "up" : change < -0.05 ? "down" : "flat"}">${Math.abs(change) <= 0.05 ? "据置" : signed(change)}</em>`;
      const width = Math.max(3, amount / max * 100);
      return `<div class="dividend-history-row"><span class="dividend-year">${period}</span><div class="dividend-bar-track"><span class="dividend-bar" style="width:${width}%"></span></div><strong>${format(amount, 2)}円</strong>${changeText}</div>`;
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
    const verified = summary.streak_verified === true;
    const review = summary.streak_review_required === true;
    const fiscal = isFiscal(summary);
    const lowerBound = summary.streak_lower_bound === true && !verified;
    const streakUnit = fiscal ? "期" : "年";
    const increases = Number(summary.increase_count_5y || 0);
    const cuts = Number(summary.cut_count_5y || 0);
    const flats = Number(summary.flat_count_5y || 0);
    const unknown5 = Number(summary.unknown_count_5y || 0);
    const unknownYears = Number(summary.unknown_year_count || 0);
    const observedYears = Number(summary.observed_dividend_years || 0);
    const yieldPct = finite(finance?.dividend_yield_pct);
    const payout = finite(finance?.payout_ratio_pct);
    const cagr5 = finite(summary.cagr_5y_pct);
    const latest = finite(summary.latest_annual_dividend);
    const fiscalMonth = Number(summary.fiscal_year_end_month || 0);
    const heroClass = review ? "caution" : cuts === 0 && (streak > 0 || summary.no_cut_5y === true) ? "steady" : cuts > 0 ? "caution" : "neutral";
    const asOf = Number(summary.streak_as_of_year || 0);
    const anchorYear = Number(summary.streak_anchor_as_of_year || 0);
    const extension = Number(summary.streak_extension_years || 0);
    const heroBasis = review
      ? `${anchorYear ? `企業IRで${anchorYear}年まで確認・` : ""}その後の配当実績は再確認が必要`
      : verified && extension > 0
        ? `企業IRで${anchorYear}年まで確認・以降${extension}期をYahoo実績で増配確認`
        : verified
          ? `企業IR確認済み${asOf ? `（${asOf}年まで）` : ""}・年次配当はYahoo実績`
          : fiscal
            ? `EDINET決算日${fiscalMonth ? `（${fiscalMonth}月）` : ""}でYahoo配当実績を会計年度集計`
            : "Yahoo暦年集計・分割調整済み配当";
    const streakNote = review
      ? `${asOf ? `${asOf}年まで` : ""}確定・継続判定は保留`
      : verified && extension > 0
        ? `IR基準値＋Yahoo実績で${extension}期延長`
        : verified
          ? "企業IRの会計年度ベース"
          : fiscal
            ? `${lowerBound ? "取得開始前・未確認期をまたぐ可能性・" : ""}EDINET決算日ベース`
            : "Yahoo取得範囲内の暦年継続";
    const streakValue = streak > 0 ? `${streak}${streakUnit}${lowerBound && !review ? "以上" : ""}` : "—";
    const growthBasis = fiscal ? "会計年度集計の年平均" : "Yahoo暦年集計の年平均";
    const fiveYearNote = unknown5 > 0 ? `未確認 ${unknown5}・断定せず` : summary.no_cut_5y ? "減配なし" : "増配・減配回数";

    root.innerHTML = `
      <div class="dividend-hero ${heroClass}">
        <div><span>DIVIDEND HISTORY</span><strong>${heroLabel(summary)}</strong><small>${heroBasis}</small></div>
        <div class="dividend-hero-note">配当実績は<strong>スコア対象外</strong>です。高配当だけで判断せず、FCF・配当性向・業績と一緒に確認します。</div>
      </div>
      <div class="dividend-metrics">
        ${metricCard("連続増配", streakValue, streakNote)}
        ${metricCard("直近5年", `増 ${increases} / 据 ${flats} / 減 ${cuts}${unknown5 ? ` / 未 ${unknown5}` : ""}`, fiveYearNote)}
        ${metricCard("5年配当成長", cagr5 === null ? "—" : `${signed(cagr5)}/年`, cagr5 === null && unknown5 ? "未確認期があるため算出保留" : growthBasis)}
        ${metricCard("配当利回り", yieldPct === null ? "—" : `${format(yieldPct, 2)}%`, "現在の参考値")}
      </div>
      <div class="dividend-secondary">
        <span>最新年間配当 <strong>${latest === null ? "—" : `${format(latest, 2)}円`}</strong></span>
        <span>配当性向 <strong>${payout === null ? "—" : `${format(payout, 1)}%`}</strong></span>
        <span>Yahoo観測期間 <strong>${Number(summary.observation_years || 0)}期</strong></span>
        <span>配当確認 <strong>${observedYears}期${unknownYears ? ` / 未確認 ${unknownYears}期` : ""}</strong></span>
      </div>
      <div class="dividend-history-heading"><div><span>ANNUAL DIVIDEND</span><h3>${fiscal ? "期ごとの年間配当" : "年ごとの年間配当"}</h3></div><small>直近6期</small></div>
      ${historyMarkup(summary.history, fiscal ? fiscalMonth : 0)}
      <p class="dividend-basis-note">配当イベントはYahoo Financeが返す分割調整済み実績を使用しています。EDINETコードリストで決算日を確認できる会社は、その決算月に合わせて会計年度単位で集計します。Yahooに配当イベントが無い期は0円と決めつけず「取得未確認」とし、初配・復配も増配回数には数えません。企業IRで連続増配年数を確認済みの場合はその値を基準点にし、翌期以降の増配をYahoo実績で確認できたときだけ自動延長します。</p>`;

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
    const [manifest, financeShard] = await Promise.all([
      jsonOrNull("data/core/manifest.json"),
      jsonOrNull(`data/core/fundamentals/${prefix}.json`),
    ]);
    const dividendReady = Number(manifest?.dividend_history_coverage || 0) > 0;
    const dividendShard = dividendReady ? await jsonOrNull(`data/core/dividends/${prefix}.json`) : null;
    const summary = dividendShard?.records?.[securityCode] || null;
    const finance = financeShard?.records?.[securityCode] || null;
    render(panel, summary, finance);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
