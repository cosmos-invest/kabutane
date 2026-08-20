from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dividend_history import (
    DEFAULT_MAX_YEARS,
    apply_verified_streak,
    build_dividend_history,
    public_dividend_fields,
)
from fiscal_year_calendar import EDINET_CODELIST_URL, load_fiscal_year_end_months
from scripts import build_core_universe_data as core


ROOT = Path(__file__).resolve().parents[1]
DIVIDEND_HISTORY_PERIOD = os.getenv("DIVIDEND_HISTORY_PERIOD", "max")
DIVIDEND_HISTORY_YEARS = int(os.getenv("DIVIDEND_HISTORY_YEARS", str(DEFAULT_MAX_YEARS)))
STREAK_OVERRIDES_FILE = Path(
    os.getenv(
        "DIVIDEND_STREAK_OVERRIDES_FILE",
        str(ROOT / "data" / "dividend_streak_overrides.json"),
    )
)


def _load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _load_streak_overrides() -> dict[str, dict[str, Any]]:
    payload = _load_json(STREAK_OVERRIDES_FILE, {}) or {}
    if not isinstance(payload, dict):
        return {}
    return {
        str(code).upper(): value
        for code, value in payload.items()
        if isinstance(value, dict)
    }


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
    streak_overrides = _load_streak_overrides()
    fiscal_year_ends = load_fiscal_year_end_months(output / "fiscal-year-ends.json")
    available = 0
    no_cut_5y = 0
    increasing = 0
    fallback_count = 0
    verified_streak_count = 0
    fiscal_year_count = 0
    lower_bound_count = 0

    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "")
        ticker = str(row.get("ticker") or "")
        frame = dividend_frames.get(ticker)
        fiscal_month = fiscal_year_ends.get(code)
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
                    fiscal_year_end_month=fiscal_month,
                )
        else:
            summary = build_dividend_history(
                frame,
                max_years=DIVIDEND_HISTORY_YEARS,
                fiscal_year_end_month=fiscal_month,
            )

        summary = apply_verified_streak(summary, streak_overrides.get(code))
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
        if summary.get("streak_verified") is True:
            verified_streak_count += 1
        if str(summary.get("basis") or "") == "fiscal_year_ex_date":
            fiscal_year_count += 1
        if summary.get("streak_lower_bound") is True:
            lower_bound_count += 1
        detail_records[code] = {
            "code": code,
            "ticker": ticker,
            "name": row.get("name") or code,
            **summary,
        }

    radar["dividend_history_coverage"] = available
    radar["dividend_history_max_years"] = DIVIDEND_HISTORY_YEARS
    radar["dividend_history_period"] = DIVIDEND_HISTORY_PERIOD
    radar["dividend_history_basis"] = "fiscal_year_ex_date_with_calendar_fallback"
    radar["dividend_fiscal_year_coverage"] = fiscal_year_count
    radar["dividend_fiscal_calendar_source"] = EDINET_CODELIST_URL
    radar["dividend_no_cut_5y_count"] = no_cut_5y
    radar["dividend_increasing_count"] = increasing
    radar["dividend_verified_streak_count"] = verified_streak_count
    radar["dividend_streak_lower_bound_count"] = lower_bound_count
    core.write_json(radar_path, radar)

    dividend_dir = output / "dividends"
    for shard, records in core.group_by_shard(detail_records).items():
        core.write_json(
            dividend_dir / f"{shard}.json",
            {
                "schema_version": 4,
                "generated_at": radar.get("generated_at"),
                "basis": "fiscal_year_ex_date_with_calendar_fallback",
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
        "verified_streaks": verified_streak_count,
        "fiscal_years": fiscal_year_count,
        "lower_bounds": lower_bound_count,
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
    refreshed_manifest["dividend_history_basis"] = "fiscal_year_ex_date_with_calendar_fallback"
    refreshed_manifest["dividend_fiscal_year_coverage"] = dividend_counts["fiscal_years"]
    refreshed_manifest["dividend_fiscal_calendar_source"] = EDINET_CODELIST_URL
    refreshed_manifest["dividend_history_max_years"] = DIVIDEND_HISTORY_YEARS
    refreshed_manifest["dividend_history_period"] = DIVIDEND_HISTORY_PERIOD
    refreshed_manifest["dividend_history_download_errors"] = len(dividend_errors)
    refreshed_manifest["dividend_history_fallback_count"] = dividend_counts["fallback"]
    refreshed_manifest["dividend_verified_streak_count"] = dividend_counts["verified_streaks"]
    refreshed_manifest["dividend_streak_lower_bound_count"] = dividend_counts["lower_bounds"]
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
