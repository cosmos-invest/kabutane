const DetailEnhancements = (() => {
  const CHARACTER_ASSETS = {
    cosmos: "assets/characters/detail-cosmos-guide.webp",
    aile: "assets/characters/detail-aile-guide.webp",
    lumo: "assets/characters/detail-lumo-guide.webp",
  };

  const finite = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const text = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
  const number = (value, digits = 2) => {
    const parsed = finite(value);
    return parsed === null ? "—" : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  };
  const signed = (value, suffix = "%") => {
    const parsed = finite(value);
    return parsed === null ? "—" : `${parsed > 0 ? "+" : ""}${number(parsed)}${suffix}`;
  };

  function todayIsoJst(now = new Date()) {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
  function isFutureEvent(event, today = todayIsoJst()) { return Boolean(event?.date) && String(event.date) >= today; }

  function deriveHighlights(payload) {
    if (Array.isArray(payload?.future_highlights) && payload.future_highlights.length) return payload.future_highlights;
    const record = payload?.record || {};
    const highlights = [];
    const earningsDate = record.next_earnings_date || record.earnings_date_start;
    if (earningsDate) highlights.push({ type: "EARNINGS", date: earningsDate, label: "次回決算予定日", value: earningsDate, detail: "Yahoo Finance掲載予定日" });
    if (record.ex_dividend_date) highlights.push({ type: "RIGHTS", date: record.ex_dividend_date, label: "権利落ち予定日", value: record.ex_dividend_date, detail: "権利確定日そのものではありません" });
    if (finite(record.forward_annual_dividend) !== null) highlights.push({ type: "DIVIDEND_FORECAST", date: record.ex_dividend_date || null, label: "予想年間配当", value: finite(record.forward_annual_dividend), unit: "円", detail: "Yahoo Financeの年間配当予想" });
    if (finite(record.dividend_change_pct) !== null) {
      const trailing = finite(record.trailing_annual_dividend);
      highlights.push({ type: "DIVIDEND_CHANGE", date: record.ex_dividend_date || null, label: "増配率", value: finite(record.dividend_change_pct), unit: "%", detail: trailing === null ? "直近年間配当との比較" : `直近年間配当 ${number(trailing)}円との比較` });
    }
    return highlights;
  }

  function dedupeFutureEvents(highlights, corporateEvents, today) {
    const items = [...highlights];
    const coveredTypes = new Set(highlights.map((item) => item.type));
    corporateEvents.filter((event) => isFutureEvent(event, today)).forEach((event) => { if (!coveredTypes.has(event.type)) items.push(event); });
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.type || ""}|${item.date || ""}|${item.label || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function futureCard(item) {
    const rawValue = item.value;
    const formatted = item.type === "DIVIDEND_CHANGE" ? signed(rawValue) : finite(rawValue) !== null && item.unit ? `${number(rawValue)}${item.unit}` : text(rawValue ?? item.label);
    const trendClass = item.type === "DIVIDEND_CHANGE" && finite(rawValue) !== null ? (finite(rawValue) >= 0 ? "positive" : "negative") : "";
    return `<article class="future-event-card future-${String(item.type || "info").toLowerCase()}"><span class="future-event-label">${text(item.label, "今後の予定")}</span><strong class="${trendClass}">${formatted}</strong><time datetime="${text(item.date, "")}">${text(item.date, "日付未定")}</time><small>${text(item.detail, "取得できた予定情報です")}</small></article>`;
  }
  function historyCard(event) {
    const labels = { EARNINGS: "決算", RIGHTS: "権利", DIVIDEND: "配当", SPLIT: "分割" };
    return `<article class="event-card event-${String(event.type || "").toLowerCase()}"><time datetime="${text(event.date)}">${text(event.date)}</time><span>${labels[event.type] || "情報"}</span><strong>${text(event.label)}</strong><small>${text(event.detail)}</small></article>`;
  }

  function focusType(record) {
    if (record?.cosmos_focus_type === "MVP") return "MVP加速型";
    if (record?.cosmos_focus_type === "BREAKOUT") return "新高値型";
    return "両方適合";
  }
  function renderFocus(record) {
    const focus = document.getElementById("detailFocus");
    if (!focus) return;
    const visible = record?.cosmos_focus === true;
    focus.hidden = !visible;
    focus.setAttribute("aria-hidden", visible ? "false" : "true");
    focus.style.setProperty("display", visible ? "inline-flex" : "none", "important");
    focus.textContent = visible ? `🌸 コスモス注目・${focusType(record)}` : "";
  }

  function confirmedStatusLabel(record) {
    const status = String(record?.status || "").toUpperCase();
    if (status === "NEW") return "月足：確定NEW";
    if (status === "OUT") return "月足：確定OUT";
    if (status === "CONTINUE") return "月足：上側を継続";
    return "月足：確認中";
  }
  function momentumLabel(record) {
    const up = record?.monthly_rsi14_up ?? record?.rsi5_up;
    return up === true ? "勢い：上向き" : up === false ? "勢い：下向き" : "勢い：確認中";
  }
  function relationLabel(record) {
    const spread = finite(record?.monthly_rsi_spread ?? record?.diff);
    if (spread === null) return "5か月MAとの位置：確認中";
    if (spread > 0) return "RSIは5か月MAより上";
    if (spread < 0) return "RSIは5か月MAより下";
    return "RSIと5か月MAが同水準";
  }
  function provisionalLabel(payload) {
    const status = String(payload?.provisional_signal?.status || "").toUpperCase();
    if (status === "GC") return "今月：暫定GCを観察中";
    if (status === "DC") return "今月：暫定DCを観察中";
    return null;
  }

  function characterRouteMarkup() {
    return `<div class="detail-character-route" aria-label="3人と見る順番">
      <div><img src="${CHARACTER_ASSETS.cosmos}" alt=""><span><b>1 日足</b><small>まず形を見る</small></span></div>
      <div><img src="${CHARACTER_ASSETS.lumo}" alt=""><span><b>2 月足RSI</b><small>勢いを見る</small></span></div>
      <div><img src="${CHARACTER_ASSETS.aile}" alt=""><span><b>3 詳細</b><small>必要な時だけ</small></span></div>
    </div>`;
  }

  function ensureQuickRead(payload) {
    const main = document.querySelector("main.container");
    if (!main) return null;
    let section = document.getElementById("detailQuickRead");
    if (!section) {
      section = document.createElement("section");
      section.id = "detailQuickRead";
      section.className = "panel detail-quick-read";
      section.innerHTML = `<div class="detail-quick-read-heading"><div><span>まずここだけ</span><h2>チャートを2つだけ、順番に見る</h2></div><p>最初から全部の数字を読まなくて大丈夫。日足チャートで値動きの形を見て、そのあと月足RSIで勢いを確認します。</p></div><div id="detailQuickReadChips" class="detail-quick-read-chips" aria-label="月足RSIの要点"></div>${characterRouteMarkup()}<div id="cosmosFocusGuide" class="cosmos-focus-guide" hidden><div class="cosmos-focus-avatar" aria-hidden="true"><img id="cosmosFocusGuideImage" src="${CHARACTER_ASSETS.cosmos}" alt=""><span id="cosmosFocusGuideFallback">🌸</span></div><div class="cosmos-focus-copy"><span>コスモス注目</span><strong id="cosmosFocusGuideType">—</strong><p>コスモスが特に気になった銘柄だけ表示します。まず日足の形を見て、月足RSIの勢いと重なるか確認してみよう🌸</p></div></div>`;
    }
    const record = payload?.record || {};
    const labels = [confirmedStatusLabel(record), momentumLabel(record), relationLabel(record)];
    const provisional = provisionalLabel(payload);
    if (provisional) labels.push(provisional);
    const chips = document.getElementById("detailQuickReadChips");
    const signature = labels.join("|");
    if (chips && chips.dataset.signature !== signature) {
      chips.dataset.signature = signature;
      chips.innerHTML = "";
      labels.forEach((label, index) => {
        const item = document.createElement("span");
        item.className = `detail-quick-chip quick-chip-${index + 1}`;
        item.textContent = label;
        chips.appendChild(item);
      });
    }
    const guide = document.getElementById("cosmosFocusGuide");
    const guideType = document.getElementById("cosmosFocusGuideType");
    if (guide) guide.hidden = record.cosmos_focus !== true;
    if (guideType && record.cosmos_focus === true) guideType.textContent = focusType(record);
    return section;
  }

  function ensureSupplementalDetails() {
    const main = document.querySelector("main.container");
    if (!main) return null;
    let details = document.getElementById("detailSupplementalDetails");
    if (!details) {
      details = document.createElement("details");
      details.id = "detailSupplementalDetails";
      details.className = "panel detail-supplemental-details";
      details.innerHTML = `<summary><span><small>補足情報</small><strong>詳しい数字・判定ルールを見る</strong></span><em>必要なときだけ開く ＋</em></summary><div class="detail-supplemental-body"><p class="detail-supplemental-intro">現在値やRSIの細かな数値、確定・暫定の判定根拠、計算ルールをまとめています。最初は飛ばしても大丈夫です。</p><div id="detailStatsSlot" class="detail-stats-slot"></div><div id="detailGeneratedInfoSlot" class="detail-generated-info-slot"></div><div id="detailDefinitionSlot" class="detail-definition-slot"></div></div>`;
      const anchor = main.querySelector(".advanced-panel") || main.querySelector(".quickstart-banner") || main.lastElementChild;
      if (anchor) anchor.insertAdjacentElement("beforebegin", details); else main.appendChild(details);
    }
    const stats = document.getElementById("detailStats");
    const slot = document.getElementById("detailStatsSlot");
    if (stats && slot && stats.parentElement !== slot) slot.appendChild(stats);
    return details;
  }

  function dockSupplementalPanels() {
    const main = document.querySelector("main.container");
    const details = ensureSupplementalDetails();
    if (!main || !details) return;
    const generatedSlot = document.getElementById("detailGeneratedInfoSlot");
    const definitionSlot = document.getElementById("detailDefinitionSlot");
    const snapshot = document.getElementById("monthlySignalSnapshot");
    if (snapshot && generatedSlot && !generatedSlot.contains(snapshot)) generatedSlot.appendChild(snapshot);
    if (!definitionSlot) return;
    [...main.querySelectorAll(".panel")].forEach((panel) => {
      if (panel === details || details.contains(panel)) return;
      if ((panel.textContent || "").includes("OFFICIAL SIGNAL DEFINITION")) definitionSlot.appendChild(panel);
    });
  }

  function decorateTakeaway(selector, character, label) {
    const node = document.querySelector(selector);
    if (!node || node.querySelector(".detail-character-avatar")) return;
    const image = document.createElement("img");
    image.className = `detail-character-avatar detail-character-${character}`;
    image.src = CHARACTER_ASSETS[character];
    image.alt = `${label}の案内`;
    node.prepend(image);
    node.classList.add("has-character-avatar");
  }

  function hydrateCharacterGuides() {
    decorateTakeaway("#volumeProfilePanel .beginner-takeaway", "cosmos", "コスモス");
    decorateTakeaway("#monthlyRsiPanel .beginner-takeaway", "lumo", "ルーモ");
    decorateTakeaway("#fundamentalsPanel .beginner-takeaway", "aile", "エール");
    decorateTakeaway("#detailLargeHoldingsPanel .beginner-takeaway", "cosmos", "コスモス");
  }

  function organizePrimaryFlow(payload) {
    const main = document.querySelector("main.container");
    if (!main) return;
    const quickRead = ensureQuickRead(payload);
    const rsiPanel = document.getElementById("rsiChart")?.closest(".panel");
    const dailyPanel = document.getElementById("volumeProfilePanel");
    const roadmap = main.querySelector(".analysis-roadmap");
    const journeyRule = main.querySelector(".journey-rule");
    const errorBanner = [...main.children].find((node) => node.classList?.contains("error-banner"));
    if (rsiPanel) { rsiPanel.id = rsiPanel.id || "monthlyRsiPanel"; rsiPanel.classList.add("detail-primary-rsi-panel"); }
    if (dailyPanel) dailyPanel.classList.add("detail-primary-daily-panel");
    if (quickRead) { if (errorBanner) errorBanner.insertAdjacentElement("afterend", quickRead); else main.prepend(quickRead); }
    if (quickRead && dailyPanel) quickRead.insertAdjacentElement("afterend", dailyPanel);
    if (dailyPanel && rsiPanel) dailyPanel.insertAdjacentElement("afterend", rsiPanel);
    if (rsiPanel && roadmap) rsiPanel.insertAdjacentElement("afterend", roadmap);
    if (roadmap && journeyRule) roadmap.insertAdjacentElement("afterend", journeyRule);
    const firstStep = roadmap?.querySelector('a[href="#volumeProfilePanel"]');
    if (firstStep) {
      const small = firstStep.querySelector("small");
      if (small) small.textContent = "日足・出来高 → 月足RSI";
    }
    ensureSupplementalDetails();
    dockSupplementalPanels();
    hydrateCharacterGuides();
  }

  function watchGeneratedLayout() {
    if (!document.body || document.body.dataset.detailLayoutObserver === "1" || !("MutationObserver" in window)) return;
    document.body.dataset.detailLayoutObserver = "1";
    let timer = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        dockSupplementalPanels();
        hydrateCharacterGuides();
      }, 60);
    });
    observer.observe(document.querySelector("main.container") || document.body, { childList: true, subtree: true });
  }

  function syncStickyPriceFromStats(fallbackPrice = null) {
    const priceElement = document.getElementById("detailStickyPrice");
    if (!priceElement) return;
    const stats = document.getElementById("detailStats");
    const currentCard = stats ? [...stats.querySelectorAll(".stat-card")].find((card) => card.querySelector("span")?.textContent?.trim() === "現在値") : null;
    const rendered = currentCard?.querySelector("strong")?.textContent?.trim();
    if (rendered && rendered !== "—") { priceElement.textContent = rendered.endsWith("円") ? rendered : `${rendered}円`; return; }
    const parsed = finite(fallbackPrice);
    priceElement.textContent = parsed === null ? "—" : `${number(parsed)}円`;
  }

  function renderStickyIdentity(payload) {
    const header = document.querySelector(".detail-header");
    if (!header) return;
    const record = payload?.record || {};
    let bar = document.getElementById("detailStickyIdentity");
    if (!bar) {
      bar = document.createElement("aside");
      bar.id = "detailStickyIdentity";
      bar.className = "detail-sticky-identity";
      bar.setAttribute("aria-hidden", "true");
      bar.setAttribute("aria-label", "現在表示中の銘柄");
      bar.innerHTML = `<div class="detail-sticky-inner"><a class="detail-sticky-back" href="index.html" aria-label="銘柄探しへ戻る">←</a><div class="detail-sticky-company"><strong id="detailStickyName">—</strong><span id="detailStickyCode">—</span></div><div class="detail-sticky-meta"><strong id="detailStickyPrice">—</strong><span id="detailStickyStatus" class="detail-sticky-status">—</span></div></div>`;
      document.body.appendChild(bar);
      document.body.classList.add("detail-sticky-enabled");
      const setVisible = (visible) => { bar.classList.toggle("is-visible", visible); bar.setAttribute("aria-hidden", visible ? "false" : "true"); };
      if ("IntersectionObserver" in window) new IntersectionObserver((entries) => setVisible(Boolean(entries[0] && !entries[0].isIntersecting)), { threshold: 0 }).observe(header);
      else {
        const updateVisibility = () => setVisible(header.getBoundingClientRect().bottom <= 0);
        window.addEventListener("scroll", updateVisibility, { passive: true }); updateVisibility();
      }
      const stats = document.getElementById("detailStats");
      if (stats && "MutationObserver" in window) new MutationObserver(() => syncStickyPriceFromStats(record.current_price)).observe(stats, { childList: true, subtree: true, characterData: true });
    }
    const nameElement = document.getElementById("detailStickyName");
    const codeElement = document.getElementById("detailStickyCode");
    const statusElement = document.getElementById("detailStickyStatus");
    const status = String(record.status || "").toUpperCase();
    if (nameElement) { nameElement.textContent = text(payload?.name, "銘柄"); nameElement.title = text(payload?.name, "銘柄"); }
    if (codeElement) codeElement.textContent = text(payload?.code, "");
    syncStickyPriceFromStats(record.current_price);
    if (statusElement) { statusElement.textContent = status === "CONTINUE" ? "継続" : status || "—"; statusElement.dataset.status = status.toLowerCase(); }
  }

  function renderEvents(payload, today = todayIsoJst()) {
    const container = document.getElementById("corporateEvents");
    if (!container) return;
    const corporateEvents = Array.isArray(payload?.corporate_events) ? payload.corporate_events : [];
    const future = dedupeFutureEvents(deriveHighlights(payload), corporateEvents, today).sort((a, b) => String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99")));
    const history = corporateEvents.filter((event) => !isFutureEvent(event, today)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    container.className = "event-sections";
    container.innerHTML = `<section class="event-subsection future-events-section"><div class="event-subheading"><div><span>FORWARD LOOKING</span><h3>今後の主要予定</h3></div><small>予想値は変更される場合があります</small></div><div class="future-event-grid">${future.length ? future.map(futureCard).join("") : '<p class="empty-state compact-empty">取得できる未来イベントはありません。</p>'}</div></section><section class="event-subsection history-events-section"><div class="event-subheading"><div><span>HISTORY</span><h3>過去のイベント</h3></div></div><div class="past-event-grid">${history.length ? history.map(historyCard).join("") : '<p class="empty-state compact-empty">過去イベントはありません。</p>'}</div></section>`;
  }

  function repairRsiExplanation() {
    const explanation = document.getElementById("rsiExplanation");
    if (!explanation) return;
    explanation.textContent = "実線は月末確定値、点線は進行中月の観察値です。まずは2本の位置と向きを見てください。詳しい計算ルールはページ下の「詳しい数字・判定ルール」にまとめています。";
    explanation.setAttribute("data-signal-canonical", "true");
  }

  async function fetchPayload() {
    const code = new URLSearchParams(window.location.search).get("code")?.trim() || "";
    if (!code) return null;
    const response = await fetch(`data/charts/${encodeURIComponent(code)}.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`detail payload HTTP ${response.status}`);
    return response.json();
  }

  function applyPayload(payload) {
    renderFocus(payload.record || {});
    renderStickyIdentity(payload);
    renderEvents(payload);
    repairRsiExplanation();
    organizePrimaryFlow(payload);
  }

  async function init() {
    repairRsiExplanation();
    try {
      const payload = await fetchPayload();
      if (!payload) return;
      organizePrimaryFlow(payload);
      watchGeneratedLayout();
      let attempts = 0;
      const applyAfterBaseRenderer = () => {
        applyPayload(payload);
        attempts += 1;
        if (attempts < 8) window.setTimeout(applyAfterBaseRenderer, 180);
      };
      applyAfterBaseRenderer();
    } catch (error) { console.error("detail enhancement failed", error); }
  }

  return { todayIsoJst, isFutureEvent, deriveHighlights, dedupeFutureEvents, renderFocus, ensureQuickRead, ensureSupplementalDetails, dockSupplementalPanels, organizePrimaryFlow, renderStickyIdentity, syncStickyPriceFromStats, renderEvents, hydrateCharacterGuides, init };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DetailEnhancements;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", DetailEnhancements.init, { once: true });
  else DetailEnhancements.init();
}
