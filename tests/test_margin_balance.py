from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from scripts.update_margin_balance import (
    discover_recent_pdfs,
    merge_history,
    normalize_code,
    parse_report_text,
    write_shards,
)

ROOT = Path(__file__).resolve().parents[1]


class MarginBalanceTests(unittest.TestCase):
    def test_discovers_and_sorts_weekly_pdf_links(self):
        html = '''
        <a href="/common/pdf/syumatsu2026072400.pdf">7/24</a>
        <a href="/common/pdf/not-margin.pdf">other</a>
        <a href="/common/pdf/syumatsu2026073100.pdf">7/31</a>
        '''
        result = discover_recent_pdfs(html, "https://www.jpx.co.jp/markets/statistics-equities/margin/05.html")
        self.assertEqual([item[0] for item in result], ["2026-07-24", "2026-07-31"])
        self.assertTrue(result[-1][1].endswith("syumatsu2026073100.pdf"))

    def test_parses_total_sell_buy_and_negative_weekly_changes(self):
        text = (
            "日本フイルコン 59420 JP3756200005 0 0 198,500 ▲ 16,300 0 0 0 0 0 0 198,500 ▲ 16,300\n"
            "テスト銘柄 12340 JP0000000001 300 ▲ 100 87,400 6,500 0 0 300 ▲ 100 0 0 87,400 6,500\n"
        )
        records = parse_report_text(text, "2026-07-17")
        self.assertEqual(records["5942"]["sell_balance"], 0)
        self.assertEqual(records["5942"]["buy_balance"], 198500)
        self.assertEqual(records["5942"]["buy_change"], -16300)
        self.assertIsNone(records["5942"]["ratio"])
        self.assertEqual(records["1234"]["sell_change"], -100)
        self.assertEqual(records["1234"]["ratio"], 291.33)

    def test_normalizes_five_character_legacy_code(self):
        self.assertEqual(normalize_code("59420"), "5942")
        self.assertEqual(normalize_code("130A"), "130A")

    def test_merge_history_deduplicates_and_limits(self):
        existing = [{"date": "2026-07-03", "buy_balance": 1}, {"date": "2026-07-10", "buy_balance": 2}]
        incoming = [{"date": "2026-07-10", "buy_balance": 3}, {"date": "2026-07-17", "buy_balance": 4}]
        merged = merge_history(existing, incoming)
        self.assertEqual([item["date"] for item in merged], ["2026-07-03", "2026-07-10", "2026-07-17"])
        self.assertEqual(merged[1]["buy_balance"], 3)

    def test_writes_prefix_shards_and_latest_index(self):
        snapshots = [
            (
                "2026-07-31",
                "https://www.jpx.co.jp/sample/syumatsu2026073100.pdf",
                {
                    "5942": {"date": "2026-07-31", "sell_balance": 0, "sell_change": 0, "buy_balance": 200000, "buy_change": 1500, "ratio": None},
                    "5243": {"date": "2026-07-31", "sell_balance": 10000, "sell_change": 500, "buy_balance": 50000, "buy_change": -1000, "ratio": 5.0},
                },
            )
        ]
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            index = write_shards(snapshots, output)
            self.assertEqual(index["latest_date"], "2026-07-31")
            self.assertTrue((output / "59.json").exists())
            shard = json.loads((output / "59.json").read_text(encoding="utf-8"))
            self.assertEqual(shard["records"]["5942"][0]["buy_balance"], 200000)
            self.assertIsNone(shard["records"]["5942"][0]["ratio"])

    def test_detail_page_exposes_margin_supply_demand_panel(self):
        html = (ROOT / "detail.html").read_text(encoding="utf-8")
        for marker in (
            'id="marginBalancePanel"',
            'id="marginBalanceStats"',
            'id="marginBalanceChart"',
            'id="marginBalanceSummary"',
            'id="marginBalanceStatus"',
            "信用買い残",
            "信用売り残",
            "信用倍率",
            "日足チャートの表示期間と同期します",
            "learn.html#margin-balance",
            "assets/detail-margin-balance.css?v=2",
            "assets/detail-margin-balance.js?v=2",
            "assets/detail-chart-viewport.js?v=14",
        ):
            self.assertIn(marker, html)

    def test_margin_ui_handles_zero_sell_balance_without_infinity(self):
        script = (ROOT / "assets/detail-margin-balance.js").read_text(encoding="utf-8")
        for marker in (
            'return "—（売り残0）"',
            "data/margin/",
            "buy_balance",
            "sell_balance",
            "buy_change",
            "sell_change",
            "yRatio",
        ):
            self.assertIn(marker, script)
        self.assertNotIn("Infinity", script)

    def test_margin_chart_uses_same_daily_range_without_fabricating_daily_balances(self):
        margin = (ROOT / "assets/detail-margin-balance.js").read_text(encoding="utf-8")
        viewport = (ROOT / "assets/detail-chart-viewport.js").read_text(encoding="utf-8")
        for marker in (
            'Chart?.getChart?.("priceChart")',
            "alignRecordsToLabels",
            "nearestPriorLabelIndex",
            'new Array(labels.length).fill(null)',
            "spanGaps: true",
            'window.addEventListener("kabutane:detail-range-change"',
            "表示中${aligned.count}週・日足同期",
        ):
            self.assertIn(marker, margin)
        for marker in (
            'new CustomEvent("kabutane:detail-range-change"',
            'bindCanvas(document.getElementById("marginBalanceChart"))',
            "getVisibleDates",
        ):
            self.assertIn(marker, viewport)

    def test_learning_page_stays_in_sync_with_margin_source_and_interpretation(self):
        learn = (ROOT / "learn.html").read_text(encoding="utf-8")
        self.assertIn('id="margin-balance"', learn)
        self.assertIn("JPX", learn)
        self.assertIn("売り残0", learn)
        self.assertIn("基準日", learn)
        self.assertIn("倍率だけで良し悪しは決めません", learn)
        self.assertIn("日足チャートと表示期間を同期します", learn)
        self.assertIn("週と週の間を日次データのように補間しません", learn)


if __name__ == "__main__":
    unittest.main()
