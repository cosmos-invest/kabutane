from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
LATEST_FILE = DATA_DIR / "latest.json"
RANKING_FILE = DATA_DIR / "ranking.json"
DAILY_CHANGE_FILE = DATA_DIR / "daily-change.json"
MONTHLY_REPORT_FILE = DATA_DIR / "monthly-report.json"
STOCKS_FILE = ROOT / "stocks.csv"
MONTH_DIR = DATA_DIR / "months"

SECTOR_NAMES = {
    50: "水産・農林業", 1050: "鉱業", 2050: "建設業", 3050: "食料品",
    3100: "繊維製品", 3150: "パルプ・紙", 3200: "化学", 3250: "医薬品",
    3300: "石油・石炭製品", 3350: "ゴム製品", 3400: "ガラス・土石製品",
    3450: "鉄鋼", 3500: "非鉄金属", 3550: "金属製品", 3600: "機械",
    3650: "電気機器", 3700: "輸送用機器", 3750: "精密機器", 3800: "その他製品",
    4050: "電気・ガス業", 5050: "陸運業", 5100: "海運業", 5150: "空運業",
    5200: "倉庫・運輸関連業", 5250: "情報・通信業", 6050: "卸売業", 6100: "小売業",
    7050: "銀行業", 7100: "証券・商品先物取引業", 7150: "保険業",
    7200: "その他金融業", 8050: "不動産業", 9050: "サービス業",
}


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def rounded(value: Any, digits: int = 2) -> float | None:
    number = to_float(value)
    return round(number, digits) if number is not None else None


def normalize_market(value: str) -> str:
    text = str(value or "").strip()
    if "プライム" in text:
        return "プライム"
    if "スタンダード" in text:
        return "スタンダード"
    if "グロース" in text:
        return "グロース"
    if "ETF" in text or "ＥＴＦ" in text:
        return "ETF"
    return text or "その他"


def load_stock_meta() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    with STOCKS_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            code = str(row.get("code") or "").strip().upper()
            if not code:
                continue
            sector_code = int(float(row.get("sector") or 0)) if str(row.get("sector") or "").strip() else None
            result[code] = {
                "market": normalize_market(str(row.get("market") or "")),
                "jpx_sector_code": sector_code,
                "jpx_sector_name": SECTOR_NAMES.get(sector_code, "その他") if sector_code is not None else "その他",
            }
    return result


def enrich_records(records: list[dict[str, Any]], metadata: dict[str, dict[str, Any]]) -> None:
    for record in records:
        meta = metadata.get(str(record.get("code") or "").upper(), {})
        record.update({key: value for key, value in meta.items() if value is not None})


def build_ranking(latest: dict[str, Any], previous: dict[str, Any], price_date: str | None) -> dict[str, Any]:
    previous_by_code = {str(row.get("code")): row for row in previous.get("rows") or []}
    ranked = [record for record in latest.get("records") or [] if to_float(record.get("return_since_gc_pct")) is not None]
    ranked.sort(key=lambda row: (-(to_float(row.get("return_since_gc_pct")) or 0), str(row.get("code") or "")))

    rows: list[dict[str, Any]] = []
    for rank, record in enumerate(ranked, start=1):
        code = str(record.get("code") or "")
        prior = previous_by_code.get(code, {})
        previous_rank = int(prior.get("rank")) if prior.get("rank") is not None else None
        current_price = to_float(record.get("current_price"))
        previous_price = to_float(prior.get("current_price"))
        day_change = ((current_price / previous_price - 1) * 100) if current_price and previous_price else None
        rank_change = previous_rank - rank if previous_rank is not None else None
        row = {
            "rank": rank,
            "previous_rank": previous_rank,
            "rank_change": rank_change,
            "code": code,
            "ticker": record.get("ticker"),
            "name": record.get("name") or code,
            "market": record.get("market") or "その他",
            "jpx_sector_name": record.get("jpx_sector_name") or "その他",
            "status": record.get("status"),
            "months_active": record.get("months_active"),
            "gc_month": record.get("gc_month"),
            "current_price": rounded(current_price),
            "daily_change_pct": rounded(day_change),
            "return_since_gc_pct": rounded(record.get("return_since_gc_pct")),
            "rsi_value": rounded(record.get("rsi5")),
            "rsi_average": rounded(record.get("rsi14")),
            "rsi_gap": rounded(record.get("diff")),
        }
        rows.append(row)
        record["gc_return_rank"] = rank
        record["previous_gc_return_rank"] = previous_rank
        record["gc_rank_change"] = rank_change
        record["daily_change_pct"] = rounded(day_change)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "price_date": price_date or latest.get("daily_price_date"),
        "signal_month": latest.get("signal_month"),
        "count": len(rows),
        "rows": rows,
    }


