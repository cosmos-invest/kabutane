from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import pandas as pd

BASIS = "calendar_year_ex_date"
SOURCE = "Yahoo Finance via yfinance"
DEFAULT_MAX_YEARS = 50


def _finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _round(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _current_year(now: datetime | pd.Timestamp | None = None) -> int:
    stamp = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz="Asia/Tokyo")
    return int(stamp.year)


def _comparison(previous: float, current: float) -> str:
    tolerance = max(0.01, abs(previous) * 0.001)
    change = current - previous
    if change > tolerance:
        return "increase"
    if change < -tolerance:
        return "cut"
    return "flat"


def _cagr(history: list[dict[str, Any]], years: int) -> float | None:
    if len(history) < years:
        return None
    window = history[-years:]
    first = _finite(window[0].get("annual_dividend"))
    last = _finite(window[-1].get("annual_dividend"))
    intervals = len(window) - 1
    if first is None or last is None or first <= 0 or last < 0 or intervals <= 0:
        return None
    if last == 0:
        return -100.0
    return _round(((last / first) ** (1 / intervals) - 1) * 100)


def _trim_to_ticker_observation(frame: pd.DataFrame) -> pd.DataFrame:
    """Remove batch-union rows where this ticker has no actual observation."""
    if frame is None or frame.empty:
        return pd.DataFrame()

    work = frame.copy()
    work.index = pd.to_datetime(work.index, errors="coerce")
    work = work[~work.index.isna()].sort_index()
    if work.empty:
        return work
    if getattr(work.index, "tz", None) is not None:
        work.index = work.index.tz_localize(None)

    close = (
        pd.to_numeric(work["Close"], errors="coerce")
        if "Close" in work.columns
        else pd.Series(float("nan"), index=work.index)
    )
    dividends = (
        pd.to_numeric(work["Dividends"], errors="coerce")
        if "Dividends" in work.columns
        else pd.Series(float("nan"), index=work.index)
    )
    splits = (
        pd.to_numeric(work["Stock Splits"], errors="coerce")
        if "Stock Splits" in work.columns
        else pd.Series(float("nan"), index=work.index)
    )
    observed = close.notna() | dividends.fillna(0.0).ne(0.0) | splits.fillna(0.0).ne(0.0)
    if not bool(observed.any()):
        return work.iloc[0:0].copy()
    first = observed[observed].index[0]
    last = observed[observed].index[-1]
    return work.loc[first:last].copy()


def apply_verified_streak(
    summary: dict[str, Any],
    override: dict[str, Any] | None,
) -> dict[str, Any]:
    """Prefer an official fiscal-year streak when a current verified override exists."""
    result = dict(summary)
    observed = int(result.get("consecutive_increase_years") or 0)
    result["observed_consecutive_increase_years"] = observed
    result.setdefault("streak_basis", BASIS)
    result.setdefault("streak_source", SOURCE)
    result.setdefault("streak_source_url", None)
    result.setdefault("streak_as_of_year", result.get("history_end_year"))
    result["streak_verified"] = False

    if not isinstance(override, dict):
        return result

    verified_years = int(override.get("consecutive_increase_years") or 0)
    as_of_year = int(override.get("as_of_year") or 0)
    history_end_year = int(result.get("history_end_year") or 0)
    if verified_years <= 0 or as_of_year <= 0 or history_end_year > as_of_year:
        return result

    result["consecutive_increase_years"] = verified_years
    result["streak_basis"] = str(override.get("basis") or "company_official_fiscal_year")
    result["streak_source"] = str(override.get("source") or "company official")
    result["streak_source_url"] = override.get("source_url")
    result["streak_as_of_year"] = as_of_year
    result["streak_verified"] = True
    return result


