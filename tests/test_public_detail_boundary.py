from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest

from scripts.public_detail_boundary import build_public_core_daily, prepare_site_tree


class PublicDetailBoundaryTests(unittest.TestCase):
    def write(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def read(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    def sample_gc(self) -> dict:
        return {
            "code": "4073",
            "record": {"status": "OUT", "provisional_status": "GC", "provisional_month": "2026-08"},
            "provisional_signal": {
                "month": "2026-08",
                "status": "GC",
                "monthly_rsi14": 55.0,
                "monthly_rsi_ma5": 54.0,
                "spread": 1.0,
                "confirmed_status": "OUT",
            },
        }

    def test_build_public_core_daily_removes_gc_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "raw"
            output = root / "public"
            self.write(source / "40.json", {
                "schema_version": 1,
                "records": {
                    "4073": self.sample_gc(),
                    "4074": {"code": "4074", "provisional_signal": {"status": "DC", "spread": -0.8}},
                },
            })
            self.assertEqual(build_public_core_daily(source, output), 1)
            payload = self.read(output / "40.json")
            self.assertIsNone(payload["records"]["4073"]["provisional_signal"])
            self.assertNotIn("provisional_status", payload["records"]["4073"].get("record", {}))
            self.assertEqual(payload["records"]["4074"]["provisional_signal"]["status"], "DC")

    def test_pages_tree_is_sanitized_before_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "_site"
            self.write(site / "data/core/radar.json", {
                "core_count": 1,
                "records": [{"code": "4073", "provisional_status": "GC", "monthly_rsi_spread": 1.0, "confirmed_status": "OUT"}],
            })
            self.write(site / "data/core/daily/40.json", {"records": {"4073": self.sample_gc()}})
            self.write(site / "data/charts/4073.json", self.sample_gc())
            self.write(site / "data/daily/4073.json", self.sample_gc())

            counts = prepare_site_tree(site)
            self.assertEqual(counts["core_daily_sanitized"], 1)
            self.assertFalse((site / "data/core/radar.json").exists())
            core = self.read(site / "data/core/daily/40.json")
            public_core = self.read(site / "data/core/public-daily/40.json")
            chart = self.read(site / "data/charts/4073.json")
            daily = self.read(site / "data/daily/4073.json")
            self.assertIsNone(core["records"]["4073"]["provisional_signal"])
            self.assertIsNone(public_core["records"]["4073"]["provisional_signal"])
            self.assertIsNone(chart["provisional_signal"])
            self.assertIsNone(daily["provisional_signal"])
            self.assertNotIn("provisional_status", chart.get("record", {}))


if __name__ == "__main__":
    unittest.main()
