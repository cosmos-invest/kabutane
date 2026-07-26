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
    provisional_generated_at: "2026-07-21T12:01:00Z",
    price_date: "2026-07-21",
    daily: [
      { date: "2026-07-17", close: 101 },
      { date: "2026-07-21", close: 103 },
    ],
    record: { current_price: 103 },
    provisional_signal: {
      month: "2026-07",
      price_date: "2026-07-21",
      monthly_rsi14: 49.2,
      monthly_rsi_ma5: 52.1,
      spread: -2.9,
      status: "DC",
      active: false,
      is_provisional: true,
    },
  },
);

assert.deepStrictEqual(merged.daily.map((row) => row.close), [101, 103]);
assert.strictEqual(merged.record.current_price, 103);
assert.strictEqual(merged.record.name, "A");
assert.strictEqual(merged.corporate_events.length, 1);
assert.strictEqual(merged.corporate_events[0].type, "DIVIDEND");
assert.strictEqual(merged.daily_price_date, "2026-07-21");
assert.strictEqual(merged.provisional_signal.status, "DC");
assert.strictEqual(merged.provisional_signal.monthly_rsi14, 49.2);
assert.strictEqual(merged.provisional_generated_at, "2026-07-21T12:01:00Z");
console.log("daily overlay tests passed");
