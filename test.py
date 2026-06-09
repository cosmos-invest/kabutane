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
            codes.append(
                (
                    row["code"].strip(),
                    row["name"].strip()
                )
            )

    # -----------------------------
    # RSI判定
    # -----------------------------
    results = []

    print("\n処理開始\n")

    for code, name in codes:

        print(f"処理中: {name} ({code})")

        try:

            ticker = yf.Ticker(code)

            # 月足取得
            monthly = ticker.history(
                period="5y",
                interval="1mo"
            )

            if len(monthly) == 0:
                print("  → データなし\n")
                continue

            if len(monthly) < 14:
                print("  → データ不足\n")
                continue

            monthly["RSI14"] = calc_rsi(
                monthly["Close"],
                14
            )

            monthly["RSI5"] = calc_rsi(
                monthly["Close"],
                5
            )

            latest = monthly.iloc[-1]

            rsi14 = float(latest["RSI14"])
            rsi5 = float(latest["RSI5"])

            diff = rsi5 - rsi14

            # 前月終値
            monthly_close = float(latest["Close"])

            # 日足取得
            daily = ticker.history(
                period="10d",
                interval="1d"
            )

            if len(daily) > 0:
                current_price = float(
                    daily["Close"].iloc[-1]
                )
            else:
                current_price = monthly_close

            change_pct = (
                (current_price - monthly_close)
                / monthly_close
            ) * 100

            if rsi14 < rsi5:

                results.append({

                    "code": code,
                    "name": name,

                    "rsi14": round(rsi14, 2),
                    "rsi5": round(rsi5, 2),
                    "diff": round(diff, 2),

                    "monthly_close": round(
                        monthly_close,
                        2
                    ),

                    "current_price": round(
                        current_price,
                        2
                    ),

                    "change_pct": round(
                        change_pct,
                        2
                    )
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
    results.sort(
        key=lambda x: x["diff"],
        reverse=True
    )

    # -----------------------------
    # CSV出力
    # -----------------------------
    with open(
        "result.csv",
        "w",
        newline="",
        encoding="utf-8-sig"
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=[
                "code",
                "name",
                "rsi14",
                "rsi5",
                "diff",
                "monthly_close",
                "current_price",
                "change_pct"
            ]
        )

        writer.writeheader()
        writer.writerows(results)

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
                f"差分={stock['diff']} "
                f"前月終値={stock['monthly_close']} "
                f"現在値={stock['current_price']} "
                f"騰落率={stock['change_pct']}%"
            )

    print(f"\n合計 {len(results)} 件")
    print("result.csv 出力完了")


if __name__ == "__main__":
    main()