from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import yfinance as yf

from tradingview_signal import SIGNAL_VERSION, prepare_monthly_compat

ROOT = Path(__file__).resolve().parents[1]
ALL_STOCKS_FILE = ROOT / "stocks-all.csv"
OUTPUT_DIR = ROOT / "data" / "extended"
OUTPUT_FILE = OUTPUT_DIR / "latest.json"
BATCH_SIZE = int(os.getenv("EXTENDED_YF_BATCH_SIZE", "100"))
PERIOD = os.getenv("EXTENDED_MONTHLY_PERIOD", "max")
RETRIES = int(os.getenv("EXTENDED_YF_RETRIES", "2"))


def finite(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


def normalize_ticker(code: str) -> str:
    return f"{str(code).strip().upper()}.T"


def load_extended_issues() -> list[dict[str, str]]:
    if not ALL_STOCKS_FILE.exists():
        raise FileNotFoundError("stocks-all.csv がありません。先に update_universe.py を実行してください。")
    frame = pd.read_csv(ALL_STOCKS_FILE, dtype=str).fillna("")
    if "scope" not in frame.columns:
        raise RuntimeError("stocks-all.csv に scope 列がありません。")
    frame = frame[frame["scope"] == "extended"].copy()
    records: list[dict[str, str]] = []
    for row in frame.to_dict(orient="records"):
        code = str(row.get("code") or "").strip().upper()
        if not code:
            continue
        records.append({
            "code": code,
            "ticker": normalize_ticker(code),
            "name": str(row.get("name") or "").strip(),
            "market": str(row.get("market") or "").strip(),
            "sector": str(row.get("sector") or "").strip(),
            "instrument_type": str(row.get("instrument_type") or "other").strip(),
            "scope": "extended",
        })
    return records


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
    return frame[~frame.index.isna()].sort_index()


def download_batch(tickers: list[str]) -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            return yf.download(
                tickers=tickers,
                period=PERIOD,
                interval="1mo",
                group_by="ticker",
                auto_adjust=False,
                actions=False,
                threads=True,
                progress=False,
                timeout=60,
            )
        except Exception as exc:
            last_error = exc
            time.sleep(attempt * 2)
    raise RuntimeError(f"Yahoo Finance monthly download failed: {last_error}")


def classify_status(monthly: pd.DataFrame) -> str | None:
    if monthly.empty:
        return None
    latest = monthly.iloc[-1]
    if bool(latest.get("new")):
        return "NEW"
    if bool(latest.get("condition")):
        return "CONTINUE"
    if bool(latest.get("out")):
        return "OUT"
    return "INACTIVE"


def compact_record(issue: dict[str, str], monthly: pd.DataFrame) -> dict[str, Any] | None:
    if monthly.empty:
        return None
    latest = monthly.iloc[-1]
    rsi = finite(latest.get("monthly_rsi14"))
    average = finite(latest.get("monthly_rsi_ma5"))
    close = finite(latest.get("close"))
    if close is None:
        return None
    return {
        **issue,
        "latest_month": str(monthly.index[-1]),
        "close": round(close, 4),
        "monthly_rsi14": round(rsi, 2) if rsi is not None else None,
        "monthly_rsi_ma5": round(average, 2) if average is not None else None,
        "spread": round(rsi - average, 2) if rsi is not None and average is not None else None,
        "status": classify_status(monthly),
    }


def build_scan(issues: list[dict[str, str]]) -> dict[str, Any]:
    tickers = [issue["ticker"] for issue in issues]
    issue_by_ticker = {issue["ticker"]: issue for issue in issues}
    current_period = pd.Period(pd.Timestamp.now(tz="Asia/Tokyo").strftime("%Y-%m"), freq="M")
    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    batches = list(chunked(tickers, BATCH_SIZE))

    for number, batch_tickers in enumerate(batches, start=1):
        print(f"extended monthly: batch {number}/{len(batches)} ({len(batch_tickers)} symbols)")
        try:
            raw = download_batch(batch_tickers)
        except Exception as exc:
            failures.extend({"ticker": ticker, "reason": str(exc)} for ticker in batch_tickers)
            continue
        for ticker in batch_tickers:
            frame = split_batch_frame(raw, ticker, len(batch_tickers))
            if frame.empty:
                failures.append({"ticker": ticker, "reason": "monthly price data unavailable"})
                continue
            monthly = prepare_monthly_compat(frame, current_period)
            record = compact_record(issue_by_ticker[ticker], monthly)
            if record is None:
                failures.append({"ticker": ticker, "reason": "completed monthly data unavailable"})
            else:
                records.append(record)

    records.sort(key=lambda item: (str(item.get("instrument_type") or ""), str(item.get("code") or "")))
    counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for record in records:
        kind = str(record.get("instrument_type") or "other")
        counts[kind] = counts.get(kind, 0) + 1
        status = str(record.get("status") or "UNKNOWN")
        status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "schema_version": 1,
        "signal_version": SIGNAL_VERSION,
        "scope": "extended",
        "data_level": "monthly_only",
        "source": "JPX all-listed catalog + Yahoo Finance monthly prices",
        "requested": len(issues),
        "covered": len(records),
        "failed": len(failures),
        "coverage_pct": round(len(records) / len(issues) * 100, 1) if issues else 0,
        "batch_size": BATCH_SIZE,
        "batch_count": len(batches),
        "category_counts": counts,
        "status_counts": status_counts,
        "records": records,
        "failures": failures[:100],
    }


def main() -> None:
    issues = load_extended_issues()
    payload = build_scan(issues)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"Extended monthly scan: requested={payload['requested']} covered={payload['covered']} "
        f"failed={payload['failed']} coverage={payload['coverage_pct']}% batches={payload['batch_count']} "
        f"status={payload['status_counts']} categories={payload['category_counts']}"
    )


if __name__ == "__main__":
    main()
