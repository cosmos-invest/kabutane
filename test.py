from __future__ import annotations

import csv
import json
import math
import os
import time
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CHART_DIR = DATA_DIR / "charts"
MONTH_DIR = DATA_DIR / "months"
HISTORY_DIR = ROOT / "history"
STOCKS_FILE = ROOT / "stocks.csv"
CACHE_FILE = DATA_DIR / "fundamentals_cache.json"

HISTORY_MONTHS = int(os.getenv("HISTORY_MONTHS", "48"))
MONTHLY_PERIOD = os.getenv("MONTHLY_PERIOD", "10y")
DAILY_PERIOD = os.getenv("DAILY_PERIOD", "3y")
ANALYSIS_DAILY_PERIOD = os.getenv("ANALYSIS_DAILY_PERIOD", "5y")
BATCH_SIZE = int(os.getenv("YF_BATCH_SIZE", "80"))
DOWNLOAD_RETRIES = int(os.getenv("YF_DOWNLOAD_RETRIES", "3"))
FUNDAMENTALS_WORKERS = int(os.getenv("FUNDAMENTALS_WORKERS", "3"))
FUNDAMENTALS_CACHE_DAYS = int(os.getenv("FUNDAMENTALS_CACHE_DAYS", "25"))
SKIP_FUNDAMENTALS = os.getenv("SKIP_FUNDAMENTALS", "0") == "1"

BENCHMARKS = {
    "TOPIX": {"ticker": "^TOPX", "name": "TOPIX"},
    "NIKKEI225": {"ticker": "^N225", "name": "日経平均"},
}

RESULT_FIELDS = [
    "code",
    "ticker",
    "name",
    "sector",
    "industry",
    "quote_type",
    "signal_month",
    "status",
    "months_active",
    "rsi14",
    "rsi5",
    "diff",
    "gc_month",
    "gc_price",
    "signal_month_close",
    "current_price",
    "change_from_signal_month_pct",
    "return_since_gc_pct",
    "per",
    "forward_per",
    "pbr",
    "book_value",
    "dividend_yield_pct",
    "payout_ratio_pct",
    "roe_pct",
    "roa_pct",
    "profit_margin_pct",
    "operating_margin_pct",
    "revenue_growth_pct",
    "earnings_growth_pct",
    "current_ratio",
    "quick_ratio",
    "debt_to_equity_pct",
    "equity_ratio_pct",
    "market_cap_oku",
    "enterprise_value_oku",
    "operating_cashflow_oku",
    "free_cashflow_oku",
    "total_cash_oku",
    "total_debt_oku",
    "ebitda_oku",
    "beta",
    "shares_outstanding_million",
    "data_completeness_pct",
]

FUNDAMENTAL_FIELDS = RESULT_FIELDS[RESULT_FIELDS.index("per"):]
ANALYSIS_FUNDAMENTAL_FIELDS = [
    "roe_pct",
    "revenue_growth_pct",
    "equity_ratio_pct",
    "market_cap_oku",
    "operating_cashflow_oku",
    "free_cashflow_oku",
]


# -----------------------------
# General helpers
# -----------------------------

def ensure_dirs() -> None:
    for directory in (DATA_DIR, CHART_DIR, MONTH_DIR, HISTORY_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        if math.isnan(float(value)) or math.isinf(float(value)):
            return None
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, pd.Period):
        return str(value)
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(json_safe(payload), fh, ensure_ascii=False, indent=2)


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows([{key: json_safe(row.get(key)) for key in fields} for row in rows])


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def rounded(value: Any, digits: int = 2) -> float | None:
    number = to_float(value)
    return round(number, digits) if number is not None else None


def optional_bool(value: Any) -> bool | None:
    if value is None or pd.isna(value):
        return None
    return bool(value)


def percentage(value: Any) -> float | None:
    number = to_float(value)
    return round(number * 100, 2) if number is not None else None


def dividend_percentage(value: Any) -> float | None:
    """Yahoo may return either 0.035 or 3.5 depending on endpoint/version."""
    number = to_float(value)
    if number is None:
        return None
    return round(number * 100 if abs(number) <= 1 else number, 2)


def oku(value: Any) -> float | None:
    number = to_float(value)
    return round(number / 100_000_000, 2) if number is not None else None


def million(value: Any) -> float | None:
    number = to_float(value)
    return round(number / 1_000_000, 2) if number is not None else None


def normalize_ticker(code: str) -> str:
    cleaned = str(code).replace("\ufeff", "").strip().upper()
    if not cleaned:
        return ""
    return cleaned if "." in cleaned else f"{cleaned}.T"


def display_code(ticker: str) -> str:
    return ticker[:-2] if ticker.upper().endswith(".T") else ticker


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


# -----------------------------
# Input
# -----------------------------

def read_stocks(path: Path = STOCKS_FILE) -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError("stocks.csv がありません。code列を持つCSVを作成してください。")

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError("stocks.csv にヘッダーがありません。最低限 code 列が必要です。")

        normalized = {str(name).strip().lower(): name for name in reader.fieldnames}
        code_key = normalized.get("code") or normalized.get("コード") or reader.fieldnames[0]
        name_key = normalized.get("name") or normalized.get("銘柄名") or normalized.get("会社名")

        stocks: list[dict[str, str]] = []
        seen: set[str] = set()
        for row in reader:
            raw_code = str(row.get(code_key, "")).strip()
            if not raw_code or raw_code.startswith("#"):
                continue
            ticker = normalize_ticker(raw_code)
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            stocks.append({
                "code": display_code(ticker),
                "ticker": ticker,
                "name": str(row.get(name_key, "")).strip() if name_key else "",
            })

    if not stocks:
        raise ValueError("stocks.csv に有効な銘柄コードがありません。")
    return stocks


