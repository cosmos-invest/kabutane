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

    def test_daily_analysis_builds_article_screening_conditions(self):
        dates = pd.bdate_range("2025-01-01", periods=280)
        closes = pd.Series(range(100, 380), index=dates, dtype=float)
        frame = pd.DataFrame({"Close": closes, "High": closes, "Low": closes - 2, "Volume": 150_000}, index=dates)

        prepared = scanner.prepare_daily_analysis(frame)
        metrics = scanner.daily_metrics_at_month(prepared, dates[-1].to_period("M"))

        self.assertTrue(metrics["perfect_order"])
        self.assertTrue(metrics["price_above_sma25"])
        self.assertTrue(metrics["price_above_sma75"])
        self.assertTrue(metrics["price_above_sma200"])
        self.assertTrue(metrics["sma25_up"])
        self.assertTrue(metrics["sma75_up"])
        self.assertTrue(metrics["sma200_up"])
        self.assertEqual(metrics["avg_volume30"], 150_000)
        self.assertGreater(metrics["high52_distance_pct"], 0)
        self.assertTrue(metrics["high52_breakout"])
        self.assertEqual(metrics["volume_ratio_5_30"], 1.0)
        self.assertGreater(metrics["atr14_pct"], 0)
        self.assertFalse(metrics["vcp_tight"])
        self.assertEqual(metrics["stage"], 2)
        self.assertTrue(metrics["supertrend_up"])
        self.assertIsNotNone(metrics["rsr_momentum"])
        self.assertFalse(metrics["mvp_signal"])

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

    def test_analysis_episodes_exclude_out_without_new_and_track_both_states(self):
        may = pd.Period("2026-05", freq="M")
        june = pd.Period("2026-06", freq="M")
        records = {
            may: [
                {
                    "code": "1111", "ticker": "1111.T", "name": "完了銘柄",
                    "status": "NEW", "gc_price": 100, "rsi14": 40,
                    "rsi5": 50, "rsi14_up": True, "rsi5_up": False, "diff": 10,
                    "sma25": 110, "sma75": 105, "sma200": 90,
                    "perfect_order": True, "price_above_sma200": True,
                },
                {
                    "code": "2222", "ticker": "2222.T", "name": "継続銘柄",
                    "status": "NEW", "gc_price": 200, "rsi14": 35,
                    "rsi5": 55, "diff": 20,
                },
            ],
            june: [],
        }
        outs = {
            may: [],
            june: [
                {"ticker": "1111.T", "exit_price": 120},
                {"ticker": "9999.T", "exit_price": 80},
            ],
        }
        latest = [
            {"ticker": "2222.T", "name": "継続銘柄", "current_price": 180},
        ]

        monthly_by_ticker = {
            "1111.T": pd.DataFrame({"close": [100, 120]}, index=pd.PeriodIndex([may, june], freq="M")),
            "2222.T": pd.DataFrame({"close": [200, 180]}, index=pd.PeriodIndex([may, june], freq="M")),
        }
        episodes = scanner.build_analysis_episodes(records, outs, latest, june, monthly_by_ticker=monthly_by_ticker)

        self.assertEqual(len(episodes), 2)
        by_ticker = {row["ticker"]: row for row in episodes}
        self.assertEqual(by_ticker["1111.T"]["status"], "CLOSED")
        self.assertEqual(by_ticker["1111.T"]["return_pct"], 20.0)
        self.assertTrue(by_ticker["1111.T"]["start_rsi14_up"])
        self.assertFalse(by_ticker["1111.T"]["start_rsi5_up"])
        self.assertTrue(by_ticker["1111.T"]["start_perfect_order"])
        self.assertEqual(by_ticker["1111.T"]["start_sma25"], 110)
        self.assertEqual(by_ticker["1111.T"]["monthly_returns"][0]["return_pct"], 20.0)
        self.assertTrue(by_ticker["1111.T"]["monthly_returns"][0]["entry"])
        self.assertTrue(by_ticker["1111.T"]["monthly_returns"][0]["exit"])
        self.assertEqual(by_ticker["2222.T"]["status"], "ACTIVE")
        self.assertEqual(by_ticker["2222.T"]["return_pct"], -10.0)
        self.assertEqual(by_ticker["2222.T"]["monthly_returns"][0]["return_pct"], -10.0)
        self.assertNotIn("9999.T", by_ticker)

    def test_analysis_episodes_exclude_price_discontinuity(self):
        may = pd.Period("2023-05", freq="M")
        june = pd.Period("2023-06", freq="M")
        records = {
            may: [{
                "code": "8303", "ticker": "8303.T", "name": "SBI新生銀行",
                "status": "NEW", "gc_price": 2_809, "rsi14": 60,
                "rsi5": 80, "diff": 20,
            }],
            june: [],
        }
        outs = {may: [], june: [{"ticker": "8303.T", "exit_price": 55_320_000_000}]}
        monthly = {
            "8303.T": pd.DataFrame(
                {"close": [2_809, 55_320_000_000]},
                index=pd.PeriodIndex([may, june], freq="M"),
            ),
        }

        episode = scanner.build_analysis_episodes(
            records, outs, [], june, monthly_by_ticker=monthly,
        )[0]

        self.assertTrue(episode["analysis_excluded"])
        self.assertIn("価格不連続", episode["data_quality_issue"])
        self.assertIsNone(episode["return_pct"])
        self.assertIsNone(episode["end_price"])
        self.assertEqual(episode["monthly_returns"], [])

    def test_build_benchmark_series_aligns_month_end_returns(self):
        dates = pd.to_datetime(["2025-01-31", "2025-02-28", "2025-03-31"])
        frames = {
            "^TOPX": pd.DataFrame({"Close": [100, 110, 99]}, index=dates),
            "^N225": pd.DataFrame({"Close": [200, 220, 242]}, index=dates),
        }
        months = list(pd.period_range("2025-01", "2025-03", freq="M"))
        result = scanner.build_benchmark_series(frames, months)

        self.assertEqual(result["TOPIX"]["returns"][0]["return_pct"], 10.0)
        self.assertEqual(result["TOPIX"]["returns"][1]["return_pct"], -10.0)
        self.assertEqual(result["TOPIX"]["source_ticker"], "^TOPX")
        self.assertEqual(result["NIKKEI225"]["returns"][1]["return_pct"], 10.0)


if __name__ == "__main__":
    unittest.main()
