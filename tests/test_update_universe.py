from __future__ import annotations

import unittest

import pandas as pd

from update_universe import build_all_universe, build_universe, classify_issue, discover_excel_url


class UniverseUpdateTest(unittest.TestCase):
    def test_discover_excel_url(self) -> None:
        html = '<a href="/files/data_j.xls">Excel</a>'
        self.assertEqual(
            discover_excel_url(html),
            "https://www.jpx.co.jp/files/data_j.xls",
        )

    def test_classifies_core_and_extended_issue_types(self) -> None:
        self.assertEqual(classify_issue("プライム（内国株式）"), ("domestic_common_stock", "core"))
        self.assertEqual(classify_issue("スタンダード（外国株式）"), ("foreign_stock", "extended"))
        self.assertEqual(classify_issue("ETF・ETN"), ("etf", "extended"))
        self.assertEqual(classify_issue("不動産投資信託(REIT)"), ("reit", "extended"))
        self.assertEqual(classify_issue("TOKYO PRO Market"), ("tokyo_pro", "extended"))
        self.assertEqual(classify_issue("インフラファンド"), ("infrastructure_fund", "extended"))

    def test_builds_all_listed_catalog_and_keeps_core_scanner_separate(self) -> None:
        rows = []
        for index in range(4001):
            if index < 3200:
                market = ["プライム（内国株式）", "スタンダード（内国株式）", "グロース（内国株式）"][index % 3]
            elif index < 3400:
                market = "TOKYO PRO Market"
            elif index < 3800:
                market = "ETF"
            elif index < 3950:
                market = "不動産投資信託(REIT)"
            else:
                market = "ETN"
            rows.append({"コード": f"{1000 + index:04d}"[-4:], "銘柄名": f"銘柄{index}", "市場・商品区分": market, "33業種区分": "情報・通信業"})

        frame = pd.DataFrame(rows)
        all_issues = build_all_universe(frame)
        core = build_universe(frame)
        self.assertGreaterEqual(len(all_issues), 4000)
        self.assertGreaterEqual(len(core), 3000)
        self.assertTrue((all_issues["scope"] == "extended").any())
        self.assertFalse(core["market"].str.contains("ETF|REIT|TOKYO PRO|ETN", regex=True).any())
        self.assertIn("instrument_type", all_issues.columns)
        self.assertIn("scope", all_issues.columns)


if __name__ == "__main__":
    unittest.main()
