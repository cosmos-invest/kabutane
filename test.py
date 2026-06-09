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


def safe_round(value, digits=2):

    if value is None:
        return None

    try:
        return round(float(value), digits)
    except:
        return None


def get_balance_sheet_value(bs, candidates):

    try:

        for name in candidates:

            if name in bs.index:
                value = bs.loc[name].iloc[0]

                if pd.notna(value):
                    return float(value)

    except:
        pass

    return None


def main():

    # ------------------------------------
    # 銘柄一覧読込
    # ------------------------------------
    codes = []

    with open(
        "stocks.csv",
        encoding="utf-8"
    ) as f:

        reader = csv.DictReader(f)

        for row in reader:

            codes.append(
                (
                    row["code"].strip(),
                    row["name"].strip()
                )
            )

    # ------------------------------------
    # RSI条件成立銘柄
    # ------------------------------------
    results = []

    print("\n処理開始\n")

    for code, name in codes:

        print(f"処理中: {name} ({code})")

        try:

            ticker = yf.Ticker(code)

            # --------------------------------
            # 月足
            # --------------------------------
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

            # --------------------------------
            # 前月終値
            # --------------------------------
            if len(monthly) >= 2:

                monthly_close = float(
                    monthly["Close"].iloc[-2]
                )

            else:

                monthly_close = float(
                    monthly["Close"].iloc[-1]
                )

            # --------------------------------
            # 日足
            # --------------------------------
            daily = ticker.history(
                period="10d",
                interval="1d"
            )

            if len(daily) > 0:

                current_price = float(
                    daily["Close"]
                    .dropna()
                    .iloc[-1]
                )

            else:

                current_price = monthly_close

            change_pct = (
                (current_price - monthly_close)
                / monthly_close
            ) * 100

            # --------------------------------
            # 財務情報
            # --------------------------------
            info = ticker.info

            per = info.get(
                "trailingPE"
            )

            pbr = info.get(
                "priceToBook"
            )

            dividend_yield = info.get(
                "dividendYield"
            )

            roe = info.get(
                "returnOnEquity"
            )

            market_cap = info.get(
                "marketCap"
            )

            current_ratio = info.get(
                "currentRatio"
            )

            debt_to_equity = info.get(
                "debtToEquity"
            )

            revenue_growth = info.get(
                "revenueGrowth"
            )

            earnings_growth = info.get(
                "earningsGrowth"
            )

            free_cashflow = info.get(
                "freeCashflow"
            )

            operating_cashflow = info.get(
                "operatingCashflow"
            )

            total_cash = info.get(
                "totalCash"
            )

            total_debt = info.get(
                "totalDebt"
            )

            profit_margins = info.get(
                "profitMargins"
            )

            operating_margins = info.get(
                "operatingMargins"
            )

            enterprise_value = info.get(
                "enterpriseValue"
            )

            beta = info.get(
                "beta"
            )

            shares_outstanding = info.get(
                "sharesOutstanding"
            )

            # --------------------------------
            # 自己資本比率計算
            # --------------------------------
            equity_ratio = None

            try:

                bs = ticker.balance_sheet

                total_assets = get_balance_sheet_value(
                    bs,
                    [
                        "Total Assets",
                        "TotalAssets"
                    ]
                )

                shareholders_equity = get_balance_sheet_value(
                    bs,
                    [
                        "Stockholders Equity",
                        "Total Equity Gross Minority Interest",
                        "Common Stock Equity"
                    ]
                )

                if (
                    total_assets is not None
                    and shareholders_equity is not None
                    and total_assets > 0
                ):

                    equity_ratio = (
                        shareholders_equity
                        / total_assets
                    ) * 100

            except:
                pass

            # --------------------------------
            # RSI条件判定
            # --------------------------------
            if rsi14 < rsi5:

                results.append({

                    "code": code,
                    "name": name,

                    "rsi14": safe_round(
                        rsi14
                    ),

                    "rsi5": safe_round(
                        rsi5
                    ),

                    "diff": safe_round(
                        diff
                    ),

                    "monthly_close": safe_round(
                        monthly_close
                    ),

                    "current_price": safe_round(
                        current_price
                    ),

                    "change_pct": safe_round(
                        change_pct
                    ),

                    "per": safe_round(
                        per
                    ),

                    "pbr": safe_round(
                        pbr
                    ),

                    "dividend_yield": safe_round(
                        dividend_yield
                    ),

                    "roe": safe_round(
                        roe
                    ),

                    "market_cap": market_cap,

                    "current_ratio": safe_round(
                        current_ratio
                    ),

                    "debt_to_equity": safe_round(
                        debt_to_equity
                    ),

                    "revenue_growth": safe_round(
                        revenue_growth
                    ),

                    "earnings_growth": safe_round(
                        earnings_growth
                    ),

                    "free_cashflow": free_cashflow,

                    "operating_cashflow": operating_cashflow,

                    "total_cash": total_cash,

                    "total_debt": total_debt,

                    "profit_margins": safe_round(
                        profit_margins
                    ),

                    "operating_margins": safe_round(
                        operating_margins
                    ),

                    "enterprise_value": enterprise_value,

                    "beta": safe_round(
                        beta
                    ),

                    "shares_outstanding": shares_outstanding,

                    "equity_ratio": safe_round(
                        equity_ratio
                    )
                })

                print("  → 条件成立\n")

            else:

                print("  → 条件不成立\n")

        except Exception as e:

            print(
                f"  → エラー: {e}\n"
            )

            continue

    # ------------------------------------
    # 差分順ソート
    # ------------------------------------
    results.sort(
        key=lambda x: x["diff"],
        reverse=True
    )

    # ------------------------------------
    # CSV出力
    # ------------------------------------
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
                "change_pct",

                "per",
                "pbr",
                "dividend_yield",
                "roe",

                "market_cap",

                "current_ratio",
                "debt_to_equity",

                "revenue_growth",
                "earnings_growth",

                "free_cashflow",
                "operating_cashflow",

                "total_cash",
                "total_debt",

                "profit_margins",
                "operating_margins",

                "enterprise_value",

                "beta",

                "shares_outstanding",

                "equity_ratio"
            ]
        )

        writer.writeheader()
        writer.writerows(results)

    # ------------------------------------
    # 結果表示
    # ------------------------------------
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
                f" RSI5={stock['rsi5']} "
                f" 差分={stock['diff']}"
            )

    print(f"\n合計 {len(results)} 件")
    print("result.csv 出力完了")


if __name__ == "__main__":
    main()