import unittest

import pandas as pd

from benchmark_support import build_robust_benchmark_series


class BenchmarkSupportTests(unittest.TestCase):
    def _frame(self, start: str, periods: int, monthly_growth: float = 0.01) -> pd.DataFrame:
        dates = pd.date_range(start, periods=periods, freq="ME")
        values = [100 * ((1 + monthly_growth) ** index) for index in range(periods)]
        return pd.DataFrame({"Adj Close": values, "Close": values}, index=dates)

    def test_sparse_primary_falls_back_to_adjusted_etf(self):
        months = list(pd.period_range("2021-07", periods=60, freq="M"))
        frames = {
            "998405.T": self._frame("2026-05-31", 2),
            "1308.T": self._frame("2021-06-30", 61),
        }
        definitions = {
            "TOPIX": {
                "ticker": "998405.T",
                "fallback_tickers": ["^TOPX", "1308.T"],
                "name": "TOPIX",
            }
        }
        result = build_robust_benchmark_series(frames, months, definitions)["TOPIX"]
        self.assertEqual(result["source_ticker"], "1308.T")
        self.assertEqual(result["source_type"], "adjusted_etf_proxy")
        self.assertEqual(len(result["returns"]), 59)

    def test_extreme_split_like_jump_is_rejected(self):
        months = list(pd.period_range("2021-07", periods=60, freq="M"))
        bad = self._frame("2021-06-30", 61)
        bad.iloc[30:, bad.columns.get_loc("Adj Close")] *= 10
        good = self._frame("2021-06-30", 61)
        definitions = {
            "TOPIX": {
                "ticker": "1306.T",
                "fallback_tickers": ["1308.T"],
                "name": "TOPIX",
            }
        }
        result = build_robust_benchmark_series(
            {"1306.T": bad, "1308.T": good}, months, definitions
        )["TOPIX"]
        self.assertEqual(result["source_ticker"], "1308.T")
        first_attempt = result["candidate_diagnostics"][0]
        self.assertFalse(first_attempt["usable"])


if __name__ == "__main__":
    unittest.main()
