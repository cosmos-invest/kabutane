const assert = require('assert');
const ReplayPro = require('../assets/replay-core-v2.js');

const ratios = ReplayPro.normalizeRatios([1.5, 2.2, 4.9, 5]);
assert.deepStrictEqual(ratios, [1.5, 2.2, 4.9, 5]);
assert.deepStrictEqual(ReplayPro.tpPrices(100, 90, [1.5, 2, 3, 5]), [115, 120, 130, 150]);

const ha = ReplayPro.heikinAshi([
  { open: 100, high: 110, low: 90, close: 108 },
  { open: 108, high: 115, low: 105, close: 112 },
]);
assert.strictEqual(ha[0].close, 102);
assert.strictEqual(ha[0].open, 104);
assert.strictEqual(ha[1].open, 103);

assert.strictEqual(ReplayPro.barTouches({ low: 95, high: 105 }, 100), true);
assert.strictEqual(ReplayPro.barTouches({ low: 101, high: 105 }, 100), false);

let result = ReplayPro.evaluateBracketBar({
  row: { open: 100, high: 121, low: 89 },
  entryArmed: false,
  positionOpen: true,
  entry: 100,
  stop: 90,
  tpLevels: [115, 120, 130, 150],
  hitTargets: [false, false, false, false],
});
assert.strictEqual(result.action, 'STOP', 'same candle must prefer stop over targets');

result = ReplayPro.evaluateBracketBar({
  row: { open: 101, high: 122, low: 98 },
  entryArmed: false,
  positionOpen: true,
  entry: 100,
  stop: 90,
  tpLevels: [115, 120, 130, 150],
  hitTargets: [false, false, false, false],
});
assert.strictEqual(result.action, 'TARGETS');
assert.deepStrictEqual(result.targets.map((item) => item.index), [0, 1]);

result = ReplayPro.evaluateBracketBar({
  row: { open: 99, high: 103, low: 97 },
  entryArmed: true,
  positionOpen: false,
  entry: 100,
  stop: 90,
  tpLevels: [],
  hitTargets: [],
});
assert.strictEqual(result.action, 'ENTRY');
assert.strictEqual(result.price, 100);

const plan = ReplayPro.positionPlan({ assets: 3000000, allocationPct: 20, riskPct: 1, entry: 1000, stop: 900, lotSize: 100, costBps: 0 });
assert.strictEqual(plan.maxByAllocation, 600);
assert.strictEqual(plan.maxByRisk, 300);
assert.strictEqual(plan.recommendedShares, 300);

console.log('Replay Pro tests passed');
