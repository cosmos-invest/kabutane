# Full Regression acceptance checklist

PRごとに、以下の主要導線をPC幅とAndroid幅で自動確認する。

- トップ: 候補データが読み込まれる
- 銘柄詳細: 指定銘柄が読み込まれ、価格・RSIチャート領域が表示される
- 観察ランキング: ランキングデータが読み込まれる
- 月初作戦会議: 判定月と集計が読み込まれる
- 売買練習: 銘柄検索から対象銘柄を見つけられる
- 売買練習: 対象銘柄の練習開始画面が操作可能になる
- 補助ページ: backtest / howto / learn / signal-method / history / monthly-report が表示できる
- 全ページ: same-originの4xx/5xxがない
- 全ページ: uncaught JavaScript errorがない

main公開後は同じ重要導線をGitHub Pages本番URLへ再実行する。
