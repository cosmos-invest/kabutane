from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import pandas as pd

CALENDAR_BASIS = "calendar_year_ex_date"
FISCAL_BASIS = "fiscal_year_ex_date"
BASIS = CALENDAR_BASIS
SOURCE = "Yahoo Finance corporate actions via yfinance"
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


def _stamp(now: datetime | pd.Timestamp | None = None) -> pd.Timestamp:
    stamp = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz="Asia/Tokyo")
    if stamp.tzinfo is not None:
        stamp = stamp.tz_convert("Asia/Tokyo").tz_localize(None)
    return stamp


def _comparison(previous: float | None, current: float | None) -> str:
    """Compare annual dividends without counting a first/resumed dividend as an increase."""
    if previous is None or current is None:
        return "unknown"
    previous = float(previous)
    current = float(current)
    tolerance = max(0.01, abs(previous) * 0.001)
    if previous <= tolerance:
        return "start" if current > tolerance else "flat"
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
    values = [_finite(row.get("annual_dividend")) for row in window]
    if any(value is None for value in values):
        return None
    first = values[0]
    last = values[-1]
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
    close = pd.to_numeric(work["Close"], errors="coerce") if "Close" in work.columns else pd.Series(float("nan"), index=work.index)
    dividends = pd.to_numeric(work["Dividends"], errors="coerce") if "Dividends" in work.columns else pd.Series(float("nan"), index=work.index)
    splits = pd.to_numeric(work["Stock Splits"], errors="coerce") if "Stock Splits" in work.columns else pd.Series(float("nan"), index=work.index)
    observed = close.notna() | dividends.fillna(0.0).ne(0.0) | splits.fillna(0.0).ne(0.0)
    if not bool(observed.any()):
        return work.iloc[0:0].copy()
    first = observed[observed].index[0]
    last = observed[observed].index[-1]
    return work.loc[first:last].copy()


def _period_label(date: pd.Timestamp, fiscal_year_end_month: int | None) -> int:
    if fiscal_year_end_month is None:
        return int(date.year)
    end_month = int(fiscal_year_end_month)
    return int(date.year) if int(date.month) <= end_month else int(date.year) + 1


def _period_bounds(
    first_date: pd.Timestamp,
    now: datetime | pd.Timestamp | None,
    fiscal_year_end_month: int | None,
) -> tuple[int, int]:
    current = _stamp(now)
    if fiscal_year_end_month is None:
        first_full = int(first_date.year) if (first_date.month == 1 and first_date.day <= 15) else int(first_date.year) + 1
        return first_full, int(current.year) - 1

    end_month = int(fiscal_year_end_month)
    start_month = end_month % 12 + 1
    first_label = _period_label(first_date, end_month)
    first_full = first_label if (int(first_date.month) == start_month and int(first_date.day) <= 15) else first_label + 1
    last_full = int(current.year) if int(current.month) > end_month else int(current.year) - 1
    return first_full, last_full


def _empty_summary(max_years: int, fiscal_year_end_month: int | None) -> dict[str, Any]:
    basis = FISCAL_BASIS if fiscal_year_end_month else CALENDAR_BASIS
    return {
        "basis": basis,
        "source": SOURCE,
        "history_max_years": max_years,
        "history_start_year": None,
        "history_end_year": None,
        "observation_years": 0,
        "observed_dividend_years": 0,
        "unknown_year_count": 0,
        "history_has_gaps": False,
        "fiscal_year_end_month": fiscal_year_end_month,
        "consecutive_increase_years": 0,
        "observed_consecutive_increase_years": 0,
        "streak_basis": basis,
        "streak_source": SOURCE,
        "streak_source_url": None,
        "streak_as_of_year": None,
        "streak_verified": False,
        "streak_lower_bound": False,
        "streak_status": "observed",
        "streak_anchor_as_of_year": None,
        "streak_extension_years": 0,
        "streak_review_required": False,
        "increase_count_5y": 0,
        "cut_count_5y": 0,
        "flat_count_5y": 0,
        "unknown_count_5y": 0,
        "no_cut_5y": False,
        "cagr_3y_pct": None,
        "cagr_5y_pct": None,
        "latest_change_pct": None,
        "latest_annual_dividend": None,
        "max_cut_pct_5y": None,
        "history": [],
    }


