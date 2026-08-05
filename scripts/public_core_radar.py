from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "core" / "radar.json"
DEFAULT_OUTPUT = ROOT / "data" / "core" / "public-radar.json"

PUBLIC_STATUSES = {"NEAR_GC", "CONTINUE", "DC", "OUT", "UNKNOWN"}
PUBLIC_FIELDS = (
    "code", "ticker", "name", "market", "sector",
    "current_price", "price_date", "sma25", "sma75", "sma200",
    "above_sma25", "above_sma75", "above_sma200", "perfect_order",
    "volume_ratio_5_30", "high52_price", "high52_distance_pct",
    "confirmed_month", "confirmed_status", "confirmed_active",
    "data_completeness_pct", "per", "pbr", "roe_pct", "equity_ratio_pct",
    "revenue_growth_pct", "free_cashflow_oku",
    "fundamentals_available", "fundamentals_stale",
)
REMOVED_FIELDS = {"provisional_month", "monthly_rsi14", "monthly_rsi_ma5", "monthly_rsi_spread"}


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def public_status(row: dict[str, Any]) -> str:
    raw = str(row.get("provisional_status") or "UNKNOWN").upper()
    if raw == "GC":
        confirmed = str(row.get("confirmed_status") or "OUT").upper()
        return "CONTINUE" if confirmed in {"NEW", "CONTINUE"} else "OUT"
    return raw if raw in PUBLIC_STATUSES else "UNKNOWN"


def sanitize_record(row: dict[str, Any]) -> dict[str, Any]:
    record = {key: row.get(key) for key in PUBLIC_FIELDS}
    record["provisional_status"] = public_status(row)
    return record


def build_public_payload(source: dict[str, Any]) -> dict[str, Any]:
    records = [sanitize_record(row) for row in source.get("records") or [] if isinstance(row, dict)]
    records.sort(key=lambda row: str(row.get("code") or ""))
    counts = {status: sum(row.get("provisional_status") == status for row in records) for status in sorted(PUBLIC_STATUSES)}
    return {
        "schema_version": 1,
        "kind": "core_universe_public_radar",
        "generated_at": source.get("generated_at"),
        "price_period": source.get("price_period"),
        "signal_version": source.get("signal_version"),
        "scope": "TSE domestic common stocks: Prime, Standard, Growth",
        "core_count": int(source.get("core_count") or len(records)),
        "daily_coverage": int(source.get("daily_coverage") or 0),
        "monthly_coverage": int(source.get("monthly_coverage") or 0),
        "fundamentals_coverage": int(source.get("fundamentals_coverage") or 0),
        "status_counts": counts,
        "public_boundary": "current_month_upcross_removed",
        "records": records,
    }


def validate_public_payload(payload: dict[str, Any]) -> None:
    records = payload.get("records") or []
    if any(str(row.get("provisional_status") or "").upper() == "GC" for row in records):
        raise ValueError("Public radar must not contain provisional GC status")
    for row in records:
        leaked = REMOVED_FIELDS.intersection(row)
        if leaked:
            raise ValueError(f"Public radar contains removed fields for {row.get('code')}: {sorted(leaked)}")


def write_public_radar(input_path: Path = DEFAULT_INPUT, output_path: Path = DEFAULT_OUTPUT) -> dict[str, Any]:
    source = load_json(input_path)
    payload = build_public_payload(source)
    validate_public_payload(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not output_path.exists() or output_path.read_text(encoding="utf-8") != text:
        output_path.write_text(text, encoding="utf-8")
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the public-safe all-core radar")
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = write_public_radar(Path(args.input), Path(args.output))
    print(f"Public core radar: records={len(payload.get('records') or [])}")


if __name__ == "__main__":
    main()
