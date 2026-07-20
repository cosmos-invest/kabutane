from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from tradingview_signal import (
    SIGNAL_VERSION,
    canonicalize_payload,
    postprocess_json,
    prepare_monthly_compat,
    rewrite_signal_text,
    tradingview_rma,
    tradingview_rsi,
)


class TradingViewSignalTests(unittest.TestCase):
    def test_rma_uses_sma_seed_then_wilder_recursion(self) -> None:
        source = pd.Series([1.0, 2.0, 3.0, 4.0])
        result = tradingview_rma(source, 3)
        self.assertTrue(np.isnan(result.iloc[0]))
        self.assertTrue(np.isnan(result.iloc[1]))
        self.assertAlmostEqual(result.iloc[2], 2.0, places=12)
        self.assertAlmostEqual(result.iloc[3], (2.0 * 2 + 4.0) / 3.0, places=12)

    def test_rsi_returns_100_for_only_gains_and_zero_for_only_losses(self) -> None:
        rising = tradingview_rsi(pd.Series(range(1, 30), dtype=float), 14)
        falling = tradingview_rsi(pd.Series(range(30, 1, -1), dtype=float), 14)
        self.assertEqual(rising.dropna().iloc[-1], 100.0)
        self.assertEqual(falling.dropna().iloc[-1], 0.0)

    def test_rsi_matches_manual_wilder_update(self) -> None:
        close = pd.Series(
            [100, 102, 101, 104, 103, 107, 108, 106, 110, 109, 112, 111, 115, 114, 118, 120],
            dtype=float,
        )
        result = tradingview_rsi(close, 14)

        changes = close.diff().dropna()
        gains = changes.clip(lower=0)
        losses = -changes.clip(upper=0)
        seed_gain = gains.iloc[:14].mean()
        seed_loss = losses.iloc[:14].mean()
        expected_seed = 100 - 100 / (1 + seed_gain / seed_loss)
        self.assertAlmostEqual(result.iloc[14], expected_seed, places=12)

        next_gain = (seed_gain * 13 + gains.iloc[14]) / 14
        next_loss = (seed_loss * 13 + losses.iloc[14]) / 14
        expected_next = 100 - 100 / (1 + next_gain / next_loss)
        self.assertAlmostEqual(result.iloc[15], expected_next, places=12)

    def test_monthly_signal_is_rsi14_vs_its_five_month_sma(self) -> None:
        dates = pd.date_range("2020-01-31", periods=36, freq="ME")
        close = pd.Series(
            [100, 98, 97, 99, 96, 95, 94, 96, 99, 101, 100, 103,
             102, 105, 107, 106, 109, 112, 111, 114, 118, 117, 121, 125,
             123, 128, 132, 130, 135, 140, 138, 143, 147, 145, 150, 154],
            index=dates,
            dtype=float,
        )
        frame = pd.DataFrame({"Close": close})
        monthly = prepare_monthly_compat(frame, pd.Period("2023-02", freq="M"))

        expected_rsi = tradingview_rsi(monthly["close"], 14)
        expected_ma = expected_rsi.rolling(5, min_periods=5).mean()
        pd.testing.assert_series_equal(monthly["monthly_rsi14"], expected_rsi, check_names=False)
        pd.testing.assert_series_equal(monthly["monthly_rsi_ma5"], expected_ma, check_names=False)
        pd.testing.assert_series_equal(monthly["rsi5"], expected_rsi, check_names=False)
        pd.testing.assert_series_equal(monthly["rsi14"], expected_ma, check_names=False)
        expected_condition = expected_rsi > expected_ma
        pd.testing.assert_series_equal(monthly["condition"], expected_condition, check_names=False)

    def test_canonical_aliases_are_added_without_losing_compatibility(self) -> None:
        payload = canonicalize_payload({
            "rsi5": 63.2,
            "rsi14": 58.1,
            "rsi5_up": True,
            "rsi14_up": False,
            "diff": 5.1,
            "rule": "RSI5がRSI14以下",
        })
        self.assertEqual(payload["monthly_rsi14"], 63.2)
        self.assertEqual(payload["monthly_rsi_ma5"], 58.1)
        self.assertTrue(payload["monthly_rsi14_up"])
        self.assertFalse(payload["monthly_rsi_ma5_up"])
        self.assertEqual(payload["monthly_rsi_spread"], 5.1)
        self.assertEqual(payload["rule"], "月足RSI14が5か月MA以下")
        self.assertIn("rsi5", payload)
        self.assertIn("rsi14", payload)

    def test_json_postprocess_writes_signal_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.json"
            path.write_text(json.dumps({"records": [{"rsi5": 60, "rsi14": 55}]}), encoding="utf-8")
            postprocess_json(path)
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["signal_version"], SIGNAL_VERSION)
            self.assertEqual(payload["records"][0]["monthly_rsi14"], 60)
            self.assertEqual(payload["records"][0]["monthly_rsi_ma5"], 55)

    def test_legacy_wording_is_rewritten(self) -> None:
        self.assertEqual(
            rewrite_signal_text("RSI5≥60・RSI14上向き"),
            "月足RSI14≥60・5か月MA上向き",
        )


if __name__ == "__main__":
    unittest.main()
