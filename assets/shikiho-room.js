(function () {
  "use strict";

  const MANIFEST_URL = "data/curated/shikiho-2026-summer.json";
  const PERFORMANCE_URL = "data/curated/shikiho-2026-summer-performance.json";
  const STORAGE_KEY = "kabutane-shikiho-2026-summer-access-v1";
  const SESSION_KEY = `${STORAGE_KEY}-session`;
  const state = { manifest: null, payload: null, tier: "ALL", sort: "rank", query: "" };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const finite = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
  const pct = (value, digits = 2) => {
    const number = finite(value);
    if (number === null) return "—";
    return `${number > 0 ? "+" : ""}${number.toLocaleString("ja-JP", { maximumFractionDigits: digits })}%`;
  };
  const yen = (value) => {
    const number = finite(value);
    return number === null ? "—" : `${Math.round(number).toLocaleString("ja-JP")}円`;
  };
  const dateLabel = (value) => value ? String(value).replaceAll("-", "/") : "—";
  const performanceClass = (value) => {
    const number = finite(value);
    return number === null || number === 0 ? "" : number > 0 ? "positive" : "negative";
  };

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} の取得に失敗しました。`);
    return response.json();
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text.normalize("NFKC"));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function hasAccess() {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.expiresAt && Number(saved.expiresAt) > Date.now()) return true;
      if (saved) localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    return false;
  }

  function rememberAccess(days) {
    sessionStorage.setItem(SESSION_KEY, "1");
    if (!days) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ expiresAt: Date.now() + days * 86400000 }));
  }

  function forgetAccess() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(STORAGE_KEY);
  }

  function updateGateCopy() {
    const manifest = state.manifest;
    const noteLink = $("#shikihoNoteAccessLink");
    const magazineLink = $("#shikihoMagazineLink");
    if (noteLink) noteLink.href = manifest.note_access_url;
    if (magazineLink) magazineLink.href = manifest.magazine_url;
    $("#shikihoGateNotice").textContent = manifest.access?.notice || "note側のペイウォールを補助する簡易ゲートです。";
  }

  async function submitGate(event) {
    event.preventDefault();
    const input = $("#shikihoPassphrase");
    const error = $("#shikihoGateError");
    const button = $("#shikihoUnlockButton");
    const phrase = input.value.trim();
    if (!phrase) {
      error.textContent = "合言葉を入力してね。";
      input.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "確認中…";
    try {
      const digest = await sha256(phrase);
      if (digest !== state.manifest.access.sha256) {
        error.textContent = "合言葉が違うみたい。全角カタカナで、もう一度確認してね。";
        input.select();
        return;
      }
      const days = $("#shikihoRemember").checked ? Number(state.manifest.access.remember_days || 30) : 0;
      rememberAccess(days);
      await openRoom();
    } finally {
      button.disabled = false;
      button.textContent = "観察室へ入る";
    }
  }

  function sparkline(points, width = 250, height = 66) {
    const rows = (points || []).map((point) => finite(point.return_pct)).filter((value) => value !== null);
    if (rows.length < 2) return '<div class="shikiho-spark-empty">チャート集計待ち</div>';
    const min = Math.min(...rows, 0);
    const max = Math.max(...rows, 0);
    const range = Math.max(max - min, 1);
    const coords = rows.map((value, index) => {
      const x = (index / (rows.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const zeroY = height - ((0 - min) / range) * height;
    const end = rows.at(-1);
    return `<svg class="shikiho-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="基準日からの騰落率推移"><line x1="0" y1="${zeroY.toFixed(1)}" x2="${width}" y2="${zeroY.toFixed(1)}" class="zero"></line><polyline points="${coords}" class="${end >= 0 ? "up" : "down"}"></polyline></svg>`;
  }

  function summaryCard(title, summary, description) {
    const average = finite(summary?.average_return_pct);
    return `<article class="shikiho-summary-card"><span>${escapeHtml(title)}</span><strong class="${performanceClass(average)}">${pct(average)}</strong><small>${escapeHtml(description)}</small><div><b>${summary?.up_count ?? 0}</b>上昇 / <b>${summary?.down_count ?? 0}</b>下落</div></article>`;
  }

  function renderSummary() {
    const payload = state.payload;
    const summaries = payload.summaries || {};
    const all = summaries.ALL || {};
    const benchmark = payload.benchmark || {};
    $("#shikihoDataDate").textContent = `最新日足 ${dateLabel(payload.latest_price_date)}`;
    $("#shikihoPhaseBadge").textContent = payload.phase === "answered" ? "8月末の答え合わせ確定" : "8月末まで観察中";
    $("#shikihoSummaryGrid").innerHTML = [
      summaryCard("全20社", all, `中央値 ${pct(all.median_return_pct)}｜TOPIX代替差 ${pct(all.benchmark_difference_pct)}`),
      summaryCard("Sランク 5社", summaries.S || {}, "特に注目した5社"),
      summaryCard("Aランク 5社", summaries.A || {}, "注目した5社"),
      summaryCard("Bランク 10社", summaries.B || {}, "定点観測する10社"),
    ].join("");
    $("#shikihoBasketChart").innerHTML = sparkline(payload.basket_paths?.ALL || [], 620, 145);
    $("#shikihoBasketCaption").innerHTML = `6月18日を0％として、20社を同じ比率で持った仮想バスケットです。TOPIX代替は <strong class="${performanceClass(benchmark.return_pct)}">${pct(benchmark.return_pct)}</strong>。`;
    renderGuides();
  }

  function renderGuides() {
    const all = state.payload.summaries?.ALL || {};
    const records = state.payload.records || [];
    const priced = records.filter((row) => finite(row.return_pct) !== null);
    const best = [...priced].sort((a, b) => Number(b.return_pct) - Number(a.return_pct))[0];
    const deepest = [...priced].sort((a, b) => Number(a.max_drawdown_pct) - Number(b.max_drawdown_pct))[0];
    $("#shikihoCosmosComment").textContent = `全20社の平均は${pct(all.average_return_pct)}、中央値は${pct(all.median_return_pct)}だよ。平均だけじゃなく、S・A・Bの違いも見てみよう🌸`;
    $("#shikihoLumoComment").textContent = best ? `いま一番伸びているのは${best.display_name || best.name}で${pct(best.return_pct)}！途中の値動きもチャートで確かめよう✨` : "一番伸びた会社を探しているよ✨";
    $("#shikihoAileComment").textContent = deepest ? `${deepest.display_name || deepest.name}は途中の最大下落が${pct(deepest.max_drawdown_pct)}だったよ。最終結果だけでなく、途中で耐えられる値動きだったかも見よう。` : "途中の最大下落も確認しよう。";
  }

  function stockSort(rows) {
    const direction = state.sort === "drawdown" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (state.sort === "rank") {
        const tierOrder = { S: 0, A: 1, B: 2 };
        return (tierOrder[a.tier] - tierOrder[b.tier]) || ((a.rank ?? 999) - (b.rank ?? 999)) || String(a.code).localeCompare(String(b.code));
      }
      const key = state.sort === "high" ? "high_return_pct" : state.sort === "drawdown" ? "max_drawdown_pct" : "return_pct";
      return ((finite(a[key]) ?? -Infinity) - (finite(b[key]) ?? -Infinity)) * direction;
    });
  }

  function tierLabel(row) {
    if (row.tier === "B") return "B";
    return `${row.tier}${row.rank}`;
  }

  function eventText(row) {
    const chunks = [];
    const dividends = finite(row.dividend_per_current_share);
    if (dividends !== null && dividends > 0) chunks.push(`期間配当 ${yen(dividends)}/株`);
    if (row.split_events?.length) chunks.push(`株式分割 ${row.split_events.length}件`);
    return chunks.length ? chunks.join("｜") : "期間中の配当・分割イベントなし";
  }

  function stockCard(row) {
    const name = row.display_name || row.name;
    const official = row.display_name && row.name !== row.display_name ? `<small>正式名：${escapeHtml(row.name)}</small>` : "";
    return `<article class="shikiho-stock-card" data-tier="${escapeHtml(row.tier)}">
      <header>
        <span class="shikiho-tier tier-${escapeHtml(row.tier)}">${escapeHtml(tierLabel(row))}</span>
        <div><h3>${escapeHtml(name)} <small>(${escapeHtml(row.code)})</small></h3>${official}<p>${escapeHtml(row.market || "市場区分—")}・${escapeHtml(row.sector || "セクター—")}</p></div>
        <strong class="shikiho-return ${performanceClass(row.return_pct)}">${pct(row.return_pct)}</strong>
      </header>
      ${row.thesis ? `<p class="shikiho-thesis">${escapeHtml(row.thesis)}</p>` : ""}
      <div class="shikiho-stock-body">
        <div class="shikiho-metrics">
          <div><span>6/18基準価格</span><b>${yen(row.baseline_price)}</b><small>${dateLabel(row.baseline_date)}</small></div>
          <div><span>${state.payload.phase === "answered" ? "8月末価格" : "現在価格"}</span><b>${yen(row.performance_price)}</b><small>${dateLabel(row.performance_date)}</small></div>
          <div><span>期間中最高</span><b class="positive">${pct(row.high_return_pct)}</b></div>
          <div><span>最大下落</span><b class="negative">${pct(row.max_drawdown_pct)}</b></div>
        </div>
        <div class="shikiho-stock-chart">${sparkline(row.path || [])}</div>
      </div>
      <footer><span>${escapeHtml(eventText(row))}</span><div><a href="detail.html?code=${encodeURIComponent(row.code)}">かぶたね詳細</a><a href="${escapeHtml(state.manifest.magazine_url)}" target="_blank" rel="noopener noreferrer">四季報マガジン ↗</a></div></footer>
      ${row.data_error ? `<p class="shikiho-data-warning">一部データを前回値で表示：${escapeHtml(row.data_error)}</p>` : ""}
    </article>`;
  }

  function renderStocks() {
    const query = state.query.trim().toLowerCase();
    let rows = state.payload.records || [];
    if (state.tier !== "ALL") rows = rows.filter((row) => row.tier === state.tier);
    if (query) rows = rows.filter((row) => [row.code, row.name, row.display_name, row.market, row.sector, row.thesis].some((value) => String(value || "").toLowerCase().includes(query)));
    rows = stockSort(rows);
    $("#shikihoStockCount").textContent = `${rows.length}社`;
    $("#shikihoStockGrid").innerHTML = rows.length ? rows.map(stockCard).join("") : '<p class="shikiho-empty">条件に合う会社がありません。</p>';
  }

  function bindRoomControls() {
    $$("[data-shikiho-tier]").forEach((button) => button.addEventListener("click", () => {
      state.tier = button.dataset.shikihoTier;
      $$("[data-shikiho-tier]").forEach((item) => item.classList.toggle("active", item === button));
      renderStocks();
    }));
    $("#shikihoSort").addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderStocks();
    });
    $("#shikihoSearch").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderStocks();
    });
    $("#shikihoLogout").addEventListener("click", () => {
      forgetAccess();
      $("#shikihoRoom").hidden = true;
      $("#shikihoGate").hidden = false;
      $("#shikihoPassphrase").value = "";
      $("#shikihoPassphrase").focus();
    });
  }

  async function openRoom() {
    $("#shikihoGate").hidden = true;
    $("#shikihoRoom").hidden = false;
    $("#shikihoRoomStatus").textContent = "20社の成績を集計しています…";
    try {
      state.payload = await fetchJson(PERFORMANCE_URL);
      if (!state.payload.records?.length) {
        $("#shikihoRoomStatus").innerHTML = "初回の価格集計待ちです。日次更新後に20社の成績が表示されます。";
        $("#shikihoRoomContent").hidden = true;
        return;
      }
      $("#shikihoRoomStatus").textContent = "";
      $("#shikihoRoomContent").hidden = false;
      renderSummary();
      renderStocks();
    } catch (error) {
      $("#shikihoRoomStatus").textContent = `データを読み込めませんでした。時間を置いて再読み込みしてください。${error.message}`;
    }
  }

  async function init() {
    try {
      state.manifest = await fetchJson(MANIFEST_URL);
      updateGateCopy();
      $("#shikihoGateForm").addEventListener("submit", submitGate);
      $("#shikihoTogglePassword").addEventListener("click", () => {
        const input = $("#shikihoPassphrase");
        input.type = input.type === "password" ? "text" : "password";
        $("#shikihoTogglePassword").textContent = input.type === "password" ? "表示" : "隠す";
      });
      bindRoomControls();
      if (hasAccess()) await openRoom();
    } catch (error) {
      $("#shikihoGateError").textContent = `観察室の準備情報を読み込めませんでした。${error.message}`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
