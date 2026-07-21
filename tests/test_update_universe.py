from __future__ import annotations

import unittest

import pandas as pd

from update_universe import build_universe, discover_excel_url


class UniverseUpdateTest(unittest.TestCase):
    def test_discover_excel_url(self) -> None:
        html = '<a href="/files/data_j.xls">Excel</a>'
        self.assertEqual(
            discover_excel_url(html),
            "https://www.jpx.co.jp/files/data_j.xls",
        )

    def test_build_universe_filters_markets(self) -> None:
        rows = []
        for index in range(3001):
            market = ["プライム（内国株式）", "スタンダード（内国株式）", "グロース（内国株式）"][index % 3]
            rows.append({"コード": f"{1000 + index:04d}"[-4:], "銘柄名": f"会社{index}", "市場・商品区分": market, "33業種区分": "情報・通信業"})
        rows.append({"コード": "9999", "銘柄名": "ETF", "市場・商品区分": "ETF・ETN", "33業種区分": "-"})
        result = build_universe(pd.DataFrame(rows))
        self.assertGreaterEqual(len(result), 3000)
        self.assertFalse(result["market"].str.contains("ETF").any())


if __name__ == "__main__":
    unittest.main()
