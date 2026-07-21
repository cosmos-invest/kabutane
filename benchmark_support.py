from __future__ import annotations

from typing import Any

import pandas as pd


TOPIX_CANDIDATES = ["998405.T", "^TOPX", "1308.T", "1306.T"]
MAX_ABS_MONTHLY_RETURN_PCT = 45.0


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if pd.notna(number) else None


def _price_series(frame: pd.DataFrame) -> pd.Series:
    if frame is None or frame.empty:
        return pd.Series(dtype=float)
    for column in ("Adj Close", "Close"):
        value = frame.get(column)
        if value is None:
            continue
        if isinstance(value, pd.DataFrame):
            value = value.iloc[:, 0]
        series = pd.to_numeric(value, errors="coerce").dropna()
        if not series.empty:
            if getattr(series.index, "tz", None) is not None:
                series.index = series.index.tz_localize(None)
            return series.sort_index()
    return pd.Series(dtype=float)


def _returns_for_months(frame: pd.DataFrame, months: list[pd.Period]) -> list[dict[str, Any]]:
    close = _price_series(frame)
    if close.empty:
        return []
    monthly_close = close.groupby(close.index.to_period("M")).last()
    rows: list[dict[str, Any]] = []
    for month in months[1:]:
        previous = month - 1
        if previous not in monthly_close.index or month not in monthly_close.index:
            continue
        previous_close = _to_float(monthly_close.loc[previous])
        current_close = _to_float(monthly_close.loc[month])
        if previous_close in (None, 0) or current_close is None:
            continue
        value = (current_close / previous_close - 1) * 100
        rows.append({"month": str(month), "return_pct": round(value, 2)})
    return rows


def _is_usable(rows: list[dict[str, Any]], expected_months: int) -> bool:
    minimum = min(36, max(12, expected_months - 3))
    if len(rows) < minimum:
        return False
    return all(abs(float(row["return_pct"])) <= MAX_ABS_MONTHLY_RETURN_PCT for row in rows)


def build_robust_benchmark_series(
    daily_frames: dict[str, pd.DataFrame],
    months: list[pd.Period],
    definitions: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    expected = max(0, len(months) - 1)

    for key, definition in definitions.items():
        if key == "TOPIX":
            candidates = list(dict.fromkeys([
                definition.get("ticker"),
                *definition.get("fallback_tickers", []),
                *TOPIX_CANDIDATES,
            ]))
        else:
            candidates = list(dict.fromkeys([
                definition.get("ticker"),
                *definition.get("fallback_tickers", []),
            ]))
        candidates = [ticker for ticker in candidates if ticker]

        selected_ticker = None
        selected_rows: list[dict[str, Any]] = []
        attempts: list[dict[str, Any]] = []
        best_rows: list[dict[str, Any]] = []
        best_ticker = None

        for ticker in candidates:
            rows = _returns_for_months(daily_frames.get(ticker, pd.DataFrame()), months)
            max_abs = max((abs(float(row["return_pct"])) for row in rows), default=None)
            usable = _is_usable(rows, expected)
            attempts.append({
                "ticker": ticker,
                "return_count": len(rows),
                "max_abs_monthly_return_pct": round(max_abs, 2) if max_abs is not None else None,
                "usable": usable,
            })
            if len(rows) > len(best_rows):
                best_rows = rows
                best_ticker = ticker
            if usable:
                selected_ticker = ticker
                selected_rows = rows
                break

        if selected_ticker is None and key != "TOPIX":
            selected_ticker = best_ticker
            selected_rows = best_rows

        source_name = definition.get("name", key)
        source_type = "index"
        if key == "TOPIX" and selected_ticker in {"1308.T", "1306.T"}:
            source_name = "TOPIX連動ETF（代替）"
            source_type = "adjusted_etf_proxy"

        result[key] = {
            **definition,
            "name": source_name,
            "source_ticker": selected_ticker,
            "source_type": source_type,
            "price_basis": "Adj Close優先（株式分割・分配金調整済み）",
            "returns": selected_rows,
            "candidate_diagnostics": attempts,
        }
    return result


def install_into(legacy_module: Any) -> None:
    topix = legacy_module.BENCHMARKS.setdefault("TOPIX", {})
    topix["ticker"] = topix.get("ticker") or "998405.T"
    topix["name"] = "TOPIX"
    topix["fallback_tickers"] = list(dict.fromkeys([
        *topix.get("fallback_tickers", []),
        "^TOPX",
        "1308.T",
        "1306.T",
    ]))

    def builder(daily_frames, months):
        return build_robust_benchmark_series(daily_frames, months, legacy_module.BENCHMARKS)

    legacy_module.build_benchmark_series = builder
