from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReplayDecisionV6Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = (ROOT / "assets/replay-decision-flow-v6.js").read_text(encoding="utf-8")
        cls.controls = (ROOT / "assets/replay-decision-controls-v6.js").read_text(encoding="utf-8")
        cls.profile_guard = (ROOT / "assets/replay-volume-profile-guard-v6.js").read_text(encoding="utf-8")
        cls.style = (ROOT / "assets/replay-decision-flow-v6.css").read_text(encoding="utf-8")
        cls.loader = (ROOT / "assets/pwa-register.js").read_text(encoding="utf-8")
        cls.learn = (ROOT / "learn.html").read_text(encoding="utf-8")
        cls.detail = (ROOT / "detail.html").read_text(encoding="utf-8")

    def test_loader_enables_v6_after_existing_practice_scripts(self):
        self.assertIn('"assets/replay-decision-flow-v6.js"', self.loader)
        self.assertIn('"assets/replay-volume-profile-guard-v6.js"', self.loader)
        self.assertIn('"assets/replay-decision-controls-v6.js"', self.loader)
        self.assertIn('loadStyle("assets/replay-decision-flow-v6.css")', self.loader)
        self.assertLess(
            self.loader.index('"assets/replay-practice-desktop-free-v5.js"'),
            self.loader.index('"assets/replay-decision-flow-v6.js"'),
        )
        self.assertLess(
            self.loader.index('"assets/replay-decision-flow-v6.js"'),
            self.loader.index('"assets/replay-volume-profile-guard-v6.js"'),
        )
        self.assertLess(
            self.loader.index('"assets/replay-volume-profile-guard-v6.js"'),
            self.loader.index('"assets/replay-decision-controls-v6.js"'),
        )

    def test_volume_profile_never_uses_future_rows(self):
        self.assertIn('String(item.date) <= currentDate', self.script)
        self.assertIn('filterPeriod(rows, currentDate, profileState.period)', self.script)
        self.assertIn('volume * (overlap / range)', self.script)
        self.assertIn('VALUE_AREA_RATIO = 0.7', self.script)

    def test_profile_inspection_does_not_fall_through_to_order_editing(self):
        self.assertIn('event.target?.id !== "replayChart"', self.profile_guard)
        self.assertIn('s.chartView.moved = true', self.profile_guard)
        self.assertIn('event.stopImmediatePropagation()', self.profile_guard)
        self.assertIn('showProfileBin(event, chart)', self.profile_guard)

    def test_decision_surface_order_is_oscillator_chart_monthly(self):
        expected = 'surface.append(oscillatorShell, mainShell, monthlyShell)'
        self.assertIn(expected, self.script)
        self.assertIn('oscillatorShell.appendChild(oscillatorBox)', self.script)
        self.assertIn('mainShell.appendChild(chartBox)', self.script)
        self.assertIn('monthlyShell.appendChild(monthlyBox)', self.script)

    def test_mobile_keeps_advance_controls_close_to_chart(self):
        self.assertIn('.replay-decision-dock-v6{position:sticky', self.style)
        self.assertIn('.replay-decision-actions-v6', self.style)
        self.assertIn('bottom:calc(env(safe-area-inset-bottom) + 6px)', self.style)
        self.assertIn('data-decision-action="step-one"', self.controls)
        self.assertIn('data-decision-action="step-five"', self.controls)
        self.assertIn('data-decision-action="choose-entry"', self.controls)
        self.assertIn('data-decision-action="finish"', self.controls)
        self.assertIn('data-guided-action="step-one"', self.controls)

    def test_chart_settings_auto_collapse_and_gc_dc_dots_exist(self):
        self.assertIn('details.open = false', self.script)
        self.assertIn('drawSignalDots(chart)', self.script)
        self.assertIn('cross.type === "GC"', self.script)
        self.assertIn('rgba(244,63,94,.95)', self.script)

    def test_learning_links_cover_new_terms(self):
        for anchor in ('volume-profile', 'poc', 'value-area', 'margin-balance', 'monthly-rsi', 'decision-flow'):
            self.assertIn(f'id="{anchor}"', self.learn)
        self.assertIn('learn.html#volume-profile', self.detail)
        self.assertIn('learn.html#poc', self.detail)
        self.assertIn('learn.html#value-area', self.detail)
        self.assertIn('learn.html#monthly-rsi', self.detail)


if __name__ == "__main__":
    unittest.main()
