from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from bisect import bisect_left
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PREMIUM_RADAR = ROOT / "data" / "premium" / "opportunity-radar.json"
RESEARCH_ROOT = ROOT / "data" / "premium" / "research"
HISTORY_ROOT = RESEARCH_ROOT / "history"
OUTCOMES_ROOT = RESEARCH_ROOT / "outcomes"
SUMMARY_PATH = RESEARCH_ROOT / "summary.json"
ENGINE_VERSION = "priority_v1_44_20_26_10"
COMPONENT_MAX = {"signal": 44.0, "trend_volume": 20.0, "supply": 26.0, "finance": 10.0}
HORIZONS = {"5d": 5, "20d": 20}
MIN_COHORT_COVERAGE = 0.95
WEIGHT_EXPERIMENTS = {
    "baseline": {"signal": 44, "trend_volume": 20, "supply": 26, "finance": 10},
    "signal_heavy": {"signal": 50, "trend_volume": 18, "supply": 22, "finance": 10},
    "supply_heavy": {"signal": 35, "trend_volume": 18, "supply": 37, "finance": 10},
    "trend_heavy": {"signal": 35, "trend_volume": 30, "supply": 25, "finance": 10},
    "quality_heavy": {"signal": 35, "trend_volume": 18, "supply": 22, "finance": 25},
}


def finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def rounded(value: Any, digits: int = 3) -> float | None:
    number = finite(value)
    return round(number, digits) if number is not None else None


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")


def safe_engine_version(value: Any) -> str:
    raw = str(value or ENGINE_VERSION).strip() or ENGINE_VERSION
    return "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in raw)


def resolved_history_root(history_root: Path | None, engine_version: str) -> Path:
    return history_root if history_root is not None else HISTORY_ROOT / safe_engine_version(engine_version)


def resolved_outcomes_root(outcomes_root: Path | None, engine_version: str) -> Path:
    return outcomes_root if outcomes_root is not None else OUTCOMES_ROOT / safe_engine_version(engine_version)


