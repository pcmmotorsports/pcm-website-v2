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

# 分母:板上共幾列資料列。查無時要印它 —— 否則「尺沒接上」與「真的沒有」印同一個 0。
count_rows() {
  awk -F'|' 'NF > 4 { n++ } END { print n + 0 }' "$1"
}

# 🔴🔴 **退回檔:錨【不在錨欄】的那些列(2026-09-03 線 -auth 加)**
#
#   病灶:本工具原本錨欄查無就印「查無」收工。而板上**每 3 列就有 1 列**的錨
#   寫在【標題欄】不在錨欄(2026-09-03 實量:資料列 674 / 錨在錨欄 329 /
#   錨只在別欄 147 / 整列無錨 198;主視窗同日另量得 625/330/143/152 ——
#   🔵 **兩把尺的資料列定義不同, 兩個數都列著, 不挑一個看起來對的**;
#   而「每 3 列有 1 列」這個量級兩邊一致)。
#
#   🛑 **後果有名字**:一個窗拿錨來查 ⇒ 印「查無」⇒ 合理的讀法是「板上沒有這一列」
#     ⇒ 它去開一列新的, 做一件已經有人記過的事。
#     ⇒ 那正是 Sean 2026-09-02 親口點名的六個病之一:「做到一陣子才發現之前做過了」。
#   📌 **⇒ 失效時它印的是「查無」, 而那跟「這件事不存在」是同一個字。**
#
#   ✅ 修的是【工具】不是那 147 列:①動 147 列的爆炸半徑遠大於它解的問題
#     ②錨寫在標題裡往往是刻意的(標題本來就在講那個錨)③改列 = 改別人的內容。
#   🛑 **而退回來的結果【不等於】錨欄命中** —— 整行比對會撈到「只是引用那個錨」的列,
#     所以它一定要帶著那句警告一起印, 不可以靜靜地混進正常輸出。
lookup_fallback() {
  local anchor="$1" board="$2" mode="$3"
  awk -F'|' -v a="$anchor" -v m="$mode" '
    NF > 4 {
      inrow = (m == "regex") ? ($0 ~ a) : (index($0, a) > 0)
      incol = (m == "regex") ? ($3 ~ a) : (index($3, a) > 0)
      if (inrow && !incol) {
        state = $2; title = $4
        gsub(/^[ \t]+|[ \t]+$/, "", state)
        gsub(/^[ \t]+|[ \t]+$/, "", title)
        if (state != "open" && state != "done" && state != "doing" && state != "parked") {
          state = "\u2014(不在主表)"
        }
        if (length(title) > 90) { title = substr(title, 1, 90) "…" }
        printf "%s\t%s\t%s\n", NR, state, title
      }
    }
  ' "$board"
}

