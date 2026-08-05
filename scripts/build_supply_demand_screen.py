from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MARGIN_DIR = ROOT / "data" / "margin"
OUTPUT_DIR = ROOT / "data" / "premium"
OUTPUT_FILE = OUTPUT_DIR / "supply-demand-screen.json"
UNIVERSE_CATALOG = ROOT / "data" / "universe-all.json"
CORE_STOCKS = ROOT / "stocks.csv"


def finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def pct_change(first: Any, latest: Any) -> float | None:
    start = finite(first)
    end = finite(latest)
    if start is None or end is None or start == 0:
        return None
    return (end - start) / abs(start) * 100


def load_universe() -> dict[str, dict[str, Any]]:
    if UNIVERSE_CATALOG.exists():
        payload = json.loads(UNIVERSE_CATALOG.read_text(encoding="utf-8"))
        records = payload.get("records") if isinstance(payload, dict) else None
        if isinstance(records, list):
            return {str(item.get("code") or ""): item for item in records if item.get("code")}

    result: dict[str, dict[str, Any]] = {}
    if CORE_STOCKS.exists():
        with CORE_STOCKS.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                code = str(row.get("code") or "").strip().upper()
                if not code:
                    continue
                result[code] = {
                    "code": code,
                    "name": row.get("name") or "",
                    "market": row.get("market") or "",
                    "sector": row.get("sector") or "",
                    "instrument_type": "domestic_common_stock",
                    "scope": "core",
                }
    return result


def load_margin_records() -> dict[str, list[dict[str, Any]]]:
    merged: dict[str, list[dict[str, Any]]] = {}
    if not MARGIN_DIR.exists():
        return merged
    for path in sorted(MARGIN_DIR.glob("*.json")):
        if path.name == "latest.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        records = payload.get("records") if isinstance(payload, dict) else None
        if not isinstance(records, dict):
            continue
        for code, history in records.items():
            if isinstance(history, list):
                merged[str(code).upper()] = sorted(history, key=lambda item: str(item.get("date") or ""))
    return merged


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def score_history(history: list[dict[str, Any]]) -> dict[str, Any] | None:
    rows = history[-5:]
    if len(rows) < 4:
        return None

    first = rows[0]
    latest = rows[-1]
    first_buy = finite(first.get("buy_balance"))
    latest_buy = finite(latest.get("buy_balance"))
    if first_buy is None or latest_buy is None or first_buy <= 0:
        return None

    buy_change_pct = pct_change(first_buy, latest_buy)
    buy_reduction_pct = -buy_change_pct if buy_change_pct is not None else None
    first_sell = finite(first.get("sell_balance"))
    latest_sell = finite(latest.get("sell_balance"))
    sell_change_pct = pct_change(first_sell, latest_sell) if first_sell not in (None, 0) else None
    first_ratio = finite(first.get("ratio"))
    latest_ratio = finite(latest.get("ratio"))
    ratio_change_pct = pct_change(first_ratio, latest_ratio) if first_ratio not in (None, 0) else None
    ratio_reduction_pct = -ratio_change_pct if ratio_change_pct is not None else None

    buy_down_steps = 0
    sell_up_steps = 0
    for previous, current in zip(rows, rows[1:]):
        prev_buy = finite(previous.get("buy_balance"))
        curr_buy = finite(current.get("buy_balance"))
        if prev_buy is not None and curr_buy is not None and curr_buy < prev_buy:
            buy_down_steps += 1
        prev_sell = finite(previous.get("sell_balance"))
        curr_sell = finite(current.get("sell_balance"))
        if prev_sell is not None and curr_sell is not None and curr_sell > prev_sell:
            sell_up_steps += 1

    score = 0.0
    if buy_reduction_pct is not None and buy_reduction_pct > 0:
        score += clamp(buy_reduction_pct / 30 * 50, 0, 50)
    if ratio_reduction_pct is not None and ratio_reduction_pct > 0:
        score += clamp(ratio_reduction_pct / 40 * 25, 0, 25)
    if sell_change_pct is not None and sell_change_pct > 0:
        score += clamp(sell_change_pct / 50 * 15, 0, 15)
    score += clamp(buy_down_steps / max(1, len(rows) - 1) * 10, 0, 10)

    latest_buy_change = finite(latest.get("buy_change"))
    if latest_buy_change is not None and latest_buy_change <= 0:
        score += 5

    score = round(clamp(score, 0, 100), 1)
    qualifies = score >= 50 and (
        (buy_reduction_pct is not None and buy_reduction_pct >= 5)
        or (ratio_reduction_pct is not None and ratio_reduction_pct >= 10)
    )
    if not qualifies:
        return None

    if score >= 80:
        grade = "S"
    elif score >= 65:
        grade = "A"
    else:
        grade = "B"

    reasons: list[str] = []
    if buy_reduction_pct is not None and buy_reduction_pct > 0:
        reasons.append(f"買い残が{len(rows)}週で{buy_reduction_pct:.1f}%減少")
    if ratio_reduction_pct is not None and ratio_reduction_pct > 0:
        reasons.append(f"信用倍率が{ratio_reduction_pct:.1f}%低下")
    if sell_change_pct is not None and sell_change_pct > 0:
        reasons.append(f"売り残が{sell_change_pct:.1f}%増加")
    if buy_down_steps >= 3:
        reasons.append(f"買い残が{buy_down_steps}回減少")

    return {
        "score": score,
        "grade": grade,
        "start_date": first.get("date"),
        "latest_date": latest.get("date"),
        "weeks": len(rows),
        "buy_balance": int(latest_buy),
        "sell_balance": int(latest_sell) if latest_sell is not None else None,
        "ratio": round(latest_ratio, 2) if latest_ratio is not None else None,
        "buy_reduction_pct": round(buy_reduction_pct, 1) if buy_reduction_pct is not None else None,
        "sell_change_pct": round(sell_change_pct, 1) if sell_change_pct is not None else None,
        "ratio_reduction_pct": round(ratio_reduction_pct, 1) if ratio_reduction_pct is not None else None,
        "buy_down_steps": buy_down_steps,
        "sell_up_steps": sell_up_steps,
        "reasons": reasons,
    }


