from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts import premium_research as research


class PremiumResearchTests(unittest.TestCase):
    def opportunity(self, price_date: str, shift: float = 0.0, generated_suffix: str = "12:00:00"):
        return {
            "price_date": price_date,
            "generated_at": f"{price_date}T{generated_suffix}+00:00",
            "engine_version": research.ENGINE_VERSION,
            "records": [
                {"code": "1001", "name": "A", "price_date": price_date, "current_price": 100 + shift, "priority_score": 90, "provisional_status": "GC", "score_components": {"signal": 40, "trend_volume": 18, "supply": 24, "finance": 8}},
                {"code": "1002", "name": "B", "price_date": price_date, "current_price": 100, "priority_score": 70, "provisional_status": "NEAR_GC", "score_components": {"signal": 32, "trend_volume": 14, "supply": 18, "finance": 6}},
                {"code": "1003", "name": "C", "price_date": price_date, "current_price": 100, "priority_score": 40, "provisional_status": "OUT", "score_components": {"signal": 0, "trend_volume": 16, "supply": 18, "finance": 6}},
            ],
        }

    def write_prices(self, root: Path, codes: set[str] | None = None):
        charts = root / "charts"
        daily = root / "daily"
        charts.mkdir(parents=True, exist_ok=True)
        daily.mkdir(parents=True, exist_ok=True)
        start = date(2026, 7, 1)
        dates = []
        current = start
        while len(dates) < 45:
            if current.weekday() < 5:
                dates.append(current.isoformat())
            current += timedelta(days=1)
        records = {}
        for code, drift in [("1001", 1.0), ("1002", 0.25), ("1003", -0.15)]:
            if codes is not None and code not in codes:
                continue
            rows = []
            for index, value_date in enumerate(dates):
                close = 100 + drift * index
                rows.append([value_date, close, close, close, close, 1000])
            records[code] = {"daily": rows}
        (charts / "10.json").write_text(json.dumps({"records": records}), encoding="utf-8")
        (daily / "10.json").write_text(json.dumps({"records": {}}), encoding="utf-8")

    def write_history(self, history: Path, snapshots: list[dict]):
        history.mkdir(parents=True, exist_ok=True)
        (history / "2026-07.json").write_text(
            json.dumps({"engine_version": research.ENGINE_VERSION, "snapshots": snapshots}),
            encoding="utf-8",
        )

    def test_record_snapshot_is_compact_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "opportunity.json"
            history = root / "history"
            payload.write_text(json.dumps(self.opportunity("2026-07-03")), encoding="utf-8")
            first = research.record_snapshot(payload, history)
            second = research.record_snapshot(payload, history)
            self.assertEqual(first["price_date"], "2026-07-03")
            self.assertEqual(first["snapshot_id"], second["snapshot_id"])
            month = json.loads((history / "2026-07.json").read_text(encoding="utf-8"))
            self.assertEqual(len(month["snapshots"]), 1)
            self.assertEqual(month["snapshots"][0]["records"][0][0], "1001")
            self.assertEqual(month["snapshots"][0]["records"][0][1], "2026-07-03")
            self.assertEqual(len(month["snapshots"][0]["records"][0]), 9)

    def test_different_same_date_snapshot_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "opportunity.json"
            history = root / "history"
            payload.write_text(json.dumps(self.opportunity("2026-07-03")), encoding="utf-8")
            first = research.record_snapshot(payload, history)
            payload.write_text(json.dumps(self.opportunity("2026-07-03", shift=4, generated_suffix="15:00:00")), encoding="utf-8")
            second = research.record_snapshot(payload, history)
            month = json.loads((history / "2026-07.json").read_text(encoding="utf-8"))
            self.assertNotEqual(first["snapshot_id"], second["snapshot_id"])
            self.assertEqual(len(month["snapshots"]), 2)
            self.assertEqual(month["snapshots"][0]["records"][0][2], 100.0)
            self.assertEqual(month["snapshots"][1]["records"][0][2], 104.0)

    def test_future_return_rejects_entry_outside_retained_window(self):
        series = {"1001": (["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10"], [100, 101, 102, 103, 104, 105])}
        self.assertIsNone(research.future_return(series, "1001", "2025-08-01", 80, 5))
        self.assertEqual(research.future_return(series, "1001", "2026-08-03", 100, 5), 5.0)

    def test_evaluate_tracks_forward_returns_and_market_excess(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            premium = root / "opportunity.json"
            snapshots = [
                research.compact_snapshot(self.opportunity("2026-07-03")),
                research.compact_snapshot(self.opportunity("2026-07-10", 5)),
            ]
            self.write_history(history, snapshots)
            self.write_prices(core)
            premium.write_text(json.dumps(self.opportunity("2026-07-10", 5)), encoding="utf-8")
            summary = research.evaluate(history, core, premium, outcomes)
            self.assertEqual(summary["snapshot_count"], 2)
            self.assertEqual(summary["snapshot_day_count"], 2)
            self.assertEqual(summary["weekly_cohort_count"], 2)
            self.assertGreaterEqual(summary["mature_cohorts"]["5d"], 1)
            top10 = summary["portfolios"]["top10"]["5d"]
            self.assertGreater(top10["positions"], 0)
            self.assertIsNotNone(top10["portfolio_mean_pct"])
            self.assertIsNotNone(top10["excess_vs_all_core_pct"])
            self.assertTrue(any(outcomes.glob("*.json")))

    def test_stale_constituent_is_excluded_from_cohort(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            premium = root / "opportunity.json"
            payload = self.opportunity("2026-07-10")
            payload["records"][0]["price_date"] = "2026-07-03"
            snapshot = research.compact_snapshot(payload)
            self.write_history(history, [snapshot])
            self.write_prices(core)
            premium.write_text(json.dumps(payload), encoding="utf-8")
            rows = research.cohort_rows(snapshot)
            self.assertEqual({row["code"] for row in rows}, {"1002", "1003"})
            summary = research.evaluate(history, core, premium, outcomes)
            top10 = summary["portfolios"]["top10"]["5d"]
            self.assertEqual(top10["positions"], 2)

    def test_finalized_outcome_survives_constituent_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            premium = root / "opportunity.json"
            snapshot = research.compact_snapshot(self.opportunity("2026-07-03"))
            self.write_history(history, [snapshot])
            self.write_prices(core)
            premium.write_text(json.dumps(self.opportunity("2026-07-03")), encoding="utf-8")

            first = research.evaluate(history, core, premium, outcomes)
            first_result = first["portfolios"]["top10"]["5d"]
            self.assertEqual(first_result["positions"], 3)
            outcome_before = json.loads(next(outcomes.glob("*.json")).read_text(encoding="utf-8"))

            self.write_prices(core, {"1002", "1003"})
            second = research.evaluate(history, core, premium, outcomes)
            second_result = second["portfolios"]["top10"]["5d"]
            outcome_after = json.loads(next(outcomes.glob("*.json")).read_text(encoding="utf-8"))

            self.assertEqual(first_result, second_result)
            self.assertEqual(outcome_before, outcome_after)

    def test_engine_version_filter_prevents_mixing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            history.mkdir()
            good = research.compact_snapshot(self.opportunity("2026-07-03"))
            old = dict(good)
            old["engine_version"] = "old_engine"
            old["snapshot_id"] = "old:1"
            old["fingerprint"] = "old"
            (history / "2026-07.json").write_text(json.dumps({"snapshots": [good, old]}), encoding="utf-8")
            loaded = research.load_snapshots(history, research.ENGINE_VERSION)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0]["engine_version"], research.ENGINE_VERSION)

    def test_formal_recommendation_waits_for_maturity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            premium = root / "opportunity.json"
            self.write_history(history, [research.compact_snapshot(self.opportunity("2026-07-03"))])
            self.write_prices(core)
            premium.write_text(json.dumps(self.opportunity("2026-07-03")), encoding="utf-8")
            summary = research.evaluate(history, core, premium, outcomes)
            self.assertFalse(summary["recommendation_ready"])
            self.assertIsNone(summary["best_challenger"])


if __name__ == "__main__":
    unittest.main()
