(() => {
  const number = (value, digits = 2) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? parsed.toLocaleString("ja-JP", { maximumFractionDigits: digits })
      : "—";
  };

  const dateLabel = (value) => {
    if (!value) return "日付未定";
    const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return matched ? `${matched[1]}/${matched[2]}/${matched[3]}` : String(value);
  };

  function enhanceTableScroll(root = document) {
    root.querySelectorAll(".table-wrap, .sticky-table-wrap, .performance-chart-wrap").forEach((wrap) => {
      wrap.tabIndex = wrap.tabIndex >= 0 ? wrap.tabIndex : 0;
      wrap.setAttribute("role", "region");
      if (!wrap.getAttribute("aria-label")) wrap.setAttribute("aria-label", "横スクロールできる表");
      const refresh = () => {
        const hasScroll = wrap.scrollWidth > wrap.clientWidth + 2;
        wrap.dataset.hasHorizontalScroll = hasScroll ? "true" : "false";
      };
      refresh();
      if (!wrap.dataset.scrollResizeBound) {
        wrap.dataset.scrollResizeBound = "true";
        new ResizeObserver(refresh).observe(wrap);
      }
    });
  }

  function futureHighlights(payload) {
    if (Array.isArray(payload?.future_highlights) && payload.future_highlights.length) {
      return payload.future_highlights;
    }
    const record = payload?.record || {};
    const items = [];
    const earnings = record.next_earnings_date || record.earnings_date_start;
    if (earnings) items.push({ label: "次回決算", value: dateLabel(earnings), detail: "予定日" });
    if (record.ex_dividend_date) items.push({ label: "権利落ち", value: dateLabel(record.ex_dividend_date), detail: "予定日" });
    if (Number.isFinite(Number(record.forward_annual_dividend))) {
      items.push({ label: "予想年間配当", value: `${number(record.forward_annual_dividend)}円`, detail: "1株あたり" });
    }
    if (Number.isFinite(Number(record.dividend_change_pct))) {
      const change = Number(record.dividend_change_pct);
      items.push({
        label: change >= 0 ? "増配率" : "減配率",
        value: `${change > 0 ? "+" : ""}${number(change)}%`,
        detail: "直近年間配当比",
        css: change >= 0 ? "positive" : "negative",
      });
    }
    return items;
  }

  function compactEventItem(item) {
    const rawValue = item.value;
    let value;
    if (typeof rawValue === "number" && item.unit) {
      value = `${item.type === "DIVIDEND_CHANGE" && rawValue > 0 ? "+" : ""}${number(rawValue)}${item.unit}`;
    } else {
      value = rawValue || item.label || "—";
    }
    const css = item.css || (item.type === "DIVIDEND_CHANGE" && Number.isFinite(Number(rawValue))
      ? (Number(rawValue) >= 0 ? "positive" : "negative")
      : "");
    const detail = item.date && value !== dateLabel(item.date) ? dateLabel(item.date) : (item.detail || "");
    return `<div class="event-compact-item"><span>${item.label || "予定"}</span><strong class="${css}">${value}</strong><small>${detail}</small></div>`;
  }

  function historyLabel(event) {
    const type = { EARNINGS: "決算", RIGHTS: "権利", DIVIDEND: "配当", SPLIT: "分割" }[event.type] || "情報";
    return `${dateLabel(event.date)} ${type}${event.detail ? `・${event.detail}` : ""}`;
  }

  function renderCompactEvents(payload) {
    const container = document.getElementById("corporateEvents");
    if (!container) return;
    if (container.firstElementChild?.classList.contains("event-compact-shell")) return;

    const future = futureHighlights(payload).slice(0, 5);
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const history = (payload?.corporate_events || [])
      .filter((event) => !event.date || String(event.date) < today)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 8);

    container.className = "event-compact-container";
    container.innerHTML = `
      <div class="event-compact-shell">
        <div class="event-compact-row">
          ${future.length
            ? future.map(compactEventItem).join("")
            : '<div class="event-compact-item"><span>今後の予定</span><strong>—</strong><small>取得できる情報はありません</small></div>'}
        </div>
        <details class="event-history-compact">
          <summary>過去のイベント ${history.length}件を確認</summary>
          <div class="event-history-lines">
            ${history.length ? history.map((event) => `<span>${historyLabel(event)}</span>`).join("") : "<span>過去イベントはありません</span>"}
          </div>
        </details>
      </div>`;

    const heading = container.closest(".panel")?.querySelector(".section-heading p");
    if (heading) heading.textContent = "次回決算・権利落ち・予想配当・増配率を横一列で確認できます。";
    document.querySelector(".event-source-note")?.setAttribute("hidden", "");
  }

  async function installCompactDetailEvents() {
    const container = document.getElementById("corporateEvents");
    if (!container) return;
    const code = new URLSearchParams(location.search).get("code")?.trim();
    if (!code) return;
    try {
      const response = await fetch(`data/charts/${encodeURIComponent(code)}.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const apply = () => renderCompactEvents(payload);
      apply();
      const observer = new MutationObserver(() => {
        if (!container.firstElementChild?.classList.contains("event-compact-shell")) apply();
      });
      observer.observe(container, { childList: true });
      window.setTimeout(apply, 1100);
    } catch (error) {
      console.error("compact event rendering failed", error);
    }
  }

  function init() {
    enhanceTableScroll();
    installCompactDetailEvents();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceTableScroll(node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
