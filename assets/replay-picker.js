(function installReplayPickerLink() {
  "use strict";

  function currentCode() {
    return new URLSearchParams(window.location.search).get("code")?.trim() || "";
  }

  function selectionUrl(code) {
    const url = new URL("replay-select.html", window.location.href);
    if (code) url.searchParams.set("selected", code);
    return url.toString();
  }

  function updateSelectedLabel(node, code) {
    if (!node) return;
    const title = document.getElementById("replayTitle")?.textContent?.trim() || "";
    node.textContent = title && !title.includes("シミュレーター") ? title.replace(/売買練習.*$/u, "").trim() : `証券コード ${code}`;
  }

  function install() {
    const code = currentCode();
    if (!code) {
      window.location.replace(selectionUrl(""));
      return;
    }

    localStorage.setItem("kabutaneReplayCode", code);
    const setup = document.getElementById("setupPanel");
    if (!setup || document.getElementById("replaySymbolPicker")) return;

    const originalLabel = document.getElementById("replaySymbolSelect")?.closest("label");
    if (originalLabel) originalLabel.hidden = true;

    const picker = document.createElement("section");
    picker.id = "replaySymbolPicker";
    picker.className = "replay-symbol-picker-field replay-symbol-selected-card";
    picker.innerHTML = `
      <div>
        <span class="replay-symbol-picker-label">練習する銘柄</span>
        <strong id="replaySymbolCurrent">証券コード ${code}</strong>
        <small>この銘柄の日足を使って練習するよ。</small>
      </div>
      <a id="replayChangeSymbol" class="button secondary" href="${selectionUrl(code)}">銘柄を選び直す</a>`;

    const heading = setup.querySelector(":scope > .section-heading");
    if (heading) heading.insertAdjacentElement("afterend", picker);
    else setup.prepend(picker);

    const current = document.getElementById("replaySymbolCurrent");
    updateSelectedLabel(current, code);
    const title = document.getElementById("replayTitle");
    if (title) new MutationObserver(() => updateSelectedLabel(current, code)).observe(title, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
