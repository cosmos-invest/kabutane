(() => {
  "use strict";

  const rows = document.getElementById("premiumRows");
  const empty = document.getElementById("premiumEmpty");
  const summary = document.getElementById("premiumSummary");
  const coverage = document.getElementById("premiumCoverage");
  const date = document.getElementById("premiumDataDate");
  const search = document.getElementById("premiumSearch");
  const signal = document.getElementById("premiumSignal");
  const market = document.getElementById("premiumMarket");
  const supply = document.getElementById("premiumSupply");
  const largeHolder = document.getElementById("premiumLargeHolder");
  const sort = document.getElementById("premiumSort");
  const more = document.getElementById("premiumMore");
  const starterCards = document.getElementById("premiumStarterCards");
  const starterStatus = document.getElementById("premiumStarterStatus");
  const quickButtons = [...document.querySelectorAll("[data-premium-mode]")];

  let payload = null;
  let quickMode = "early";
  let visibleLimit = 80;
  const STARTER_PROGRESS_KEY = "kabutane_premium_first_step_v1";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function number(value, digits = 2) {
    const n = finite(value);
    return n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function signed(value, suffix = "%", digits = 1) {
    const n = finite(value);
    if (n === null) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  }

  function isNegativeImportantStatement(value) {
    const compact = String(value || "").replace(/[\s。、・｡]/g, "");
    const exact = new Set(["なし", "無し", "該当なし", "該当無し", "該当ありません", "該当事項なし", "該当事項無し", "該当事項はありません", "該当事項ありません", "当該事項なし", "当該事項無し", "該等事項はありません", "該当する事項なし", "特になし", "特に無し", "特にありません", "記載事項はありません", "ありません"]);
    if (!compact || exact.has(compact)) return true;
    return [/重要提案行為等?を行う予定(?:は|が)?ありません/, /重要提案行為等?を行う予定(?:は|が)?ない/, /重要提案行為等?を行うことを目的とするものではありません/, /重要提案行為等?を行う意(?:思|図)(?:は|が)?ありません/, /重要提案行為等?は行いません/].some((pattern) => pattern.test(compact));
  }

  function hasImportantProposal(item) {
    const parts = String(item?.important_proposal_text || "").split(/\s*\/\s*/).filter(Boolean);
    const purpose = String(item?.purpose || "").replace(/[\s。、・｡]/g, "");
    return parts.some((part) => !isNegativeImportantStatement(part)) || (purpose.includes("重要提案") && !isNegativeImportantStatement(purpose));
  }

  function holderMatches(item, filter) {
    const holder = item?.large_holding;
    if (filter === "all") return true;
    if (filter === "yes") return Boolean(holder);
    if (!holder) return false;
    const delta = finite(holder.change_pct_point);
    if (filter === "NEW_OVER_5") return holder.report_type === "大量保有報告書";
    if (filter === "INCREASE") return holder.report_type === "変更報告書" && delta !== null && delta > 0;
    if (filter === "DECREASE") return holder.report_type === "変更報告書" && delta !== null && delta < 0;
    if (filter === "IMPORTANT_PROPOSAL") return hasImportantProposal(holder);
    return false;
  }

  function signalLabel(value) {
    return ({ GC: "暫定GC", NEAR_GC: "GC接近", CONTINUE: "暫定継続", DC: "暫定DC", OUT: "OUT側", UNKNOWN: "判定待ち" })[value] || value || "判定待ち";
  }

  function signalClass(value) {
    if (value === "GC") return "signal-gc";
    if (value === "NEAR_GC") return "signal-near";
    if (value === "DC") return "signal-dc";
    if (value === "CONTINUE") return "signal-continue";
    return "signal-out";
  }

  function marketLabel(value) {
    const text = String(value || "");
    if (text.includes("プライム")) return "P";
    if (text.includes("スタンダード")) return "S";
    if (text.includes("グロース")) return "G";
    return "株";
  }

  function marketClass(value) {
    const text = String(value || "");
    if (text.includes("プライム")) return "market-prime";
    if (text.includes("スタンダード")) return "market-standard";
    if (text.includes("グロース")) return "market-growth";
    return "";
  }

  function detailHref(item) {
    return `detail.html?code=${encodeURIComponent(item.code || "")}`;
  }

  function supplyPass(item, filter) {
    if (filter === "all") return true;
    if (filter === "yes") return finite(item.supply_score) !== null;
    const rank = { S: 3, A: 2, B: 1 };
    return (rank[item.supply_grade] || 0) >= (rank[filter] || 0);
  }

  function quickPass(item) {
    if (quickMode === "all") return true;
    if (quickMode === "dc") return item.provisional_status === "DC";
    if (quickMode === "holder") return Boolean(item.large_holding);
    if (quickMode === "combo") return ["GC", "NEAR_GC"].includes(item.provisional_status) && finite(item.supply_score) !== null;
    return ["GC", "NEAR_GC"].includes(item.provisional_status);
  }

  function currentFilters() {
    return {
      query: String(search?.value || "").trim().toLowerCase(),
      signal: signal?.value || "all",
      market: market?.value || "all",
      supply: supply?.value || "all",
      holder: largeHolder?.value || "all",
      sort: sort?.value || "priority",
    };
  }

  function filteredRows() {
    if (!payload) return [];
    const filters = currentFilters();
    const result = (Array.isArray(payload.records) ? payload.records : []).filter((item) => {
      if (!quickPass(item)) return false;
      if (filters.signal !== "all" && String(item.provisional_status || "") !== filters.signal) return false;
      if (filters.market !== "all" && !String(item.market || "").includes(filters.market)) return false;
      if (!supplyPass(item, filters.supply)) return false;
      if (!holderMatches(item, filters.holder)) return false;
      if (filters.query) {
        const haystack = `${item.code || ""} ${item.name || ""} ${item.market || ""} ${item.sector || ""} ${item.large_holding?.filer_name || ""}`.toLowerCase();
        if (!haystack.includes(filters.query)) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      if (filters.sort === "spread") return (finite(b.monthly_rsi_spread) ?? -9999) - (finite(a.monthly_rsi_spread) ?? -9999);
      if (filters.sort === "volume") return (finite(b.volume_ratio_5_30) ?? -9999) - (finite(a.volume_ratio_5_30) ?? -9999);
      if (filters.sort === "supply") return (finite(b.supply_score) ?? -9999) - (finite(a.supply_score) ?? -9999);
      if (filters.sort === "code") return String(a.code || "").localeCompare(String(b.code || ""), "ja");
      return (finite(b.priority_score) ?? 0) - (finite(a.priority_score) ?? 0) || String(a.code || "").localeCompare(String(b.code || ""));
    });
    return result;
  }

  function starterReasons(item) {
    const result = [];
    if (item.provisional_status === "GC") result.push("月足の勢いが、今月途中で上向きに変化");
    else if (item.provisional_status === "NEAR_GC") result.push("月足の勢いが、上向きの境目に接近");
    if (["S", "A"].includes(item.supply_grade)) result.push("信用買い残や倍率の整理が進む候補");
    if (item.perfect_order === true) result.push("短期・中期・長期の流れが上向き順");
    const volume = finite(item.volume_ratio_5_30);
    if (volume !== null && volume >= 1.5) result.push("出来高が30日平均より増加");
    const highDistance = finite(item.high52_distance_pct);
    if (highDistance !== null && highDistance >= -10) result.push("過去1年の高値に近い位置");
    if (result.length < 2 && item.fundamentals_available) result.push("会社の体力を確認できる財務データあり");
    return result.slice(0, 3);
  }

  function readStarterProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(STARTER_PROGRESS_KEY) || "null");
      return saved && typeof saved === "object" ? saved : null;
    } catch (_error) {
      return null;
    }
  }

  function saveStarterProgress(code, name) {
    try {
      localStorage.setItem(STARTER_PROGRESS_KEY, JSON.stringify({
        price_date: payload?.price_date || null,
        code,
        name,
        checked_at: new Date().toISOString(),
      }));
    } catch (_error) {
      // Private browsing or storage restrictions must not block navigation.
    }
  }

  function renderStarterCards() {
    if (!starterCards || !payload) return;
    const candidates = (Array.isArray(payload.records) ? payload.records : [])
      .filter((item) => ["GC", "NEAR_GC"].includes(item.provisional_status))
      .sort((a, b) => (finite(b.priority_score) ?? 0) - (finite(a.priority_score) ?? 0) || String(a.code || "").localeCompare(String(b.code || ""), "ja"))
      .slice(0, 3);
    if (!candidates.length) {
      starterCards.innerHTML = '<p class="premium-starter-loading">今日は暫定GC・接近の観察候補がありません。無理に選ばず、次の更新を待ちましょう。</p>';
      if (starterStatus) starterStatus.textContent = "候補がない日も、見送る判断ができれば前進です。";
      return;
    }
    const progress = readStarterProgress();
    starterCards.innerHTML = candidates.map((item, index) => {
      const reasons = starterReasons(item).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
      const checked = progress?.price_date === payload.price_date && String(progress?.code || "") === String(item.code || "");
      const caution = item.provisional_status === "GC"
        ? "月末までに消える途中判定です。今すぐ買う理由にはしません。"
        : "まだ上向きは確定していません。境目で止まる可能性も確認します。";
      return `<article class="premium-starter-card${checked ? " is-checked" : ""}">
        <div class="premium-starter-card-head"><span>観察候補 ${index + 1}</span><em class="${signalClass(item.provisional_status)}">${signalLabel(item.provisional_status)}</em></div>
        <h3><span class="market-mark ${marketClass(item.market)}">${marketLabel(item.market)}</span>${escapeHtml(item.code)} ${escapeHtml(item.name)}</h3>
        <p class="premium-starter-role"><strong>ルーモ✨が見つけた変化</strong></p>
        <ul>${reasons}</ul>
        <p class="premium-starter-caution"><strong>エール💜</strong> ${escapeHtml(caution)}</p>
        <a class="button premium-starter-link" href="${detailHref(item)}" data-starter-code="${escapeHtml(item.code)}" data-starter-name="${escapeHtml(item.name)}">${checked ? "✓ 今日選んだ1社をもう一度見る" : "コスモス🌸と3分で確かめる"}</a>
      </article>`;
    }).join("");
    if (starterStatus) {
      if (progress?.price_date === payload.price_date && progress?.code) {
        starterStatus.textContent = `今日の一歩：${progress.code} ${progress.name || ""}を選びました。買わなくても、自分で確かめれば前進です。`;
      } else {
        starterStatus.textContent = `株価 ${payload.price_date || "—"}時点。3社すべてを見る必要はありません。気になる1社を選べば完了です。記録はこのブラウザだけに残ります。`;
      }
    }
  }

  function renderSummary() {
    if (!payload || !summary) return;
    const counts = payload.status_counts || {};
    const cards = [
      ["通常株を走査", `${Number(payload.core_count || 0).toLocaleString("ja-JP")}銘柄`],
      ["暫定GC", `${Number(counts.GC || 0).toLocaleString("ja-JP")}銘柄`],
      ["GC接近", `${Number(counts.NEAR_GC || 0).toLocaleString("ja-JP")}銘柄`],
      ["GC系 × 需給改善", `${Number(payload.early_supply_combo_count || 0).toLocaleString("ja-JP")}銘柄`],
      ["暫定DC", `${Number(counts.DC || 0).toLocaleString("ja-JP")}銘柄`],
      ["需給改善候補", `${Number(payload.supply_candidate_count || 0).toLocaleString("ja-JP")}銘柄`],
      ["大口保有報告あり", `${Number(payload.large_holding_count || 0).toLocaleString("ja-JP")}銘柄`],
    ];
    summary.innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    if (date) date.textContent = `株価 ${payload.price_date || "—"} / 信用 ${payload.margin_date || "—"}`;
    if (coverage) {
      const total = Number(payload.core_count || 0);
      const daily = Number(payload.daily_coverage || 0);
      const monthly = Number(payload.monthly_coverage || 0);
      const finance = Number(payload.fundamentals_coverage || 0);
      const ratio = (value) => total ? `${value.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")}（${(value / total * 100).toFixed(1)}%）` : "—";
      coverage.innerHTML = `<span>日足 ${ratio(daily)}</span><span>月足RSI ${ratio(monthly)}</span><span>財務 ${ratio(finance)}</span>`;
    }
  }

  function renderFinance(item) {
    if (!item.fundamentals_available) return '<span class="muted">取得待ち / 取得不可</span>';
    const stale = item.fundamentals_stale ? '<small class="stale">更新待ち</small>' : '';
    return `<div class="premium-finance"><span>PER ${number(item.per)}</span><span>PBR ${number(item.pbr)}</span><span>ROE ${number(item.roe_pct, 1)}%</span><span>自己資本 ${number(item.equity_ratio_pct, 1)}%</span>${stale}</div>`;
  }

  function renderSupply(item) {
    if (finite(item.supply_score) === null) return '<span class="muted">改善条件外 / データなし</span>';
    return `<div class="premium-supply-cell"><strong class="supply-grade">${item.supply_grade || "B"} ${number(item.supply_score, 1)}</strong><span>買い残 ${item.buy_reduction_pct === null ? "—" : `${number(item.buy_reduction_pct, 1)}%減`}</span><span>倍率 ${item.ratio_reduction_pct === null ? "—" : `${number(item.ratio_reduction_pct, 1)}%改善`}</span></div>`;
  }

  function renderLargeHolding(item) {
    const holder = item.large_holding;
    if (!holder) return "";
    const delta = finite(holder.change_pct_point);
    const kinds=[];
    if(holder.report_type==="大量保有報告書"||holder.event_kind==="NEW_OVER_5")kinds.push("新規5%超");
    else if(delta!==null&&delta>0)kinds.push("保有増加");
    else if(delta!==null&&delta<0)kinds.push("保有減少");
    if(hasImportantProposal(holder))kinds.push("重要提案の可能性");
    return `<span class="premium-holder-note"><strong>${kinds.join("・")||"大口報告"}</strong> ${escapeHtml(holder.filer_name || "提出者")}${delta === null ? "" : ` ${delta > 0 ? "+" : ""}${delta.toFixed(2)}pt`}</span>`;
  }

  function renderRows() {
    if (!payload || !rows) return;
    const all = filteredRows();
    const shown = all.slice(0, visibleLimit);
    rows.innerHTML = shown.map((item) => {
      const reasons = (Array.isArray(item.reasons) ? item.reasons : []).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("");
      const tags = (Array.isArray(item.tags) ? item.tags : []).map((tag) => `<em>${tag}</em>`).join("");
      const volume = finite(item.volume_ratio_5_30);
      const dailySignals = [
        item.above_sma200 === true ? "SMA200上" : item.above_sma200 === false ? "SMA200下" : "SMA200 —",
        item.perfect_order === true ? "上昇配列" : "配列未成立",
        volume === null ? "出来高 —" : `出来高 ${volume.toFixed(2)}倍`,
      ];
      return `<tr>
        <td><span class="priority-score">${number(item.priority_score, 1)}</span><small class="priority-label">/100</small></td>
        <td><span class="signal-chip ${signalClass(item.provisional_status)}">${signalLabel(item.provisional_status)}</span><small>確定 ${item.confirmed_status || "—"} / ${item.confirmed_month || "—"}</small></td>
        <td><a class="premium-stock-link" href="${detailHref(item)}"><span class="market-mark ${marketClass(item.market)}">${marketLabel(item.market)}</span>${item.code || "—"} ${item.name || ""}<small>${item.market || ""}</small></a></td>
        <td><strong>${number(item.current_price)}円</strong><small>${item.price_date || "—"}</small></td>
        <td><strong>${number(item.monthly_rsi14, 1)}</strong><span>MA5 ${number(item.monthly_rsi_ma5, 1)}</span><small class="${finite(item.monthly_rsi_spread) >= 0 ? "positive" : "negative"}">差 ${signed(item.monthly_rsi_spread, "pt", 1)}</small></td>
        <td><div class="premium-mini-list">${dailySignals.map((value) => `<span>${value}</span>`).join("")}</div></td>
        <td>${renderSupply(item)}</td>
        <td>${renderFinance(item)}</td>
        <td><div class="premium-reasons">${renderLargeHolding(item)}${tags}${reasons || "—"}</div></td>
      </tr>`;
    }).join("");
    if (empty) empty.hidden = all.length > 0;
    if (more) {
      more.hidden = all.length <= visibleLimit;
      more.textContent = `さらに表示（残り ${Math.max(0, all.length - visibleLimit).toLocaleString("ja-JP")}）`;
    }
  }

  function resetVisible() {
    visibleLimit = 80;
    renderRows();
  }

  function setQuickMode(mode) {
    quickMode = mode;
    quickButtons.forEach((button) => {
      const active = button.dataset.premiumMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    resetVisible();
  }

  async function init() {
    try {
      const [response, holderResponse] = await Promise.all([
        fetch("data/premium/opportunity-radar.json", { cache: "no-cache" }),
        fetch("data/large-holdings/latest.json", { cache: "no-cache" }).catch(() => null),
      ]);
      if (!response.ok) throw new Error(`${response.status}`);
      payload = await response.json();
      if (holderResponse?.ok) {
        const holderPayload = await holderResponse.json();
        const latestByCode = new Map();
        (holderPayload.records || []).forEach((item) => {
          const code = String(item.security_code || "");
          if (code && item.report_type !== "訂正報告書" && !latestByCode.has(code)) latestByCode.set(code, item);
        });
        (payload.records || []).forEach((item) => { item.large_holding = latestByCode.get(String(item.code || "")) || null; });
        payload.large_holding_count = (payload.records || []).filter((item) => item.large_holding).length;
        payload.large_holdings_generated_at = holderPayload.generated_at || null;
      }
      renderStarterCards();
      renderSummary();
      renderRows();
    } catch (error) {
      if (date) date.textContent = "データ未生成";
      if (summary) summary.innerHTML = '<article><span>状態</span><strong>準備中</strong></article>';
      if (empty) {
        empty.hidden = false;
        empty.textContent = `全銘柄レーダーを読み込めませんでした（${String(error.message || error)}）。初回データ生成後に表示されます。`;
      }
      if (starterCards) starterCards.innerHTML = '<p class="premium-starter-loading">今日の観察候補を読み込めませんでした。時間をおいてもう一度確認してください。</p>';
      if (starterStatus) starterStatus.textContent = "取得できない状態を、候補0件として扱いません。";
    }
  }

  [search, signal, market, supply, largeHolder, sort].forEach((element) => {
    element?.addEventListener(element === search ? "input" : "change", resetVisible);
  });
  quickButtons.forEach((button) => button.addEventListener("click", () => setQuickMode(button.dataset.premiumMode || "early")));
  more?.addEventListener("click", () => { visibleLimit += 80; renderRows(); });
  starterCards?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-starter-code]");
    if (!link) return;
    saveStarterProgress(link.dataset.starterCode || "", link.dataset.starterName || "");
  });
  init();
})();
