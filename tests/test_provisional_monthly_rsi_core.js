const assert = require("node:assert/strict");
const Core = require("../assets/provisional-monthly-rsi-core.js");

function monthlyRows(closes) {
  const rows = [];
  const startYear = 2024;
  const startMonth = 8;
  closes.forEach((close, index) => {
    const zeroBased = startMonth - 1 + index;
    const year = startYear + Math.floor(zeroBased / 12);
    const month = zeroBased % 12 + 1;
    const day = index === closes.length - 1 ? 24 : 28;
    rows.push({ date: `${year}-${String(month).padStart(2, "0")}-${day}`, close });
  });
  return rows;
}

const grouped = Core.monthlyCloses([
  { date: "2026-06-01", close: 100 },
  { date: "2026-06-30", close: 120 },
  { date: "2026-07-01", close: 118 },
  { date: "2026-07-24", close: 90 },
]);
assert.deepEqual(grouped.map((row) => [row.month, row.close]), [["2026-06", 120], ["2026-07", 90]]);

const closes = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126,
  128, 130, 132, 134, 136, 138, 140, 142, 144, 80];
const provisional = Core.calculate(
  monthlyRows(closes),
  { signal_month: "2026-06", status: "CONTINUE" },
  "2026-07-24",
);
assert.equal(provisional.month, "2026-07");
assert.equal(provisional.status, "DC");
assert.equal(provisional.active, false);
assert.equal(provisional.changed_from_confirmed, true);
assert.equal(provisional.monthly_rsi14, 28.89);
assert.equal(provisional.monthly_rsi_ma5, 85.78);
assert.equal(Core.statusLabel(provisional), "暫定DC");

const stored = Core.fromPayload({
  provisional_signal: {
    month: "2026-07",
    monthly_rsi14: 48.2,
    monthly_rsi_ma5: 51.3,
    spread: -3.1,
    status: "DC",
    active: false,
  },
});
assert.equal(stored.status, "DC");
assert.equal(stored.monthly_rsi14, 48.2);

assert.equal(Core.calculate(monthlyRows(closes), { signal_month: "2026-07", status: "CONTINUE" }, "2026-07-24"), null);
console.log("provisional monthly RSI core tests passed");
