import csv
import yfinance as yf

codes = [
    ("7203.T", "トヨタ"),
    ("8927.T", "明豊エンタープライズ"),
    ("7120.T", "SHINKO"),
    ("5253.T", "カバー"),
    ("4412.T", "サイエンスアーツ"),
    ("5595.T", "QPS研究所")
]

target_fields = [
    "trailingPE",
    "forwardPE",
    "priceToBook",
    "bookValue",
    "dividendYield",
    "payoutRatio",
    "returnOnEquity",
    "returnOnAssets",
    "profitMargins",
    "operatingMargins",
    "revenueGrowth",
    "earningsGrowth",
    "currentRatio",
    "quickRatio",
    "debtToEquity",
    "freeCashflow",
    "operatingCashflow",
    "ebitda",
    "enterpriseValue",
    "marketCap",
    "beta",
    "sharesOutstanding",
    "totalCash",
    "totalDebt"
]

results = []

for code, name in codes:

    print(f"調査中: {name}")

    try:

        ticker = yf.Ticker(code)
        info = ticker.info

        row = {
            "code": code,
            "name": name
        }

        for field in target_fields:

            value = info.get(field)

            if value is None:
                row[field] = "NG"
            else:
                row[field] = "OK"

        row["balance_sheet"] = (
            "OK"
            if not ticker.balance_sheet.empty
            else "NG"
        )

        row["financials"] = (
            "OK"
            if not ticker.financials.empty
            else "NG"
        )

        row["cashflow"] = (
            "OK"
            if not ticker.cashflow.empty
            else "NG"
        )

        results.append(row)

    except Exception as e:

        print(f"エラー: {name} {e}")

        row = {
            "code": code,
            "name": name
        }

        for field in target_fields:
            row[field] = "ERROR"

        row["balance_sheet"] = "ERROR"
        row["financials"] = "ERROR"
        row["cashflow"] = "ERROR"

        results.append(row)

with open(
    "finance_availability.csv",
    "w",
    newline="",
    encoding="utf-8-sig"
) as f:

    writer = csv.DictWriter(
        f,
        fieldnames=results[0].keys()
    )

    writer.writeheader()
    writer.writerows(results)

print("\nfinance_availability.csv 出力完了")