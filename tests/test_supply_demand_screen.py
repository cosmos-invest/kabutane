from __future__ import annotations

from pathlib import Path
import unittest

from scripts.build_supply_demand_screen import score_history

ROOT = Path(__file__).resolve().parents[1]


class SupplyDemandScreenTests(unittest.TestCase):
    def test_scores_buy_balance_reduction_and_ratio_improvement(self) -> None:
        history = [
            {"date": "2026-07-03", "buy_balance": 200000, "sell_balance": 20000, "ratio": 10.0, "buy_change": 0},
            {"date": "2026-07-10", "buy_balance": 180000, "sell_balance": 22000, "ratio": 8.18, "buy_change": -20000},
            {"date": "2026-07-17", "buy_balance": 165000, "sell_balance": 25000, "ratio": 6.6, "buy_change": -15000},
            {"date": "2026-07-24", "buy_balance": 150000, "sell_balance": 28000, "ratio": 5.36, "buy_change": -15000},
            {"date": "2026-07-31", "buy_balance": 135000, "sell_balance": 30000, "ratio": 4.5, "buy_change": -15000},
        ]
        result = score_history(history)
        self.assertIsNotNone(result)
        assert result is not None
        self.assertGreaterEqual(result["score"], 65)
        self.assertGreater(result["buy_reduction_pct"], 30)
        self.assertGreater(result["ratio_reduction_pct"], 50)
        self.assertEqual(result["buy_down_steps"], 4)

    def test_requires_at_least_four_weeks(self) -> None:
        history = [
            {"date": "2026-07-10", "buy_balance": 100000, "sell_balance": 10000, "ratio": 10.0},
            {"date": "2026-07-17", "buy_balance": 90000, "sell_balance": 12000, "ratio": 7.5},
            {"date": "2026-07-24", "buy_balance": 80000, "sell_balance": 14000, "ratio": 5.71},
        ]
        self.assertIsNone(score_history(history))

    def test_does_not_promote_worsening_buy_balance(self) -> None:
        history = [
            {"date": "2026-07-03", "buy_balance": 100000, "sell_balance": 20000, "ratio": 5.0},
            {"date": "2026-07-10", "buy_balance": 110000, "sell_balance": 19000, "ratio": 5.79},
            {"date": "2026-07-17", "buy_balance": 120000, "sell_balance": 18000, "ratio": 6.67},
            {"date": "2026-07-24", "buy_balance": 130000, "sell_balance": 17000, "ratio": 7.65},
        ]
        self.assertIsNone(score_history(history))

    def test_hidden_beta_page_is_noindex_and_not_in_public_navigation(self) -> None:
        premium = (ROOT / "premium-supply-beta.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "premium-supply-beta.js").read_text(encoding="utf-8")
        self.assertIn('name="robots" content="noindex,nofollow,noarchive"', premium)
        self.assertIn("PRIVATE BETA", premium)
        self.assertIn("data/premium/opportunity-radar.json", script)
        self.assertIn("暫定GC", premium)
        for public_page in ("index.html", "learn.html", "howto.html"):
            text = (ROOT / public_page).read_text(encoding="utf-8")
            self.assertNotIn("premium-supply-beta.html", text, public_page)


if __name__ == "__main__":
    unittest.main()
