from __future__ import annotations

import unittest

import pandas as pd

from dividend_history import build_dividend_history


def frame_for_years(values: dict[int, float], splits: dict[str, float] | None = None) -> pd.DataFrame:
    dates = []
    dividends = []
    split_values = []
    splits = splits or {}
    for year, annual in values.items():
        for month in range(1, 13):
            date = pd.Timestamp(year=year, month=month, day=1)
            dates.append(date)
            dividends.append(float(annual) if month == 6 else 0.0)
            split_values.append(float(splits.get(date.strftime("%Y-%m-%d"), 0.0)))
    return pd.DataFrame({"Close": 100.0, "Dividends": dividends, "Stock Splits": split_values}, index=dates)


class DividendHistoryTests(unittest.TestCase):
    NOW = pd.Timestamp("2026-08-19")

    def test_five_year_growth_counts_and_cagr(self):
        frame = frame_for_years({2021: 20, 2022: 22, 2023: 24, 2024: 27, 2025: 30})
        result = build_dividend_history(frame, now=self.NOW)
        self.assertEqual(result["consecutive_increase_years"], 4)
        self.assertEqual(result["increase_count_5y"], 4)
        self.assertEqual(result["cut_count_5y"], 0)
        self.assertEqual(result["flat_count_5y"], 0)
        self.assertTrue(result["no_cut_5y"])
        self.assertGreater(result["cagr_5y_pct"], 10)

    def test_cut_and_flat_reset_streak(self):
        frame = frame_for_years({2021: 20, 2022: 24, 2023: 24, 2024: 18, 2025: 19})
        result = build_dividend_history(frame, now=self.NOW)
        self.assertEqual(result["consecutive_increase_years"], 1)
        self.assertEqual(result["increase_count_5y"], 2)
        self.assertEqual(result["flat_count_5y"], 1)
        self.assertEqual(result["cut_count_5y"], 1)
        self.assertFalse(result["no_cut_5y"])
        self.assertLess(result["max_cut_pct_5y"], 0)

    def test_later_split_normalizes_older_dividend(self):
        frame = frame_for_years(
            {2021: 100, 2022: 110, 2023: 60, 2024: 65, 2025: 70},
            splits={"2023-01-01": 2.0},
        )
        result = build_dividend_history(frame, now=self.NOW)
        history = {row["year"]: row["annual_dividend"] for row in result["history"]}
        self.assertEqual(history[2021], 50.0)
        self.assertEqual(history[2022], 55.0)
        self.assertEqual(history[2023], 60.0)
        self.assertEqual(result["cut_count_5y"], 0)
        self.assertEqual(result["consecutive_increase_years"], 4)

    def test_current_partial_year_is_excluded(self):
        frame = frame_for_years({2022: 20, 2023: 22, 2024: 24, 2025: 26, 2026: 5})
        result = build_dividend_history(frame, now=self.NOW)
        years = [row["year"] for row in result["history"]]
        self.assertNotIn(2026, years)
        self.assertEqual(years[-1], 2025)

    def test_partial_first_year_is_excluded(self):
        frame = frame_for_years({2021: 10, 2022: 12, 2023: 14, 2024: 16, 2025: 18})
        frame = frame.loc[frame.index >= pd.Timestamp("2021-08-01")]
        result = build_dividend_history(frame, now=self.NOW)
        self.assertEqual(result["history"][0]["year"], 2022)

    def test_history_is_capped_at_50_complete_years(self):
        values = {year: float(year - 1975) for year in range(1976, 2026)}
        frame = frame_for_years(values)
        result = build_dividend_history(frame, now=self.NOW)
        self.assertEqual(result["observation_years"], 50)
        self.assertEqual(result["history_start_year"], 1976)
        self.assertEqual(result["history_end_year"], 2025)
        self.assertEqual(len(result["history"]), 50)
        self.assertEqual(result["consecutive_increase_years"], 49)

    def test_older_than_50_years_is_trimmed_before_streak_calculation(self):
        values = {year: float(year - 1965) for year in range(1966, 2026)}
        frame = frame_for_years(values)
        result = build_dividend_history(frame, now=self.NOW)
        self.assertEqual(result["observation_years"], 50)
        self.assertEqual(result["history_start_year"], 1976)
        self.assertEqual(result["consecutive_increase_years"], 49)


if __name__ == "__main__":
    unittest.main()
