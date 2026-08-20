from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

EDINET_CODELIST_URL = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"
CACHE_SCHEMA_VERSION = 1


def _normalize_security_code(value: Any) -> str:
    code = re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()
    if len(code) == 5 and code.endswith("0"):
        code = code[:4]
    return code if re.fullmatch(r"[0-9]{3}[0-9A-Z]", code) else ""


def _fiscal_end_month(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    groups = re.findall(r"\d+", text)
    if not groups:
        return None
    if len(groups) >= 3 and len(groups[0]) == 4:
        candidate = groups[1]
    else:
        candidate = groups[0]
    month = int(candidate)
    return month if 1 <= month <= 12 else None


def parse_edinet_code_zip(payload: bytes) -> dict[str, int]:
    """Parse EDINET's official code list into TSE security-code -> fiscal-end month."""
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        candidates = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not candidates:
            raise ValueError("EDINET code-list ZIP does not contain a CSV file")
        candidates.sort(key=lambda name: ("edinetcode" not in name.lower(), len(name), name))
        raw = archive.read(candidates[0])

    text = None
    for encoding in ("cp932", "utf-8-sig", "utf-8"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("EDINET code-list CSV encoding is unsupported")

    lines = text.splitlines()
    header_index = next(
        (
            index
            for index, line in enumerate(lines)
            if "証券コード" in line and "決算日" in line and "ＥＤＩＮＥＴコード" in line
        ),
        None,
    )
    if header_index is None:
        raise ValueError("EDINET code-list header was not found")

    reader = csv.DictReader(io.StringIO("\n".join(lines[header_index:])))
    if not reader.fieldnames:
        return {}
    code_key = next((name for name in reader.fieldnames if "証券コード" in str(name)), None)
    fiscal_key = next((name for name in reader.fieldnames if "決算日" in str(name)), None)
    if not code_key or not fiscal_key:
        raise ValueError("EDINET code-list required columns are missing")

    result: dict[str, int] = {}
    for row in reader:
        code = _normalize_security_code(row.get(code_key))
        month = _fiscal_end_month(row.get(fiscal_key))
        if code and month:
            result[code] = month
    return result


def _load_cache(path: Path) -> tuple[dict[str, int], datetime | None]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}, None
    records = payload.get("records") if isinstance(payload, dict) else {}
    if not isinstance(records, dict):
        return {}, None
    result = {
        str(code).upper(): int(month)
        for code, month in records.items()
        if str(month).isdigit() and 1 <= int(month) <= 12
    }
    try:
        generated = datetime.fromisoformat(str(payload.get("generated_at") or "").replace("Z", "+00:00"))
        generated = generated.astimezone(timezone.utc)
    except Exception:
        generated = None
    return result, generated


def _write_cache(path: Path, records: dict[str, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": CACHE_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "EDINET code list (Financial Services Agency)",
        "source_url": EDINET_CODELIST_URL,
        "records": dict(sorted(records.items())),
    }
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")


def load_fiscal_year_end_months(
    cache_path: Path,
    *,
    max_age_days: int = 30,
    timeout: int = 45,
) -> dict[str, int]:
    """Return an all-listed-company fiscal calendar using one EDINET code-list download.

    A recent checked-in/generated cache avoids thousands of company-profile requests.
    If EDINET is temporarily unavailable, a stale cache is preferred over falling back
    to per-company network access.
    """
    cached, generated = _load_cache(cache_path)
    if cached and generated is not None:
        age = datetime.now(timezone.utc) - generated
        if age.days < max(1, int(max_age_days)):
            return cached

    try:
        request = Request(EDINET_CODELIST_URL, headers={"User-Agent": "kabutane-dividend-fiscal-calendar/1.0"})
        with urlopen(request, timeout=timeout) as response:
            records = parse_edinet_code_zip(response.read())
        if records:
            _write_cache(cache_path, records)
            return records
    except Exception as exc:
        print(f"Fiscal calendar: EDINET code list unavailable ({exc}); using cached/fallback basis")

    return cached
