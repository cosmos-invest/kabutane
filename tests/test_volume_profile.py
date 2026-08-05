from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class VolumeProfileIntegrationTests(unittest.TestCase):
    def test_detail_page_integrates_profile_into_price_chart(self) -> None:
        html = (ROOT / "detail.html").read_text(encoding="utf-8")
        for marker in (
            'id="volumeProfilePanel"',
            'id="priceChart"',
            'id="volumeProfileToggle"',
            'id="volumeProfileBinDetail"',
            'data-volume-profile-period="6m"',
            'data-volume-profile-period="1y"',
            'data-volume-profile-period="3y"',
            "推定POC",
            "70%バリューエリア",
            "実際に重なる値幅の割合",
            "assets/detail-volume-profile.css?v=2",
            "assets/detail-volume-profile.js?v=2",
        ):
            self.assertIn(marker, html)
        self.assertNotIn('data-volume-profile-period="all"', html)
        self.assertNotIn('id="volumeProfileChart"', html)

    def test_script_uses_overlap_weighting_and_missing_value_guard(self) -> None:
        script = (ROOT / "assets" / "detail-volume-profile.js").read_text(encoding="utf-8")
        for marker in (
            "BIN_COUNT = 28",
            "VALUE_AREA_RATIO = 0.7",
            '"6m": { months: 6',
            '"3y": { months: 36',
            'value === null || value === undefined || value === ""',
            "const overlap = Math.max(0, Math.min(high, bin.high) - Math.max(low, bin.low))",
            "volume * (overlap / range)",
            "if (high === low)",
            "requestGeneration",
            "dataPromise",
            "kabutaneVolumeProfile",
            "desiredDesktopPadding",
            "width <= 760",
            "0.28",
            "volumeProfileBinDetail",
            "data/charts/",
            "data/daily/",
            "Chart?.defaults?.layout?.padding",
            "isPriceChart(chart)",
        ):
            self.assertIn(marker, script)
        self.assertNotIn('period === "all"', script)
        self.assertNotIn("allocation = volume / (last - first + 1)", script)
        self.assertNotIn("chart.options.layout", script)
        for forbidden in ("apiKey", "subscription", "J-Quants", "paid_api"):
            self.assertNotIn(forbidden, script)

    def test_styles_cover_desktop_and_mobile_overlay(self) -> None:
        css = (ROOT / "assets" / "detail-volume-profile.css").read_text(encoding="utf-8")
        self.assertEqual(css.count("{"), css.count("}"))
        self.assertIn("@media(max-width:760px)", css)
        self.assertIn("volume-profile-legend", css)
        self.assertIn("volume-profile-bin-detail", css)
        self.assertIn("price-chart-box::after", css)


if __name__ == "__main__":
    unittest.main()
