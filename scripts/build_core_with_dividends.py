from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from dividend_history import build_dividend_history, public_dividend_fields
from scripts import build_core_universe_data as core


CAPTURED_MONTHLY: dict[str, Any] = {}


def _load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _finance_for_code(output: Path, code: str) -> dict[str, Any]:
    path = output / "fundamentals" / f"{core.shard_key(code)}.json"
    payload = _load_json(path, {}) or {}
    records = payload.get("records") if isinstance(payload, dict) else {}
    return records.get(code, {}) if isinstance(records, dict) else {}


def attach_dividend_data(output: Path, monthly_frames: dict[str, Any]) -> dict[str, int]:
    radar_path = output / "radar.json"
    radar = _load_json(radar_path, {}) or {}
    rows = radar.get("records") or []
    detail_records: dict[str, dict[str, Any]] = {}
    available = 0
    no_cut_5y = 0
    increasing = 0

    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "")
        ticker = str(row.get("ticker") or "")
        frame = monthly_frames.get(ticker)
        summary = build_dividend_history(frame)
        compact = public_dividend_fields(summary)
        row.update(compact)

        finance = _finance_for_code(output, code)
        row["dividend_yield_pct"] = finance.get("dividend_yield_pct")
        row["payout_ratio_pct"] = finance.get("payout_ratio_pct")

        if int(summary.get("observation_years") or 0) >= 2 and summary.get("latest_annual_dividend") is not None:
            available += 1
        if summary.get("no_cut_5y") is True:
            no_cut_5y += 1
        if int(summary.get("consecutive_increase_years") or 0) > 0:
            increasing += 1
        detail_records[code] = {
            "code": code,
            "ticker": ticker,
            "name": row.get("name") or code,
            **summary,
        }

    radar["dividend_history_coverage"] = available
    radar["dividend_no_cut_5y_count"] = no_cut_5y
    radar["dividend_increasing_count"] = increasing
    core.write_json(radar_path, radar)

    dividend_dir = output / "dividends"
    for shard, records in core.group_by_shard(detail_records).items():
        core.write_json(
            dividend_dir / f"{shard}.json",
            {
                "schema_version": 1,
                "generated_at": radar.get("generated_at"),
                "basis": "calendar_year_ex_date",
                "records": records,
            },
        )
    return {"available": available, "no_cut_5y": no_cut_5y, "increasing": increasing}


def build_with_dividends(*, stocks: list[dict[str, str]], output: Path, refresh_base: bool, fundamentals_limit: int) -> dict[str, Any]:
    global CAPTURED_MONTHLY
    CAPTURED_MONTHLY = {}
    original_download_frames = core.download_frames

    def capture_download(tickers: list[str], period: str, interval: str, stage: str):
        frames, errors = original_download_frames(tickers, period, interval, stage)
        if stage == "core-monthly":
            CAPTURED_MONTHLY.update(frames)
        return frames, errors

    core.download_frames = capture_download
    try:
        manifest = core.build_core_data(
            stocks,
            output=output,
            refresh_base=refresh_base,
            fundamentals_limit=fundamentals_limit,
        )
    finally:
        core.download_frames = original_download_frames

    dividend_counts = attach_dividend_data(output, CAPTURED_MONTHLY)
    manifest_path = output / "manifest.json"
    refreshed_manifest = _load_json(manifest_path, manifest) or manifest
    refreshed_manifest["dividend_history_coverage"] = dividend_counts["available"]
    refreshed_manifest["dividend_history_basis"] = "calendar_year_ex_date"
    core.write_json(manifest_path, refreshed_manifest, compact=False)
    print("Dividend history:", json.dumps(dividend_counts, ensure_ascii=False))
    return refreshed_manifest


def main() -> None:
    args = core.parse_args()
    requested = {value.strip().upper() for value in args.codes.split(",") if value.strip()} or None
    stocks = core.read_stocks(requested)
    if not stocks:
        raise SystemExit("No core stocks selected")
    build_with_dividends(
        stocks=stocks,
        output=Path(args.output),
        refresh_base=args.refresh_base,
        fundamentals_limit=args.fundamentals_limit,
    )


if __name__ == "__main__":
    main()
