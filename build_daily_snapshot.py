from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
HISTORY_DIR = ROOT / "history" / "daily"
SNAPSHOT_VERSION = "kabutane_daily_snapshot_v1"


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def integer(value: Any) -> int | None:
    number = finite(value)
    return int(number) if number is not None else None


def iso_date(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return text[:10] if len(text) >= 10 else None


def write_json_if_changed(path: Path, payload: Any) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def provisional_by_code(root: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    overlay_dir = root / "data" / "daily"
    if not overlay_dir.exists():
        return result
    for path in sorted(overlay_dir.glob("*.json")):
        payload = read_json(path, {}) or {}
        provisional = payload.get("provisional_signal")
        code = str(payload.get("code") or path.stem).strip()
        if code and isinstance(provisional, dict):
            result[code] = provisional
    return result


def ranking_by_code(ranking: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("code")): row
        for row in ranking.get("rows") or []
        if isinstance(row, dict) and row.get("code")
    }


def compact_record(
    record: dict[str, Any],
    rank: dict[str, Any],
    provisional: dict[str, Any] | None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "code": str(record.get("code") or ""),
        "name": record.get("name"),
        "ticker": record.get("ticker"),
        "market": record.get("market"),
        "sector": record.get("jpx_sector_name") or record.get("sector"),
        "status": record.get("status"),
        "signal_month": record.get("signal_month"),
        "months_active": integer(record.get("months_active")),
        "current_price": finite(record.get("current_price")),
        "daily_change_pct": finite(record.get("daily_change_pct") or rank.get("daily_change_pct")),
        "return_since_gc_pct": finite(record.get("return_since_gc_pct")),
        "rank": integer(record.get("gc_return_rank") or rank.get("rank")),
        "rank_change": integer(record.get("gc_rank_change") or rank.get("rank_change")),
        "monthly_rsi14": finite(record.get("monthly_rsi14")),
        "monthly_rsi_ma5": finite(record.get("monthly_rsi_ma5")),
        "monthly_rsi_spread": finite(record.get("monthly_rsi_spread")),
    }
    if provisional:
        result["provisional"] = {
            "month": provisional.get("month"),
            "price_date": provisional.get("price_date"),
            "status": provisional.get("status"),
            "monthly_rsi14": finite(provisional.get("monthly_rsi14")),
            "monthly_rsi_ma5": finite(provisional.get("monthly_rsi_ma5")),
            "spread": finite(provisional.get("spread")),
            "changed_from_confirmed": bool(provisional.get("changed_from_confirmed")),
            "is_provisional": True,
        }
    return {key: value for key, value in result.items() if value is not None}


def compact_out_record(record: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "code", "ticker", "name", "market", "jpx_sector_name", "sector",
        "signal_month", "exit_month", "exit_price", "return_at_exit_pct",
        "monthly_rsi14", "monthly_rsi_ma5", "monthly_rsi_spread",
    )
    result = {key: record.get(key) for key in fields if record.get(key) is not None}
    result["status"] = "OUT"
    return result


def choose_snapshot_date(latest: dict[str, Any], ranking: dict[str, Any]) -> str:
    for value in (
        latest.get("daily_price_date"),
        ranking.get("price_date"),
        iso_date(latest.get("daily_generated_at")),
        iso_date(latest.get("generated_at")),
    ):
        if value:
            return str(value)
    return datetime.now(timezone.utc).date().isoformat()


def build_snapshot(root: Path) -> dict[str, Any]:
    latest = read_json(root / "data" / "latest.json", {}) or {}
    ranking = read_json(root / "data" / "ranking.json", {}) or {}
    records = [row for row in latest.get("records") or [] if isinstance(row, dict) and row.get("code")]
    out_records = [row for row in latest.get("out_records") or [] if isinstance(row, dict) and row.get("code")]
    if not records:
        raise RuntimeError("data/latest.json にsnapshot対象がありません。")

    ranks = ranking_by_code(ranking)
    provisional = provisional_by_code(root)
    compact = [
        compact_record(row, ranks.get(str(row.get("code")), {}), provisional.get(str(row.get("code"))))
        for row in records
    ]
    compact.sort(key=lambda row: (row.get("rank") is None, row.get("rank") or 10**9, row.get("code") or ""))
    recent_out = [compact_out_record(row) for row in out_records]
    recent_out.sort(key=lambda row: str(row.get("code") or ""))

    summary = latest.get("summary") if isinstance(latest.get("summary"), dict) else {}
    snapshot_date = choose_snapshot_date(latest, ranking)
    has_overlays = (root / "data" / "daily").exists() and any((root / "data" / "daily").glob("*.json"))
    return {
        "schema_version": SNAPSHOT_VERSION,
        "snapshot_date": snapshot_date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_generated_at": latest.get("daily_generated_at") or latest.get("generated_at"),
        "source_state": "daily_overlay" if has_overlays else "monthly_baseline",
        "signal_version": latest.get("signal_version"),
        "signal_month": latest.get("signal_month"),
        "price_date": latest.get("daily_price_date") or ranking.get("price_date"),
        "summary": {
            "active_count": integer(summary.get("active_count")) or len(compact),
            "new_count": integer(summary.get("new_count")) or 0,
            "out_count": integer(summary.get("out_count")) or len(recent_out),
            "ranking_count": integer(ranking.get("count")) or len(compact),
            "provisional_count": len(provisional),
            "provisional_changed_count": sum(
                1 for item in provisional.values() if item.get("changed_from_confirmed") is True
            ),
        },
        "records": compact,
        "recent_out": recent_out,
        "cost_policy": "paid_api_disabled",
    }


def save_snapshot(root: Path, snapshot: dict[str, Any]) -> tuple[Path, Path, bool, bool]:
    date = str(snapshot["snapshot_date"])
    current_path = root / "data" / "daily-snapshot.json"
    history_path = root / "history" / "daily" / f"{date}.json"
    current_changed = write_json_if_changed(current_path, snapshot)
    history_changed = write_json_if_changed(history_path, snapshot)
    return current_path, history_path, current_changed, history_changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a compact Kabutane daily snapshot")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    snapshot = build_snapshot(root)
    current, history, current_changed, history_changed = save_snapshot(root, snapshot)
    print(
        f"Daily snapshot: date={snapshot['snapshot_date']} records={len(snapshot['records'])} "
        f"state={snapshot['source_state']} current_changed={current_changed} history_changed={history_changed}"
    )
    print(f"  current: {current.relative_to(root)}")
    print(f"  history: {history.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
