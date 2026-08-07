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
            self.assertEqual(first["generation"], 1)
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
            self.assertEqual([item["generation"] for item in month["snapshots"]], [1, 2])

    def test_same_timestamp_generations_keep_append_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "opportunity.json"
            history = root / "history"
            payload.write_text(json.dumps(self.opportunity("2026-07-03", generated_suffix="12:00:00")), encoding="utf-8")
            first = research.record_snapshot(payload, history)
            payload.write_text(json.dumps(self.opportunity("2026-07-03", shift=4, generated_suffix="12:00:00")), encoding="utf-8")
            second = research.record_snapshot(payload, history)
            loaded = research.load_snapshots(history, research.ENGINE_VERSION)
            latest = research.latest_snapshot_per_date(loaded)[0]
            self.assertEqual(first["generation"], 1)
            self.assertEqual(second["generation"], 2)
            self.assertEqual(latest["snapshot_id"], second["snapshot_id"])
            self.assertEqual(research.cohort_rows(latest)[0]["price"], 104.0)

    def test_fixed_top_selection_requires_complete_coverage(self):
        selected = [{"code": f"{index:04d}"} for index in range(20)]
        returns = {row["code"]: 1.0 for row in selected}
        returns[selected[-1]["code"]] = None
        self.assertIsNone(research.selected_returns(selected, returns, require_complete=True))
        covered = research.selected_returns(selected, returns)
        self.assertIsNotNone(covered)
        self.assertEqual(len(covered), 19)

    def test_later_recorded_generation_is_not_backdated_into_old_price_cohort(self):
        eligible_payload = self.opportunity("2026-07-03")
        eligible_payload["recorded_at"] = "2026-07-03T07:00:00+00:00"
        late_payload = self.opportunity("2026-07-03", shift=4)
        late_payload["recorded_at"] = "2026-07-03T16:00:00+00:00"
        eligible = research.compact_snapshot(eligible_payload)
        late = research.compact_snapshot(late_payload)
        self.assertEqual(research.cohort_rows(late), [])
        latest = research.latest_snapshot_per_date([eligible, late])
        self.assertEqual(len(latest), 1)
        self.assertEqual(research.cohort_rows(latest[0])[0]["price"], 100.0)

    def test_challenger_readiness_uses_its_own_complete_cohorts(self):
        self.assertFalse(research.experiment_is_mature({"5d": {"cohorts": 20}, "20d": {"cohorts": 11}}))
        self.assertFalse(research.experiment_is_mature({"5d": {"cohorts": 19}, "20d": {"cohorts": 12}}))
        self.assertTrue(research.experiment_is_mature({"5d": {"cohorts": 20}, "20d": {"cohorts": 12}}))

    def test_baseline_is_comparison_only_not_challenger(self):
        mature = {"5d": {"cohorts": 20}, "20d": {"cohorts": 12}}
        immature = {"5d": {"cohorts": 19}, "20d": {"cohorts": 12}}
        result = {"baseline": mature, "signal_heavy": immature}
        self.assertEqual(research.eligible_challenger_names(result), [])
        result["signal_heavy"] = mature
        self.assertEqual(research.eligible_challenger_names(result), ["signal_heavy"])

    def test_future_return_rejects_entry_outside_retained_window(self):
        series = {"1001": (["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10"], [100, 101, 102, 103, 104, 105])}
        self.assertIsNone(research.future_return(series, "1001", "2025-08-01", 80, 5))
        self.assertAlmostEqual(research.future_return(series, "1001", "2026-08-03", 100, 5), 5.0, places=10)

    def test_fallback_can_use_entry_snapshot_when_constituent_disappears(self):
        snapshot = research.compact_snapshot(self.opportunity("2026-07-03"))
        observed = research.fallback_observation([snapshot], "1001", "2026-07-03", "2026-07-10")
        self.assertEqual(observed, ("2026-07-03", 100.0))

    def test_missing_target_uses_last_market_close_before_snapshot_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            snapshot = research.compact_snapshot(self.opportunity("2026-07-03"))
            self.write_history(history, [snapshot])
            charts = core / "charts"
            daily = core / "daily"
            charts.mkdir(parents=True, exist_ok=True)
            daily.mkdir(parents=True, exist_ok=True)
            full_dates = ["2026-07-03", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]
            stopped = [
                ["2026-07-03", 100, 100, 100, 100, 1000],
                ["2026-07-06", 101, 101, 101, 101, 1000],
                ["2026-07-07", 102, 102, 102, 102, 1000],
                ["2026-07-08", 103, 103, 103, 103, 1000],
            ]
            calendar_rows = [[value_date, 100, 100, 100, 100, 1000] for value_date in full_dates]
            (charts / "10.json").write_text(json.dumps({"records": {"1001": {"daily": stopped}, "1002": {"daily": calendar_rows}}}), encoding="utf-8")
            (daily / "10.json").write_text(json.dumps({"records": {}}), encoding="utf-8")
            series = research.load_price_series(core)
            research.finalize_outcomes([snapshot], series, outcomes, research.ENGINE_VERSION)
            ledger = json.loads(next(outcomes.glob("*.json")).read_text(encoding="utf-8"))
            result = ledger["cohorts"][snapshot["snapshot_id"]]["5d"]["1001"]
            self.assertEqual(result[0], "2026-07-10")
            self.assertEqual(result[1], "2026-07-08")
            self.assertEqual(result[2], 103.0)
            self.assertEqual(result[3], 3.0)
            self.assertEqual(result[4], "last_market_close_before_target")

    def test_split_ratio_accumulates_within_return_period(self):
        events = {"1001": [("2026-07-03", 3.0), ("2026-07-06", 2.0), ("2026-07-08", 0.5), ("2026-07-10", 4.0)]}
        self.assertEqual(research.cumulative_split_ratio(events, "1001", "2026-07-03", "2026-07-08"), 1.0)

    def test_split_adjusts_outcome_before_it_is_frozen(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            snapshot = research.compact_snapshot(self.opportunity("2026-07-03"))
            self.write_history(history, [snapshot])
            self.write_prices(core)
            chart = core / "charts" / "10.json"
            payload = json.loads(chart.read_text(encoding="utf-8"))
            exit_row = next(row for row in payload["records"]["1001"]["daily"] if row[0] == "2026-07-10")
            exit_row[4] = 52.5
            payload["records"]["1001"]["corporate_events"] = [
                {"date": "2026-07-10", "type": "SPLIT", "detail": "比率 2", "ratio": 2.0}
            ]
            chart.write_text(json.dumps(payload), encoding="utf-8")
            series = research.load_price_series(core)
            splits = research.load_split_events(core)
            research.finalize_outcomes([snapshot], series, outcomes, research.ENGINE_VERSION, splits)
            ledger = json.loads(next(outcomes.glob("*.json")).read_text(encoding="utf-8"))
            result = ledger["cohorts"][snapshot["snapshot_id"]]["5d"]["1001"]
            self.assertEqual(result[3], 5.0)
            self.assertEqual(result[5], 2.0)

            exit_row[4] = 1.0
            chart.write_text(json.dumps(payload), encoding="utf-8")
            research.finalize_outcomes([snapshot], research.load_price_series(core), outcomes, research.ENGINE_VERSION, splits)
            self.assertEqual(json.loads(next(outcomes.glob("*.json")).read_text(encoding="utf-8")), ledger)

    def test_archived_split_survives_current_shard_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "history"
            outcomes = root / "outcomes"
            core = root / "core"
            premium = root / "opportunity.json"
            archive = root / "split-events.json"
            first_payload = self.opportunity("2026-07-03")
            second_payload = self.opportunity("2026-07-10")
            second_payload["records"][0]["current_price"] = 52.5
            first = research.compact_snapshot(first_payload)
            second = research.compact_snapshot(second_payload)
            self.write_history(history, [first, second])
            self.write_prices(core, {"1002", "1003"})
            premium.write_text(json.dumps(second_payload), encoding="utf-8")
            research.archive_split_events({"1001": [("2026-07-10", 2.0)]}, archive, research.ENGINE_VERSION)
            retained = research.archive_split_events({}, archive, research.ENGINE_VERSION)
            self.assertEqual(research.cumulative_split_ratio(retained, "1001", "2026-07-03", "2026-07-10"), 2.0)
            research.evaluate(history, core, premium, outcomes, archive)
            ledger = json.loads(next(outcomes.glob("*.json")).read_text(encoding="utf-8"))
            result = ledger["cohorts"][first["snapshot_id"]]["5d"]["1001"]
            self.assertEqual(result[3], 5.0)
            self.assertEqual(result[5], 2.0)

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
            self.assertEqual(summary["eligible_challengers"], [])


if __name__ == "__main__":
    unittest.main()
