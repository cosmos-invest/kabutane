const DetailEnhancements = (() => {
  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function text(value, fallback = "—") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function number(value, digits = 2) {
    const parsed = finite(value);
    return parsed === null
      ? "—"
      : parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function signed(value, suffix = "%") {
    const parsed = finite(value);
    if (parsed === null) return "—";
    return `${parsed > 0 ? "+" : ""}${number(parsed)}${suffix}`;
  }

  function todayIsoJst(now = new Date()) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }

  function isFutureEvent(event, today = todayIsoJst()) {
    return Boolean(event?.date) && String(event.date) >= today;
  }

  function deriveHighlights(payload) {
    if (Array.isArray(payload?.future_highlights) && payload.future_highlights.length) {
      return payload.future_highlights;
    }
    const record = payload?.record || {};
    const highlights = [];
    const earningsDate = record.next_earnings_date || record.earnings_date_start;
    if (earningsDate) {
      highlights.push({
        type: "EARNINGS",
        date: earningsDate,
        label: "次回決算予定日",
        value: earningsDate,
        detail: "Yahoo Finance掲載予定日",
      });
    }
    if (record.ex_dividend_date) {
      highlights.push({
        type: "RIGHTS",
        date: record.ex_dividend_date,
        label: "権利落ち予定日",
        value: record.ex_dividend_date,
        detail: "権利確定日そのものではありません",
      });
    }
    if (finite(record.forward_annual_dividend) !== null) {
      highlights.push({
        type: "DIVIDEND_FORECAST",
        date: record.ex_dividend_date || null,
        label: "予想年間配当",
        value: finite(record.forward_annual_dividend),
        unit: "円",
        detail: "Yahoo Financeの年間配当予想",
      });
    }
    if (finite(record.dividend_change_pct) !== null) {
      const trailing = finite(record.trailing_annual_dividend);
      highlights.push({
        type: "DIVIDEND_CHANGE",
        date: record.ex_dividend_date || null,
        label: "増配率",
        value: finite(record.dividend_change_pct),
        unit: "%",
        detail: trailing === null ? "直近年間配当との比較" : `直近年間配当 ${number(trailing)}円との比較`,
      });
    }
    return highlights;
  }

  function dedupeFutureEvents(highlights, corporateEvents, today) {
    const items = [...highlights];
    const coveredTypes = new Set(highlights.map((item) => item.type));
    corporateEvents
      .filter((event) => isFutureEvent(event, today))
      .forEach((event) => {
        if (!coveredTypes.has(event.type)) items.push(event);
      });
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
    const formatted = item.type === "DIVIDEND_CHANGE"
      ? signed(rawValue)
      : finite(rawValue) !== null && item.unit
        ? `${number(rawValue)}${item.unit}`
        : text(rawValue ?? item.label);
    const trendClass = item.type === "DIVIDEND_CHANGE" && finite(rawValue) !== null
      ? (finite(rawValue) >= 0 ? "positive" : "negative")
      : "";
    return `
      <article class="future-event-card future-${String(item.type || "info").toLowerCase()}">
        <span class="future-event-label">${text(item.label, "今後の予定")}</span>
        <strong class="${trendClass}">${formatted}</strong>
        <time datetime="${text(item.date, "")}">${text(item.date, "日付未定")}</time>
        <small>${text(item.detail, "取得できた予定情報です")}</small>
      </article>`;
  }

  function historyCard(event) {
    const labels = { EARNINGS: "決算", RIGHTS: "権利", DIVIDEND: "配当", SPLIT: "分割" };
    return `
      <article class="event-card event-${String(event.type || "").toLowerCase()}">
        <time datetime="${text(event.date)}">${text(event.date)}</time>
        <span>${labels[event.type] || "情報"}</span>
        <strong>${text(event.label)}</strong>
        <small>${text(event.detail)}</small>
      </article>`;
  }

  function renderFocus(record) {
    const focus = document.getElementById("detailFocus");
    if (!focus) return;
    const visible = record?.cosmos_focus === true;
    focus.hidden = !visible;
    focus.setAttribute("aria-hidden", visible ? "false" : "true");
    focus.style.setProperty("display", visible ? "inline-flex" : "none", "important");
    if (visible) {
      const type = record.cosmos_focus_type === "MVP"
        ? "MVP加速型"
        : record.cosmos_focus_type === "BREAKOUT"
          ? "新高値型"
          : "両方適合";
      focus.textContent = `🌸 コスモス注目・${type}`;
    } else {
      focus.textContent = "";
    }
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
      bar.innerHTML = `
        <div class="detail-sticky-inner">
          <a class="detail-sticky-back" href="index.html" aria-label="銘柄探しへ戻る">←</a>
          <div class="detail-sticky-company">
            <strong id="detailStickyName">—</strong>
            <span id="detailStickyCode">—</span>
          </div>
          <div class="detail-sticky-meta">
            <strong id="detailStickyPrice">—</strong>
            <span id="detailStickyStatus" class="detail-sticky-status">—</span>
          </div>
        </div>`;
      document.body.appendChild(bar);
      document.body.classList.add("detail-sticky-enabled");

      const setVisible = (visible) => {
        bar.classList.toggle("is-visible", visible);
        bar.setAttribute("aria-hidden", visible ? "false" : "true");
      };

      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => {
          const entry = entries[0];
          setVisible(Boolean(entry && !entry.isIntersecting));
        }, { threshold: 0 });
        observer.observe(header);
      } else {
        const updateVisibility = () => setVisible(header.getBoundingClientRect().bottom <= 0);
        window.addEventListener("scroll", updateVisibility, { passive: true });
        updateVisibility();
      }
    }

    const companyName = text(payload?.name, "銘柄");
    const code = text(payload?.code, "");
    const currentPrice = finite(record.current_price);
    const status = String(record.status || "").toUpperCase();
    const statusLabel = status === "CONTINUE" ? "継続" : status || "—";

    const nameElement = document.getElementById("detailStickyName");
    const codeElement = document.getElementById("detailStickyCode");
    const priceElement = document.getElementById("detailStickyPrice");
    const statusElement = document.getElementById("detailStickyStatus");
    if (nameElement) {
      nameElement.textContent = companyName;
      nameElement.title = companyName;
    }
    if (codeElement) codeElement.textContent = code;
    if (priceElement) priceElement.textContent = currentPrice === null ? "—" : `${number(currentPrice)}円`;
    if (statusElement) {
      statusElement.textContent = statusLabel;
      statusElement.dataset.status = status.toLowerCase();
    }
  }

  function renderEvents(payload, today = todayIsoJst()) {
    const container = document.getElementById("corporateEvents");
    if (!container) return;
    const corporateEvents = Array.isArray(payload?.corporate_events) ? payload.corporate_events : [];
    const highlights = deriveHighlights(payload);
    const future = dedupeFutureEvents(highlights, corporateEvents, today)
      .sort((a, b) => String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99")));
    const history = corporateEvents
      .filter((event) => !isFutureEvent(event, today))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    container.className = "event-sections";
    container.innerHTML = `
      <section class="event-subsection future-events-section">
        <div class="event-subheading">
          <div><span>FORWARD LOOKING</span><h3>今後の主要予定</h3></div>
          <small>予想値は変更される場合があります</small>
        </div>
        <div class="future-event-grid">
          ${future.length ? future.map(futureCard).join("") : '<p class="empty-state compact-empty">取得できる未来イベントはありません。</p>'}
        </div>
      </section>
      <section class="event-subsection history-events-section">
        <div class="event-subheading"><div><span>HISTORY</span><h3>過去のイベント</h3></div></div>
        <div class="past-event-grid">
          ${history.length ? history.map(historyCard).join("") : '<p class="empty-state compact-empty">過去イベントはありません。</p>'}
        </div>
      </section>`;
  }

  function repairRsiExplanation() {
    const explanation = document.getElementById("rsiExplanation");
    if (!explanation) return;
    explanation.textContent = "月足RSI14はTradingViewと同じWilder方式で計算し、5か月MAはそのRSI14の直近5か月単純平均です。緑のGC線はRSI14が5か月MAを上抜けた翌月最初の取引日、赤のDC線は下抜けた翌月最初の取引日を示します。";
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
  }

  async function init() {
    repairRsiExplanation();
    try {
      const payload = await fetchPayload();
      if (!payload) return;
      let attempts = 0;
      const applyAfterBaseRenderer = () => {
        applyPayload(payload);
        attempts += 1;
        if (attempts < 6) window.setTimeout(applyAfterBaseRenderer, 180);
      };
      applyAfterBaseRenderer();
    } catch (error) {
      console.error("detail enhancement failed", error);
    }
  }

  return {
    todayIsoJst,
    isFutureEvent,
    deriveHighlights,
    dedupeFutureEvents,
    renderFocus,
    renderStickyIdentity,
    renderEvents,
    init,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DetailEnhancements;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", DetailEnhancements.init, { once: true });
  else DetailEnhancements.init();
}
