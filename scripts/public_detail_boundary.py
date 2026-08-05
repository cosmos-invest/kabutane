from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORE_INPUT = ROOT / "data" / "core" / "daily"
DEFAULT_CORE_OUTPUT = ROOT / "data" / "core" / "public-daily"


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")


def is_premium_gc(signal: Any) -> bool:
    return isinstance(signal, dict) and str(signal.get("status") or "").upper() == "GC"


def sanitize_detail_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(payload, ensure_ascii=False))
    signal = result.get("provisional_signal")
    record = result.get("record") if isinstance(result.get("record"), dict) else None
    premium_gc = is_premium_gc(signal) or str((record or {}).get("provisional_status") or "").upper() == "GC"
    if not premium_gc:
        return result

    result["provisional_signal"] = None
    result.pop("provisional_status", None)
    result.pop("provisional_month", None)
    if record is not None:
        record.pop("provisional_status", None)
        record.pop("provisional_month", None)
    result["public_boundary"] = "premium_provisional_gc_removed"
    return result


def sanitize_core_shard(payload: dict[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(payload, ensure_ascii=False))
    records = result.get("records")
    if not isinstance(records, dict):
        return result
    result["records"] = {
        str(code): sanitize_detail_payload(record) if isinstance(record, dict) else record
        for code, record in records.items()
    }
    result["public_boundary"] = "premium_provisional_gc_removed"
    return result


def validate_no_gc(payload: dict[str, Any], *, shard: bool = False) -> None:
    records = payload.get("records") if shard else None
    values = records.values() if isinstance(records, dict) else [payload]
    for record in values:
        if not isinstance(record, dict):
            continue
        if is_premium_gc(record.get("provisional_signal")):
            raise ValueError("Public detail payload still contains provisional GC")
        if str((record.get("record") or {}).get("provisional_status") or "").upper() == "GC":
            raise ValueError("Public detail record still contains provisional GC")


def build_public_core_daily(input_dir: Path = DEFAULT_CORE_INPUT, output_dir: Path = DEFAULT_CORE_OUTPUT) -> int:
    if not input_dir.exists():
        return 0
    output_dir.mkdir(parents=True, exist_ok=True)
    input_names: set[str] = set()
    count = 0
    for source in sorted(input_dir.glob("*.json")):
        input_names.add(source.name)
        public = sanitize_core_shard(load_json(source))
        validate_no_gc(public, shard=True)
        write_json(output_dir / source.name, public)
        count += 1
    for stale in output_dir.glob("*.json"):
        if stale.name not in input_names:
            stale.unlink()
    return count


def sanitize_directory_in_place(directory: Path) -> int:
    if not directory.exists():
        return 0
    count = 0
    for path in sorted(directory.glob("*.json")):
        public = sanitize_detail_payload(load_json(path))
        validate_no_gc(public)
        write_json(path, public)
        count += 1
    return count


def prepare_site_tree(site_root: Path) -> dict[str, int]:
    core_root = site_root / "data" / "core"
    core_shards = build_public_core_daily(core_root / "daily", core_root / "public-daily")
    chart_files = sanitize_directory_in_place(site_root / "data" / "charts")
    daily_files = sanitize_directory_in_place(site_root / "data" / "daily")

    # The public site only needs the sanitized catalog and public-daily shards.
    # Keep the raw all-core provisional feed out of the Pages artifact so a
    # normal public page cannot discover premium-only provisional GC names.
    raw_radar = core_root / "radar.json"
    if raw_radar.exists():
        raw_radar.unlink()
    raw_daily = core_root / "daily"
    if raw_daily.exists():
        shutil.rmtree(raw_daily)

    return {"core_shards": core_shards, "charts": chart_files, "daily": daily_files}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build public-safe detail payloads for Kabutane")
    parser.add_argument("--core-input-dir", default=str(DEFAULT_CORE_INPUT))
    parser.add_argument("--core-output-dir", default=str(DEFAULT_CORE_OUTPUT))
    parser.add_argument("--site-root", default="", help="If set, sanitize the copied Pages tree in place")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.site_root:
        counts = prepare_site_tree(Path(args.site_root))
        print(f"Public detail site tree: {counts}")
        return
    count = build_public_core_daily(Path(args.core_input_dir), Path(args.core_output_dir))
    print(f"Public core daily shards: {count}")


if __name__ == "__main__":
    main()
