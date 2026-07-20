const assert = require("assert");
const detail = require("../assets/detail-enhancements.js");

assert.strictEqual(detail.isFutureEvent({ date: "2026-08-05" }, "2026-07-20"), true);
assert.strictEqual(detail.isFutureEvent({ date: "2026-03-30" }, "2026-07-20"), false);

const payload = {
  record: {
    next_earnings_date: "2026-08-05",
    ex_dividend_date: "2026-09-29",
    forward_annual_dividend: 100,
    trailing_annual_dividend: 90,
    dividend_change_pct: 11.11,
  },
};
const highlights = detail.deriveHighlights(payload);
assert.deepStrictEqual(
  new Set(highlights.map((item) => item.label)),
  new Set(["次回決算予定日", "権利落ち予定日", "予想年間配当", "増配率"]),
);

const deduped = detail.dedupeFutureEvents(
  highlights,
  [
    { type: "EARNINGS", date: "2026-08-05", label: "決算予定" },
    { type: "RIGHTS", date: "2026-09-29", label: "権利落ち予定" },
  ],
  "2026-07-20",
);
assert.strictEqual(deduped.filter((item) => item.type === "EARNINGS").length, 1);
assert.strictEqual(deduped.filter((item) => item.type === "RIGHTS").length, 1);

console.log("Detail enhancement tests passed");
