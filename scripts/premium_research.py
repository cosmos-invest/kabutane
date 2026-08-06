from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from bisect import bisect_right
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PREMIUM_RADAR = ROOT / "data" / "premium" / "opportunity-radar.json"
RESEARCH_ROOT = ROOT / "data" / "premium" / "research"
HISTORY_ROOT = RESEARCH_ROOT / "history"
SUMMARY_PATH = RESEARCH_ROOT / "summary.json"
ENGINE_VERSION = "priority_v1_44_20_26_10"
COMPONENT_MAX = {"signal": 44.0, "trend_volume": 20.0, "supply": 26.0, "finance": 10.0}
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
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def rounded(value: Any, digits: int = 3) -> float | None:
    n = finite(value)
    return round(n, digits) if n is not None else None


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
    current = load_json(
        path,
        {
            "schema_version": 2,
            "kind": "premium_engine_history_month",
            "engine_version": engine_version,
            "month": month,
            "snapshots": [],
        },
    )
    snapshots = list(current.get("snapshots") or [])
    fingerprint = snapshot["fingerprint"]
    identical = next((item for item in snapshots if item.get("fingerprint") == fingerprint), None)
    if identical is not None:
        return identical
    snapshots.append(snapshot)
    snapshots.sort(key=lambda item: (str(item.get("price_date") or ""), str(item.get("generated_at") or ""), str(item.get("snapshot_id") or "")))
    current.update(
        {
            "schema_version": 2,
            "kind": "premium_engine_history_month",
            "engine_version": engine_version,
            "month": month,
            "snapshots": snapshots,
        }
    )
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
    return sorted(
        by_id.values(),
        key=lambda item: (str(item.get("price_date") or ""), str(item.get("generated_at") or ""), str(item.get("snapshot_id") or "")),
    )


def observation_rows(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for rank, row in enumerate(snapshot.get("records") or [], start=1):
        if not isinstance(row, list) or len(row) < 9:
            continue
        result.append(
            {
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
            }
        )
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
        result[code] = (dates, [values[d] for d in dates])
    return result


def future_return(series: dict[str, tuple[list[str], list[float]]], code: str, start_date: str, entry_price: float | None, horizon: int) -> float | None:
    if entry_price in (None, 0) or code not in series:
        return None
    dates, prices = series[code]
    pos = bisect_right(dates, start_date)
    target = pos + horizon - 1
    if target >= len(dates):
        return None
    return (prices[target] / float(entry_price) - 1.0) * 100.0


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


def weekly_cohorts(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[tuple[int, int], dict[str, Any]] = {}
    for snapshot in latest_snapshot_per_date(snapshots):
        try:
            d = date.fromisoformat(str(snapshot.get("price_date")))
        except ValueError:
            continue
        iso = d.isocalendar()
        selected[(iso.year, iso.week)] = snapshot
    return [selected[key] for key in sorted(selected)]


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


def evaluate(history_root: Path | None = None, core_root: Path | None = None, premium_path: Path = PREMIUM_RADAR) -> dict[str, Any]:
    latest_payload = load_json(premium_path, {})
    engine_version = str(latest_payload.get("engine_version") or ENGINE_VERSION)
    target_history_root = resolved_history_root(history_root, engine_version)
    snapshots = load_snapshots(target_history_root, engine_version)
    dated_snapshots = latest_snapshot_per_date(snapshots)
    cohorts = weekly_cohorts(snapshots)
    series = load_price_series(core_root)
    horizons = {"5d": 5, "20d": 20}
    specs = ["top10", "top20", "top50", "score_60", "score_70", "score_80", "score_90"]
    portfolio_result: dict[str, dict[str, Any]] = {spec: {} for spec in specs}
    bucket_defs = [(0, 49.999), (50, 59.999), (60, 69.999), (70, 79.999), (80, 89.999), (90, 100.001)]
    bucket_result: dict[str, dict[str, Any]] = {}
    experiment_result: dict[str, dict[str, Any]] = {name: {} for name in WEIGHT_EXPERIMENTS}
    mature_counts = {"5d": 0, "20d": 0}

    for horizon_name, horizon in horizons.items():
        spec_position_returns: dict[str, list[float]] = defaultdict(list)
        spec_cohort_returns: dict[str, list[float]] = defaultdict(list)
        spec_excess_returns: dict[str, list[float]] = defaultdict(list)
        bucket_returns: dict[str, list[float]] = defaultdict(list)
        experiment_cohort_returns: dict[str, list[float]] = defaultdict(list)
        experiment_excess_returns: dict[str, list[float]] = defaultdict(list)
        matured = 0

        for snapshot in cohorts:
            start_date = str(snapshot.get("price_date") or "")
            rows = cohort_rows(snapshot)
            if not rows:
                continue
            returns_by_code = {
                row["code"]: future_return(series, row["code"], row["price_date"], row["price"], horizon)
                for row in rows
            }
            baseline = [value for value in returns_by_code.values() if value is not None]
            if not baseline:
                continue
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
        previous_snapshot = dated_snapshots[-2]
        current_snapshot = dated_snapshots[-1]
        previous_rows = cohort_rows(previous_snapshot)
        current_rows = cohort_rows(current_snapshot)
        prev = {row["code"]: row for row in previous_rows}
        for row in current_rows[:150]:
            old = prev.get(row["code"])
            if not old:
                continue
            rank_delta = old["rank"] - row["rank"]
            score_delta = row["score"] - old["score"]
            if rank_delta <= 0 and score_delta <= 0:
                continue
            info = latest_map.get(row["code"], {})
            movers.append(
                {
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
                }
            )
        movers.sort(key=lambda item: (item["current_rank"] > 20, -item["rank_delta"], -item["score_delta"], item["current_rank"]))
        movers = movers[:12]

    start = dated_snapshots[0].get("price_date") if dated_snapshots else None
    latest = dated_snapshots[-1].get("price_date") if dated_snapshots else None
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

    return {
        "schema_version": 2,
        "kind": "premium_engine_research_summary",
        "engine_version": engine_version,
        "history_start": start,
        "latest_snapshot": latest,
        "snapshot_count": len(snapshots),
        "snapshot_day_count": len(dated_snapshots),
        "weekly_cohort_count": len(cohorts),
        "mature_cohorts": mature_counts,
        "recommendation_ready": recommendation_ready,
        "best_challenger": best_experiment,
        "guardrail": "本番の観察優先度は自動変更しません。週次コホートを蓄積し、20営業日後の検証が12週以上たまってから研究候補を提示します。",
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
) -> dict[str, Any]:
    record_snapshot(payload_path, history_root)
    summary = evaluate(history_root, core_root, payload_path)
    write_json(summary_path, summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Persist and validate Kabutane premium observation-priority engine")
    parser.add_argument("--payload", type=Path, default=PREMIUM_RADAR)
    parser.add_argument("--history-root", type=Path, default=None)
    parser.add_argument("--summary", type=Path, default=SUMMARY_PATH)
    parser.add_argument("--core-root", type=Path, default=ROOT / "data" / "core")
    args = parser.parse_args()
    summary = run(args.payload, args.history_root, args.summary, args.core_root)
    print(
        "Premium research: "
        f"engine={summary['engine_version']} generations={summary['snapshot_count']} days={summary['snapshot_day_count']} "
        f"weekly={summary['weekly_cohort_count']} mature5={summary['mature_cohorts']['5d']} mature20={summary['mature_cohorts']['20d']}"
    )


if __name__ == "__main__":
    main()
