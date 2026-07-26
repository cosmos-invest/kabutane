from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from tradingview_signal import tradingview_rsi

ROOT = Path(__file__).resolve().parent
CHART_DIR = ROOT / "data" / "charts"
OVERLAY_DIR = ROOT / "data" / "daily"


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def rounded(value: Any, digits: int = 2) -> float | None:
    number = finite(value)
    return round(number, digits) if number is not None else None


def rows_by_date(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for rows in groups:
        for row in rows or []:
            date = str(row.get("date") or "")
            if date:
                merged[date] = dict(row)
    return [merged[key] for key in sorted(merged)]


def monthly_closes(rows: list[dict[str, Any]]) -> pd.Series:
    points: list[tuple[pd.Timestamp, float]] = []
    for row in rows or []:
        close = finite(row.get("close"))
        if close is None:
            continue
        try:
            date = pd.Timestamp(row.get("date"))
        except Exception:
            continue
        if pd.isna(date):
            continue
        if date.tzinfo is not None:
            date = date.tz_localize(None)
        points.append((date, close))
    if not points:
        return pd.Series(dtype=float)
    frame = pd.DataFrame(points, columns=["date", "close"]).sort_values("date")
    frame["month"] = frame["date"].dt.to_period("M")
    return frame.groupby("month", sort=True)["close"].last().astype(float)


def calculate_provisional_signal(
    rows: list[dict[str, Any]],
    record: dict[str, Any] | None,
    price_date: str | None = None,
) -> dict[str, Any] | None:
    """Calculate an in-progress monthly RSI estimate from the latest daily close.

    The result is informational only. The official NEW / CONTINUE / OUT status
    remains based on the last completed month stored in ``record.signal_month``.
    """

    closes = monthly_closes(rows)
    if closes.empty:
        return None

    rsi = tradingview_rsi(closes, 14)
    moving_average = rsi.rolling(5, min_periods=5).mean()
    current_period = closes.index[-1]
    current_rsi = finite(rsi.iloc[-1])
    current_ma = finite(moving_average.iloc[-1])
    if current_rsi is None or current_ma is None:
        return None

    confirmed = record or {}
    confirmed_month = str(confirmed.get("signal_month") or "")
    current_month = str(current_period)
    if confirmed_month and current_month <= confirmed_month:
        return None

    confirmed_status = str(confirmed.get("status") or "").upper()
    confirmed_active = confirmed_status in {"NEW", "CONTINUE"}
    provisional_active = current_rsi > current_ma

    if confirmed_active and not provisional_active:
        provisional_status = "DC"
    elif not confirmed_active and provisional_active:
        provisional_status = "GC"
    elif provisional_active:
        provisional_status = "CONTINUE"
    else:
        provisional_status = "OUT"

    latest_date = price_date
    if not latest_date and rows:
        latest_date = str(rows[-1].get("date") or "") or None

    return {
        "month": current_month,
        "price_date": latest_date,
        "monthly_rsi14": rounded(current_rsi),
        "monthly_rsi_ma5": rounded(current_ma),
        "spread": rounded(current_rsi - current_ma),
        "active": provisional_active,
        "status": provisional_status,
        "changed_from_confirmed": provisional_active != confirmed_active,
        "confirmed_month": confirmed_month or None,
        "confirmed_status": confirmed_status or None,
        "source": "latest_daily_close",
        "is_provisional": True,
    }


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json_if_changed(path: Path, payload: Any) -> bool:
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def update_overlay(path: Path, generated_at: str) -> bool:
    overlay = read_json(path, {})
    code = str(overlay.get("code") or path.stem)
    chart = read_json(CHART_DIR / f"{code}.json", {})
    base_rows = list(chart.get("daily") or [])
    overlay_rows = list(overlay.get("daily") or [])
    rows = rows_by_date(base_rows, overlay_rows)
    record = {**(chart.get("record") or {}), **(overlay.get("record") or {})}
    provisional = calculate_provisional_signal(rows, record, overlay.get("price_date"))

    if provisional is None:
        if "provisional_signal" not in overlay:
            return False
        overlay.pop("provisional_signal", None)
    else:
        overlay["provisional_signal"] = provisional
    overlay["provisional_generated_at"] = generated_at
    return write_json_if_changed(path, overlay)


def main() -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    updated = 0
    processed = 0
    for path in sorted(OVERLAY_DIR.glob("*.json")):
        processed += 1
        if update_overlay(path, generated_at):
            updated += 1
    print(f"Provisional monthly signals updated: processed={processed}, changed={updated}")


if __name__ == "__main__":
    main()
