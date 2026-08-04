const assert = require("node:assert/strict");
const profile = require("../assets/detail-volume-profile.js");

function approx(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

(function testMergeRowsOverlayWinsAndSorts() {
  const merged = profile.mergeRows(
    [
      { date: "2026-08-01", close: 100, volume: 1000 },
      { date: "2026-08-02", close: 101, volume: 1100 },
    ],
    [
      { date: "2026-08-02", close: 102, volume: 1200 },
      { date: "2026-08-03", close: 103, volume: 1300 },
    ],
  );
  assert.deepEqual(merged.map((row) => row.date), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.equal(merged[1].close, 102);
  assert.equal(merged[1].volume, 1200);
})();

(function testVolumeIsConserved() {
  const rows = [
    { date: "2026-07-01", low: 90, high: 110, close: 100, volume: 1000 },
    { date: "2026-07-02", low: 95, high: 115, close: 110, volume: 2000 },
    { date: "2026-07-03", low: 100, high: 120, close: 115, volume: 3000 },
  ];
  const result = profile.buildProfile(rows, { binCount: 12, lookback: 120 });
  assert.ok(result);
  assert.equal(result.binCount, 12);
  approx(result.inputVolume, 6000);
  approx(result.totalVolume, 6000);
  approx(result.bins.reduce((sum, bin) => sum + bin.volume, 0), 6000);
})();

(function testConcentratedRangeBecomesPoc() {
  const rows = [
    { date: "2026-07-01", low: 100, high: 104, close: 102, volume: 1000 },
    { date: "2026-07-02", low: 100, high: 104, close: 103, volume: 9000 },
    { date: "2026-07-03", low: 118, high: 122, close: 121, volume: 500 },
  ];
  const result = profile.buildProfile(rows, { binCount: 11 });
  assert.ok(result);
  assert.ok(result.poc.low < 105, `POC should remain near the heavy 100-104 band, got ${result.poc.low}-${result.poc.high}`);
  assert.ok(result.poc.high <= 106);
})();

(function testValueAreaCoversAtLeastSeventyPercent() {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    low: 100 + (index % 5),
    high: 105 + (index % 5),
    close: 103 + (index % 5),
    volume: 1000 + index * 50,
  }));
  const result = profile.buildProfile(rows, { binCount: 16 });
  assert.ok(result?.valueArea);
  assert.ok(result.valueArea.volume / result.totalVolume >= 0.7);
  assert.ok(result.valueArea.low <= result.poc.low);
  assert.ok(result.valueArea.high >= result.poc.high);
})();

(function testFlatRangeGoesIntoSingleBin() {
  const result = profile.buildProfile([
    { date: "2026-07-01", low: 100, high: 100, close: 100, volume: 2500 },
  ], { binCount: 10 });
  assert.ok(result);
  approx(result.totalVolume, 2500);
  assert.equal(result.bins.filter((bin) => bin.volume > 0).length, 1);
})();

(function testPricePosition() {
  const base = { valueArea: { low: 100, high: 120 } };
  assert.equal(profile.pricePosition({ ...base, currentPrice: 130 }), "above");
  assert.equal(profile.pricePosition({ ...base, currentPrice: 90 }), "below");
  assert.equal(profile.pricePosition({ ...base, currentPrice: 110 }), "inside");
})();

(function testCurrentBinIndex() {
  const sample = {
    currentPrice: 110,
    bins: [
      { low: 90, high: 100 },
      { low: 100, high: 110 },
      { low: 110, high: 120 },
    ],
  };
  assert.equal(profile.currentBinIndex(sample), 2);
})();

console.log("Estimated volume profile v1 tests passed");
