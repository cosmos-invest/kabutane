import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LargeHoldingsUiTests(unittest.TestCase):
    def text(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_public_page_has_source_and_non_buy_disclaimer(self):
        html = self.text("large-holdings.html")
        self.assertIn("EDINET（金融庁）", html)
        self.assertIn("増加＝買い", html)
        self.assertIn("売買推奨ではありません", html)
        self.assertNotIn("TDNET", html.upper())

    def test_public_renderer_escapes_text_and_validates_source_id(self):
        script = self.text("assets/large-holdings.js")
        self.assertIn("escapeHtml", script)
        self.assertIn("/^S[0-9A-Z]{6,39}$/", script)
        self.assertIn("encodeURIComponent(item.security_code", script)

    def test_detail_watchlist_and_premium_are_connected(self):
        self.assertIn("detail-large-holdings.js", self.text("detail.html"))
        self.assertIn("loadLargeHoldings", self.text("assets/watchlist-page.js"))
        self.assertIn("large_holding", self.text("scripts/build_premium_lab.py"))
        self.assertIn("観察優先度へ加点しません", self.text("scripts/build_premium_lab.py"))

    def test_generated_data_has_stable_contract(self):
        payload = json.loads(self.text("data/large-holdings/latest.json"))
        self.assertEqual(payload["kind"], "kabutane_edinet_large_holdings")
        self.assertTrue(payload["ready"])
        self.assertIsInstance(payload["records"], list)
        self.assertGreater(len(payload["records"]), 1000)
        self.assertIn("facets", payload)

    def test_no_edinet_github_actions_schedule_was_added(self):
        workflows = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / ".github/workflows").glob("*.yml"))
        self.assertNotIn("update_edinet_large_holdings", workflows)
        self.assertNotIn("EDINET_API_KEY", workflows)

    def test_termux_script_does_not_publish_or_persist_key(self):
        script = self.text("termux-edinet.sh")
        self.assertIsNone(re.search(r"^\s*git\s+(?:pull|commit|push)\b", script, re.MULTILINE))
        self.assertNotIn(".env", script)
        self.assertIn("read -r -s EDINET_API_KEY", script)


if __name__ == "__main__":
    unittest.main()
