from __future__ import annotations

import io
import json
import math
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parent
STOCKS_FILE = ROOT / "stocks.csv"
ALL_STOCKS_FILE = ROOT / "stocks-all.csv"
STATUS_FILE = ROOT / "data" / "universe-status.json"
CATALOG_FILE = ROOT / "data" / "universe-all.json"
JPX_PAGE = "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html"
CORE_MARKETS = ("プライム", "スタンダード", "グロース")
YF_BATCH_SIZE = 100


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Kabutane/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def discover_excel_url(page_html: str, base_url: str = JPX_PAGE) -> str:
    links = re.findall(r'href=["\']([^"\']+\.(?:xlsx?|XLSX?)(?:\?[^"\']*)?)["\']', page_html)
    if not links:
        raise RuntimeError("JPX上場銘柄一覧のExcelリンクを見つけられませんでした。")
    preferred = next((link for link in links if "data_j" in link.lower()), links[0])
    return urllib.parse.urljoin(base_url, preferred)


def normalize_columns(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.columns = [str(column).replace("\n", "").replace(" ", "").strip() for column in normalized.columns]
    return normalized


def find_column(columns: list[str], candidates: tuple[str, ...]) -> str:
    for candidate in candidates:
        for column in columns:
            if candidate in column:
                return column
    raise RuntimeError(f"必要な列がありません: {candidates}")


def clean_code(value: Any) -> str:
    text = str(value).strip().upper()
    if text.endswith(".0"):
        text = text[:-2]
    return text


def classify_issue(market: str, name: str = "") -> tuple[str, str]:
    value = str(market or "").strip()
    upper = value.upper()
    issue_name = str(name or "").strip().upper()

    # JPXの上場銘柄一覧ではETFとETNが同じ商品区分でまとまる場合があるため、
    # 銘柄名のETN/NEXT NOTES表記も使って分類する。
    if "ETF" in upper or "ETN" in upper:
        if "ETN" in issue_name or "NEXT NOTES" in issue_name or "ETN" in upper and "ETF" not in upper:
            return "etn", "extended"
        return "etf", "extended"
    if "REIT" in upper or "不動産投資信託" in value:
        return "reit", "extended"
    if "インフラ" in value:
        return "infrastructure_fund", "extended"
    if "PRO MARKET" in upper or "TOKYO PRO" in upper:
        return "tokyo_pro", "extended"
    if "ベンチャーファンド" in value:
        return "venture_fund", "extended"
    if "カントリーファンド" in value:
        return "country_fund", "extended"
    if "優先出資" in value or "出資証券" in value:
        return "preferred_equity", "extended"
    if "外国" in value:
        return "foreign_stock", "extended"
    if any(core_name in value for core_name in CORE_MARKETS) and ("内国株式" in value or "内国" not in value):
        return "domestic_common_stock", "core"
    if any(core_name in value for core_name in CORE_MARKETS):
        return "other_stock", "extended"
    return "other", "extended"


def build_all_universe(frame: pd.DataFrame) -> pd.DataFrame:
    work = normalize_columns(frame)
    columns = list(work.columns)
    code_col = find_column(columns, ("コード", "Code"))
    name_col = find_column(columns, ("銘柄名", "会社名", "Name"))
    market_col = find_column(columns, ("市場・商品区分", "市場区分", "Market"))
    sector_col = next((column for column in columns if "33業種" in column), None)

    output = pd.DataFrame(
        {
            "code": work[code_col].map(clean_code),
            "name": work[name_col].astype(str).str.strip(),
            "market": work[market_col].astype(str).str.strip(),
            "sector": work[sector_col].astype(str).str.strip() if sector_col else "",
        }
    )
    output = output[output["code"].str.match(r"^[0-9A-Z]{4}$", na=False)].copy()
    labels = [classify_issue(market, name) for market, name in zip(output["market"], output["name"])]
    output["instrument_type"] = [item[0] for item in labels]
    output["scope"] = [item[1] for item in labels]
    output = output.drop_duplicates(subset=["code"], keep="first").sort_values("code").reset_index(drop=True)
    if len(output) < 4000:
        raise RuntimeError(f"全上場銘柄の抽出件数が少なすぎます: {len(output)}件")
    return output


def build_universe(frame: pd.DataFrame) -> pd.DataFrame:
    all_issues = build_all_universe(frame)
    core = all_issues[all_issues["scope"] == "core"].copy()
    if len(core) < 3000:
        raise RuntimeError(f"通常対象の抽出件数が少なすぎます: {len(core)}件")
    return core[["code", "name", "market", "sector"]].reset_index(drop=True)


def write_catalog(all_issues: pd.DataFrame, generated_at: str, excel_url: str) -> None:
    records = all_issues.to_dict(orient="records")
    payload = {
        "generated_at": generated_at,
        "source_page": JPX_PAGE,
        "source_file": excel_url,
        "total": len(records),
        "core_total": int((all_issues["scope"] == "core").sum()),
        "extended_total": int((all_issues["scope"] == "extended").sum()),
        "records": records,
    }
    CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_FILE.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    page = fetch_bytes(JPX_PAGE).decode("utf-8", errors="replace")
    excel_url = discover_excel_url(page)
    excel_bytes = fetch_bytes(excel_url)
    frame = pd.read_excel(io.BytesIO(excel_bytes), dtype=str)
    all_issues = build_all_universe(frame)
    universe = all_issues[all_issues["scope"] == "core"].copy()

    universe[["code", "name", "market", "sector"]].to_csv(STOCKS_FILE, index=False, encoding="utf-8-sig")
    all_issues.to_csv(ALL_STOCKS_FILE, index=False, encoding="utf-8-sig")

    generated_at = datetime.now(timezone.utc).isoformat()
    write_catalog(all_issues, generated_at, excel_url)

    market_counts = {
        market: int(universe["market"].str.contains(market, na=False).sum())
        for market in CORE_MARKETS
    }
    category_counts = {
        key: int(value)
        for key, value in all_issues["instrument_type"].value_counts().sort_index().items()
    }
    core_total = int(len(universe))
    all_total = int(len(all_issues))
    status = {
        "generated_at": generated_at,
        "source_page": JPX_PAGE,
        "source_file": excel_url,
        "total": core_total,
        "all_listed_total": all_total,
        "extended_total": all_total - core_total,
        "market_counts": market_counts,
        "category_counts": category_counts,
        "scope": "core = TSE domestic common stocks: Prime, Standard, Growth; extended = all other TSE listed issue types",
        "monthly_price_batch_projection": {
            "batch_size": YF_BATCH_SIZE,
            "core_batches": math.ceil(core_total / YF_BATCH_SIZE),
            "all_listed_batches": math.ceil(all_total / YF_BATCH_SIZE),
            "issue_growth_pct": round((all_total / core_total - 1) * 100, 1) if core_total else None,
        },
    }
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Universe updated: core={core_total}, all={all_total}, extended={all_total-core_total}, "
        f"categories={category_counts}, projected monthly batches={status['monthly_price_batch_projection']}"
    )


if __name__ == "__main__":
    main()
