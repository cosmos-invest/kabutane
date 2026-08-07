from __future__ import annotations

import argparse
import csv
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import yfinance as yf

from tradingview_signal import SIGNAL_VERSION, tradingview_rsi

ROOT = Path(__file__).resolve().parents[1]
STOCKS_FILE = ROOT / "stocks.csv"
DEFAULT_OUTPUT = ROOT / "data" / "core"
FUNDAMENTALS_CACHE = ROOT / "data" / "fundamentals_cache.json"

DAILY_PERIOD = os.getenv("CORE_DAILY_PERIOD", "1y")
MONTHLY_PERIOD = os.getenv("CORE_MONTHLY_PERIOD", "10y")
BATCH_SIZE = int(os.getenv("CORE_YF_BATCH_SIZE", "80"))
DOWNLOAD_RETRIES = int(os.getenv("CORE_YF_DOWNLOAD_RETRIES", "2"))
FUNDAMENTALS_WORKERS = int(os.getenv("CORE_FUNDAMENTALS_WORKERS", "6"))
FUNDAMENTALS_CACHE_VERSION = 2
FUNDAMENTALS_CACHE_DAYS = int(os.getenv("CORE_FUNDAMENTALS_CACHE_DAYS", "30"))
OVERLAY_DAYS = int(os.getenv("CORE_OVERLAY_DAYS", "25"))
BASE_MAX_BYTES = int(os.getenv("CORE_BASE_MAX_BYTES", str(90 * 1024 * 1024)))

FUNDAMENTAL_KEYS = [
    "sector", "industry", "quote_type", "per", "forward_per", "pbr", "book_value",
    "dividend_yield_pct", "payout_ratio_pct", "roe_pct", "roa_pct", "profit_margin_pct",
    "operating_margin_pct", "revenue_growth_pct", "earnings_growth_pct", "current_ratio",
    "quick_ratio", "debt_to_equity_pct", "equity_ratio_pct", "market_cap_oku",
    "enterprise_value_oku", "operating_cashflow_oku", "free_cashflow_oku", "total_cash_oku",
    "total_debt_oku", "ebitda_oku", "beta", "shares_outstanding_million",
    "data_completeness_pct", "next_earnings_date", "earnings_date_start", "earnings_date_end",
    "ex_dividend_date", "last_dividend_date",
]


def finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def rounded(value: Any, digits: int = 2) -> float | None:
    number = finite(value)
    return round(number, digits) if number is not None else None


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return rounded(value, 6)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, pd.Period):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def write_json(path: Path, payload: Any, *, compact: bool = True) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(json_safe(payload), ensure_ascii=False, separators=(",", ":")) + "\n"
    else:
        text = json.dumps(json_safe(payload), ensure_ascii=False, indent=2) + "\n"
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous != text:
        path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def normalize_ticker(code: str) -> str:
    code = str(code or "").replace("\ufeff", "").strip().upper()
    return f"{code}.T" if code and "." not in code else code


def read_stocks(codes: set[str] | None = None) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with STOCKS_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            code = str(row.get("code") or "").strip().upper()
            if not code or (codes is not None and code not in codes):
                continue
            rows.append({
                "code": code,
                "ticker": normalize_ticker(code),
                "name": str(row.get("name") or code).strip(),
                "market": str(row.get("market") or "").strip(),
                "sector": str(row.get("sector") or "").strip(),
            })
    return rows


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


def _download_batch(tickers: list[str], period: str, interval: str) -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            return yf.download(
                tickers=tickers,
                period=period,
                interval=interval,
                group_by="ticker",
                auto_adjust=False,
                actions=True,
                threads=True,
                progress=False,
                timeout=60,
            )
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Yahoo Finance download failed: {last_error}")


