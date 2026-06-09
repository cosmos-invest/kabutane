import yfinance as yf

codes = [
    ("9984.T", "ソフトバンクG"),
    ("9101.T", "日本郵船"),
    ("7203.T", "トヨタ")
]

for code, name in codes:

    print("\n======================")
    print(name)
    print("======================")

    try:

        ticker = yf.Ticker(code)

        info = ticker.info

        print("PER:", info.get("trailingPE"))
        print("PBR:", info.get("priceToBook"))
        print("配当利回り:", info.get("dividendYield"))
        print("ROE:", info.get("returnOnEquity"))

        print()

        print("BS取得:", not ticker.balance_sheet.empty)
        print("PL取得:", not ticker.financials.empty)
        print("CF取得:", not ticker.cashflow.empty)

    except Exception as e:

        print("エラー:", e)