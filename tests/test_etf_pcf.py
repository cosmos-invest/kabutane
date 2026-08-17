from __future__ import annotations

import io
import unittest
import zipfile
from pathlib import Path

from openpyxl import Workbook

from scripts import update_etf_pcf as pcf


SAMPLE_CSV = """ETF Code,ETF Name,Fund Cash Component,Shares Outstanding,Fund Date,,
2080,Sample Active ETF,100000,1000000,20260815,,
,,,,,,
Code,Name,ISIN,Exchange,Currency,Shares Amount,Stock Price
1111,ALPHA,JP0000000001,TSE,JPY,10000,1000
2222,BETA,JP0000000002,TSE,JPY,20000,500
""".encode()


class EtfPcfTests(unittest.TestCase):
    def test_discovers_active_rows_and_provider(self):
        html = b"""
        <table><tr><td>-</td><td>2080</td><td>PBR ETF <b>iNAV</b> Active</td>
        <td>Sponsor</td><td><a href='https://inav.ice.com/tse/iopv/table?language=jp'>PCF</a></td></tr>
        <tr><td>-</td><td>1306</td><td>TOPIX ETF</td><td>Sponsor</td></tr></table>
        """.replace(b"Active", "アクティブ運用型".encode())
        rows = pcf.discover_active_etfs(html)
        self.assertEqual([row["code"] for row in rows], ["2080"])
        self.assertEqual(rows[0]["provider_hint"], "ICE")
        self.assertNotIn("iNAV", rows[0]["name"])

    def test_reads_pcf_url_from_jpx_workbook(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet["B1"] = "ETF Database （2026年8月末時点）"
        sheet.append([])
        sheet.append([])
        sheet.append([
            None, "コード", "名称", "カテゴリー", "管理会社",
            "PCF掲載URL\n(日本語)", "PCF\n更新頻度",
        ])
        sheet.append([None, "2080", "Sample", "日本株", "Sponsor", "https://example.test/2080.csv", "日次"])
        buffer = io.BytesIO()
        workbook.save(buffer)
        records, as_of = pcf.pcf_urls_from_workbook(buffer.getvalue())
        self.assertEqual(as_of, "2026-08")
        self.assertEqual(records["2080"]["url"], "https://example.test/2080.csv")

    def test_parses_and_normalizes_pcf(self):
        snapshot = pcf.parse_pcf(SAMPLE_CSV, "https://example.test/2080.csv", "ICE")
        self.assertEqual(snapshot["etf_code"], "2080")
        self.assertEqual(snapshot["fund_date"], "2026-08-15")
        self.assertEqual(snapshot["shares_outstanding"], 1_000_000)
        self.assertEqual(snapshot["holdings"][0]["units_per_million"], 10_000)

    def test_creation_redemption_is_removed_by_normalization(self):
        previous = pcf.enrich_snapshot(pcf.parse_pcf(SAMPLE_CSV), {"1111": "アルファ", "2222": "ベータ"})
        current_csv = SAMPLE_CSV.replace(b"1000000,20260815", b"2000000,20260816").replace(b"10000,1000", b"20000,1000").replace(b"20000,500", b"40000,500")
        current = pcf.enrich_snapshot(pcf.parse_pcf(current_csv), {"1111": "アルファ", "2222": "ベータ"})
        self.assertEqual(pcf.compare_snapshots(current, previous), [])

    def test_detects_new_increase_decrease_and_removal(self):
        previous = pcf.enrich_snapshot(pcf.parse_pcf(SAMPLE_CSV), {})
        current_csv = """ETF Code,ETF Name,Fund Cash Component,Shares Outstanding,Fund Date
2080,Sample Active ETF,100000,1000000,20260816

Code,Name,ISIN,Exchange,Currency,Shares Amount,Stock Price
1111,ALPHA,JP0000000001,TSE,JPY,12000,1000
3333,GAMMA,JP0000000003,TSE,JPY,5000,800
""".encode()
        current = pcf.enrich_snapshot(pcf.parse_pcf(current_csv), {})
        changes = pcf.compare_snapshots(current, previous)
        kinds = {(row["code"], row["kind"]) for row in changes}
        self.assertIn(("1111", "INCREASE"), kinds)
        self.assertIn(("2222", "REMOVED"), kinds)
        self.assertIn(("3333", "NEW"), kinds)

    def test_common_change_needs_two_domestic_funds(self):
        funds = [
            {"code": "2080", "name": "A", "domestic_equity": True, "changes": [{"code": "1111", "name_ja": "アルファ", "kind": "NEW"}]},
            {"code": "2081", "name": "B", "domestic_equity": True, "changes": [{"code": "1111", "name_ja": "アルファ", "kind": "INCREASE"}]},
        ]
        common = pcf.build_common_changes(funds)
        self.assertEqual(common[0]["code"], "1111")
        self.assertEqual(common[0]["fund_count"], 2)

    def test_reads_official_ice_archive_list_and_members(self):
        names = pcf.ice_archive_names(b'["all_pcf_20260814.zip","all_pcf_20260817.zip"]')
        self.assertEqual(names, ["all_pcf_20260817.zip", "all_pcf_20260814.zip"])
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as handle:
            handle.writestr("2080tsepcf_20260817.csv", SAMPLE_CSV)
            handle.writestr("1306tsepcf_20260817.csv", SAMPLE_CSV.replace(b"2080,", b"1306,"))
        snapshots = pcf.snapshots_from_ice_archive(archive.getvalue(), {"2080"})
        self.assertEqual(list(snapshots), ["2080"])

    def test_builds_day_week_month_comparison_status(self):
        def snapshot(date: bytes, amount: bytes):
            content = SAMPLE_CSV.replace(b"20260815", date).replace(b"10000,1000", amount + b",1000")
            return pcf.enrich_snapshot(pcf.parse_pcf(content), {})

        history = [snapshot(b"20260715", b"8000"), snapshot(b"20260810", b"9000"), snapshot(b"20260814", b"10000"), snapshot(b"20260817", b"12000")]
        periods = pcf.build_periods(history[-1], history)
        self.assertEqual(periods["day"]["baseline_date"], "2026-08-14")
        self.assertEqual(periods["week"]["baseline_date"], "2026-08-10")
        self.assertEqual(periods["month"]["baseline_date"], "2026-07-15")
        self.assertTrue(all(value["status"] == "ready" for value in periods.values()))

    def test_payload_contract_rejects_duplicate_funds(self):
        payload = {
            "kind": "kabutane_active_etf_pcf",
            "summary": {"active_target_count": 2, "available_count": 2, "error_count": 0},
            "funds": [
                {"code": "2080", "fund_date": "2026-08-15", "changes": []},
                {"code": "2080", "fund_date": "2026-08-15", "changes": []},
            ],
            "errors": [],
        }
        with self.assertRaises(ValueError):
            pcf.validate_payload(payload)

    def test_member_page_and_daily_workflow_are_wired(self):
        root = Path(__file__).resolve().parents[1]
        page = (root / "premium-etf-pcf.html").read_text(encoding="utf-8")
        lab = (root / "premium-supply-beta.html").read_text(encoding="utf-8")
        workflow = (root / ".github" / "workflows" / "update-daily.yml").read_text(encoding="utf-8")
        deploy = (root / ".github" / "workflows" / "deploy-pages.yml").read_text(encoding="utf-8")
        self.assertIn("ETF100万口あたり", page)
        self.assertIn("data/premium/etf-pcf/latest.json", (root / "assets" / "premium-etf-pcf.js").read_text(encoding="utf-8"))
        self.assertIn("premium-etf-pcf.html", lab)
        self.assertIn("python -m scripts.update_etf_pcf", workflow)
        self.assertIn("premium-etf-pcf.html", deploy)
        self.assertIn('data-pcf-period="week"', page)
        self.assertIn('id="pcfStockLookup"', page)
        self.assertIn('id="pcfSponsorTrends"', page)
        script = (root / "assets" / "premium-etf-pcf.js").read_text(encoding="utf-8")
        self.assertIn("week_ready_count", script)
        self.assertIn("stock_lookup", script)


if __name__ == "__main__":
    unittest.main()
