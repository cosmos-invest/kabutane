# 遠藤さん向け導入手順（スマホ＋Codespaces）

## 1. ZIPをCodespacesへ入れる

1. このチャットから `kabutane-site.zip` をスマホへ保存
2. GitHubで `cosmos-invest/kabutane` を開く
3. `Code` → `Codespaces` → 現在のCodespaceを開く
4. 左のファイル一覧へZIPをアップロード
5. ターミナルで以下を実行

```bash
unzip -o kabutane-site.zip
rm kabutane-site.zip
```

ZIPには `stocks.csv` を含めていないため、現在の対象銘柄ファイルは上書きされません。

## 2. 動作確認

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

`OK` と出ればコードの基本テストは成功です。

最初は現在の少数銘柄で実行します。

```bash
python test.py
```

完了後に次が更新されます。

- `result.csv`
- `out.csv`
- `data/latest.json`
- `data/charts/`
- `data/months/`
- `history/`

## 3. GitHubへ保存

```bash
git add .
git commit -m "かぶたねサイトを更新"
git push
```

## 4. Actionsの書き込み権限

GitHubリポジトリの次の場所を開きます。

1. `Settings`
2. `Actions`
3. `General`
4. 下部の `Workflow permissions`
5. `Read and write permissions` を選ぶ
6. `Save`

`update-data.yml` 自体にも `contents: write` を設定済みです。

## 5. GitHub Pagesを有効化

1. `Settings`
2. `Pages`
3. `Build and deployment`
4. `Source` を `GitHub Actions` にする

## 6. 初回の自動更新

1. リポジトリ上部の `Actions`
2. `Update monthly RSI data`
3. `Run workflow`
4. 緑のチェックになるまで待つ

データ更新のコミット後、`Deploy GitHub Pages` が動きます。動かなければ同じく手動で `Run workflow` を押します。

公開URL：

```text
https://cosmos-invest.github.io/kabutane/
```

## 7. 全銘柄リストへ変更

現在の `stocks.csv` を次の形式にします。銘柄名は不要です。

```csv
code
1301
1305
1306
130A
7203
9984
```

保存してコミット後、`Update monthly RSI data` を手動実行します。

全銘柄の初回処理は時間がかかり、Yahoo Financeの一時的な取得制限が発生する可能性があります。途中エラーは `data/errors.csv` に残し、他銘柄の処理は継続します。

財務情報を省略してRSIと価格だけ先に確認する場合：

```bash
SKIP_FUNDAMENTALS=1 python test.py
```

## 8. 毎月の運用

自動実行は毎月2日 12:15（日本時間）です。

毎月見る場所：

- `現在対象`
- `NEW`
- `OUT`
- `GC後上昇`
- `GC後下落`
- 銘柄クリック → 日足終値＋階段状の月足RSI＋過去GC実績
