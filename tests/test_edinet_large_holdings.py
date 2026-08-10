import io
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts import update_edinet_large_holdings as updater


ROOT = Path(__file__).resolve().parents[1]


def xbrl_zip(**values):
    facts = "".join(f"<jpcrp:{name}>{value}</jpcrp:{name}>" for name, value in values.items())
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:jpcrp="http://example.test/jpcrp">'
        f"{facts}</xbrl>"
    ).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("XBRL/PublicDoc/report.xbrl", document)
    return output.getvalue()


def metadata(doc_id="S100TEST", description="変更報告書（大量保有）"):
    return {
        "docID": doc_id,
        "docTypeCode": "360",
        "docDescription": description,
        "submitDateTime": "2026-08-10 09:12",
        "filerName": "提出者",
        "xbrlFlag": "1",
        "withdrawalStatus": "0",
    }


class EdinetLargeHoldingsTests(unittest.TestCase):
    def test_parse_change_report_and_ratio(self):
        event = updater.parse_event(metadata(), xbrl_zip(
            SecurityCode="12340",
            NameOfIssuer="テスト株式会社",
            NameOfReportingPersonOrCompany="大口 太郎",
            HoldingRatioOfShareCertificatesEtc="0.071",
            HoldingRatioOfShareCertificatesEtcInLastReport="0.056",
            PurposeOfHolding="純投資",
        ))
        self.assertEqual(event["security_code"], "1234")
        self.assertEqual(event["event_kind"], "INCREASE")
        self.assertEqual(event["current_ratio_pct"], 7.1)
        self.assertEqual(event["change_pct_point"], 1.5)

    def test_new_correction_and_important_are_separate(self):
        self.assertEqual(updater.classify_event("大量保有報告書", 5.2, None, False), "NEW_OVER_5")
        self.assertEqual(updater.classify_event("訂正報告書", 8, 7, True), "CORRECTION")
        self.assertEqual(updater.classify_event("変更報告書", 8, 7, True), "IMPORTANT_PROPOSAL")

    def test_document_filter_checks_type_and_description(self):
        self.assertTrue(updater.is_large_holding_document(metadata()))
        self.assertFalse(updater.is_large_holding_document({**metadata(), "docTypeCode": "120"}))
        self.assertFalse(updater.is_large_holding_document({**metadata(), "docDescription": "有価証券報告書"}))

    def test_shards_keep_multiple_codes_with_same_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            first = {**updater.parse_event(metadata("S1"), xbrl_zip(SecurityCode="12340")), "security_code": "1234"}
            second = {**updater.parse_event(metadata("S2"), xbrl_zip(SecurityCode="12990")), "security_code": "1299"}
            updater.write_outputs(output, [first], "2026-08-10T00:00:00+00:00")
            updater.write_outputs(output, [second], "2026-08-11T00:00:00+00:00")
            shard = json.loads((output / "12.json").read_text(encoding="utf-8"))
            self.assertEqual(set(shard["records_by_code"]), {"1234", "1299"})

    def test_update_does_not_redownload_known_document(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            event = {**updater.parse_event(metadata("KNOWN"), xbrl_zip(SecurityCode="12340")), "security_code": "1234"}
            updater.write_outputs(output, [event], "2026-08-10T00:00:00+00:00")
            with patch.object(updater, "documents_for_day", return_value=[metadata("KNOWN")]), patch.object(
                updater, "download_xbrl"
            ) as download:
                result = updater.update(date(2026, 8, 10), date(2026, 8, 10), "secret", output)
            download.assert_not_called()
            self.assertEqual(len(result["records"]), 1)

    def test_termux_dry_run_needs_no_key_and_makes_no_changes(self):
        environment = os.environ.copy()
        environment.pop("EDINET_API_KEY", None)
        result = subprocess.run(
            ["bash", "termux-edinet.sh", "--days", "10", "--dry-run"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
            env=environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("GitHub Actions: 使用しません", result.stdout)
        self.assertIn("通信・データ変更・APIキー入力は行っていません", result.stdout)


if __name__ == "__main__":
    unittest.main()
