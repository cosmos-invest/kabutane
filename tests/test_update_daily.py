from __future__ import annotations

import unittest

import pandas as pd

from update_daily import build_overlay_rows, rows_by_date, update_record_price


class UpdateDailyTest(unittest.TestCase):
    def test_rows_by_date_overwrites_with_overlay(self) -> None:
        result = rows_by_date(
            [{"date": "2026-07-17", "close": 100}],
            [{"date": "2026-07-17", "close": 101}, {"date": "2026-07-21", "close": 102}],
        )
        self.assertEqual([row["close"] for row in result], [101, 102])

    def test_update_record_price(self) -> None:
        record = {"gc_price": 100, "signal_month_close": 120}
        updated = update_record_price(record, 150)
        self.assertEqual(updated["current_price"], 150.0)
        self.assertEqual(updated["return_since_gc_pct"], 50.0)
        self.assertEqual(updated["change_from_signal_month_pct"], 25.0)

    def test_build_overlay_rows_keeps_monthly_rsi(self) -> None:
        dates = pd.date_range("2025-01-01", periods=210, freq="B")
        close = pd.Series(range(100, 310), index=dates, dtype=float)
        frame = pd.DataFrame(
            {
                "Open": close - 1,
                "High": close + 2,
                "Low": close - 2,
                "Close": close,
                "Volume": 1000,
            }
        )
        rows = build_overlay_rows(frame, dates[-2].strftime("%Y-%m-%d"), 61.2, 67.4)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]["rsi14"], 61.2)
        self.assertEqual(rows[-1]["rsi5"], 67.4)
        self.assertIsNotNone(rows[-1]["sma200"])


if __name__ == "__main__":
    unittest.main()
