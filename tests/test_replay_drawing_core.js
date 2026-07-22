const assert = require("assert");
const Drawing = require("../assets/replay-drawing-core.js");

(function testStrengths() {
  assert.equal(Drawing.normalizeStrength("soft"), "soft");
  assert.equal(Drawing.normalizeStrength("unknown"), "normal");
  assert.ok(Drawing.strengthStyle("strong").width > Drawing.strengthStyle("soft").width);
})();

(function testFibonacciLevels() {
  const item = Drawing.createFibonacci({ index: 10, price: 100 }, { index: 20, price: 200 }, { id: "fib" });
  const levels = Drawing.fibonacciLevels(item);
  assert.equal(levels.length, 7);
  assert.equal(levels[0].price, 100);
  assert.equal(levels.at(-1).price, 200);
  assert.equal(levels.find((level) => level.ratio === 0.5).price, 150);
})();

(function testRiskRewardLevels() {
  const item = Drawing.createRiskReward({ index: 10, price: 100 }, { index: 11, price: 90 }, { id: "rr" });
  const levels = Drawing.riskRewardLevels(item);
  assert.equal(levels.direction, "long");
  assert.equal(levels.unit, 10);
  assert.deepEqual(levels.targets.map((target) => target.price), [110, 120, 130]);
})();

(function testTrendProjection() {
  const item = Drawing.createTrend({ index: 10, price: 100 }, { index: 20, price: 120 }, { id: "trend" });
  assert.equal(Drawing.trendPriceAt(item, 15), 110);
  assert.equal(Drawing.trendPriceAt(item, 25), 130);
})();

(function testCollectPrices() {
  const items = [
    Drawing.createHorizontal({ index: 5, price: 90 }, { id: "h" }),
    Drawing.createRiskReward({ index: 10, price: 100 }, { index: 11, price: 95 }, { id: "rr" }),
  ];
  const prices = Drawing.collectPrices(items);
  assert.ok(prices.includes(90));
  assert.ok(prices.includes(100));
  assert.ok(prices.includes(95));
  assert.ok(prices.includes(115));
})();

(function testNearestHorizontal() {
  const horizontal = Drawing.createHorizontal({ index: 5, price: 100 }, { id: "h" });
  const trend = Drawing.createTrend({ index: 1, price: 80 }, { index: 10, price: 90 }, { id: "t" });
  assert.equal(Drawing.nearestItem([horizontal, trend], { index: 7, price: 100.5 }, { index: 3, price: 2 }).id, "h");
  assert.equal(Drawing.nearestItem([horizontal], { index: 7, price: 120 }, { index: 3, price: 2 }), null);
})();

console.log("Replay drawing core tests passed");
