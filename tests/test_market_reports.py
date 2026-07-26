import unittest

import build_market_reports as reports


class MarketReportsTest(unittest.TestCase):
    def test_normalize_market_and_sector(self):
        self.assertEqual(reports.normalize_market("プライム（内国株式）"), "プライム")
        self.assertEqual(reports.SECTOR_NAMES[5250], "情報・通信業")

    def test_build_ranking_keeps_previous_position_and_price(self):
        latest = {
            "signal_month": "2026-06",
            "daily_price_date": "2026-07-24",
            "records": [
                {"code": "1111", "name": "A", "current_price": 120, "return_since_gc_pct": 20},
                {"code": "2222", "name": "B", "current_price": 220, "return_since_gc_pct": 30},
            ],
        }
        previous = {"rows": [
            {"code": "1111", "rank": 1, "current_price": 100},
            {"code": "2222", "rank": 2, "current_price": 200},
        ]}
        ranking = reports.build_ranking(latest, previous, "2026-07-24")
        self.assertEqual(ranking["rows"][0]["code"], "2222")
        self.assertEqual(ranking["rows"][0]["rank_change"], 1)
        self.assertEqual(ranking["rows"][0]["daily_change_pct"], 10)
        self.assertEqual(latest["records"][1]["gc_return_rank"], 1)

    def test_daily_change_summary(self):
        ranking = {"generated_at": "x", "price_date": "2026-07-24", "rows": [
            {"rank": 1, "previous_rank": 3, "rank_change": 2, "daily_change_pct": 4},
            {"rank": 2, "previous_rank": 1, "rank_change": -1, "daily_change_pct": -1},
        ]}
        result = reports.build_daily_change(ranking, {"rows": [{"code": "x"}]})
        self.assertTrue(result["has_previous_day"])
        self.assertEqual(result["summary"]["rank_up_count"], 1)
        self.assertEqual(result["summary"]["rank_down_count"], 1)

    def test_group_monthly(self):
        active = [
            {"code": "1", "market": "プライム", "status": "NEW", "diff": 1.2},
            {"code": "2", "market": "プライム", "status": "CONTINUE", "diff": 4.0},
        ]
        out = [{"code": "3", "market": "プライム"}]
        group = reports.group_monthly(active, out, "market")[0]
        self.assertEqual(group["new_count"], 1)
        self.assertEqual(group["out_count"], 1)
        self.assertEqual(group["near_cross_count"], 1)


if __name__ == "__main__":
    unittest.main()
