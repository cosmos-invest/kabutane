from __future__ import annotations

import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

import test as pipeline

ROOT = Path(__file__).resolve().parent
LATEST_FILE = ROOT / "data" / "latest.json"
CHART_DIR = ROOT / "data" / "charts"
OVERLAY_DIR = ROOT / "data" / "daily"
STATUS_FILE = ROOT / "data" / "daily-update-status.json"
RESULT_FILE = ROOT / "result.csv"

BATCH_SIZE = int(os.getenv("DAILY_YF_BATCH_SIZE", "80"))
DOWNLOAD_PERIOD = os.getenv("DAILY_DOWNLOAD_PERIOD", "1mo")


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json_if_changed(path: Path, payload: Any) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(pipeline.json_safe(payload), ensure_ascii=False, indent=2) + "\n"
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def rows_by_date(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for rows in groups:
        for row in rows or []:
            date = str(row.get("date") or "")
            if date:
                merged[date] = dict(row)
    return [merged[key] for key in sorted(merged)]


def rows_to_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    frame = pd.DataFrame(
        {
            "Open": [row.get("open") for row in rows],
            "High": [row.get("high") for row in rows],
            "Low": [row.get("low") for row in rows],
            "Close": [row.get("close") for row in rows],
            "Volume": [row.get("volume") for row in rows],
        },
        index=pd.to_datetime([row.get("date") for row in rows], errors="coerce"),
    )
    frame = frame[~frame.index.isna()].sort_index()
    for column in frame.columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def combine_frames(existing: pd.DataFrame, downloaded: pd.DataFrame) -> pd.DataFrame:
    frames = [frame for frame in (existing, downloaded) if frame is not None and not frame.empty]
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames).sort_index()
    combined = combined[~combined.index.duplicated(keep="last")]
    if getattr(combined.index, "tz", None) is not None:
        combined.index = combined.index.tz_localize(None)
    return combined


def latest_rsi_values(rows: list[dict[str, Any]]) -> tuple[float | None, float | None]:
    for row in reversed(rows):
        rsi14 = pipeline.to_float(row.get("rsi14"))
        rsi5 = pipeline.to_float(row.get("rsi5"))
        if rsi14 is not None or rsi5 is not None:
            return rsi14, rsi5
    return None, None


def build_overlay_rows(
    combined: pd.DataFrame,
    base_last_date: str,
    rsi14: float | None,
    rsi5: float | None,
) -> list[dict[str, Any]]:
    if combined.empty:
        return []
    analysis = pipeline.prepare_daily_analysis(combined)
    cutoff = pd.Timestamp(base_last_date) if base_last_date else combined.index.min()
    output: list[dict[str, Any]] = []
    for date, row in combined.loc[combined.index >= cutoff].iterrows():
        close = pipeline.to_float(row.get("Close"))
        if close is None:
            continue
        metric = analysis.loc[date] if date in analysis.index else pd.Series(dtype=float)
        output.append(
            {
                "date": date.strftime("%Y-%m-%d"),
                "open": pipeline.rounded(row.get("Open")),
                "high": pipeline.rounded(row.get("High")),
                "low": pipeline.rounded(row.get("Low")),
                "close": pipeline.rounded(close),
                "volume": pipeline.rounded(row.get("Volume"), 0),
                "sma25": pipeline.rounded(metric.get("sma25")),
                "sma75": pipeline.rounded(metric.get("sma75")),
                "sma200": pipeline.rounded(metric.get("sma200")),
                "rsi14": pipeline.rounded(rsi14),
                "rsi5": pipeline.rounded(rsi5),
            }
        )
    return output


def update_record_price(record: dict[str, Any], price: float) -> dict[str, Any]:
    updated = dict(record)
    updated["current_price"] = pipeline.rounded(price)
    gc_price = pipeline.to_float(updated.get("gc_price"))
    signal_close = pipeline.to_float(updated.get("signal_month_close"))
    updated["return_since_gc_pct"] = pipeline.rounded((price / gc_price - 1) * 100) if gc_price else None
    updated["change_from_signal_month_pct"] = (
        pipeline.rounded((price / signal_close - 1) * 100) if signal_close else None
    )
    return updated


def dividend_split_events(frame: pd.DataFrame, cutoff: str) -> list[dict[str, Any]]:
    if frame is None or frame.empty:
        return []
    cutoff_ts = pd.Timestamp(cutoff) if cutoff else frame.index.min()
    events: list[dict[str, Any]] = []
    for date, row in frame.loc[frame.index >= cutoff_ts].iterrows():
        dividend = pipeline.to_float(row.get("Dividends"))
        split = pipeline.to_float(row.get("Stock Splits"))
        if dividend not in (None, 0):
            events.append(
                {
                    "date": date.strftime("%Y-%m-%d"),
                    "type": "DIVIDEND",
                    "label": "配当",
                    "detail": f"1株 {dividend:g}円",
                }
            )
        if split not in (None, 0):
            events.append(
                {
                    "date": date.strftime("%Y-%m-%d"),
                    "type": "SPLIT",
                    "label": "株式分割・併合",
                    "detail": f"比率 {split:g}",
                }
            )
    return events


