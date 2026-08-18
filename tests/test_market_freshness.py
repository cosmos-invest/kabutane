from __future__ import annotations

import unittest

from scripts.validate_market_freshness import validate_daily_regression, validate_full_freshness


class MarketFreshnessTests(unittest.TestCase):
    def test_daily_regression_is_rejected(self) -> None:
        with self.assertRaises(RuntimeError):
            validate_daily_regression(
                {"price_date": "2026-08-14"},
                {"price_date": "2026-08-17"},
            )

    def test_equal_daily_date_is_allowed(self) -> None:
        self.assertEqual(
            validate_daily_regression(
                {"price_date": "2026-08-17"},
                {"price_date": "2026-08-17"},
            ),
            "2026-08-17",
        )

    def test_core_older_than_daily_is_rejected(self) -> None:
        daily = {"price_date": "2026-08-17"}
        core = {
            "generated_at": "core-new",
            "core_count": 1,
            "daily_coverage": 1,
            "records": [{"price_date": "2026-08-14"}],
        }
        premium = {"price_date": "2026-08-14", "source_core_generated_at": "core-new"}
        with self.assertRaises(RuntimeError):
            validate_full_freshness(daily, core, premium)

    def test_core_newer_than_daily_is_also_rejected(self) -> None:
        daily = {"price_date": "2026-08-17"}
        core = {
            "generated_at": "core-new",
            "core_count": 1,
            "daily_coverage": 1,
            "records": [{"price_date": "2026-08-18"}],
        }
        premium = {"price_date": "2026-08-18", "source_core_generated_at": "core-new"}
        with self.assertRaises(RuntimeError):
            validate_full_freshness(daily, core, premium)

    def test_partial_stale_core_is_rejected(self) -> None:
        daily = {"price_date": "2026-08-17"}
        records = [{"price_date": "2026-08-17"}] + [{"price_date": "2026-08-14"} for _ in range(9)]
        core = {
            "generated_at": "core-new",
            "core_count": 10,
            "daily_coverage": 10,
            "records": records,
        }
        premium = {"price_date": "2026-08-17", "source_core_generated_at": "core-new"}
        with self.assertRaises(RuntimeError):
            validate_full_freshness(daily, core, premium)

    def test_premium_must_come_from_current_core(self) -> None:
        daily = {"price_date": "2026-08-17"}
        core = {
            "generated_at": "core-new",
            "core_count": 1,
            "daily_coverage": 1,
            "records": [{"price_date": "2026-08-17"}],
        }
        premium = {"price_date": "2026-08-17", "source_core_generated_at": "core-old"}
        with self.assertRaises(RuntimeError):
            validate_full_freshness(daily, core, premium)

    def test_consistent_payloads_pass(self) -> None:
        daily = {"price_date": "2026-08-17"}
        core = {
            "generated_at": "core-new",
            "core_count": 10,
            "daily_coverage": 10,
            "records": [{"price_date": "2026-08-17"} for _ in range(10)],
        }
        premium = {"price_date": "2026-08-17", "source_core_generated_at": "core-new"}
        result = validate_full_freshness(daily, core, premium)
        self.assertEqual(result["core_date"], "2026-08-17")


if __name__ == "__main__":
    unittest.main()
