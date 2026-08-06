from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from scripts.public_core_radar import write_public_radar

ROOT = Path(__file__).resolve().parents[1]
CORE_RADAR = ROOT / "data" / "core" / "radar.json"
SUPPLY_SCREEN = ROOT / "data" / "premium" / "supply-demand-screen.json"
OUTPUT = ROOT / "data" / "premium" / "opportunity-radar.json"
ENGINE_VERSION = "priority_v1_44_20_26_10"
SCORE_CAPS = {"signal": 44, "trend_volume": 20, "supply": 26, "finance": 10}


def finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def signal_score(row: dict[str, Any]) -> tuple[float, list[str]]:
    status = str(row.get("provisional_status") or "UNKNOWN")
    spread = finite(row.get("monthly_rsi_spread"))
    reasons: list[str] = []
    if status == "GC":
        score = 40.0
        reasons.append("進行中月で暫定GC")
    elif status == "NEAR_GC":
        score = 32.0
        reasons.append("GCまでの差が2pt以内")
    elif status == "CONTINUE":
        score = 20.0
        reasons.append("進行中月もGC状態を維持")
    elif status == "DC":
        score = 4.0
        reasons.append("進行中月は暫定DCに注意")
    else:
        score = 0.0
    if spread is not None and status in {"GC", "NEAR_GC"}:
        score += clamp(spread, -2, 5) * 1.2
    return clamp(score, 0, 44), reasons


def trend_score(row: dict[str, Any]) -> tuple[float, list[str]]:
    score = 0.0
    reasons: list[str] = []
    if row.get("above_sma200") is True:
        score += 5
        reasons.append("株価がSMA200より上")
    if row.get("perfect_order") is True:
        score += 6
        reasons.append("SMA25＞75＞200")
    volume_ratio = finite(row.get("volume_ratio_5_30"))
    if volume_ratio is not None:
        if volume_ratio >= 2:
            score += 5
            reasons.append("直近出来高が30日平均の2倍以上")
        elif volume_ratio >= 1.5:
            score += 3
            reasons.append("直近出来高が増加")
    high_distance = finite(row.get("high52_distance_pct"))
    if high_distance is not None and high_distance >= -5:
        score += 4
        reasons.append("52週高値まで5%以内")
    return clamp(score, 0, 20), reasons


def finance_score(row: dict[str, Any]) -> tuple[float, list[str]]:
    if not row.get("fundamentals_available"):
        return 0.0, []
    score = 0.0
    reasons: list[str] = []
    roe = finite(row.get("roe_pct"))
    equity = finite(row.get("equity_ratio_pct"))
    revenue = finite(row.get("revenue_growth_pct"))
    fcf = finite(row.get("free_cashflow_oku"))
    if roe is not None and roe > 0:
        score += 3
    if equity is not None and equity >= 30:
        score += 3
        reasons.append("自己資本比率30%以上")
    if revenue is not None and revenue > 0:
        score += 2
        reasons.append("売上成長率がプラス")
    if fcf is not None and fcf > 0:
        score += 2
        reasons.append("FCFがプラス")
    return clamp(score, 0, 10), reasons


def supply_component(supply: dict[str, Any] | None) -> tuple[float, list[str]]:
    if not supply:
        return 0.0, []
    raw = finite(supply.get("score")) or 0.0
    score = clamp(raw / 100 * 26, 0, 26)
    reasons = list(supply.get("reasons") or [])[:2]
    return score, reasons


