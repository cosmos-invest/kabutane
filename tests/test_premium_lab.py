from __future__ import annotations

import unittest

from scripts import build_premium_lab as premium


class PremiumLabTests(unittest.TestCase):
    def test_provisional_gc_is_highest_signal_component(self):
        gc, _ = premium.signal_score({"provisional_status": "GC", "monthly_rsi_spread": 0.5})
        near, _ = premium.signal_score({"provisional_status": "NEAR_GC", "monthly_rsi_spread": -0.5})
        out, _ = premium.signal_score({"provisional_status": "OUT", "monthly_rsi_spread": -8})
        self.assertGreater(gc, near)
        self.assertGreater(near, out)

    def test_supply_and_trend_raise_observation_priority(self):
        row = {
            "code": "5243", "ticker": "5243.T", "name": "note", "market": "グロース（内国株式）",
            "provisional_status": "GC", "monthly_rsi_spread": 0.4,
            "above_sma200": True, "perfect_order": True, "volume_ratio_5_30": 2.1, "high52_distance_pct": -3,
            "fundamentals_available": True, "roe_pct": 10, "equity_ratio_pct": 50, "revenue_growth_pct": 5, "free_cashflow_oku": 2,
        }
        supply = {"grade": "A", "score": 70, "reasons": ["買い残減少"], "buy_reduction_pct": 20, "ratio_reduction_pct": 30}
        result = premium.build_row(row, supply)
        self.assertGreaterEqual(result["priority_score"], 70)
        self.assertIn("暫定GC", result["tags"])
        self.assertIn("需給A", result["tags"])

    def test_missing_fundamentals_are_not_zero_quality_claims(self):
        score, reasons = premium.finance_score({"fundamentals_available": False})
        self.assertEqual(score, 0)
        self.assertEqual(reasons, [])


if __name__ == "__main__":
    unittest.main()
