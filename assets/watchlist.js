(() => {
  "use strict";

  const STORAGE_KEY = "kabutane.watchlist.v1";
  const HISTORY_KEY = "kabutane.watchlist.history.v1";
  const CODE_PATTERN = /^[0-9]{3}[0-9A-Z]$/;

  function normalizeCode(value) {
    const code = String(value || "").trim().toUpperCase();
    return CODE_PATTERN.test(code) ? code : "";
  }

  function safeParse(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeName(value) {
    return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 160);
  }

  function safeNote(value) {
    return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim().slice(0, 280);
  }

  function load() {
    const rows = safeParse(STORAGE_KEY, []);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((item) => ({
        code: normalizeCode(item?.code),
        name: safeName(item?.name),
        note: safeNote(item?.note),
        added_at: String(item?.added_at || "").slice(0, 40),
      }))
      .filter((item) => item.code);
  }

  function save(rows, dispatchChange = true) {
    const safeRows = (Array.isArray(rows) ? rows : [])
      .map((item) => ({ code: normalizeCode(item?.code), name: safeName(item?.name), note: safeNote(item?.note), added_at: String(item?.added_at || "").slice(0, 40) }))
      .filter((item) => item.code);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeRows));
    if (dispatchChange) window.dispatchEvent(new CustomEvent("kabutane:watchlist-change", { detail: { count: safeRows.length } }));
    return safeRows;
  }

  function has(code) {
    const normalized = normalizeCode(code);
    return Boolean(normalized) && load().some((item) => item.code === normalized);
  }

  function add(code, name = "") {
    const normalized = normalizeCode(code);
    if (!normalized) return load();
    const rows = load();
    const existing = rows.find((item) => item.code === normalized);
    if (existing) {
      if (name) existing.name = safeName(name);
      return save(rows);
    }
    rows.unshift({ code: normalized, name: safeName(name), note: "", added_at: new Date().toISOString() });
    return save(rows);
  }

  function updateNote(code, note) {
    const normalized = normalizeCode(code);
    if (!normalized) return load();
    const rows = load();
    const existing = rows.find((item) => item.code === normalized);
    if (!existing) return rows;
    existing.note = safeNote(note);
    return save(rows, false);
  }

  function remove(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return load();
    return save(load().filter((item) => item.code !== normalized));
  }

  function toggle(code, name = "") {
    const normalized = normalizeCode(code);
    if (!normalized) return false;
    if (has(normalized)) {
      remove(normalized);
      return false;
    }
    add(normalized, name);
    return true;
  }

  function history() {
    const value = safeParse(HISTORY_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function recordObservation(code, observation) {
    const normalized = normalizeCode(code);
    if (!normalized || !observation?.date) return;
    const store = history();
    const rows = Array.isArray(store[normalized]) ? store[normalized] : [];
    const next = rows.filter((item) => String(item?.date || "") !== String(observation.date));
    next.push({
      date: String(observation.date).slice(0, 10),
      price: observation.price ?? null,
      status: String(observation.status || "UNKNOWN").slice(0, 16),
      spread: observation.spread ?? null,
      volume: observation.volume ?? null,
    });
    next.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    store[normalized] = next.slice(-30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(store));
  }

  function observations(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return [];
    const rows = history()[normalized];
    return Array.isArray(rows) ? rows : [];
  }

  function codeFromHref(href) {
    try {
      const url = new URL(href, window.location.href);
      return normalizeCode(url.searchParams.get("code"));
    } catch (_) {
      return "";
    }
  }

  function buttonFor(code, name) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kabutane-watch-toggle";
    button.dataset.watchCode = normalized;
    button.dataset.watchName = safeName(name);

    const currentName = () => safeName(button.dataset.watchName || name || "");
    const refresh = () => {
      const active = has(normalized);
      const displayName = currentName();
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.textContent = active ? "★ 気になる" : "☆ 気になる";
      button.setAttribute("aria-label", `${normalized} ${displayName}を${active ? "気になる株から外す" : "気になる株に追加"}`);
    };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle(normalized, currentName());
      refresh();
      updateFloatingLink();
    });
    button.refreshWatchLabel = refresh;
    refresh();
    return button;
  }

  function enhanceAllStocks() {
    const tbody = document.getElementById("allStocksRows");
    if (!tbody) return;
    const apply = () => {
      tbody.querySelectorAll("tr").forEach((row) => {
        if (row.querySelector(".kabutane-watch-toggle")) return;
        const link = row.querySelector('a[href*="detail.html?code="]');
        const cell = link?.closest("td");
        const code = codeFromHref(link?.getAttribute("href") || "");
        if (!link || !cell || !code) return;
        const strong = link.querySelector("strong")?.textContent || "";
        const name = strong.replace(new RegExp(`^${code}\\s*`), "").trim();
        const button = buttonFor(code, name);
        if (button) cell.appendChild(button);
      });
    };
    new MutationObserver(apply).observe(tbody, { childList: true, subtree: true });
    apply();
  }

  function enhanceDetail() {
    const params = new URLSearchParams(window.location.search);
    const code = normalizeCode(params.get("code"));
    const meta = document.querySelector(".detail-header .header-meta");
    if (!code || !meta || meta.querySelector(".kabutane-watch-toggle")) return;
    const title = document.getElementById("detailTitle");
    const getName = () => {
      const raw = String(title?.textContent || "").replace(code, "").trim();
      return raw === "銘柄詳細" ? "" : safeName(raw);
    };
    const button = buttonFor(code, getName());
    if (!button) return;
    button.classList.add("detail-watch-toggle");
    meta.insertBefore(button, meta.firstChild);
    if (title) {
      new MutationObserver(() => {
        button.dataset.watchName = getName();
        button.refreshWatchLabel?.();
      }).observe(title, { childList: true, subtree: true, characterData: true });
    }
  }

  function updateFloatingLink() {
    let link = document.querySelector(".kabutane-watch-floating");
    const page = document.body?.dataset?.page || "";
    if (page === "watchlist") return;
    if (!link) {
      link = document.createElement("a");
      link.className = "kabutane-watch-floating";
      link.href = "watchlist.html";
      link.setAttribute("aria-label", "気になる株を開く");
      document.body.appendChild(link);
    }
    const count = load().length;
    link.replaceChildren();
    const icon = document.createElement("span");
    icon.textContent = "🌱";
    const label = document.createElement("strong");
    label.textContent = "気になる株";
    const badge = document.createElement("em");
    badge.textContent = String(count);
    link.append(icon, label, badge);
  }

  window.KabutaneWatchlist = {
    load,
    save,
    add,
    remove,
    toggle,
    has,
    updateNote,
    recordObservation,
    observations,
    normalizeCode,
    storageKey: STORAGE_KEY,
  };

  document.addEventListener("DOMContentLoaded", () => {
    enhanceAllStocks();
    enhanceDetail();
    updateFloatingLink();
  });
  window.addEventListener("kabutane:watchlist-change", updateFloatingLink);
  window.addEventListener("storage", updateFloatingLink);
})();
