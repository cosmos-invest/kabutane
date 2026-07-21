from __future__ import annotations

import csv
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent
ERRORS_PATH = ROOT / "data" / "errors.json"
STOCKS_PATH = ROOT / "stocks.csv"
OUTPUT_PATH = ROOT / "data" / "diagnostics" / "incomplete-retry.json"
BATCH_SIZE = 15
MAX_ATTEMPTS = 3
PIPELINE_MIN_MONTHS = 15
SIGNAL_READY_MONTHS = 19


def json_safe(value: Any) -> Any:
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def load_market_map() -> dict[str, str]:
    result: dict[str, str] = {}
    if not STOCKS_PATH.exists():
        return result
    with STOCKS_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            code = str(row.get("code") or "").strip().upper()
            if code:
                result[f"{code}.T"] = str(row.get("market") or "")
    return result


def targets() -> list[str]:
    if not ERRORS_PATH.exists():
        return []
    payload = json.loads(ERRORS_PATH.read_text(encoding="utf-8"))
    return sorted({
        str(item.get("ticker") or "").strip()
        for item in payload
        if item.get("stage") == "monthly" and item.get("ticker")
    })


def extract_frame(batch: pd.DataFrame, ticker: str, ticker_count: int) -> pd.DataFrame:
    if batch is None or batch.empty:
        return pd.DataFrame()
    frame = batch
    if isinstance(batch.columns, pd.MultiIndex):
        level0 = set(batch.columns.get_level_values(0))
        level1 = set(batch.columns.get_level_values(1))
        if ticker in level0:
            frame = batch[ticker].copy()
        elif ticker in level1:
            frame = batch.xs(ticker, level=1, axis=1).copy()
        else:
            return pd.DataFrame()
    elif ticker_count != 1:
        return pd.DataFrame()
    if "Close" not in frame.columns:
        return pd.DataFrame()
    frame = frame.loc[:, ~frame.columns.duplicated()].copy()
    frame.index = pd.to_datetime(frame.index, errors="coerce")
    return frame[~frame.index.isna()].sort_index()


def completed_month_count(frame: pd.DataFrame) -> tuple[int, str | None, str | None]:
    if frame.empty:
        return 0, None, None
    close = pd.to_numeric(frame.get("Close"), errors="coerce").dropna()
    if close.empty:
        return 0, None, None
    if getattr(close.index, "tz", None) is not None:
        close.index = close.index.tz_localize(None)
    current = pd.Period(pd.Timestamp.now(tz="Asia/Tokyo").strftime("%Y-%m"), freq="M")
    months = close.index.to_period("M")
    completed = close[months < current].groupby(months[months < current]).last()
    if completed.empty:
        return 0, None, None
    return len(completed), str(completed.index[0]), str(completed.index[-1])


def download_batch(tickers: list[str]) -> tuple[dict[str, pd.DataFrame], str | None]:
    last_error: str | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            batch = yf.download(
                tickers=tickers,
                period="max",
                interval="1mo",
                group_by="ticker",
                auto_adjust=False,
                actions=False,
                threads=False,
                progress=False,
                timeout=60,
            )
            frames = {ticker: extract_frame(batch, ticker, len(tickers)) for ticker in tickers}
            if any(not frame.empty for frame in frames.values()):
                return frames, None
            last_error = "empty response"
        except Exception as exc:  # noqa: BLE001 - diagnostic must keep going
            last_error = f"{type(exc).__name__}: {exc}"
        time.sleep(attempt * 10)
    return {ticker: pd.DataFrame() for ticker in tickers}, last_error


def main() -> None:
    tickers = targets()
    markets = load_market_map()
    rows: list[dict[str, Any]] = []
    for start in range(0, len(tickers), BATCH_SIZE):
        batch_tickers = tickers[start:start + BATCH_SIZE]
        print(f"retry monthly {start // BATCH_SIZE + 1}/{math.ceil(len(tickers) / BATCH_SIZE)}: {len(batch_tickers)}")
        frames, batch_error = download_batch(batch_tickers)
        for ticker in batch_tickers:
            count, first_month, last_month = completed_month_count(frames.get(ticker, pd.DataFrame()))
            if count >= SIGNAL_READY_MONTHS:
                status = "signal_ready"
            elif count >= PIPELINE_MIN_MONTHS:
                status = "pipeline_eligible_but_signal_warmup"
            elif count > 0:
                status = "still_insufficient_history"
            else:
                status = "download_failed_or_unavailable"
            rows.append({
                "ticker": ticker,
                "market": markets.get(ticker),
                "status": status,
                "completed_months": count,
                "first_month": first_month,
                "last_month": last_month,
                "error": batch_error if count == 0 else None,
            })
        time.sleep(12)

    summary = {
        "target_count": len(rows),
        "signal_ready_count": sum(row["status"] == "signal_ready" for row in rows),
        "pipeline_eligible_count": sum(row["status"].startswith("pipeline_eligible") for row in rows),
        "still_insufficient_count": sum(row["status"] == "still_insufficient_history" for row in rows),
        "unavailable_count": sum(row["status"] == "download_failed_or_unavailable" for row in rows),
    }
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance via yfinance",
        "scope": "only tickers currently recorded as monthly errors",
        "minimum_completed_months": {
            "pipeline": PIPELINE_MIN_MONTHS,
            "RSI14_plus_5_month_SMA": SIGNAL_READY_MONTHS,
        },
        "summary": summary,
        "records": rows,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=json_safe), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
