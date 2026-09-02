#!/usr/bin/env bash
# board-row-by-anchor.sh —— 用【錨欄】定位板上那一列, 不用行號、不用整行 grep。
#
# 它解的兩個病(規格 ~/pcm-mailbox/規格-board-row-by-anchor-20260902.md, 線 -7d 2026-09-02):
#   ① 行號會漂, 而漂移量【不固定】(實量 0/+1/+2/+3/+4/+5, 六列六個值)
#      ⇒ 每一列各漂各的, 而每一列看起來都正常 ⇒ 不能用「加 N」回推。
#   ② 用【整行】grep 一個錨 ⇒ 會撈到【只是引用那個錨】的列。
#      而「引用它的列」與「是它的列」在整行 grep 上完全一樣。
#      實量:b4-SHIPGATE1 整行 grep 10 列 / 錨欄 2 列 ⇒ 8 個假陽性, 而第一個讀起來完全正常。
#
# rc:  0 = 命中 1 列或多列 · 3 = 查無 · 2 = 用法錯 · 1 = 工具自壞
set -uo pipefail

BOARD_DEFAULT="docs/launch-todo.md"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat >&2 <<'USAGE'
用法:
  bash scripts/board-row-by-anchor.sh <錨> [板檔]     # 例:b4-CAPNULLDEAD(不必帶 ⟦⟧)
  bash scripts/board-row-by-anchor.sh --regex <樣式> [板檔]
  bash scripts/board-row-by-anchor.sh --selftest
預設【純字串】比對;要正規式才加 --regex。
USAGE
}

# 只比對錨欄($3), 印「行號 · 態 · 錨欄原文」。
lookup() {
  local anchor="$1" board="$2" mode="$3"
  awk -F'|' -v a="$anchor" -v m="$mode" '
    NF > 4 {
      hit = (m == "regex") ? ($3 ~ a) : (index($3, a) > 0)
      if (hit) {
        state = $2; col = $3
        gsub(/^[ \t]+|[ \t]+$/, "", state)
        gsub(/^[ \t]+|[ \t]+$/, "", col)
        # 🔴 態是【封閉集】。分隔線【下面】那張表的第 2 欄不是態(實測印出 `731`)
        #    ⇒ 而一個看起來像狀態碼的數字, 讀的人會當成某種態。
        #    ⇒ 不在封閉集 ⇒ 印 `—` 並標「不在主表」, 而不是把原值端出去。
        if (state != "open" && state != "done" && state != "doing" && state != "parked") {
          state = "—(不在主表)"
        }
        printf "%s\t%s\t%s\n", NR, state, col
      }
    }
  ' "$board"
}

# 對照用:整行比對, 只回列數 —— 它就是本工具要廢掉的那把尺。
count_wholeline() {
  local anchor="$1" board="$2"
  awk -v a="$anchor" 'index($0, a) > 0 { n++ } END { print n + 0 }' "$board"
}

run_query() {
  local anchor="$1" board="$2" mode="$3"
  [ -r "$board" ] || { echo "🛑 讀不到板檔:$board" >&2; return 1; }

  local out n
  out="$(lookup "$anchor" "$board" "$mode")"
  n="$(printf '%s' "$out" | grep -c . || true)"

  if [ "$n" -eq 0 ]; then
    echo "⇒ 錨欄查無:$anchor"
    echo "   🔵 而整行比對會撈到 $(count_wholeline "$anchor" "$board") 列 —— 那些是【引用它的列】, 不是它。"
    print_scope
    return 3
  fi

  printf '行號\t態\t錨欄\n'
  printf '%s\n' "$out"
  if [ "$n" -ge 2 ]; then
    echo "🔴 多列($n)—— 你要自己看是哪一列。本工具不替你挑第一列。"
  fi
  echo "🔵 對照:整行比對 $(count_wholeline "$anchor" "$board") 列 · 錨欄 $n 列"
  print_scope
  return 0
}

print_scope() {
  cat <<'SCOPE'
── 它答不出什麼 ──
· 它答「板上哪一列是它」, 答不出「那件事做完了沒」—— 那要開檔。
· 它讀的是【工作樹】那一版板檔;有未 commit 的改動時, 讀到的就是那一版。
· 無錨的列它定位不到 —— 那些只能靠內文特徵字面, 而那把尺較弱。
SCOPE
}

