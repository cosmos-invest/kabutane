const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

const sessionSource = fs.readFileSync(path.join(__dirname, '../assets/replay-session-v2.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../assets/replay-v2.css'), 'utf8');
assert.ok(sessionSource.includes('state.chartView'), 'chart viewport state must be installed');
assert.ok(sessionSource.includes('visibleRows = function visibleRowsTerminal'), 'fixed candle window must replace accumulating rows');
assert.ok(sessionSource.includes('pointermove'), 'touch and mouse panning must be wired');
assert.ok(sessionSource.includes('mobileTradingTerminal'), 'mobile trading terminal must be injected');
assert.ok(sessionSource.includes('mobileBuyButton') && sessionSource.includes('mobileSellButton'), 'mobile buy/sell controls must be wired');
assert.ok(cssSource.includes('.mode-switch .button:not(.active)'), 'inactive candle mode must have transparent styling');
assert.ok(cssSource.includes('body.terminal-session-active'), 'mobile terminal layout must activate during practice');

console.log('Replay Pro tests passed');
