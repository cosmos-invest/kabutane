(function () {
  "use strict";

  const RAW_ROOT = "https://raw.githubusercontent.com/cosmos-invest/kabutane/main/";
  const REPLACEMENTS = [
    ["実際のお金を動かす前の5項目", "実際のお金を動かす前の6項目"],
    ["レポートには売買位置、最大DD、損益、ルール達成、今回の学びが表示されます。", "レポートには売買位置、最大DD、損益、ルール達成が表示されます。判断メモを書いた場合だけ、その内容を「今回の学び」として載せます。"],
    ["スマホでは画像と文章を共有メニューへまとめて渡します。", "スマホでは画像と文章を共有メニューへまとめて渡します。共有先からXを選ぶと、画像付き投稿へ進めます。"],
    ["TOPIXとの比較", "TOPIX代替ベンチマークとの比較"],
    ["Yahooで取得できるTOPIX連動ETFの調整済み価格を代替使用します。", "TOPIX指数を安定取得できない場合は、Yahoo Financeで取得できるTOPIX連動ETFの調整済み価格を代替ベンチマークとして使います。指数そのものではありません。"],
    ["今月NEW", "判定月NEW"],
    ["今月OUT", "判定月OUT"],
    ["月初に確認したい月足RSIのNEW・OUT・節目接近", "月末確定値で判定した月足RSIのNEW・OUT・節目接近"],
    ["節目接近は次に変化しそうな候補だよ。まだINやOUTが確定したわけじゃないよ。", "節目接近は、確定月のRSI14と5か月MAの差が0〜2ポイントだった観察対象だよ。次のINやOUTを予測する表示ではないよ。"],
    ["NEWとOUTが多い場所を見つけたら、チャートを開いて理由を探そう！", "確定したNEWとOUTが多い市場やセクターを見つけたら、チャートを開いて背景を確認しよう！"],
  ];

  const freshState = {
    latest: null,
    daily: null,
    ranking: null,
    monthly: null,
  };

  function replaceExactText(root, before, after) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue?.includes(before)) continue;
      node.nodeValue = node.nodeValue.replaceAll(before, after);
    }
  }

  function replaceAll(root = document.body) {
    if (!root) return;
    REPLACEMENTS.forEach(([before, after]) => replaceExactText(root, before, after));
  }

  function dateScore(data) {
    if (!data || typeof data !== "object") return 0;
    const values = [data.price_date, data.daily_price_date, data.generated_at];
    for (const value of values) {
      if (!value) continue;
      const score = Date.parse(value);
      if (Number.isFinite(score)) return score;
    }
    if (data.signal_month) {
      const score = Date.parse(`${data.signal_month}-01T00:00:00Z`);
      if (Number.isFinite(score)) return score;
    }
    return 0;
  }

  async function requestJson(url) {
    try {
      const separator = url.includes("?") ? "&" : "?";
      const response = await fetch(`${url}${separator}fresh=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      return response.ok ? await response.json() : null;
    } catch (_) {
      return null;
    }
  }

  async function freshestJson(path) {
    const [published, main] = await Promise.all([
      requestJson(path),
      requestJson(`${RAW_ROOT}${path}`),
    ]);
    if (!published) return main;
    if (!main) return published;
    return dateScore(main) > dateScore(published) ? main : published;
  }

  function escapeHtml(value) {
    return String(value ?? "—").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function signed(value) {
    const parsed = finite(value);
    if (parsed === null) return "—";
    return `${parsed > 0 ? "+" : ""}${parsed.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
  }

  function rankMark(row) {
    const change = finite(row.rank_change);
    if (row.previous_rank === null || row.previous_rank === undefined) return '<span class="rank-up">初登場</span>';
    if (change > 0) return `<span class="rank-up">↑${change}</span>`;
    if (change < 0) return `<span class="rank-down">↓${Math.abs(change)}</span>`;
    return '<span class="rank-flat">→</span>';
  }

  function rankingRow(row) {
    const returnValue = finite(row.return_since_gc_pct);
    return `<a class="ranking-row" href="detail.html?code=${encodeURIComponent(row.code)}">
      <span class="ranking-position">${row.rank}</span>
      <span class="ranking-main"><strong>${escapeHtml(row.name)} <small>(${escapeHtml(row.code)})</small></strong><small>${escapeHtml(row.market || "その他")}・${escapeHtml(row.jpx_sector_name || "その他")}｜GC ${escapeHtml(row.gc_month || "—")}｜継続 ${escapeHtml(row.months_active ?? "—")}か月</small></span>
      <span class="ranking-metrics"><strong class="${returnValue !== null && returnValue >= 0 ? "positive" : "negative"}">${signed(returnValue)}</strong>${rankMark(row)}${finite(row.daily_change_pct) !== null ? `<small>前日比 ${signed(row.daily_change_pct)}</small>` : ""}</span>
    </a>`;
  }

  function currentPriceDate() {
    return freshState.daily?.price_date
      || freshState.ranking?.price_date
      || freshState.latest?.daily_price_date
      || "—";
  }

  function currentSignalMonth() {
    return freshState.latest?.signal_month || freshState.monthly?.signal_month || "—";
  }

  function refreshDateLabels() {
    const priceDate = currentPriceDate();
    const signalMonth = currentSignalMonth();
    const generatedAt = document.getElementById("generatedAt");
    const signal = document.getElementById("signalMonth");
    const rankingDate = document.getElementById("rankingDate");
    const reportMonth = document.getElementById("reportMonth");

    if (generatedAt && priceDate !== "—") generatedAt.textContent = `最新日足 ${priceDate}`;
    if (signal && signalMonth !== "—") signal.textContent = `確定判定 ${signalMonth}`;
    if (rankingDate && priceDate !== "—") {
      const comparison = freshState.ranking?.comparison_price_date || freshState.daily?.comparison_price_date;
      rankingDate.textContent = comparison ? `最新日足 ${priceDate}｜比較 ${comparison}` : `最新日足 ${priceDate}`;
    }
    if (reportMonth && signalMonth !== "—") {
      reportMonth.textContent = priceDate !== "—" ? `確定月 ${signalMonth}｜最新日足 ${priceDate}` : `確定月 ${signalMonth}`;
    }
  }

  function refreshRankingPage() {
    if (document.body?.dataset.page !== "ranking") return;
    const ranking = freshState.ranking;
    const root = document.getElementById("rankingList");
    const summary = document.getElementById("rankingSummary");
    const tabs = document.getElementById("rankingTabs");
    const search = document.getElementById("rankingSearch");
    if (!ranking?.rows?.length || !root || !summary || !tabs || !search) return;

    const rows = ranking.rows;
    let mode = tabs.querySelector("button.active")?.dataset.mode || "all";
    const render = () => {
      const query = search.value.trim().toLowerCase();
      let view = rows.filter((row) => !query || `${row.code} ${row.name}`.toLowerCase().includes(query));
      if (mode === "new") view = view.filter((row) => row.status === "NEW");
      if (mode === "short") view = view.filter((row) => finite(row.months_active) !== null && Number(row.months_active) <= 3);
      if (mode === "up") view = view.filter((row) => (finite(row.rank_change) || 0) > 0).sort((a, b) => Number(b.rank_change || 0) - Number(a.rank_change || 0));
      if (mode === "daily") view = view.filter((row) => finite(row.daily_change_pct) !== null).sort((a, b) => Number(b.daily_change_pct) - Number(a.daily_change_pct));
      root.innerHTML = view.slice(0, 200).map(rankingRow).join("") || '<div class="history-empty">条件に合う銘柄がありません。</div>';
    };

    summary.innerHTML = `<article><span>対象</span><strong>${rows.length.toLocaleString("ja-JP")}社</strong></article><article><span>判定月NEW</span><strong>${rows.filter((row) => row.status === "NEW").length.toLocaleString("ja-JP")}社</strong></article><article><span>順位上昇</span><strong>${rows.filter((row) => Number(row.rank_change || 0) > 0).length.toLocaleString("ja-JP")}社</strong></article><article><span>最新日足</span><strong>${escapeHtml(ranking.price_date || currentPriceDate())}</strong></article>`;

    if (tabs.dataset.liveFreshBound !== "true") {
      tabs.dataset.liveFreshBound = "true";
      tabs.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");
        if (!button) return;
        event.stopImmediatePropagation();
        mode = button.dataset.mode;
        tabs.querySelectorAll("button[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
        render();
      }, true);
      search.addEventListener("input", (event) => {
        event.stopImmediatePropagation();
        render();
      }, true);
    }
    render();
    document.documentElement.dataset.rankingDataDate = ranking.price_date || "unknown";
  }

  function refreshHomeObservation() {
    if (document.body?.dataset.page !== "index") return;
    const root = document.getElementById("homeMarketInsights");
    const ranking = freshState.ranking;
    if (!root || !ranking?.rows?.length) return;

    const list = root.querySelector(".ranking-list");
    if (list) list.innerHTML = ranking.rows.slice(0, 5).map(rankingRow).join("");
    const metrics = root.querySelectorAll(".market-summary-grid article strong");
    if (metrics[0]) metrics[0].textContent = `${ranking.rows.length.toLocaleString("ja-JP")}社`;
    if (metrics[1]) metrics[1].textContent = `${Number(freshState.daily?.summary?.rank_up_count ?? ranking.rows.filter((row) => Number(row.rank_change || 0) > 0).length).toLocaleString("ja-JP")}社`;
    const startNote = [...root.querySelectorAll("p")].find((item) => item.textContent.includes("前日順位は集計開始後"));
    if (startNote && ranking.comparison_price_date) startNote.textContent = `${ranking.comparison_price_date}との比較で順位変動と前日比を表示しています。`;
    root.dataset.liveFreshDate = ranking.price_date || "unknown";
  }

  async function loadFreshMarketData() {
    const [latest, daily, ranking, monthly] = await Promise.all([
      freshestJson("data/latest.json"),
      freshestJson("data/daily-update-status.json"),
      freshestJson("data/ranking.json"),
      freshestJson("data/monthly-report.json"),
    ]);
    freshState.latest = latest;
    freshState.daily = daily;
    freshState.ranking = ranking;
    freshState.monthly = monthly;
    refreshDateLabels();
    refreshRankingPage();
    refreshHomeObservation();
  }

  function auditHowto() {
    if (document.body?.dataset.page !== "howto" || document.body.dataset.howtoCopyAudited === "true") return;

    const stateSection = [...document.querySelectorAll(".howto-section")]
      .find((section) => section.querySelector("h2")?.textContent.includes("ホームに出る3つの状態"));
    const intro = stateSection?.querySelector(".howto-section-heading p:last-child");
    if (intro) intro.textContent = "NEW・CONTINUE・OUTは、すべて月末まで完成した月足で判定します。進行中月の暫定GC・暫定DCは正式判定ではありません。";

    const glossary = stateSection?.querySelectorAll(".glossary-strip article p") || [];
    if (glossary[0]) glossary[0].textContent = "完成した月足のRSI14が、自身の5か月移動平均を下から上へ抜けた判定月。";
    if (glossary[1]) glossary[1].textContent = "完成した月足のRSI14が5か月移動平均より上にあり、確定状態が続いている判定月。";
    if (glossary[2]) glossary[2].textContent = "完成した月足のRSI14が5か月移動平均以下へ戻った判定月。弱まりを確認する目印です。";

    const monthlyCard = [...document.querySelectorAll(".reading-card")]
      .find((card) => card.querySelector("h3")?.textContent.includes("月足RSI14"));
    if (monthlyCard) {
      const paragraph = monthlyCard.querySelector("p");
      const list = monthlyCard.querySelector("ul");
      if (paragraph) paragraph.textContent = "確定した月足の勢いと、進行中月の暫定変化を分けて確認します。";
      if (list) list.innerHTML = [
        "確定NEW・確定継続・確定OUTのどれか",
        "実線は月末確定値、点線は進行中月の暫定値",
        "暫定GC・暫定DCは月末までに消える場合がある",
        "正式判定は翌月最初の日足から表示",
      ].map((text) => `<li>${text}</li>`).join("");
    }

    const ready = [...document.querySelectorAll(".howto-section")]
      .find((section) => section.querySelector(".ready-check-grid"));
    const heading = ready?.querySelector("h2");
    const count = ready?.querySelectorAll('.ready-check-grid input[type="checkbox"]').length || 0;
    if (heading && count) heading.textContent = `実際のお金を動かす前の${count}項目`;
    document.body.dataset.howtoCopyAudited = "true";
  }

  function auditLearn() {
    if (document.body?.dataset.page !== "learn" || document.body.dataset.learnCopyAudited === "true") return;
    const monthly = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent.includes("月足RSIとは"));
    const paragraph = monthly?.querySelector("p");
    if (paragraph) paragraph.textContent = "月末ごとの値動きから、上昇の力と下落の力のバランスを0〜100で表します。正式なNEW・CONTINUE・OUTは完成済み月足だけで判定し、進行中月は参考用の暫定値として別表示します。";
    document.body.dataset.learnCopyAudited = "true";
  }

  function applyAudit() {
    replaceAll();
    auditHowto();
    auditLearn();
    refreshDateLabels();
    refreshHomeObservation();
    document.documentElement.dataset.copyAudit = "confirmed-vs-provisional-v2";
  }

  let scheduled = false;
  function scheduleAudit() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      replaceAll();
      refreshDateLabels();
      refreshHomeObservation();
    });
  }

  function init() {
    applyAudit();
    loadFreshMarketData();
    const observer = new MutationObserver(scheduleAudit);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
