from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import public_core_radar as public


class PublicCoreRadarTests(unittest.TestCase):
    def test_gc_maps_to_confirmed_public_side_and_removes_current_rsi(self):
        source = {
            "generated_at": "2026-08-05T00:00:00+00:00",
            "core_count": 2,
            "daily_coverage": 2,
            "monthly_coverage": 2,
            "fundamentals_coverage": 1,
            "dividend_history_coverage": 2,
            "records": [
                {
                    "code": "5243", "name": "note", "market": "グロース（内国株式）",
                    "provisional_status": "GC", "provisional_month": "2026-08",
                    "monthly_rsi14": 50.4, "monthly_rsi_ma5": 49.8, "monthly_rsi_spread": 0.6,
                    "confirmed_status": "OUT", "confirmed_month": "2026-07",
                    "current_price": 1180, "above_sma200": True,
                    "dividend_yield_pct": 2.5,
                    "consecutive_dividend_increase_years": 3,
                    "dividend_cut_count_5y": 0,
                    "dividend_no_cut_5y": True,
                    "dividend_cagr_5y_pct": 6.2,
                },
                {
                    "code": "5942", "name": "日本フイルコン", "provisional_status": "DC",
                    "monthly_rsi14": 48, "monthly_rsi_ma5": 49,
                    "confirmed_status": "CONTINUE", "confirmed_month": "2026-07",
                },
            ],
        }
        payload = public.build_public_payload(source)
        rows = {row["code"]: row for row in payload["records"]}
        self.assertEqual(rows["5243"]["provisional_status"], "OUT")
        self.assertEqual(rows["5942"]["provisional_status"], "DC")
        self.assertEqual(payload["dividend_history_coverage"], 2)
        self.assertEqual(rows["5243"]["consecutive_dividend_increase_years"], 3)
        self.assertTrue(rows["5243"]["dividend_no_cut_5y"])
        self.assertEqual(rows["5243"]["dividend_cagr_5y_pct"], 6.2)
        for key in public.REMOVED_FIELDS:
            self.assertNotIn(key, rows["5243"])
            self.assertNotIn(key, rows["5942"])
        public.validate_public_payload(payload)

    def test_write_public_radar_is_compact_and_safe(self):
        source = {
            "core_count": 1,
            "records": [{"code": "1000", "provisional_status": "GC", "confirmed_status": "OUT"}],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_path = root / "radar.json"
            output_path = root / "public-radar.json"
            input_path.write_text(json.dumps(source), encoding="utf-8")
            public.write_public_radar(input_path, output_path)
            text = output_path.read_text(encoding="utf-8")
            self.assertNotIn('"provisional_status":"GC"', text)
            self.assertNotIn("monthly_rsi_spread", text)

    def test_ir_review_queue_prioritizes_unknown_boundary_without_leaking_to_public(self):
        years = list(range(2010, 2027))
        candidate_history = [
            {"year": year, "annual_dividend": None if year == 2010 else float(year - 2010)}
            for year in years
        ]
        known_break_history = [
            {"year": 2010, "annual_dividend": 10.0},
            {"year": 2011, "annual_dividend": 10.0},
            *[
                {"year": year, "annual_dividend": float(year)}
                for year in range(2012, 2027)
            ],
        ]
        source = {
            "generated_at": "2026-08-20T00:00:00+00:00",
            "core_count": 2,
            "dividend_verified_streak_count": 0,
            "records": [
                {"code": "9999", "ticker": "9999.T", "name": "候補社", "provisional_status": "OUT"},
                {"code": "9998", "ticker": "9998.T", "name": "据置社", "provisional_status": "OUT"},
            ],
        }
        details = {
            "9999": {
                "code": "9999",
                "ticker": "9999.T",
                "name": "候補社",
                "history": candidate_history,
                "observed_consecutive_increase_years": 15,
                "consecutive_increase_years": 15,
                "streak_lower_bound": True,
                "streak_verified": False,
                "streak_anchor_as_of_year": None,
                "unknown_year_count": 1,
                "expected_dividend_events_per_period": 2,
                "partial_event_periods": [2010],
            },
            "9998": {
                "code": "9998",
                "ticker": "9998.T",
                "name": "据置社",
                "history": known_break_history,
                "observed_consecutive_increase_years": 15,
                "consecutive_increase_years": 15,
                "streak_lower_bound": False,
                "streak_verified": False,
                "streak_anchor_as_of_year": None,
                "unknown_year_count": 0,
                "expected_dividend_events_per_period": 2,
                "partial_event_periods": [],
            },
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dividend_dir = root / "dividends"
            dividend_dir.mkdir(parents=True)
            input_path = root / "radar.json"
            output_path = root / "public-radar.json"
            input_path.write_text(json.dumps(source), encoding="utf-8")
            (dividend_dir / "99.json").write_text(json.dumps({"records": details}), encoding="utf-8")

            public.write_public_radar(input_path, output_path)
            review = json.loads((root / "quality" / "dividend-ir-review-candidates.json").read_text(encoding="utf-8"))
            codes = [row["code"] for row in review["records"]]
            self.assertIn("9999", codes)
            self.assertNotIn("9998", codes)
            candidate = next(row for row in review["records"] if row["code"] == "9999")
            self.assertGreaterEqual(candidate["score"], 80)
            self.assertEqual(candidate["boundary_type"], "unknown")
            self.assertTrue(candidate["partial_event_near_boundary"])
            self.assertIn("取得未確認", " ".join(candidate["reasons"]))

            public_payload = json.loads(output_path.read_text(encoding="utf-8"))
            public_candidate = next(row for row in public_payload["records"] if row["code"] == "9999")
            self.assertNotIn("score", public_candidate)
            self.assertNotIn("priority", public_candidate)
            self.assertNotIn("reasons", public_candidate)


if __name__ == "__main__":
    unittest.main()
