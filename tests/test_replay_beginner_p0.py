from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ReplayBeginnerP0Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.guided = (ROOT / "assets" / "replay-guided-mode.js").read_text(encoding="utf-8")
        cls.fixes = (ROOT / "assets" / "replay-guided-fixes.js").read_text(encoding="utf-8")
        cls.practice = (ROOT / "assets" / "replay-practice-ux-v2.js").read_text(encoding="utf-8")
        cls.style = (ROOT / "assets" / "replay-guided-mode.css").read_text(encoding="utf-8")
        cls.learn = (ROOT / "learn.html").read_text(encoding="utf-8")
        cls.howto = (ROOT / "howto.html").read_text(encoding="utf-8")

    def test_stop_flow_is_basis_chart_amount(self) -> None:
        for marker in (
            "① 根拠を1つ選ぶ",
            "② チャートで置く",
            "③ 金額を確認",
            'data-guided-stop-basis="${key}"',
            'basisButton("recent_low"',
            'basisButton("sma25"',
            'basisButton("thesis_break"',
            "チャートで損切り価格を置く",
            "根拠と金額を確認して進む",
        ):
            self.assertIn(marker, self.guided)
        self.assertNotIn('id="guidedStopInput" type="number"', self.guided)

    def test_stop_chart_shows_only_decision_context(self) -> None:
        self.assertIn('document.body.dataset.guidedStep = guide.step', self.guided)
        self.assertIn('node.classList.toggle("near", Math.abs(stepIndex - index) <= 1)', self.guided)
        self.assertIn('"SMA25", "エントリー", "損切り", "直近安値"', self.guided)
        self.assertIn('lineDataset("直近安値"', self.fixes)
        for marker in (
            '[data-guided-step="stop"] .replay-decision-oscillator-v6',
            '[data-guided-step="stop"] .replay-decision-monthly-v6',
            '[data-guided-step="stop"] #replayVolumeProfileV6',
            '[data-guided-analysis="false"] .guided-monthly-rsi',
            'いま見るもの：価格・直近安値・SMA25',
        ):
            self.assertIn(marker, self.style)

    def test_guided_trade_reason_is_one_required_choice(self) -> None:
        self.assertIn("入る理由を1つ選ぶ", self.practice)
        self.assertIn("売る理由を1つ選ぶ", self.practice)
        self.assertIn("自由記述は任意", self.practice)
        self.assertIn("if (!decision.thesis)", self.practice)
        self.assertIn("confirm-manual-exit", self.practice)
        self.assertIn("confirm-add-entry", self.practice)
        self.assertIn("renderHistoryWithDecisionReason", self.practice)
        self.assertIn("cells[2].textContent = decisionLabel(trade)", self.practice)
        self.assertNotIn("if (!decision.thesis || !decision.eventContext || !decision.planStatus)", self.practice)

    def test_learning_pages_match_the_new_beginner_flow(self) -> None:
        for marker in ("根拠 → チャート → 金額", "理由1つ＋任意メモ", "価格・直近安値・SMA25"):
            self.assertIn(marker, self.learn)
        for marker in ("直近安値・SMA25・自分の支持線", "1株の損失候補と練習の損失上限"):
            self.assertIn(marker, self.howto)


if __name__ == "__main__":
    unittest.main()