def _split_frame(batch: pd.DataFrame, ticker: str, ticker_count: int) -> pd.DataFrame:
    if batch is None or batch.empty:
        return pd.DataFrame()
    if isinstance(batch.columns, pd.MultiIndex):
        level0 = set(batch.columns.get_level_values(0))
        level1 = set(batch.columns.get_level_values(1))
        if ticker in level0:
            frame = batch[ticker].copy()
        elif ticker in level1:
            frame = batch.xs(ticker, level=1, axis=1).copy()
        else:
            return pd.DataFrame()
    elif ticker_count == 1:
        frame = batch.copy()
    else:
        return pd.DataFrame()
    if "Close" not in frame.columns:
        return pd.DataFrame()
    frame = frame.loc[:, ~frame.columns.duplicated()].copy()
    frame.index = pd.to_datetime(frame.index, errors="coerce")
    frame = frame[~frame.index.isna()].sort_index()
    if getattr(frame.index, "tz", None) is not None:
        frame.index = frame.index.tz_localize(None)
    return frame


def download_frames(tickers: list[str], period: str, interval: str, stage: str) -> tuple[dict[str, pd.DataFrame], list[dict[str, str]]]:
    result: dict[str, pd.DataFrame] = {}
    errors: list[dict[str, str]] = []
    batches = list(chunked(tickers, BATCH_SIZE))
    for batch_index, symbols in enumerate(batches, start=1):
        print(f"{stage}: batch {batch_index}/{len(batches)} ({len(symbols)} symbols)")
        try:
            raw = _download_batch(symbols, period, interval)
        except Exception as exc:
            errors.extend({"ticker": ticker, "stage": stage, "message": str(exc)} for ticker in symbols)
            continue
        for ticker in symbols:
            frame = _split_frame(raw, ticker, len(symbols))
            if frame.empty:
                errors.append({"ticker": ticker, "stage": stage, "message": "価格データなし"})
            else:
                result[ticker] = frame
    return result, errors


def completed_monthly(monthly_frame: pd.DataFrame, current_period: pd.Period) -> pd.Series:
    if monthly_frame is None or monthly_frame.empty:
        return pd.Series(dtype=float)
    close = pd.to_numeric(monthly_frame.get("Close"), errors="coerce").dropna()
    if close.empty:
        return pd.Series(dtype=float)
    periods = close.index.to_period("M")
    values = pd.Series(close.to_numpy(dtype=float), index=periods).groupby(level=0).last()
    return values[values.index < current_period]


def signal_series(closes: pd.Series) -> pd.DataFrame:
    if closes is None or len(closes) < 20:
        return pd.DataFrame()
    rsi = tradingview_rsi(closes.astype(float), 14)
    ma = rsi.rolling(5, min_periods=5).mean()
    active = (rsi > ma) & rsi.notna() & ma.notna()
    previous = active.shift(1, fill_value=False).astype(bool)
    return pd.DataFrame({
        "close": closes,
        "rsi": rsi,
        "ma": ma,
        "active": active,
        "new": active & ~previous,
        "out": ~active & previous,
    })


def calculate_provisional(completed: pd.Series, latest_close: float | None, current_period: pd.Period) -> dict[str, Any] | None:
    base = signal_series(completed)
    if base.empty or latest_close is None:
        return None
    confirmed = base.iloc[-1]
    provisional_closes = completed.copy()
    provisional_closes.loc[current_period] = float(latest_close)
    provisional_frame = signal_series(provisional_closes)
    if provisional_frame.empty:
        return None
    current = provisional_frame.iloc[-1]
    confirmed_active = bool(confirmed["active"])
    provisional_active = bool(current["active"])
    spread = finite(current["rsi"] - current["ma"])
    if confirmed_active and not provisional_active:
        status = "DC"
    elif not confirmed_active and provisional_active:
        status = "GC"
    elif not confirmed_active and spread is not None and -2.0 <= spread <= 0:
        status = "NEAR_GC"
    elif provisional_active:
        status = "CONTINUE"
    else:
        status = "OUT"
    confirmed_status = "NEW" if bool(confirmed["new"]) else "CONTINUE" if confirmed_active else "OUT"
    return {
        "month": str(current_period),
        "status": status,
        "active": provisional_active,
        "changed_from_confirmed": confirmed_active != provisional_active,
        "monthly_rsi14": rounded(current["rsi"]),
        "monthly_rsi_ma5": rounded(current["ma"]),
        "spread": rounded(spread),
        "confirmed_month": str(base.index[-1]),
        "confirmed_status": confirmed_status,
        "confirmed_active": confirmed_active,
        "confirmed_rsi14": rounded(confirmed["rsi"]),
        "confirmed_rsi_ma5": rounded(confirmed["ma"]),
        "signal_version": SIGNAL_VERSION,
        "is_provisional": True,
    }


