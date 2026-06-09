import yfinance as yf

ticker = yf.Ticker("9984.T")

print("===== INFO =====")

info = ticker.info

for key in [
    "trailingPE",
    "priceToBook",
    "dividendYield",
    "returnOnEquity",
    "marketCap",
]:
    print(key, "=", info.get(key))

print()
print("===== CASHFLOW =====")
print(ticker.cashflow.head(10))

print()
print("===== BALANCE SHEET =====")
print(ticker.balance_sheet.head(10))