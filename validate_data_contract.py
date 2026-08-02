from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

SIGNAL_VERSION = "tv_wilder_rsi14_sma5_v1"
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$")


class ContractError(ValueError):
    pass


def read_json(path: Path, required: bool = True) -> Any:
    if not path.exists():
        if required:
            raise ContractError(f"missing required file: {path}")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid JSON: {path}: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def require_dict(value: Any, label: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{label} must be an object")
    return value


def require_list(value: Any, label: str) -> list[Any]:
    require(isinstance(value, list), f"{label} must be an array")
    return value


def require_nonempty_string(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value.strip()), f"{label} must be a non-empty string")
    return value.strip()


def require_month(value: Any, label: str) -> str:
    text = require_nonempty_string(value, label)
    require(bool(MONTH_RE.fullmatch(text)), f"{label} must be YYYY-MM: {text!r}")
    return text


def require_date(value: Any, label: str, allow_none: bool = False) -> str | None:
    if value is None and allow_none:
        return None
    text = require_nonempty_string(value, label)
    require(bool(DATE_RE.fullmatch(text)), f"{label} must be YYYY-MM-DD: {text!r}")
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise ContractError(f"{label} is not a real calendar date: {text!r}") from exc
    return text


def require_timestamp(value: Any, label: str) -> str:
    text = require_nonempty_string(value, label)
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"{label} must be an ISO-8601 timestamp: {text!r}") from exc
    return text


