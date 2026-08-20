from __future__ import annotations

import io
import unittest
import zipfile

import pandas as pd

from dividend_history import apply_verified_streak, build_dividend_history, public_dividend_fields
from fiscal_year_calendar import parse_edinet_code_zip


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


def march_fiscal_frame() -> pd.DataFrame:
    index = pd.date_range("2021-04-01", "2026-03-01", freq="MS")
    frame = pd.DataFrame({"Close": 100.0, "Dividends": 0.0, "Stock Splits": 0.0}, index=index)
    # Fiscal totals (Mar year): 10, 12, 14, 16, 18. Calendar totals intentionally zig-zag.
    events = {
        "2021-09-01": 1.0, "2022-03-01": 9.0,
        "2022-09-01": 8.0, "2023-03-01": 4.0,
        "2023-09-01": 2.0, "2024-03-01": 12.0,
        "2024-09-01": 10.0, "2025-03-01": 6.0,
        "2025-09-01": 3.0, "2026-03-01": 15.0,
    }
    for date, value in events.items():
        frame.loc[pd.Timestamp(date), "Dividends"] = value
    return frame


class DividendHistoryTests(unittest.TestCase):
    NOW = pd.Timestamp("2026-08-19")

    def test_five_year_growth_counts_and_cagr(self):
        result = build_dividend_history(frame_for_years({2021: 20, 2022: 22, 2023: 24, 2024: 27, 2025: 30}), now=self.NOW)
        self.assertEqual(result["consecutive_increase_years"], 4)
        self.assertEqual(result["increase_count_5y"], 4)
        self.assertEqual(result["cut_count_5y"], 0)
        self.assertEqual(result["flat_count_5y"], 0)
        self.assertTrue(result["no_cut_5y"])
        self.assertGreater(result["cagr_5y_pct"], 10)

    def test_cut_and_flat_reset_streak(self):
        result = build_dividend_history(frame_for_years({2021: 20, 2022: 24, 2023: 24, 2024: 18, 2025: 19}), now=self.NOW)
        self.assertEqual(result["consecutive_increase_years"], 1)
        self.assertEqual(result["increase_count_5y"], 2)
        self.assertEqual(result["flat_count_5y"], 1)
        self.assertEqual(result["cut_count_5y"], 1)
        self.assertFalse(result["no_cut_5y"])
        self.assertLess(result["max_cut_pct_5y"], 0)

    def test_yahoo_split_adjusted_dividends_are_not_adjusted_twice(self):
        result = build_dividend_history(frame_for_years({2021: 50, 2022: 55, 2023: 60, 2024: 65, 2025: 70}, splits={"2023-01-01": 2.0}), now=self.NOW)
        history = {row["year"]: row["annual_dividend"] for row in result["history"]}
        self.assertEqual(history[2021], 50.0)
        self.assertEqual(history[2022], 55.0)
        self.assertEqual(history[2023], 60.0)
        self.assertEqual(result["cut_count_5y"], 0)
        self.assertEqual(result["consecutive_increase_years"], 4)

    def test_batch_union_empty_rows_do_not_fake_observation_years(self):
        index = pd.date_range("2000-01-01", "2025-12-01", freq="MS")
        frame = pd.DataFrame({"Close": float("nan"), "Dividends": 0.0, "Stock Splits": 0.0}, index=index)
        frame.loc[frame.index >= pd.Timestamp("2019-12-01"), "Close"] = 100.0
        for year, amount in {2020: 10, 2021: 11, 2022: 12, 2023: 13, 2024: 14, 2025: 15}.items():
            frame.loc[pd.Timestamp(year=year, month=6, day=1), "Dividends"] = amount
        result = build_dividend_history(frame, now=self.NOW)
        self.assertEqual(result["history_start_year"], 2020)
        self.assertEqual(result["observation_years"], 6)
        self.assertEqual(result["consecutive_increase_years"], 5)

    def test_verified_company_streak_can_override_observed_streak(self):
        summary = build_dividend_history(frame_for_years({2021: 20, 2022: 22, 2023: 24, 2024: 26, 2025: 28}), now=self.NOW)
        result = apply_verified_streak(summary, {
            "consecutive_increase_years": 36,
            "as_of_year": 2025,
            "basis": "company_official_fiscal_year",
            "source": "Kao Corporation shareholder return",
            "source_url": "https://www.kao.com/jp/investor-relations/stock-information/shareholder-return/",
        })
        self.assertEqual(result["consecutive_increase_years"], 36)
        self.assertEqual(result["observed_consecutive_increase_years"], 4)
        self.assertTrue(result["streak_verified"])
        self.assertFalse(result["streak_lower_bound"])
        self.assertEqual(result["streak_as_of_year"], 2025)

    def test_stale_verified_override_is_not_carried_forward(self):
        summary = build_dividend_history(frame_for_years({2022: 20, 2023: 22, 2024: 24, 2025: 26, 2026: 28}), now=pd.Timestamp("2027-08-19"))
        result = apply_verified_streak(summary, {"consecutive_increase_years": 36, "as_of_year": 2025})
        self.assertFalse(result["streak_verified"])
        self.assertEqual(result["consecutive_increase_years"], result["observed_consecutive_increase_years"])

    def test_current_partial_calendar_year_is_excluded(self):
        result = build_dividend_history(frame_for_years({2022: 20, 2023: 22, 2024: 24, 2025: 26, 2026: 5}), now=self.NOW)
        years = [row["year"] for row in result["history"]]
        self.assertNotIn(2026, years)
        self.assertEqual(years[-1], 2025)

    def test_partial_first_calendar_year_is_excluded(self):
        frame = frame_for_years({2021: 10, 2022: 12, 2023: 14, 2024: 16, 2025: 18})
        result = build_dividend_history(frame.loc[frame.index >= pd.Timestamp("2021-08-01")], now=self.NOW)
        self.assertEqual(result["history"][0]["year"], 2022)

    def test_history_is_capped_at_50_complete_years(self):
        values = {year: float(year - 1975) for year in range(1976, 2026)}
        result = build_dividend_history(frame_for_years(values), now=self.NOW)
        self.assertEqual(result["observation_years"], 50)
        self.assertEqual(result["history_start_year"], 1976)
        self.assertEqual(result["history_end_year"], 2025)
        self.assertEqual(len(result["history"]), 50)
        self.assertEqual(result["consecutive_increase_years"], 49)

    def test_older_than_50_years_is_trimmed_before_streak_calculation(self):
        values = {year: float(year - 1965) for year in range(1966, 2026)}
        result = build_dividend_history(frame_for_years(values), now=self.NOW)
        self.assertEqual(result["observation_years"], 50)
        self.assertEqual(result["history_start_year"], 1976)
        self.assertEqual(result["consecutive_increase_years"], 49)

    def test_march_fiscal_year_groups_interim_and_year_end_dividends_together(self):
        frame = march_fiscal_frame()
        calendar = build_dividend_history(frame, now=self.NOW)
        fiscal = build_dividend_history(frame, now=self.NOW, fiscal_year_end_month=3)
        self.assertLess(calendar["consecutive_increase_years"], fiscal["consecutive_increase_years"])
        self.assertEqual(fiscal["basis"], "fiscal_year_ex_date")
        self.assertEqual(fiscal["history_start_year"], 2022)
        self.assertEqual(fiscal["history_end_year"], 2026)
        self.assertEqual([row["annual_dividend"] for row in fiscal["history"]], [10.0, 12.0, 14.0, 16.0, 18.0])
        self.assertEqual(fiscal["consecutive_increase_years"], 4)
        self.assertTrue(fiscal["streak_lower_bound"])

    def test_current_partial_fiscal_year_is_excluded(self):
        frame = march_fiscal_frame().copy()
        frame.loc[pd.Timestamp("2026-04-01"), ["Close", "Dividends", "Stock Splits"]] = [100.0, 100.0, 0.0]
        result = build_dividend_history(frame, now=self.NOW, fiscal_year_end_month=3)
        self.assertEqual(result["history_end_year"], 2026)
        self.assertNotIn(2027, [row["year"] for row in result["history"]])

    def test_public_fields_expose_fiscal_screening_provenance(self):
        summary = build_dividend_history(march_fiscal_frame(), now=self.NOW, fiscal_year_end_month=3)
        public = public_dividend_fields(summary)
        self.assertEqual(public["dividend_fiscal_year_end_month"], 3)
        self.assertEqual(public["dividend_streak_basis"], "fiscal_year_ex_date")
        self.assertTrue(public["dividend_streak_lower_bound"])

    def test_edinet_code_list_parser_reads_fiscal_month_for_numeric_and_alphanumeric_codes(self):
        csv_text = (
            "ダウンロード実行日,2026-08-20\n"
            "ＥＤＩＮＥＴコード,提出者種別,上場区分,連結の有無,資本金,決算日,提出者名,証券コード\n"
            "E00001,内国法人・組合,上場,有,1,03月31日,ＳＰＫ株式会社,74660\n"
            "E00002,内国法人・組合,上場,有,1,12-31,小林製薬株式会社,49670\n"
            "E00003,内国法人・組合,上場,有,1,2026/06/30,サンプル,130A0\n"
        )
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("EdinetcodeDlInfo.csv", csv_text.encode("cp932"))
        result = parse_edinet_code_zip(buffer.getvalue())
        self.assertEqual(result["7466"], 3)
        self.assertEqual(result["4967"], 12)
        self.assertEqual(result["130A"], 6)


if __name__ == "__main__":
    unittest.main()
