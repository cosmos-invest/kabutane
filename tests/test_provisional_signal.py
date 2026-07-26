from __future__ import annotations

import unittest

from provisional_signal import calculate_provisional_signal, monthly_closes, rows_by_date


class ProvisionalSignalTest(unittest.TestCase):
    def monthly_rows(self, closes: list[float]) -> list[dict[str, object]]:
        year = 2024
        month = 8
        rows: list[dict[str, object]] = []
        for index, close in enumerate(closes):
            current_year = year + (month - 1 + index) // 12
            current_month = (month - 1 + index) % 12 + 1
            day = 24 if index == len(closes) - 1 else 28
            rows.append({"date": f"{current_year:04d}-{current_month:02d}-{day:02d}", "close": close})
        return rows

    def test_rows_by_date_prefers_latest_group(self) -> None:
        result = rows_by_date(
            [{"date": "2026-07-23", "close": 100}],
            [{"date": "2026-07-23", "close": 101}, {"date": "2026-07-24", "close": 98}],
        )
        self.assertEqual([row["close"] for row in result], [101, 98])

    def test_monthly_closes_uses_last_daily_close(self) -> None:
        closes = monthly_closes([
            {"date": "2026-06-01", "close": 100},
            {"date": "2026-06-30", "close": 120},
            {"date": "2026-07-01", "close": 118},
            {"date": "2026-07-24", "close": 90},
        ])
        self.assertEqual(closes.loc["2026-06"], 120)
        self.assertEqual(closes.loc["2026-07"], 90)

    def test_active_confirmed_signal_can_be_provisional_dc(self) -> None:
        closes = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126,
                  128, 130, 132, 134, 136, 138, 140, 142, 144, 80]
        result = calculate_provisional_signal(
            self.monthly_rows(closes),
            {"signal_month": "2026-06", "status": "CONTINUE"},
            "2026-07-24",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["month"], "2026-07")
        self.assertEqual(result["status"], "DC")
        self.assertTrue(result["changed_from_confirmed"])
        self.assertFalse(result["active"])
        self.assertAlmostEqual(result["monthly_rsi14"], 28.89, places=2)
        self.assertAlmostEqual(result["monthly_rsi_ma5"], 85.78, places=2)
        self.assertAlmostEqual(result["spread"], -56.89, places=2)

    def test_same_month_as_confirmed_is_not_provisional(self) -> None:
        closes = [100 + index for index in range(24)]
        result = calculate_provisional_signal(
            self.monthly_rows(closes),
            {"signal_month": "2026-07", "status": "CONTINUE"},
            "2026-07-24",
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
