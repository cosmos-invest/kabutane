from __future__ import annotations

import io
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parent
STOCKS_FILE = ROOT / "stocks.csv"
STATUS_FILE = ROOT / "data" / "universe-status.json"
JPX_PAGE = "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html"
ALLOWED_MARKETS = ("プライム", "スタンダード", "グロース")


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


def build_universe(frame: pd.DataFrame) -> pd.DataFrame:
    work = normalize_columns(frame)
    columns = list(work.columns)
    code_col = find_column(columns, ("コード", "Code"))
    name_col = find_column(columns, ("銘柄名", "会社名", "Name"))
    market_col = find_column(columns, ("市場・商品区分", "市場区分", "Market"))
    sector_col = next((column for column in columns if "33業種" in column), None)

    market_text = work[market_col].astype(str)
    market_mask = market_text.apply(lambda value: any(market in value for market in ALLOWED_MARKETS))
    if market_text.str.contains("内国株式", na=False).any():
        market_mask &= market_text.str.contains("内国株式", na=False)

    output = pd.DataFrame(
        {
            "code": work.loc[market_mask, code_col].map(clean_code),
            "name": work.loc[market_mask, name_col].astype(str).str.strip(),
            "market": work.loc[market_mask, market_col].astype(str).str.strip(),
            "sector": work.loc[market_mask, sector_col].astype(str).str.strip() if sector_col else "",
        }
    )
    output = output[output["code"].str.match(r"^[0-9A-Z]{4}$", na=False)]
    output = output.drop_duplicates(subset=["code"], keep="first").sort_values("code")
    if len(output) < 3000:
        raise RuntimeError(f"抽出件数が少なすぎます: {len(output)}件")
    return output


def main() -> None:
    page = fetch_bytes(JPX_PAGE).decode("utf-8", errors="replace")
    excel_url = discover_excel_url(page)
    excel_bytes = fetch_bytes(excel_url)
    frame = pd.read_excel(io.BytesIO(excel_bytes), dtype=str)
    universe = build_universe(frame)
    universe.to_csv(STOCKS_FILE, index=False, encoding="utf-8-sig")

    market_counts: dict[str, int] = {}
    for market in ALLOWED_MARKETS:
        market_counts[market] = int(universe["market"].str.contains(market, na=False).sum())
    status = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_page": JPX_PAGE,
        "source_file": excel_url,
        "total": int(len(universe)),
        "market_counts": market_counts,
        "scope": "TSE domestic common stocks: Prime, Standard, Growth",
    }
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Universe updated: {len(universe)} issues ({market_counts})")


if __name__ == "__main__":
    main()
