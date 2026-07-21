(function () {
  "use strict";

  function installStyles() {
    if (document.getElementById("benchmarkStatusStyles")) return;
    const style = document.createElement("style");
    style.id = "benchmarkStatusStyles";
    style.textContent = ".benchmark-status{display:block;margin-top:5px;color:#6d7d89;font-size:.66rem;line-height:1.45}.benchmark-status.warning{color:#a05d32}.portfolio-controls option:disabled{color:#aaa}";
    document.head.appendChild(style);
  }

  function installNotice() {
    const select = document.getElementById("benchmarkSelect");
    if (!select || document.getElementById("benchmarkStatus")) return null;
    const note = document.createElement("small");
    note.id = "benchmarkStatus";
    note.className = "benchmark-status";
    note.textContent = "比較指数を確認しています…";
    select.closest("label")?.appendChild(note);
    return note;
  }

  function applyStatus() {
    if (typeof state === "undefined" || !state.data) return false;
    const select = document.getElementById("benchmarkSelect");
    const note = document.getElementById("benchmarkStatus") || installNotice();
    if (!select || !note) return true;

    const definition = state.data.benchmarks?.TOPIX || {};
    const returns = Array.isArray(definition.returns) ? definition.returns : [];
    const option = [...select.options].find((item) => item.value === "TOPIX");
    const source = definition.source_ticker || "取得元なし";
    const proxy = definition.is_proxy === true;
    const label = proxy ? `TOPIX連動ETF代替（${source}）` : `TOPIX（${source}）`;

    if (option) {
      option.disabled = returns.length === 0;
      option.textContent = returns.length ? `${label}・${returns.length}か月` : "TOPIX（データ取得不可）";
    }

    if (!returns.length) {
      note.textContent = "TOPIX履歴が取得できないため、日経平均へ切り替えました。";
      note.classList.add("warning");
      if (select.value === "TOPIX") {
        select.value = "NIKKEI225";
        if (typeof run === "function") run();
      }
      return true;
    }

    note.textContent = `${label}の調整済み価格を使用・${returns[0]?.month || "—"}〜${returns.at(-1)?.month || "—"}`;
    note.classList.remove("warning");
    if (select.value === "TOPIX" && typeof run === "function") run();
    return true;
  }

  installStyles();
  installNotice();
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (applyStatus() || attempts >= 80) window.clearInterval(timer);
  }, 150);
})();