run_query() {
  local anchor="$1" board="$2" mode="$3"
  [ -r "$board" ] || { echo "🛑 讀不到板檔:$board" >&2; return 1; }

  local out n
  out="$(lookup "$anchor" "$board" "$mode")"
  n="$(printf '%s' "$out" | grep -c . || true)"

  if [ "$n" -eq 0 ]; then
    local fb fbn
    fb="$(lookup_fallback "$anchor" "$board" "$mode")"
    fbn="$(printf '%s' "$fb" | grep -c . || true)"

    if [ "$fbn" -eq 0 ]; then
      echo "⇒ 查無:$anchor(錨欄 0 列 · 整行比對 0 列)"
      echo "   🔵 分母:本板共 $(count_rows "$board") 列資料列 —— 印出來是為了讓你看見【尺有接上】。"
      echo "      (只印一個 0 的話, 「尺壞了」與「真的沒有」是同一個畫面。)"
      print_scope
      return 3
    fi

    echo "⚠️⚠️ 錨欄查無, 而【整行比對找得到 $fbn 列】—— 以下是退回整行比對的結果:"
    printf '行號\t態\t標題欄(截斷)\n'
    printf '%s\n' "$fb"
    cat <<'WARN'
🔴 **這一列的錨【不在錨欄】—— 我是用整行比對找到的。**
   整行比對會撈到【只是引用】那個錨的別列, 而「引用它的列」與「是它的列」
   在整行比對上完全一樣(實量:b4-SHIPGATE1 整行 10 列 / 錨欄 2 列 ⇒ 8 個假陽性)。
   ⇒ 🛑 **上面每一列都要開檔確認是不是它自己, 不要直接引用。**
   🔵 而板上每 3 列就有 1 列是這種(錨寫在標題欄)⇒ 這不是異常, 是常態。
WARN
    echo "🔵 對照:整行比對 $(count_wholeline "$anchor" "$board") 列 · 錨欄 0 列 · 本板共 $(count_rows "$board") 列"
    print_scope
    return 0
  fi

  printf '行號\t態\t錨欄\n'
  printf '%s\n' "$out"
  echo "🟢 錨欄命中 —— 這是本工具最強的那一種答案(不經整行比對)。"
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

  # ⑤ 退回檔正對照:一個錨【只在別欄】的 ⇒ 必須找得到, 且必須印那句警告。
  # 🔴 這一格是 2026-09-03 加退回檔的理由本身:在此之前它印「查無」,
  #    而「查無」與「板上沒有這一列」是同一個字 ⇒ 讀的人會去開一列新的。
  local fbn5 out5 rc5
  fbn5="$(lookup_fallback "b4-SQLCOMMENT1" "$board" str | grep -c . || true)"
  out5="$(run_query "b4-SQLCOMMENT1" "$board" str 2>&1)"; rc5=$?
  check "⑤退回 錨欄 0 列" "$(lookup "b4-SQLCOMMENT1" "$board" str | grep -c . || true)" "0"
  check "⑤退回 整行找得到" "$([ "$fbn5" -ge 1 ] && echo yes || echo no)" "yes"
  check "⑤退回 有印警告" \
    "$(printf '%s' "$out5" | grep -c '錨【不在錨欄】' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  check "⑤退回 rc" "$rc5" "0"
  # 🛑 而它【不得】冒充錨欄命中 —— 那句「🟢 錨欄命中」只能出現在真的錨欄命中時。
  check "⑤退回 不冒充錨欄命中" \
    "$(printf '%s' "$out5" | grep -c '🟢 錨欄命中' | awk '{print ($1>0)?"yes":"no"}')" "no"

  # ⑥ 錨欄命中那條路必須【標記自己】—— 否則兩種答案在畫面上長一樣。
  local out6
  out6="$(run_query "b4-CAPNULLDEAD" "$board" str 2>&1)"
  check "⑥錨欄命中 有標記" \
    "$(printf '%s' "$out6" | grep -c '🟢 錨欄命中' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  check "⑥錨欄命中 不印退回警告" \
    "$(printf '%s' "$out6" | grep -c '錨【不在錨欄】' | awk '{print ($1>0)?"yes":"no"}')" "no"

  # ⑦ 真查無:必須印【分母】。
  # 🔴 沒有分母的 0 = 「尺壞了」與「真的沒有」同一個畫面 —— 這支檔自己記過那個病。
  local fake7 out7 rc7
  fake7="zz-none-$(date +%s)-$$"
  out7="$(run_query "$fake7" "$board" str 2>&1)"; rc7=$?
  check "⑦查無 rc" "$rc7" "3"
  check "⑦查無 有印分母" \
    "$(printf '%s' "$out7" | grep -c '分母:本板共' | awk '{print ($1>0)?"yes":"no"}')" "yes"
  # 而那個分母必須是【真的數出來的】, 不是寫死的 —— 拿它跟現算的比。
  check "⑦查無 分母對得上" \
    "$(printf '%s' "$out7" | sed -n 's/.*分母:本板共 \([0-9]*\) 列.*/\1/p')" "$(count_rows "$board")"

  echo "── selftest 7 格 / 17 檢查:PASS=$pass FAIL=$fail ──"
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
