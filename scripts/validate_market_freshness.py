from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"freshness input missing or invalid: {path}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"freshness input must be a JSON object: {path}")
    return payload


def text_date(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def max_record_price_date(payload: dict[str, Any]) -> str | None:
    dates = [
        text_date(item.get("price_date"))
        for item in payload.get("records") or []
        if isinstance(item, dict)
    ]
    values = [value for value in dates if value]
    return max(values) if values else None


def daily_price_date(payload: dict[str, Any]) -> str | None:
    return text_date(payload.get("price_date") or payload.get("daily_price_date"))


def require_not_older(label: str, current: str | None, baseline: str | None) -> None:
    if not baseline:
        return
    if not current:
        raise RuntimeError(f"{label} lost its price date; previous={baseline}")
    if current < baseline:
        raise RuntimeError(f"{label} regressed: {current} < {baseline}")


def validate_daily_regression(daily: dict[str, Any], baseline_daily: dict[str, Any] | None = None) -> str | None:
    current = daily_price_date(daily)
    previous = daily_price_date(baseline_daily or {})
    require_not_older("daily price date", current, previous)
    return current


def validate_full_freshness(
    daily: dict[str, Any],
    core: dict[str, Any],
    premium: dict[str, Any],
    *,
    baseline_core: dict[str, Any] | None = None,
) -> dict[str, str | None]:
    daily_date = daily_price_date(daily)
    core_date = max_record_price_date(core)
    premium_date = text_date(premium.get("price_date"))
    previous_core_date = max_record_price_date(baseline_core or {})

    require_not_older("core price date", core_date, previous_core_date)
    if daily_date and (not core_date or core_date < daily_date):
        raise RuntimeError(f"core is older than daily: core={core_date} daily={daily_date}")
    if core_date != premium_date:
        raise RuntimeError(f"premium/core price date mismatch: premium={premium_date} core={core_date}")

    core_generated_at = text_date(core.get("generated_at"))
    premium_source_core = text_date(premium.get("source_core_generated_at"))
    if core_generated_at and premium_source_core != core_generated_at:
        raise RuntimeError(
            "premium radar was not built from the current core radar: "
            f"premium_source_core={premium_source_core} core_generated_at={core_generated_at}"
        )

    return {
        "daily_date": daily_date,
        "core_date": core_date,
        "premium_date": premium_date,
        "core_generated_at": core_generated_at,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Prevent market-data date regression and stale ROOM publication.")
    parser.add_argument("--daily", type=Path, default=ROOT / "data" / "daily-update-status.json")
    parser.add_argument("--core", type=Path, default=ROOT / "data" / "core" / "radar.json")
    parser.add_argument("--premium", type=Path, default=ROOT / "data" / "premium" / "opportunity-radar.json")
    parser.add_argument("--baseline-daily", type=Path)
    parser.add_argument("--baseline-core", type=Path)
    parser.add_argument("--daily-only", action="store_true")
    args = parser.parse_args()

    daily = load_json(args.daily)
    baseline_daily = load_json(args.baseline_daily) if args.baseline_daily else None
    daily_date = validate_daily_regression(daily, baseline_daily)
    if args.daily_only:
        print(f"market freshness OK: daily={daily_date}")
        return

    core = load_json(args.core)
    premium = load_json(args.premium)
    baseline_core = load_json(args.baseline_core) if args.baseline_core else None
    result = validate_full_freshness(daily, core, premium, baseline_core=baseline_core)
    print(
        "market freshness OK: "
        f"daily={result['daily_date']} core={result['core_date']} premium={result['premium_date']}"
    )


if __name__ == "__main__":
    main()