def technical_snapshot(frame: pd.DataFrame) -> dict[str, Any]:
    if frame is None or frame.empty:
        return {}
    close = pd.to_numeric(frame.get("Close"), errors="coerce")
    high = pd.to_numeric(frame.get("High"), errors="coerce")
    volume = pd.to_numeric(frame.get("Volume"), errors="coerce")
    valid = pd.DataFrame({"close": close, "high": high, "volume": volume}).dropna(subset=["close"])
    if valid.empty:
        return {}
    current = finite(valid["close"].iloc[-1])
    sma25 = finite(valid["close"].rolling(25, min_periods=25).mean().iloc[-1])
    sma75 = finite(valid["close"].rolling(75, min_periods=75).mean().iloc[-1])
    sma200 = finite(valid["close"].rolling(200, min_periods=200).mean().iloc[-1])
    avg5 = finite(valid["volume"].rolling(5, min_periods=5).mean().iloc[-1])
    avg30 = finite(valid["volume"].rolling(30, min_periods=30).mean().iloc[-1])
    high52 = finite(valid["high"].shift(1).rolling(252, min_periods=min(200, len(valid))).max().iloc[-1]) if len(valid) >= 200 else None
    return {
        "current_price": rounded(current),
        "price_date": valid.index[-1].strftime("%Y-%m-%d"),
        "sma25": rounded(sma25),
        "sma75": rounded(sma75),
        "sma200": rounded(sma200),
        "above_sma25": current is not None and sma25 is not None and current > sma25,
        "above_sma75": current is not None and sma75 is not None and current > sma75,
        "above_sma200": current is not None and sma200 is not None and current > sma200,
        "perfect_order": sma25 is not None and sma75 is not None and sma200 is not None and sma25 > sma75 > sma200,
        "volume_ratio_5_30": rounded(avg5 / avg30 if avg5 is not None and avg30 not in (None, 0) else None),
        "high52_price": rounded(high52),
        "high52_distance_pct": rounded((current / high52 - 1) * 100 if current is not None and high52 not in (None, 0) else None),
    }


def compact_daily_rows(frame: pd.DataFrame, limit: int | None = None) -> list[list[Any]]:
    if frame is None or frame.empty:
        return []
    source = frame.tail(limit) if limit else frame
    rows: list[list[Any]] = []
    for date, row in source.iterrows():
        close = finite(row.get("Close"))
        if close is None:
            continue
        rows.append([
            date.strftime("%Y-%m-%d"), rounded(row.get("Open")), rounded(row.get("High")), rounded(row.get("Low")), rounded(close), rounded(row.get("Volume"), 0),
        ])
    return rows


def corporate_events(frame: pd.DataFrame) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if frame is None or frame.empty:
        return result
    for date, row in frame.iterrows():
        dividend = finite(row.get("Dividends"))
        split = finite(row.get("Stock Splits"))
        if dividend not in (None, 0):
            result.append({"date": date.strftime("%Y-%m-%d"), "type": "DIVIDEND", "label": "配当", "detail": f"1株 {dividend:g}円"})
        if split not in (None, 0):
            result.append({"date": date.strftime("%Y-%m-%d"), "type": "SPLIT", "label": "株式分割・併合", "detail": f"比率 {split:g}", "ratio": split})
    return result


def monthly_chart_rows(completed: pd.Series) -> tuple[list[list[Any]], list[dict[str, Any]]]:
    frame = signal_series(completed)
    if frame.empty:
        return [], []
    rows: list[list[Any]] = []
    events: list[dict[str, Any]] = []
    for period, row in frame.tail(60).iterrows():
        rows.append([str(period), rounded(row["rsi"]), rounded(row["ma"])])
        if bool(row["new"]):
            events.append({"type": "GC", "month": str(period)})
        if bool(row["out"]):
            events.append({"type": "DC", "month": str(period)})
    return rows, events[-40:]


