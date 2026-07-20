from __future__ import annotations

import csv
import json
import math
from bisect import bisect_right
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

SIGNAL_VERSION = "tv_wilder_rsi14_sma5_v1"
SIGNAL_NAME = "月足RSI14 × RSI14の5か月SMA"
SIGNAL_DEFINITION = {
    "version": SIGNAL_VERSION,
    "timeframe": "1M",
    "source": "completed_month_close",
    "rsi_length": 14,
    "rsi_smoothing": "Wilder RMA",
    "signal_average_type": "SMA",
    "signal_average_length": 5,
    "active_condition": "monthly_rsi14 > monthly_rsi_ma5",
    "new_condition": "monthly_rsi14 crosses above monthly_rsi_ma5",
    "out_condition": "monthly_rsi14 <= monthly_rsi_ma5 after being active",
    "reference": "https://note.com/kabu_ojisan/n/n995f24384ab7",
}

DIVIDEND_FIELDS = [
    "forward_annual_dividend",
    "trailing_annual_dividend",
    "dividend_change_pct",
]


def _numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype(float)


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _rounded(value: Any, digits: int = 2) -> float | None:
    number = _to_float(value)
    return round(number, digits) if number is not None else None


def normalize_dividend_yield(
    raw_yield: Any,
    forward_annual_dividend: Any = None,
    current_price: Any = None,
) -> float | None:
    """Normalize Yahoo's changing dividend-yield units.

    Prefer the reproducible annual-dividend/current-price calculation. When
    those fields are missing, treat very small values as ratios and ordinary
    values such as 0.82 as already expressed in percent.
    """
    annual = _to_float(forward_annual_dividend)
    price = _to_float(current_price)
    if annual is not None and annual >= 0 and price not in (None, 0):
        return round(annual / price * 100, 2)

    raw = _to_float(raw_yield)
    if raw is None:
        return None
    return round(raw * 100 if abs(raw) < 0.2 else raw, 2)


def calculate_dividend_change(
    forward_annual_dividend: Any,
    trailing_annual_dividend: Any,
) -> float | None:
    forward = _to_float(forward_annual_dividend)
    trailing = _to_float(trailing_annual_dividend)
    if forward is None or trailing in (None, 0):
        return None
    return round((forward / trailing - 1) * 100, 2)


def tradingview_rma(series: pd.Series, length: int) -> pd.Series:
    """Return Pine Script ``ta.rma`` compatible Wilder smoothing."""
    if length <= 0:
        raise ValueError("length must be positive")

    values = _numeric(series)
    result = pd.Series(np.nan, index=values.index, dtype=float)
    valid_positions = np.flatnonzero(values.notna().to_numpy())
    if len(valid_positions) < length:
        return result

    seed_positions = valid_positions[:length]
    seed_position = int(seed_positions[-1])
    result.iloc[seed_position] = float(values.iloc[seed_positions].mean())

    previous = result.iloc[seed_position]
    for position in range(seed_position + 1, len(values)):
        current = values.iloc[position]
        if pd.isna(current):
            result.iloc[position] = previous
            continue
        previous = (previous * (length - 1) + float(current)) / length
        result.iloc[position] = previous
    return result


def tradingview_rsi(series: pd.Series, length: int = 14) -> pd.Series:
    """Return TradingView/Pine ``ta.rsi(source, length)`` compatible RSI."""
    close = _numeric(series)
    change = close.diff()
    gain = change.clip(lower=0)
    loss = -change.clip(upper=0)

    average_gain = tradingview_rma(gain, length)
    average_loss = tradingview_rma(loss, length)
    rs = average_gain / average_loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)

    rsi = rsi.where(~((average_loss == 0) & (average_gain > 0)), 100.0)
    rsi = rsi.where(~((average_gain == 0) & (average_loss > 0)), 0.0)
    rsi = rsi.where(~((average_gain == 0) & (average_loss == 0)), 50.0)
    return rsi


