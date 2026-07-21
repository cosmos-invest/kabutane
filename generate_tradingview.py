from __future__ import annotations

import os
from pathlib import Path

# Keep local/manual generation consistent with the production workflow. These
# values must be set before importing the legacy pipeline because it reads its
# configuration into module-level constants at import time.
os.environ.setdefault("HISTORY_MONTHS", "60")
os.environ.setdefault("MONTHLY_PERIOD", "max")
os.environ.setdefault("DAILY_PERIOD", "3y")
os.environ.setdefault("ANALYSIS_DAILY_PERIOD", "5y")

import test as legacy_pipeline

from benchmark_support import install_into as install_benchmark_support
from tradingview_signal import (
    SIGNAL_NAME,
    SIGNAL_VERSION,
    clear_incompatible_outputs,
    install_into,
    postprocess_outputs,
)


def install_cache_only_fundamentals() -> None:
    """Reuse the free Yahoo cache without issuing thousands of profile calls.

    Price and volume remain refreshed normally. Financial fields are best-effort
    cached values and earnings schedule fields are intentionally disabled.
    """

    original = legacy_pipeline.enrich_fundamentals

    def enrich(records, errors):
        if os.getenv("SKIP_FUNDAMENTALS", "0") != "1":
            return original(records, errors)
        cache = legacy_pipeline.load_cache()
        merged = 0
        for record in records:
            entry = cache.get(record.get("ticker"))
            if not isinstance(entry, dict) or not isinstance(entry.get("data"), dict):
                record.setdefault("data_completeness_pct", 0)
                continue
            configured_name = record.get("name")
            record.update(entry["data"])
            if configured_name:
                record["name"] = configured_name
            for field in ("next_earnings_date", "earnings_date_start", "earnings_date_end"):
                record[field] = None
            merged += 1
        print(f"財務情報: Yahooキャッシュのみ利用（{merged}/{len(records)}銘柄、外部再取得なし）")

    legacy_pipeline.enrich_fundamentals = enrich


def main() -> None:
    root = Path(__file__).resolve().parent
    print(f"Installing signal definition: {SIGNAL_NAME} ({SIGNAL_VERSION})")
    install_into(legacy_pipeline)
    install_benchmark_support(legacy_pipeline)
    install_cache_only_fundamentals()

    # The previous RSI5-vs-RSI14 history is not comparable with the new
    # TradingView-compatible definition. Rebuild generated outputs as one
    # coherent version rather than mixing both methodologies.
    clear_incompatible_outputs(root)
    legacy_pipeline.main()
    postprocess_outputs(root)
    print(f"Generated all public data with signal_version={SIGNAL_VERSION}")


if __name__ == "__main__":
    main()
