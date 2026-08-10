#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

usage() {
  cat <<'EOF'
使い方:
  bash termux-edinet.sh              # スマホ向けメニューを表示
  bash termux-edinet.sh --days 10    # 直近10日を更新
  bash termux-edinet.sh --dry-run    # 通信せず設定だけ確認

このスクリプトはGitHub Actions、git pull、commit、pushを実行しません。
EDINET APIキーは非表示で受け取り、ファイルへ保存しません。
EOF
}

die() {
  printf 'エラー: %s\n' "$1" >&2
  exit 1
}

validate_days() {
  case "$1" in
    ''|*[!0-9]*) die "日数は1〜367の整数で指定してください。" ;;
  esac
  ((1 <= 10#$1 && 10#$1 <= 367)) || die "日数は1〜367の範囲で指定してください。"
}

choose_days() {
  printf '%s\n' 'EDINET 大量保有データ更新'
  printf '%s\n' '  1) 通常更新（直近10日・おすすめ）'
  printf '%s\n' '  2) 初回更新（直近90日）'
  printf '%s\n' '  3) 日数を指定（1〜367日）'
  printf '%s\n' '  4) 終了'
  printf '番号を選択: '
  IFS= read -r choice
  case "$choice" in
    1|'') DAYS=10 ;;
    2) DAYS=90 ;;
    3)
      printf '取得日数: '
      IFS= read -r DAYS
      validate_days "$DAYS"
      ;;
    4) exit 0 ;;
    *) die "1〜4から選んでください。" ;;
  esac
}

DAYS=""
DRY_RUN=0
while (($#)); do
  case "$1" in
    --days)
      (($# >= 2)) || die "--days の後に日数が必要です。"
      DAYS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "不明な引数です: $1" ;;
  esac
done

if [[ -z "$DAYS" ]]; then
  if ((DRY_RUN)); then
    DAYS=10
  else
    choose_days
  fi
fi
validate_days "$DAYS"

command -v python >/dev/null 2>&1 || die "Pythonがありません。Termuxで pkg install python を実行してください。"
command -v git >/dev/null 2>&1 || die "Gitがありません。Termuxで pkg install git を実行してください。"
[[ -f scripts/update_edinet_large_holdings.py ]] || die "かぶたねのリポジトリ直下で実行してください。"

printf '対象: 直近%s日\n' "$DAYS"
printf '%s\n' 'GitHub Actions: 使用しません'
printf '%s\n' 'Git操作: pull / commit / push は行いません'

if ((DRY_RUN)); then
  printf '%s\n' '確認完了: 通信・データ変更・APIキー入力は行っていません。'
  exit 0
fi

KEY_WAS_PRESENT=0
if [[ -n "${EDINET_API_KEY:-}" ]]; then
  KEY_WAS_PRESENT=1
else
  printf 'EDINET APIキー（入力内容は表示されません）: '
  IFS= read -r -s EDINET_API_KEY
  printf '\n'
  [[ -n "$EDINET_API_KEY" ]] || die "APIキーが入力されていません。"
  export EDINET_API_KEY
fi

cleanup_key() {
  if ((KEY_WAS_PRESENT == 0)); then
    unset EDINET_API_KEY
  fi
}
trap cleanup_key EXIT

python -m scripts.update_edinet_large_holdings --days "$DAYS"

if [[ -f data/core/radar.json && -f data/premium/supply-demand-screen.json ]]; then
  python -m scripts.build_premium_lab
else
  printf '%s\n' '補足: プレミアム統合元データがないため、統合JSONの再生成は省略しました。'
fi

python - <<'PY'
import json
from pathlib import Path

path = Path("data/large-holdings/latest.json")
payload = json.loads(path.read_text(encoding="utf-8"))
print(f"完了: 大量保有データ {len(payload.get('records') or [])}件")
print(f"生成日時: {payload.get('generated_at') or '-'}")
PY

printf '%s\n' '端末内の更新だけ完了しました。公開はまだされていません。'
printf '%s\n' '変更ファイル:'
git status --short -- data/large-holdings data/premium/opportunity-radar.json || true