def prepare_monthly_compat(frame: pd.DataFrame, current_period: pd.Period) -> pd.DataFrame:
    """Build the canonical signal while preserving temporary legacy aliases."""
    close = pd.to_numeric(frame.get("Close"), errors="coerce").dropna()
    if close.empty:
        return pd.DataFrame()

    work = pd.DataFrame({"close": close})
    if getattr(work.index, "tz", None) is not None:
        work.index = work.index.tz_localize(None)
    work["month"] = work.index.to_period("M")
    work = work[work["month"] < current_period]
    if work.empty:
        return pd.DataFrame()

    monthly = work.groupby("month", sort=True).last()
    monthly["monthly_rsi14"] = tradingview_rsi(monthly["close"], 14)
    monthly["monthly_rsi_ma5"] = monthly["monthly_rsi14"].rolling(5, min_periods=5).mean()
    monthly["monthly_rsi14_up"] = (
        monthly["monthly_rsi14"] > monthly["monthly_rsi14"].shift(1)
    ).where(monthly["monthly_rsi14"].shift(1).notna())
    monthly["monthly_rsi_ma5_up"] = (
        monthly["monthly_rsi_ma5"] > monthly["monthly_rsi_ma5"].shift(1)
    ).where(monthly["monthly_rsi_ma5"].shift(1).notna())

    monthly["rsi5"] = monthly["monthly_rsi14"]
    monthly["rsi14"] = monthly["monthly_rsi_ma5"]
    monthly["rsi5_up"] = monthly["monthly_rsi14_up"]
    monthly["rsi14_up"] = monthly["monthly_rsi_ma5_up"]

    monthly["condition"] = (
        (monthly["monthly_rsi14"] > monthly["monthly_rsi_ma5"])
        & monthly["monthly_rsi14"].notna()
        & monthly["monthly_rsi_ma5"].notna()
    )
    previous = monthly["condition"].shift(1, fill_value=False).astype(bool)
    monthly["new"] = monthly["condition"] & ~previous
    monthly["out"] = ~monthly["condition"] & previous
    return monthly


def _visible_date_after(month_value: Any, daily_dates: list[pd.Timestamp]) -> str | None:
    if not month_value or not daily_dates:
        return None
    try:
        month = pd.Period(str(month_value), freq="M")
    except (TypeError, ValueError):
        return None

    calendar_dates = [date.date() for date in daily_dates]
    month_end = month.end_time.date()
    if month_end < calendar_dates[0]:
        return None
    position = bisect_right(calendar_dates, month_end)
    if position >= len(daily_dates):
        return None
    return daily_dates[position].strftime("%Y-%m-%d")


def _future_highlights(record: dict[str, Any]) -> list[dict[str, Any]]:
    highlights: list[dict[str, Any]] = []
    earnings_date = record.get("next_earnings_date") or record.get("earnings_date_start")
    if earnings_date:
        highlights.append({
            "type": "EARNINGS",
            "date": earnings_date,
            "label": "次回決算予定日",
            "value": earnings_date,
            "detail": "Yahoo Finance掲載予定日",
        })

    ex_dividend_date = record.get("ex_dividend_date")
    if ex_dividend_date:
        highlights.append({
            "type": "RIGHTS",
            "date": ex_dividend_date,
            "label": "権利落ち予定日",
            "value": ex_dividend_date,
            "detail": "権利確定日そのものではありません",
        })

    forward = _to_float(record.get("forward_annual_dividend"))
    trailing = _to_float(record.get("trailing_annual_dividend"))
    change = _to_float(record.get("dividend_change_pct"))
    if forward is not None:
        highlights.append({
            "type": "DIVIDEND_FORECAST",
            "date": ex_dividend_date,
            "label": "予想年間配当",
            "value": round(forward, 2),
            "unit": "円",
            "detail": "Yahoo Financeの年間配当予想",
        })
    if change is not None:
        comparison = f"直近年間配当 {trailing:g}円との比較" if trailing is not None else "直近年間配当との比較"
        highlights.append({
            "type": "DIVIDEND_CHANGE",
            "date": ex_dividend_date,
            "label": "増配率",
            "value": round(change, 2),
            "unit": "%",
            "detail": comparison,
        })
    return highlights


