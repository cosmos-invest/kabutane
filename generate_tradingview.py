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

from tradingview_signal import (
    SIGNAL_NAME,
    SIGNAL_VERSION,
    clear_incompatible_outputs,
    install_into,
    postprocess_outputs,
)


def main() -> None:
    root = Path(__file__).resolve().parent
    print(f"Installing signal definition: {SIGNAL_NAME} ({SIGNAL_VERSION})")
    install_into(legacy_pipeline)

    # The previous RSI5-vs-RSI14 history is not comparable with the new
    # TradingView-compatible definition. Rebuild generated outputs as one
    # coherent version rather than mixing both methodologies.
    clear_incompatible_outputs(root)
    legacy_pipeline.main()
    postprocess_outputs(root)
    print(f"Generated all public data with signal_version={SIGNAL_VERSION}")


if __name__ == "__main__":
    main()
