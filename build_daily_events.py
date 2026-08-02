from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
SNAPSHOT_SCHEMA = "kabutane_daily_snapshot_v1"
EVENT_SCHEMA = "kabutane_daily_events_v1"
PRICE_MOVE_THRESHOLD = 3.0
RANK_MOVE_THRESHOLD = 5
NEAR_CROSS_THRESHOLD = 1.0
POSITIVE_RETURN_MILESTONES = (10.0, 20.0, 30.0, 50.0, 100.0)
NEGATIVE_RETURN_MILESTONES = (-10.0, -20.0, -30.0, -50.0)


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def integer(value: Any) -> int | None:
    number = finite(value)
    return int(number) if number is not None else None


def write_json_if_changed(path: Path, payload: Any) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def rows_by_code(snapshot: dict[str, Any], key: str = "records") -> dict[str, dict[str, Any]]:
    return {
        str(row.get("code")): row
        for row in snapshot.get(key) or []
        if isinstance(row, dict) and row.get("code")
    }


def previous_snapshot_path(root: Path, current_date: str) -> Path | None:
    directory = root / "history" / "daily"
    if not directory.exists():
        return None
    candidates = [
        path for path in directory.glob("*.json")
        if path.stem < current_date and len(path.stem) == 10
    ]
    return max(candidates, key=lambda path: path.stem) if candidates else None


def event_id(date: str, event_type: str, code: str, qualifier: str = "") -> str:
    raw = f"{date}|{event_type}|{code}|{qualifier}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"{date}:{event_type}:{code}:{digest}"


def make_event(
    *,
    date: str,
    event_type: str,
    category: str,
    severity: str,
    priority: int,
    row: dict[str, Any],
    title: str,
    detail: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    qualifier: str = "",
) -> dict[str, Any]:
    code = str(row.get("code") or "")
    return {
        "event_id": event_id(date, event_type, code, qualifier),
        "date": date,
        "type": event_type,
        "category": category,
        "severity": severity,
        "priority": priority,
        "code": code,
        "ticker": row.get("ticker"),
        "name": row.get("name") or code,
        "market": row.get("market"),
        "sector": row.get("sector"),
        "title": title,
        "detail": detail,
        **({"before": before} if before else {}),
        **({"after": after} if after else {}),
    }


def crossed_return_milestone(previous: float | None, current: float | None) -> float | None:
    if previous is None or current is None or previous == current:
        return None
    if current > previous:
        crossed = [threshold for threshold in POSITIVE_RETURN_MILESTONES if previous < threshold <= current]
        return max(crossed) if crossed else None
    crossed = [threshold for threshold in NEGATIVE_RETURN_MILESTONES if previous > threshold >= current]
    return min(crossed) if crossed else None


def provisional_state(row: dict[str, Any]) -> dict[str, Any] | None:
    value = row.get("provisional")
    return value if isinstance(value, dict) else None


