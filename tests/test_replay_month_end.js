const assert = require("assert");
const { monthKey, findNextMonthEndIndex } = require("../assets/replay-month-end.js");

const rows = [
  { date: "2026-01-29" },
  { date: "2026-01-30" },
  { date: "2026-02-02" },
  { date: "2026-02-27" },
  { date: "2026-03-02" },
  { date: "2026-03-31" },
];

assert.strictEqual(monthKey("2026-07-21"), "2026-07");
assert.strictEqual(findNextMonthEndIndex(rows, 0), 1, "current month end");
assert.strictEqual(findNextMonthEndIndex(rows, 1), 3, "next month end when already at month end");
assert.strictEqual(findNextMonthEndIndex(rows, 2), 3, "remaining days in current month");
assert.strictEqual(findNextMonthEndIndex(rows, 3), 5, "next complete month");
assert.strictEqual(findNextMonthEndIndex(rows, 5), 5, "last row remains last row");
assert.strictEqual(findNextMonthEndIndex([], 0), -1, "empty data");

console.log("Replay month-end skip tests passed");
