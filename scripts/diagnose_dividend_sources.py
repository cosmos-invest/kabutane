from __future__ import annotations

import argparse
from typing import Any

import pandas as pd
import yfinance as yf

from dividend_history import build_dividend_history


DEFAULT_TICKERS = ["7466.T", "8593.T", "8566.T"]


def _series_from_frame(frame: pd.DataFrame | None) -> pd.Series:
    if frame is None or frame.empty or "Dividends" not in frame.columns:
        return pd.Series(dtype=float)
    series = pd.to_numeric(frame["Dividends"], errors="coerce").fillna(0.0)
    series = series[series.ne(0.0)]
    series.index = pd.to_datetime(series.index, errors="coerce")
    series = series[~series.index.isna()].sort_index()
    if getattr(series.index, "tz", None) is not None:
        series.index = series.index.tz_localize(None)
    return series.astype(float)


def _frame_from_dividends(dividends: pd.Series) -> pd.DataFrame:
    if dividends is None or dividends.empty:
        return pd.DataFrame(columns=["Close", "Dividends", "Stock Splits"])
    index = pd.to_datetime(dividends.index, errors="coerce")
    values = pd.to_numeric(dividends, errors="coerce")
    frame = pd.DataFrame(
        {
            "Close": 1.0,
            "Dividends": values.to_numpy(dtype=float),
            "Stock Splits": 0.0,
        },
        index=index,
    )
    frame = frame[~frame.index.isna()].sort_index()
    if getattr(frame.index, "tz", None) is not None:
        frame.index = frame.index.tz_localize(None)
    return frame


def _summary(dividends: pd.Series, fiscal_month: int = 3) -> dict[str, Any]:
    frame = _frame_from_dividends(dividends)
    return build_dividend_history(frame, fiscal_year_end_month=fiscal_month)


def _fetch_monthly(ticker: str) -> pd.Series:
    frame = yf.download(
        tickers=ticker,
        period="max",
        interval="1mo",
        group_by="ticker",
        auto_adjust=False,
        actions=True,
        threads=False,
        progress=False,
        timeout=60,
    )
    if isinstance(frame.columns, pd.MultiIndex):
        if ticker in set(frame.columns.get_level_values(0)):
            frame = frame[ticker].copy()
        elif ticker in set(frame.columns.get_level_values(1)):
            frame = frame.xs(ticker, level=1, axis=1).copy()
    return _series_from_frame(frame)


def _fetch_daily(ticker: str, *, repair: bool) -> pd.Series:
    frame = yf.Ticker(ticker).history(
        period="max",
        interval="1d",
        auto_adjust=False,
        actions=True,
        repair=repair,
        raise_errors=True,
    )
    return _series_from_frame(frame)


def _fetch_get_dividends(ticker: str) -> pd.Series:
    series = yf.Ticker(ticker).get_dividends(period="max")
    if series is None:
        return pd.Series(dtype=float)
    result = pd.to_numeric(series, errors="coerce").dropna()
    result = result[result.ne(0.0)]
    result.index = pd.to_datetime(result.index, errors="coerce")
    result = result[~result.index.isna()].sort_index()
    if getattr(result.index, "tz", None) is not None:
        result.index = result.index.tz_localize(None)
    return result.astype(float)


def _print_source(ticker: str, name: str, dividends: pd.Series) -> None:
    summary = _summary(dividends)
    first = dividends.index.min().date().isoformat() if not dividends.empty else "-"
    last = dividends.index.max().date().isoformat() if not dividends.empty else "-"
    print(
        f"{ticker} {name}: events={len(dividends)} range={first}..{last} "
        f"observed_streak={summary.get('consecutive_increase_years')} "
        f"history={summary.get('history_start_year')}..{summary.get('history_end_year')}"
    )
    if ticker == "7466.T":
        history = summary.get("history") or []
        focus = [row for row in history if 2002 <= int(row.get("year") or 0) <= 2012]
        print(f"{ticker} {name} FY2002-2012: {focus}")


def diagnose(ticker: str) -> None:
    print(f"=== {ticker} ===")
    sources: list[tuple[str, pd.Series]] = []
    for name, fetcher in (
        ("monthly_download", lambda: _fetch_monthly(ticker)),
        ("daily_history", lambda: _fetch_daily(ticker, repair=False)),
        ("daily_repair", lambda: _fetch_daily(ticker, repair=True)),
        ("get_dividends", lambda: _fetch_get_dividends(ticker)),
    ):
        try:
            series = fetcher()
        except Exception as exc:
            print(f"{ticker} {name}: ERROR {type(exc).__name__}: {exc}")
            continue
        sources.append((name, series))
        _print_source(ticker, name, series)

    by_name = {name: series for name, series in sources}
    monthly = by_name.get("monthly_download")
    dedicated = by_name.get("get_dividends")
    if monthly is not None and dedicated is not None:
        monthly_dates = set(pd.DatetimeIndex(monthly.index).normalize())
        dedicated_dates = set(pd.DatetimeIndex(dedicated.index).normalize())
        missing_from_monthly = sorted(dedicated_dates - monthly_dates)
        print(
            f"{ticker} dedicated-minus-monthly event dates={len(missing_from_monthly)} "
            f"sample={[date.date().isoformat() for date in missing_from_monthly[:20]]}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tickers", nargs="*", default=DEFAULT_TICKERS)
    args = parser.parse_args()
    for ticker in args.tickers:
        diagnose(str(ticker).upper())


if __name__ == "__main__":
    main()