def load_fundamentals_cache() -> dict[str, Any]:
    try:
        payload = json.loads(FUNDAMENTALS_CACHE.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def cache_fresh(entry: dict[str, Any]) -> bool:
    try:
        if int(entry.get("version") or 0) != FUNDAMENTALS_CACHE_VERSION:
            return False
        fetched = datetime.fromisoformat(str(entry.get("fetched_at") or "").replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)).days < FUNDAMENTALS_CACHE_DAYS
    except Exception:
        return False


def fetch_fundamental(ticker_symbol: str) -> dict[str, Any]:
    import test as pipeline
    return pipeline.fetch_fundamental(ticker_symbol)


def refresh_fundamentals(stocks: list[dict[str, str]], limit: int) -> tuple[dict[str, Any], list[dict[str, str]]]:
    cache = load_fundamentals_cache()
    errors: list[dict[str, str]] = []
    ticker_set = {stock["ticker"] for stock in stocks}
    missing = [ticker for ticker in sorted(ticker_set) if not isinstance(cache.get(ticker), dict)]
    missing_set = set(missing)
    stale = [ticker for ticker in sorted(ticker_set) if isinstance(cache.get(ticker), dict) and not cache_fresh(cache[ticker])]
    pending = missing + [ticker for ticker in stale if ticker not in missing_set]
    if limit == 0:
        pending = []
    elif limit > 0:
        pending = pending[:limit]
    if pending:
        print(f"fundamentals: refreshing {len(pending)} / {len(ticker_set)}")
    now = datetime.now(timezone.utc).isoformat()
    with ThreadPoolExecutor(max_workers=max(1, FUNDAMENTALS_WORKERS)) as executor:
        futures = {executor.submit(fetch_fundamental, ticker): ticker for ticker in pending}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                cache[ticker] = {"version": FUNDAMENTALS_CACHE_VERSION, "fetched_at": now, "data": future.result()}
            except Exception as exc:
                errors.append({"ticker": ticker, "stage": "fundamentals", "message": str(exc)})
    if pending:
        write_json(FUNDAMENTALS_CACHE, cache, compact=False)
    return cache, errors


def finance_record(cache: dict[str, Any], ticker: str) -> dict[str, Any]:
    entry = cache.get(ticker) if isinstance(cache.get(ticker), dict) else {}
    data = entry.get("data") if isinstance(entry, dict) and isinstance(entry.get("data"), dict) else {}
    result = {key: data.get(key) for key in FUNDAMENTAL_KEYS}
    result["fundamentals_fetched_at"] = entry.get("fetched_at") if isinstance(entry, dict) else None
    result["fundamentals_stale"] = bool(entry) and not cache_fresh(entry)
    result["fundamentals_available"] = any(result.get(key) is not None for key in FUNDAMENTAL_KEYS)
    return result


def shard_key(code: str) -> str:
    value = str(code or "").strip().upper()
    return value[:2] if len(value) >= 2 else "__"