# ── selftest:釘【關係】不釘【座標】 ─────────────────────────────
# 理由:座標正是這支工具要廢掉的東西。一支 selftest 若釘了行號,
#       下一次板子被改它就假紅。實量:b4-SHIPGATE1 五分鐘漂 1 行。
selftest() {
  local board="$REPO/$BOARD_DEFAULT" pass=0 fail=0
  check() { # <名稱> <實際> <期待>
    if [ "$2" = "$3" ]; then echo "🟢 PASS $1 ($2)"; pass=$((pass + 1))
    else echo "🔴 FAIL $1:得到 $2, 期待 $3"; fail=$((fail + 1)); fi
  }
  [ -r "$board" ] || { echo "🛑 ENV-FAIL 讀不到 $board" >&2; return 1; }

  # ① 正對照:一個真的存在的錨 ⇒ 恰好 1 列, rc=0
  local n1 rc1
  n1="$(lookup "b4-CAPNULLDEAD" "$board" str | grep -c . || true)"
  run_query "b4-CAPNULLDEAD" "$board" str >/dev/null; rc1=$?
  check "①正對照 命中列數" "$n1" "1"
  check "①正對照 rc" "$rc1" "0"

  # ② 負對照:現造帶時間戳的錨 ⇒ 0 列, rc=3
  # 🛑 一定要現造 —— 寫死的假錨有一天會變成真的。
  local fake n2 rc2
  fake="zz-not-real-$(date +%s)-$$"
  n2="$(lookup "$fake" "$board" str | grep -c . || true)"
  run_query "$fake" "$board" str >/dev/null; rc2=$?
  check "②負對照 命中列數" "$n2" "0"
  check "②負對照 rc" "$rc2" "3"

  # ③ 突變格:本工具存在的理由。
  #
  # 🔴 而這一格【第一版是壞的】, 記在這裡免得有人改回去:
  #    原本寫「錨欄命中數 嚴格小於 整行命中數」⇒ 而我把核心 index($3,a) 突變成 index($0,a)
  #    ⇒ 實量 錨欄 2 / 突變 8 / 整行 10 ⇒ **8 < 10 ⇒ 那一格照樣 PASS。**
  #    📌 一個「比數量」的判準, 對「多抓了一些但還沒抓滿」的突變是瞎的。
  #
  # ✅ 改成比【集合】不比【數量】:先算出「整行撈得到而錨欄不該撈」的那些列(真假陽性),
  #    再斷言本工具的輸出與它們【零交集】。突變成整行比對 ⇒ 交集非空 ⇒ 紅。
  local anchor3 bad_rows out3 overlap
  anchor3="b4-SHIPGATE1"
  bad_rows="$(awk -F'|' -v a="$anchor3" 'index($0,a)>0 && index($3,a)==0 {print NR}' "$board" | sort)"
  out3="$(lookup "$anchor3" "$board" str | cut -f1 | sort)"
  overlap="$(comm -12 <(printf '%s\n' "$bad_rows") <(printf '%s\n' "$out3") | grep -c . || true)"
  check "③突變 與假陽性零交集" "$overlap" "0"
  # 而那組假陽性必須非空 —— 不然這一格恆綠(沒有東西可以被錯抓)。
  check "③突變 假陽性組非空" \
    "$([ "$(printf '%s\n' "$bad_rows" | grep -c . || true)" -gt 0 ] && echo yes || echo no)" "yes"

  # ④ 多列格:一個錨真的命中多列 ⇒ 必須印出全部, 不得只回第一列。
  local na4
  na4="$(lookup "b4-MAILHTML1" "$board" str | grep -c . || true)"
  check "④多列 命中 ≥2" "$([ "$na4" -ge 2 ] && echo yes || echo "no($na4)")" "yes"

  echo "── selftest 4 格 / 7 檢查:PASS=$pass FAIL=$fail ──"
  [ "$fail" -eq 0 ]
}

# ── 進入點 ────────────────────────────────────────────────────
case "${1:-}" in
  --selftest) selftest; exit $? ;;
  --regex)    [ $# -ge 2 ] || { usage; exit 2; }
              run_query "$2" "${3:-$REPO/$BOARD_DEFAULT}" regex; exit $? ;;
  ""|-h|--help) usage; exit 2 ;;
  -*)         usage; exit 2 ;;
  *)          run_query "$1" "${2:-$REPO/$BOARD_DEFAULT}" str; exit $? ;;
esac
