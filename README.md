# 月足RSIクロス・スキャナー

日本株の **月足RSI5 > 月足RSI14** を満たす銘柄を抽出し、毎月の NEW / OUT、GC後の株価実績、財務情報、日足株価と階段状の月足RSIを無料のGitHub Pagesで公開するプロジェクトです。

## 実装済み

- `stocks.csv` から銘柄コードを読み込み
- 日本株コードへ `.T` を自動付与（英字コードにも対応）
- 月足RSI5 / RSI14を計算
- `RSI5 > RSI14` の現在対象、NEW、OUTを判定
- 直近36か月の月別履歴を生成
- GC月終値からの上昇・下落実績を計算
- 現在対象を「GC後上昇」「GC後下落」に分類
- PER、PBR、配当利回り、ROE、自己資本比率、CFなどを取得
- 欠損や取得エラーがあっても処理継続
- `result.csv`、`out.csv`、月別CSV、JSONを生成
- Webで検索、ソート、月切替、NEW/OUT、上昇/下落、RSI50以上/未満の絞り込み
- NEW起点の過去実績を、全体・OUT済み・継続中の3分類で分析
- NEW発生月、開始時RSI強度、騰落率を自由範囲で絞り込み
- 銘柄詳細で日足終値と階段状の月足RSIを表示
- 過去のGC実績を銘柄別に表示
- GitHub Actionsで毎月自動更新
- GitHub Pagesへ自動デプロイ

## ファイル構成

```text
.
├── test.py                         # データ生成本体
├── stocks.csv                      # 対象銘柄（既存ファイルをそのまま利用）
├── stocks.example.csv              # 入力例
├── requirements.txt
├── result.csv                      # 現在対象
├── out.csv                         # 最新OUT
├── index.html                      # 一覧サイト
├── detail.html                     # 銘柄詳細
├── analysis.html                   # NEW起点の過去実績分析
├── assets/
│   ├── app.js
│   ├── analysis.js
│   ├── detail.js
│   └── style.css
├── data/
│   ├── latest.json
│   ├── analysis.json
│   ├── errors.csv
│   ├── fundamentals_cache.json
│   ├── charts/{code}.json
│   └── months/{YYYY-MM}.json
├── history/{YYYY-MM}.csv
├── tests/test_logic.py
└── .github/workflows/
    ├── update-data.yml
    └── deploy-pages.yml
```

## stocks.csv

配布ZIPは既存の `stocks.csv` を上書きしません。リポジトリ内の現在のファイルをそのまま利用してください。

銘柄名は省略できます。大量のコードを使う場合は次の形で十分です。

```csv
code
1301
1305
130A
7203
9984
```

`7203.T` のようにサフィックス付きでも動きます。重複コードは自動で除外します。

ETF・REIT・赤字企業・新規上場銘柄もRSI判定対象にできますが、財務項目は空欄になることがあります。

## 手動実行

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
python test.py
```

大量銘柄では時間がかかります。途中の銘柄でエラーが出ても、エラーを記録して次へ進みます。

財務取得を一時的に省略して価格・RSIだけ確認する場合：

```bash
SKIP_FUNDAMENTALS=1 python test.py
```

## GitHub Actions

### データ更新

`.github/workflows/update-data.yml` は次のタイミングで動きます。

- Actions画面から手動実行
- 毎月2日 12:15 JST

生成された `result.csv`、`data/`、`history/` を自動コミットします。

### Pages公開

`.github/workflows/deploy-pages.yml` がWebファイルとデータをGitHub Pagesへ公開します。

初回のみ、GitHubのリポジトリで：

1. `Settings`
2. `Pages`
3. `Build and deployment`
4. `Source` を **GitHub Actions** に設定

その後、Actions画面から `Deploy GitHub Pages` を手動実行します。

## RSIの定義

このプロジェクトは、試作段階から使用している単純移動平均方式のRSIを継続使用しています。

- 月足RSI5
- 月足RSI14
- `RSI5 > RSI14` を対象状態
- 前月まで対象外で当月対象になったものを `NEW`
- 前月対象で当月対象外になったものを `OUT`

一般的なWilder方式のRSIとは数値が異なる場合があります。方式を変更すると過去判定も変わるため、運用開始後は定義を固定してください。

## 注意事項

- yfinanceは非公式データ取得ライブラリで、欠損、遅延、仕様変更、アクセス制限があり得ます。
- 全銘柄を一度に処理するとYahoo Finance側の制限を受ける可能性があります。
- 財務データは銘柄種別によって意味が異なり、ETF・REITでは空欄が正常です。
- 本サイトは投資助言ではありません。
