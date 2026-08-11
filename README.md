# 月足RSI14・5か月MAクロス・スキャナー

日本株の**完成済み月足**からTradingView互換のWilder RSI14を計算し、**月足RSI14 > RSI14の5か月単純移動平均**を満たす銘柄を抽出するプロジェクトです。

現在対象、毎月のNEW / OUT、GC後の株価実績、財務情報、日足チャート、過去5年の分析・バックテスト、売買練習シミュレーターをGitHub Pagesで公開します。

## 正式なシグナル定義

計算バージョン：`tv_wilder_rsi14_sma5_v1`

1. 月末確定済み終値から、TradingViewの `ta.rsi(close, 14)` と同じWilder RMA方式で月足RSI14を計算
2. 月足RSI14の直近5か月単純移動平均を計算
3. `月足RSI14 > RSI14の5か月SMA` を対象状態とする
4. 前月まで対象外で当月に上抜けたものを `NEW`
5. 上回った状態を維持しているものを `CONTINUE`
6. 前月まで対象で当月に5か月SMA以下へ戻ったものを `OUT`

進行中の当月は使用しません。月末確定値は、個別画面の日足軸では翌月最初の取引日から表示します。

詳しい計算方法は `signal-method.html` にまとめています。

## 旧方式からの移行

旧版は、単純平均方式の期間5 RSIと期間14 RSIを別々に計算し、`RSI5 > RSI14` を判定していました。これは正式な投資KING／TradingView側の考え方とは異なっていたため廃止しました。

方式変更時には旧JSON・CSV・履歴を削除し、新方式で全期間を再生成します。公開JSONには必ず次を記録します。

```json
{
  "signal_version": "tv_wilder_rsi14_sma5_v1"
}
```

既存フロントエンドを安全に移行するため、当面は次の旧キーも互換エイリアスとして出力します。ただし意味は新方式へ固定されています。

| 互換キー | 正式な意味 |
|---|---|
| `rsi5` | `monthly_rsi14` |
| `rsi14` | `monthly_rsi_ma5` |
| `rsi5_up` | `monthly_rsi14_up` |
| `rsi14_up` | `monthly_rsi_ma5_up` |
| `diff` | `monthly_rsi_spread` |

新しい実装では、正式フィールドを優先してください。

## RSI計算

### Wilder RMA

最初の14期間は単純平均で初期化し、その後は次の再帰式で更新します。

```text
今月RMA ＝（前月RMA × 13 ＋ 今月の値）÷ 14
```

### RSI14

```text
変化額      ＝ 今月終値 − 前月終値
上昇幅      ＝ max(変化額, 0)
下落幅      ＝ max(−変化額, 0)
平均上昇幅  ＝ RMA(上昇幅, 14)
平均下落幅  ＝ RMA(下落幅, 14)
RS          ＝ 平均上昇幅 ÷ 平均下落幅
RSI14       ＝ 100 − 100 ÷ (1 ＋ RS)
```

### RSI14の5か月SMA

```text
RSI14・5か月MA
＝（今月 + 1か月前 + 2か月前 + 3か月前 + 4か月前のRSI14）÷ 5
```

Pine Scriptの考え方は次の形です。

```pine
rsi14 = ta.rsi(close, 14)
rsiMa5 = ta.sma(rsi14, 5)
active = rsi14 > rsiMa5
```

## データ生成

