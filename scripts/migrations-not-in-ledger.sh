#!/bin/sh
# ============================================================
# migrations-not-in-ledger.sh — 「哪幾支【可能】沒貼」· 不連 DB, 不連網
# ============================================================
# 線 -db 2026-09-03 建。主視窗-87 派工。
#
# 🎯 **它答的問題**:`supabase/migrations/` 裡有, 而 `supabase/APPLIED.tsv` 沒記的, 是哪幾支?
#
# 🛑🛑 **它【不是】在答「哪幾支沒貼」** —— 那兩件事不一樣, 而今晚實測過:
#    2026-09-03 抽樣 10 支「帳本查無」的對正式庫實查 ⇒ **5 支其實已經貼了。**
#    ⇒ 📌 **帳本答的是「有沒有人【記】」, 不是「DB 裡有沒有」。**
#    ⇒ ⇒ 所以本支的輸出是【候選】不是【結論】。要判某一支, 用
#         `bash scripts/is-migration-applied.sh <檔名>` 產唯讀 SQL 給有存取權的人跑。
#
# 🔵 **而它為什麼還是有用**:
#    · 它**今天就跑得出數字**, 而不需要任何人有正式庫存取
#      (對照:`scripts/migration-ledger-divergence.sh` 比三本帳, 而第三本要 supabase CLI + link
#       ⇒ 2026-09-03 實測它在施工窗上 `exit 1`:找不到 `supabase/.temp/project-ref`
#       ⇒ 🎯 **那支在【沒有存取權的窗】手上是零判別力的, 而今晚每一個窗都沒有存取權。**)
#    · 它給的是一個**會縮小的分母**:記帳越勤, 這個數字越小。
#
# 🛑 **它答不出什麼**(與修法一樣顯眼):
#    · 帳本有記 ⇒ **不代表真的貼了**(沒有人回頭驗過那些記錄)
#    · 帳本沒記 ⇒ **不代表沒貼**(今晚 10 支裡 5 支反例)
#    · 它只比【版本號】。同一版本號底下檔案被改過, 它看不見。
#
# 用法  bash scripts/migrations-not-in-ledger.sh
#       bash scripts/migrations-not-in-ledger.sh --selftest
# ============================================================
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIG="$ROOT/supabase/migrations"
LEDGER="$ROOT/supabase/APPLIED.tsv"

[ -d "$MIG" ]    || { echo "🔴 找不到 $MIG ⇒ 這是報錯不是「零支」" >&2; exit 2; }
[ -f "$LEDGER" ] || { echo "🔴 找不到 $LEDGER ⇒ 這是報錯不是「全部沒貼」" >&2; exit 2; }

TMP="${TMPDIR:-/tmp}/mnil-$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP"' EXIT

# repo 側:每支 migration 的版本號
find "$MIG" -maxdepth 1 -name '*.sql' -print \
  | sed 's|.*/||; s|_.*||' | sort -u > "$TMP/repo.txt"
# 帳本側:每一行開頭的版本號(略過註解行)
grep -v '^#' "$LEDGER" 2>/dev/null | sed 's|[^0-9].*||' | grep -E '^[0-9]{8,}$' | sort -u > "$TMP/ledger.txt"

R=$(grep -c '' "$TMP/repo.txt")
H=$(grep -c '' "$TMP/ledger.txt")
comm -23 "$TMP/repo.txt" "$TMP/ledger.txt" > "$TMP/miss.txt"
M=$(grep -c '' "$TMP/miss.txt")

# ── 🔴 量具自檢:comm 真的照我以為的方式運作嗎 ──────────────────
#    (形狀抄 `migration-ledger-divergence.sh:139` 的同名段, 不自創)
printf 'a\nb\n' > "$TMP/t1"; printf 'b\n' > "$TMP/t2"
SELF=$(comm -23 "$TMP/t1" "$TMP/t2" | tr -d '\n')
[ "$SELF" = "a" ] || { echo "🔴 comm 自檢失敗(期望 a, 得到 [$SELF])⇒ 下面的數字不算數" >&2; exit 2; }

if [ "${1:-}" = "--selftest" ]; then
  # 🟢 正對照:塞一個 repo 有而帳本沒有的版本 ⇒ 必須出現在差集
  echo '29999999999999' >> "$TMP/repo.txt"; sort -u -o "$TMP/repo.txt" "$TMP/repo.txt"
  comm -23 "$TMP/repo.txt" "$TMP/ledger.txt" | grep -q '^29999999999999$' \
    && echo "🟢 正對照:現造版本號有出現在差集裡" \
    || { echo "🔴 正對照失敗:現造的版本號沒出現在差集 ⇒ 這支尺沒接上" >&2; exit 2; }
  # 🔵 負對照:帳本裡真的有的那一個, 不得出現在差集
  ANY=$(head -1 "$TMP/ledger.txt")
  if comm -23 "$TMP/repo.txt" "$TMP/ledger.txt" | grep -q "^$ANY$"; then
    echo "🔴 負對照失敗:帳本有記的 $ANY 竟出現在差集 ⇒ 比對寫反了" >&2; exit 2
  fi
  echo "🔵 負對照:帳本有記的 $ANY 沒有出現在差集"
  echo "✅ selftest 通過(而它證的是【這把尺會動】, 不證任何一支貼了沒)"
  exit 0
fi

echo "======== migrations 對帳本的差集 ========"
echo "repo 的 migration   $R 支"
echo "帳本有記的           $H 支"
echo "🔴 repo 有而帳本沒記  $M 支  ← 這是【候選】不是【沒貼】"
echo
[ "$M" -gt 0 ] && sed 's|^|  |' "$TMP/miss.txt"
echo
echo "🛑 判準:這 $M 支【不等於沒貼】—— 2026-09-03 抽樣 10 支實查, 其中 5 支已經貼了。"
echo "   要判某一支:bash scripts/is-migration-applied.sh <檔名>  ⇒ 產唯讀 SQL 交給有存取權的人跑"
echo "🔵 而這個數字會縮小 —— 每貼完一支就記一行, 見 supabase/APPLIED.tsv 檔頭。"
