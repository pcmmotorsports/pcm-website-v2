#!/usr/bin/env bash
# lesson-for.sh — 跨檔找「這件事我們是不是已經學過了」
#
# 🔴 存在理由(2026-08-19 實錘,而它跟你想的不一樣):
#   W4 花了一輪 codex + 一次自我推翻,才推導出「authenticator 沒有 USAGE 是正常的」。
#   而那句話四天前就寫在 repo 裡(docs/runbooks/2026-08-15-16-payment-total-apply-checks.md)。
#   ⚠️ 它不在 guard-and-instrument-traps.md 裡 —— 那支檔是 CLAUDE.md 指定「寫守門前要讀」的,
#     而那句話住在一份 runbook;那份 runbook 的讀者是「要跑 apply 檢查的人」,
#     W4 是「要寫斷言的人」⇒ 兩群人。
#   ⇒ 🔴 問題不是「那支檔太長讀不完」,是【知識住在另一群人的檔案裡】——
#     一個只搜 traps 的入口,會把人更快地帶到一個【沒有那句話】的檔案裡。
#
# 🔴 本工具故意【不做】主題分類:分類要一張關鍵字表,而那張表就是會過期的那個東西,
#   而且它過期時沒有訊號。⇒ 只做跨檔全文搜 + 自檢。
#
# 用法: bash scripts/lesson-for.sh 'authenticator'   /   bash scripts/lesson-for.sh --selftest
# 行號在【執行當下】才算 ⇒ 結構上不會過期。

set -uo pipefail
cd "$(dirname "$0")/.."

DIRS=(docs/patterns docs/runbooks docs/specs)
PER_FILE=${LESSON_FOR_PER_FILE:-4}
ANCHOR='authenticator'   # 已知一定命中的錨。它回 0 = 尺壞了，不是「沒有這個知識」。

die() { printf "%s\n" "$*" >&2; exit 1; }

# stdout 最後一行 = 命中總行數；其餘為明細
search() {
  local term="$1" total=0 d f n
  for d in "${DIRS[@]}"; do
    if [ ! -d "$d" ]; then die "🔴 目錄不在:$d ⇒ 這把尺沒掃到它宣稱要掃的地方,別信它的零"; fi
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      n=$(grep -c -- "$term" "$f" 2>/dev/null || true)
      if [ "${n:-0}" -gt 0 ]; then
        total=$((total + n))
        printf "── %s  (%s 行命中)\n" "$f" "$n"
        grep -n -- "$term" "$f" 2>/dev/null | head -"$PER_FILE" | sed 's/^/   /' | cut -c1-160
        if [ "$n" -gt "$PER_FILE" ]; then printf "   … 另有 %s 行未列(同檔)\n" "$((n - PER_FILE))"; fi
      fi
    done < <(grep -rl -- "$term" "$d" 2>/dev/null || true)
  done
  printf "%s\n" "$total"
}

if [ "${1:-}" = "--selftest" ]; then
  printf "═══ 自檢(兩個方向都要表演)═══\n"
  hits=$(search "$ANCHOR" | tail -1)
  if [ "${hits:-0}" -eq 0 ]; then die "🔴 ① 正向失敗:錨 '$ANCHOR' 命中 0 ⇒ 這把尺壞了,它的任何查無都不算數"; fi
  printf "① 正向 ✅ 錨 %s 命中 %s 行 ⇒ 這把尺會說話\n" "$ANCHOR" "$hits"
  if ( DIRS=(docs/no-such-dir-for-selftest); search "$ANCHOR" >/dev/null 2>&1 ); then die "🔴 ② 反向失敗:目錄不在時它沒死,而是安靜回了 0 ⇒ 那正是本工具要防的假零"; fi
  printf "② 反向 ✅ 目錄不在時它會死,不會回一個假的 0\n"
  printf "selfCheck.ok = true\n"
  exit 0
fi

[ $# -ge 1 ] || die "用法:bash scripts/lesson-for.sh '<你要找的詞>'   (或 --selftest)"
TERM_="$1"

anchor_hits=$(search "$ANCHOR" | tail -1)
if [ "${anchor_hits:-0}" -eq 0 ]; then die "🔴 這把尺壞了(錨命中 0)⇒ 本次結果一律作廢"; fi

printf "═══ %s ═══  (掃 %s;行號為執行當下)\n" "$TERM_" "${DIRS[*]}"
out=$(search "$TERM_")
total=$(printf "%s\n" "$out" | tail -1)
body=$(printf "%s\n" "$out" | sed '$d')

if [ "${total:-0}" -eq 0 ]; then
  printf "0 行命中 —— 而在下結論之前先讀這三句:\n"
  printf "  ① 這把尺是【單一字面、大小寫敏感】⇒ 換一個說法再跑一次(名字有變體,字面沒有)\n"
  printf "  ② 只掃了 %s ⇒ 它不掃 code、不掃 supabase/migrations、不掃信箱\n" "${DIRS[*]}"
  printf "  ③ 🔴 錨測過了(命中 %s 行)⇒ 這個零【不是尺壞掉】,是這三個目錄裡真的沒有\n" "$anchor_hits"
  exit 3
fi

printf "%s\n" "$body"
printf "共 %s 行命中。⚠️ 這是【某個時點、某三個目錄】的結果,引用請帶這兩個限定。\n" "$total"