def _set_verified_anchor(
    result: dict[str, Any],
    *,
    verified_years: int,
    as_of_year: int,
    override: dict[str, Any],
) -> None:
    result["consecutive_increase_years"] = verified_years
    result["streak_basis"] = str(override.get("basis") or "company_official_fiscal_year")
    result["streak_source"] = str(override.get("source") or "company official")
    result["streak_source_url"] = override.get("source_url")
    result["streak_as_of_year"] = as_of_year
    result["streak_verified"] = True
    result["streak_lower_bound"] = False
    result["streak_status"] = "verified"
    result["streak_anchor_as_of_year"] = as_of_year
    result["streak_extension_years"] = 0
    result["streak_review_required"] = False


def apply_verified_streak(summary: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    """Use company IR as an anchor and extend it with later completed fiscal years.

    A verified count is no longer discarded merely because a new fiscal year
    arrives. If every completed post-anchor year is observed and increased, the
    streak extends automatically. Unknown data never becomes a fabricated zero.
    """
    result = dict(summary)
    observed = int(result.get("consecutive_increase_years") or 0)
    result["observed_consecutive_increase_years"] = observed
    result.setdefault("streak_basis", result.get("basis") or BASIS)
    result.setdefault("streak_source", SOURCE)
    result.setdefault("streak_source_url", None)
    result.setdefault("streak_as_of_year", result.get("history_end_year"))
    result.setdefault("streak_lower_bound", False)
    result.setdefault("streak_status", "observed")
    result.setdefault("streak_anchor_as_of_year", None)
    result.setdefault("streak_extension_years", 0)
    result.setdefault("streak_review_required", False)
    result["streak_verified"] = False

    if not isinstance(override, dict):
        return result
    verified_years = int(override.get("consecutive_increase_years") or 0)
    as_of_year = int(override.get("as_of_year") or 0)
    if verified_years <= 0 or as_of_year <= 0:
        return result

    _set_verified_anchor(result, verified_years=verified_years, as_of_year=as_of_year, override=override)
    history_end_year = int(result.get("history_end_year") or 0)
    if history_end_year <= as_of_year:
        return result

    history = {
        int(row.get("year") or 0): _finite(row.get("annual_dividend"))
        for row in (result.get("history") or [])
        if isinstance(row, dict) and int(row.get("year") or 0) > 0
    }
    previous = history.get(as_of_year)
    if previous is None:
        result["streak_status"] = "verified_anchor_pending"
        result["streak_review_required"] = True
        return result

    extension = 0
    last_confirmed_year = as_of_year
    for year in range(as_of_year + 1, history_end_year + 1):
        current = history.get(year)
        kind = _comparison(previous, current)
        if kind == "increase":
            extension += 1
            last_confirmed_year = year
            previous = current
            continue
        if kind == "unknown":
            result["consecutive_increase_years"] = verified_years + extension
            result["streak_as_of_year"] = last_confirmed_year
            result["streak_extension_years"] = extension
            result["streak_status"] = "verified_anchor_pending"
            result["streak_review_required"] = True
            if extension:
                result["streak_basis"] = "company_official_fiscal_year_extended"
                result["streak_source"] = f"{override.get('source') or 'company official'}; post-anchor increases confirmed from Yahoo Finance"
            return result

        # A known flat/cut/start after the official anchor breaks the current
        # run. Preserve anchor provenance, but do not present the old count as current.
        result["consecutive_increase_years"] = observed
        result["streak_verified"] = False
        result["streak_as_of_year"] = history_end_year
        result["streak_status"] = "anchor_break_needs_review"
        result["streak_review_required"] = True
        result["streak_anchor_as_of_year"] = as_of_year
        result["streak_extension_years"] = extension
        result["streak_source"] = f"{override.get('source') or 'company official'}; post-anchor Yahoo Finance history requires re-verification"
        return result

    if extension:
        result["consecutive_increase_years"] = verified_years + extension
        result["streak_basis"] = "company_official_fiscal_year_extended"
        result["streak_source"] = f"{override.get('source') or 'company official'}; post-anchor increases confirmed from Yahoo Finance"
        result["streak_as_of_year"] = last_confirmed_year
        result["streak_extension_years"] = extension
        result["streak_status"] = "verified_extended"
    return result


def build_dividend_history(
    frame: pd.DataFrame,
    *,
    now: datetime | pd.Timestamp | None = None,
    max_years: int = DEFAULT_MAX_YEARS,
    fiscal_year_end_month: int | None = None,
    known_zero_years: set[int] | None = None,
) -> dict[str, Any]:
    """Summarize completed dividend periods without inventing missing dividends.

    Yahoo corporate-action events are split-adjusted. With an EDINET fiscal-end
    month they are grouped into company fiscal years. A full year with no event
    is represented as unknown (annual_dividend=None), not zero, unless the caller
    explicitly supplies known_zero_years.
    """
    max_years = max(2, int(max_years or DEFAULT_MAX_YEARS))
    fiscal_month = int(fiscal_year_end_month) if fiscal_year_end_month and 1 <= int(fiscal_year_end_month) <= 12 else None
    empty = _empty_summary(max_years, fiscal_month)
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

    first_full_year, last_full_year = _period_bounds(pd.Timestamp(work.index.min()), now, fiscal_month)
    if first_full_year > last_full_year:
        return empty
    capped_first_year = max(first_full_year, last_full_year - max_years + 1)
    annual_totals: dict[int, float | None] = {year: None for year in range(capped_first_year, last_full_year + 1)}
    for date, amount in dividend_events:
        label = _period_label(date, fiscal_month)
        if label not in annual_totals:
            continue
        if annual_totals[label] is None:
            annual_totals[label] = 0.0
        annual_totals[label] = float(annual_totals[label] or 0.0) + amount

    for year in known_zero_years or set():
        if year in annual_totals and annual_totals[year] is None:
            annual_totals[year] = 0.0

    history = [
        {"year": year, "annual_dividend": _round(total, 4) if total is not None else None}
        for year, total in annual_totals.items()
    ]
    history_start_year = history[0]["year"] if history else None
    history_end_year = history[-1]["year"] if history else None
    observed_dividend_years = sum(_finite(row.get("annual_dividend")) is not None for row in history)
    unknown_year_count = len(history) - observed_dividend_years

    if not history or not any((_finite(row.get("annual_dividend")) or 0) > 0 for row in history):
        return {
            **empty,
            "history_start_year": history_start_year,
            "history_end_year": history_end_year,
            "observation_years": len(history),
            "observed_dividend_years": observed_dividend_years,
            "unknown_year_count": unknown_year_count,
            "history_has_gaps": unknown_year_count > 0,
            "streak_as_of_year": history_end_year,
            "history": history,
        }

    comparisons: list[dict[str, Any]] = []
    for previous_row, current_row in zip(history, history[1:]):
        previous = _finite(previous_row.get("annual_dividend"))
        current = _finite(current_row.get("annual_dividend"))
        kind = _comparison(previous, current)
        change_pct = None
        if kind in {"increase", "cut", "flat"} and previous is not None and previous > 0 and current is not None:
            change_pct = ((current / previous) - 1) * 100
        comparisons.append({"year": current_row["year"], "type": kind, "change_pct": _round(change_pct)})

    streak = 0
    boundary_type: str | None = None
    for item in reversed(comparisons):
        if item["type"] != "increase":
            boundary_type = str(item["type"])
            break
        streak += 1
    streak_lower_bound = bool(streak > 0 and (boundary_type is None or boundary_type == "unknown"))

    window_history = history[-5:]
    window_years = {row["year"] for row in window_history}
    window_comparisons = [item for item in comparisons if item["year"] in window_years]
    increase_count = sum(item["type"] == "increase" for item in window_comparisons)
    cut_items = [item for item in window_comparisons if item["type"] == "cut"]
    cut_count = len(cut_items)
    flat_count = sum(item["type"] == "flat" for item in window_comparisons)
    unknown_count = sum(item["type"] == "unknown" for item in window_comparisons)
    complete_window = len(window_history) >= 5 and all(_finite(row.get("annual_dividend")) is not None for row in window_history)

    latest = _finite(history[-1].get("annual_dividend"))
    previous = _finite(history[-2].get("annual_dividend")) if len(history) >= 2 else None
    latest_change = ((latest / previous) - 1) * 100 if latest is not None and previous is not None and previous > 0 else None
    basis = FISCAL_BASIS if fiscal_month else CALENDAR_BASIS

    return {
        "basis": basis,
        "source": SOURCE,
        "history_max_years": max_years,
        "history_start_year": history_start_year,
        "history_end_year": history_end_year,
        "observation_years": len(history),
        "observed_dividend_years": observed_dividend_years,
        "unknown_year_count": unknown_year_count,
        "history_has_gaps": unknown_year_count > 0,
        "fiscal_year_end_month": fiscal_month,
        "consecutive_increase_years": streak,
        "observed_consecutive_increase_years": streak,
        "streak_basis": basis,
        "streak_source": SOURCE,
        "streak_source_url": None,
        "streak_as_of_year": history_end_year,
        "streak_verified": False,
        "streak_lower_bound": streak_lower_bound,
        "streak_status": "observed_lower_bound" if streak_lower_bound else "observed",
        "streak_anchor_as_of_year": None,
        "streak_extension_years": 0,
        "streak_review_required": False,
        "increase_count_5y": increase_count,
        "cut_count_5y": cut_count,
        "flat_count_5y": flat_count,
        "unknown_count_5y": unknown_count,
        "no_cut_5y": complete_window and cut_count == 0,
        "cagr_3y_pct": _cagr(history, 3),
        "cagr_5y_pct": _cagr(history, 5),
        "latest_change_pct": _round(latest_change),
        "latest_annual_dividend": _round(latest, 4),
        "max_cut_pct_5y": min((item["change_pct"] for item in cut_items if item.get("change_pct") is not None), default=None),
        "history": history,
    }


def public_dividend_fields(summary: dict[str, Any]) -> dict[str, Any]:
    """Compact fields safe to publish in the general all-stock catalog."""
    return {
        "dividend_observation_years": summary.get("observation_years"),
        "dividend_observed_dividend_years": summary.get("observed_dividend_years"),
        "dividend_unknown_year_count": summary.get("unknown_year_count"),
        "dividend_history_has_gaps": summary.get("history_has_gaps"),
        "dividend_history_start_year": summary.get("history_start_year"),
        "dividend_history_end_year": summary.get("history_end_year"),
        "dividend_fiscal_year_end_month": summary.get("fiscal_year_end_month"),
        "consecutive_dividend_increase_years": summary.get("consecutive_increase_years"),
        "observed_consecutive_dividend_increase_years": summary.get("observed_consecutive_increase_years"),
        "dividend_streak_basis": summary.get("streak_basis"),
        "dividend_streak_verified": summary.get("streak_verified"),
        "dividend_streak_as_of_year": summary.get("streak_as_of_year"),
        "dividend_streak_lower_bound": summary.get("streak_lower_bound"),
        "dividend_streak_status": summary.get("streak_status"),
        "dividend_streak_anchor_as_of_year": summary.get("streak_anchor_as_of_year"),
        "dividend_streak_extension_years": summary.get("streak_extension_years"),
        "dividend_streak_review_required": summary.get("streak_review_required"),
        "dividend_increase_count_5y": summary.get("increase_count_5y"),
        "dividend_cut_count_5y": summary.get("cut_count_5y"),
        "dividend_flat_count_5y": summary.get("flat_count_5y"),
        "dividend_unknown_count_5y": summary.get("unknown_count_5y"),
        "dividend_no_cut_5y": summary.get("no_cut_5y"),
        "dividend_cagr_3y_pct": summary.get("cagr_3y_pct"),
        "dividend_cagr_5y_pct": summary.get("cagr_5y_pct"),
        "dividend_latest_change_pct": summary.get("latest_change_pct"),
        "dividend_latest_annual": summary.get("latest_annual_dividend"),
    }