def build_row(row: dict[str, Any], supply: dict[str, Any] | None) -> dict[str, Any]:
    s_signal, signal_reasons = signal_score(row)
    s_trend, trend_reasons = trend_score(row)
    s_finance, finance_reasons = finance_score(row)
    s_supply, supply_reasons = supply_component(supply)
    priority = round(clamp(s_signal + s_trend + s_finance + s_supply, 0, 100), 1)

    tags: list[str] = []
    status = str(row.get("provisional_status") or "UNKNOWN")
    if status == "GC": tags.append("暫定GC")
    elif status == "NEAR_GC": tags.append("GC接近")
    elif status == "DC": tags.append("暫定DC")
    if supply:
        tags.append(f"需給{str(supply.get('grade') or 'B')}")
    if row.get("perfect_order") is True:
        tags.append("上昇配列")
    if (finite(row.get("volume_ratio_5_30")) or 0) >= 1.5:
        tags.append("出来高増")

    return {
        "code": row.get("code"), "ticker": row.get("ticker"), "name": row.get("name"),
        "market": row.get("market"), "sector": row.get("sector"),
        "price_date": row.get("price_date"), "current_price": row.get("current_price"),
        "provisional_status": status, "confirmed_status": row.get("confirmed_status"), "confirmed_month": row.get("confirmed_month"),
        "monthly_rsi14": row.get("monthly_rsi14"), "monthly_rsi_ma5": row.get("monthly_rsi_ma5"), "monthly_rsi_spread": row.get("monthly_rsi_spread"),
        "sma25": row.get("sma25"), "sma75": row.get("sma75"), "sma200": row.get("sma200"),
        "above_sma200": row.get("above_sma200"), "perfect_order": row.get("perfect_order"),
        "volume_ratio_5_30": row.get("volume_ratio_5_30"), "high52_distance_pct": row.get("high52_distance_pct"),
        "per": row.get("per"), "pbr": row.get("pbr"), "roe_pct": row.get("roe_pct"), "equity_ratio_pct": row.get("equity_ratio_pct"),
        "revenue_growth_pct": row.get("revenue_growth_pct"), "free_cashflow_oku": row.get("free_cashflow_oku"),
        "data_completeness_pct": row.get("data_completeness_pct"), "fundamentals_available": row.get("fundamentals_available"), "fundamentals_stale": row.get("fundamentals_stale"),
        "supply_grade": supply.get("grade") if supply else None, "supply_score": supply.get("score") if supply else None,
        "buy_reduction_pct": supply.get("buy_reduction_pct") if supply else None, "sell_change_pct": supply.get("sell_change_pct") if supply else None,
        "ratio_reduction_pct": supply.get("ratio_reduction_pct") if supply else None, "margin_ratio": supply.get("ratio") if supply else None,
        "priority_score": priority,
        "score_components": {"signal": round(s_signal, 1), "trend_volume": round(s_trend, 1), "supply": round(s_supply, 1), "finance": round(s_finance, 1)},
        "tags": tags,
        "reasons": (signal_reasons + supply_reasons + trend_reasons + finance_reasons)[:6],
    }


def build_payload() -> dict[str, Any]:
    radar = load_json(CORE_RADAR, {})
    supply_payload = load_json(SUPPLY_SCREEN, {})
    supply_map = {
        str(item.get("code") or ""): item
        for item in supply_payload.get("candidates") or []
        if item.get("scope") == "core" and item.get("code")
    }
    rows = [build_row(row, supply_map.get(str(row.get("code") or ""))) for row in radar.get("records") or []]
    rows.sort(key=lambda item: (-float(item.get("priority_score") or 0), str(item.get("code") or "")))
    for rank, item in enumerate(rows, start=1):
        item["priority_rank"] = rank
    status_counts = {
        status: sum(item.get("provisional_status") == status for item in rows)
        for status in ["GC", "NEAR_GC", "CONTINUE", "DC", "OUT", "UNKNOWN"]
    }
    composite = sum(
        item.get("provisional_status") in {"GC", "NEAR_GC"} and finite(item.get("supply_score")) is not None
        for item in rows
    )
    return {
        "schema_version": 3,
        "kind": "kabutane_premium_opportunity_radar",
        "engine_version": ENGINE_VERSION,
        "score_caps": SCORE_CAPS,
        "generated_at": radar.get("generated_at"),
        "price_date": max((str(item.get("price_date") or "") for item in rows), default="") or None,
        "margin_date": supply_payload.get("latest_date"),
        "core_count": int(radar.get("core_count") or len(rows)),
        "daily_coverage": int(radar.get("daily_coverage") or 0),
        "monthly_coverage": int(radar.get("monthly_coverage") or 0),
        "fundamentals_coverage": int(radar.get("fundamentals_coverage") or 0),
        "status_counts": status_counts,
        "supply_candidate_count": sum(item.get("supply_score") is not None for item in rows),
        "early_supply_combo_count": composite,
        "notice": "観察優先度は買い推奨ではありません。暫定月足RSI・日足トレンド/出来高・JPX週次信用残高・取得済み財務を同じ画面で比較するためのβ指標です。",
        "records": rows,
    }


def main() -> None:
    payload = build_payload()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
        OUTPUT.write_text(text, encoding="utf-8")
    public_payload = write_public_radar()
    print(
        "Premium opportunity radar: "
        f"engine={payload['engine_version']} core={payload['core_count']} GC={payload['status_counts'].get('GC', 0)} "
        f"near={payload['status_counts'].get('NEAR_GC', 0)} supply={payload['supply_candidate_count']} "
        f"public={len(public_payload.get('records') or [])}"
    )


if __name__ == "__main__":
    main()