def update_result_csv(records: list[dict[str, Any]]) -> bool:
    if not RESULT_FILE.exists():
        return False
    with RESULT_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    if not fields:
        return False
    by_code = {str(record.get("code")): record for record in records}
    changed = False
    for row in rows:
        record = by_code.get(str(row.get("code")))
        if not record:
            continue
        for key in ("current_price", "change_from_signal_month_pct", "return_since_gc_pct"):
            if key not in fields:
                continue
            value = record.get(key)
            text = "" if value is None else str(value)
            if row.get(key, "") != text:
                row[key] = text
                changed = True
    if not changed:
        return False
    with RESULT_FILE.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return True


def main() -> None:
    latest = read_json(LATEST_FILE, {})
    records = list(latest.get("records") or [])
    if not records:
        raise RuntimeError("data/latest.json に日次更新対象がありません。")

    target_records = [record for record in records if record.get("ticker") and record.get("code")]
    tickers = [str(record["ticker"]) for record in target_records]
    errors: list[dict[str, Any]] = []

    previous_batch_size = pipeline.BATCH_SIZE
    pipeline.BATCH_SIZE = BATCH_SIZE
    try:
        downloaded = pipeline.download_frames(
            tickers,
            period=DOWNLOAD_PERIOD,
            interval="1d",
            errors=errors,
            stage="daily_incremental",
        )
    finally:
        pipeline.BATCH_SIZE = previous_batch_size

    now = datetime.now(timezone.utc).isoformat()
    updated_records: list[dict[str, Any]] = []
    updated_count = 0
    latest_price_date: str | None = None

    for record in records:
        code = str(record.get("code") or "")
        ticker = str(record.get("ticker") or "")
        chart_path = CHART_DIR / f"{code}.json"
        chart = read_json(chart_path, {})
        base_rows = list(chart.get("daily") or [])
        if not code or not ticker or not base_rows:
            updated_records.append(record)
            continue

        overlay_path = OVERLAY_DIR / f"{code}.json"
        existing_overlay = read_json(overlay_path, {})
        overlay_rows = list(existing_overlay.get("daily") or [])
        all_existing_rows = rows_by_date(base_rows, overlay_rows)
        existing_frame = rows_to_frame(all_existing_rows)
        new_frame = downloaded.get(ticker, pd.DataFrame())
        combined = combine_frames(existing_frame, new_frame)
        if combined.empty:
            updated_records.append(record)
            continue

        rsi14, rsi5 = latest_rsi_values(all_existing_rows)
        base_last_date = str(base_rows[-1].get("date") or "")
        daily_rows = build_overlay_rows(combined, base_last_date, rsi14, rsi5)
        if not daily_rows:
            updated_records.append(record)
            continue

        last_price = pipeline.to_float(daily_rows[-1].get("close"))
        if last_price is None:
            updated_records.append(record)
            continue
        updated_record = update_record_price(record, last_price)
        price_date = str(daily_rows[-1]["date"])
        latest_price_date = max(latest_price_date or price_date, price_date)
        overlay = {
            "code": code,
            "ticker": ticker,
            "name": record.get("name") or code,
            "generated_at": now,
            "price_date": price_date,
            "record": {
                "current_price": updated_record.get("current_price"),
                "change_from_signal_month_pct": updated_record.get("change_from_signal_month_pct"),
                "return_since_gc_pct": updated_record.get("return_since_gc_pct"),
            },
            "daily": daily_rows,
            "corporate_events": dividend_split_events(new_frame, base_last_date),
        }
        if write_json_if_changed(overlay_path, overlay):
            updated_count += 1
        updated_records.append(updated_record)

    latest["records"] = updated_records
    latest["daily_generated_at"] = now
    latest["daily_price_date"] = latest_price_date
    write_json_if_changed(LATEST_FILE, latest)
    csv_changed = update_result_csv(updated_records)
    status = {
        "generated_at": now,
        "price_date": latest_price_date,
        "target_count": len(target_records),
        "downloaded_count": len(downloaded),
        "overlay_updated_count": updated_count,
        "result_csv_updated": csv_changed,
        "error_count": len(errors),
        "errors": errors[:100],
        "source": "Yahoo Finance via yfinance",
        "cost_policy": "paid_api_disabled",
    }
    write_json_if_changed(STATUS_FILE, status)
    print(
        f"Daily update complete: targets={len(target_records)}, downloaded={len(downloaded)}, "
        f"overlays={updated_count}, errors={len(errors)}, price_date={latest_price_date}"
    )


if __name__ == "__main__":
    main()
