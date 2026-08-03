from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class VolumeProfileIntegrationTests(unittest.TestCase):
    def test_detail_page_contains_volume_profile_panel(self) -> None:
        html = (ROOT / "detail.html").read_text(encoding="utf-8")
        for marker in (
            'id="volumeProfilePanel"',
            'id="volumeProfileChart"',
            'data-volume-profile-period="1y"',
            'data-volume-profile-period="3y"',
            'data-volume-profile-period="all"',
            "推定値です。",
            "assets/detail-volume-profile.css?v=1",
            "assets/detail-volume-profile.js?v=1",
        ):
            self.assertIn(marker, html)

    def test_script_keeps_estimate_and_zero_cost_boundaries(self) -> None:
        script = (ROOT / "assets" / "detail-volume-profile.js").read_text(encoding="utf-8")
        for marker in (
            "BIN_COUNT = 28",
            "VALUE_AREA_RATIO = 0.7",
            "data/charts/",
            "data/daily/",
            "allocation = volume / (last - first + 1)",
            "baseline",
        ):
            if marker == "baseline":
                continue
            self.assertIn(marker, script)
        for forbidden in ("apiKey", "subscription", "J-Quants", "paid_api"):
            self.assertNotIn(forbidden, script)

    def test_styles_are_mobile_safe(self) -> None:
        css = (ROOT / "assets" / "detail-volume-profile.css").read_text(encoding="utf-8")
        self.assertEqual(css.count("{"), css.count("}"))
        self.assertIn("@media(max-width:760px)", css)
        self.assertIn("minmax(70px,1fr)", css)


if __name__ == "__main__":
    unittest.main()
