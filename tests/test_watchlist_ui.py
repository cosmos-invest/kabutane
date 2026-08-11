from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WatchlistUiTests(unittest.TestCase):
    def text(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_watchlist_is_browser_local(self):
        html = self.text("watchlist.html")
        js = self.text("assets/watchlist.js")
        self.assertIn("localStorage", html)
        self.assertIn('kabutane.watchlist.v1', js)
        self.assertIn("別端末・別ブラウザ", html)
        self.assertNotIn("fetch(\"/api/watchlist", js)

    def test_watchlist_restricts_codes_and_escapes_saved_text(self):
        store = self.text("assets/watchlist.js")
        page = self.text("assets/watchlist-page.js")
        self.assertIn("/^[0-9]{3}[0-9A-Z]$/", store)
        self.assertIn("function escapeHtml", page)
        self.assertIn("escapeHtml(item.name", page)
        self.assertIn("escapeHtml(item.market", page)
        self.assertIn("store.normalizeCode(item.code)", page)
        self.assertNotIn('${item.code} ${item.name || ""}', page)

    def test_watchlist_does_not_rank_or_discover_provisional_gc(self):
        html = self.text("watchlist.html")
        page = self.text("assets/watchlist-page.js")
        self.assertNotIn('value="status"', html)
        self.assertNotIn('mode === "status"', page)
        self.assertNotIn("GC: 6", page)
        self.assertIn("statusLabel(item.provisional_status)", page)

    def test_watchlist_never_uses_sanitized_public_status_as_provisional_truth(self):
        page = self.text("assets/watchlist-page.js")
        self.assertNotIn("provisional.status || pub.provisional_status", page)
        self.assertNotIn("pub.provisional_status || \"UNKNOWN\"", page)
        self.assertIn('provisional_status: provisionalAvailable ? provisional.status : "UNKNOWN"', page)
        self.assertIn("item.provisional_available !== true", page)

    def test_all_stock_and_detail_have_watch_controls(self):
        all_stocks = self.text("all-stocks.html")
        detail = self.text("detail.html")
        self.assertIn("assets/watchlist.js?v=1", all_stocks)
        self.assertIn("assets/watchlist.js?v=1", detail)
        self.assertIn("watchlist.html", all_stocks)
        self.assertNotIn('value="GC"', all_stocks)

    def test_manual_watchlist_is_known_stock_exception(self):
        rules = self.text("AGENTS.md")
        learn = self.text("learn.html")
        self.assertIn("手動ウォッチリストも個別確認と同じ例外", rules)
        self.assertIn("手動登録した「気になる株」", learn)
        self.assertIn("全市場抽出・順位付けしてはならない", rules)

    def test_premium_research_is_explained_and_versioned(self):
        premium = self.text("premium-supply-beta.html")
        builder = self.text("scripts/build_premium_lab.py")
        rules = self.text("AGENTS.md")
        research = self.text("scripts/premium_research.py")
        self.assertIn("観察優先度の検証室", premium)
        self.assertIn("ENGINE_VERSION", builder)
        self.assertIn("5営業日後", rules)
        self.assertIn("20営業日後", rules)
        self.assertIn("自動変更しない", rules)
        self.assertIn("OUTCOMES_ROOT", research)
        self.assertIn("last_observed_before_target", research)


if __name__ == "__main__":
    unittest.main()
