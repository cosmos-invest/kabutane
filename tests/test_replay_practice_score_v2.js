const assert = require("assert");
const Score = require("../assets/replay-practice-score-v2.js");

const rows = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-07-${String(index + 1).padStart(2, "0")}`,
  low: index === 0 ? 99 : 100 + index * 0.7,
  high: 101 + index * 1.1,
  close: 100 + index,
}));

const disciplinedTrades = [
  {
    date: "2026-07-01", type: "BUY", price: 100, shares: 100, memo: "押し目を確認",
    decision: {
      thesis: "pullback", eventContext: "normal", planStatus: "planned", plannedSplitCount: 1,
      stopAtDecision: 95, targetAtDecision: 110, plannedShares: 100, allowedRiskPct: 1,
      allowedAllocationPct: 20, positionRiskPct: 0.5, allocationUsedPct: 10,
    },
  },
  {
    date: "2026-07-08", type: "SELL", price: 110, shares: 100, remainingSharesAfter: 0,
    decision: { exitReason: "planned_target", planStatus: "planned", executionKind: "target", remainingStopDecision: "none" },
  },
];

const strong = Score.calculate({
  trades: disciplinedTrades,
  rows,
  riskPct: 1,
  allocationPct: 20,
  audit: {
    stopWidened: false, planChanged: false, reviewed: true, plannedShares: 100,
    peakShares: 100, positionRiskPct: 0.5, allocationUsedPct: 10,
  },
});
assert.strictEqual(strong.version, 2);
assert.ok(strong.score >= 85, `disciplined score should be high: ${strong.score}`);
assert.ok(strong.timing.points <= 5);

const reckless = Score.calculate({
  trades: [{
    date: "2026-07-01", type: "BUY", price: 100, shares: 500,
    decision: { thesis: "", eventContext: "unknown", planStatus: "emotion", stopAtDecision: null, targetAtDecision: null, plannedShares: 100, plannedSplitCount: 1 },
  }],
  rows,
  riskPct: 1,
  allocationPct: 20,
  audit: { stopWidened: true, planChanged: true, planChangesRecorded: false, reviewed: false, plannedShares: 100, peakShares: 500, positionRiskPct: 5, allocationUsedPct: 60 },
});
assert.ok(reckless.score < 40, `reckless score should stay low: ${reckless.score}`);

const timing = Score.entryTiming(disciplinedTrades[0], rows);
assert.ok(timing.points >= 1 && timing.points <= 5);
console.log("Replay practice score v2 tests passed");
