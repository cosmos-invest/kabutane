from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

import pandas as pd


def _stamp(now: datetime | pd.Timestamp | None = None) -> pd.Timestamp:
    stamp = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz="Asia/Tokyo")
    if stamp.tzinfo is not None:
        stamp = stamp.tz_convert("Asia/Tokyo").tz_localize(None)
    return stamp


def _period_label(date: pd.Timestamp, fiscal_year_end_month: int | None) -> int:
    if fiscal_year_end_month is None:
        return int(date.year)
    end_month = int(fiscal_year_end_month)
    return int(date.year) if int(date.month) <= end_month else int(date.year) + 1


def _last_full_period(now: datetime | pd.Timestamp | None, fiscal_year_end_month: int | None) -> int:
    current = _stamp(now)
    if fiscal_year_end_month is None:
        return int(current.year) - 1
    end_month = int(fiscal_year_end_month)
    return int(current.year) if int(current.month) > end_month else int(current.year) - 1


def dividend_event_quality(
    frame: pd.DataFrame | None,
    *,
    fiscal_year_end_month: int | None = None,
    now: datetime | pd.Timestamp | None = None,
    cadence_window: int = 6,
) -> dict[str, Any]:
    """Infer normal dividend-event cadence from recent completed positive periods.

    This is a quality check, not a dividend estimator. It never invents a
    missing payment. If recent completed periods normally contain two (or four)
    actions and an older period contains fewer, that period is considered
    incomplete and its annual total should not be presented as exact.
    """
    if frame is None or frame.empty or "Dividends" not in frame.columns:
        return {"expected_events_per_period": None, "event_counts": {}, "partial_periods": []}

    fiscal_month = int(fiscal_year_end_month) if fiscal_year_end_month and 1 <= int(fiscal_year_end_month) <= 12 else None
    last_full = _last_full_period(now, fiscal_month)
    dividends = pd.to_numeric(frame["Dividends"], errors="coerce").fillna(0.0)
    counts: dict[int, int] = {}
    for date, amount in dividends.items():
        if not pd.notna(amount) or float(amount) == 0.0:
            continue
        stamp = pd.Timestamp(date)
        if stamp.tzinfo is not None:
            stamp = stamp.tz_localize(None)
        period = _period_label(stamp, fiscal_month)
        if period <= last_full:
            counts[period] = counts.get(period, 0) + 1

    positive = [(year, count) for year, count in sorted(counts.items()) if count > 0]
    recent = [count for _, count in positive[-max(3, int(cadence_window or 6)):]]
    if len(recent) < 3:
        expected = None
    else:
        frequencies = Counter(recent)
        top_frequency = max(frequencies.values())
        expected = max(count for count, frequency in frequencies.items() if frequency == top_frequency)

    partial: list[int] = []
    if expected is not None and expected > 1:
        partial = [year for year, count in positive if 0 < count < expected]

    return {
        "expected_events_per_period": expected,
        "event_counts": counts,
        "partial_periods": partial,
    }


def suppress_partial_dividend_periods(
    frame: pd.DataFrame | None,
    *,
    fiscal_year_end_month: int | None = None,
    now: datetime | pd.Timestamp | None = None,
) -> tuple[pd.DataFrame | None, dict[str, Any]]:
    """Remove incomplete-period actions so downstream aggregation yields unknown, not a partial total."""
    quality = dividend_event_quality(
        frame,
        fiscal_year_end_month=fiscal_year_end_month,
        now=now,
    )
    partial = set(quality.get("partial_periods") or [])
    if frame is None or frame.empty or not partial or "Dividends" not in frame.columns:
        return frame, quality

    fiscal_month = int(fiscal_year_end_month) if fiscal_year_end_month and 1 <= int(fiscal_year_end_month) <= 12 else None
    work = frame.copy()
    for date in work.index:
        stamp = pd.Timestamp(date)
        if stamp.tzinfo is not None:
            stamp = stamp.tz_localize(None)
        if _period_label(stamp, fiscal_month) in partial:
            work.at[date, "Dividends"] = 0.0
    return work, quality
