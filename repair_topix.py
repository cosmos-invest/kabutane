from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent
ANALYSIS_PATH = ROOT / "data" / "analysis.json"

# yfinance availability varies by endpoint. Prefer the true TOPIX index, then
# Yahoo Japan's domestic symbol. 1306.T is used only as an explicitly marked
# price proxy when neither index symbol provides enough history.
CANDIDATES = [
    {"ticker": "^TOPX", "name": "TOPIX", "proxy": False},
    {"ticker": "998405.T", "name": "TOPIX", "proxy": False},
    {"ticker": "1306.T", "name": "TOPIX連動ETF（代替）", "proxy": True},
]


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def extract_close(frame: pd.DataFrame, ticker: str) -> pd.Series:
    if frame is None or frame.empty:
        return pd.Series(dtype=float)
    data = frame.copy()
    if isinstance(data.columns, pd.MultiIndex):
        if ticker in data.columns.get_level_values(0):
            data = data[ticker]
        elif ticker in data.columns.get_level_values(1):
            data = data.xs(ticker, level=1, axis=1)
    column = "Close"
    if column not in data.columns:
        return pd.Series(dtype=float)
    close = pd.to_numeric(data[column], errors="coerce").dropna()
    close.index = pd.to_datetime(close.index, errors="coerce")
    close = close[~close.index.isna()].sort_index()
    if getattr(close.index, "tz", None) is not None:
        close.index = close.index.tz_localize(None)
    return close


def aligned_returns(close: pd.Series, start_month: str, end_month: str) -> list[dict[str, Any]]:
    if close.empty:
        return []
    monthly = close.groupby(close.index.to_period("M")).last()
    periods = list(pd.period_range(start=start_month, end=end_month, freq="M"))
    rows: list[dict[str, Any]] = []
    for month in periods[1:]:
        previous = month - 1
        if previous not in monthly.index or month not in monthly.index:
            continue
        previous_close = finite(monthly.loc[previous])
        current_close = finite(monthly.loc[month])
        if not previous_close or current_close is None:
            continue
        rows.append({
            "month": str(month),
            "return_pct": round((current_close / previous_close - 1) * 100, 2),
        })
    return rows


def download_candidate(candidate: dict[str, Any], start_month: str, end_month: str) -> dict[str, Any]:
    ticker = candidate["ticker"]
    try:
        frame = yf.download(
            ticker,
            period="10y",
            interval="1d",
            auto_adjust=False,
            actions=False,
            progress=False,
            threads=False,
            timeout=60,
        )
        close = extract_close(frame, ticker)
        returns = aligned_returns(close, start_month, end_month)
    except Exception as exc:  # keep other candidates available
        print(f"{ticker}: download failed: {exc}")
        returns = []
    return {**candidate, "returns": returns}


def cumulative_return(points: list[dict[str, Any]], start_month: str, end_month: str) -> float | None:
    wealth = 1.0
    count = 0
    for point in points:
        month = str(point.get("month") or "")
        value = finite(point.get("return_pct"))
        if value is None or not (start_month < month <= end_month):
            continue
        wealth *= 1 + value / 100
        count += 1
    return round((wealth - 1) * 100, 2) if count else None


def repair_exit_strategy_benchmark(payload: dict[str, Any], benchmark: dict[str, Any]) -> None:
    result = payload.get("exit_strategy_results")
    if not isinstance(result, dict):
        return
    result["benchmark_key"] = "TOPIX"
    result["benchmark_name"] = benchmark["name"]
    periods = result.get("periods") or {}
    universes = result.get("universes") or {}
    for universe in universes.values():
        for strategy in universe.get("strategies") or []:
            metrics_by_period = strategy.get("metrics") or {}
            for period_key, metrics in metrics_by_period.items():
                period = periods.get(period_key) or {}
                start = period.get("start")
                end = period.get("end")
                if not start or not end:
                    continue
                benchmark_return = cumulative_return(benchmark["returns"], start, end)
                strategy_return = finite(metrics.get("cumulative_return_pct"))
                metrics["benchmark_return_pct"] = benchmark_return
                metrics["benchmark_excess_pct"] = (
                    round(strategy_return - benchmark_return, 2)
                    if strategy_return is not None and benchmark_return is not None
                    else None
                )


def main() -> None:
    if not ANALYSIS_PATH.exists():
        raise SystemExit("data/analysis.json is missing")
    payload = json.loads(ANALYSIS_PATH.read_text(encoding="utf-8"))
    start_month = str(payload.get("available_start_month") or "")
    end_month = str(payload.get("available_end_month") or "")
    if not start_month or not end_month:
        raise SystemExit("analysis period is missing")

    candidates = [download_candidate(candidate, start_month, end_month) for candidate in CANDIDATES]
    # Choose the candidate with the largest amount of usable aligned history.
    # On equal coverage, prefer a true index over the ETF proxy.
    candidates.sort(key=lambda item: (len(item["returns"]), not item["proxy"]), reverse=True)
    chosen = candidates[0]
    expected = max(0, len(pd.period_range(start=start_month, end=end_month, freq="M")) - 1)
    minimum = min(12, max(1, expected // 2))
    if len(chosen["returns"]) < minimum:
        details = ", ".join(f"{item['ticker']}={len(item['returns'])}" for item in candidates)
        raise SystemExit(f"TOPIX history is insufficient ({details})")

    benchmark = {
        "ticker": "^TOPX",
        "fallback_tickers": ["998405.T", "1306.T"],
        "name": chosen["name"],
        "source_ticker": chosen["ticker"],
        "is_proxy": chosen["proxy"],
        "coverage_months": len(chosen["returns"]),
        "expected_months": expected,
        "returns": chosen["returns"],
    }
    payload.setdefault("benchmarks", {})["TOPIX"] = benchmark
    repair_exit_strategy_benchmark(payload, benchmark)
    ANALYSIS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"TOPIX benchmark repaired: {chosen['ticker']} "
        f"({len(chosen['returns'])}/{expected} monthly returns)"
    )


if __name__ == "__main__":
    main()
