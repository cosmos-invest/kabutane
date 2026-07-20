from __future__ import annotations

import csv
import json
import math
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


def _numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype(float)


def tradingview_rma(series: pd.Series, length: int) -> pd.Series:
    """Return Pine Script ``ta.rma`` compatible Wilder smoothing.

    TradingView seeds RMA with an SMA over the first ``length`` non-null
    observations, then applies ``alpha = 1 / length`` recursively. Missing
    observations retain the previous smoothed value, matching Pine's practical
    behavior for the gain/loss series used by RSI.
    """
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
    """Build the canonical signal while preserving temporary legacy aliases.

    Canonical values:
      - ``monthly_rsi14``: TradingView-compatible Wilder RSI14
      - ``monthly_rsi_ma5``: five-month SMA of that RSI14

    The existing application historically expects ``rsi5`` as its fast line
    and ``rsi14`` as its slow line. During the schema migration those two keys
    are compatibility aliases only:
      - ``rsi5`` -> ``monthly_rsi14``
      - ``rsi14`` -> ``monthly_rsi_ma5``

    All generated public files are post-processed to include the canonical
    field names and an explicit signal version.
    """
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

    # Compatibility aliases used by the existing downstream pipeline.
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


def install_into(legacy_module: Any) -> None:
    """Install the canonical signal into the existing data pipeline."""
    legacy_module.calc_rsi = tradingview_rsi
    legacy_module.prepare_monthly = prepare_monthly_compat
    legacy_module.SIGNAL_VERSION = SIGNAL_VERSION
    legacy_module.SIGNAL_DEFINITION = SIGNAL_DEFINITION

    for strategy in getattr(legacy_module, "EXIT_STRATEGIES", []):
        if strategy.get("id") == "DC":
            strategy["name"] = "月足RSI14・5か月MAデッドクロス"
            strategy["rule"] = "月足RSI14が5か月MA以下"


def rewrite_signal_text(value: str) -> str:
    """Rewrite legacy display wording into the canonical signal terminology."""
    text = str(value)
    replacements = (
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