def build_daily_change(ranking: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    has_previous = bool(previous.get("rows"))
    rows = ranking.get("rows") or []
    rank_up = sorted(
        [row for row in rows if to_float(row.get("rank_change")) and row["rank_change"] > 0],
        key=lambda row: (-row["rank_change"], row["rank"]),
    )[:10]
    price_up = sorted(
        [row for row in rows if to_float(row.get("daily_change_pct")) is not None],
        key=lambda row: -(to_float(row.get("daily_change_pct")) or 0),
    )[:10]
    entrants = [row for row in rows if row.get("previous_rank") is None][:10] if has_previous else []
    return {
        "generated_at": ranking.get("generated_at"),
        "price_date": ranking.get("price_date"),
        "has_previous_day": has_previous,
        "summary": {
            "ranking_count": len(rows),
            "rank_up_count": sum(1 for row in rows if (row.get("rank_change") or 0) > 0),
            "rank_down_count": sum(1 for row in rows if (row.get("rank_change") or 0) < 0),
            "unchanged_count": sum(1 for row in rows if row.get("rank_change") == 0),
            "new_entry_count": len(entrants),
        },
        "rank_up": rank_up,
        "price_up": price_up,
        "new_entries": entrants,
    }


def group_monthly(rows: list[dict[str, Any]], out_rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "name": "その他", "active_count": 0, "new_count": 0, "out_count": 0,
        "near_cross_count": 0, "new_codes": [], "out_codes": [], "near_cross_codes": [],
    })
    for row in rows:
        name = str(row.get(key) or "その他")
        group = groups[name]
        group["name"] = name
        group["active_count"] += 1
        if row.get("status") == "NEW":
            group["new_count"] += 1
            group["new_codes"].append(str(row.get("code")))
        gap = to_float(row.get("diff"))
        if gap is not None and 0 <= gap <= 2:
            group["near_cross_count"] += 1
            group["near_cross_codes"].append(str(row.get("code")))
    for row in out_rows:
        name = str(row.get(key) or "その他")
        group = groups[name]
        group["name"] = name
        group["out_count"] += 1
        group["out_codes"].append(str(row.get("code")))
    values = list(groups.values())
    values.sort(key=lambda row: (-(row["new_count"] + row["out_count"]), -row["near_cross_count"], row["name"]))
    return values


def build_monthly_report(latest: dict[str, Any], metadata: dict[str, dict[str, Any]]) -> dict[str, Any]:
    signal_month = str(latest.get("signal_month") or "")
    if not signal_month:
        return {}
    current = read_json(MONTH_DIR / f"{signal_month}.json", {}) or {}
    current_records = list(current.get("records") or latest.get("records") or [])
    current_out = list(current.get("out_records") or latest.get("out_records") or [])
    enrich_records(current_records, metadata)
    enrich_records(current_out, metadata)

    year, month = [int(part) for part in signal_month.split("-")]
    previous_month = f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"
    previous = read_json(MONTH_DIR / f"{previous_month}.json", {}) or {}
    previous_records = list(previous.get("records") or [])
    previous_codes = {str(row.get("code")) for row in previous_records}
    current_codes = {str(row.get("code")) for row in current_records}

    new_rows = [row for row in current_records if row.get("status") == "NEW"]
    out_rows = current_out
    near_cross = [row for row in current_records if to_float(row.get("diff")) is not None and 0 <= float(row["diff"]) <= 2]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "signal_month": signal_month,
        "previous_month": previous_month,
        "summary": {
            "active_count": len(current_records),
            "previous_active_count": len(previous_records),
            "active_change": len(current_records) - len(previous_records),
            "new_count": len(new_rows),
            "out_count": len(out_rows),
            "near_cross_count": len(near_cross),
            "continued_count": len(current_codes & previous_codes),
        },
        "new_records": new_rows,
        "out_records": out_rows,
        "near_cross_records": sorted(near_cross, key=lambda row: to_float(row.get("diff")) or 0)[:30],
        "by_market": group_monthly(current_records, out_rows, "market"),
        "by_sector": group_monthly(current_records, out_rows, "jpx_sector_name"),
        "notes": [
            "NEWは月足RSI14が5か月移動平均を上抜けた銘柄です。",
            "OUTは月足RSI14が5か月移動平均以下へ戻った銘柄です。",
            "節目接近は、両者の差が0〜2ポイントの継続銘柄です。売買推奨ではありません。",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--monthly", action="store_true", help="月初レポートも再生成する")
    args = parser.parse_args()

    latest = read_json(LATEST_FILE, {}) or {}
    if not latest.get("records"):
        raise RuntimeError("data/latest.json にランキング対象がありません。")
    metadata = load_stock_meta()
    enrich_records(latest.get("records") or [], metadata)
    enrich_records(latest.get("out_records") or [], metadata)

    previous_ranking = read_json(RANKING_FILE, {}) or {}
    ranking = build_ranking(latest, previous_ranking, latest.get("daily_price_date"))
    daily_change = build_daily_change(ranking, previous_ranking)
    write_json(RANKING_FILE, ranking)
    write_json(DAILY_CHANGE_FILE, daily_change)
    if args.monthly or not MONTHLY_REPORT_FILE.exists():
        write_json(MONTHLY_REPORT_FILE, build_monthly_report(latest, metadata))
    write_json(LATEST_FILE, latest)
    print(f"Market reports updated: ranking={ranking['count']}, monthly={args.monthly}")


if __name__ == "__main__":
    main()
