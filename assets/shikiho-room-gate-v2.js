(function () {
  "use strict";

  const ACCESS_KEY = "kabutane-shikiho-2026-summer-access-v1";
  const SESSION_KEY = `${ACCESS_KEY}-session`;
  const MIGRATION_KEY = "kabutane-shikiho-2026-summer-gate-v2-migrated";

  // Invalidate the one-time access granted by the former Japanese passphrase.
  // The room script will store a fresh session after the new ASCII phrase is checked.
  try {
    if (localStorage.getItem(MIGRATION_KEY) !== "1") {
      localStorage.removeItem(ACCESS_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.setItem(MIGRATION_KEY, "1");
    }
  } catch {
    // Storage may be unavailable in a private browser. The gate still works.
  }

  document.addEventListener("DOMContentLoaded", () => {
    const input = document.querySelector("#shikihoPassphrase");
    const error = document.querySelector("#shikihoGateError");
    if (input) {
      input.setAttribute("autocapitalize", "none");
      input.setAttribute("autocorrect", "off");
      input.setAttribute("spellcheck", "false");
      input.setAttribute("autocomplete", "off");
    }
    if (!error) return;
    const replaceLegacyMessage = () => {
      if (error.textContent.includes("全角カタカナ")) {
        error.textContent = "合言葉が違うみたい。半角英数字とアンダースコアで、もう一度確認してね。";
      }
    };
    new MutationObserver(replaceLegacyMessage).observe(error, { childList: true, characterData: true, subtree: true });
    replaceLegacyMessage();
  });
})();
