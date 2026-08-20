from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dividend_history import DEFAULT_MAX_YEARS, build_dividend_history, public_dividend_fields
from scripts import build_core_universe_data as core


DIVIDEND_HISTORY_PERIOD = os.getenv("DIVIDEND_HISTORY_PERIOD", "max")
DIVIDEND_HISTORY_YEARS = int(os.getenv("DIVIDEND_HISTORY_YEARS", str(DEFAULT_MAX_YEARS)))


def _load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _finance_for_code(output: Path, code: str, cache: dict[str, dict[str, Any]]) -> dict[str, Any]:
    shard = core.shard_key(code)
    if shard not in cache:
        path = output / "fundamentals" / f"{shard}.json"
        payload = _load_json(path, {}) or {}
        records = payload.get("records") if isinstance(payload, dict) else {}
        cache[shard] = records if isinstance(records, dict) else {}
    return cache[shard].get(code, {})


def _existing_dividend_for_code(
    output: Path,
    code: str,
    cache: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    shard = core.shard_key(code)
    if shard not in cache:
        path = output / "dividends" / f"{shard}.json"
        payload = _load_json(path, {}) or {}
        records = payload.get("records") if isinstance(payload, dict) else {}
        cache[shard] = records if isinstance(records, dict) else {}
    previous = cache[shard].get(code)
    return previous if isinstance(previous, dict) else None


def download_dividend_frames(stocks: list[dict[str, str]]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    tickers = [str(stock.get("ticker") or "") for stock in stocks if stock.get("ticker")]
    if not tickers:
        return {}, []
    print(
        f"Dividend history: downloading dedicated {DIVIDEND_HISTORY_PERIOD} monthly actions "
        f"for {len(tickers)} tickers; chart history remains unchanged"
    )
    return core.download_frames(
        tickers,
        DIVIDEND_HISTORY_PERIOD,
        "1mo",
        "dividend-history",
    )


def attach_dividend_data(
    output: Path,
    dividend_frames: dict[str, Any],
) -> dict[str, int]:
    radar_path = output / "radar.json"
    radar = _load_json(radar_path, {}) or {}
    rows = radar.get("records") or []
    detail_records: dict[str, dict[str, Any]] = {}
    finance_cache: dict[str, dict[str, Any]] = {}
    existing_dividend_cache: dict[str, dict[str, Any]] = {}
    available = 0
    no_cut_5y = 0
    increasing = 0
    fallback_count = 0

    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "")
        ticker = str(row.get("ticker") or "")
        frame = dividend_frames.get(ticker)
        if frame is None or getattr(frame, "empty", True):
            previous = _existing_dividend_for_code(
                output,
                code,
                existing_dividend_cache,
            )
            if previous:
                summary = {
                    key: value
                    for key, value in previous.items()
                    if key not in {"code", "ticker", "name"}
                }
                fallback_count += 1
            else:
                summary = build_dividend_history(
                    frame,
                    max_years=DIVIDEND_HISTORY_YEARS,
                )
        else:
            summary = build_dividend_history(
                frame,
                max_years=DIVIDEND_HISTORY_YEARS,
            )

        compact = public_dividend_fields(summary)
        row.update(compact)

        finance = _finance_for_code(output, code, finance_cache)
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
    radar["dividend_history_max_years"] = DIVIDEND_HISTORY_YEARS
    radar["dividend_history_period"] = DIVIDEND_HISTORY_PERIOD
    radar["dividend_no_cut_5y_count"] = no_cut_5y
    radar["dividend_increasing_count"] = increasing
    core.write_json(radar_path, radar)

    dividend_dir = output / "dividends"
    for shard, records in core.group_by_shard(detail_records).items():
        core.write_json(
            dividend_dir / f"{shard}.json",
            {
                "schema_version": 2,
                "generated_at": radar.get("generated_at"),
                "basis": "calendar_year_ex_date",
                "history_max_years": DIVIDEND_HISTORY_YEARS,
                "source_period": DIVIDEND_HISTORY_PERIOD,
                "records": records,
            },
        )
    return {
        "available": available,
        "no_cut_5y": no_cut_5y,
        "increasing": increasing,
        "fallback": fallback_count,
    }


def build_with_dividends(
    *,
    stocks: list[dict[str, str]],
    output: Path,
    refresh_base: bool,
    fundamentals_limit: int,
) -> dict[str, Any]:
    manifest = core.build_core_data(
        stocks,
        output=output,
        refresh_base=refresh_base,
        fundamentals_limit=fundamentals_limit,
    )

    dividend_frames, dividend_errors = download_dividend_frames(stocks)
    dividend_counts = attach_dividend_data(output, dividend_frames)

    manifest_path = output / "manifest.json"
    refreshed_manifest = _load_json(manifest_path, manifest) or manifest
    refreshed_manifest["dividend_history_coverage"] = dividend_counts["available"]
    refreshed_manifest["dividend_history_basis"] = "calendar_year_ex_date"
    refreshed_manifest["dividend_history_max_years"] = DIVIDEND_HISTORY_YEARS
    refreshed_manifest["dividend_history_period"] = DIVIDEND_HISTORY_PERIOD
    refreshed_manifest["dividend_history_download_errors"] = len(dividend_errors)
    refreshed_manifest["dividend_history_fallback_count"] = dividend_counts["fallback"]
    core.write_json(manifest_path, refreshed_manifest, compact=False)
    print("Dividend history:", json.dumps(dividend_counts, ensure_ascii=False))
    if dividend_errors:
        print(f"Dividend history download errors: {len(dividend_errors)}")
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
