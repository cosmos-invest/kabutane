import csv
import yfinance as yf
import pandas as pd


def calc_rsi(series, period):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()

    rs = avg_gain / avg_loss

    return 100 - (100 / (1 + rs))


def main():
    # -----------------------------
    # 銘柄一覧読込
    # -----------------------------
    codes = []
    with open("stocks.csv", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            codes.append((row["code"].strip(), row["name"].strip()))

    # -----------------------------
    # RSI判定
    # -----------------------------
    results = []

    print("\n処理開始\n")

    for code, name in codes:
        print(f"処理中: {name} ({code})")
        try:
            ticker = yf.Ticker(code)
            df = ticker.history(period="5y", interval="1mo")

            if len(df) == 0:
                print("  → データなし\n")
                continue

            if len(df) < 14:
                print("  → データ不足\n")
                continue

            df["RSI14"] = calc_rsi(df["Close"], 14)
            df["RSI5"] = calc_rsi(df["Close"], 5)

            latest = df.iloc[-1]

            rsi14 = float(latest["RSI14"])
            rsi5 = float(latest["RSI5"])

            diff = rsi5 - rsi14

            if rsi14 < rsi5:
                results.append({
                    "code": code,
                    "name": name,
                    "rsi14": round(rsi14, 2),
                    "rsi5": round(rsi5, 2),
                    "diff": round(diff, 2),
                })
                print("  → 条件成立\n")
            else:
                print("  → 条件不成立\n")
        except Exception as e:
            print(f"  → エラー: {e}\n")
            continue

    # -----------------------------
    # 差分順ソート
    # -----------------------------
    results.sort(key=lambda x: x["diff"], reverse=True)

    # -----------------------------
    # 結果表示
    # -----------------------------
    print("\n====================================")
    print("RSI14 < RSI5 条件成立銘柄")
    print("====================================\n")

    if len(results) == 0:
        print("対象銘柄なし")
    else:
        for stock in results:
            print(
                f"{stock['name']} "
                f"({stock['code']}) "
                f"RSI14={stock['rsi14']} "
                f"RSI5={stock['rsi5']} "
                f"差分={stock['diff']}"
            )

    print(f"\n合計 {len(results)} 件")


if __name__ == "__main__":
    main()