def snapshot_fingerprint(snapshot: dict[str, Any]) -> str:
    stable = {
        "price_date": snapshot.get("price_date"),
        "engine_version": snapshot.get("engine_version"),
        "records": snapshot.get("records") or [],
    }
    raw = json.dumps(stable, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def compact_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    payload_date = str(payload.get("price_date") or "")
    rows = []
    for row in payload.get("records") or []:
        components = row.get("score_components") or {}
        rows.append([
            str(row.get("code") or ""),
            str(row.get("price_date") or payload_date),
            rounded(row.get("current_price"), 4),
            rounded(row.get("priority_score"), 2),
            rounded(components.get("signal"), 2),
            rounded(components.get("trend_volume"), 2),
            rounded(components.get("supply"), 2),
            rounded(components.get("finance"), 2),
            str(row.get("provisional_status") or "UNKNOWN"),
        ])
    rows = [row for row in rows if row[0] and row[2] is not None]
    rows.sort(key=lambda item: (-(item[3] or 0), item[0]))
    snapshot = {
        "price_date": payload_date,
        "generated_at": payload.get("generated_at"),
        "engine_version": str(payload.get("engine_version") or ENGINE_VERSION),
        "records": rows,
    }
    fingerprint = snapshot_fingerprint(snapshot)
    snapshot["fingerprint"] = fingerprint
    snapshot["snapshot_id"] = f"{payload_date}:{fingerprint[:16]}"
    return snapshot


def record_snapshot(payload_path: Path = PREMIUM_RADAR, history_root: Path | None = None) -> dict[str, Any] | None:
    payload = load_json(payload_path, {})
    snapshot = compact_snapshot(payload)
    price_date = snapshot.get("price_date") or ""
    engine_version = str(snapshot.get("engine_version") or ENGINE_VERSION)
    if len(price_date) < 7 or not snapshot.get("records"):
        return None
    target_root = resolved_history_root(history_root, engine_version)
    month = price_date[:7]
    path = target_root / f"{month}.json"
    current = load_json(path, {
        "schema_version": 2,
        "kind": "premium_engine_history_month",
        "engine_version": engine_version,
        "month": month,
        "snapshots": [],
    })
    snapshots = list(current.get("snapshots") or [])
    fingerprint = snapshot["fingerprint"]
    identical = next((item for item in snapshots if item.get("fingerprint") == fingerprint), None)
    if identical is not None:
        return identical
    snapshots.append(snapshot)
    snapshots.sort(key=lambda item: (
        str(item.get("price_date") or ""),
        str(item.get("generated_at") or ""),
        str(item.get("snapshot_id") or ""),
    ))
    current.update({
        "schema_version": 2,
        "kind": "premium_engine_history_month",
        "engine_version": engine_version,
        "month": month,
        "snapshots": snapshots,
    })
    write_json(path, current)
    return snapshot


def load_snapshots(history_root: Path, engine_version: str | None = None) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    if not history_root.exists():
        return snapshots
    for path in sorted(history_root.glob("20??-??.json")):
        payload = load_json(path, {})
        for item in payload.get("snapshots") or []:
            if not item.get("price_date"):
                continue
            version = str(item.get("engine_version") or payload.get("engine_version") or "")
            if engine_version and version != engine_version:
                continue
            snapshots.append(item)
    by_id: dict[str, dict[str, Any]] = {}
    for item in snapshots:
        key = str(item.get("snapshot_id") or item.get("fingerprint") or "")
        if not key:
            key = f"legacy:{item.get('price_date')}:{len(by_id)}"
        by_id[key] = item
    return sorted(by_id.values(), key=lambda item: (
        str(item.get("price_date") or ""),
        str(item.get("generated_at") or ""),
        str(item.get("snapshot_id") or ""),
    ))


def observation_rows(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for rank, row in enumerate(snapshot.get("records") or [], start=1):
        if not isinstance(row, list) or len(row) < 9:
            continue
        result.append({
            "rank": rank,
            "code": str(row[0]),
            "price_date": str(row[1] or ""),
            "price": finite(row[2]),
            "score": finite(row[3]) or 0.0,
            "components": {
                "signal": finite(row[4]) or 0.0,
                "trend_volume": finite(row[5]) or 0.0,
                "supply": finite(row[6]) or 0.0,
                "finance": finite(row[7]) or 0.0,
            },
            "status": str(row[8] or "UNKNOWN"),
        })
    return result


def cohort_rows(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    cohort_date = str(snapshot.get("price_date") or "")
    return [row for row in observation_rows(snapshot) if row.get("price_date") == cohort_date]


def latest_snapshot_per_date(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[str, dict[str, Any]] = {}
    for snapshot in snapshots:
        key = str(snapshot.get("price_date") or "")
        if key:
            by_date[key] = snapshot
    return [by_date[key] for key in sorted(by_date)]


def weekly_cohorts(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[tuple[int, int], dict[str, Any]] = {}
    for snapshot in latest_snapshot_per_date(snapshots):
        try:
            value_date = date.fromisoformat(str(snapshot.get("price_date")))
        except ValueError:
            continue
        iso = value_date.isocalendar()
        selected[(iso.year, iso.week)] = snapshot
    return [selected[key] for key in sorted(selected)]


def load_price_series(core_root: Path | None = None) -> dict[str, tuple[list[str], list[float]]]:
    core_root = core_root or (ROOT / "data" / "core")
    merged: dict[str, dict[str, float]] = defaultdict(dict)
    for folder in ["charts", "daily"]:
        base = core_root / folder
        if not base.exists():
            continue
        for path in sorted(base.glob("*.json")):
            payload = load_json(path, {})
            for code, record in (payload.get("records") or {}).items():
                for row in record.get("daily") or []:
                    if not isinstance(row, list) or len(row) < 5:
                        continue
                    close = finite(row[4])
                    if close is not None and row[0]:
                        merged[str(code)][str(row[0])] = close
    result = {}
    for code, values in merged.items():
        dates = sorted(values)
        result[code] = (dates, [values[value_date] for value_date in dates])
    return result


def load_split_events(core_root: Path | None = None) -> dict[str, list[tuple[str, float]]]:
    core_root = core_root or (ROOT / "data" / "core")
    merged: dict[str, dict[str, float]] = defaultdict(dict)
    for folder in ["charts", "daily"]:
        base = core_root / folder
        if not base.exists():
            continue
        for path in sorted(base.glob("*.json")):
            payload = load_json(path, {})
            for code, record in (payload.get("records") or {}).items():
                for event in record.get("corporate_events") or []:
                    if event.get("type") != "SPLIT" or not event.get("date"):
                        continue
                    ratio = finite(event.get("ratio"))
                    if ratio is None:
                        detail = str(event.get("detail") or "").replace("比率", "").strip()
                        ratio = finite(detail)
                    if ratio not in (None, 0):
                        merged[str(code)][str(event["date"])] = float(ratio)
    return {code: sorted(values.items()) for code, values in merged.items()}


def cumulative_split_ratio(
    split_events: dict[str, list[tuple[str, float]]], code: str, start_date: str, exit_date: str
) -> float:
    ratio = 1.0
    for event_date, event_ratio in split_events.get(code, []):
        if start_date < event_date <= exit_date:
            ratio *= event_ratio
    return ratio


def series_price_on(series: dict[str, tuple[list[str], list[float]]], code: str, target_date: str) -> float | None:
    if code not in series:
        return None
    dates, prices = series[code]
    index = bisect_left(dates, target_date)
    if index >= len(dates) or dates[index] != target_date:
        return None
    return prices[index]


def nth_trading_date(calendar: list[str], start_date: str, horizon: int) -> str | None:
    index = bisect_left(calendar, start_date)
    if index >= len(calendar) or calendar[index] != start_date:
        return None
    target = index + horizon
    return calendar[target] if target < len(calendar) else None


def future_return(
    series: dict[str, tuple[list[str], list[float]]],
    code: str,
    start_date: str,
    entry_price: float | None,
    horizon: int,
) -> float | None:
    if entry_price in (None, 0) or code not in series:
        return None
    dates, prices = series[code]
    index = bisect_left(dates, start_date)
    if index >= len(dates) or dates[index] != start_date:
        return None
    target = index + horizon
    if target >= len(dates):
        return None
    return (prices[target] / float(entry_price) - 1.0) * 100.0


def research_calendar(dated_snapshots: list[dict[str, Any]]) -> list[str]:
    return [str(snapshot.get("price_date") or "") for snapshot in dated_snapshots if snapshot.get("price_date")]


def market_calendar(series: dict[str, tuple[list[str], list[float]]]) -> list[str]:
    dates: set[str] = set()
    for values in series.values():
        dates.update(values[0])
    return sorted(dates)


def fallback_observation(
    dated_snapshots: list[dict[str, Any]],
    code: str,
    start_date: str,
    target_date: str,
) -> tuple[str, float] | None:
    for snapshot in reversed(dated_snapshots):
        value_date = str(snapshot.get("price_date") or "")
        if not value_date or value_date > target_date or value_date < start_date:
            continue
        row = next((item for item in cohort_rows(snapshot) if item.get("code") == code), None)
        price = finite(row.get("price")) if row else None
        if price is not None:
            return value_date, price
    return None


def outcome_file(outcomes_root: Path, cohort_date: str) -> Path:
    return outcomes_root / f"{cohort_date[:7]}.json"


def load_outcome_index(outcomes_root: Path, engine_version: str) -> dict[tuple[str, str, str], dict[str, Any]]:
    index: dict[tuple[str, str, str], dict[str, Any]] = {}
    if not outcomes_root.exists():
        return index
    for path in sorted(outcomes_root.glob("20??-??.json")):
        payload = load_json(path, {})
        if str(payload.get("engine_version") or "") != engine_version:
            continue
        for snapshot_id, cohort in (payload.get("cohorts") or {}).items():
            for horizon_name in HORIZONS:
                for code, value in (cohort.get(horizon_name) or {}).items():
                    if not isinstance(value, list) or len(value) < 5:
                        continue
                    index[(str(snapshot_id), horizon_name, str(code))] = {
                        "target_date": str(value[0]),
                        "exit_date": str(value[1]),
                        "exit_price": finite(value[2]),
                        "return_pct": finite(value[3]),
                        "reason": str(value[4]),
                        "split_ratio": finite(value[5]) if len(value) > 5 else 1.0,
                    }
    return index


def finalize_outcomes(
    snapshots: list[dict[str, Any]],
    series: dict[str, tuple[list[str], list[float]]],
    outcomes_root: Path,
    engine_version: str,
    split_events: dict[str, list[tuple[str, float]]] | None = None,
) -> dict[str, int]:
    split_events = split_events or {}
    dated_snapshots = latest_snapshot_per_date(snapshots)
    cohorts = weekly_cohorts(snapshots)
    primary_calendar = market_calendar(series)
    fallback_calendar = research_calendar(dated_snapshots)
    existing = load_outcome_index(outcomes_root, engine_version)
    stats = {"exact": 0, "snapshot": 0, "forced_last_observed": 0, "pending": 0}
    cache: dict[Path, dict[str, Any]] = {}
    dirty: set[Path] = set()

    for snapshot in cohorts:
        snapshot_id = str(snapshot.get("snapshot_id") or "")
        cohort_date = str(snapshot.get("price_date") or "")
        rows = cohort_rows(snapshot)
        if not snapshot_id or not cohort_date or not rows:
            continue
        path = outcome_file(outcomes_root, cohort_date)
        if path not in cache:
            cache[path] = load_json(path, {
                "schema_version": 1,
                "kind": "premium_engine_outcomes_month",
                "engine_version": engine_version,
                "month": cohort_date[:7],
                "cohorts": {},
            })
        payload = cache[path]
        cohort_payload = payload.setdefault("cohorts", {}).setdefault(snapshot_id, {
            "cohort_date": cohort_date,
            "5d": {},
            "20d": {},
        })

        for horizon_name, horizon in HORIZONS.items():
            target_date = nth_trading_date(primary_calendar, cohort_date, horizon)
            if target_date is None:
                target_date = nth_trading_date(fallback_calendar, cohort_date, horizon)
            if target_date is None:
                stats["pending"] += len(rows)
                continue
            horizon_payload = cohort_payload.setdefault(horizon_name, {})
            for row in rows:
                code = row["code"]
                key = (snapshot_id, horizon_name, code)
                if key in existing or code in horizon_payload:
                    continue
                entry_price = finite(row.get("price"))
                if entry_price in (None, 0):
                    continue

                exit_date = target_date
                exit_price = series_price_on(series, code, target_date)
                reason = "market_close"
                if exit_price is None:
                    observed = fallback_observation(dated_snapshots, code, cohort_date, target_date)
                    if observed is None:
                        stats["pending"] += 1
                        continue
                    exit_date, exit_price = observed
                    reason = "snapshot_target" if exit_date == target_date else "last_observed_before_target"

                split_ratio = cumulative_split_ratio(split_events, code, cohort_date, exit_date)
                return_pct = (float(exit_price) * split_ratio / float(entry_price) - 1.0) * 100.0
                horizon_payload[code] = [
                    target_date,
                    exit_date,
                    round(float(exit_price), 4),
                    round(return_pct, 5),
                    reason,
                    round(split_ratio, 8),
                ]
                existing[key] = {
                    "target_date": target_date,
                    "exit_date": exit_date,
                    "exit_price": exit_price,
                    "return_pct": return_pct,
                    "reason": reason,
                    "split_ratio": split_ratio,
                }
                dirty.add(path)
                if reason == "market_close":
                    stats["exact"] += 1
                elif reason == "snapshot_target":
                    stats["snapshot"] += 1
                else:
                    stats["forced_last_observed"] += 1

    for path in dirty:
        write_json(path, cache[path])
    return stats


def metric(values: list[float]) -> dict[str, Any]:
    clean = [float(value) for value in values if finite(value) is not None]
    if not clean:
        return {"count": 0, "mean_pct": None, "median_pct": None, "win_rate_pct": None}
    return {
        "count": len(clean),
        "mean_pct": round(statistics.fmean(clean), 3),
        "median_pct": round(statistics.median(clean), 3),
        "win_rate_pct": round(sum(value > 0 for value in clean) / len(clean) * 100, 1),
    }


def alt_score(row: dict[str, Any], weights: dict[str, float]) -> float:
    score = 0.0
    for key, weight in weights.items():
        cap = COMPONENT_MAX[key]
        score += min(1.0, max(0.0, (row["components"].get(key) or 0.0) / cap)) * float(weight)
    return score


def portfolio_members(rows: list[dict[str, Any]], spec: str) -> list[dict[str, Any]]:
    if spec.startswith("top"):
        return rows[: int(spec[3:])]
    if spec.startswith("score_"):
        threshold = float(spec.split("_", 1)[1])
        return [row for row in rows if row["score"] >= threshold]
    return []


def evaluate(
    history_root: Path | None = None,
    core_root: Path | None = None,
    premium_path: Path = PREMIUM_RADAR,
    outcomes_root: Path | None = None,
) -> dict[str, Any]:
    latest_payload = load_json(premium_path, {})
    engine_version = str(latest_payload.get("engine_version") or ENGINE_VERSION)
    target_history_root = resolved_history_root(history_root, engine_version)
    target_outcomes_root = resolved_outcomes_root(outcomes_root, engine_version)
    snapshots = load_snapshots(target_history_root, engine_version)
    dated_snapshots = latest_snapshot_per_date(snapshots)
    cohorts = weekly_cohorts(snapshots)
    series = load_price_series(core_root)
    split_events = load_split_events(core_root)
    finalization = finalize_outcomes(snapshots, series, target_outcomes_root, engine_version, split_events)
    outcome_index = load_outcome_index(target_outcomes_root, engine_version)

    specs = ["top10", "top20", "top50", "score_60", "score_70", "score_80", "score_90"]
    portfolio_result: dict[str, dict[str, Any]] = {spec: {} for spec in specs}
    bucket_defs = [(0, 49.999), (50, 59.999), (60, 69.999), (70, 79.999), (80, 89.999), (90, 100.001)]
    bucket_result: dict[str, dict[str, Any]] = {}
    experiment_result: dict[str, dict[str, Any]] = {name: {} for name in WEIGHT_EXPERIMENTS}
    mature_counts = {"5d": 0, "20d": 0}
    cohort_coverages: dict[str, list[float]] = {"5d": [], "20d": []}

    for horizon_name in HORIZONS:
        spec_position_returns: dict[str, list[float]] = defaultdict(list)
        spec_cohort_returns: dict[str, list[float]] = defaultdict(list)
        spec_excess_returns: dict[str, list[float]] = defaultdict(list)
        bucket_returns: dict[str, list[float]] = defaultdict(list)
        experiment_cohort_returns: dict[str, list[float]] = defaultdict(list)
        experiment_excess_returns: dict[str, list[float]] = defaultdict(list)
        matured = 0

        for snapshot in cohorts:
            snapshot_id = str(snapshot.get("snapshot_id") or "")
            rows = cohort_rows(snapshot)
            if not snapshot_id or not rows:
                continue
            returns_by_code = {
                row["code"]: finite(outcome_index.get((snapshot_id, horizon_name, row["code"]), {}).get("return_pct"))
                for row in rows
            }
            baseline = [value for value in returns_by_code.values() if value is not None]
            coverage = len(baseline) / len(rows) if rows else 0.0
            if coverage < MIN_COHORT_COVERAGE:
                continue
            cohort_coverages[horizon_name].append(coverage)
            matured += 1
            baseline_mean = statistics.fmean(baseline)

            for spec in specs:
                selected = portfolio_members(rows, spec)
                values = [returns_by_code[row["code"]] for row in selected if returns_by_code.get(row["code"]) is not None]
                if not values:
                    continue
                spec_position_returns[spec].extend(values)
                cohort_mean = statistics.fmean(values)
                spec_cohort_returns[spec].append(cohort_mean)
                spec_excess_returns[spec].append(cohort_mean - baseline_mean)

            for low, high in bucket_defs:
                label = f"{int(low)}-{int(high) if high < 100 else 100}"
                values = [
                    returns_by_code[row["code"]]
                    for row in rows
                    if low <= row["score"] <= high and returns_by_code.get(row["code"]) is not None
                ]
                bucket_returns[label].extend(values)

            for name, weights in WEIGHT_EXPERIMENTS.items():
                ranked = sorted(rows, key=lambda row: (-alt_score(row, weights), row["code"]))[:20]
                values = [returns_by_code[row["code"]] for row in ranked if returns_by_code.get(row["code"]) is not None]
                if not values:
                    continue
                mean_value = statistics.fmean(values)
                experiment_cohort_returns[name].append(mean_value)
                experiment_excess_returns[name].append(mean_value - baseline_mean)

        mature_counts[horizon_name] = matured
        for spec in specs:
            base = metric(spec_position_returns[spec])
            cohort = metric(spec_cohort_returns[spec])
            excess = metric(spec_excess_returns[spec])
            portfolio_result[spec][horizon_name] = {
                "cohorts": len(spec_cohort_returns[spec]),
                "positions": base["count"],
                "position_mean_pct": base["mean_pct"],
                "position_median_pct": base["median_pct"],
                "position_win_rate_pct": base["win_rate_pct"],
                "portfolio_mean_pct": cohort["mean_pct"],
                "portfolio_win_rate_pct": cohort["win_rate_pct"],
                "excess_vs_all_core_pct": excess["mean_pct"],
            }
        for label, values in bucket_returns.items():
            bucket_result.setdefault(label, {})[horizon_name] = metric(values)
        for name in WEIGHT_EXPERIMENTS:
            cohort = metric(experiment_cohort_returns[name])
            excess = metric(experiment_excess_returns[name])
            experiment_result[name][horizon_name] = {
                "cohorts": len(experiment_cohort_returns[name]),
                "top20_mean_pct": cohort["mean_pct"],
                "top20_win_rate_pct": cohort["win_rate_pct"],
                "excess_vs_all_core_pct": excess["mean_pct"],
                "weights": WEIGHT_EXPERIMENTS[name],
            }

    latest_map = {str(row.get("code") or ""): row for row in latest_payload.get("records") or []}
    movers = []
    if len(dated_snapshots) >= 2:
        previous_rows = cohort_rows(dated_snapshots[-2])
        current_rows = cohort_rows(dated_snapshots[-1])
        previous = {row["code"]: row for row in previous_rows}
        for row in current_rows[:150]:
            old = previous.get(row["code"])
            if not old:
                continue
            rank_delta = old["rank"] - row["rank"]
            score_delta = row["score"] - old["score"]
            if rank_delta <= 0 and score_delta <= 0:
                continue
            info = latest_map.get(row["code"], {})
            movers.append({
                "code": row["code"],
                "name": info.get("name"),
                "market": info.get("market"),
                "current_rank": row["rank"],
                "previous_rank": old["rank"],
                "rank_delta": rank_delta,
                "priority_score": round(row["score"], 1),
                "score_delta": round(score_delta, 1),
                "provisional_status": row["status"],
                "tags": info.get("tags") or [],
                "reasons": info.get("reasons") or [],
            })
        movers.sort(key=lambda item: (
            item["current_rank"] > 20,
            -item["rank_delta"],
            -item["score_delta"],
            item["current_rank"],
        ))
        movers = movers[:12]

    history_start = dated_snapshots[0].get("price_date") if dated_snapshots else None
    latest_snapshot = dated_snapshots[-1].get("price_date") if dated_snapshots else None
    recommendation_ready = mature_counts["20d"] >= 12 and mature_counts["5d"] >= 20
    best_experiment = None
    if recommendation_ready:
        candidates = []
        for name, values in experiment_result.items():
            result20 = values.get("20d") or {}
            excess = finite(result20.get("excess_vs_all_core_pct"))
            if excess is not None:
                candidates.append((excess, name))
        if candidates:
            _, best_experiment = max(candidates)

    coverage_summary = {
        key: round(statistics.fmean(values) * 100, 2) if values else None
        for key, values in cohort_coverages.items()
    }
    outcome_counts = defaultdict(int)
    for value in outcome_index.values():
        outcome_counts[str(value.get("reason") or "unknown")] += 1

    return {
        "schema_version": 3,
        "kind": "premium_engine_research_summary",
        "engine_version": engine_version,
        "history_start": history_start,
        "latest_snapshot": latest_snapshot,
        "snapshot_count": len(snapshots),
        "snapshot_day_count": len(dated_snapshots),
        "weekly_cohort_count": len(cohorts),
        "mature_cohorts": mature_counts,
        "mean_outcome_coverage_pct": coverage_summary,
        "outcome_counts": dict(outcome_counts),
        "newly_finalized": finalization,
        "recommendation_ready": recommendation_ready,
        "best_challenger": best_experiment,
        "guardrail": "本番の観察優先度は自動変更しません。週次コホートを蓄積し、20営業日後の検証が12週以上たまってから研究候補を提示します。成熟した将来リターンは別のoutcome台帳へ固定し、後日のユニバース変更や1年価格窓の更新で再計算しません。",
        "latest_movers": movers,
        "portfolios": portfolio_result,
        "score_buckets": bucket_result,
        "weight_experiments": experiment_result,
    }


def run(
    payload_path: Path = PREMIUM_RADAR,
    history_root: Path | None = None,
    summary_path: Path = SUMMARY_PATH,
    core_root: Path | None = None,
    outcomes_root: Path | None = None,
) -> dict[str, Any]:
    record_snapshot(payload_path, history_root)
    summary = evaluate(history_root, core_root, payload_path, outcomes_root)
    write_json(summary_path, summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Persist and validate Kabutane premium observation-priority engine")
    parser.add_argument("--payload", type=Path, default=PREMIUM_RADAR)
    parser.add_argument("--history-root", type=Path, default=None)
    parser.add_argument("--outcomes-root", type=Path, default=None)
    parser.add_argument("--summary", type=Path, default=SUMMARY_PATH)
    parser.add_argument("--core-root", type=Path, default=ROOT / "data" / "core")
    args = parser.parse_args()
    summary = run(args.payload, args.history_root, args.summary, args.core_root, args.outcomes_root)
    print(
        "Premium research: "
        f"engine={summary['engine_version']} generations={summary['snapshot_count']} days={summary['snapshot_day_count']} "
        f"weekly={summary['weekly_cohort_count']} mature5={summary['mature_cohorts']['5d']} mature20={summary['mature_cohorts']['20d']} "
        f"outcomes={sum(summary['outcome_counts'].values())}"
    )


if __name__ == "__main__":
    main()
