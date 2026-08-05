from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicStockUniverseTests(unittest.TestCase):
    def text(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_all_stock_page_is_beginner_first(self):
        html = self.text("all-stocks.html")
        self.assertIn("コスモスフィルター", html)
        self.assertIn("ルーモフィルター", html)
        self.assertIn("エールフィルター", html)
        self.assertIn("玄人向け設定", html)
        self.assertIn("allStocksRoeMin", html)
        self.assertIn("allStocksEquityMin", html)
        self.assertIn("allStocksPerMax", html)

    def test_public_page_has_no_provisional_gc_filter_or_label(self):
        html = self.text("all-stocks.html")
        self.assertNotIn('value="GC"', html)
        self.assertNotIn('data-signal="GC"', html)
        self.assertNotIn("暫定GC", html)
        self.assertIn('value="NEAR_GC"', html)
        self.assertIn('value="DC"', html)

    def test_public_js_maps_gc_back_to_public_confirmed_side(self):
        js = self.text("assets/all-stocks.js")
        self.assertIn('if (raw === "GC")', js)
        self.assertIn('return ["NEW", "CONTINUE"].includes(confirmed) ? "CONTINUE" : "OUT"', js)
        self.assertIn('signal=GC is intentionally ignored', js)
        self.assertNotIn('monthly_rsi_spread)', js.split('function filteredRows()', 1)[1].split('function renderGuideCounts', 1)[0])

    def test_public_detail_sanitizes_provisional_gc(self):
        js = self.text("assets/core-detail-fallback.js")
        detail = self.text("detail.html")
        self.assertIn('isPremiumOnlyProvisional', js)
        self.assertIn('provisional_signal: null', js)
        self.assertIn('publicProvisional(daily.provisional_signal)', js)
        self.assertIn('core-detail-fallback.js?v=2', detail)
        self.assertIn('先回り判定はプレミアム観察情報', detail)

    def test_premium_page_keeps_provisional_gc(self):
        html = self.text("premium-supply-beta.html")
        js = self.text("assets/premium-supply-beta.js")
        self.assertIn("暫定GC", html)
        self.assertIn('GC: "暫定GC"', js)

    def test_repository_product_rule_is_durable(self):
        rules = self.text("AGENTS.md")
        self.assertIn("暫定GCはプレミアム専用", rules)
        self.assertIn("コスモス🌸 / ルーモ✨ / エール💜", rules)
        self.assertIn("玄人向け設定", rules)
        self.assertIn("learn.html", rules)


if __name__ == "__main__":
    unittest.main()
