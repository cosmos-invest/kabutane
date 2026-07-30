from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent
MANIFEST_FILE = ROOT / "data" / "curated" / "shikiho-2026-summer.json"
OUTPUT_FILE = ROOT / "data" / "curated" / "shikiho-2026-summer-performance.json"
STOCKS_FILE = ROOT / "stocks.csv"
LATEST_FILE = ROOT / "data" / "latest.json"
BENCHMARK_TICKER = "1306.T"
BENCHMARK_NAME = "TOPIX連動ETF（1306）"
JST = ZoneInfo("Asia/Tokyo")


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def round_number(value: Any, digits: int = 4) -> float | None:
    number = finite(value)
    return None if number is None else round(number, digits)


def normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame()
    work = frame.copy()
    if isinstance(work.columns, pd.MultiIndex):
        if len(set(work.columns.get_level_values(-1))) == 1:
            work.columns = work.columns.get_level_values(0)
        else:
            work.columns = [column[0] for column in work.columns]
    work.index = pd.to_datetime(work.index, errors="coerce")
    work = work[~work.index.isna()].sort_index()
    work = work[~work.index.duplicated(keep="last")]
    for column in ("Close", "Dividends", "Stock Splits"):
        if column not in work.columns:
            work[column] = 0.0 if column != "Close" else float("nan")
        work[column] = pd.to_numeric(work[column], errors="coerce")
    return work


def split_adjusted_history(frame: pd.DataFrame) -> pd.DataFrame:
    """Return closes and dividends on the latest-share basis without dividends in price return."""
    work = normalize_frame(frame)
    if work.empty:
        return pd.DataFrame()
    close = work["Close"]
    dividends = work["Dividends"].fillna(0.0)
    splits = work["Stock Splits"].fillna(0.0)
    adjusted_close: dict[pd.Timestamp, float] = {}
    adjusted_dividend: dict[pd.Timestamp, float] = {}
    future_split_factor = 1.0
    for timestamp in reversed(work.index.tolist()):
        price = finite(close.loc[timestamp])
        dividend = finite(dividends.loc[timestamp]) or 0.0
        if price is not None and future_split_factor > 0:
            adjusted_close[timestamp] = price / future_split_factor
            adjusted_dividend[timestamp] = dividend / future_split_factor
        split_ratio = finite(splits.loc[timestamp]) or 0.0
        if split_ratio > 0:
            future_split_factor *= split_ratio
    result = pd.DataFrame(index=work.index)
    result["close"] = pd.Series(adjusted_close)
    result["dividend"] = pd.Series(adjusted_dividend).fillna(0.0)
    result["split"] = splits
    return result.dropna(subset=["close"])


def download_history(ticker: str, start: date, end: date, retries: int = 3) -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            frame = yf.download(
                ticker,
                start=start.isoformat(),
                end=(end + timedelta(days=1)).isoformat(),
                interval="1d",
                auto_adjust=False,
                actions=True,
                progress=False,
                threads=False,
                timeout=40,
            )
            normalized = normalize_frame(frame)
            if not normalized.empty:
                return normalized
            last_error = RuntimeError("株価データが空でした。")
        except Exception as exc:  # pragma: no cover - network behavior
            last_error = exc
        if attempt + 1 < retries:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{ticker} の取得に失敗しました: {last_error}")


def first_on_or_after(series: pd.Series, target: date) -> tuple[pd.Timestamp, float] | None:
    candidates = series[series.index.date >= target]
    if candidates.empty:
        return None
    timestamp = candidates.index[0]
    return timestamp, float(candidates.iloc[0])


def last_on_or_before(series: pd.Series, target: date) -> tuple[pd.Timestamp, float] | None:
    candidates = series[series.index.date <= target]
    if candidates.empty:
        return None
    timestamp = candidates.index[-1]
    return timestamp, float(candidates.iloc[-1])


