from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from scripts import build_core_universe_data as core


class CoreUniverseDataTests(unittest.TestCase):
    def test_shard_key_uses_first_two_code_characters(self):
        self.assertEqual(core.shard_key("5243"), "52")
        self.assertEqual(core.shard_key("130A"), "13")

    def test_compact_rows_keep_ohlcv_and_dates(self):
        frame = pd.DataFrame(
            {"Open": [100, 102], "High": [105, 108], "Low": [98, 101], "Close": [103, 107], "Volume": [1000, 1200]},
            index=pd.to_datetime(["2026-08-03", "2026-08-04"]),
        )
        rows = core.compact_daily_rows(frame)
        self.assertEqual(rows[0][0], "2026-08-03")
        self.assertEqual(rows[-1][4], 107.0)
        self.assertEqual(rows[-1][5], 1200.0)

    def test_provisional_gc_is_classified_from_confirmed_out(self):
        completed = pd.Series([100.0] * 24, index=pd.period_range("2024-08", periods=24, freq="M"))
        confirmed = pd.DataFrame(
            {"close": [100], "rsi": [49], "ma": [50], "active": [False], "new": [False], "out": [False]},
            index=[completed.index[-1]],
        )
        provisional = pd.DataFrame(
            {"close": [120], "rsi": [52], "ma": [50], "active": [True], "new": [True], "out": [False]},
            index=[pd.Period("2026-08", freq="M")],
        )
        with patch.object(core, "signal_series", side_effect=[confirmed, provisional]):
            result = core.calculate_provisional(completed, 120.0, pd.Period("2026-08", freq="M"))
        self.assertEqual(result["status"], "GC")
        self.assertTrue(result["changed_from_confirmed"])

    def test_near_gc_is_kept_separate_from_confirmed_signal(self):
        completed = pd.Series([100.0] * 24, index=pd.period_range("2024-08", periods=24, freq="M"))
        confirmed = pd.DataFrame(
            {"close": [100], "rsi": [45], "ma": [50], "active": [False], "new": [False], "out": [False]},
            index=[completed.index[-1]],
        )
        provisional = pd.DataFrame(
            {"close": [112], "rsi": [49.2], "ma": [50], "active": [False], "new": [False], "out": [False]},
            index=[pd.Period("2026-08", freq="M")],
        )
        with patch.object(core, "signal_series", side_effect=[confirmed, provisional]):
            result = core.calculate_provisional(completed, 112.0, pd.Period("2026-08", freq="M"))
        self.assertEqual(result["status"], "NEAR_GC")
        self.assertEqual(result["confirmed_status"], "OUT")

    def test_write_json_is_compact_for_shards(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "52.json"
            core.write_json(path, {"records": {"5243": {"name": "note"}}})
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("\n  ", text)
            self.assertIn('"5243"', text)


if __name__ == "__main__":
    unittest.main()
