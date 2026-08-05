from __future__ import annotations

import unittest

import pandas as pd

from scripts.build_extended_monthly_scan import classify_status, compact_record, normalize_ticker
from tradingview_signal import prepare_monthly_compat


class ExtendedMonthlyScanTests(unittest.TestCase):
    def test_normalize_ticker(self) -> None:
        self.assertEqual(normalize_ticker("1308"), "1308.T")
        self.assertEqual(normalize_ticker("162A"), "162A.T")

    def test_compact_record_preserves_extended_labels(self) -> None:
        index = pd.date_range("2023-01-31", periods=36, freq="ME")
        close = pd.Series([100 + index * 1.5 for index in range(36)], index=index, dtype=float)
        frame = pd.DataFrame({"Close": close})
        monthly = prepare_monthly_compat(frame, pd.Period("2026-02", freq="M"))
        issue = {
            "code": "1308",
            "ticker": "1308.T",
            "name": "ETFテスト",
            "market": "ETF・ETN",
            "sector": "-",
            "instrument_type": "etf",
            "scope": "extended",
        }
        record = compact_record(issue, monthly)
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record["scope"], "extended")
        self.assertEqual(record["instrument_type"], "etf")
        self.assertIn(record["status"], {"NEW", "CONTINUE", "OUT", "INACTIVE"})
        self.assertEqual(record["latest_month"], "2026-01")

    def test_status_uses_canonical_condition(self) -> None:
        monthly = pd.DataFrame(
            [{"new": False, "condition": True, "out": False}],
            index=[pd.Period("2026-07", freq="M")],
        )
        self.assertEqual(classify_status(monthly), "CONTINUE")


if __name__ == "__main__":
    unittest.main()