正式な生成エントリーポイントは `generate_tradingview.py` です。

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
python generate_tradingview.py
```

`generate_tradingview.py` は次の順番で処理します。

1. `test.py` の既存データ生成基盤へ正式シグナルを組み込む
2. 旧方式で生成された公開履歴を削除
3. 全銘柄・全履歴を新方式で再生成
4. JSON・CSVへ正式フィールドと `signal_version` を付与

RMAは過去値を引き継ぐため、GitHub Actionsでは月足を取得可能な最長期間から計算します。公開分析期間は直近60か月です。

財務取得を一時的に省略して価格・RSIだけ確認する場合：

```bash
SKIP_FUNDAMENTALS=1 python generate_tradingview.py
```

## 主な機能

- `stocks.csv` から日本株コードを読み込み、`.T` を自動付与
- TradingView互換の月足Wilder RSI14を計算
- RSI14の5か月SMA、NEW、CONTINUE、OUTを判定
- 直近60か月の月別履歴を生成
- GC月終値からの騰落実績を計算
- PER、PBR、配当利回り、ROE、自己資本比率、CFなどを取得
- 一覧で検索、ソート、月切替、NEW / OUT、🌸コスモス注目を表示
- 個別詳細でローソク足／平均足、出来高、SMA25・75・200、月足RSI14と5か月MAを表示
- NEW起点の過去実績を、OUT済み・継続中に分けて分析
- 52週高値、出来高、ATR、VCP、MVP、Supertrend、財務条件を追加検証
- TOPIX・日経平均との月次ポートフォリオ比較
- 入口プリセットと1・3・6か月／DC出口を組み合わせた5年バックテスト
- 個別銘柄の日足を未来非表示で進める売買練習
- 8分割エントリー、部分利確、資金管理、リスクリワード計算
- 日足RSI14、MACD、ストキャスティクス、ATR、ボリンジャーバンドを練習画面に表示
- GitHub Actionsで毎月自動更新
- GitHub Pagesへ自動デプロイ

## 🌸コスモス注目

🌸コスモス注目は、正式なNEWシグナル発生時点の追加テクニカル条件を満たした銘柄へ付けます。

基本条件は、互換フィールドではなく次の正式な意味で評価されます。

- 月足RSI14が60以上
- RSI14の5か月MAが上向き
- さらにMVP加速型または新高値型の条件を満たす

注目判定はNEW時点で固定し、OUTまで維持します。方式移行後の件数は、全データ再生成後に改めて確定します。旧方式の25銘柄と同数になる保証はありません。

## ファイル構成

```text
.
├── test.py                         # 既存データ生成基盤
├── tradingview_signal.py           # 正式なRSI・シグナル定義
├── generate_tradingview.py         # 本番用生成エントリーポイント
├── stocks.csv                      # 対象銘柄
├── requirements.txt
├── result.csv                      # 現在対象
├── out.csv                         # 最新OUT
├── index.html                      # 銘柄一覧
├── detail.html                     # 銘柄詳細
├── analysis.html                   # かんたん条件抽出
├── analysis-lab.html               # 詳細分析
├── backtest.html                   # 5年運用バックテスト
├── replay.html                     # 日足売買練習
├── signal-method.html              # 正式な計算方法
├── howto.html                      # 使い方
├── assets/
│   ├── app.js
│   ├── detail.js
│   ├── analysis.js
│   ├── backtest.js
│   ├── replay.js
│   ├── signal-v2.js               # 表示名・データ方式の統一
│   └── style.css
├── data/
│   ├── latest.json
│   ├── analysis.json
│   ├── charts/{code}.json
│   └── months/{YYYY-MM}.json
├── history/{YYYY-MM}.csv
├── tests/
│   ├── test_logic.py
│   ├── test_tradingview_signal.py
│   ├── test_backtest_engine.js
│   ├── test_replay_engine.js
│   └── test_signal_v2.js
└── .github/workflows/
    ├── update-data.yml
    ├── ui-checks.yml
    └── deploy-pages.yml
```

## stocks.csv

銘柄名は省略できます。次の形でコードだけ指定できます。

```csv
code
1301
1305
130A
7203
9984
```

`7203.T` のようなサフィックス付きコードにも対応します。重複コードは自動で除外します。

ETF・REIT・赤字企業・新規上場銘柄もRSI判定対象にできますが、財務項目は空欄になることがあります。

## GitHub Actions

### TermuxでEDINETだけ更新（GitHub Actions不使用）

AndroidではTermuxから大量保有報告書・変更報告書を手動更新できます。この処理は追加課金を前提にせず、GitHub Actions、`git pull`、commit、pushを自動実行しません。APIキーもファイルへ保存しません。

```bash
pkg update
pkg install git python
git clone https://github.com/cosmos-invest/kabutane.git
cd kabutane
bash termux-edinet.sh
```

通常は「直近10日」、初回は「直近90日」を選びます。入力したEDINET APIキーは画面に表示されず、その実行中の環境変数だけで使われます。GitHub Secretsへの登録は不要です。既に保存済みの書類IDはXBRLを再ダウンロードしません。

設定だけ確認する場合は、通信もAPIキー入力も行わないドライランを使えます。

```bash
bash termux-edinet.sh --dry-run
```

完了後は端末内のJSONが変わるだけで、サイトにはまだ公開されません。公開時は変更をまとめてGitHubへpushします。mainへのpushではPages公開や関連データの既存ワークフローが動く場合があるため、不要な実行を避けたい場合は小分けにpushせず、内容を確認してからまとめて反映してください。

### Update monthly RSI data

次のタイミングで動きます。

- Actions画面から手動実行
- 毎月2日 12:15 JST
- 正式シグナルのソースまたは生成ワークフローがmainへ変更されたとき

ワークフローは単体テスト後、`python generate_tradingview.py` で全データを生成し、`signal_version` を検証してからコミットします。

### Deploy GitHub Pages

データ更新ワークフローが成功するとPagesをデプロイします。公開画面は `data/latest.json` の `signal_version` を確認し、旧方式データが残っている間は数値画面を操作不可にして「更新待ち」と表示します。

## 参考資料

- 株おじさん「一生使えるテクニカル分析」  
  https://note.com/kabu_ojisan/n/n995f24384ab7
- TradingView公式 RSI  
  https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/

## 注意事項

- yfinanceは非公式データ取得ライブラリで、欠損、遅延、仕様変更、アクセス制限があり得ます。
- TradingViewとYahoo Financeで月足終値の調整方法・欠損・企業行動処理が異なると、わずかな数値差が出る可能性があります。
- 比較時は同じ銘柄、同じ取引所、月足、確定済み月、RSI期間14、SMA期間5で確認してください。
- 現在の `stocks.csv` を過去にも使うため、生存者バイアスがあります。
- 現在の財務値を過去時点のバックテスト条件には使用しません。
- 配当、税金、スリッページ、月中の約定差を完全には再現していません。
- シグナルは将来の値上がりを保証せず、本サイトは投資助言ではありません。
