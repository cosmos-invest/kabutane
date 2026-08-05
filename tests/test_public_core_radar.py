from __future__ import annotations

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
            "records": [
                {
                    "code": "5243", "name": "note", "market": "グロース（内国株式）",
                    "provisional_status": "GC", "provisional_month": "2026-08",
                    "monthly_rsi14": 50.4, "monthly_rsi_ma5": 49.8, "monthly_rsi_spread": 0.6,
                    "confirmed_status": "OUT", "confirmed_month": "2026-07",
                    "current_price": 1180, "above_sma200": True,
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
            import json
            input_path.write_text(json.dumps(source), encoding="utf-8")
            public.write_public_radar(input_path, output_path)
            text = output_path.read_text(encoding="utf-8")
            self.assertNotIn('"provisional_status":"GC"', text)
            self.assertNotIn("monthly_rsi_spread", text)


if __name__ == "__main__":
    unittest.main()
