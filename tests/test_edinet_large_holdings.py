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

    def test_important_proposal_negative_wording_variants(self):
        for text in (
            "該当事項無し",
            "該当無し",
            "特にありません。",
            "該当事項ありません。",
            "当該事項なし。",
            "記載事項はありません。",
            "該当事項無し / 該当事項なし",
            "本報告書提出日現在、重要提案行為等を行う予定はありません。",
        ):
            self.assertFalse(updater.is_meaningful_important_proposal(text, "純投資"), text)
        self.assertFalse(updater.is_meaningful_important_proposal(
            "該当事項無し",
            "純投資（重要提案行為等を行うことを目的とするものではありません。）",
        ))
        self.assertTrue(updater.is_meaningful_important_proposal(
            "該当事項なし",
            "状況に応じて重要提案行為等を行う可能性がある",
        ))

    def test_merge_reclassifies_stored_event_with_negative_wording(self):
        stale = updater.parse_event(metadata(), xbrl_zip(
            SecurityCodeOfIssuer="12340",
            HoldingRatioOfShareCertificatesEtc="0.071",
            HoldingRatioOfShareCertificatesEtcPerLastReport="0.056",
            PurposeOfHolding="純投資",
            ActOfMakingImportantProposalEtc="該当事項無し",
        ))
        stale["important_proposal"] = True
        stale["event_kind"] = "IMPORTANT_PROPOSAL"
        normalized = updater.merge_events([stale], [])[0]
        self.assertFalse(normalized["important_proposal"])
        self.assertEqual(normalized["event_kind"], "INCREASE")

    def test_normalize_stored_event_preserves_zero_ratio(self):
        event = {
            "doc_id": "ZERO",
            "security_code": "1234",
            "report_type": "変更報告書",
            "current_ratio_pct": 0.0,
            "previous_ratio_pct": 5.0,
            "important_proposal_text": "該当なし",
            "purpose": "純投資",
        }
        normalized = updater.normalize_stored_event(event)
        self.assertEqual(normalized["current_ratio_pct"], 0.0)
        self.assertEqual(normalized["previous_ratio_pct"], 5.0)
        self.assertEqual(normalized["change_pct_point"], -5.0)
        self.assertEqual(normalized["event_kind"], "DECREASE")

    def test_2026_taxonomy_uses_summary_ratio_and_new_element_names(self):
        document = '''<?xml version="1.0" encoding="UTF-8"?>
        <xbrl xmlns="http://www.xbrl.org/2003/instance"
              xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
              xmlns:jplvh="http://example.test/jplvh">
          <context id="FilingDateInstant"><entity><identifier scheme="test">issuer</identifier></entity><period><instant>2026-08-10</instant></period></context>
          <context id="Holder1"><entity><identifier scheme="test">issuer</identifier><segment><xbrldi:explicitMember dimension="jplvh:HoldersAxis">jplvh:Holder1Member</xbrldi:explicitMember></segment></entity><period><instant>2026-08-10</instant></period></context>
          <jplvh:SecurityCodeOfIssuer contextRef="FilingDateInstant">12340</jplvh:SecurityCodeOfIssuer>
          <jplvh:DateWhenFilingRequirementAroseCoverPage contextRef="FilingDateInstant">2026-08-07</jplvh:DateWhenFilingRequirementAroseCoverPage>
          <jplvh:HoldingRatioOfShareCertificatesEtc contextRef="Holder1">0.0426</jplvh:HoldingRatioOfShareCertificatesEtc>
          <jplvh:HoldingRatioOfShareCertificatesEtc contextRef="FilingDateInstant">0.0513</jplvh:HoldingRatioOfShareCertificatesEtc>
          <jplvh:HoldingRatioOfShareCertificatesEtcPerLastReport contextRef="FilingDateInstant">0.0390</jplvh:HoldingRatioOfShareCertificatesEtcPerLastReport>
          <jplvh:ActOfMakingImportantProposalEtc contextRef="Holder1">該当事項はありません。</jplvh:ActOfMakingImportantProposalEtc>
        </xbrl>'''.encode("utf-8")
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("XBRL/PublicDoc/report.xbrl", document)
        event = updater.parse_event(metadata(), payload.getvalue())
        self.assertEqual(event["security_code"], "1234")
        self.assertEqual(event["obligation_date"], "2026-08-07")
        self.assertEqual(event["current_ratio_pct"], 5.13)
        self.assertEqual(event["previous_ratio_pct"], 3.9)
        self.assertEqual(event["change_pct_point"], 1.23)
        self.assertFalse(event["important_proposal"])

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

    def test_rebuild_removes_stale_generated_shards(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            output.mkdir(exist_ok=True)
            (output / "99.json").write_text("{}\n", encoding="utf-8")
            event = {**updater.parse_event(metadata("S1"), xbrl_zip(SecurityCode="12340")), "security_code": "1234"}
            updater.write_outputs(output, [event], "2026-08-10T00:00:00+00:00", rebuild=True)
            self.assertFalse((output / "99.json").exists())
            self.assertTrue((output / "12.json").exists())

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
