from __future__ import annotations

import json
import math
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from validate_data_contract import ContractError, SIGNAL_VERSION, validate_repository


SIGNAL_DEFINITION = {
    "version": SIGNAL_VERSION,
    "source": "completed_month_close",
}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def record(code: str = "1234", status: str = "NEW") -> dict:
    return {
        "code": code,
        "ticker": f"{code}.T",
        "name": f"銘柄{code}",
        "signal_month": "2026-07",
        "status": status,
        "monthly_rsi14": 62.3,
        "monthly_rsi_ma5": 58.1,
        "monthly_rsi_spread": 4.2,
    }


def canonical_metadata() -> dict:
    return {
        "signal_version": SIGNAL_VERSION,
        "signal_name": "月足RSI14 × RSI14の5か月SMA",
        "signal_definition": deepcopy(SIGNAL_DEFINITION),
    }


class DataContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        data = self.root / "data"
        active = [record()]
        latest = {
            "generated_at": "2026-08-02T10:32:21+00:00",
            "signal_month": "2026-07",
            "summary": {
                "active_count": 1,
                "new_count": 1,
                "out_count": 0,
                "up_count": 1,
                "down_count": 0,
                "cosmos_focus_count": 0,
                "error_count": 0,
            },
            "records": active,
            "out_records": [],
            "errors": [],
            **canonical_metadata(),
        }
        analysis = {
            "generated_at": latest["generated_at"],
            "latest_month": "2026-07",
            "available_start_month": "2021-08",
            "available_end_month": "2026-07",
            "profiles": {},
            "episodes": [],
            **canonical_metadata(),
        }
        ranking = {
            "generated_at": "2026-08-02T10:35:00+00:00",
            "price_date": None,
            "comparison_price_date": None,
            "signal_month": "2026-07",
            "count": 1,
            "rows": [{"code": "1234", "rank": 1}],
            "comparison_rows": [],
        }
        daily_change = {
            "generated_at": ranking["generated_at"],
            "price_date": None,
            "comparison_price_date": None,
            "has_previous_day": False,
            "summary": {
                "ranking_count": 1,
                "rank_up_count": 0,
                "rank_down_count": 0,
                "unchanged_count": 0,
                "new_entry_count": 0,
            },
            "rank_up": [],
            "price_up": [],
            "new_entries": [],
        }
        monthly_report = {
            "generated_at": "2026-08-02T10:35:00+00:00",
            "signal_month": "2026-07",
            "previous_month": "2026-06",
            "summary": {},
            "new_records": active,
            "out_records": [],
            "near_cross_records": [],
            "by_market": [],
            "by_sector": [],
            "notes": [],
        }
        month_snapshot = {
            "month": "2026-07",
            "summary": {"active_count": 1, "new_count": 1, "out_count": 0},
            "records": active,
            "out_records": [],
            **canonical_metadata(),
        }
        write_json(data / "latest.json", latest)
        write_json(data / "analysis.json", analysis)
        write_json(data / "ranking.json", ranking)
        write_json(data / "daily-change.json", daily_change)
        write_json(data / "monthly-report.json", monthly_report)
        write_json(data / "months" / "2026-07.json", month_snapshot)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def load(self, relative: str):
        return json.loads((self.root / relative).read_text(encoding="utf-8"))

    def save(self, relative: str, payload) -> None:
        write_json(self.root / relative, payload)

    def test_valid_contract_without_daily_overlay(self) -> None:
        checked = validate_repository(self.root)
        self.assertIn("data/latest.json", checked)
        self.assertFalse((self.root / "data" / "daily").exists())

    def test_rejects_wrong_signal_version(self) -> None:
        latest = self.load("data/latest.json")
        latest["signal_version"] = "legacy_signal"
        self.save("data/latest.json", latest)
        with self.assertRaisesRegex(ContractError, "signal_version"):
            validate_repository(self.root)

    def test_rejects_duplicate_codes(self) -> None:
        latest = self.load("data/latest.json")
        latest["records"].append(deepcopy(latest["records"][0]))
        latest["summary"]["active_count"] = 2
        latest["summary"]["new_count"] = 2
        self.save("data/latest.json", latest)
        with self.assertRaisesRegex(ContractError, "duplicate code"):
            validate_repository(self.root)

    def test_rejects_invalid_month(self) -> None:
        latest = self.load("data/latest.json")
        latest["signal_month"] = "2026-13"
        self.save("data/latest.json", latest)
        with self.assertRaisesRegex(ContractError, "YYYY-MM"):
            validate_repository(self.root)

    def test_rejects_nonfinite_numbers(self) -> None:
        latest = self.load("data/latest.json")
        latest["records"][0]["current_price"] = math.inf
        self.save("data/latest.json", latest)
        with self.assertRaisesRegex(ContractError, "non-finite"):
            validate_repository(self.root)

    def test_rejects_cross_file_month_mismatch(self) -> None:
        ranking = self.load("data/ranking.json")
        ranking["signal_month"] = "2026-06"
        self.save("data/ranking.json", ranking)
        with self.assertRaisesRegex(ContractError, "ranking.signal_month"):
            validate_repository(self.root)

    def test_daily_dates_must_match_when_overlays_exist(self) -> None:
        latest = self.load("data/latest.json")
        latest["daily_generated_at"] = "2026-08-03T12:00:00+00:00"
        latest["daily_price_date"] = "2026-08-03"
        self.save("data/latest.json", latest)

        ranking = self.load("data/ranking.json")
        ranking["price_date"] = "2026-08-03"
        self.save("data/ranking.json", ranking)

        status = {
            "generated_at": "2026-08-03T12:00:00+00:00",
            "price_date": "2026-08-02",
            "target_count": 1,
            "downloaded_count": 1,
            "overlay_updated_count": 1,
            "error_count": 0,
            "errors": [],
            "cost_policy": "paid_api_disabled",
        }
        self.save("data/daily-update-status.json", status)
        self.save("data/daily/1234.json", {"code": "1234"})
        with self.assertRaisesRegex(ContractError, "date mismatch"):
            validate_repository(self.root)

    def test_stale_daily_status_is_allowed_after_monthly_overlay_reset(self) -> None:
        status = {
            "generated_at": "2026-07-31T12:00:00+00:00",
            "price_date": "2026-07-31",
            "target_count": 1,
            "downloaded_count": 1,
            "overlay_updated_count": 1,
            "error_count": 0,
            "errors": [],
            "cost_policy": "paid_api_disabled",
        }
        self.save("data/daily-update-status.json", status)
        checked = validate_repository(self.root)
        self.assertIn("data/daily-update-status.json", checked)


if __name__ == "__main__":
    unittest.main()