def check_finite_numbers(value: Any, label: str = "root") -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        require(math.isfinite(float(value)), f"{label} contains non-finite number: {value!r}")
        return
    if isinstance(value, dict):
        for key, child in value.items():
            check_finite_numbers(child, f"{label}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            check_finite_numbers(child, f"{label}[{index}]")


def require_unique_codes(rows: Iterable[Any], label: str) -> None:
    seen: set[str] = set()
    for index, raw in enumerate(rows):
        row = require_dict(raw, f"{label}[{index}]")
        code = require_nonempty_string(row.get("code"), f"{label}[{index}].code")
        require(code not in seen, f"{label} has duplicate code: {code}")
        seen.add(code)


def validate_signal_metadata(payload: dict[str, Any], label: str) -> None:
    require(payload.get("signal_version") == SIGNAL_VERSION,
            f"{label}.signal_version must be {SIGNAL_VERSION!r}, got {payload.get('signal_version')!r}")
    definition = require_dict(payload.get("signal_definition"), f"{label}.signal_definition")
    require(definition.get("version") == SIGNAL_VERSION,
            f"{label}.signal_definition.version mismatch")
    require(definition.get("source") == "completed_month_close",
            f"{label}.signal_definition.source must use completed monthly candles")


def validate_latest(payload: Any) -> dict[str, Any]:
    latest = require_dict(payload, "latest")
    check_finite_numbers(latest, "latest")
    require_timestamp(latest.get("generated_at"), "latest.generated_at")
    signal_month = require_month(latest.get("signal_month"), "latest.signal_month")
    validate_signal_metadata(latest, "latest")

    summary = require_dict(latest.get("summary"), "latest.summary")
    records = require_list(latest.get("records"), "latest.records")
    out_records = require_list(latest.get("out_records"), "latest.out_records")
    require_list(latest.get("errors"), "latest.errors")
    require_unique_codes(records, "latest.records")
    require_unique_codes(out_records, "latest.out_records")

    for index, raw in enumerate(records):
        row = require_dict(raw, f"latest.records[{index}]")
        require_nonempty_string(row.get("ticker"), f"latest.records[{index}].ticker")
        require_nonempty_string(row.get("name"), f"latest.records[{index}].name")
        require(row.get("status") in {"NEW", "CONTINUE"},
                f"latest.records[{index}].status must be NEW or CONTINUE")
        require_month(row.get("signal_month"), f"latest.records[{index}].signal_month")
        require(row.get("signal_month") == signal_month,
                f"latest.records[{index}].signal_month must match latest.signal_month")
        for key in ("monthly_rsi14", "monthly_rsi_ma5", "monthly_rsi_spread"):
            require(key in row, f"latest.records[{index}] missing canonical {key}")

    for index, raw in enumerate(out_records):
        row = require_dict(raw, f"latest.out_records[{index}]")
        require_nonempty_string(row.get("ticker"), f"latest.out_records[{index}].ticker")
        require_nonempty_string(row.get("name"), f"latest.out_records[{index}].name")

    count_fields = {
        "active_count": len(records),
        "out_count": len(out_records),
        "new_count": sum(1 for row in records if row.get("status") == "NEW"),
    }
    for key, expected in count_fields.items():
        value = summary.get(key)
        require(isinstance(value, int) and not isinstance(value, bool), f"latest.summary.{key} must be an integer")
        require(value == expected, f"latest.summary.{key}={value} but expected {expected}")

    daily_price_date = latest.get("daily_price_date")
    if daily_price_date is not None:
        require_date(daily_price_date, "latest.daily_price_date")
    daily_generated_at = latest.get("daily_generated_at")
    if daily_generated_at is not None:
        require_timestamp(daily_generated_at, "latest.daily_generated_at")
    return latest


def validate_analysis(payload: Any, signal_month: str) -> dict[str, Any]:
    analysis = require_dict(payload, "analysis")
    check_finite_numbers(analysis, "analysis")
    require_timestamp(analysis.get("generated_at"), "analysis.generated_at")
    validate_signal_metadata(analysis, "analysis")
    latest_month = require_month(analysis.get("latest_month"), "analysis.latest_month")
    require(latest_month == signal_month,
            f"analysis.latest_month={latest_month} must match latest.signal_month={signal_month}")
    start = require_month(analysis.get("available_start_month"), "analysis.available_start_month")
    end = require_month(analysis.get("available_end_month"), "analysis.available_end_month")
    require(start <= end, "analysis available month range is reversed")
    require(end == signal_month, "analysis.available_end_month must match latest.signal_month")
    require_list(analysis.get("episodes"), "analysis.episodes")
    require_dict(analysis.get("profiles"), "analysis.profiles")
    return analysis


def validate_ranking(payload: Any, signal_month: str) -> dict[str, Any]:
    ranking = require_dict(payload, "ranking")
    check_finite_numbers(ranking, "ranking")
    require_timestamp(ranking.get("generated_at"), "ranking.generated_at")
    require_month(ranking.get("signal_month"), "ranking.signal_month")
    require(ranking.get("signal_month") == signal_month,
            "ranking.signal_month must match latest.signal_month")
    rows = require_list(ranking.get("rows"), "ranking.rows")
    require_unique_codes(rows, "ranking.rows")
    require(isinstance(ranking.get("count"), int) and not isinstance(ranking.get("count"), bool),
            "ranking.count must be an integer")
    require(ranking.get("count") == len(rows), "ranking.count must match ranking.rows length")
    require_date(ranking.get("price_date"), "ranking.price_date", allow_none=True)
    require_date(ranking.get("comparison_price_date"), "ranking.comparison_price_date", allow_none=True)
    return ranking


def validate_daily_status(payload: Any) -> dict[str, Any]:
    status = require_dict(payload, "daily-status")
    check_finite_numbers(status, "daily-status")
    require_timestamp(status.get("generated_at"), "daily-status.generated_at")
    require_date(status.get("price_date"), "daily-status.price_date", allow_none=True)
    require(status.get("cost_policy") == "paid_api_disabled",
            "daily-status.cost_policy must remain paid_api_disabled")
    for key in ("target_count", "downloaded_count", "overlay_updated_count", "error_count"):
        require(isinstance(status.get(key), int) and not isinstance(status.get(key), bool),
                f"daily-status.{key} must be an integer")
    require_list(status.get("errors"), "daily-status.errors")
    return status


def validate_daily_change(payload: Any) -> dict[str, Any]:
    change = require_dict(payload, "daily-change")
    check_finite_numbers(change, "daily-change")
    require_timestamp(change.get("generated_at"), "daily-change.generated_at")
    require_date(change.get("price_date"), "daily-change.price_date", allow_none=True)
    require_date(change.get("comparison_price_date"), "daily-change.comparison_price_date", allow_none=True)
    require_dict(change.get("summary"), "daily-change.summary")
    for key in ("rank_up", "price_up", "new_entries"):
        require_list(change.get(key), f"daily-change.{key}")
    return change


def validate_monthly_report(payload: Any, signal_month: str) -> dict[str, Any]:
    report = require_dict(payload, "monthly-report")
    check_finite_numbers(report, "monthly-report")
    require_timestamp(report.get("generated_at"), "monthly-report.generated_at")
    month = require_month(report.get("signal_month"), "monthly-report.signal_month")
    require(month == signal_month, "monthly-report.signal_month must match latest.signal_month")
    require_month(report.get("previous_month"), "monthly-report.previous_month")
    require_dict(report.get("summary"), "monthly-report.summary")
    for key in ("new_records", "out_records", "near_cross_records", "by_market", "by_sector", "notes"):
        require_list(report.get(key), f"monthly-report.{key}")
    return report


def validate_month_snapshot(path: Path, signal_month: str) -> None:
    snapshot = require_dict(read_json(path), f"month-snapshot:{path.name}")
    check_finite_numbers(snapshot, f"month-snapshot:{path.name}")
    month = require_month(snapshot.get("month"), f"month-snapshot:{path.name}.month")
    require(month == signal_month, f"month snapshot {path.name} does not match latest.signal_month")
    records = require_list(snapshot.get("records"), f"month-snapshot:{path.name}.records")
    out_records = require_list(snapshot.get("out_records"), f"month-snapshot:{path.name}.out_records")
    require_unique_codes(records, f"month-snapshot:{path.name}.records")
    require_unique_codes(out_records, f"month-snapshot:{path.name}.out_records")
    validate_signal_metadata(snapshot, f"month-snapshot:{path.name}")


def validate_repository(root: Path) -> list[str]:
    data = root / "data"
    latest = validate_latest(read_json(data / "latest.json"))
    signal_month = latest["signal_month"]
    validate_analysis(read_json(data / "analysis.json"), signal_month)
    ranking = validate_ranking(read_json(data / "ranking.json"), signal_month)
    validate_daily_change(read_json(data / "daily-change.json"),)
    validate_monthly_report(read_json(data / "monthly-report.json"), signal_month)
    validate_month_snapshot(data / "months" / f"{signal_month}.json", signal_month)

    status_payload = read_json(data / "daily-update-status.json", required=False)
    if status_payload is not None:
        status = validate_daily_status(status_payload)
        status_date = status.get("price_date")
        ranking_date = ranking.get("price_date")
        latest_date = latest.get("daily_price_date")
        # A monthly rebuild deliberately removes data/daily. Until the next daily
        # job, stale daily status/ranking may remain, so cross-file date equality
        # is enforced only when current per-code overlays actually exist.
        overlay_dir = data / "daily"
        has_current_overlays = overlay_dir.exists() and any(overlay_dir.glob("*.json"))
        if has_current_overlays:
            require(status_date == ranking_date,
                    f"daily status/ranking date mismatch: {status_date!r} != {ranking_date!r}")
            require(latest_date in (None, status_date),
                    f"latest/daily status date mismatch: {latest_date!r} != {status_date!r}")

    return [
        "data/latest.json",
        "data/analysis.json",
        "data/ranking.json",
        "data/daily-change.json",
        "data/monthly-report.json",
        f"data/months/{signal_month}.json",
        *( ["data/daily-update-status.json"] if status_payload is not None else [] ),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Kabutane generated-data contracts")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        checked = validate_repository(root)
    except ContractError as exc:
        print(f"DATA CONTRACT FAILED: {exc}")
        return 1
    print("DATA CONTRACT OK")
    for path in checked:
        print(f"  - {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