# -----------------------------
# Price data and RSI
# -----------------------------

def calc_rsi(series: pd.Series, period: int) -> pd.Series:
    """Simple-moving-average RSI, matching the prototype used in this project."""
    values = pd.to_numeric(series, errors="coerce")
    delta = values.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.where(~((avg_loss == 0) & (avg_gain > 0)), 100.0)
    rsi = rsi.where(~((avg_loss == 0) & (avg_gain == 0)), 50.0)
    return rsi


def download_batch(tickers: list[str], period: str, interval: str) -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            return yf.download(
                tickers=tickers,
                period=period,
                interval=interval,
                group_by="ticker",
                auto_adjust=False,
                actions=False,
                threads=True,
                progress=False,
                timeout=60,
            )
        except Exception as exc:  # network/API failures must not kill the whole run
            last_error = exc
            time.sleep(attempt * 2)
    raise RuntimeError(f"Yahoo Finance batch download failed: {last_error}")


def split_batch_frame(batch: pd.DataFrame, ticker: str, ticker_count: int) -> pd.DataFrame:
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
    return frame


def download_frames(
    tickers: list[str],
    period: str,
    interval: str,
    errors: list[dict[str, Any]],
    stage: str,
) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    chunks = list(chunked(tickers, BATCH_SIZE))
    for chunk_number, chunk in enumerate(chunks, start=1):
        print(f"{stage}: batch {chunk_number}/{len(chunks)} ({len(chunk)} symbols)")
        try:
            batch = download_batch(chunk, period=period, interval=interval)
        except Exception as exc:
            for ticker in chunk:
                errors.append({"ticker": ticker, "stage": stage, "message": str(exc)})
            continue

        for ticker in chunk:
            frame = split_batch_frame(batch, ticker, len(chunk))
            if frame.empty:
                errors.append({"ticker": ticker, "stage": stage, "message": "価格データなし"})
            else:
                frames[ticker] = frame
    return frames


def prepare_monthly(frame: pd.DataFrame, current_period: pd.Period) -> pd.DataFrame:
    close = pd.to_numeric(frame.get("Close"), errors="coerce").dropna()
    if close.empty:
        return pd.DataFrame()

    work = pd.DataFrame({"close": close})
    if getattr(work.index, "tz", None) is not None:
        work.index = work.index.tz_localize(None)
    work["month"] = work.index.to_period("M")
    work = work[work["month"] < current_period]
    if work.empty:
        return pd.DataFrame()

    monthly = work.groupby("month", sort=True).last()
    monthly["rsi14"] = calc_rsi(monthly["close"], 14)
    monthly["rsi5"] = calc_rsi(monthly["close"], 5)
    monthly["rsi14_up"] = (monthly["rsi14"] > monthly["rsi14"].shift(1)).where(monthly["rsi14"].shift(1).notna())
    monthly["rsi5_up"] = (monthly["rsi5"] > monthly["rsi5"].shift(1)).where(monthly["rsi5"].shift(1).notna())
    monthly["condition"] = (monthly["rsi5"] > monthly["rsi14"]) & monthly["rsi5"].notna() & monthly["rsi14"].notna()
    previous = monthly["condition"].shift(1, fill_value=False).astype(bool)
    monthly["new"] = monthly["condition"] & ~previous
    monthly["out"] = ~monthly["condition"] & previous
    return monthly


def consecutive_active(monthly: pd.DataFrame, month: pd.Period) -> int:
    count = 0
    for value in reversed(monthly.loc[:month, "condition"].tolist()):
        if bool(value):
            count += 1
        else:
            break
    return count


def last_gc_month(monthly: pd.DataFrame, month: pd.Period) -> pd.Period | None:
    candidates = monthly.loc[:month]
    candidates = candidates[candidates["new"]]
    return candidates.index[-1] if not candidates.empty else None


def build_month_record(
    stock: dict[str, str],
    monthly: pd.DataFrame,
    month: pd.Period,
) -> dict[str, Any] | None:
    if month not in monthly.index or not bool(monthly.at[month, "condition"]):
        return None
    gc_month = last_gc_month(monthly, month)
    if gc_month is None:
        return None
    close = to_float(monthly.at[month, "close"])
    gc_price = to_float(monthly.at[gc_month, "close"])
    return_pct = ((close / gc_price) - 1) * 100 if close and gc_price else None
    return {
        "code": stock["code"],
        "ticker": stock["ticker"],
        "name": stock["name"] or stock["code"],
        "signal_month": str(month),
        "status": "NEW" if bool(monthly.at[month, "new"]) else "CONTINUE",
        "months_active": consecutive_active(monthly, month),
        "rsi14": rounded(monthly.at[month, "rsi14"]),
        "rsi5": rounded(monthly.at[month, "rsi5"]),
        "rsi14_up": optional_bool(monthly.at[month, "rsi14_up"]),
        "rsi5_up": optional_bool(monthly.at[month, "rsi5_up"]),
        "diff": rounded(monthly.at[month, "rsi5"] - monthly.at[month, "rsi14"]),
        "gc_month": str(gc_month),
        "gc_price": rounded(gc_price),
        "signal_month_close": rounded(close),
        "period_price": rounded(close),
        "return_since_gc_pct": rounded(return_pct),
    }


ANALYSIS_TECHNICAL_FIELDS = [
    "sma25",
    "sma75",
    "sma200",
    "price_above_sma25",
    "price_above_sma75",
    "price_above_sma200",
    "perfect_order",
    "sma25_up",
    "sma75_up",
    "sma200_up",
    "avg_volume30",
    "high52_price",
    "high52_distance_pct",
    "high52_breakout",
    "volume_ratio_5_30",
    "atr14_pct",
    "atr_ratio_10_20",
    "vcp_tight",
    "stage",
    "supertrend_up",
    "rsr_score",
    "rsr_momentum",
    "mvp_signal",
]


