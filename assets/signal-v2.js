const SignalV2 = (() => {
  const VERSION = "tv_wilder_rsi14_sma5_v1";
  const FAST_LABEL = "月足RSI14";
  const SLOW_LABEL = "RSI14・5か月MA";

  function rewriteText(input) {
    if (input === null || input === undefined) return input;
    let text = String(input);
    if (!/RSI|ツインエンジン|デッドクロス|ゴールデンクロス/.test(text)) return text;

    if (text.includes("独立した計算窓") || text.includes("計算期間が異なるので")) {
      return "月足RSI14はTradingViewと同じワイルダー方式で計算し、5か月MAはそのRSI14の直近5か月単純平均です。RSI14がMAを上回る間を継続、MA以下へ戻るとOUTとして扱います。";
    }

    const tokens = {
      DAILY: "@@SIGNAL_DAILY_RSI14@@",
      FAST: "@@SIGNAL_MONTHLY_RSI14@@",
      SLOW: "@@SIGNAL_MONTHLY_RSI_MA5@@",
      RAW: "@@SIGNAL_RAW_RSI14@@",
      CONDITION: "@@SIGNAL_CONDITION@@",
    };

    text = text
      .replaceAll("日足RSI14", tokens.DAILY)
      .replaceAll("月足RSI14 × RSI14の5か月SMA", tokens.CONDITION)
      .replaceAll("月足RSI14 > RSI14の5か月SMA", tokens.CONDITION)
      .replaceAll("月足RSI5 > 月足RSI14", tokens.CONDITION)
      .replaceAll("RSI14・5か月MA", tokens.SLOW)
      .replaceAll("RSI14の5か月SMA", tokens.SLOW)
      .replaceAll("RSI14の5か月MA", tokens.SLOW)
      .replaceAll("Wilder RSI14", `Wilder ${tokens.RAW}`)
      .replaceAll("ワイルダー方式のRSI14", `ワイルダー方式の${tokens.RAW}`)
      .replaceAll("TradingView方式のRSI14", `TradingView方式の${tokens.RAW}`)
      .replaceAll("月足RSI5 / RSI14", `${tokens.FAST} / ${tokens.SLOW}`)
      .replaceAll("月足RSI5・RSI14", `${tokens.FAST}・${tokens.SLOW}`)
      .replaceAll("月足RSI5", tokens.FAST)
      .replaceAll("月足RSI14", tokens.FAST)
      .replaceAll("RSI5がRSI14以下", `${tokens.FAST}が5か月MA以下`)
      .replaceAll("RSI5がRSI14を上回る", `${tokens.FAST}が5か月MAを上回る`)
      .replaceAll("RSI5がRSI14", `${tokens.FAST}が5か月MA`)
      .replaceAll("RSI5≥60・RSI14上向き", `${tokens.FAST}≥60・5か月MA上向き`)
      .replaceAll("RSI5が60以上", `${tokens.FAST}が60以上`)
      .replaceAll("RSI14が上向き", "5か月MAが上向き")
      .replaceAll("RSI14上向き", "5か月MA上向き")
      .replaceAll("RSI5 最低値", `${tokens.FAST} 最低値`)
      .replaceAll("RSI5", tokens.FAST)
      .replaceAll("RSI14", tokens.SLOW)
      .replaceAll("月足RSIツインエンジン", "月足RSI14・5か月MAクロス")
      .replaceAll("月足RSIデッドクロス", "月足RSI14・5か月MAデッドクロス")
      .replaceAll("月足RSIゴールデンクロス", "月足RSI14・5か月MAゴールデンクロス");

    return text
      .replaceAll(tokens.CONDITION, "月足RSI14 > RSI14の5か月SMA")
      .replaceAll(tokens.FAST, FAST_LABEL)
      .replaceAll(tokens.SLOW, SLOW_LABEL)
      .replaceAll(tokens.DAILY, "日足RSI14")
      .replaceAll(tokens.RAW, "RSI14");
  }

  function canonicalValue(row, key) {
    if (!row || typeof row !== "object") return null;
    const aliases = {
      monthly_rsi14: ["monthly_rsi14", "rsi5"],
      monthly_rsi_ma5: ["monthly_rsi_ma5", "rsi14"],
      monthly_rsi14_up: ["monthly_rsi14_up", "rsi5_up"],
      monthly_rsi_ma5_up: ["monthly_rsi_ma5_up", "rsi14_up"],
      monthly_rsi_spread: ["monthly_rsi_spread", "diff"],
    };
    const candidates = aliases[key] || [key];
    for (const candidate of candidates) {
      if (row[candidate] !== null && row[candidate] !== undefined && row[candidate] !== "") return row[candidate];
    }
    return null;
  }

  function rewriteNode(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const next = rewriteText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;
    if (["SCRIPT", "STYLE", "TEXTAREA"].includes(element.tagName)) return;
    if (element.hasAttribute("data-signal-canonical")) return;
    ["title", "aria-label", "placeholder"].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      const current = element.getAttribute(attribute);
      const next = rewriteText(current);
      if (next !== current) element.setAttribute(attribute, next);
    });
    [...element.childNodes].forEach(rewriteNode);
  }

  function setControlLabel(id, text) {
    const control = document.getElementById(id);
    if (!control) return;
    const group = control.closest(".control-group") || control.closest("label");
    const label = group?.matches("label") ? group : group?.querySelector("label");
    if (!label) return;
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
    if (textNode) textNode.nodeValue = text;
  }

  function normalizeKnownControls() {
    document.querySelectorAll('[data-key="rsi5"]').forEach((element) => { element.textContent = FAST_LABEL; });
    document.querySelectorAll('[data-key="rsi14"]').forEach((element) => { element.textContent = "5か月MA"; });
    setControlLabel("rsi5Min", FAST_LABEL);
    setControlLabel("rsi14Min", SLOW_LABEL);
    setControlLabel("rsi5Trend", `${FAST_LABEL}の向き`);
    setControlLabel("rsi14Trend", "5か月MAの向き");
    setControlLabel("requireRsi14Up", "5か月MAが上向き");
  }

  function rewriteCharts() {
    if (!window.Chart || !window.Chart.instances) return;
    Object.values(window.Chart.instances).forEach((chart) => {
      let changed = false;
      const canvasId = chart.canvas?.id || "";
      (chart.data?.datasets || []).forEach((dataset) => {
        if (!dataset.label) return;
        let next;
        if (canvasId === "oscillatorChart" && dataset.label === "RSI14") next = "日足RSI14";
        else if (dataset.label === "RSI5" || dataset.label === "月足RSI5") next = FAST_LABEL;
        else if (dataset.label === "RSI14" || dataset.label === "月足RSI14") next = SLOW_LABEL;
        else next = rewriteText(dataset.label);
        if (next !== dataset.label) {
          dataset.label = next;
          changed = true;
        }
      });
      if (changed) chart.update("none");
    });
  }

  function installStyles() {
    if (document.getElementById("signalV2Styles")) return;
    const style = document.createElement("style");
    style.id = "signalV2Styles";
    style.textContent = `
      .signal-method-card{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 18px;padding:18px 20px;border:1px solid rgba(226,127,176,.42);border-radius:18px;background:linear-gradient(120deg,rgba(255,255,255,.96),rgba(255,232,245,.92),rgba(239,238,255,.92));box-shadow:0 13px 34px rgba(177,105,147,.12)}
      .signal-method-card h2{margin:5px 0 5px;font-size:1.06rem}.signal-method-card p{margin:0;color:#7c6575;line-height:1.65;font-size:.83rem}.signal-method-kicker{font-size:.69rem;font-weight:900;letter-spacing:.08em;color:#aa4b7d}.signal-method-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}.signal-version-badge{display:inline-flex;padding:7px 11px;border-radius:999px;font-size:.72rem;font-weight:900;white-space:nowrap;background:#f2edf7;color:#806a7a;border:1px solid #ddd0e2}.signal-version-badge.ready{background:#ffe5f1;color:#9f3f72;border-color:#efbfd5}.signal-version-badge.stale{background:#fff0d8;color:#9a5e11;border-color:#edc985}.signal-version-badge.error{background:#edf4f8;color:#56778a;border-color:#cadae3}.signal-method-link{display:inline-flex;padding:8px 12px;border-radius:999px;text-decoration:none;color:#8d4770;background:#fff;border:1px solid #e8c8d8;font-size:.74rem;font-weight:850}.signal-stale-warning{margin:12px 0 0;padding:12px 14px;border-radius:13px;color:#8b5310;background:#fff4df;border:1px solid #edca8e;font-weight:800}.signal-data-stale main>:not(.signal-method-card){opacity:.38;filter:grayscale(.18);pointer-events:none;user-select:none}@media(max-width:720px){.signal-method-card{align-items:flex-start;flex-direction:column;padding:15px}.signal-method-actions{justify-content:flex-start}.signal-method-link{width:100%;justify-content:center}}
    `;
    document.head.appendChild(style);
  }

  function injectMethodCard() {
    const main = document.querySelector("main");
    if (!main || document.querySelector(".signal-method-card")) return null;
    const section = document.createElement("section");
    section.className = "signal-method-card";
    section.setAttribute("data-signal-canonical", "true");
    section.innerHTML = `
      <div>
        <span class="signal-method-kicker">OFFICIAL SIGNAL DEFINITION</span>
        <h2>TradingView方式の月足RSI14と、その5か月移動平均で統一</h2>
        <p>完成済み月足の終値からWilder RSI14を計算し、RSI14が5か月SMAを上回る期間を対象とします。</p>
        <div id="signalStaleWarning" class="signal-stale-warning" hidden></div>
      </div>
      <div class="signal-method-actions">
        <span id="signalVersionBadge" class="signal-version-badge">データ方式を確認中…</span>
        <a class="signal-method-link" href="signal-method.html">計算方法を見る</a>
      </div>`;
    main.prepend(section);
    return section;
  }

  async function verifyDataVersion() {
    const badge = document.getElementById("signalVersionBadge");
    const warning = document.getElementById("signalStaleWarning");
    try {
      const response = await fetch(`data/latest.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.signal_version !== VERSION) {
        document.body.classList.add("signal-data-stale");
        if (badge) {
          badge.textContent = "旧方式データ・更新待ち";
          badge.className = "signal-version-badge stale";
        }
        if (warning) {
          warning.hidden = false;
          warning.textContent = "現在公開中のJSONは旧RSI5対RSI14方式です。新方式の全銘柄再計算が完了するまで、数値・対象銘柄・バックテストを操作できません。";
        }
        return false;
      }
      document.body.classList.remove("signal-data-stale");
      if (badge) {
        badge.textContent = "TradingView方式で統一済み";
        badge.className = "signal-version-badge ready";
      }
      return true;
    } catch (error) {
      if (badge) {
        badge.textContent = "データ方式を確認できません";
        badge.className = "signal-version-badge error";
      }
      if (warning) {
        warning.hidden = false;
        warning.textContent = `計算方式の確認に失敗しました: ${error.message}`;
      }
      return false;
    }
  }

  function refreshUi() {
    rewriteNode(document.body);
    normalizeKnownControls();
    rewriteCharts();
  }

  function startObserver() {
    refreshUi();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach(rewriteNode));
      normalizeKnownControls();
      rewriteCharts();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let attempts = 0;
    const timer = setInterval(() => {
      refreshUi();
      attempts += 1;
      if (attempts >= 20) clearInterval(timer);
    }, 350);
  }

  async function init() {
    installStyles();
    injectMethodCard();
    const current = await verifyDataVersion();
    if (current) startObserver();
  }

  return { VERSION, FAST_LABEL, SLOW_LABEL, rewriteText, canonicalValue, init };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SignalV2;
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", SignalV2.init, { once: true });
  else SignalV2.init();
}