def build_screen() -> dict[str, Any]:
    universe = load_universe()
    histories = load_margin_records()
    candidates: list[dict[str, Any]] = []
    eligible = 0
    for code, history in histories.items():
        result = score_history(history)
        if len(history) >= 4:
            eligible += 1
        if result is None:
            continue
        meta = universe.get(code, {})
        candidates.append(
            {
                "code": code,
                "name": meta.get("name") or "",
                "market": meta.get("market") or "",
                "sector": meta.get("sector") or "",
                "instrument_type": meta.get("instrument_type") or "unknown",
                "scope": meta.get("scope") or "unknown",
                **result,
            }
        )
    candidates.sort(key=lambda item: (-float(item["score"]), item["code"]))

    margin_index = {}
    index_path = MARGIN_DIR / "latest.json"
    if index_path.exists():
        try:
            margin_index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            margin_index = {}

    return {
        "schema_version": 1,
        "kind": "premium_supply_demand_beta",
        "source": "JPX 銘柄別信用取引週末残高",
        "source_generated_at": margin_index.get("generated_at"),
        "latest_date": margin_index.get("latest_date"),
        "screened_codes": len(histories),
        "eligible_codes": eligible,
        "candidate_count": len(candidates),
        "notice": "β版。信用残高だけを使った需給改善候補で、株価・出来高・価格帯別出来高を合わせた最終判断ではありません。",
        "candidates": candidates[:250],
    }


def main() -> None:
    payload = build_screen()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if OUTPUT_FILE.exists() and OUTPUT_FILE.read_text(encoding="utf-8") == serialized:
        print("Supply-demand screen unchanged")
        return
    OUTPUT_FILE.write_text(serialized, encoding="utf-8")
    print(
        f"Supply-demand beta screen: screened={payload['screened_codes']}, "
        f"eligible={payload['eligible_codes']}, candidates={payload['candidate_count']}"
    )


if __name__ == "__main__":
    main()