def detect_events(previous: dict[str, Any], current: dict[str, Any]) -> list[dict[str, Any]]:
    date = str(current.get("snapshot_date") or "")
    previous_rows = rows_by_code(previous)
    current_rows = rows_by_code(current)
    current_out = rows_by_code(current, "recent_out")
    events: list[dict[str, Any]] = []

    # Official monthly signal transitions.
    for code in sorted(set(current_rows) - set(previous_rows)):
        row = current_rows[code]
        status = str(row.get("status") or "")
        if status == "NEW":
            events.append(make_event(
                date=date, event_type="OFFICIAL_NEW", category="signal", severity="high", priority=100,
                row=row, title="正式NEWシグナル",
                detail="完成済み月足で月足RSI14が5か月MAを上抜け、正式NEWになりました。",
                after={"status": status, "signal_month": row.get("signal_month")},
            ))
        else:
            events.append(make_event(
                date=date, event_type="ACTIVE_ADDED", category="signal", severity="medium", priority=72,
                row=row, title="監視対象に追加",
                detail="前回snapshotにはなく、今回の正式シグナル対象に追加されました。",
                after={"status": status, "signal_month": row.get("signal_month")},
            ))

    for code in sorted(set(previous_rows) - set(current_rows)):
        previous_row = previous_rows[code]
        out_row = current_out.get(code)
        row = out_row or previous_row
        if out_row:
            events.append(make_event(
                date=date, event_type="OFFICIAL_OUT", category="signal", severity="high", priority=100,
                row=row, title="正式OUTシグナル",
                detail="完成済み月足で月足RSI14が5か月MA以下となり、正式OUTになりました。",
                before={"status": previous_row.get("status"), "rank": previous_row.get("rank")},
                after={"status": "OUT", "exit_month": out_row.get("exit_month")},
            ))
        else:
            events.append(make_event(
                date=date, event_type="ACTIVE_REMOVED", category="signal", severity="medium", priority=70,
                row=row, title="監視対象から外れた銘柄",
                detail="前回snapshotにはありましたが、今回のactive一覧から外れました。OUT情報との照合が必要です。",
                before={"status": previous_row.get("status"), "rank": previous_row.get("rank")},
            ))

    for code in sorted(set(current_rows) & set(previous_rows)):
        row = current_rows[code]
        old = previous_rows[code]
        current_provisional = provisional_state(row)
        previous_provisional = provisional_state(old)

        # Provisional monthly cross/recovery. Official status is never changed here.
        if current_provisional:
            current_status = str(current_provisional.get("status") or "")
            current_changed = current_provisional.get("changed_from_confirmed") is True
            previous_status = str((previous_provisional or {}).get("status") or "")
            previous_changed = (previous_provisional or {}).get("changed_from_confirmed") is True
            if current_changed and current_status in {"GC", "DC"} and (
                not previous_changed or previous_status != current_status
            ):
                label = "暫定GC" if current_status == "GC" else "暫定DC"
                events.append(make_event(
                    date=date, event_type=f"PROVISIONAL_{current_status}", category="signal",
                    severity="high", priority=92, row=row, title=f"{label}を検出",
                    detail="当月途中の最新日足で試算した月足RSIが、正式判定と異なる側へ動いています。月末確定までは参考情報です。",
                    before={
                        "status": previous_status or None,
                        "spread": finite((previous_provisional or {}).get("spread")),
                    },
                    after={
                        "status": current_status,
                        "spread": finite(current_provisional.get("spread")),
                        "price_date": current_provisional.get("price_date"),
                    },
                ))
            elif previous_changed and not current_changed:
                events.append(make_event(
                    date=date, event_type="PROVISIONAL_RECOVERY", category="signal",
                    severity="medium", priority=82, row=row, title="暫定シグナルが正式状態側へ回復",
                    detail="前回は正式判定と異なる暫定状態でしたが、最新日足では正式状態側へ戻りました。",
                    before={"status": previous_status, "spread": finite((previous_provisional or {}).get("spread"))},
                    after={"status": current_status, "spread": finite(current_provisional.get("spread"))},
                ))

            current_spread = finite(current_provisional.get("spread"))
            previous_spread = finite((previous_provisional or {}).get("spread"))
            if (
                current_spread is not None
                and previous_spread is not None
                and abs(current_spread) <= NEAR_CROSS_THRESHOLD
                and abs(previous_spread) > NEAR_CROSS_THRESHOLD
                and not current_changed
            ):
                events.append(make_event(
                    date=date, event_type="RSI_NEAR_CROSS", category="signal",
                    severity="medium", priority=76, row=row, title="月足RSIがクロス接近",
                    detail=f"暫定月足RSI14と5か月MAの差が {current_spread:.2f}pt まで縮まりました。",
                    before={"spread": previous_spread}, after={"spread": current_spread},
                ))

        old_rank = integer(old.get("rank"))
        new_rank = integer(row.get("rank"))
        top10_entry = new_rank is not None and new_rank <= 10 and (old_rank is None or old_rank > 10)
        if top10_entry:
            events.append(make_event(
                date=date, event_type="TOP10_ENTRY", category="ranking", severity="medium", priority=70,
                row=row, title="ランキングTOP10入り",
                detail=f"GC後リターン順位が {new_rank}位 まで上がりました。",
                before={"rank": old_rank}, after={"rank": new_rank},
            ))
        elif old_rank is not None and new_rank is not None:
            move = old_rank - new_rank
            if abs(move) >= RANK_MOVE_THRESHOLD:
                direction = "上昇" if move > 0 else "低下"
                events.append(make_event(
                    date=date, event_type="RANK_MOVE", category="ranking", severity="low", priority=55,
                    row=row, title=f"順位が{direction}",
                    detail=f"GC後リターン順位が {old_rank}位 → {new_rank}位（{abs(move)}位変動）。",
                    before={"rank": old_rank}, after={"rank": new_rank, "move": move},
                    qualifier=str(move),
                ))

        daily_change = finite(row.get("daily_change_pct"))
        if daily_change is not None and abs(daily_change) >= PRICE_MOVE_THRESHOLD:
            direction = "上昇" if daily_change > 0 else "下落"
            events.append(make_event(
                date=date, event_type="PRICE_MOVE", category="price", severity="low", priority=50,
                row=row, title=f"当日{abs(daily_change):.1f}%{direction}",
                detail=f"最新の日次騰落率が {daily_change:+.2f}% です。",
                after={"daily_change_pct": daily_change, "current_price": finite(row.get("current_price"))},
                qualifier=f"{daily_change:+.2f}",
            ))

        old_return = finite(old.get("return_since_gc_pct"))
        new_return = finite(row.get("return_since_gc_pct"))
        milestone = crossed_return_milestone(old_return, new_return)
        if milestone is not None:
            events.append(make_event(
                date=date, event_type="RETURN_MILESTONE", category="performance",
                severity="medium", priority=62, row=row,
                title=f"GC後リターンが {milestone:+.0f}% の節目を通過",
                detail=f"GC後リターンが {old_return:+.2f}% → {new_return:+.2f}% となりました。",
                before={"return_since_gc_pct": old_return},
                after={"return_since_gc_pct": new_return, "milestone": milestone},
                qualifier=str(milestone),
            ))

    events.sort(key=lambda event: (-int(event.get("priority") or 0), str(event.get("code") or ""), str(event.get("type") or "")))
    return events


