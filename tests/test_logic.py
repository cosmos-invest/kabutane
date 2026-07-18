import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import test as scanner  # noqa: E402


class ScannerLogicTests(unittest.TestCase):
    def test_normalize_ticker(self):
        self.assertEqual(scanner.normalize_ticker("7203"), "7203.T")
        self.assertEqual(scanner.normalize_ticker("130A"), "130A.T")
        self.assertEqual(scanner.normalize_ticker("9984.T"), "9984.T")

    def test_rsi_on_rising_series_reaches_100(self):
        series = pd.Series(range(1, 40), dtype=float)
        rsi = scanner.calc_rsi(series, 14)
        self.assertEqual(float(rsi.dropna().iloc[-1]), 100.0)

    def test_prepare_monthly_detects_cross(self):
        dates = pd.date_range("2021-01-01", periods=40, freq="MS")
        closes = [100 + (i % 5) for i in range(20)] + [90 + i * 3 for i in range(20)]
        frame = pd.DataFrame({"Close": closes}, index=dates)
        monthly = scanner.prepare_monthly(frame, pd.Period("2025-01", freq="M"))
        self.assertIn("condition", monthly.columns)
        self.assertIn("new", monthly.columns)
        self.assertGreaterEqual(int(monthly["new"].sum()), 1)

    def test_json_safe_nan(self):
        self.assertIsNone(scanner.json_safe(float("nan")))

    def test_fundamental_fields_start_with_per(self):
        self.assertEqual(scanner.FUNDAMENTAL_FIELDS[0], "per")
        self.assertEqual(
            scanner.FUNDAMENTAL_FIELDS,
            scanner.RESULT_FIELDS[scanner.RESULT_FIELDS.index("per"):],
        )

    def test_enrich_fundamentals_prefers_configured_japanese_name(self):
        records = [{"ticker": "9984.T", "name": "ソフトバンクグループ"}]
        cache = {
            "9984.T": {
                "data": {"name": "SoftBank Group Corp.", "per": 10.5},
            },
        }

        with (
            patch.object(scanner, "SKIP_FUNDAMENTALS", False),
            patch.object(scanner, "load_cache", return_value=cache),
            patch.object(scanner, "cache_is_fresh", return_value=True),
            patch.object(scanner, "write_json"),
        ):
            scanner.enrich_fundamentals(records, [])

        self.assertEqual(records[0]["name"], "ソフトバンクグループ")
        self.assertEqual(records[0]["per"], 10.5)


if __name__ == "__main__":
    unittest.main()
