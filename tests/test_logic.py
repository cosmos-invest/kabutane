import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
