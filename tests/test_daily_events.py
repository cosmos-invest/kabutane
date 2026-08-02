from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from build_daily_events import EVENT_SCHEMA, build_event_feed, detect_events, save_event_feed


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def snapshot(date: str, records: list[dict], recent_out: list[dict] | None = None) -> dict:
    return {
        "schema_version": "kabutane_daily_snapshot_v1",
        "snapshot_date": date,
        "generated_at": f"{date}T12:00:00+00:00",
        "signal_version": "tv_wilder_rsi14_sma5_v1",
        "signal_month": "2026-07",
        "summary": {
            "active_count": len(records), "new_count": sum(r.get("status") == "NEW" for r in records),
            "out_count": len(recent_out or []), "ranking_count": len(records),
            "provisional_count": sum("provisional" in r for r in records), "provisional_changed_count": 0,
        },
        "records": records,
        "recent_out": recent_out or [],
        "cost_policy": "paid_api_disabled",
    }


class DailyEventTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_official_new_out_and_top10_are_detected(self) -> None:
        previous = snapshot("2026-08-01", [
            {"code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 12, "return_since_gc_pct": 8},
            {"code": "2222", "name": "Beta", "status": "CONTINUE", "rank": 3, "return_since_gc_pct": 4},
        ])
        current = snapshot("2026-08-02", [
            {"code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 8, "return_since_gc_pct": 9},
            {"code": "3333", "name": "Gamma", "status": "NEW", "rank": 2, "return_since_gc_pct": 0},
        ], recent_out=[{"code": "2222", "name": "Beta", "status": "OUT", "exit_month": "2026-07"}])
        types = [event["type"] for event in detect_events(previous, current)]
        self.assertIn("OFFICIAL_NEW", types)
        self.assertIn("OFFICIAL_OUT", types)
        self.assertIn("TOP10_ENTRY", types)

    def test_provisional_cross_recovery_near_cross_and_moves(self) -> None:
        previous = snapshot("2026-08-03", [
            {
                "code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 20,
                "daily_change_pct": 0.2, "return_since_gc_pct": 9,
                "provisional": {"status": "CONTINUE", "spread": 2.5, "changed_from_confirmed": False},
            },
            {
                "code": "2222", "name": "Beta", "status": "CONTINUE", "rank": 5,
                "return_since_gc_pct": 12,
                "provisional": {"status": "DC", "spread": -0.5, "changed_from_confirmed": True},
            },
            {
                "code": "3333", "name": "Gamma", "status": "CONTINUE", "rank": 30,
                "return_since_gc_pct": 2,
                "provisional": {"status": "CONTINUE", "spread": 2.0, "changed_from_confirmed": False},
            },
        ])
        current = snapshot("2026-08-04", [
            {
                "code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 7,
                "daily_change_pct": 4.2, "return_since_gc_pct": 11,
                "provisional": {"status": "DC", "spread": -0.2, "changed_from_confirmed": True, "price_date": "2026-08-04"},
            },
            {
                "code": "2222", "name": "Beta", "status": "CONTINUE", "rank": 5,
                "daily_change_pct": -0.5, "return_since_gc_pct": 12,
                "provisional": {"status": "CONTINUE", "spread": 1.1, "changed_from_confirmed": False},
            },
            {
                "code": "3333", "name": "Gamma", "status": "CONTINUE", "rank": 22,
                "daily_change_pct": -3.5, "return_since_gc_pct": 2,
                "provisional": {"status": "CONTINUE", "spread": 0.8, "changed_from_confirmed": False},
            },
        ])
        events = detect_events(previous, current)
        types = [event["type"] for event in events]
        self.assertIn("PROVISIONAL_DC", types)
        self.assertIn("PROVISIONAL_RECOVERY", types)
        self.assertIn("RSI_NEAR_CROSS", types)
        self.assertIn("TOP10_ENTRY", types)
        self.assertIn("RANK_MOVE", types)
        self.assertGreaterEqual(types.count("PRICE_MOVE"), 2)
        self.assertIn("RETURN_MILESTONE", types)
        self.assertEqual(events, sorted(events, key=lambda event: (-event["priority"], event["code"], event["type"])))

    def test_first_snapshot_is_baseline_without_false_events(self) -> None:
        current = snapshot("2026-08-02", [
            {"code": "1111", "name": "Alpha", "status": "NEW", "rank": 1, "return_since_gc_pct": 0}
        ])
        write_json(self.root / "data/daily-snapshot.json", current)
        feed = build_event_feed(self.root)
        self.assertEqual(feed["schema_version"], EVENT_SCHEMA)
        self.assertEqual(feed["comparison_state"], "baseline_no_previous")
        self.assertEqual(feed["events"], [])
        self.assertEqual(feed["cost_policy"], "paid_api_disabled")

    def test_feed_uses_latest_prior_calendar_snapshot_and_saves_same_day(self) -> None:
        write_json(self.root / "history/daily/2026-08-01.json", snapshot("2026-08-01", [
            {"code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 15, "return_since_gc_pct": 5}
        ]))
        write_json(self.root / "history/daily/2026-08-02.json", snapshot("2026-08-02", [
            {"code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 12, "return_since_gc_pct": 6}
        ]))
        current = snapshot("2026-08-03", [
            {"code": "1111", "name": "Alpha", "status": "CONTINUE", "rank": 5, "return_since_gc_pct": 7}
        ])
        write_json(self.root / "data/daily-snapshot.json", current)
        write_json(self.root / "history/daily/2026-08-03.json", current)
        feed = build_event_feed(self.root)
        self.assertEqual(feed["previous_snapshot_date"], "2026-08-02")
        self.assertIn("TOP10_ENTRY", [event["type"] for event in feed["events"]])
        _, first_history, _, first_changed = save_event_feed(self.root, feed)
        self.assertTrue(first_changed)
        feed["summary"]["event_count"] = 99
        _, second_history, _, second_changed = save_event_feed(self.root, feed)
        self.assertTrue(second_changed)
        self.assertEqual(first_history, second_history)
        self.assertEqual(len(list((self.root / "history/daily-events").glob("*.json"))), 1)

    def test_invalid_snapshot_schema_is_rejected(self) -> None:
        write_json(self.root / "data/daily-snapshot.json", {"schema_version": "wrong", "snapshot_date": "2026-08-02"})
        with self.assertRaisesRegex(RuntimeError, "schema_version"):
            build_event_feed(self.root)


if __name__ == "__main__":
    unittest.main()