def performance_metrics(
    adjusted: pd.DataFrame,
    baseline_target: date,
    answer_target: date,
    today: date,
) -> dict[str, Any]:
    if adjusted.empty:
        raise ValueError("有効な株価履歴がありません。")
    close = adjusted["close"].dropna()
    baseline = first_on_or_after(close, baseline_target)
    if baseline is None:
        raise ValueError("基準日以降の株価がありません。")
    baseline_timestamp, baseline_price = baseline
    observation = last_on_or_before(close, today)
    if observation is None:
        raise ValueError("観察日時点の株価がありません。")
    observation_timestamp, observation_price = observation
    answered = today >= answer_target
    scoring_target = answer_target if answered else today
    scoring = last_on_or_before(close, scoring_target)
    if scoring is None:
        raise ValueError("評価日時点の株価がありません。")
    scoring_timestamp, scoring_price = scoring
    score_window = close[(close.index >= baseline_timestamp) & (close.index <= scoring_timestamp)]
    observation_window = close[(close.index >= baseline_timestamp) & (close.index <= observation_timestamp)]
    if score_window.empty:
        raise ValueError("評価期間の株価がありません。")
    score_returns = (score_window / baseline_price - 1.0) * 100.0
    running_peak = score_window.cummax()
    drawdowns = (score_window / running_peak - 1.0) * 100.0
    dividends = adjusted.loc[
        (adjusted.index >= baseline_timestamp) & (adjusted.index <= scoring_timestamp), "dividend"
    ].sum()
    split_rows = adjusted.loc[
        (adjusted.index >= baseline_timestamp) & (adjusted.index <= observation_timestamp)
        & (adjusted["split"] > 0),
        "split",
    ]
    path = [
        {"date": timestamp.date().isoformat(), "return_pct": round_number(value, 4)}
        for timestamp, value in ((observation_window / baseline_price - 1.0) * 100.0).items()
    ]
    return {
        "phase": "answered" if answered else "observing",
        "baseline_target_date": baseline_target.isoformat(),
        "baseline_date": baseline_timestamp.date().isoformat(),
        "baseline_price": round_number(baseline_price, 4),
        "performance_date": scoring_timestamp.date().isoformat(),
        "performance_price": round_number(scoring_price, 4),
        "return_pct": round_number((scoring_price / baseline_price - 1.0) * 100.0, 4),
        "high_return_pct": round_number(score_returns.max(), 4),
        "low_return_pct": round_number(score_returns.min(), 4),
        "max_drawdown_pct": round_number(drawdowns.min(), 4),
        "dividend_per_current_share": round_number(dividends, 4),
        "split_events": [
            {"date": timestamp.date().isoformat(), "ratio": round_number(value, 6)}
            for timestamp, value in split_rows.items()
        ],
        "answer_target_date": answer_target.isoformat(),
        "answer_date": scoring_timestamp.date().isoformat() if answered else None,
        "latest_date": observation_timestamp.date().isoformat(),
        "latest_price": round_number(observation_price, 4),
        "latest_return_pct": round_number((observation_price / baseline_price - 1.0) * 100.0, 4),
        "path": path,
    }


def load_stock_metadata() -> dict[str, dict[str, str]]:
    if not STOCKS_FILE.exists():
        return {}
    frame = pd.read_csv(STOCKS_FILE, dtype=str).fillna("")
    result: dict[str, dict[str, str]] = {}
    for row in frame.to_dict(orient="records"):
        code = str(row.get("code") or "").strip().upper()
        if code:
            result[code] = {
                "official_name": str(row.get("name") or "").strip(),
                "market": str(row.get("market") or "").strip(),
                "sector": str(row.get("sector") or "").strip(),
            }
    return result


def load_signal_metadata() -> dict[str, dict[str, Any]]:
    latest = read_json(LATEST_FILE, {})
    return {
        str(record.get("code")): {
            "status": record.get("status"),
            "signal_month": record.get("signal_month"),
            "rsi14": record.get("rsi5"),
            "rsi14_ma5": record.get("rsi14"),
        }
        for record in latest.get("records") or []
        if record.get("code")
    }


def group_summary(records: list[dict[str, Any]], tier: str | None = None) -> dict[str, Any]:
    rows = [row for row in records if tier is None or row.get("tier") == tier]
    values = [finite(row.get("return_pct")) for row in rows]
    values = [value for value in values if value is not None]
    sorted_rows = sorted(
        [row for row in rows if finite(row.get("return_pct")) is not None],
        key=lambda row: float(row["return_pct"]),
        reverse=True,
    )
    return {
        "tier": tier or "ALL",
        "count": len(rows),
        "priced_count": len(values),
        "average_return_pct": round_number(sum(values) / len(values), 4) if values else None,
        "median_return_pct": round_number(median(values), 4) if values else None,
        "up_count": sum(1 for value in values if value > 0),
        "flat_count": sum(1 for value in values if value == 0),
        "down_count": sum(1 for value in values if value < 0),
        "best": {
            "code": sorted_rows[0].get("code"),
            "name": sorted_rows[0].get("display_name") or sorted_rows[0].get("name"),
            "return_pct": sorted_rows[0].get("return_pct"),
        } if sorted_rows else None,
        "worst": {
            "code": sorted_rows[-1].get("code"),
            "name": sorted_rows[-1].get("display_name") or sorted_rows[-1].get("name"),
            "return_pct": sorted_rows[-1].get("return_pct"),
        } if sorted_rows else None,
    }


def basket_path(records: list[dict[str, Any]], tier: str | None = None) -> list[dict[str, Any]]:
    paths: list[pd.Series] = []
    for record in records:
        if tier is not None and record.get("tier") != tier:
            continue
        points = record.get("path") or []
        if not points:
            continue
        series = pd.Series(
            {pd.Timestamp(point["date"]): finite(point.get("return_pct")) for point in points},
            dtype=float,
        ).dropna()
        if not series.empty:
            paths.append(series)
    if not paths:
        return []
    frame = pd.concat(paths, axis=1).sort_index().ffill()
    average = frame.mean(axis=1, skipna=True)
    return [
        {"date": timestamp.date().isoformat(), "return_pct": round_number(value, 4)}
        for timestamp, value in average.items()
    ]


