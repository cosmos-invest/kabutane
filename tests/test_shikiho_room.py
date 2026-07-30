from __future__ import annotations

import json
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

import build_shikiho_room as room


class ShikihoRoomTests(unittest.TestCase):
    def test_manifest_has_expected_fixed_tiers(self) -> None:
        manifest = json.loads(Path("data/curated/shikiho-2026-summer.json").read_text(encoding="utf-8"))
        stocks = manifest["stocks"]
        self.assertEqual(manifest["baseline_date"], "2026-06-18")
        self.assertEqual(manifest["answer_target_date"], "2026-08-31")
        self.assertEqual(len(stocks), 20)
        self.assertEqual(sum(stock["tier"] == "S" for stock in stocks), 5)
        self.assertEqual(sum(stock["tier"] == "A" for stock in stocks), 5)
        self.assertEqual(sum(stock["tier"] == "B" for stock in stocks), 10)
        self.assertEqual([stock["code"] for stock in stocks[:5]], ["6741", "7685", "6238", "7186", "9766"])
        self.assertNotIn("プリクラ", Path("assets/shikiho-room.js").read_text(encoding="utf-8"))

    def test_split_adjusted_history_keeps_price_return_comparable(self) -> None:
        index = pd.to_datetime(["2026-06-18", "2026-06-19", "2026-06-22"])
        frame = pd.DataFrame(
            {
                "Close": [1000.0, 1100.0, 600.0],
                "Dividends": [0.0, 0.0, 0.0],
                "Stock Splits": [0.0, 0.0, 2.0],
            },
            index=index,
        )
        adjusted = room.split_adjusted_history(frame)
        self.assertEqual(adjusted.loc[pd.Timestamp("2026-06-18"), "close"], 500.0)
        self.assertEqual(adjusted.loc[pd.Timestamp("2026-06-19"), "close"], 550.0)
        self.assertEqual(adjusted.loc[pd.Timestamp("2026-06-22"), "close"], 600.0)

    def test_performance_is_live_before_answer_date(self) -> None:
        index = pd.to_datetime(["2026-06-18", "2026-06-19", "2026-07-30"])
        adjusted = pd.DataFrame(
            {"close": [100.0, 90.0, 120.0], "dividend": [0.0, 2.0, 0.0], "split": [0.0, 0.0, 0.0]},
            index=index,
        )
        metrics = room.performance_metrics(adjusted, date(2026, 6, 18), date(2026, 8, 31), date(2026, 7, 30))
        self.assertEqual(metrics["phase"], "observing")
        self.assertEqual(metrics["performance_date"], "2026-07-30")
        self.assertEqual(metrics["return_pct"], 20.0)
        self.assertEqual(metrics["low_return_pct"], -10.0)
        self.assertEqual(metrics["dividend_per_current_share"], 2.0)

    def test_performance_freezes_at_answer_date(self) -> None:
        index = pd.to_datetime(["2026-06-18", "2026-08-31", "2026-09-01"])
        adjusted = pd.DataFrame(
            {"close": [100.0, 130.0, 150.0], "dividend": [0.0, 0.0, 0.0], "split": [0.0, 0.0, 0.0]},
            index=index,
        )
        metrics = room.performance_metrics(adjusted, date(2026, 6, 18), date(2026, 8, 31), date(2026, 9, 1))
        self.assertEqual(metrics["phase"], "answered")
        self.assertEqual(metrics["performance_date"], "2026-08-31")
        self.assertEqual(metrics["return_pct"], 30.0)
        self.assertEqual(metrics["latest_date"], "2026-09-01")
        self.assertEqual(metrics["latest_return_pct"], 50.0)

    def test_group_summary_uses_equal_weight_average(self) -> None:
        records = [
            {"tier": "S", "code": "1", "name": "A", "return_pct": 10.0},
            {"tier": "S", "code": "2", "name": "B", "return_pct": -5.0},
            {"tier": "A", "code": "3", "name": "C", "return_pct": 0.0},
        ]
        summary = room.group_summary(records)
        self.assertAlmostEqual(summary["average_return_pct"], 5.0 / 3.0, places=4)
        self.assertEqual(summary["up_count"], 1)
        self.assertEqual(summary["flat_count"], 1)
        self.assertEqual(summary["down_count"], 1)


if __name__ == "__main__":
    unittest.main()
