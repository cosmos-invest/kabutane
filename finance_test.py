import csv
import yfinance as yf

codes = [
    ("9984.T", "ソフトバンクG"),
    ("9101.T", "日本郵船"),
    ("7203.T", "トヨタ")
]

results = []

for code, name in codes:

    print(f"取得中: {name}")

    try:

        ticker = yf.Ticker(code)

        info = ticker.info

        results.append({
            "code": code,
            "name": name,

            "per": info.get("trailingPE"),
            "pbr": info.get("priceToBook"),
            "dividend_yield": info.get("dividendYield"),
            "roe": info.get("returnOnEquity"),
            "market_cap": info.get("marketCap")
        })

    except Exception as e:

        print(f"エラー: {name} {e}")

        results.append({
            "code": code,
            "name": name,

            "per": None,
            "pbr": None,
            "dividend_yield": None,
            "roe": None,
            "market_cap": None
        })

with open(
    "finance_result.csv",
    "w",
    newline="",
    encoding="utf-8-sig"
) as f:

    writer = csv.DictWriter(
        f,
        fieldnames=[
            "code",
            "name",
            "per",
            "pbr",
            "dividend_yield",
            "roe",
            "market_cap"
        ]
    )

    writer.writeheader()
    writer.writerows(results)

print("\nfinance_result.csv 出力完了")