def build_dividend_history(
    frame: pd.DataFrame,
    *,
    now: datetime | pd.Timestamp | None = None,
    max_years: int = DEFAULT_MAX_YEARS,
) -> dict[str, Any]:
    """Summarize completed calendar-year dividends from Yahoo actions.

    Yahoo's dividend actions are already adjusted for stock splits. We therefore
    aggregate them as returned and do not apply Stock Splits a second time.
    The current partial calendar year is excluded. Only the most recent
    ``max_years`` complete calendar years are retained.
    """
    max_years = max(2, int(max_years or DEFAULT_MAX_YEARS))
    empty = {
        "basis": BASIS,
        "source": SOURCE,
        "history_max_years": max_years,
        "history_start_year": None,
        "history_end_year": None,
        "observation_years": 0,
        "consecutive_increase_years": 0,
        "observed_consecutive_increase_years": 0,
        "streak_basis": BASIS,
        "streak_source": SOURCE,
        "streak_source_url": None,
        "streak_as_of_year": None,
        "streak_verified": False,
        "increase_count_5y": 0,
        "cut_count_5y": 0,
        "flat_count_5y": 0,
        "no_cut_5y": False,
        "cagr_3y_pct": None,
        "cagr_5y_pct": None,
        "latest_change_pct": None,
        "latest_annual_dividend": None,
        "max_cut_pct_5y": None,
        "history": [],
    }
    if frame is None or frame.empty or "Dividends" not in frame.columns:
        return empty

    work = _trim_to_ticker_observation(frame)
    if work.empty:
        return empty

    dividends = pd.to_numeric(work.get("Dividends"), errors="coerce").fillna(0.0)
    dividend_events: list[tuple[pd.Timestamp, float]] = []
    for date, amount in dividends.items():
        value = _finite(amount)
        if value in (None, 0):
            continue
        dividend_events.append((pd.Timestamp(date), float(value)))

    current_year = _current_year(now)
    first_date = pd.Timestamp(work.index.min())
    first_full_year = (
        int(first_date.year)
        if (first_date.month == 1 and first_date.day <= 15)
        else int(first_date.year) + 1
    )
    last_full_year = current_year - 1
    if first_full_year > last_full_year:
        return empty

    capped_first_year = max(first_full_year, last_full_year - max_years + 1)
    annual_totals = {
        year: 0.0 for year in range(capped_first_year, last_full_year + 1)
    }
    for date, amount in dividend_events:
        if date.year in annual_totals:
            annual_totals[date.year] += amount

    history = [
        {"year": year, "annual_dividend": _round(total, 4)}
        for year, total in annual_totals.items()
    ]
    history_start_year = history[0]["year"] if history else None
    history_end_year = history[-1]["year"] if history else None

    if not history or not any(
        (_finite(row["annual_dividend"]) or 0) > 0 for row in history
    ):
        return {
            **empty,
            "history_start_year": history_start_year,
            "history_end_year": history_end_year,
            "observation_years": len(history),
            "streak_as_of_year": history_end_year,
            "history": history,
        }

    comparisons: list[dict[str, Any]] = []
    for previous, current in zip(history, history[1:]):
        prev_value = float(previous["annual_dividend"] or 0)
        curr_value = float(current["annual_dividend"] or 0)
        kind = _comparison(prev_value, curr_value)
        change_pct = (
            ((curr_value / prev_value) - 1) * 100
            if prev_value > 0
            else (100.0 if curr_value > 0 else 0.0)
        )
        comparisons.append(
            {"year": current["year"], "type": kind, "change_pct": _round(change_pct)}
        )

    streak = 0
    for item in reversed(comparisons):
        if item["type"] != "increase":
            break
        streak += 1

    window_history = history[-5:]
    window_years = {row["year"] for row in window_history}
    window_comparisons = [
        item for item in comparisons if item["year"] in window_years
    ]
    increase_count = sum(item["type"] == "increase" for item in window_comparisons)
    cut_items = [item for item in window_comparisons if item["type"] == "cut"]
    cut_count = len(cut_items)
    flat_count = sum(item["type"] == "flat" for item in window_comparisons)

    latest = float(history[-1]["annual_dividend"] or 0)
    previous = (
        float(history[-2]["annual_dividend"] or 0) if len(history) >= 2 else None
    )
    latest_change = (
        ((latest / previous) - 1) * 100 if previous and previous > 0 else None
    )

    return {
        "basis": BASIS,
        "source": SOURCE,
        "history_max_years": max_years,
        "history_start_year": history_start_year,
        "history_end_year": history_end_year,
        "observation_years": len(history),
        "consecutive_increase_years": streak,
        "observed_consecutive_increase_years": streak,
        "streak_basis": BASIS,
        "streak_source": SOURCE,
        "streak_source_url": None,
        "streak_as_of_year": history_end_year,
        "streak_verified": False,
        "increase_count_5y": increase_count,
        "cut_count_5y": cut_count,
        "flat_count_5y": flat_count,
        "no_cut_5y": len(window_history) >= 5 and cut_count == 0,
        "cagr_3y_pct": _cagr(history, 3),
        "cagr_5y_pct": _cagr(history, 5),
        "latest_change_pct": _round(latest_change),
        "latest_annual_dividend": _round(latest, 4),
        "max_cut_pct_5y": min(
            (
                item["change_pct"]
                for item in cut_items
                if item.get("change_pct") is not None
            ),
            default=None,
        ),
        "history": history,
    }


def public_dividend_fields(summary: dict[str, Any]) -> dict[str, Any]:
    """Compact fields safe to publish in the general all-stock catalog."""
    return {
        "dividend_observation_years": summary.get("observation_years"),
        "dividend_history_start_year": summary.get("history_start_year"),
        "dividend_history_end_year": summary.get("history_end_year"),
        "consecutive_dividend_increase_years": summary.get(
            "consecutive_increase_years"
        ),
        "observed_consecutive_dividend_increase_years": summary.get(
            "observed_consecutive_increase_years"
        ),
        "dividend_streak_basis": summary.get("streak_basis"),
        "dividend_streak_verified": summary.get("streak_verified"),
        "dividend_streak_as_of_year": summary.get("streak_as_of_year"),
        "dividend_increase_count_5y": summary.get("increase_count_5y"),
        "dividend_cut_count_5y": summary.get("cut_count_5y"),
        "dividend_flat_count_5y": summary.get("flat_count_5y"),
        "dividend_no_cut_5y": summary.get("no_cut_5y"),
        "dividend_cagr_3y_pct": summary.get("cagr_3y_pct"),
        "dividend_cagr_5y_pct": summary.get("cagr_5y_pct"),
        "dividend_latest_change_pct": summary.get("latest_change_pct"),
        "dividend_latest_annual": summary.get("latest_annual_dividend"),
    }