def enhance_chart_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Repair visible GC/DC markers and add explicit future-event highlights."""
    if not isinstance(payload, dict):
        return payload

    daily_dates: list[pd.Timestamp] = []
    for row in payload.get("daily") or []:
        try:
            parsed = pd.Timestamp(row.get("date"))
        except Exception:
            continue
        if not pd.isna(parsed):
            daily_dates.append(parsed)
    daily_dates = sorted(set(daily_dates))

    events: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for episode in payload.get("episodes") or []:
        definitions = [("GC", episode.get("start_month"), episode.get("start_price"))]
        if episode.get("status") == "CLOSED" and episode.get("end_month"):
            definitions.append(("DC", episode.get("end_month"), episode.get("end_price")))
        for event_type, month, price in definitions:
            date = _visible_date_after(month, daily_dates)
            if not date:
                continue
            key = (event_type, str(month), date)
            if key in seen:
                continue
            seen.add(key)
            events.append({
                "type": event_type,
                "month": str(month),
                "date": date,
                "price": _rounded(price),
            })

    events.sort(key=lambda item: (item.get("date") or "", 0 if item.get("type") == "GC" else 1))
    payload["cross_events"] = events
    payload["gc_events"] = [event for event in events if event.get("type") == "GC"]
    payload["dc_events"] = [event for event in events if event.get("type") == "DC"]
    payload["future_highlights"] = _future_highlights(payload.get("record") or {})
    return payload


def install_into(legacy_module: Any) -> None:
    """Install the canonical signal and corrected detail-data generation."""
    legacy_module.calc_rsi = tradingview_rsi
    legacy_module.prepare_monthly = prepare_monthly_compat
    legacy_module.SIGNAL_VERSION = SIGNAL_VERSION
    legacy_module.SIGNAL_DEFINITION = SIGNAL_DEFINITION

    for strategy in getattr(legacy_module, "EXIT_STRATEGIES", []):
        if strategy.get("id") == "DC":
            strategy["name"] = "月足RSI14・5か月MAデッドクロス"
            strategy["rule"] = "月足RSI14が5か月MA以下"

    result_fields = getattr(legacy_module, "RESULT_FIELDS", [])
    insert_at = result_fields.index("dividend_yield_pct") if "dividend_yield_pct" in result_fields else len(result_fields)
    for field in reversed(DIVIDEND_FIELDS):
        if field not in result_fields:
            result_fields.insert(insert_at, field)
    if hasattr(legacy_module, "FUNDAMENTAL_FIELDS") and "per" in result_fields and "cosmos_focus" in result_fields:
        legacy_module.FUNDAMENTAL_FIELDS = result_fields[
            result_fields.index("per"):result_fields.index("cosmos_focus")
        ]
    legacy_module.FUNDAMENTALS_CACHE_VERSION = max(
        int(getattr(legacy_module, "FUNDAMENTALS_CACHE_VERSION", 0)),
        3,
    )

    def fetch_fundamental_enhanced(ticker_symbol: str) -> dict[str, Any]:
        ticker = legacy_module.yf.Ticker(ticker_symbol)
        info = ticker.get_info() or {}
        balance_sheet = ticker.balance_sheet
        assets = legacy_module.balance_sheet_value(balance_sheet, ["Total Assets", "TotalAssets"])
        equity = legacy_module.balance_sheet_value(
            balance_sheet,
            ["Stockholders Equity", "Total Equity Gross Minority Interest", "Common Stock Equity"],
        )
        equity_ratio = (equity / assets * 100) if equity is not None and assets not in (None, 0) else None

        forward_dividend = legacy_module.rounded(info.get("dividendRate"))
        trailing_dividend = legacy_module.rounded(info.get("trailingAnnualDividendRate"))
        dividend_change = calculate_dividend_change(forward_dividend, trailing_dividend)
        market_price = info.get("currentPrice") or info.get("regularMarketPrice")

        fields = {
            "name": info.get("shortName") or info.get("longName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "quote_type": info.get("quoteType"),
            "per": legacy_module.rounded(info.get("trailingPE")),
            "forward_per": legacy_module.rounded(info.get("forwardPE")),
            "pbr": legacy_module.rounded(info.get("priceToBook")),
            "book_value": legacy_module.rounded(info.get("bookValue")),
            "forward_annual_dividend": forward_dividend,
            "trailing_annual_dividend": trailing_dividend,
            "dividend_change_pct": dividend_change,
            "dividend_yield_pct": normalize_dividend_yield(
                info.get("dividendYield"), forward_dividend, market_price,
            ),
            "payout_ratio_pct": legacy_module.percentage(info.get("payoutRatio")),
            "roe_pct": legacy_module.percentage(info.get("returnOnEquity")),
            "roa_pct": legacy_module.percentage(info.get("returnOnAssets")),
            "profit_margin_pct": legacy_module.percentage(info.get("profitMargins")),
            "operating_margin_pct": legacy_module.percentage(info.get("operatingMargins")),
            "revenue_growth_pct": legacy_module.percentage(info.get("revenueGrowth")),
            "earnings_growth_pct": legacy_module.percentage(info.get("earningsGrowth")),
            "current_ratio": legacy_module.rounded(info.get("currentRatio")),
            "quick_ratio": legacy_module.rounded(info.get("quickRatio")),
            "debt_to_equity_pct": legacy_module.rounded(info.get("debtToEquity")),
            "equity_ratio_pct": legacy_module.rounded(equity_ratio),
            "market_cap_oku": legacy_module.oku(info.get("marketCap")),
            "enterprise_value_oku": legacy_module.oku(info.get("enterpriseValue")),
            "operating_cashflow_oku": legacy_module.oku(info.get("operatingCashflow")),
            "free_cashflow_oku": legacy_module.oku(info.get("freeCashflow")),
            "total_cash_oku": legacy_module.oku(info.get("totalCash")),
            "total_debt_oku": legacy_module.oku(info.get("totalDebt")),
            "ebitda_oku": legacy_module.oku(info.get("ebitda")),
            "beta": legacy_module.rounded(info.get("beta")),
            "shares_outstanding_million": legacy_module.million(info.get("sharesOutstanding")),
            "next_earnings_date": legacy_module.unix_date(info.get("earningsTimestamp")),
            "earnings_date_start": legacy_module.unix_date(info.get("earningsTimestampStart")),
            "earnings_date_end": legacy_module.unix_date(info.get("earningsTimestampEnd")),
            "ex_dividend_date": legacy_module.unix_date(info.get("exDividendDate")),
            "last_dividend_date": legacy_module.unix_date(info.get("lastDividendDate")),
        }
        completeness_excluded = {
            "name", "sector", "industry", "quote_type",
            "next_earnings_date", "earnings_date_start", "earnings_date_end",
            "ex_dividend_date", "last_dividend_date",
        }
        completeness_fields = [key for key in fields if key not in completeness_excluded]
        available = sum(fields.get(key) is not None for key in completeness_fields)
        fields["data_completeness_pct"] = round(available / len(completeness_fields) * 100, 1)
        return fields

    legacy_module.fetch_fundamental = fetch_fundamental_enhanced

    original_build_chart_payload = legacy_module.build_chart_payload

    def build_chart_payload_enhanced(
        record: dict[str, Any],
        daily: pd.DataFrame,
        monthly: pd.DataFrame,
    ) -> dict[str, Any]:
        return enhance_chart_payload(original_build_chart_payload(record, daily, monthly))

    legacy_module.build_chart_payload = build_chart_payload_enhanced


def rewrite_signal_text(value: str) -> str:
    """Rewrite legacy display wording into the canonical signal terminology."""
    text = str(value)
    replacements = (
        ("SMA RSI: monthly RSI5 > monthly RSI14", "TradingView Wilder RSI14 > RSI14 5-month SMA"),
        ("月足RSI5 > 月足RSI14", "月足RSI14 > RSI14の5か月SMA"),
        ("RSI5 > RSI14", "月足RSI14 > 5か月MA"),
        ("RSI5がRSI14以下", "月足RSI14が5か月MA以下"),
        ("RSI5がRSI14を上回る", "月足RSI14が5か月MAを上回る"),
        ("RSI5がRSI14", "月足RSI14が5か月MA"),
        ("RSI5≥60・RSI14上向き", "月足RSI14≥60・5か月MA上向き"),
        ("RSI5が60以上", "月足RSI14が60以上"),
        ("RSI14が上向き", "5か月MAが上向き"),
        ("RSI14上向き", "5か月MA上向き"),
        ("RSI5 最低値", "月足RSI14 最低値"),
        ("RSI5", "月足RSI14"),
    )
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def _add_canonical_aliases(item: dict[str, Any]) -> None:
    pairs = (
        ("rsi5", "monthly_rsi14"),
        ("rsi14", "monthly_rsi_ma5"),
        ("rsi5_up", "monthly_rsi14_up"),
        ("rsi14_up", "monthly_rsi_ma5_up"),
        ("start_rsi5", "start_monthly_rsi14"),
        ("start_rsi14", "start_monthly_rsi_ma5"),
        ("start_rsi5_up", "start_monthly_rsi14_up"),
        ("start_rsi14_up", "start_monthly_rsi_ma5_up"),
    )
    for legacy_key, canonical_key in pairs:
        if legacy_key in item and canonical_key not in item:
            item[canonical_key] = item.get(legacy_key)
    if "diff" in item and ("rsi5" in item or "monthly_rsi14" in item):
        item.setdefault("monthly_rsi_spread", item.get("diff"))


def canonicalize_payload(value: Any) -> Any:
    if isinstance(value, dict):
        converted = {key: canonicalize_payload(item) for key, item in value.items()}
        _add_canonical_aliases(converted)
        return converted
    if isinstance(value, list):
        return [canonicalize_payload(item) for item in value]
    if isinstance(value, str):
        return rewrite_signal_text(value)
    return value


def _metadata() -> dict[str, Any]:
    return {
        "signal_version": SIGNAL_VERSION,
        "signal_name": SIGNAL_NAME,
        "signal_definition": SIGNAL_DEFINITION,
        "compatibility_aliases": {
            "rsi5": "monthly_rsi14",
            "rsi14": "monthly_rsi_ma5",
            "rsi5_up": "monthly_rsi14_up",
            "rsi14_up": "monthly_rsi_ma5_up",
        },
    }


def postprocess_json(path: Path) -> None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    converted = canonicalize_payload(payload)
    if isinstance(converted, dict):
        if path.parent.name == "charts":
            converted = enhance_chart_payload(converted)
        for key, value in _metadata().items():
            converted[key] = value
    path.write_text(json.dumps(converted, ensure_ascii=False, indent=2), encoding="utf-8")


def postprocess_csv(path: Path) -> None:
    if not path.exists():
        return
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            rows = list(reader)
            fields = list(reader.fieldnames or [])
    except OSError:
        return
    if not fields:
        return

    canonical_fields = [
        "signal_version",
        "monthly_rsi14",
        "monthly_rsi_ma5",
        "monthly_rsi14_up",
        "monthly_rsi_ma5_up",
        "monthly_rsi_spread",
    ]
    output_fields = fields + [field for field in canonical_fields if field not in fields]
    for row in rows:
        row["signal_version"] = SIGNAL_VERSION
        row["monthly_rsi14"] = row.get("rsi5", "")
        row["monthly_rsi_ma5"] = row.get("rsi14", "")
        row["monthly_rsi14_up"] = row.get("rsi5_up", "")
        row["monthly_rsi_ma5_up"] = row.get("rsi14_up", "")
        row["monthly_rsi_spread"] = row.get("diff", "")
        for key, value in tuple(row.items()):
            if isinstance(value, str):
                row[key] = rewrite_signal_text(value)

    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=output_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def clear_incompatible_outputs(root: Path) -> None:
    """Remove old-signal generated files before a full migration rebuild."""
    direct = [root / "result.csv", root / "out.csv", root / "data" / "latest.json", root / "data" / "analysis.json"]
    for path in direct:
        path.unlink(missing_ok=True)
    for pattern in ("data/months/*.json", "data/charts/*.json", "history/*.json", "history/*.csv"):
        for path in root.glob(pattern):
            path.unlink(missing_ok=True)


def postprocess_outputs(root: Path) -> None:
    json_paths = [root / "data" / "latest.json", root / "data" / "analysis.json"]
    json_paths += list((root / "data" / "months").glob("*.json"))
    json_paths += list((root / "data" / "charts").glob("*.json"))
    json_paths += list((root / "history").glob("*.json"))
    for path in json_paths:
        if path.name == "fundamentals_cache.json":
            continue
        postprocess_json(path)

    csv_paths = [root / "result.csv", root / "out.csv"]
    csv_paths += list((root / "history").glob("*.csv"))
    for path in csv_paths:
        postprocess_csv(path)


def values_close(left: float | None, right: float | None, tolerance: float = 1e-9) -> bool:
    if left is None or right is None:
        return left is right
    if math.isnan(left) or math.isnan(right):
        return math.isnan(left) and math.isnan(right)
    return abs(left - right) <= tolerance
