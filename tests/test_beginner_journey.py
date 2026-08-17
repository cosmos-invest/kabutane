import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class BeginnerJourneyTests(unittest.TestCase):
    def test_home_has_route_roles_and_hidden_advanced_entries(self):
        html = read("index.html")
        self.assertIn("迷ったら、4つの問いを順番に", html)
        for marker in ("値動きはどう？", "会社の体力は？", "需給は重くない？", "大口はなぜ動いた？"):
            self.assertIn(marker, html)
        self.assertIn('class="site-more-nav"', html)
        self.assertIn('class="advanced-entry"', html)
        self.assertIn("assets/beginner-journey.css?v=1", html)

    def test_detail_follows_four_stage_order(self):
        html = read("detail.html")
        positions = [html.index(f'id="{marker}"') for marker in ("priceChart", "fundamentalsPanel", "marginBalancePanel", "detailLargeHoldingsPanel")]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("GCは上昇の予言ではなく", html)
        self.assertIn("機関投資家の空売り残高とは別", html)
        self.assertIn('class="panel advanced-panel"', html)

    def test_large_holdings_keeps_detail_optional(self):
        html = read("large-holdings.html")
        script = read("assets/large-holdings.js")
        self.assertIn("この画面だけで、売買を決めない", html)
        self.assertIn("機関投資家の空売り残高", html)
        self.assertIn("limit = 20", script)
        self.assertIn("保有目的の記載を読む", script)
        self.assertIn("訂正・その他", script)

    def test_learning_and_howto_repeat_same_route(self):
        learn = read("learn.html")
        howto = read("howto.html")
        self.assertIn("1社を、4つの問いで見る", learn)
        self.assertIn("信用売り残と機関空売りは別", learn)
        self.assertIn("具体例：大口の増加があっても、すぐ買わない", learn)
        self.assertIn("4つの問いを上から読む", howto)
        for marker in ("① 値動きはどう？", "② 会社の体力は？", "③ 需給は重くない？", "④ 大口はなぜ動いた？"):
            self.assertIn(marker, howto)

    def test_core_pages_share_journey_styles(self):
        for page in ("index.html", "detail.html", "large-holdings.html", "learn.html", "howto.html", "all-stocks.html", "watchlist.html"):
            self.assertIn("assets/beginner-journey.css?v=1", read(page), page)

    def test_pwa_promotes_beginner_route(self):
        sw = read("sw.js")
        manifest = json.loads(read("manifest.webmanifest"))
        self.assertIn('kabutane-pwa-v30', sw)
        self.assertIn("./assets/beginner-journey.css?v=1", sw)
        shortcuts = {item["name"]: item["url"] for item in manifest["shortcuts"]}
        self.assertEqual(shortcuts["はじめての使い方"], "./howto.html")
        self.assertEqual(shortcuts["気になる株"], "./watchlist.html")
        self.assertNotIn("大口保有を見る", shortcuts)

    def test_premium_discovery_boundary_is_preserved(self):
        rules = read("AGENTS.md")
        all_stocks = read("all-stocks.html")
        detail = read("detail.html")
        self.assertIn("暫定GCの「発見」はプレミアム専用", rules)
        self.assertNotIn('value="GC"', all_stocks)
        self.assertIn("暫定GC / 暫定DC", detail)

    def test_premium_begins_with_a_three_candidate_first_step(self):
        html = read("premium-supply-beta.html")
        script = read("assets/premium-supply-beta.js")
        self.assertLess(html.index('id="premiumFirstTitle"'), html.index("全対象銘柄レーダー"))
        self.assertIn("今日は、3社だけ見れば大丈夫", html)
        self.assertIn('id="premiumStarterCards"', html)
        self.assertIn("3社を見る", html)
        self.assertIn("理由を読む", html)
        self.assertIn("1社を確かめる", html)
        self.assertIn("assets/premium-first-step.css?v=1", html)
        self.assertIn(".slice(0, 3)", script)
        self.assertIn("今すぐ買う理由にはしません", script)
        self.assertIn("renderStarterCards();", script)
        self.assertIn('kabutane_premium_first_step_v1', script)
        self.assertIn('kabutane_premium_observation_history_v1', script)
        self.assertIn('id="premiumPreviousReview"', html)
        self.assertIn('data-starter-reason-for', script)
        self.assertIn('data-review-status', script)
        self.assertIn('OBSERVATION_HISTORY_LIMIT = 30', script)
        self.assertIn("記録はこのブラウザだけに残ります", script)

    def test_learning_explains_non_coercive_observation_habit(self):
        learn = read("learn.html")
        self.assertIn("まだ成り立つ・変わった・判断保留", learn)
        self.assertIn("連続日数を競わせたり", learn)
        self.assertIn("買わずに観察を続けることも前進", learn)


if __name__ == "__main__":
    unittest.main()
