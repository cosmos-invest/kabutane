(() => {
  "use strict";

  const summaryEl = document.getElementById("pcfSummary");
  const dateEl = document.getElementById("pcfDataDate");
  const coverageEl = document.getElementById("pcfCoverageNote");
  const commonEl = document.getElementById("pcfCommonChanges");
  const gridEl = document.getElementById("pcfFundGrid");
  const emptyEl = document.getElementById("pcfFundEmpty");
  const searchEl = document.getElementById("pcfSearch");
  const filters = [...document.querySelectorAll("[data-pcf-scope]")];
  let payload = null;
  let scope = "domestic";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function number(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("ja-JP", { maximumFractionDigits: digits }) : "—";
  }

  function changeLabel(kind) {
    return ({ NEW: "新規", INCREASE: "増加", DECREASE: "減少", REMOVED: "除外" })[kind] || kind || "変化";
  }

  function changeClass(kind) {
    return ["NEW", "INCREASE"].includes(kind) ? "up" : "down";
  }

  function detailHref(code) {
    return `detail.html?code=${encodeURIComponent(code || "")}`;
  }

  function renderSummary() {
    const value = payload?.summary || {};
    const cards = [
      ["アクティブETF", `${number(value.active_target_count, 0)}本`],
      ["PCF取得済み", `${number(value.available_count, 0)}本`],
      ["日本株型", `${number(value.domestic_equity_count, 0)}本`],
      ["今回更新", `${number(value.updated_count, 0)}本`],
      ["取得待ち", `${number(value.error_count, 0)}本`],
    ];
    summaryEl.innerHTML = cards.map(([label, result]) => `<article><span>${label}</span><strong>${result}</strong></article>`).join("");
    dateEl.textContent = value.latest_fund_date ? `PCF記載日 ${value.latest_fund_date}` : "記載日を確認中";
    coverageEl.textContent = value.error_count
      ? "配信時間外・掲載先未確認のETFは、取得済みの前回データを維持します。取得できない状態を0件として扱いません。"
      : "JPXで確認したアクティブETFのPCFを取得できています。";
  }

  function renderCommon() {
    const rows = Array.isArray(payload?.common_changes) ? payload.common_changes : [];
    if (!rows.length) {
      commonEl.innerHTML = '<p class="pcf-empty">2営業日分のPCFがたまり、複数ファンドで同じ方向の変化が重なると表示します。</p>';
      return;
    }
    commonEl.innerHTML = rows.map((row) => {
      const up = row.direction === "UP";
      const name = escapeHtml(row.name || row.security);
      const label = up ? "増加側で重なった" : "減少側で重なった";
      const title = row.code ? `<a href="${detailHref(row.code)}">${escapeHtml(row.code)} ${name}</a>` : name;
      return `<article class="pcf-common-card ${up ? "up" : "down"}"><span>${label}</span><strong>${title}</strong><small>${number(row.fund_count, 0)}ファンドで確認</small></article>`;
    }).join("");
  }

  function renderChange(row) {
    const code = row.code ? escapeHtml(row.code) : "";
    const name = escapeHtml(row.name_ja || row.name || "構成資産");
    const title = row.code ? `<a href="${detailHref(row.code)}"><strong>${code} ${name}</strong></a>` : `<strong>${name}</strong>`;
    const delta = row.units_delta_pct == null ? "" : `${Number(row.units_delta_pct) > 0 ? "+" : ""}${number(row.units_delta_pct)}%`;
    const caution = row.possible_corporate_action ? " / 企業行動の可能性" : "";
    return `<div class="pcf-change"><span class="pcf-change-kind ${changeClass(row.kind)}">${changeLabel(row.kind)}</span><span>${title}<small>${escapeHtml(caution)}</small></span><b>${escapeHtml(delta)}</b></div>`;
  }

  function renderFund(fund) {
    const counts = fund.change_counts || {};
    const changes = Array.isArray(fund.changes) ? fund.changes : [];
    const top = Array.isArray(fund.top_holdings) ? fund.top_holdings : [];
    const changeHtml = changes.length
      ? `<div class="pcf-changes">${changes.slice(0, 5).map(renderChange).join("")}</div>`
      : fund.baseline
        ? '<p class="pcf-baseline">初回の基準データを記録しました。次の営業日から増減を表示します。</p>'
        : '<p class="pcf-baseline">前回から1％以上の実質的な組入数量変化はありません。</p>';
    const holdings = top.map((row) => {
      const title = row.code ? `<a href="${detailHref(row.code)}">${escapeHtml(row.code)} ${escapeHtml(row.name_ja || row.name || "")}</a>` : escapeHtml(row.name || "");
      return `<tr><td>${title}</td><td>${number(row.weight_pct, 2)}%</td></tr>`;
    }).join("");
    return `<article class="pcf-fund-card">
      <div class="pcf-fund-head">
        <div class="pcf-fund-title"><h3><span>${escapeHtml(fund.code)}</span> ${escapeHtml(fund.display_name || fund.name)}</h3><span>${fund.domestic_equity ? "日本株" : "全資産"}</span></div>
        <div class="pcf-fund-meta"><span>${escapeHtml(fund.fund_date || "基準日—")}</span><span>${escapeHtml(fund.provider || "配信元—")}</span><span>${number(fund.holding_count, 0)}資産</span>${fund.stale ? "<span>前回データ</span>" : ""}</div>
        <div class="pcf-change-counts"><span>新規<strong>${number(counts.NEW || 0, 0)}</strong></span><span>増加<strong>${number(counts.INCREASE || 0, 0)}</strong></span><span>減少<strong>${number(counts.DECREASE || 0, 0)}</strong></span><span>除外<strong>${number(counts.REMOVED || 0, 0)}</strong></span></div>
        ${changeHtml}
      </div>
      <details><summary>上位組入と出典を見る</summary><div class="pcf-fund-detail"><table class="pcf-holdings"><thead><tr><th>上位組入</th><th>概算比率</th></tr></thead><tbody>${holdings || '<tr><td colspan="2">比率を計算できない資産です。</td></tr>'}</tbody></table>${fund.source_url ? `<a class="pcf-provider-link" href="${escapeHtml(fund.source_url)}" target="_blank" rel="noopener noreferrer">PCF配信元を確認 ↗</a>` : ""}</div></details>
    </article>`;
  }

  function filteredFunds() {
    const query = String(searchEl?.value || "").trim().toLowerCase();
    return (payload?.funds || []).filter((fund) => {
      if (scope === "domestic" && !fund.domestic_equity) return false;
      if (scope === "changed" && !(Number(fund.material_change_count) > 0)) return false;
      if (query) {
        const haystack = `${fund.code || ""} ${fund.display_name || fund.name || ""} ${fund.sponsor || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function renderFunds() {
    const rows = filteredFunds();
    gridEl.innerHTML = rows.map(renderFund).join("");
    emptyEl.hidden = rows.length > 0;
  }

  function setScope(next) {
    scope = next;
    filters.forEach((button) => {
      const active = button.dataset.pcfScope === scope;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderFunds();
  }

  async function init() {
    try {
      const response = await fetch("data/premium/etf-pcf/latest.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
      payload = await response.json();
      renderSummary();
      renderCommon();
      renderFunds();
    } catch (error) {
      dateEl.textContent = "データ準備中";
      summaryEl.innerHTML = '<article><span>状態</span><strong>準備中</strong></article>';
      commonEl.innerHTML = '<p class="pcf-empty">PCFデータを読み込めませんでした。</p>';
      gridEl.innerHTML = `<p class="pcf-empty">日次データの初回生成後に表示します（${escapeHtml(error.message || error)}）。</p>`;
    }
  }

  filters.forEach((button) => button.addEventListener("click", () => setScope(button.dataset.pcfScope || "domestic")));
  searchEl?.addEventListener("input", renderFunds);
  init();
})();
