from __future__ import annotations

import unittest
from datetime import date

import pandas as pd

import build_shikiho_room as room
import build_shikiho_room_v2 as room_v2


class ShikihoRoomV2Tests(unittest.TestCase):
    def test_yahoo_close_is_not_split_adjusted_twice(self) -> None:
        index = pd.to_datetime(["2026-06-18", "2026-06-26", "2026-06-29", "2026-07-30"])
        frame = pd.DataFrame(
            {
                # Yahoo's Close history is already continuous across the split.
                "Close": [856.0, 870.0, 871.0, 937.0],
                "Dividends": [0.0, 0.0, 0.0, 0.0],
                "Stock Splits": [0.0, 0.0, 4.0, 0.0],
            },
            index=index,
        )
        adjusted = room_v2.split_adjusted_history(frame)
        self.assertEqual(adjusted.loc[pd.Timestamp("2026-06-18"), "close"], 856.0)
        self.assertEqual(adjusted.loc[pd.Timestamp("2026-07-30"), "close"], 937.0)
        metrics = room.performance_metrics(
            adjusted,
            date(2026, 6, 18),
            date(2026, 8, 31),
            date(2026, 7, 30),
        )
        self.assertAlmostEqual(metrics["return_pct"], (937.0 / 856.0 - 1.0) * 100.0, places=4)
        self.assertLess(metrics["return_pct"], 20.0)
        self.assertEqual(metrics["split_events"], [{"date": "2026-06-29", "ratio": 4.0}])

    def test_dividends_remain_separate_from_price_return(self) -> None:
        index = pd.to_datetime(["2026-06-18", "2026-07-30"])
        frame = pd.DataFrame(
            {
                "Close": [100.0, 110.0],
                "Dividends": [0.0, 3.0],
                "Stock Splits": [0.0, 0.0],
            },
            index=index,
        )
        adjusted = room_v2.split_adjusted_history(frame)
        metrics = room.performance_metrics(
            adjusted,
            date(2026, 6, 18),
            date(2026, 8, 31),
            date(2026, 7, 30),
        )
        self.assertEqual(metrics["return_pct"], 10.0)
        self.assertEqual(metrics["dividend_per_current_share"], 3.0)


if __name__ == "__main__":
    unittest.main()
