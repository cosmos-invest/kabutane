from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts import premium_research as research


class PremiumResearchTests(unittest.TestCase):
    def opportunity(self, price_date: str, shift: float = 0.0):
        return {
            "price_date": price_date,
            "generated_at": f"{price_date}T12:00:00+00:00",
            "engine_version": research.ENGINE_VERSION,
            "records": [
                {"code": "1001", "name": "A", "current_price": 100 + shift, "priority_score": 90, "provisional_status": "GC", "score_components": {"signal": 40, "trend_volume": 18, "supply": 24, "finance": 8}},
                {"code": "1002", "name": "B", "current_price": 100, "priority_score": 70, "provisional_status": "NEAR_GC", "score_components": {"signal": 32, "trend_volume": 14, "supply": 18, "finance": 6}},
                {"code": "1003", "name": "C", "current_price": 100, "priority_score": 40, "provisional_status": "OUT", "score_components": {"signal": 0, "trend_volume": 16, "supply": 18, "finance": 6}},
            ],
        }

    def write_prices(self, root: Path):
        charts = root / "charts"
        daily = root / "daily"
        charts.mkdir(parents=True)
        daily.mkdir(parents=True)
        start = date(2026, 7, 1)
        dates = []
        current = start
        while len(dates) < 45:
            if current.weekday() < 5:
                dates.append(current.isoformat())
            current += timedelta(days=1)
        records = {}
        for code, drift in [("1001", 1.0), ("1002", 0.25), ("1003", -0.15)]:
            rows = []
            for index, value_date in enumerate(dates):
                close = 100 + drift * index
                rows.append([value_date, close, close, close, close, 1000])
            records[code] = {"daily": rows}
        (charts / "10.json").write_text(json.dumps({"records": records}), encoding="utf-8")
        (daily / "10.json").write_text(json.dumps({"records": {}}), encoding="utf-8")

    def test_record_snapshot_is_compact_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "opportunity.json"
            history = root / "history"
            payload.write_text(json.dumps(self.opportunity("2026-07-03")), encoding="utf-8")
            first = research.record_snapshot(payload, history)
            second = research.record_snapshot(payload, history)
            self.assertEqual(first["price_date"], "2026-07-03")
            month = json.loads((history / "2026-07.json").read_text(encoding="utf-8"))
            self.assertEqual(len(month["snapshots"]), 1)
            self.assertEqual(month["snapshots"][0]["records"][0][0], "1001")
            self.assertEqual(len(month["snapshots"][0]["records"][0]), 8)

    def test_evaluate_tracks_forward_returns_and_market_excess(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            core = root / "core"
            premium = root / "opportunity.json"
            history.mkdir()
            snapshots = [
                research.compact_snapshot(self.opportunity("2026-07-03")),
                research.compact_snapshot(self.opportunity("2026-07-10", 5)),
            ]
            (history / "2026-07.json").write_text(json.dumps({"snapshots": snapshots}), encoding="utf-8")
            self.write_prices(core)
            premium.write_text(json.dumps(self.opportunity("2026-07-10", 5)), encoding="utf-8")
            summary = research.evaluate(history, core, premium)
            self.assertEqual(summary["snapshot_count"], 2)
            self.assertEqual(summary["weekly_cohort_count"], 2)
            self.assertGreaterEqual(summary["mature_cohorts"]["5d"], 1)
            top10 = summary["portfolios"]["top10"]["5d"]
            self.assertGreater(top10["positions"], 0)
            self.assertIsNotNone(top10["portfolio_mean_pct"])
            self.assertIsNotNone(top10["excess_vs_all_core_pct"])

    def test_formal_recommendation_waits_for_maturity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            core = root / "core"
            premium = root / "opportunity.json"
            history.mkdir()
            (history / "2026-07.json").write_text(json.dumps({"snapshots": [research.compact_snapshot(self.opportunity("2026-07-03"))]}), encoding="utf-8")
            self.write_prices(core)
            premium.write_text(json.dumps(self.opportunity("2026-07-03")), encoding="utf-8")
            summary = research.evaluate(history, core, premium)
            self.assertFalse(summary["recommendation_ready"])
            self.assertIsNone(summary["best_challenger"])


if __name__ == "__main__":
    unittest.main()
