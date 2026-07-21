(() => {
  if (typeof CONDITION_LABELS !== "undefined") {
    Object.assign(CONDITION_LABELS, {
      rsi: "月足の勢い",
      sepa: "上昇トレンド",
      vcp: "値動きの収束",
      mvp: "勢いの点火",
      high: "高値への近さ",
      finance: "財務の安定",
    });
  }

  if (typeof renderCards === "function") {
    const original = renderCards;
    renderCards = function renderKabutaneCards(rows) {
      original(rows);
      document.querySelectorAll(".candidate-metrics > div:first-child span").forEach((node) => {
        node.textContent = "月足RSI14";
      });
      document.querySelectorAll(".candidate-metrics > div:nth-child(3) span").forEach((node) => {
        node.textContent = "シグナル後";
      });
      document.querySelectorAll(".candidate-footer small").forEach((node) => {
        node.textContent = node.textContent.replace("条件一致", "当てはまる特徴");
      });
    };
  }
})();
