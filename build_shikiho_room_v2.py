from __future__ import annotations

"""Corrected entry point for the summer Shikiho observation room.

Yahoo Finance's historical ``Close`` series is already adjusted for stock
splits, while it is not adjusted for cash dividends.  The original builder
applied the split ratio a second time, which could create artificial returns
of several hundred percent around a split date.  This module keeps ``Close``
directly, preserves dividend and split events as separate fields, and then
runs the existing payload builder.
"""

import pandas as pd

import build_shikiho_room as room


def split_adjusted_history(frame: pd.DataFrame) -> pd.DataFrame:
    """Return Yahoo split-adjusted closes without dividend reinvestment."""
    work = room.normalize_frame(frame)
    if work.empty:
        return pd.DataFrame()
    result = pd.DataFrame(index=work.index)
    result["close"] = pd.to_numeric(work["Close"], errors="coerce")
    result["dividend"] = pd.to_numeric(work["Dividends"], errors="coerce").fillna(0.0)
    result["split"] = pd.to_numeric(work["Stock Splits"], errors="coerce").fillna(0.0)
    return result.dropna(subset=["close"])


# build_payload resolves this function from the original module at runtime.
room.split_adjusted_history = split_adjusted_history


def main() -> None:
    room.main()


if __name__ == "__main__":
    main()
