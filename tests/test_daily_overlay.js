const assert = require("assert");
const daily = require("../assets/daily-overlay.js");

const merged = daily.mergePayload(
  {
    daily: [{ date: "2026-07-17", close: 100 }],
    record: { current_price: 100, name: "A" },
    corporate_events: [
      { date: "2026-08-01", type: "EARNINGS", label: "決算" },
      { date: "2026-06-01", type: "DIVIDEND", detail: "1株 10円" },
    ],
  },
  {
    generated_at: "2026-07-21T12:00:00Z",
    price_date: "2026-07-21",
    daily: [
      { date: "2026-07-17", close: 101 },
      { date: "2026-07-21", close: 103 },
    ],
    record: { current_price: 103 },
  },
);

assert.deepStrictEqual(merged.daily.map((row) => row.close), [101, 103]);
assert.strictEqual(merged.record.current_price, 103);
assert.strictEqual(merged.record.name, "A");
assert.strictEqual(merged.corporate_events.length, 1);
assert.strictEqual(merged.corporate_events[0].type, "DIVIDEND");
assert.strictEqual(merged.daily_price_date, "2026-07-21");
console.log("daily overlay tests passed");
