from __future__ import annotations

import copy
import unittest

from validate_daily_derived_contract import ContractError, validate_events, validate_snapshot


class DailyDerivedContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.snapshot = {
            "schema_version": "kabutane_daily_snapshot_v1",
            "snapshot_date": "2026-08-04",
            "generated_at": "2026-08-04T12:00:00+00:00",
            "source_state": "daily_overlay",
            "signal_version": "tv_wilder_rsi14_sma5_v1",
            "signal_month": "2026-07",
            "price_date": "2026-08-04",
            "summary": {"active_count": 1},
            "records": [{
                "code": "1111", "status": "CONTINUE",
                "provisional": {"status": "DC", "is_provisional": True},
            }],
            "recent_out": [],
            "cost_policy": "paid_api_disabled",
        }
        self.events = {
            "schema_version": "kabutane_daily_events_v1",
            "generated_at": "2026-08-04T12:01:00+00:00",
            "snapshot_date": "2026-08-04",
            "previous_snapshot_date": "2026-08-03",
            "comparison_state": "compared",
            "signal_version": "tv_wilder_rsi14_sma5_v1",
            "signal_month": "2026-07",
            "summary": {
                "event_count": 1, "high_count": 1, "medium_count": 0, "low_count": 0,
                "signal_count": 1, "ranking_count": 0, "price_count": 0, "performance_count": 0,
            },
            "events": [{
                "event_id": "2026-08-04:PROVISIONAL_DC:1111:test",
                "date": "2026-08-04", "type": "PROVISIONAL_DC", "category": "signal",
                "severity": "high", "priority": 92, "code": "1111", "name": "Alpha",
                "title": "暫定DCを検出", "detail": "test",
            }],
            "rules": {"price_move_threshold_pct": 3.0},
            "cost_policy": "paid_api_disabled",
        }

    def test_valid_snapshot_and_event_feed(self) -> None:
        validate_snapshot(self.snapshot)
        validate_events(self.events, self.snapshot)

    def test_paid_api_policy_change_is_rejected(self) -> None:
        payload = copy.deepcopy(self.events)
        payload["cost_policy"] = "paid_api_enabled"
        with self.assertRaisesRegex(ContractError, "paid API"):
            validate_events(payload, self.snapshot)

    def test_event_count_mismatch_is_rejected(self) -> None:
        payload = copy.deepcopy(self.events)
        payload["summary"]["event_count"] = 2
        with self.assertRaisesRegex(ContractError, "event_count"):
            validate_events(payload, self.snapshot)

    def test_snapshot_event_date_mismatch_is_rejected(self) -> None:
        payload = copy.deepcopy(self.events)
        payload["snapshot_date"] = "2026-08-05"
        with self.assertRaisesRegex(ContractError, "date mismatch"):
            validate_events(payload, self.snapshot)

    def test_duplicate_event_ids_are_rejected(self) -> None:
        payload = copy.deepcopy(self.events)
        payload["events"].append(copy.deepcopy(payload["events"][0]))
        payload["summary"]["event_count"] = 2
        payload["summary"]["high_count"] = 2
        with self.assertRaisesRegex(ContractError, "duplicate event_id"):
            validate_events(payload, self.snapshot)


if __name__ == "__main__":
    unittest.main()
