from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "data" / "large-holdings"
API_ROOT = "https://api.edinet-fsa.go.jp/api/v2"
EDINET_VIEW_ROOT = "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx"
SOURCE_LABEL = "EDINET（金融庁）をもとに、かぶたねが抽出・分類"
LARGE_HOLDING_DOC_TYPES = {"350", "360"}
MAX_GLOBAL_RECORDS = 5000
MAX_STOCK_RECORDS = 300

FACT_ALIASES = {
    "security_code": ("SecurityCodeOfIssuer", "SecurityCode", "CodeOfIssuer", "SecuritiesCode"),
    "issuer_name": ("NameOfIssuer", "NameOfCompany"),
    "filer_name": (
        "FilerNameInJapaneseDEI",
        "NameOfReportingPersonOrCompany",
        "NameOfReportingPerson",
        "NameOfFiler",
    ),
    "obligation_date": (
        "DateWhenFilingRequirementAroseCoverPage",
        "DateWhenFilingRequirementArose",
        "DateOfReportingObligation",
    ),
    "purpose": ("PurposeOfHolding", "PurposeOfHoldingShareCertificatesEtc"),
    "important_proposal_text": (
        "ActOfMakingImportantProposalEtc",
        "MattersRegardingImportantProposalActEtc",
        "MattersConcerningImportantProposalActEtc",
    ),
    "current_ratio": (
        "HoldingRatioOfShareCertificatesEtc",
        "ShareholdingRatio",
        "RatioOfShareCertificatesEtcHeld",
    ),
    "previous_ratio": (
        "HoldingRatioOfShareCertificatesEtcPerLastReport",
        "HoldingRatioOfShareCertificatesEtcInLastReport",
        "ShareholdingRatioOfLastReport",
        "RatioOfShareCertificatesEtcHeldInLastReport",
    ),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_text(value: Any, limit: int = 1000) -> str:
    return re.sub(r"\s+", " ", str("" if value is None else value)).strip()[:limit]


def finite(value: Any) -> float | None:
    text = clean_text(value).replace(",", "").replace("％", "").replace("%", "")
    if not text or text in {"-", "—"}:
        return None
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return -number if negative else number


def ratio_percent(value: Any) -> float | None:
    number = finite(value)
    if number is None:
        return None
    if -1 <= number <= 1:
        number *= 100
    return round(number, 4)


def normalize_security_code(value: Any) -> str:
    code = re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()
    if len(code) == 5 and code.endswith("0"):
        code = code[:4]
    return code if re.fullmatch(r"[0-9]{3}[0-9A-Z]", code) else ""


def local_name(value: str) -> str:
    return value.rsplit("}", 1)[-1].split(":")[-1]


def extract_facts(document: bytes) -> dict[str, list[str]]:
    root = ElementTree.fromstring(document)
    dimensional_contexts = {
        clean_text(element.attrib.get("id"), 200)
        for element in root.iter()
        if local_name(str(element.tag)) == "context"
        and any(local_name(str(child.tag)) in {"explicitMember", "typedMember"} for child in element.iter())
    }
    ranked_facts: dict[str, list[tuple[int, int, str]]] = {}
    order = 0
    for element in root.iter():
        tag = local_name(str(element.tag))
        name = local_name(str(element.attrib.get("name") or "")) if tag in {"nonNumeric", "nonFraction", "fraction"} else tag
        value = clean_text("".join(element.itertext()))
        if name and value:
            context_ref = clean_text(element.attrib.get("contextRef"), 200)
            # 共同保有者別の値より、ディメンションのない総括値を先に選ぶ。
            rank = 1 if context_ref in dimensional_contexts else 0
            ranked_facts.setdefault(name, []).append((rank, order, value))
            order += 1
    return {
        name: [value for _, _, value in sorted(values)]
        for name, values in ranked_facts.items()
    }


def pick_fact(facts: dict[str, list[str]], aliases: Iterable[str]) -> str:
    for alias in aliases:
        for value in facts.get(alias, []):
            if value:
                return value
    return ""


def pick_facts(facts: dict[str, list[str]], aliases: Iterable[str]) -> list[str]:
    values: list[str] = []
    for alias in aliases:
        for value in facts.get(alias, []):
            if value and value not in values:
                values.append(value)
    return values


def document_bytes_from_zip(payload: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        candidates = [
            name for name in archive.namelist()
            if name.lower().endswith((".xbrl", ".xhtml", ".htm", ".html"))
            and ("publicdoc" in name.lower() or "xbrl" in name.lower())
        ]
        if not candidates:
            raise ValueError("XBRL/inline XBRL document was not found in the EDINET ZIP")
        candidates.sort(key=lambda name: (not name.lower().endswith(".xbrl"), len(name), name))
        return archive.read(candidates[0])


def report_type(description: str) -> str:
    if "訂正" in description:
        return "訂正報告書"
    if "変更報告書" in description:
        return "変更報告書"
    return "大量保有報告書"


def is_negative_important_statement(text: str) -> bool:
    compact = re.sub(r"[\s。、・｡]", "", text)
    negative_texts = {
        "なし",
        "無し",
        "該当なし",
        "該当無し",
        "該当ありません",
        "該当事項なし",
        "該当事項無し",
        "該当事項はありません",
        "該当事項ありません",
        "当該事項なし",
        "当該事項無し",
        "該等事項はありません",
        "該当する事項なし",
        "特になし",
        "特に無し",
        "特にありません",
        "記載事項はありません",
        "ありません",
    }
    if not compact or compact in negative_texts:
        return True
    negative_patterns = (
        r"重要提案行為等?を行う予定(?:は|が)?ありません",
        r"重要提案行為等?を行う予定(?:は|が)?ない",
        r"重要提案行為等?を行うことを目的とするものではありません",
        r"重要提案行為等?を行う意(?:思|図)(?:は|が)?ありません",
        r"重要提案行為等?は行いません",
    )
    return any(re.search(pattern, compact) for pattern in negative_patterns)


def is_meaningful_important_proposal(text: str, purpose: str) -> bool:
    text_parts = [part for part in re.split(r"\s*/\s*", text) if clean_text(part)]
    text_positive = any(not is_negative_important_statement(part) for part in text_parts)
    purpose_compact = re.sub(r"[\s。、・｡]", "", purpose)
    purpose_positive = (
        "重要提案" in purpose_compact
        and not is_negative_important_statement(purpose_compact)
    )
    return text_positive or purpose_positive


def classify_event(kind: str, current: float | None, previous: float | None, important: bool) -> str:
    if kind == "訂正報告書":
        return "CORRECTION"
    if important:
        return "IMPORTANT_PROPOSAL"
    if kind == "大量保有報告書":
        return "NEW_OVER_5"
    if current is not None and previous is not None:
        delta = current - previous
        if delta > 0.0001:
            return "INCREASE"
        if delta < -0.0001:
            return "DECREASE"
    return "CHANGE_OTHER"


def is_large_holding_document(metadata: dict[str, Any]) -> bool:
    description = clean_text(metadata.get("docDescription"), 300)
    return str(metadata.get("docTypeCode") or "") in LARGE_HOLDING_DOC_TYPES and any(
        label in description for label in ("大量保有報告書", "変更報告書")
    )


def parse_event(metadata: dict[str, Any], zip_payload: bytes) -> dict[str, Any]:
    facts = extract_facts(document_bytes_from_zip(zip_payload))
    values = {key: pick_fact(facts, aliases) for key, aliases in FACT_ALIASES.items()}
    description = clean_text(metadata.get("docDescription"), 300)
    kind = report_type(description)
    current = ratio_percent(values["current_ratio"])
    previous = ratio_percent(values["previous_ratio"])
    delta = round(current - previous, 4) if current is not None and previous is not None else None
    purposes = pick_facts(facts, FACT_ALIASES["purpose"])
    important_texts = pick_facts(facts, FACT_ALIASES["important_proposal_text"])
    purpose = clean_text(" / ".join(purposes), 600)
    important_text = clean_text(" / ".join(important_texts), 600)
    important = any(
        is_meaningful_important_proposal(text, purpose)
        for text in (important_texts or [""])
    )
    doc_id = clean_text(metadata.get("docID"), 40)
    return {
        "doc_id": doc_id,
        "security_code": normalize_security_code(values["security_code"] or metadata.get("secCode")),
        "issuer_name": clean_text(values["issuer_name"] or metadata.get("issuerEdinetCode"), 160),
        "filer_name": clean_text(metadata.get("filerName") or values["filer_name"], 160),
        "report_type": kind,
        "event_kind": classify_event(kind, current, previous, important),
        "submitted_at": clean_text(metadata.get("submitDateTime"), 30),
        "obligation_date": clean_text(values["obligation_date"], 30),
        "current_ratio_pct": current,
        "previous_ratio_pct": previous,
        "change_pct_point": delta,
        "purpose": purpose,
        "important_proposal": important,
        "important_proposal_text": important_text,
        "description": description,
        "parent_doc_id": clean_text(metadata.get("parentDocID"), 40),
        "source_url": f"{EDINET_VIEW_ROOT}?{doc_id}" if doc_id else "",
    }


def api_json(url: str) -> dict[str, Any]:
    with urlopen(Request(url, headers={"User-Agent": "kabutane-edinet-large-holdings/1.1"}), timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def api_bytes(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "kabutane-edinet-large-holdings/1.1"}), timeout=90) as response:
        return response.read()


def documents_for_day(target: date, api_key: str) -> list[dict[str, Any]]:
    query = urlencode({"date": target.isoformat(), "type": 2, "Subscription-Key": api_key})
    return list(api_json(f"{API_ROOT}/documents.json?{query}").get("results") or [])


def download_xbrl(doc_id: str, api_key: str) -> bytes:
    query = urlencode({"type": 1, "Subscription-Key": api_key})
    return api_bytes(f"{API_ROOT}/documents/{doc_id}?{query}")


def event_sort_key(event: dict[str, Any]) -> tuple[str, str]:
    return (str(event.get("submitted_at") or ""), str(event.get("doc_id") or ""))


def normalize_stored_event(event: dict[str, Any]) -> dict[str, Any]:
    kind = clean_text(event.get("report_type"), 30) or report_type(clean_text(event.get("description"), 300))
    current = finite(event.get("current_ratio_pct"))
    previous = finite(event.get("previous_ratio_pct"))
    current = round(current, 4) if current is not None else None
    previous = round(previous, 4) if previous is not None else None
    purpose = clean_text(event.get("purpose"), 600)
    important_text = clean_text(event.get("important_proposal_text"), 600)
    important = is_meaningful_important_proposal(important_text, purpose)
    delta = round(current - previous, 4) if current is not None and previous is not None else None
    return {
        **event,
        "report_type": kind,
        "current_ratio_pct": current,
        "previous_ratio_pct": previous,
        "change_pct_point": delta,
        "purpose": purpose,
        "important_proposal": important,
        "important_proposal_text": important_text,
        "event_kind": classify_event(kind, current, previous, important),
    }


def merge_events(existing: Iterable[dict[str, Any]], incoming: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for event in [*existing, *incoming]:
        normalized = normalize_stored_event(event)
        doc_id = str(normalized.get("doc_id") or "")
        code = normalize_security_code(normalized.get("security_code"))
        if doc_id and code:
            merged[doc_id] = {**normalized, "security_code": code}
    return sorted(merged.values(), key=event_sort_key, reverse=True)


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temporary = Path(handle.name)
    temporary.replace(path)


def build_latest_payload(events: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    kinds = ("NEW_OVER_5", "INCREASE", "DECREASE", "IMPORTANT_PROPOSAL", "CORRECTION", "CHANGE_OTHER")
    counts = {kind: sum(item.get("event_kind") == kind for item in events) for kind in kinds}
    facets = {
        "NEW_OVER_5": sum(item.get("report_type") == "大量保有報告書" for item in events),
        "INCREASE": sum(
            item.get("report_type") == "変更報告書" and (finite(item.get("change_pct_point")) or 0) > 0
            for item in events
        ),
        "DECREASE": sum(
            item.get("report_type") == "変更報告書" and (finite(item.get("change_pct_point")) or 0) < 0
            for item in events
        ),
        "IMPORTANT_PROPOSAL": sum(
            item.get("report_type") != "訂正報告書" and item.get("important_proposal") is True
            for item in events
        ),
        "CORRECTION": sum(item.get("report_type") == "訂正報告書" for item in events),
        "CHANGE_OTHER": sum(item.get("event_kind") == "CHANGE_OTHER" for item in events),
    }
    return {
        "schema_version": 1,
        "kind": "kabutane_edinet_large_holdings",
        "ready": True,
        "generated_at": generated_at,
        "source": SOURCE_LABEL,
        "source_home": "https://disclosure2.edinet-fsa.go.jp/",
        "notice": "保有割合の増減は報告書記載値の比較であり、売買そのものを断定する表示ではありません。訂正報告書は増減分類から分離しています。",
        "counts": counts,
        "facets": facets,
        "records": events[:MAX_GLOBAL_RECORDS],
    }


def write_outputs(output_root: Path, incoming: list[dict[str, Any]], generated_at: str, rebuild: bool = False) -> dict[str, Any]:
    if rebuild and output_root.exists():
        for path in output_root.glob("*.json"):
            if path.name != "latest.json" and re.fullmatch(r"[0-9A-Z]{2}\.json", path.name):
                path.unlink()
    existing_payload = {} if rebuild else load_json(output_root / "latest.json", {})
    events = merge_events(existing_payload.get("records") or [], incoming)
    latest = build_latest_payload(events, generated_at)
    write_json(output_root / "latest.json", latest)
    by_prefix: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for event in events:
        code = str(event["security_code"])
        by_prefix.setdefault(code[:2], {}).setdefault(code, []).append(event)
    for prefix, incoming_codes in by_prefix.items():
        existing_shard = {} if rebuild else load_json(output_root / f"{prefix}.json", {})
        records_by_code = {
            normalize_security_code(code): list(records or [])
            for code, records in (existing_shard.get("records_by_code") or {}).items()
            if normalize_security_code(code)
        }
        records_by_code.update({code: records[:MAX_STOCK_RECORDS] for code, records in incoming_codes.items()})
        write_json(output_root / f"{prefix}.json", {
            "schema_version": 1,
            "kind": "kabutane_edinet_large_holding_history_shard",
            "generated_at": generated_at,
            "source": SOURCE_LABEL,
            "notice": latest["notice"],
            "records_by_code": records_by_code,
        })
    return latest


def date_range(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def update(start: date, end: date, api_key: str, output_root: Path, rebuild: bool = False) -> dict[str, Any]:
    existing = {} if rebuild else load_json(output_root / "latest.json", {})
    known_doc_ids = {str(item.get("doc_id")) for item in existing.get("records") or [] if item.get("doc_id")}
    incoming: list[dict[str, Any]] = []
    cached_count = 0
    for target in date_range(start, end):
        documents = documents_for_day(target, api_key)
        candidates = [item for item in documents if is_large_holding_document(item)]
        print(f"EDINET {target.isoformat()}: documents={len(documents)} large_holdings={len(candidates)}")
        for metadata in candidates:
            doc_id = clean_text(metadata.get("docID"), 40)
            if doc_id in known_doc_ids:
                cached_count += 1
                continue
            if str(metadata.get("withdrawalStatus") or "0") != "0" or str(metadata.get("xbrlFlag") or "1") != "1":
                continue
            try:
                event = parse_event(metadata, download_xbrl(doc_id, api_key))
            except Exception as error:
                print(f"  skip {doc_id}: {error}")
                continue
            if event["security_code"]:
                incoming.append(event)
                known_doc_ids.add(doc_id)
    if cached_count:
        print(f"Cached EDINET documents skipped: {cached_count}")
    return write_outputs(output_root, incoming, utc_now(), rebuild=rebuild)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EDINET大量保有報告書を取得し、かぶたね用JSONへ整形します。")
    parser.add_argument("--from-date", type=date.fromisoformat)
    parser.add_argument("--to-date", type=date.fromisoformat)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--output", type=Path, default=OUTPUT_ROOT)
    parser.add_argument("--rebuild", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_key = clean_text(os.environ.get("EDINET_API_KEY"), 300)
    if not api_key:
        raise SystemExit("EDINET_API_KEY is required. GitHub Actionsへ登録せず、ローカル環境変数で実行してください。")
    end = args.to_date or date.today()
    start = args.from_date or end - timedelta(days=max(1, args.days) - 1)
    if start > end:
        raise SystemExit("--from-date must be on or before --to-date")
    if (end - start).days > 366:
        raise SystemExit("一度の取得期間は367日以内にしてください。")
    payload = update(start, end, api_key, args.output, rebuild=args.rebuild)
    print(f"Large holdings: records={len(payload['records'])} generated_at={payload['generated_at']}")


if __name__ == "__main__":
    main()
