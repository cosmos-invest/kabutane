const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("assets/backtest.js", "utf8");
const sandbox = {
  console,
  document: {
    getElementById: () => ({}),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  },
  window: { setTimeout: (callback) => callback() },
  Intl,
  Date,
  Math,
  Map,
  Number,
  String,
  Array,
  Object,
};
vm.createContext(sandbox);
vm.runInContext(`${source}
state.data = {
  benchmarks: {
    TOPIX: {
      name: "TOPIX",
      returns: [
        {month: "2024-02", return_pct: 1},
        {month: "2024-03", return_pct: 2},
        {month: "2024-04", return_pct: -1},
      ],
    },
  },
};
state.episodes = [
  {
    code: "1", name: "A", start_month: "2024-01",
    start_rsi5: 70, start_rsi14_up: true, start_rsi_strength: 10,
    monthly_returns: [
      {month: "2024-02", return_pct: 10, exit: false},
      {month: "2024-03", return_pct: 5, exit: false},
      {month: "2024-04", return_pct: -2, exit: true},
    ],
  },
  {
    code: "2", name: "B", start_month: "2024-01",
    start_rsi5: 65, start_rsi14_up: true, start_rsi_strength: 8,
    monthly_returns: [
      {month: "2024-02", return_pct: -5, exit: true},
    ],
  },
];
const base = {
  entryMode: "preset", preset: "rsi", rankBy: "rsi", maxPositions: 5,
  initialCapital: 1000000, costBps: 20, benchmark: "TOPIX",
  startMonth: "2024-01", endMonth: "2024-04",
};
globalThis.strictResult = simulate({...base, exitRule: "H3", horizonMode: "strict"});
globalThis.fallbackResult = simulate({...base, exitRule: "H3", horizonMode: "fallback"});
globalThis.oneMonthResult = simulate({...base, exitRule: "H1", horizonMode: "strict"});
`, sandbox);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(sandbox.strictResult.eligibleCount === 1, "3か月継続の厳格条件はAだけを採用する");
assert(sandbox.strictResult.trades.length === 1, "厳格3か月出口は1取引を決済する");
assert(sandbox.strictResult.metrics.finalEquity > 1000000, "Aの上昇を資産へ反映する");
assert(sandbox.fallbackResult.eligibleCount === 2, "途中DC許容ではAとBを採用する");
assert(sandbox.fallbackResult.trades.length === 2, "途中DCを早期退出として決済する");
assert(sandbox.oneMonthResult.eligibleCount === 2, "1か月後の月末価格がある2銘柄を採用する");
assert(sandbox.oneMonthResult.metrics.cumulative !== null, "累積リターンを計算する");

console.log("backtest engine smoke test passed");
