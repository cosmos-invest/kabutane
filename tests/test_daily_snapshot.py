from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from build_daily_snapshot import SNAPSHOT_VERSION, build_snapshot, save_snapshot


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class DailySnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        write_json(
            self.root / "data/latest.json",
            {
                "generated_at": "2026-08-02T10:32:21+00:00",
                "signal_version": "tv_wilder_rsi14_sma5_v1",
                "signal_month": "2026-07",
                "summary": {"active_count": 2, "new_count": 1, "out_count": 1},
                "records": [
                    {
                        "code": "2222", "ticker": "2222.T", "name": "Beta", "status": "CONTINUE",
                        "signal_month": "2026-07", "current_price": 900, "return_since_gc_pct": 5.5,
                        "monthly_rsi14": 61, "monthly_rsi_ma5": 58, "monthly_rsi_spread": 3,
                    },
                    {
                        "code": "1111", "ticker": "1111.T", "name": "Alpha", "status": "NEW",
                        "signal_month": "2026-07", "current_price": 1200, "return_since_gc_pct": 2.0,
                        "monthly_rsi14": 63, "monthly_rsi_ma5": 60, "monthly_rsi_spread": 3,
                    },
                ],
                "out_records": [
                    {"code": "3333", "ticker": "3333.T", "name": "Gamma", "exit_month": "2026-07"}
                ],
            },
        )
        write_json(
            self.root / "data/ranking.json",
            {
                "generated_at": "2026-08-02T10:35:00+00:00",
                "price_date": None,
                "signal_month": "2026-07",
                "count": 2,
                "rows": [
                    {"code": "1111", "rank": 1, "rank_change": 2, "daily_change_pct": 1.4},
                    {"code": "2222", "rank": 2, "rank_change": -1, "daily_change_pct": -0.3},
                ],
            },
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_monthly_baseline_uses_generated_date_when_no_daily_overlay(self) -> None:
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot["schema_version"], SNAPSHOT_VERSION)
        self.assertEqual(snapshot["snapshot_date"], "2026-08-02")
        self.assertEqual(snapshot["source_state"], "monthly_baseline")
        self.assertEqual([row["code"] for row in snapshot["records"]], ["1111", "2222"])
        self.assertEqual(snapshot["records"][0]["rank"], 1)
        self.assertEqual(snapshot["summary"]["out_count"], 1)
        self.assertEqual(snapshot["recent_out"][0]["status"], "OUT")
        self.assertEqual(snapshot["cost_policy"], "paid_api_disabled")

    def test_daily_overlay_adds_provisional_state_and_uses_price_date(self) -> None:
        latest = json.loads((self.root / "data/latest.json").read_text(encoding="utf-8"))
        latest["daily_generated_at"] = "2026-08-03T12:00:00+00:00"
        latest["daily_price_date"] = "2026-08-03"
        write_json(self.root / "data/latest.json", latest)
        write_json(
            self.root / "data/daily/1111.json",
            {
                "code": "1111",
                "provisional_signal": {
                    "month": "2026-08",
                    "price_date": "2026-08-03",
                    "status": "DC",
                    "monthly_rsi14": 58,
                    "monthly_rsi_ma5": 59,
                    "spread": -1,
                    "changed_from_confirmed": True,
                },
            },
        )
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot["snapshot_date"], "2026-08-03")
        self.assertEqual(snapshot["source_state"], "daily_overlay")
        self.assertEqual(snapshot["summary"]["provisional_count"], 1)
        self.assertEqual(snapshot["summary"]["provisional_changed_count"], 1)
        alpha = next(row for row in snapshot["records"] if row["code"] == "1111")
        self.assertEqual(alpha["provisional"]["status"], "DC")
        self.assertTrue(alpha["provisional"]["is_provisional"])

    def test_save_overwrites_same_day_instead_of_adding_duplicates(self) -> None:
        snapshot = build_snapshot(self.root)
        _, first_history, _, first_changed = save_snapshot(self.root, snapshot)
        self.assertTrue(first_changed)
        snapshot["summary"]["active_count"] = 9
        _, second_history, _, second_changed = save_snapshot(self.root, snapshot)
        self.assertTrue(second_changed)
        self.assertEqual(first_history, second_history)
        files = list((self.root / "history/daily").glob("*.json"))
        self.assertEqual(len(files), 1)
        saved = json.loads(files[0].read_text(encoding="utf-8"))
        self.assertEqual(saved["summary"]["active_count"], 9)

    def test_builder_rejects_empty_latest_records(self) -> None:
        latest = json.loads((self.root / "data/latest.json").read_text(encoding="utf-8"))
        latest["records"] = []
        write_json(self.root / "data/latest.json", latest)
        with self.assertRaisesRegex(RuntimeError, "snapshot対象"):
            build_snapshot(self.root)


if __name__ == "__main__":
    unittest.main()