def build_event_feed(root: Path) -> dict[str, Any]:
    current = read_json(root / "data" / "daily-snapshot.json", {}) or {}
    if current.get("schema_version") != SNAPSHOT_SCHEMA:
        raise RuntimeError("data/daily-snapshot.json のschema_versionが不正です。")
    current_date = str(current.get("snapshot_date") or "")
    if not current_date:
        raise RuntimeError("data/daily-snapshot.json にsnapshot_dateがありません。")

    previous_path = previous_snapshot_path(root, current_date)
    previous = read_json(previous_path, {}) if previous_path else {}
    previous_date = str((previous or {}).get("snapshot_date") or "") or None
    events = detect_events(previous or {}, current) if previous_path else []
    categories = Counter(str(event.get("category") or "other") for event in events)
    severities = Counter(str(event.get("severity") or "low") for event in events)

    return {
        "schema_version": EVENT_SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_date": current_date,
        "previous_snapshot_date": previous_date,
        "comparison_state": "compared" if previous_path else "baseline_no_previous",
        "signal_version": current.get("signal_version"),
        "signal_month": current.get("signal_month"),
        "summary": {
            "event_count": len(events),
            "high_count": severities.get("high", 0),
            "medium_count": severities.get("medium", 0),
            "low_count": severities.get("low", 0),
            "signal_count": categories.get("signal", 0),
            "ranking_count": categories.get("ranking", 0),
            "price_count": categories.get("price", 0),
            "performance_count": categories.get("performance", 0),
        },
        "events": events,
        "rules": {
            "price_move_threshold_pct": PRICE_MOVE_THRESHOLD,
            "rank_move_threshold": RANK_MOVE_THRESHOLD,
            "near_cross_threshold_pt": NEAR_CROSS_THRESHOLD,
            "positive_return_milestones_pct": list(POSITIVE_RETURN_MILESTONES),
            "negative_return_milestones_pct": list(NEGATIVE_RETURN_MILESTONES),
        },
        "cost_policy": "paid_api_disabled",
    }


def save_event_feed(root: Path, payload: dict[str, Any]) -> tuple[Path, Path, bool, bool]:
    date = str(payload["snapshot_date"])
    current_path = root / "data" / "daily-events.json"
    history_path = root / "history" / "daily-events" / f"{date}.json"
    current_changed = write_json_if_changed(current_path, payload)
    history_changed = write_json_if_changed(history_path, payload)
    return current_path, history_path, current_changed, history_changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Build structured events from consecutive Kabutane daily snapshots")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    payload = build_event_feed(root)
    current, history, current_changed, history_changed = save_event_feed(root, payload)
    print(
        f"Daily events: date={payload['snapshot_date']} previous={payload['previous_snapshot_date']} "
        f"events={payload['summary']['event_count']} current_changed={current_changed} history_changed={history_changed}"
    )
    print(f"  current: {current.relative_to(root)}")
    print(f"  history: {history.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
