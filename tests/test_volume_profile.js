const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "detail-volume-profile.js"), "utf8");
const sandbox = {
  console,
  window: {},
  document: {
    readyState: "loading",
    addEventListener() {},
  },
};
vm.runInNewContext(source, sandbox, { filename: "detail-volume-profile.js" });
const api = sandbox.window.KabutaneVolumeProfile;
assert.ok(api, "volume profile API should be exported to window");

(function testOverlapWeightingAndVolumeConservation() {
  const rows = [
    { date: "2026-01-01", low: 0, high: 28, volume: 100 },
    { date: "2026-01-02", low: 0, high: 1.01, volume: 100 },
  ];
  const profile = api.buildProfile(rows);
  assert.ok(profile);
  assert.ok(Math.abs(profile.total - 200) < 1e-8, `profile total should preserve source volume: ${profile.total}`);
  assert.ok(Math.abs(profile.sourceVolume - 200) < 1e-8);
  assert.ok(profile.bins[0].volume > profile.bins[1].volume * 10,
    `99%/1% overlap must not be split 50/50: ${profile.bins[0].volume} vs ${profile.bins[1].volume}`);
})();

(function testMissingValuesDoNotBecomeZeroPriceRows() {
  const rows = [
    { date: "2026-01-01", low: 100, high: 110, volume: 1000 },
    { date: "2026-01-02", low: 110, high: 120, volume: 1000 },
    { date: "2026-01-03", low: null, high: 999, volume: 999999 },
  ];
  const profile = api.buildProfile(rows);
  assert.ok(profile);
  assert.ok(Math.abs(profile.sourceVolume - 2000) < 1e-8, `missing low row must be excluded: ${profile.sourceVolume}`);
  assert.ok(profile.bins[0].low >= 100, `minimum price must not collapse to zero: ${profile.bins[0].low}`);
})();

(function testZeroRangeCandleKeepsFullVolume() {
  const rows = [
    { date: "2026-01-01", low: 100, high: 128, volume: 2800 },
    { date: "2026-01-02", low: 114, high: 114, volume: 700 },
  ];
  const profile = api.buildProfile(rows);
  assert.ok(profile);
  assert.ok(Math.abs(profile.total - 3500) < 1e-8, `zero-range candle volume must be preserved: ${profile.total}`);
  assert.ok(Math.abs(profile.sourceVolume - 3500) < 1e-8);
})();

console.log("volume profile allocation tests passed");
