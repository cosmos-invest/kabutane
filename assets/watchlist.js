(() => {
  "use strict";

  const STORAGE_KEY = "kabutane.watchlist.v1";
  const HISTORY_KEY = "kabutane.watchlist.history.v1";

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function safeParse(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function load() {
    const rows = safeParse(STORAGE_KEY, []);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((item) => ({
        code: normalizeCode(item?.code),
        name: String(item?.name || "").trim(),
        added_at: String(item?.added_at || ""),
      }))
      .filter((item) => item.code);
  }

  function save(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    window.dispatchEvent(new CustomEvent("kabutane:watchlist-change", { detail: { count: rows.length } }));
    return rows;
  }

  function has(code) {
    const normalized = normalizeCode(code);
    return load().some((item) => item.code === normalized);
  }

  function add(code, name = "") {
    const normalized = normalizeCode(code);
    if (!normalized) return load();
    const rows = load();
    const existing = rows.find((item) => item.code === normalized);
    if (existing) {
      if (name) existing.name = String(name).trim();
      return save(rows);
    }
    rows.unshift({ code: normalized, name: String(name || "").trim(), added_at: new Date().toISOString() });
    return save(rows);
  }

  function remove(code) {
    const normalized = normalizeCode(code);
    return save(load().filter((item) => item.code !== normalized));
  }

  function toggle(code, name = "") {
    if (has(code)) {
      remove(code);
      return false;
    }
    add(code, name);
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
    next.push({ ...observation, date: String(observation.date) });
    next.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    store[normalized] = next.slice(-30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(store));
  }

  function observations(code) {
    const rows = history()[normalizeCode(code)];
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kabutane-watch-toggle";
    button.dataset.watchCode = code;
    button.dataset.watchName = name || "";

    const currentName = () => String(button.dataset.watchName || name || "").trim();
    const refresh = () => {
      const active = has(code);
      const displayName = currentName();
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.textContent = active ? "★ 気になる" : "☆ 気になる";
      button.setAttribute("aria-label", `${code} ${displayName}を${active ? "気になる株から外す" : "気になる株に追加"}`);
    };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle(code, currentName());
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
        cell.appendChild(buttonFor(code, name));
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
      return raw === "銘柄詳細" ? "" : raw;
    };
    const button = buttonFor(code, getName());
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
    link.innerHTML = `<span>🌱</span><strong>気になる株</strong><em>${count}</em>`;
  }

  window.KabutaneWatchlist = {
    load,
    save,
    add,
    remove,
    toggle,
    has,
    recordObservation,
    observations,
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