def build_payload(today: date | None = None) -> dict[str, Any]:
    manifest = read_json(MANIFEST_FILE, {})
    stocks = list(manifest.get("stocks") or [])
    expected = int(manifest.get("expected_count") or 0)
    if len(stocks) != expected:
        raise RuntimeError(f"固定銘柄数が不一致です: {len(stocks)} != {expected}")
    baseline_target = date.fromisoformat(manifest["baseline_date"])
    answer_target = date.fromisoformat(manifest["answer_target_date"])
    today = today or datetime.now(JST).date()
    start = baseline_target - timedelta(days=14)
    metadata = load_stock_metadata()
    signals = load_signal_metadata()
    previous = read_json(OUTPUT_FILE, {})
    previous_map = {str(row.get("code")): row for row in previous.get("records") or []}
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for stock in stocks:
        code = str(stock["code"])
        record = dict(stock)
        record.update(metadata.get(code, {}))
        record["signal"] = signals.get(code)
        try:
            history = download_history(str(stock["ticker"]), start, today)
            metrics = performance_metrics(
                split_adjusted_history(history), baseline_target, answer_target, today
            )
            record.update(metrics)
            record["data_error"] = None
        except Exception as exc:  # pragma: no cover - network behavior
            fallback = previous_map.get(code)
            if fallback:
                for key, value in fallback.items():
                    if key not in record or key in {
                        "phase", "baseline_date", "baseline_price", "performance_date",
                        "performance_price", "return_pct", "high_return_pct", "low_return_pct",
                        "max_drawdown_pct", "dividend_per_current_share", "split_events",
                        "answer_date", "latest_date", "latest_price", "latest_return_pct", "path",
                    }:
                        record[key] = value
            record["data_error"] = str(exc)
            errors.append({"code": code, "ticker": str(stock["ticker"]), "error": str(exc)})
        records.append(record)

    benchmark: dict[str, Any] | None = None
    try:
        history = download_history(BENCHMARK_TICKER, start, today)
        benchmark = {
            "ticker": BENCHMARK_TICKER,
            "name": BENCHMARK_NAME,
            **performance_metrics(split_adjusted_history(history), baseline_target, answer_target, today),
        }
    except Exception as exc:  # pragma: no cover - network behavior
        old_benchmark = previous.get("benchmark")
        benchmark = old_benchmark if old_benchmark else {"ticker": BENCHMARK_TICKER, "name": BENCHMARK_NAME, "data_error": str(exc)}
        errors.append({"code": "BENCHMARK", "ticker": BENCHMARK_TICKER, "error": str(exc)})

    summaries = {tier: group_summary(records, None if tier == "ALL" else tier) for tier in ("ALL", "S", "A", "B")}
    paths = {tier: basket_path(records, None if tier == "ALL" else tier) for tier in ("ALL", "S", "A", "B")}
    all_return = finite(summaries["ALL"].get("average_return_pct"))
    benchmark_return = finite((benchmark or {}).get("return_pct"))
    if all_return is not None and benchmark_return is not None:
        summaries["ALL"]["benchmark_difference_pct"] = round_number(all_return - benchmark_return, 4)
    else:
        summaries["ALL"]["benchmark_difference_pct"] = None

    price_dates = [str(row.get("latest_date")) for row in records if row.get("latest_date")]
    generated_at = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": 1,
        "edition": manifest.get("edition"),
        "title": manifest.get("title"),
        "generated_at": generated_at,
        "latest_price_date": max(price_dates) if price_dates else None,
        "baseline_date": manifest.get("baseline_date"),
        "answer_target_date": manifest.get("answer_target_date"),
        "phase": "answered" if today >= answer_target else "observing",
        "expected_count": expected,
        "record_count": len(records),
        "complete_count": sum(1 for row in records if finite(row.get("return_pct")) is not None),
        "error_count": len(errors),
        "errors": errors,
        "summaries": summaries,
        "basket_paths": paths,
        "benchmark": benchmark,
        "records": records,
        "source": "Yahoo Finance via yfinance",
        "price_return_policy": "株式分割のみ補正した終値ベース。配当は別項目。",
        "disclaimer": "四季報2026年夏号発売翌日の定点観測であり、買い推奨や紹介後成績ではありません。",
    }


def main() -> None:
    payload = build_payload()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Shikiho room updated: records={payload['record_count']}, "
        f"complete={payload['complete_count']}, errors={payload['error_count']}, "
        f"latest={payload['latest_price_date']}"
    )


if __name__ == "__main__":
    main()
