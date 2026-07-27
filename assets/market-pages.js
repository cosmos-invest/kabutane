(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const finite = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const signed = (value) => {
    const number = finite(value);
    return number === null ? "—" : `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
  };
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const sectorNames = { 50: "水産・農林業", 1050: "鉱業", 2050: "建設業", 3050: "食料品", 3100: "繊維製品", 3150: "パルプ・紙", 3200: "化学", 3250: "医薬品", 3300: "石油・石炭製品", 3350: "ゴム製品", 3400: "ガラス・土石製品", 3450: "鉄鋼", 3500: "非鉄金属", 3550: "金属製品", 3600: "機械", 3650: "電気機器", 3700: "輸送用機器", 3750: "精密機器", 3800: "その他製品", 4050: "電気・ガス業", 5050: "陸運業", 5100: "海運業", 5150: "空運業", 5200: "倉庫・運輸関連業", 5250: "情報・通信業", 6050: "卸売業", 6100: "小売業", 7050: "銀行業", 7100: "証券・商品先物取引業", 7150: "保険業", 7200: "その他金融業", 8050: "不動産業", 9050: "サービス業" };

  async function json(path) {
    try {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      return response.ok ? await response.json() : null;
    } catch (_) {
      return null;
    }
  }

  async function text(path) {
    try {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      return response.ok ? await response.text() : "";
    } catch (_) {
      return "";
    }
  }

  function normalizeMarket(value) {
    const source = String(value || "");
    if (source.includes("プライム")) return "プライム";
    if (source.includes("スタンダード")) return "スタンダード";
    if (source.includes("グロース")) return "グロース";
    if (source.includes("ETF") || source.includes("ＥＴＦ")) return "ETF";
    return source || "その他";
  }

  function parseCsvLine(line) {
    const output = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (character === "," && !quoted) {
        output.push(value);
        value = "";
      } else value += character;
    }
    output.push(value);
    return output;
  }

  async function stockMeta() {
    const csv = (await text("stocks.csv")).replace(/^\uFEFF/, "");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return new Map();
    const headers = parseCsvLine(lines[0]).map((value) => value.trim());
    const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
    const map = new Map();
    lines.slice(1).forEach((line) => {
      const columns = parseCsvLine(line);
      const code = String(columns[indexes.code] || "").trim();
      if (!code) return;
      const sector = finite(columns[indexes.sector]);
      map.set(code, { market: normalizeMarket(columns[indexes.market]), jpx_sector_name: sectorNames[sector] || "その他" });
    });
    return map;
  }

  function enrich(rows, meta) {
    return (rows || []).map((row) => ({
      ...row,
      ...(meta.get(String(row.code)) || {}),
      market: row.market || meta.get(String(row.code))?.market || "その他",
      jpx_sector_name: row.jpx_sector_name || meta.get(String(row.code))?.jpx_sector_name || "その他",
    }));
  }

  function rankMark(row) {
    const change = finite(row.rank_change);
    if (row.previous_rank == null) return '<span class="rank-up">初登場</span>';
    if (change > 0) return `<span class="rank-up">↑${change}</span>`;
    if (change < 0) return `<span class="rank-down">↓${Math.abs(change)}</span>`;
    return '<span class="rank-flat">→</span>';
  }

  function rankingRow(row) {
    return `<a class="ranking-row" href="detail.html?code=${encodeURIComponent(row.code)}"><span class="ranking-position">${row.rank}</span><span class="ranking-main"><strong>${esc(row.name)} <small>(${esc(row.code)})</small></strong><small>${esc(row.market || "その他")}・${esc(row.jpx_sector_name || "その他")}｜GC ${esc(row.gc_month || "—")}｜継続 ${esc(row.months_active ?? "—")}か月</small></span><span class="ranking-metrics"><strong class="${finite(row.return_since_gc_pct) >= 0 ? "positive" : "negative"}">${signed(row.return_since_gc_pct)}</strong>${rankMark(row)}${finite(row.daily_change_pct) !== null ? `<small>前日比 ${signed(row.daily_change_pct)}</small>` : ""}</span></a>`;
  }

  async function initRanking() {
    const root = $("#rankingList");
    if (!root) return;
    const [ranking, latest, meta] = await Promise.all([json("data/ranking.json"), json("data/latest.json"), stockMeta()]);
    let rows = enrich(ranking?.rows || [], meta);
    if (!rows.length) {
      rows = enrich((latest?.records || []).filter((row) => finite(row.return_since_gc_pct) !== null).sort((a, b) => finite(b.return_since_gc_pct) - finite(a.return_since_gc_pct)).map((row, index) => ({ ...row, rank: index + 1, previous_rank: null, rank_change: null })), meta);
    }
    let mode = "all";
    const search = $("#rankingSearch");
    const render = () => {
      const query = search.value.trim().toLowerCase();
      let view = rows.filter((row) => !query || `${row.code} ${row.name}`.toLowerCase().includes(query));
      if (mode === "new") view = view.filter((row) => row.status === "NEW");
      if (mode === "short") view = view.filter((row) => finite(row.months_active) !== null && row.months_active <= 3);
      if (mode === "up") view = view.filter((row) => (finite(row.rank_change) || 0) > 0).sort((a, b) => (b.rank_change || 0) - (a.rank_change || 0));
      if (mode === "daily") view = view.filter((row) => finite(row.daily_change_pct) !== null).sort((a, b) => finite(b.daily_change_pct) - finite(a.daily_change_pct));
      root.innerHTML = view.slice(0, 200).map(rankingRow).join("") || '<div class="history-empty">条件に合う銘柄がありません。</div>';
    };
    $("#rankingSummary").innerHTML = `<article><span>対象</span><strong>${rows.length.toLocaleString("ja-JP")}社</strong></article><article><span>判定月NEW</span><strong>${rows.filter((row) => row.status === "NEW").length.toLocaleString("ja-JP")}社</strong></article><article><span>順位上昇</span><strong>${rows.filter((row) => (row.rank_change || 0) > 0).length.toLocaleString("ja-JP")}社</strong></article><article><span>最新日足</span><strong>${esc(ranking?.price_date || latest?.daily_price_date || "—")}</strong></article>`;
    $("#rankingDate").textContent = `更新日 ${ranking?.price_date || latest?.daily_price_date || "—"}`;
    $("#rankingTabs").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      mode = button.dataset.mode;
      $$('button[data-mode]', $("#rankingTabs")).forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
    search.addEventListener("input", render);
    render();
  }

  function group(rows, outRows, key) {
    const map = new Map();
    const get = (name) => {
      if (!map.has(name)) map.set(name, { name, active_count: 0, new_count: 0, out_count: 0, near_cross_count: 0 });
      return map.get(name);
    };
    (rows || []).forEach((row) => {
      const item = get(row[key] || "その他");
      item.active_count += 1;
      if (row.status === "NEW") item.new_count += 1;
      const gap = finite(row.diff);
      if (gap !== null && gap >= 0 && gap <= 2) item.near_cross_count += 1;
    });
    (outRows || []).forEach((row) => get(row[key] || "その他").out_count += 1);
    return [...map.values()].sort((a, b) => (b.new_count + b.out_count) - (a.new_count + a.out_count) || b.near_cross_count - a.near_cross_count || a.name.localeCompare(b.name, "ja"));
  }

  function previousMonth(month) {
    const [year, value] = month.split("-").map(Number);
    return value === 1 ? `${year - 1}-12` : `${year}-${String(value - 1).padStart(2, "0")}`;
  }

  async function fallbackMonthly(meta) {
    const latest = await json("data/latest.json");
    if (!latest?.signal_month) return null;
    const month = latest.signal_month;
    const prior = previousMonth(month);
    const [current, previous] = await Promise.all([json(`data/months/${month}.json`), json(`data/months/${prior}.json`)]);
    const records = enrich(current?.records || latest.records || [], meta);
    const outs = enrich(current?.out_records || latest.out_records || [], meta);
    const previousRecords = previous?.records || [];
    const near = records.filter((row) => {
      const gap = finite(row.diff);
      return gap !== null && gap >= 0 && gap <= 2;
    }).sort((a, b) => finite(a.diff) - finite(b.diff));
    return {
      signal_month: month,
      previous_month: prior,
      summary: {
        active_count: records.length,
        previous_active_count: previousRecords.length,
        active_change: records.length - previousRecords.length,
        new_count: records.filter((row) => row.status === "NEW").length,
        out_count: outs.length,
        near_cross_count: near.length,
      },
      new_records: records.filter((row) => row.status === "NEW"),
      out_records: outs,
      near_cross_records: near.slice(0, 100),
      by_market: group(records, outs, "market"),
      by_sector: group(records, outs, "jpx_sector_name"),
    };
  }

  function groupCards(rows) {
    const list = rows || [];
    const maxActivity = Math.max(1, ...list.map((row) => Number(row.new_count || 0) + Number(row.out_count || 0) + Number(row.near_cross_count || 0)));
    return list.map((row) => {
      const activity = Number(row.new_count || 0) + Number(row.out_count || 0) + Number(row.near_cross_count || 0);
      const width = Math.max(4, Math.round(activity / maxActivity * 100));
      return `<article class="monthly-group-card"><div class="monthly-group-card-name"><strong>${esc(row.name)}</strong><small>変化・観察 ${activity}件</small></div><div class="monthly-group-metric active"><span>継続</span><b>${Number(row.active_count || 0).toLocaleString("ja-JP")}</b></div><div class="monthly-group-metric new"><span>NEW</span><b>${Number(row.new_count || 0).toLocaleString("ja-JP")}</b></div><div class="monthly-group-metric out"><span>OUT</span><b>${Number(row.out_count || 0).toLocaleString("ja-JP")}</b></div><div class="monthly-group-metric near"><span>節目</span><b>${Number(row.near_cross_count || 0).toLocaleString("ja-JP")}</b></div><div class="monthly-group-bar" aria-hidden="true"><i style="width:${width}%"></i></div></article>`;
    }).join("") || '<div class="history-empty">集計できる区分がありません。</div>';
  }

  function eventRows(rows, type, query = "") {
    const normalizedQuery = query.trim().toLowerCase();
    const label = type === "new" ? "NEW" : type === "out" ? "OUT" : "節目接近";
    const filtered = (rows || []).filter((row) => !normalizedQuery || `${row.code} ${row.name} ${row.market} ${row.jpx_sector_name}`.toLowerCase().includes(normalizedQuery));
    return filtered.slice(0, 100).map((row) => `<a class="event-row ${type}" href="detail.html?code=${encodeURIComponent(row.code)}"><span class="event-type">${label}</span><span><strong>${esc(row.name)} (${esc(row.code)})</strong><small>${esc(row.market || "その他")}・${esc(row.jpx_sector_name || "その他")}</small></span><span>${type === "near" ? `確定差 ${finite(row.diff)?.toFixed(2) ?? "—"}` : type === "out" ? `終了 ${esc(row.exit_month || row.signal_month || "—")}` : `GC ${esc(row.gc_month || row.signal_month || "—")}`}</span></a>`).join("") || '<div class="history-empty">該当銘柄はありません。</div>';
  }

  function strongestGroup(rows) {
    return [...(rows || [])].sort((a, b) => (b.new_count + b.out_count) - (a.new_count + a.out_count) || b.near_cross_count - a.near_cross_count)[0] || null;
  }

  function renderMonthlyBriefs(report) {
    const summary = report.summary || {};
    const market = strongestGroup(report.by_market);
    const sector = strongestGroup(report.by_sector);
    const change = Number(summary.active_change || 0);
    const cosmos = change === 0
      ? `継続中の銘柄数は前月と同じだよ。NEW ${summary.new_count || 0}社、OUT ${summary.out_count || 0}社の入れ替わりを確認しよう🌸`
      : `継続中は前月から${change > 0 ? `${change}社増加` : `${Math.abs(change)}社減少`}。まずはNEWとOUTのバランスを見よう🌸`;
    const lumoParts = [];
    if (market) lumoParts.push(`市場では「${market.name}」`);
    if (sector) lumoParts.push(`セクターでは「${sector.name}」`);
    const lumo = lumoParts.length ? `${lumoParts.join("、")}で変化が目立ったよ！気になる銘柄を一つ開いてみよう✨` : "今月の変化を読み込んでいるよ✨";
    const aile = `節目接近は${summary.near_cross_count || 0}社。これは確定月の差が0〜2ポイントだった事実で、次のIN・OUTを予測する表示ではないよ。`;
    if ($("#cosmosMonthlyBrief")) $("#cosmosMonthlyBrief").textContent = cosmos;
    if ($("#lumoMonthlyBrief")) $("#lumoMonthlyBrief").textContent = lumo;
    if ($("#aileMonthlyBrief")) $("#aileMonthlyBrief").textContent = aile;
  }

  function installMonthlyGroupTabs() {
    const tabs = $("#monthlyGroupTabs");
    if (!tabs) return;
    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-group-view]");
      if (!button) return;
      const view = button.dataset.groupView;
      $$('[data-group-view]', tabs).forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      $$('[data-group-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.groupPanel === view));
    });
  }

  async function initMonthly() {
    const root = $("#monthlyEvents");
    if (!root) return;
    const meta = await stockMeta();
    let report = await json("data/monthly-report.json");
    if (!report?.summary) report = await fallbackMonthly(meta);
    if (!report?.summary) {
      root.innerHTML = '<div class="history-empty">月初レポートの基礎データを読み込めませんでした。</div>';
      return;
    }
    report = {
      ...report,
      new_records: enrich(report.new_records, meta),
      out_records: enrich(report.out_records, meta),
      near_cross_records: enrich(report.near_cross_records, meta),
    };
    const summary = report.summary;
    $("#reportMonth").textContent = `判定月 ${report.signal_month}`;
    $("#monthlySummary").innerHTML = `
      <article><span>継続中</span><strong>${Number(summary.active_count || 0).toLocaleString("ja-JP")}社</strong><small>確定月でRSI14が5か月MAより上</small></article>
      <article><span>前月から</span><strong class="${summary.active_change >= 0 ? "positive" : "negative"}">${summary.active_change > 0 ? "+" : ""}${Number(summary.active_change || 0).toLocaleString("ja-JP")}社</strong><small>継続中の銘柄数の増減</small></article>
      <article><span>NEW / OUT</span><strong>${Number(summary.new_count || 0).toLocaleString("ja-JP")} / ${Number(summary.out_count || 0).toLocaleString("ja-JP")}</strong><small>判定月に確定した入口と退出</small></article>
      <article><span>節目接近</span><strong>${Number(summary.near_cross_count || 0).toLocaleString("ja-JP")}社</strong><small>確定差0〜2ポイントの観察対象</small></article>`;
    $("#marketTable").innerHTML = groupCards(report.by_market || []);
    $("#sectorTable").innerHTML = groupCards(report.by_sector || []);
    $("#newTabCount").textContent = Number(report.new_records?.length || 0).toLocaleString("ja-JP");
    $("#outTabCount").textContent = Number(report.out_records?.length || 0).toLocaleString("ja-JP");
    $("#nearTabCount").textContent = Number(report.near_cross_records?.length || 0).toLocaleString("ja-JP");
    renderMonthlyBriefs(report);
    installMonthlyGroupTabs();

    let mode = "new";
    const search = $("#monthlyEventSearch");
    const intro = $("#monthlyEventIntro");
    const descriptions = {
      new: "判定月に、確定した月足RSI14が5か月MAを下から上へ抜けた銘柄です。",
      out: "判定月に、確定した月足RSI14が5か月MA以下へ戻った銘柄です。",
      near: "確定月のRSI14と5か月MAの差が0〜2ポイントだった銘柄です。予測表示ではありません。",
    };
    const render = () => {
      const rows = mode === "new" ? report.new_records || [] : mode === "out" ? report.out_records || [] : report.near_cross_records || [];
      intro.textContent = descriptions[mode];
      root.innerHTML = eventRows(rows, mode === "near" ? "near" : mode, search?.value || "");
    };
    $("#monthlyTabs").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      mode = button.dataset.mode;
      $$('button[data-mode]', $("#monthlyTabs")).forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      render();
    });
    search?.addEventListener("input", render);
    render();
  }

  function init() {
    initRanking();
    initMonthly();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