def group_by_shard(records: dict[str, Any]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for code, value in records.items():
        grouped.setdefault(shard_key(code), {})[code] = value
    return grouped


def build_core_data(stocks: list[dict[str, str]], *, output: Path, refresh_base: bool, fundamentals_limit: int) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat()
    current_period = pd.Period(pd.Timestamp.now(tz="Asia/Tokyo").strftime("%Y-%m"), freq="M")
    tickers = [stock["ticker"] for stock in stocks]
    stock_by_ticker = {stock["ticker"]: stock for stock in stocks}

    daily_frames, daily_errors = download_frames(tickers, DAILY_PERIOD, "1d", "core-daily")
    monthly_frames, monthly_errors = download_frames(tickers, MONTHLY_PERIOD, "1mo", "core-monthly")
    fundamentals_cache, fundamental_errors = refresh_fundamentals(stocks, fundamentals_limit)

    radar_rows: list[dict[str, Any]] = []
    base_records: dict[str, Any] = {}
    overlay_records: dict[str, Any] = {}
    finance_records: dict[str, Any] = {}
    monthly_ok = 0
    daily_ok = 0
    finance_ok = 0

    for ticker in tickers:
        stock = stock_by_ticker[ticker]
        code = stock["code"]
        daily = daily_frames.get(ticker, pd.DataFrame())
        monthly_raw = monthly_frames.get(ticker, pd.DataFrame())
        technical = technical_snapshot(daily)
        if technical:
            daily_ok += 1
        completed = completed_monthly(monthly_raw, current_period)
        if len(completed) >= 20:
            monthly_ok += 1
        latest_close = finite(technical.get("current_price"))
        provisional = calculate_provisional(completed, latest_close, current_period)
        finance = finance_record(fundamentals_cache, ticker)
        if finance.get("fundamentals_available"):
            finance_ok += 1
        finance_records[code] = finance

        signal = provisional or {
            "status": "UNKNOWN", "monthly_rsi14": None, "monthly_rsi_ma5": None, "spread": None,
            "confirmed_month": None, "confirmed_status": None, "confirmed_active": False,
            "signal_version": SIGNAL_VERSION, "is_provisional": True,
        }
        radar_rows.append({
            **stock,
            **technical,
            "provisional_status": signal.get("status"),
            "provisional_month": signal.get("month"),
            "monthly_rsi14": signal.get("monthly_rsi14"),
            "monthly_rsi_ma5": signal.get("monthly_rsi_ma5"),
            "monthly_rsi_spread": signal.get("spread"),
            "confirmed_month": signal.get("confirmed_month"),
            "confirmed_status": signal.get("confirmed_status"),
            "confirmed_active": signal.get("confirmed_active"),
            "data_completeness_pct": finance.get("data_completeness_pct"),
            "per": finance.get("per"), "pbr": finance.get("pbr"), "roe_pct": finance.get("roe_pct"),
            "equity_ratio_pct": finance.get("equity_ratio_pct"), "revenue_growth_pct": finance.get("revenue_growth_pct"),
            "free_cashflow_oku": finance.get("free_cashflow_oku"),
            "fundamentals_available": finance.get("fundamentals_available"),
            "fundamentals_stale": finance.get("fundamentals_stale"),
        })

        overlay_records[code] = {
            "code": code,
            "ticker": ticker,
            "price_date": technical.get("price_date"),
            "daily": compact_daily_rows(daily, OVERLAY_DAYS),
            "technical": technical,
            "provisional_signal": signal,
            "corporate_events": corporate_events(daily.tail(OVERLAY_DAYS)),
        }

        if refresh_base:
            monthly_rows, events = monthly_chart_rows(completed)
            confirmed_status = signal.get("confirmed_status")
            confirmed_rsi = finite(signal.get("confirmed_rsi14"))
            confirmed_ma = finite(signal.get("confirmed_rsi_ma5"))
            base_records[code] = {
                "code": code, "ticker": ticker, "name": stock["name"], "market": stock["market"], "sector": stock["sector"],
                "daily": compact_daily_rows(daily),
                "monthly": monthly_rows,
                "cross_events": events,
                "corporate_events": corporate_events(daily),
                "record": {
                    "signal_month": signal.get("confirmed_month"),
                    "status": confirmed_status,
                    "monthly_rsi14": signal.get("confirmed_rsi14"),
                    "monthly_rsi_ma5": signal.get("confirmed_rsi_ma5"),
                    "rsi5": signal.get("confirmed_rsi14"),
                    "rsi14": signal.get("confirmed_rsi_ma5"),
                    "diff": rounded(confirmed_rsi - confirmed_ma) if confirmed_rsi is not None and confirmed_ma is not None else None,
                    "current_price": technical.get("current_price"),
                    "signal_version": SIGNAL_VERSION,
                    "core_universe_fallback": True,
                },
            }

    radar_rows.sort(key=lambda row: (row.get("provisional_status") != "GC", -(finite(row.get("monthly_rsi_spread")) or -9999), row.get("code", "")))
    radar = {
        "schema_version": 2,
        "kind": "core_universe_daily_radar",
        "generated_at": generated_at,
        "price_period": DAILY_PERIOD,
        "monthly_period": MONTHLY_PERIOD,
        "signal_version": SIGNAL_VERSION,
        "core_count": len(stocks),
        "daily_coverage": daily_ok,
        "monthly_coverage": monthly_ok,
        "fundamentals_coverage": finance_ok,
        "status_counts": {status: sum(row.get("provisional_status") == status for row in radar_rows) for status in ["GC", "NEAR_GC", "CONTINUE", "DC", "OUT", "UNKNOWN"]},
        "records": radar_rows,
    }
    output.mkdir(parents=True, exist_ok=True)
    radar_bytes = write_json(output / "radar.json", radar)

    overlay_bytes = 0
    for shard, records in group_by_shard(overlay_records).items():
        overlay_bytes += write_json(output / "daily" / f"{shard}.json", {"schema_version": 1, "generated_at": generated_at, "records": records})

    finance_bytes = 0
    for shard, records in group_by_shard(finance_records).items():
        finance_bytes += write_json(output / "fundamentals" / f"{shard}.json", {"schema_version": 1, "generated_at": generated_at, "records": records})

    base_bytes = 0
    if refresh_base:
        for shard, records in group_by_shard(base_records).items():
            base_bytes += write_json(output / "charts" / f"{shard}.json", {"schema_version": 1, "generated_at": generated_at, "period": DAILY_PERIOD, "records": records})
        if base_bytes > BASE_MAX_BYTES:
            raise RuntimeError(f"core chart base is too large: {base_bytes} bytes > {BASE_MAX_BYTES}")

    existing_manifest = {}
    manifest_path = output / "manifest.json"
    try:
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        existing_manifest = {}
    manifest = {
        "schema_version": 2,
        "generated_at": generated_at,
        "scope": "TSE domestic common stocks: Prime, Standard, Growth",
        "core_count": len(stocks),
        "daily_coverage": daily_ok,
        "monthly_coverage": monthly_ok,
        "fundamentals_coverage": finance_ok,
        "chart_base_generated_at": generated_at if refresh_base else existing_manifest.get("chart_base_generated_at"),
        "chart_period": DAILY_PERIOD,
        "overlay_days": OVERLAY_DAYS,
        "shard_rule": "first two characters of security code",
        "bytes": {
            "radar": radar_bytes,
            "daily_overlay": overlay_bytes,
            "fundamentals": finance_bytes,
            "chart_base": base_bytes if refresh_base else existing_manifest.get("bytes", {}).get("chart_base"),
        },
        "errors": {
            "daily": len(daily_errors), "monthly": len(monthly_errors), "fundamentals": len(fundamental_errors),
        },
    }
    write_json(manifest_path, manifest, compact=False)
    write_json(output / "errors.json", daily_errors + monthly_errors + fundamental_errors)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build compact all-core chart/radar/fundamental data for Kabutane")
    parser.add_argument("--refresh-base", action="store_true", help="refresh the one-year chart base shards")
    parser.add_argument("--fundamentals-limit", type=int, default=int(os.getenv("CORE_FUNDAMENTALS_LIMIT", "0")), help="0=cache only, positive=N pending, negative=all pending")
    parser.add_argument("--codes", default=os.getenv("CORE_CODES", ""), help="comma separated codes for live/sample checks")
    parser.add_argument("--output", default=os.getenv("CORE_OUTPUT_DIR", str(DEFAULT_OUTPUT)))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    requested = {value.strip().upper() for value in args.codes.split(",") if value.strip()} or None
    stocks = read_stocks(requested)
    if not stocks:
        raise SystemExit("No core stocks selected")
    build_core_data(stocks, output=Path(args.output), refresh_base=args.refresh_base, fundamentals_limit=args.fundamentals_limit)


if __name__ == "__main__":
    main()
