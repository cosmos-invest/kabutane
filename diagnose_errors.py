from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
LATEST = ROOT / "data" / "latest.json"
STOCKS = ROOT / "stocks.csv"
REPORT_JSON = ROOT / "data" / "quality-report.json"
REPORT_MD = ROOT / "DATA_QUALITY.md"


def text(value: Any) -> str:
    return str(value or "").strip()


def load_stock_names() -> dict[str, str]:
    if not STOCKS.exists():
        return {}
    with STOCKS.open(encoding="utf-8-sig", newline="") as handle:
        return {
            text(row.get("code")): text(row.get("name"))
            for row in csv.DictReader(handle)
            if text(row.get("code"))
        }


def display_code(ticker: str) -> str:
    return ticker[:-2] if ticker.upper().endswith(".T") else ticker


def classify(stage: str, message: str) -> tuple[str, str]:
    value = message.lower()
    if "価格データなし" in message or "no price data" in value:
        return "price_missing", "価格データを取得できない"
    if "rsi計算に必要" in value or "月足が不足" in message or "insufficient" in value:
        return "history_short", "上場期間・履歴が短く計算期間不足"
    if any(token in value for token in ("429", "too many requests", "rate limit", "rate-limit")):
        return "rate_limited", "取得元のアクセス制限"
    if any(token in value for token in ("timeout", "timed out", "read timed out")):
        return "timeout", "通信タイムアウト"
    if any(token in value for token in ("possibly delisted", "no timezone found", "quote not found", "404", "not found")):
        return "symbol_unavailable", "銘柄コード変更・上場廃止・取得元未対応の可能性"
    if stage == "fundamentals":
        if any(token in value for token in ("unauthorized", "crumb", "cookie", "invalid")):
            return "fundamentals_auth", "財務APIの認証・セッションエラー"
        return "fundamentals_failed", "財務・企業情報の取得失敗"
    if stage in {"monthly", "daily"}:
        return "market_data_failed", "株価データの取得失敗"
    if "価格不連続" in message:
        return "price_discontinuity", "株式併合・再上場などの価格不連続"
    return "other", "その他"


def normalized_message(message: str) -> str:
    value = re.sub(r"https?://\S+", "<url>", message)
    value = re.sub(r"\b\d{3,}\b", "<number>", value)
    return value[:240]


def main() -> None:
    if not LATEST.exists():
        raise SystemExit("data/latest.json is missing")
    payload = json.loads(LATEST.read_text(encoding="utf-8"))
    errors = payload.get("errors") or []
    names = load_stock_names()

    reason_counts: Counter[str] = Counter()
    reason_labels: dict[str, str] = {}
    stage_counts: Counter[str] = Counter()
    message_counts: Counter[str] = Counter()
    reason_tickers: dict[str, set[str]] = defaultdict(set)
    reason_samples: dict[str, list[dict[str, str]]] = defaultdict(list)
    unique_tickers: set[str] = set()

    for item in errors:
        ticker = text(item.get("ticker"))
        stage = text(item.get("stage")) or "unknown"
        message = text(item.get("message")) or "内容不明"
        code = display_code(ticker)
        reason, label = classify(stage, message)
        reason_labels[reason] = label
        reason_counts[reason] += 1
        stage_counts[stage] += 1
        message_counts[normalized_message(message)] += 1
        if ticker:
            unique_tickers.add(ticker)
            reason_tickers[reason].add(ticker)
        if len(reason_samples[reason]) < 30:
            reason_samples[reason].append({
                "ticker": ticker,
                "code": code,
                "name": names.get(code, ""),
                "stage": stage,
                "message": message[:500],
            })

    records = payload.get("records") or []
    zero_fundamentals = [row for row in records if float(row.get("data_completeness_pct") or 0) == 0]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_generated_at": payload.get("generated_at"),
        "signal_month": payload.get("signal_month"),
        "summary": {
            "raw_error_count": len(errors),
            "unique_error_tickers": len(unique_tickers),
            "current_active_records": len(records),
            "active_zero_fundamentals": len(zero_fundamentals),
        },
        "by_stage": [{"stage": stage, "count": count} for stage, count in stage_counts.most_common()],
        "by_reason": [
            {
                "reason": reason,
                "label": reason_labels[reason],
                "error_count": count,
                "unique_tickers": len(reason_tickers[reason]),
                "samples": reason_samples[reason],
            }
            for reason, count in reason_counts.most_common()
        ],
        "top_messages": [{"message": message, "count": count} for message, count in message_counts.most_common(30)],
        "active_zero_fundamental_samples": [
            {"code": text(row.get("code")), "name": text(row.get("name"))}
            for row in zero_fundamentals[:50]
        ],
    }
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# かぶたね データ品質レポート",
        "",
        f"- 元データ生成日時: `{payload.get('generated_at') or '—'}`",
        f"- 判定月: `{payload.get('signal_month') or '—'}`",
        f"- エラー記録数: **{len(errors):,}件**",
        f"- エラーが記録された銘柄: **{len(unique_tickers):,}銘柄**",
        f"- 現在対象のうち財務充足率0%: **{len(zero_fundamentals):,}銘柄**",
        "",
        "## 処理段階別",
        "",
        "| 段階 | 件数 |",
        "|---|---:|",
    ]
    lines.extend(f"| {stage} | {count:,} |" for stage, count in stage_counts.most_common())
    lines += ["", "## 推定原因別", "", "| 原因 | 記録数 | 銘柄数 |", "|---|---:|---:|"]
    for reason, count in reason_counts.most_common():
        lines.append(f"| {reason_labels[reason]} | {count:,} | {len(reason_tickers[reason]):,} |")
    lines += [
        "",
        "## 読み方",
        "",
        "同じ銘柄が月足・日足・財務の複数段階で失敗すると、エラー記録数は銘柄数より多くなります。",
        "このレポートはエラー文から原因を分類した一次診断です。上位原因から再取得方式・銘柄マスター・取得元を見直します。",
        "",
        "詳細なサンプルは `data/quality-report.json` に保存しています。",
        "",
    ]
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
