#!/usr/bin/env python3
"""Fetch JPX end-of-week margin balances and store compact per-prefix shards.

Source:
  https://www.jpx.co.jp/markets/statistics-equities/margin/05.html

JPX publishes recent "銘柄別信用取引週末残高" PDFs. Each PDF contains total
outstanding sales, weekly sales change, total outstanding purchases and weekly
purchase change by issue. This collector intentionally uses the all-issue weekly
publication rather than the limited daily publication so the UI can compare
stocks on one consistent basis.
"""

from __future__ import annotations

import argparse
import datetime as dt
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

JPX_PAGE = "https://www.jpx.co.jp/markets/statistics-equities/margin/05.html"
USER_AGENT = "kabutane-margin-balance/1.0 (+https://github.com/cosmos-invest/kabutane)"
PDF_NAME_RE = re.compile(r"syumatsu(?P<date>\d{8})\d*\.pdf", re.IGNORECASE)
ROW_RE = re.compile(
    r"(?P<code>[0-9A-Z]{4,5})\s+(?P<isin>[A-Z]{2}[A-Z0-9]{10})\s+(?P<tail>.+)$"
)
NUMBER_RE = re.compile(r"(?P<negative>▲\s*)?(?P<number>\d[\d,]*)")
MIN_RECORDS_PER_REPORT = 1000
HISTORY_LIMIT = 104


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.hrefs.append(href)


def fetch_bytes(url: str, timeout: int = 45) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"})
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed trusted source
        return response.read()


def discover_recent_pdfs(page_html: str, base_url: str = JPX_PAGE) -> list[tuple[str, str]]:
    parser = LinkParser()
    parser.feed(page_html)
    found: dict[str, str] = {}
    for href in parser.hrefs:
        absolute = urljoin(base_url, href)
        filename = Path(urlparse(absolute).path).name
        match = PDF_NAME_RE.search(filename)
        if not match:
            continue
        date = dt.datetime.strptime(match.group("date"), "%Y%m%d").date().isoformat()
        found[date] = absolute
    return sorted(found.items())


def normalize_code(raw: str) -> str:
    code = raw.strip().upper()
    if len(code) == 5 and code.endswith("0"):
        return code[:-1]
    return code


def parse_number(token: re.Match[str]) -> int:
    value = int(token.group("number").replace(",", ""))
    return -value if token.group("negative") else value


def parse_report_text(text: str, report_date: str) -> dict[str, dict[str, int | float | str | None]]:
    records: dict[str, dict[str, int | float | str | None]] = {}
    for line in text.splitlines():
        match = ROW_RE.search(line)
        if not match:
            continue
        values = [parse_number(item) for item in NUMBER_RE.finditer(match.group("tail"))]
        if len(values) < 4:
            continue
        sell_balance, sell_change, buy_balance, buy_change = values[:4]
        if sell_balance < 0 or buy_balance < 0:
            continue
        code = normalize_code(match.group("code"))
        if not re.fullmatch(r"[0-9A-Z]{4}", code):
            continue
        ratio = round(buy_balance / sell_balance, 2) if sell_balance > 0 else None
        records[code] = {
            "date": report_date,
            "sell_balance": sell_balance,
            "sell_change": sell_change,
            "buy_balance": buy_balance,
            "buy_change": buy_change,
            "ratio": ratio,
        }
    return records


def pdf_to_text(pdf_bytes: bytes) -> str:
    with tempfile.TemporaryDirectory(prefix="kabutane-margin-") as temp_dir:
        pdf_path = Path(temp_dir) / "report.pdf"
        txt_path = Path(temp_dir) / "report.txt"
        pdf_path.write_bytes(pdf_bytes)
        result = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), str(txt_path)],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"pdftotext failed: {result.stderr.strip()}")
        return txt_path.read_text(encoding="utf-8", errors="replace")


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def merge_history(existing: Iterable[dict], incoming: Iterable[dict]) -> list[dict]:
    by_date: dict[str, dict] = {}
    for record in [*existing, *incoming]:
        date = str(record.get("date") or "")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            by_date[date] = record
    ordered = [by_date[key] for key in sorted(by_date)]
    return ordered[-HISTORY_LIMIT:]


def write_shards(
    snapshots: list[tuple[str, str, dict[str, dict[str, int | float | str | None]]]],
    output_dir: Path,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    touched: dict[str, dict[str, list[dict]]] = {}
    source_files: list[dict[str, str | int]] = []

    for report_date, source_url, records in snapshots:
        source_files.append({"date": report_date, "url": source_url, "issues": len(records)})
        for code, record in records.items():
            prefix = code[:2]
            touched.setdefault(prefix, {}).setdefault(code, []).append(record)

    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    total_codes: set[str] = set()
    for prefix, incoming_by_code in touched.items():
        path = output_dir / f"{prefix}.json"
        existing = load_json(path, {})
        existing_records = existing.get("records") if isinstance(existing, dict) else {}
        if not isinstance(existing_records, dict):
            existing_records = {}
        merged_records: dict[str, list[dict]] = {}
        for code in set(existing_records) | set(incoming_by_code):
            merged = merge_history(existing_records.get(code, []), incoming_by_code.get(code, []))
            if merged:
                merged_records[code] = merged
                total_codes.add(code)
        payload = {
            "schema_version": 1,
            "source": "JPX 銘柄別信用取引週末残高",
            "source_url": JPX_PAGE,
            "frequency": "weekly",
            "generated_at": generated_at,
            "records": dict(sorted(merged_records.items())),
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    latest_date = max((item[0] for item in snapshots), default=None)
    index = {
        "schema_version": 1,
        "source": "JPX 銘柄別信用取引週末残高",
        "source_url": JPX_PAGE,
        "frequency": "weekly",
        "publication_note": "毎週第2営業日（通常火曜）16:30頃にJPX掲載",
        "generated_at": generated_at,
        "latest_date": latest_date,
        "covered_codes": len(total_codes),
        "reports": source_files,
    }
    (output_dir / "latest.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return index


def collect(output_dir: Path) -> dict:
    page_html = fetch_bytes(JPX_PAGE).decode("utf-8", errors="replace")
    pdfs = discover_recent_pdfs(page_html)
    if not pdfs:
        raise RuntimeError("JPX weekly margin PDFs were not found on the source page")

    snapshots = []
    for report_date, url in pdfs:
        text = pdf_to_text(fetch_bytes(url))
        records = parse_report_text(text, report_date)
        if len(records) < MIN_RECORDS_PER_REPORT:
            raise RuntimeError(
                f"Parsed only {len(records)} issues from {report_date}; refusing to publish possibly corrupt data"
            )
        snapshots.append((report_date, url, records))
        print(f"{report_date}: {len(records):,} issues")

    index = write_shards(snapshots, output_dir)
    print(
        f"latest={index['latest_date']} reports={len(index['reports'])} "
        f"covered_codes={index['covered_codes']:,}"
    )
    return index


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="data/margin", type=Path)
    args = parser.parse_args()
    collect(args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
