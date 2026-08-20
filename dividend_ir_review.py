from __future__ import annotations

import math
from collections import Counter
from typing import Any


SCHEMA_VERSION = 1
MIN_OBSERVED_STREAK = 5


def _finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _comparison(previous: float | None, current: float | None) -> str:
    if previous is None or current is None:
        return "unknown"
    tolerance = max(0.01, abs(previous) * 0.001)
    if previous <= tolerance:
        return "start" if current > tolerance else "flat"
    change = current - previous
    if change > tolerance:
        return "increase"
    if change < -tolerance:
        return "cut"
    return "flat"


def _history(summary: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for row in summary.get("history") or []:
        if not isinstance(row, dict):
            continue
        try:
            year = int(row.get("year") or 0)
        except (TypeError, ValueError):
            continue
        if year <= 0:
            continue
        rows.append({"year": year, "annual_dividend": _finite(row.get("annual_dividend"))})
    rows.sort(key=lambda item: item["year"])
    return rows


def _comparisons(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for previous, current in zip(history, history[1:]):
        result.append(
            {
                "year": int(current["year"]),
                "type": _comparison(previous.get("annual_dividend"), current.get("annual_dividend")),
            }
        )
    return result


def _current_run_boundary(comparisons: list[dict[str, Any]]) -> tuple[int, str | None, int | None]:
    streak = 0
    for item in reversed(comparisons):
        if item.get("type") == "increase":
            streak += 1
            continue
        return streak, str(item.get("type") or "unknown"), int(item.get("year") or 0) or None
    return streak, None, None


def _recent_window_is_clean_increase(history: list[dict[str, Any]], periods: int) -> bool:
    if periods < 2 or len(history) < periods:
        return False
    window = history[-periods:]
    values = [row.get("annual_dividend") for row in window]
    if any(value is None for value in values):
        return False
    return all(_comparison(previous, current) == "increase" for previous, current in zip(values, values[1:]))


def _known_breaks_before_boundary(
    comparisons: list[dict[str, Any]],
    *,
    boundary_year: int | None,
    lookback: int = 12,
) -> int:
    if boundary_year is None:
        return 0
    older = [item for item in comparisons if int(item.get("year") or 0) < boundary_year]
    recent = older[-max(1, int(lookback)) :]
    return sum(str(item.get("type")) in {"flat", "cut", "start"} for item in recent)


def build_ir_review_candidate(
    summary: dict[str, Any],
    *,
    code: str,
    ticker: str,
    name: str,
    has_official_anchor: bool,
) -> dict[str, Any] | None:
    """Rank likely Yahoo-history undercounts for company-IR review.

    This function never estimates the true streak. It only triages records where
    the observed streak is long and the run appears to stop at an unknown/source
    boundary rather than at a confirmed flat dividend or cut.
    """
    if has_official_anchor or summary.get("streak_verified") is True:
        return None

    history = _history(summary)
    if len(history) < 2:
        return None
    comparisons = _comparisons(history)
    calculated_streak, boundary_type, boundary_year = _current_run_boundary(comparisons)
    observed_streak = int(summary.get("observed_consecutive_increase_years") or summary.get("consecutive_increase_years") or 0)
    # Prefer the direct calculation if an older payload omitted the observed field.
    if observed_streak <= 0:
        observed_streak = calculated_streak
    if observed_streak < MIN_OBSERVED_STREAK:
        return None

    latest_complete = history[-1].get("annual_dividend") is not None
    lower_bound = bool(summary.get("streak_lower_bound"))
    unknown_boundary = boundary_type == "unknown"
    source_start_boundary = boundary_type is None and calculated_streak > 0

    # A known flat/cut/start is evidence that the observed streak really begins
    # there. Such records are not SPK-style undercount candidates.
    if not latest_complete or not (unknown_boundary or source_start_boundary or lower_bound):
        return None

    partial_periods = sorted({int(value) for value in (summary.get("partial_event_periods") or []) if str(value).isdigit()})
    partial_set = set(partial_periods)
    partial_near_boundary = False
    if boundary_year is not None:
        partial_near_boundary = boundary_year in partial_set or (boundary_year - 1) in partial_set

    recent5 = _recent_window_is_clean_increase(history, 5)
    recent10 = _recent_window_is_clean_increase(history, 10)
    known_breaks = _known_breaks_before_boundary(comparisons, boundary_year=boundary_year)
    unknown_year_count = int(summary.get("unknown_year_count") or 0)
    expected_events = summary.get("expected_dividend_events_per_period")

    score = min(observed_streak, 25) * 3
    reasons: list[str] = [f"Yahooで直近{observed_streak}期の連続増配を観測"]

    if unknown_boundary:
        score += 35
        reasons.append("現在の連続記録の直前が取得未確認で途切れている")
    elif source_start_boundary:
        score += 25
        reasons.append("Yahoo観測開始地点まで連続増配が続き、起点を確定できない")

    if lower_bound:
        score += 15
        reasons.append("観測値が下限値として判定されている")
    if partial_near_boundary:
        score += 20
        reasons.append("連続記録の境界付近に部分配当イベントがある")
    elif partial_periods:
        score += 6
        reasons.append("古い履歴に部分配当イベントがある")
    if recent10:
        score += 20
        reasons.append("直近10期が欠損なく連続増配")
    elif recent5:
        score += 10
        reasons.append("直近5期が欠損なく連続増配")
    if unknown_year_count > 0:
        score += min(10, unknown_year_count)
    if known_breaks:
        score -= min(24, known_breaks * 6)
        reasons.append(f"境界より前の近年に既知の据置・減配等が{known_breaks}回あり優先度を減点")

    score = max(0, int(score))
    if score >= 100:
        priority = "urgent"
    elif score >= 80:
        priority = "high"
    elif score >= 60:
        priority = "medium"
    else:
        priority = "watch"

    evidence_start = max(0, len(history) - max(12, observed_streak + 4))
    evidence_window = history[evidence_start:]

    return {
        "code": str(code),
        "ticker": str(ticker),
        "name": str(name),
        "score": score,
        "priority": priority,
        "observed_consecutive_increase_years": observed_streak,
        "boundary_type": boundary_type or "source_start",
        "boundary_year": boundary_year,
        "streak_lower_bound": lower_bound,
        "recent_5_periods_clean_increase": recent5,
        "recent_10_periods_clean_increase": recent10,
        "unknown_year_count": unknown_year_count,
        "expected_dividend_events_per_period": expected_events,
        "partial_event_periods": partial_periods,
        "partial_event_near_boundary": partial_near_boundary,
        "known_breaks_before_boundary": known_breaks,
        "reasons": reasons,
        "evidence_window": evidence_window,
    }


def build_ir_review_payload(
    candidates: list[dict[str, Any]],
    *,
    generated_at: str | None,
    core_count: int,
    verified_anchor_count: int,
) -> dict[str, Any]:
    ordered = sorted(
        (dict(item) for item in candidates),
        key=lambda item: (
            -int(item.get("score") or 0),
            -int(item.get("observed_consecutive_increase_years") or 0),
            str(item.get("code") or ""),
        ),
    )
    priorities = Counter(str(item.get("priority") or "watch") for item in ordered)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "purpose": "Internal triage for company-IR verification; never an estimate of the true consecutive dividend-increase streak.",
        "selection_policy": {
            "minimum_observed_streak": MIN_OBSERVED_STREAK,
            "requires_latest_completed_period": True,
            "requires_unknown_or_source_start_boundary": True,
            "official_anchor_records_excluded": True,
        },
        "core_count": int(core_count),
        "verified_anchor_count": int(verified_anchor_count),
        "candidate_count": len(ordered),
        "priority_counts": {
            "urgent": int(priorities.get("urgent", 0)),
            "high": int(priorities.get("high", 0)),
            "medium": int(priorities.get("medium", 0)),
            "watch": int(priorities.get("watch", 0)),
        },
        "records": ordered,
    }
