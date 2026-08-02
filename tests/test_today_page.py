from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TodayKabutanePageTests(unittest.TestCase):
    def test_page_loads_event_assets_and_has_accessible_sections(self) -> None:
        html = (ROOT / "today.html").read_text(encoding="utf-8")
        self.assertIn('data-page="today"', html)
        self.assertIn('id="eventFilters"', html)
        self.assertIn('id="eventList"', html)
        self.assertIn('assets/today-kabutane.css', html)
        self.assertIn('assets/today-kabutane.js', html)
        self.assertIn('正式NEW / OUT', html)
        self.assertIn('暫定GC / DC', html)

    def test_script_fetches_snapshot_and_events_and_links_to_detail(self) -> None:
        script = (ROOT / "assets/today-kabutane.js").read_text(encoding="utf-8")
        self.assertIn('fetchJson("data/daily-events.json")', script)
        self.assertIn('fetchJson("data/daily-snapshot.json")', script)
        self.assertIn('detail.html?code=', script)
        self.assertIn('baseline_no_previous', script)
        self.assertIn('Snapshotとイベントの更新日が一致していません', script)

    def test_script_keeps_official_and_provisional_labels_distinct(self) -> None:
        script = (ROOT / "assets/today-kabutane.js").read_text(encoding="utf-8")
        self.assertIn('return "月足確定"', script)
        self.assertIn('return "月末未確定"', script)
        self.assertIn('OFFICIAL_NEW', script)
        self.assertIn('PROVISIONAL_GC', script)


if __name__ == "__main__":
    unittest.main()