def calculate_supertrend(work: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.Series:
    """Return the Pine-compatible Supertrend direction (1 up, -1 down)."""
    atr = work["true_range"].rolling(period, min_periods=period).mean()
    source = (work["high"] + work["low"]) / 2
    basic_up = (source - multiplier * atr).to_numpy(dtype=float)
    basic_down = (source + multiplier * atr).to_numpy(dtype=float)
    final_up = basic_up.copy()
    final_down = basic_down.copy()
    close = work["close"].to_numpy(dtype=float)
    trend = np.ones(len(work), dtype=np.int8)

    for position in range(1, len(work)):
        if np.isnan(basic_up[position]) or np.isnan(basic_down[position]):
            trend[position] = trend[position - 1]
            continue
        previous_up = final_up[position - 1]
        previous_down = final_down[position - 1]
        if np.isnan(previous_up):
            previous_up = basic_up[position]
        if np.isnan(previous_down):
            previous_down = basic_down[position]
        previous_close = close[position - 1]
        final_up[position] = max(basic_up[position], previous_up) if previous_close > previous_up else basic_up[position]
        final_down[position] = min(basic_down[position], previous_down) if previous_close < previous_down else basic_down[position]

        previous_trend = int(trend[position - 1])
        current_close = close[position]
        if previous_trend == -1 and current_close > previous_down:
            trend[position] = 1
        elif previous_trend == 1 and current_close < previous_up:
            trend[position] = -1
        else:
            trend[position] = previous_trend
    return pd.Series(trend, index=work.index)


def prepare_daily_analysis(frame: pd.DataFrame) -> pd.DataFrame:
    """Calculate daily indicators used to describe a NEW signal at month-end."""
    if frame is None or frame.empty:
        return pd.DataFrame()
    close = pd.to_numeric(frame.get("Close"), errors="coerce")
    high = pd.to_numeric(frame.get("High"), errors="coerce")
    low = pd.to_numeric(frame.get("Low"), errors="coerce")
    volume = pd.to_numeric(frame.get("Volume"), errors="coerce")
    work = pd.DataFrame({"close": close, "high": high, "low": low, "volume": volume}).dropna(subset=["close"])
    if work.empty:
        return work
    if getattr(work.index, "tz", None) is not None:
        work.index = work.index.tz_localize(None)
    work = work.sort_index()
    for length in (25, 50, 75, 150, 200):
        column = f"sma{length}"
        work[column] = work["close"].rolling(length, min_periods=length).mean()
        if length in (25, 75, 200):
            # One trading month smooths out a noisy one-day direction change.
            prior = work[column].shift(20)
            work[f"{column}_up"] = (work[column] > prior).where(prior.notna())
    work["avg_volume5"] = work["volume"].rolling(5, min_periods=5).mean()
    work["avg_volume20"] = work["volume"].rolling(20, min_periods=20).mean()
    work["avg_volume30"] = work["volume"].rolling(30, min_periods=30).mean()
    work["volume_ratio_5_30"] = work["avg_volume5"] / work["avg_volume30"].replace(0, np.nan)

    # Exclude the current day from the 52-week high so a breakout is unambiguous.
    work["high52_price"] = work["high"].shift(1).rolling(252, min_periods=252).max()
    work["high52_distance_pct"] = (work["close"] / work["high52_price"] - 1) * 100
    work["high52_breakout"] = (work["close"] > work["high52_price"]).where(work["high52_price"].notna())

    previous_close = work["close"].shift(1)
    work["true_range"] = pd.concat(
        [
            work["high"] - work["low"],
            (work["high"] - previous_close).abs(),
            (work["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr10 = work["true_range"].rolling(10, min_periods=10).mean()
    atr14 = work["true_range"].rolling(14, min_periods=14).mean()
    atr20 = work["true_range"].rolling(20, min_periods=20).mean()
    work["atr14_pct"] = atr14 / work["close"].replace(0, np.nan) * 100
    work["atr_ratio_10_20"] = atr10 / atr20.replace(0, np.nan)
    work["vcp_tight"] = (work["atr_ratio_10_20"] < 1).where(work["atr_ratio_10_20"].notna())
    work["supertrend_up"] = calculate_supertrend(work).eq(1)

    work["rsr_score"] = (
        work["close"].pct_change(63, fill_method=None) * 100 * 0.4
        + work["close"].pct_change(126, fill_method=None) * 100 * 0.2
        + work["close"].pct_change(189, fill_method=None) * 100 * 0.2
        + work["close"].pct_change(252, fill_method=None) * 100 * 0.2
    )
    work["rsr_momentum"] = work["rsr_score"].ewm(span=8, adjust=False, min_periods=8).mean() - work["rsr_score"].rolling(21, min_periods=21).mean()
    work["mvp_signal"] = (
        (work["close"].pct_change(fill_method=None) > 0)
        & (work["volume"] > work["avg_volume20"] * 1.5)
        & (work["rsr_momentum"] > 0)
    ).where(work["rsr_momentum"].notna() & work["avg_volume20"].notna())

    ma200_rising = work["sma200"] > work["sma200"].shift(21)
    ma200_falling = work["sma200"] < work["sma200"].shift(5)
    crossunder_ma50 = (work["close"] < work["sma50"]) & (work["close"].shift(1) >= work["sma50"].shift(1))
    stage2 = (work["close"] > work["sma200"]) & (work["sma150"] > work["sma200"]) & ma200_rising
    stage4 = (work["close"] < work["sma200"]) & (work["sma150"] < work["sma200"])
    stage3 = (work["close"] > work["sma200"]) & (ma200_falling | crossunder_ma50)
    work["stage"] = 1
    work.loc[stage3, "stage"] = 3
    work.loc[stage4, "stage"] = 4
    work.loc[stage2, "stage"] = 2
    return work


def daily_metrics_at_month(daily_analysis: pd.DataFrame, month: pd.Period) -> dict[str, Any]:
    """Return the last available daily indicator values inside the signal month."""
    if daily_analysis is None or daily_analysis.empty:
        return {field: None for field in ANALYSIS_TECHNICAL_FIELDS}
    eligible = daily_analysis.loc[:month.end_time]
    if eligible.empty:
        return {field: None for field in ANALYSIS_TECHNICAL_FIELDS}
    row = eligible.iloc[-1]
    price = to_float(row.get("close"))
    values = {f"sma{length}": to_float(row.get(f"sma{length}")) for length in (25, 75, 200)}

    def compare_above(value: float | None) -> bool | None:
        return price > value if price is not None and value is not None else None

    perfect_order = None
    if all(values.values()):
        perfect_order = values["sma25"] > values["sma75"] > values["sma200"]
    return {
        "sma25": rounded(values["sma25"]),
        "sma75": rounded(values["sma75"]),
        "sma200": rounded(values["sma200"]),
        "price_above_sma25": compare_above(values["sma25"]),
        "price_above_sma75": compare_above(values["sma75"]),
        "price_above_sma200": compare_above(values["sma200"]),
        "perfect_order": perfect_order,
        "sma25_up": optional_bool(row.get("sma25_up")),
        "sma75_up": optional_bool(row.get("sma75_up")),
        "sma200_up": optional_bool(row.get("sma200_up")),
        "avg_volume30": rounded(row.get("avg_volume30"), 0),
        "high52_price": rounded(row.get("high52_price")),
        "high52_distance_pct": rounded(row.get("high52_distance_pct")),
        "high52_breakout": optional_bool(row.get("high52_breakout")),
        "volume_ratio_5_30": rounded(row.get("volume_ratio_5_30")),
        "atr14_pct": rounded(row.get("atr14_pct")),
        "atr_ratio_10_20": rounded(row.get("atr_ratio_10_20")),
        "vcp_tight": optional_bool(row.get("vcp_tight")),
        "stage": int(row.get("stage")) if pd.notna(row.get("stage")) else None,
        "supertrend_up": optional_bool(row.get("supertrend_up")),
        "rsr_score": rounded(row.get("rsr_score")),
        "rsr_momentum": rounded(row.get("rsr_momentum")),
        "mvp_signal": optional_bool(row.get("mvp_signal")),
    }


def enrich_new_records_with_technicals(
    records_by_month: dict[pd.Period, list[dict[str, Any]]],
    daily_frames: dict[str, pd.DataFrame],
) -> None:
    """Attach NEW-time technical values without recalculating per episode."""
    prepared = {
        ticker: prepare_daily_analysis(frame)
        for ticker, frame in daily_frames.items()
    }
    for month, records in records_by_month.items():
        for record in records:
            if record.get("status") != "NEW":
                continue
            record.update(daily_metrics_at_month(prepared.get(record["ticker"], pd.DataFrame()), month))


def build_out_record(
    previous_record: dict[str, Any],
    monthly: pd.DataFrame | None,
    month: pd.Period,
) -> dict[str, Any]:
    exit_price = None
    if monthly is not None and month in monthly.index:
        exit_price = to_float(monthly.at[month, "close"])
    if exit_price is None:
        exit_price = to_float(previous_record.get("period_price"))
    gc_price = to_float(previous_record.get("gc_price"))
    return_pct = ((exit_price / gc_price) - 1) * 100 if exit_price and gc_price else None
    return {
        **previous_record,
        "status": "OUT",
        "exit_month": str(month),
        "exit_price": rounded(exit_price),
        "return_at_exit_pct": rounded(return_pct),
    }


def build_analysis_episodes(
    records_by_month: dict[pd.Period, list[dict[str, Any]]],
    out_by_month: dict[pd.Period, list[dict[str, Any]]],
    latest_records: list[dict[str, Any]],
    latest_month: pd.Period,
    valuation_date: str | None = None,
    monthly_by_ticker: dict[str, pd.DataFrame] | None = None,
) -> list[dict[str, Any]]:
    """Build NEW-origin episodes and ignore OUT events without an in-range NEW."""
    episodes: list[dict[str, Any]] = []
    open_by_ticker: dict[str, dict[str, Any]] = {}

    for month in sorted(records_by_month):
        for record in records_by_month.get(month, []):
            if record.get("status") != "NEW":
                continue
            start_price = to_float(record.get("gc_price") or record.get("signal_month_close"))
            if start_price is None:
                continue
            episode = {
                "code": record.get("code"),
                "ticker": record.get("ticker"),
                "name": record.get("name") or record.get("code"),
                "status": "ACTIVE",
                "start_month": str(month),
                # The signal is published in the following month, so this is
                # that publication month's previous-month closing price.
                "start_price": rounded(start_price),
                "start_rsi14": rounded(record.get("rsi14")),
                "start_rsi5": rounded(record.get("rsi5")),
                "start_rsi14_up": record.get("rsi14_up"),
                "start_rsi5_up": record.get("rsi5_up"),
                "start_rsi_strength": rounded(record.get("diff")),
                "end_month": None,
                "end_price": None,
                "valuation_date": valuation_date,
                "return_pct": None,
                "duration_months": latest_month.ordinal - month.ordinal + 1,
            }
            for field in ANALYSIS_TECHNICAL_FIELDS:
                episode[f"start_{field}"] = record.get(field)
            episodes.append(episode)
            open_by_ticker[str(record.get("ticker"))] = episode

        for out_record in out_by_month.get(month, []):
            ticker = str(out_record.get("ticker"))
            episode = open_by_ticker.pop(ticker, None)
            if episode is None:
                # The NEW occurred before the retained analysis window.
                continue
            start_price = to_float(episode.get("start_price"))
            end_price = to_float(out_record.get("exit_price") or out_record.get("period_price"))
            episode["status"] = "CLOSED"
            episode["end_month"] = str(month)
            episode["end_price"] = rounded(end_price)
            episode["valuation_date"] = None
            episode["return_pct"] = rounded(
                ((end_price / start_price) - 1) * 100
                if start_price and end_price else None
            )
            episode["duration_months"] = max(
                1,
                month.ordinal - pd.Period(episode["start_month"], freq="M").ordinal,
            )

    latest_by_ticker = {str(record.get("ticker")): record for record in latest_records}
    for ticker, episode in open_by_ticker.items():
        latest = latest_by_ticker.get(ticker, {})
        start_price = to_float(episode.get("start_price"))
        end_price = to_float(
            latest.get("current_price")
            or latest.get("period_price")
            or latest.get("signal_month_close")
        )
        episode["name"] = latest.get("name") or episode.get("name")
        episode["end_price"] = rounded(end_price)
        episode["return_pct"] = rounded(
            ((end_price / start_price) - 1) * 100
            if start_price and end_price else None
        )

    if monthly_by_ticker:
        for episode in episodes:
            ticker = str(episode.get("ticker"))
            monthly = monthly_by_ticker.get(ticker)
            if monthly is None or monthly.empty:
                episode["monthly_returns"] = []
                continue
            start_month = pd.Period(episode["start_month"], freq="M")
            end_month = pd.Period(episode.get("end_month") or latest_month, freq="M")
            path: list[dict[str, Any]] = []
            return_months = list(pd.period_range(start=start_month + 1, end=end_month, freq="M"))
            for position, month in enumerate(return_months):
                previous_month = month - 1
                if previous_month not in monthly.index or month not in monthly.index:
                    continue
                previous_close = to_float(monthly.at[previous_month, "close"])
                current_close = to_float(monthly.at[month, "close"])
                if not previous_close or current_close is None:
                    continue
                path.append({
                    "month": str(month),
                    "return_pct": rounded((current_close / previous_close - 1) * 100),
                    "entry": position == 0,
                    "exit": episode.get("status") == "CLOSED" and month == end_month,
                })
            episode["monthly_returns"] = path

    return sorted(
        episodes,
        key=lambda row: (row.get("start_month", ""), row.get("code", "")),
        reverse=True,
    )


def build_benchmark_series(
    daily_frames: dict[str, pd.DataFrame],
    months: list[pd.Period],
) -> dict[str, dict[str, Any]]:
    """Build month-end price-return series aligned to the strategy months."""
    result: dict[str, dict[str, Any]] = {}
    for key, definition in BENCHMARKS.items():
        frame = daily_frames.get(definition["ticker"], pd.DataFrame())
        if frame is None or frame.empty:
            result[key] = {**definition, "returns": []}
            continue
        close = pd.to_numeric(frame.get("Close"), errors="coerce").dropna()
        if getattr(close.index, "tz", None) is not None:
            close.index = close.index.tz_localize(None)
        monthly_close = close.groupby(close.index.to_period("M")).last()
        rows: list[dict[str, Any]] = []
        for month in months[1:]:
            previous_month = month - 1
            if previous_month not in monthly_close.index or month not in monthly_close.index:
                continue
            previous_close = to_float(monthly_close.loc[previous_month])
            current_close = to_float(monthly_close.loc[month])
            if not previous_close or current_close is None:
                continue
            rows.append({
                "month": str(month),
                "return_pct": rounded((current_close / previous_close - 1) * 100),
            })
        result[key] = {**definition, "returns": rows}
    return result


# -----------------------------
# Fundamentals
# -----------------------------

def balance_sheet_value(balance_sheet: pd.DataFrame, candidates: list[str]) -> float | None:
    if balance_sheet is None or balance_sheet.empty:
        return None
    for candidate in candidates:
        if candidate in balance_sheet.index:
            values = pd.to_numeric(balance_sheet.loc[candidate], errors="coerce").dropna()
            if not values.empty:
                return to_float(values.iloc[0])
    return None


def load_cache() -> dict[str, Any]:
    if not CACHE_FILE.exists():
        return {}
    try:
        with CACHE_FILE.open("r", encoding="utf-8") as fh:
            value = json.load(fh)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def cache_is_fresh(entry: dict[str, Any]) -> bool:
    try:
        fetched = datetime.fromisoformat(entry["fetched_at"].replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)
        return age.days < FUNDAMENTALS_CACHE_DAYS
    except Exception:
        return False


def fetch_fundamental(ticker_symbol: str) -> dict[str, Any]:
    ticker = yf.Ticker(ticker_symbol)
    info = ticker.get_info() or {}
    balance_sheet = ticker.balance_sheet
    assets = balance_sheet_value(balance_sheet, ["Total Assets", "TotalAssets"])
    equity = balance_sheet_value(
        balance_sheet,
        ["Stockholders Equity", "Total Equity Gross Minority Interest", "Common Stock Equity"],
    )
    equity_ratio = (equity / assets * 100) if equity is not None and assets not in (None, 0) else None

    fields = {
        "name": info.get("shortName") or info.get("longName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "quote_type": info.get("quoteType"),
        "per": rounded(info.get("trailingPE")),
        "forward_per": rounded(info.get("forwardPE")),
        "pbr": rounded(info.get("priceToBook")),
        "book_value": rounded(info.get("bookValue")),
        "dividend_yield_pct": dividend_percentage(info.get("dividendYield")),
        "payout_ratio_pct": percentage(info.get("payoutRatio")),
        "roe_pct": percentage(info.get("returnOnEquity")),
        "roa_pct": percentage(info.get("returnOnAssets")),
        "profit_margin_pct": percentage(info.get("profitMargins")),
        "operating_margin_pct": percentage(info.get("operatingMargins")),
        "revenue_growth_pct": percentage(info.get("revenueGrowth")),
        "earnings_growth_pct": percentage(info.get("earningsGrowth")),
        "current_ratio": rounded(info.get("currentRatio")),
        "quick_ratio": rounded(info.get("quickRatio")),
        "debt_to_equity_pct": rounded(info.get("debtToEquity")),
        "equity_ratio_pct": rounded(equity_ratio),
        "market_cap_oku": oku(info.get("marketCap")),
        "enterprise_value_oku": oku(info.get("enterpriseValue")),
        "operating_cashflow_oku": oku(info.get("operatingCashflow")),
        "free_cashflow_oku": oku(info.get("freeCashflow")),
        "total_cash_oku": oku(info.get("totalCash")),
        "total_debt_oku": oku(info.get("totalDebt")),
        "ebitda_oku": oku(info.get("ebitda")),
        "beta": rounded(info.get("beta")),
        "shares_outstanding_million": million(info.get("sharesOutstanding")),
    }
    completeness_fields = [key for key in fields if key not in {"name", "sector", "industry", "quote_type"}]
    available = sum(fields.get(key) is not None for key in completeness_fields)
    fields["data_completeness_pct"] = round(available / len(completeness_fields) * 100, 1)
    return fields


def enrich_fundamentals(
    records: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    if not records or SKIP_FUNDAMENTALS:
        return

    cache = load_cache()
    now_iso = datetime.now(timezone.utc).isoformat()
    pending: list[str] = []
    by_ticker = {record["ticker"]: record for record in records}

    def merge_fundamentals(record: dict[str, Any], data: dict[str, Any]) -> None:
        configured_name = record.get("name")
        record.update(data)
        # stocks.csv is the curated Japanese company-name source.  Yahoo's
        # profile data is still useful for financials, but must not replace it.
        if configured_name:
            record["name"] = configured_name

    for ticker_symbol, record in by_ticker.items():
        cached = cache.get(ticker_symbol)
        if isinstance(cached, dict) and cache_is_fresh(cached):
            merge_fundamentals(record, cached.get("data", {}))
        else:
            pending.append(ticker_symbol)

    if pending:
        print(f"財務情報: {len(pending)}銘柄を取得")
    with ThreadPoolExecutor(max_workers=max(1, FUNDAMENTALS_WORKERS)) as executor:
        futures = {executor.submit(fetch_fundamental, ticker): ticker for ticker in pending}
        for future in as_completed(futures):
            ticker_symbol = futures[future]
            try:
                data = future.result()
                merge_fundamentals(by_ticker[ticker_symbol], data)
                cache[ticker_symbol] = {"fetched_at": now_iso, "data": data}
            except Exception as exc:
                errors.append({"ticker": ticker_symbol, "stage": "fundamentals", "message": str(exc)})
                by_ticker[ticker_symbol].setdefault("data_completeness_pct", 0)

    write_json(CACHE_FILE, cache)


# -----------------------------
# Charts and historical episodes
# -----------------------------

def build_episodes(
    monthly: pd.DataFrame,
    current_price: float | None,
) -> list[dict[str, Any]]:
    episodes: list[dict[str, Any]] = []
    months = list(monthly.index)
    new_positions = [index for index, month in enumerate(months) if bool(monthly.at[month, "new"])]

    for start_pos in new_positions:
        start_month = months[start_pos]
        start_price = to_float(monthly.at[start_month, "close"])
        end_pos = None
        for position in range(start_pos + 1, len(months)):
            if bool(monthly.at[months[position], "out"]):
                end_pos = position
                break

        last_pos = end_pos if end_pos is not None else len(months) - 1
        section = pd.to_numeric(monthly.iloc[start_pos:last_pos + 1]["close"], errors="coerce").dropna()
        end_month = months[end_pos] if end_pos is not None else None
        end_price = to_float(monthly.at[end_month, "close"]) if end_month is not None else current_price
        return_pct = ((end_price / start_price) - 1) * 100 if start_price and end_price else None
        max_pct = ((section.max() / start_price) - 1) * 100 if start_price and not section.empty else None
        min_pct = ((section.min() / start_price) - 1) * 100 if start_price and not section.empty else None
        episodes.append({
            "start_month": str(start_month),
            "start_price": rounded(start_price),
            "end_month": str(end_month) if end_month is not None else None,
            "end_price": rounded(end_price),
            "status": "CLOSED" if end_month is not None else "ACTIVE",
            "return_pct": rounded(return_pct),
            "max_return_pct": rounded(max_pct),
            "min_return_pct": rounded(min_pct),
            "duration_months": last_pos - start_pos + 1,
        })
    return episodes[-20:]


def build_chart_payload(
    record: dict[str, Any],
    daily: pd.DataFrame,
    monthly: pd.DataFrame,
) -> dict[str, Any]:
    closes = pd.to_numeric(daily.get("Close"), errors="coerce").dropna()
    if getattr(closes.index, "tz", None) is not None:
        closes.index = closes.index.tz_localize(None)
    closes = closes.sort_index()

    monthly_valid = monthly[["rsi14", "rsi5"]].dropna(how="all")
    periods = list(monthly_valid.index)
    period_ordinals = [period.ordinal for period in periods]
    latest_period = periods[-1] if periods else None

    daily_rows: list[dict[str, Any]] = []
    for date, close in closes.items():
        day_period = pd.Period(date, freq="M")
        lookup_period = latest_period if latest_period is not None and day_period > latest_period else day_period
        position = bisect_right(period_ordinals, lookup_period.ordinal) - 1 if periods else -1
        rsi14 = monthly_valid.iloc[position]["rsi14"] if position >= 0 else None
        rsi5 = monthly_valid.iloc[position]["rsi5"] if position >= 0 else None
        daily_rows.append({
            "date": date.strftime("%Y-%m-%d"),
            "close": rounded(close),
            "rsi14": rounded(rsi14),
            "rsi5": rounded(rsi5),
        })

    gc_events = []
    for month in monthly.index[monthly["new"]]:
        gc_events.append({
            "month": str(month),
            "price": rounded(monthly.at[month, "close"]),
        })

    current_price = to_float(record.get("current_price"))
    return {
        "code": record["code"],
        "ticker": record["ticker"],
        "name": record.get("name") or record["code"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "record": record,
        "daily": daily_rows,
        "gc_events": gc_events[-20:],
        "episodes": build_episodes(monthly, current_price),
    }


def trim_daily_for_chart(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep chart JSON at its existing size while analysis uses a longer lookback."""
    if frame is None or frame.empty or not DAILY_PERIOD.endswith("y"):
        return frame
    try:
        years = int(DAILY_PERIOD[:-1])
    except ValueError:
        return frame
    index = pd.to_datetime(frame.index, errors="coerce")
    if index.isna().all():
        return frame
    cutoff = index.max() - pd.DateOffset(years=years)
    return frame.loc[index >= cutoff]


# -----------------------------
# Main pipeline
# -----------------------------

def main() -> None:
    ensure_dirs()
    errors: list[dict[str, Any]] = []
    stocks = read_stocks()
    stock_by_ticker = {stock["ticker"]: stock for stock in stocks}
    tickers = list(stock_by_ticker)
    print(f"対象銘柄: {len(tickers)}")

    now_jst = pd.Timestamp.now(tz="Asia/Tokyo")
    current_period = pd.Period(now_jst.strftime("%Y-%m"), freq="M")

    monthly_raw = download_frames(
        tickers,
        period=MONTHLY_PERIOD,
        interval="1mo",
        errors=errors,
        stage="monthly",
    )

    monthly_by_ticker: dict[str, pd.DataFrame] = {}
    for ticker_symbol, frame in monthly_raw.items():
        monthly = prepare_monthly(frame, current_period)
        if len(monthly) < 15:
            errors.append({"ticker": ticker_symbol, "stage": "monthly", "message": "RSI計算に必要な月足が不足"})
            continue
        monthly_by_ticker[ticker_symbol] = monthly

    if not monthly_by_ticker:
        raise RuntimeError("有効な月足データを1銘柄も取得できませんでした。")

    latest_month = max(frame.index[-1] for frame in monthly_by_ticker.values())
    months = list(pd.period_range(end=latest_month, periods=HISTORY_MONTHS, freq="M"))
    records_by_month: dict[pd.Period, list[dict[str, Any]]] = {}
    out_by_month: dict[pd.Period, list[dict[str, Any]]] = {}

    previous_map: dict[str, dict[str, Any]] = {}
    for month in months:
        current_records: list[dict[str, Any]] = []
        current_map: dict[str, dict[str, Any]] = {}
        for ticker_symbol, monthly in monthly_by_ticker.items():
            record = build_month_record(stock_by_ticker[ticker_symbol], monthly, month)
            if record is not None:
                current_records.append(record)
                current_map[ticker_symbol] = record

        out_records: list[dict[str, Any]] = []
        for ticker_symbol in sorted(set(previous_map) - set(current_map)):
            out_records.append(build_out_record(previous_map[ticker_symbol], monthly_by_ticker.get(ticker_symbol), month))

        current_records.sort(key=lambda row: (row.get("diff") is None, -(row.get("diff") or 0)))
        out_records.sort(key=lambda row: row.get("code", ""))
        records_by_month[month] = current_records
        out_by_month[month] = out_records
        previous_map = current_map

    latest_records = records_by_month.get(latest_month, [])
    latest_out_records = out_by_month.get(latest_month, [])
    active_tickers = [record["ticker"] for record in latest_records]
    analysis_tickers = sorted({
        record["ticker"]
        for records in records_by_month.values()
        for record in records
        if record.get("status") == "NEW"
    })
    analysis_ticker_set = set(analysis_tickers)
    benchmark_tickers = {definition["ticker"] for definition in BENCHMARKS.values()}
    daily_tickers = sorted(set(active_tickers) | analysis_ticker_set | benchmark_tickers)

    daily_frames = download_frames(
        daily_tickers,
        period=ANALYSIS_DAILY_PERIOD,
        interval="1d",
        errors=errors,
        stage="daily",
    ) if daily_tickers else {}

    enrich_new_records_with_technicals(records_by_month, daily_frames)
    benchmark_series = build_benchmark_series(daily_frames, months)

    for record in latest_records:
        daily = trim_daily_for_chart(daily_frames.get(record["ticker"], pd.DataFrame()))
        closes = pd.to_numeric(daily.get("Close"), errors="coerce").dropna() if not daily.empty else pd.Series(dtype=float)
        current_price = to_float(closes.iloc[-1]) if not closes.empty else to_float(record.get("signal_month_close"))
        signal_close = to_float(record.get("signal_month_close"))
        gc_price = to_float(record.get("gc_price"))
        record["current_price"] = rounded(current_price)
        record["change_from_signal_month_pct"] = rounded(((current_price / signal_close) - 1) * 100) if current_price and signal_close else None
        record["return_since_gc_pct"] = rounded(((current_price / gc_price) - 1) * 100) if current_price and gc_price else None

    # Financial filters use the latest profile available at generation time.
    # This is intentionally stored separately from NEW-time technical values so
    # the analysis page can disclose the different time bases clearly.
    profile_tickers = sorted(
        analysis_ticker_set
        | {record["ticker"] for record in latest_records + latest_out_records}
    )
    profile_records = [dict(stock_by_ticker[ticker]) for ticker in profile_tickers]
    enrich_fundamentals(profile_records, errors)
    profiles_by_ticker = {record["ticker"]: record for record in profile_records}

    for record in latest_records + latest_out_records:
        configured_name = record.get("name")
        profile = profiles_by_ticker.get(record["ticker"], {})
        for field in FUNDAMENTAL_FIELDS:
            record[field] = profile.get(field)
        if configured_name:
            record["name"] = configured_name

    for record in latest_records:
        if not record.get("name") or record["name"] == record["code"]:
            record["name"] = record.get("name") or record["code"]

    # Generate chart/detail JSON for all currently active signals.
    for record in latest_records:
        daily = trim_daily_for_chart(daily_frames.get(record["ticker"], pd.DataFrame()))
        monthly = monthly_by_ticker[record["ticker"]]
        payload = build_chart_payload(record, daily, monthly)
        write_json(CHART_DIR / f"{record['code']}.json", payload)

    # Write 36 monthly snapshots and downloadable CSVs.
    month_index: list[dict[str, Any]] = []
    historical_fields = [
        "code", "ticker", "name", "signal_month", "status", "months_active",
        "rsi14", "rsi5", "rsi14_up", "rsi5_up", "diff", "gc_month", "gc_price", "signal_month_close",
        "period_price", "return_since_gc_pct",
    ] + ANALYSIS_TECHNICAL_FIELDS
    out_fields = (
        historical_fields
        + ["sector", "industry", "quote_type"]
        + ["exit_month", "exit_price", "return_at_exit_pct"]
        + FUNDAMENTAL_FIELDS
    )

    for month in reversed(months):
        month_records = records_by_month.get(month, [])
        month_out = out_by_month.get(month, [])
        month_payload = {
            "month": str(month),
            "summary": {
                "active_count": len(month_records),
                "new_count": sum(row.get("status") == "NEW" for row in month_records),
                "out_count": len(month_out),
                "up_count": sum((row.get("return_since_gc_pct") or 0) >= 0 for row in month_records),
                "down_count": sum((row.get("return_since_gc_pct") or 0) < 0 for row in month_records),
            },
            "records": month_records,
            "out_records": month_out,
        }
        write_json(MONTH_DIR / f"{month}.json", month_payload)
        write_csv(HISTORY_DIR / f"{month}.csv", month_records, historical_fields)
        write_csv(HISTORY_DIR / f"{month}-out.csv", month_out, out_fields)
        month_index.append({"month": str(month), **month_payload["summary"]})

    write_json(MONTH_DIR / "index.json", month_index)

    latest_records.sort(key=lambda row: (row.get("diff") is None, -(row.get("diff") or 0)))
    latest_out_records.sort(key=lambda row: row.get("code", ""))
    summary = {
        "active_count": len(latest_records),
        "new_count": sum(row.get("status") == "NEW" for row in latest_records),
        "out_count": len(latest_out_records),
        "up_count": sum((row.get("return_since_gc_pct") or 0) >= 0 for row in latest_records),
        "down_count": sum((row.get("return_since_gc_pct") or 0) < 0 for row in latest_records),
        "error_count": len(errors),
    }
    latest_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "signal_month": str(latest_month),
        "rsi_method": "SMA RSI: monthly RSI5 > monthly RSI14",
        "summary": summary,
        "records": latest_records,
        "out_records": latest_out_records,
        "errors": errors,
    }
    analysis_episodes = build_analysis_episodes(
        records_by_month,
        out_by_month,
        latest_records,
        latest_month,
        latest_payload["generated_at"][:10],
        monthly_by_ticker,
    )
    split_index = max(1, len(months) // 2)
    validation_start_month = months[split_index]
    analysis_payload = {
        "generated_at": latest_payload["generated_at"],
        "latest_month": str(latest_month),
        "available_start_month": str(min(months)),
        "available_end_month": str(max(months)),
        "price_basis": "判定月の月末終値（公開月から見た前月終値）",
        "technical_basis": "NEW判定月末の日足（52週高値は当日を除く252取引日、SMAの向きは20取引日前と比較）",
        "fundamental_basis": "データ生成時点の最新財務情報（過去のNEW当時の決算値ではありません）",
        "portfolio_basis": "NEW月末からOUT月末まで、月次等金額で保有（売買費用は画面で設定）",
        "validation_start_month": str(validation_start_month),
        "benchmarks": benchmark_series,
        "profiles": {
            ticker: {
                field: profile.get(field)
                for field in ANALYSIS_FUNDAMENTAL_FIELDS
            }
            for ticker, profile in profiles_by_ticker.items()
            if ticker in analysis_ticker_set
        },
        "episodes": analysis_episodes,
    }
    write_json(DATA_DIR / "latest.json", latest_payload)
    write_json(DATA_DIR / "analysis.json", analysis_payload)
    write_json(DATA_DIR / "errors.json", errors)
    write_csv(ROOT / "result.csv", latest_records, RESULT_FIELDS)
    write_csv(ROOT / "out.csv", latest_out_records, out_fields)
    write_csv(DATA_DIR / "errors.csv", errors, ["ticker", "stage", "message"])

    print("\n完了")
    print(f"シグナル月: {latest_month}")
    print(f"対象: {summary['active_count']} / NEW: {summary['new_count']} / OUT: {summary['out_count']}")
    print(f"上昇: {summary['up_count']} / 下落: {summary['down_count']} / エラー: {summary['error_count']}")


if __name__ == "__main__":
    main()
