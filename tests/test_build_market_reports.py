"""Compatibility entry point for the canonical market report tests.

The implementation and assertions remain in test_market_reports.py. This file
keeps CI references stable while running exactly the same test definitions.
"""

from pathlib import Path

_CANONICAL_TEST = Path(__file__).with_name("test_market_reports.py")
exec(compile(_CANONICAL_TEST.read_text(encoding="utf-8"), str(_CANONICAL_TEST), "exec"))
