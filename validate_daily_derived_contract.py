from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

SNAPSHOT_SCHEMA = "kabutane_daily_snapshot_v1"
EVENT_SCHEMA = "kabutane_daily_events_v1"
SIGNAL_VERSION = "tv_wilder_rsi14_sma5_v1"
EVENT_TYPES = {
    "OFFICIAL_NEW", "OFFICIAL_OUT", "ACTIVE_ADDED", "ACTIVE_REMOVED",
    "PROVISIONAL_GC", "PROVISIONAL_DC", "PROVISIONAL_RECOVERY", "RSI_NEAR_CROSS",
    "TOP10_ENTRY", "RANK_MOVE", "PRICE_MOVE", "RETURN_MILESTONE",
}


class ContractError(ValueError):
    pass


def read_json(path: Path) -> Any:
    if not path.exists():
        raise ContractError(f"missing required file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid JSON: {path}: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def require_date(value: Any, label: str, allow_none: bool = False) -> str | None:
    if value is None and allow_none:
        return None
    require(isinstance(value, str) and len(value) == 10, f"{label} must be YYYY-MM-DD")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ContractError(f"{label} must be a real YYYY-MM-DD date") from exc
    return value


def require_timestamp(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value), f"{label} must be an ISO timestamp")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"{label} must be an ISO timestamp") from exc
    return value


def check_finite(value: Any, label: str) -> None:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, (int, float)):
        require(math.isfinite(float(value)), f"{label} contains non-finite number")
        return
    if isinstance(value, dict):
        for key, child in value.items():
            check_finite(child, f"{label}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            check_finite(child, f"{label}[{index}]")


def validate_snapshot(snapshot: Any) -> dict[str, Any]:
    require(isinstance(snapshot, dict), "snapshot must be an object")
    check_finite(snapshot, "snapshot")
    require(snapshot.get("schema_version") == SNAPSHOT_SCHEMA, "snapshot schema_version mismatch")
    require(snapshot.get("signal_version") == SIGNAL_VERSION, "snapshot signal_version mismatch")
    require(snapshot.get("cost_policy") == "paid_api_disabled", "snapshot paid API policy changed")
    require_date(snapshot.get("snapshot_date"), "snapshot.snapshot_date")
    require_date(snapshot.get("price_date"), "snapshot.price_date", allow_none=True)
    require_timestamp(snapshot.get("generated_at"), "snapshot.generated_at")
    require(snapshot.get("source_state") in {"daily_overlay", "monthly_baseline"}, "snapshot.source_state invalid")
    records = snapshot.get("records")
    recent_out = snapshot.get("recent_out")
    summary = snapshot.get("summary")
    require(isinstance(records, list), "snapshot.records must be an array")
    require(isinstance(recent_out, list), "snapshot.recent_out must be an array")
    require(isinstance(summary, dict), "snapshot.summary must be an object")
    codes = [str(row.get("code")) for row in records if isinstance(row, dict) and row.get("code")]
    require(len(codes) == len(records), "snapshot records require code")
    require(len(set(codes)) == len(codes), "snapshot records contain duplicate code")
    require(summary.get("active_count") == len(records), "snapshot active_count mismatch")
    for row in records:
        require(row.get("status") in {"NEW", "CONTINUE"}, "snapshot record status invalid")
        provisional = row.get("provisional")
        if provisional is not None:
            require(isinstance(provisional, dict), "snapshot provisional must be object")
            require(provisional.get("is_provisional") is True, "snapshot provisional flag missing")
            require(provisional.get("status") in {"GC", "DC", "CONTINUE", "OUT"}, "snapshot provisional status invalid")
    return snapshot


def validate_events(events: Any, snapshot: dict[str, Any]) -> dict[str, Any]:
    require(isinstance(events, dict), "events must be an object")
    check_finite(events, "events")
    require(events.get("schema_version") == EVENT_SCHEMA, "events schema_version mismatch")
    require(events.get("signal_version") == SIGNAL_VERSION, "events signal_version mismatch")
    require(events.get("cost_policy") == "paid_api_disabled", "events paid API policy changed")
    require_timestamp(events.get("generated_at"), "events.generated_at")
    event_date = require_date(events.get("snapshot_date"), "events.snapshot_date")
    require(event_date == snapshot.get("snapshot_date"), "events/snapshot date mismatch")
    previous = require_date(events.get("previous_snapshot_date"), "events.previous_snapshot_date", allow_none=True)
    state = events.get("comparison_state")
    require(state in {"compared", "baseline_no_previous"}, "events comparison_state invalid")
    require((state == "baseline_no_previous") == (previous is None), "events previous-date/state mismatch")
    rows = events.get("events")
    summary = events.get("summary")
    rules = events.get("rules")
    require(isinstance(rows, list), "events.events must be an array")
    require(isinstance(summary, dict), "events.summary must be an object")
    require(isinstance(rules, dict), "events.rules must be an object")
    require(summary.get("event_count") == len(rows), "events event_count mismatch")
    ids: set[str] = set()
    for index, row in enumerate(rows):
        require(isinstance(row, dict), f"events[{index}] must be object")
        identifier = row.get("event_id")
        require(isinstance(identifier, str) and bool(identifier), f"events[{index}].event_id missing")
        require(identifier not in ids, f"duplicate event_id: {identifier}")
        ids.add(identifier)
        require(row.get("type") in EVENT_TYPES, f"events[{index}].type invalid")
        require(row.get("category") in {"signal", "ranking", "price", "performance"}, f"events[{index}].category invalid")
        require(row.get("severity") in {"high", "medium", "low"}, f"events[{index}].severity invalid")
        require(isinstance(row.get("priority"), int) and not isinstance(row.get("priority"), bool), f"events[{index}].priority invalid")
        require(str(row.get("code") or "").strip() != "", f"events[{index}].code missing")
    require(summary.get("high_count") == sum(row.get("severity") == "high" for row in rows), "events high_count mismatch")
    require(summary.get("medium_count") == sum(row.get("severity") == "medium" for row in rows), "events medium_count mismatch")
    require(summary.get("low_count") == sum(row.get("severity") == "low" for row in rows), "events low_count mismatch")
    return events


def validate_repository(root: Path) -> list[str]:
    snapshot = validate_snapshot(read_json(root / "data" / "daily-snapshot.json"))
    events = validate_events(read_json(root / "data" / "daily-events.json"), snapshot)
    history_snapshot = root / "history" / "daily" / f"{snapshot['snapshot_date']}.json"
    history_events = root / "history" / "daily-events" / f"{events['snapshot_date']}.json"
    require(history_snapshot.exists(), f"missing snapshot history: {history_snapshot}")
    require(history_events.exists(), f"missing event history: {history_events}")
    return [
        "data/daily-snapshot.json",
        "data/daily-events.json",
        str(history_snapshot.relative_to(root)),
        str(history_events.relative_to(root)),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate compact daily snapshot and event feed contracts")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        checked = validate_repository(args.root.resolve())
    except ContractError as exc:
        print(f"DERIVED DATA CONTRACT FAILED: {exc}")
        return 1
    print("DERIVED DATA CONTRACT OK")
    for path in checked:
        print(f"  - {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
