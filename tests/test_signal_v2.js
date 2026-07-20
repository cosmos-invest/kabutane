const assert = require("assert");
const signal = require("../assets/signal-v2.js");

assert.strictEqual(signal.VERSION, "tv_wilder_rsi14_sma5_v1");
assert.strictEqual(
  signal.rewriteText("RSI5≥60・RSI14上向き"),
  "月足RSI14≥60・5か月MA上向き",
);
assert.strictEqual(
  signal.rewriteText("月足RSI5 > 月足RSI14"),
  "月足RSI14 > RSI14の5か月SMA",
);
assert.strictEqual(
  signal.rewriteText("月足RSIデッドクロス"),
  "月足RSI14・5か月MAデッドクロス",
);
assert.strictEqual(signal.rewriteText("日足RSI14"), "日足RSI14");
assert.ok(
  signal.rewriteText("RSI5とRSI14は独立した計算窓です").includes("ワイルダー方式"),
);

const legacy = { rsi5: 64.2, rsi14: 58.4, diff: 5.8 };
assert.strictEqual(signal.canonicalValue(legacy, "monthly_rsi14"), 64.2);
assert.strictEqual(signal.canonicalValue(legacy, "monthly_rsi_ma5"), 58.4);
assert.strictEqual(signal.canonicalValue(legacy, "monthly_rsi_spread"), 5.8);

const canonical = { monthly_rsi14: 61.1, monthly_rsi_ma5: 59.9 };
assert.strictEqual(signal.canonicalValue(canonical, "monthly_rsi14"), 61.1);
assert.strictEqual(signal.canonicalValue(canonical, "monthly_rsi_ma5"), 59.9);

let writes = 0;
const fakeElement = {
  value: "月足RSI14",
  get textContent() { return this.value; },
  set textContent(next) { writes += 1; this.value = next; },
};
assert.strictEqual(signal.setTextContentIfChanged(fakeElement, "月足RSI14"), false);
assert.strictEqual(writes, 0, "同じラベルを再設定してMutationObserverを再発火させない");
assert.strictEqual(signal.setTextContentIfChanged(fakeElement, "5か月MA"), true);
assert.strictEqual(writes, 1);
assert.strictEqual(signal.setTextContentIfChanged(fakeElement, "5か月MA"), false);
assert.strictEqual(writes, 1, "変更済みラベルへの再書き込みを防ぐ");

console.log("Signal v2 UI tests passed");
