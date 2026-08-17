(function () {
  "use strict";

  const CONFIG_URL = "data/room-access.json";
  const STORAGE_KEY = "kabutane-room-access";
  const SESSION_KEY = `${STORAGE_KEY}-session`;
  let config = null;

  const $ = (selector) => document.querySelector(selector);

  function normalizePhrase(value) {
    return String(value || "").normalize("NFKC").trim().toLowerCase();
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function fetchConfig() {
    const response = await fetch(`${CONFIG_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("ROOMの入室設定を取得できませんでした。");
    return response.json();
  }

  function readJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      try { storage.removeItem(key); } catch {}
      return null;
    }
  }

  function hasAccess() {
    const session = readJson(sessionStorage, SESSION_KEY);
    if (session?.version === config.version) return true;

    const saved = readJson(localStorage, STORAGE_KEY);
    if (saved?.version === config.version && Number(saved.expiresAt) > Date.now()) return true;
    if (saved) {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
    return false;
  }

  function rememberAccess(days) {
    const grant = { version: config.version };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(grant)); } catch {}
    if (!days) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...grant,
        expiresAt: Date.now() + days * 86400000,
      }));
    } catch {}
  }

  function forgetAccess() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function openRoom() {
    const gate = $("#roomGate");
    const shell = $("#roomShell");
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
    document.body.classList.add("room-unlocked");
  }

  function closeRoom() {
    forgetAccess();
    const gate = $("#roomGate");
    const shell = $("#roomShell");
    if (shell) shell.hidden = true;
    if (gate) gate.hidden = false;
    document.body.classList.remove("room-unlocked");
    const input = $("#roomPassphrase");
    if (input) {
      input.value = "";
      input.focus();
    }
  }

  async function submitGate(event) {
    event.preventDefault();
    const input = $("#roomPassphrase");
    const error = $("#roomGateError");
    const button = $("#roomUnlockButton");
    const phrase = normalizePhrase(input?.value);

    if (!phrase) {
      error.textContent = "合言葉を入力してね。";
      input?.focus();
      return;
    }

    button.disabled = true;
    button.textContent = "確認中…";
    error.textContent = "";
    try {
      const digest = await sha256(phrase);
      if (digest !== config.sha256) {
        error.textContent = "合言葉が違うみたい。ROOMの固定投稿をもう一度確認してね。";
        input?.select();
        return;
      }
      const days = $("#roomRemember")?.checked ? Number(config.remember_days || 30) : 0;
      rememberAccess(days);
      openRoom();
    } catch (err) {
      error.textContent = `入室確認に失敗しました。${err.message || "再読み込みしてお試しください。"}`;
    } finally {
      button.disabled = false;
      button.textContent = "観察室へ入る";
    }
  }

  async function init() {
    const gate = $("#roomGate");
    const shell = $("#roomShell");
    if (!gate || !shell) return;

    shell.hidden = true;
    gate.hidden = false;

    const input = $("#roomPassphrase");
    if (input) {
      input.setAttribute("autocapitalize", "none");
      input.setAttribute("autocorrect", "off");
      input.setAttribute("spellcheck", "false");
      input.setAttribute("autocomplete", "off");
    }

    try {
      config = await fetchConfig();
      const hint = $("#roomPassphraseHint");
      const notice = $("#roomGateNotice");
      if (hint && config.input_hint) hint.textContent = config.input_hint;
      if (notice && config.notice) notice.textContent = config.notice;

      $("#roomGateForm")?.addEventListener("submit", submitGate);
      $("#roomTogglePassword")?.addEventListener("click", () => {
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
        $("#roomTogglePassword").textContent = input.type === "password" ? "表示" : "隠す";
      });
      $("#roomLogout")?.addEventListener("click", closeRoom);

      if (hasAccess()) openRoom();
      else input?.focus();
    } catch (error) {
      $("#roomGateError").textContent = `観察室の入口を準備できませんでした。${error.message}`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
