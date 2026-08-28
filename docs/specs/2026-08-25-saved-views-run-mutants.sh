#!/bin/bash
# 片1:產生 24 發突變並逐發檢查【紅在哪一格】 🛑 拋棄式 PG, 不碰正式庫
# 🔴 這支存在的理由:上一版的跑法只活在 shell 歷史裡, 而產生器活在 /tmp ——
#    我收攤時把它 rm 掉了, 那一刻 repo 的狀態變成「34 格全綠, 而沒有東西證明它們紅得起來」。
#    📌 一組突變的價值不在它跑過, 在【下一個人跑得起來】。
# 🔴 而檢查的是「紅在哪一格」不是「有沒有紅」——
#    只記後者, 一發打錯支的突變與一發紅在語法錯的突變都會被算成通過。
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=${1:-/tmp}
# 🔴 SKIPGEN=1 ⇒ 不重新產生, 直接跑 $OUT 裡現有的那些
#    (少了這個開關, 沒辦法餵它一組【故意壞掉的】突變來驗它自己會不會紅)
if [ "${SKIPGEN:-0}" != "1" ]; then
  rm -f "$OUT"/mut-*.sql
  python3 docs/specs/2026-08-25-saved-views-mutants.py "$OUT" > /dev/null || exit 1
fi
# 🔴 不用 `declare -A` —— macOS 的 /bin/bash 是 **3.2**, 它沒有關聯陣列。
#    2026-08-28 我第一版用了它 ⇒ 腳本在第 13 行就死("m1: unbound variable")
#    ⇒ 🔴🔴 **而整支的離開碼是 0** —— 它完全沒跑, 而回報成功。
#    📌 一支「跑不起來而回報 rc=0」的驗收腳本, 比沒有那支更糟:
#       它會在每一次 CI / 每一次收工被當成一格綠。
#    ⇒ 改用 case(POSIX, 3.2 也吃)。
want_of() {
  case "$1" in
    m1) echo T2;;    m2) echo T14b;;  m13) echo T14;;   m14) echo T20;;
    m15) echo T21;;  mn) echo T7;;    m7) echo T6;;     m9) echo T17;;
    m8) echo T4;;    m10) echo T9;;   m10b) echo T9;;   m16) echo T10;;
    m17) echo T9;;   m18) echo T12b;; m11) echo T13b;;  m12) echo T13d;;
    m20) echo T4;;   m5) echo 順序;;  m21) echo 鎖列;;  ma1) echo 7c;;
    ma2) echo 7a;;   ma3) echo 唯一性;; ma4) echo 7b;;  m19) echo 7e-2;;
    *) echo "";;
  esac
}
OK=0; BAD=0
for f in "$OUT"/mut-*.sql; do
  n=$(basename "$f" .sql | sed 's/^mut-//')
  VADRAFT="$f" bash docs/specs/2026-08-25-saved-views-verify-all.sh > "$OUT/one.out" 2>&1; RC=$?
  if [ "$n" = "負對照" ]; then
    [ $RC -eq 0 ] && { echo "負對照 ✅ 全綠"; OK=$((OK+1)); } || { echo "負對照 🔴 竟然紅了 ⇒ 這一輪全部不算數"; BAD=$((BAD+1)); }
    continue
  fi
  # 🔴 比對用【完整那一行】, 只有顯示才截斷 ——
  #    截斷會砍在多位元組字元中間, 讓 grep 對整行失效(2026-08-28 實際踩到, 三發被誤判成 ⚠️)
  FULL=$(grep -m1 "ERROR:" "$OUT/one.out" | sed 's/^ *//; s#^psql:[^ ]*: *##')
  W=$(want_of "$n")
  if [ -z "$W" ]; then printf '%-6s ⚠️ 沒有登記期望值 ⇒ 這一發等於沒檢查\n' "$n"; BAD=$((BAD+1))
  elif [ $RC -eq 0 ]; then printf '%-6s 🔴🔴 恆綠, 零判別力\n' "$n"; BAD=$((BAD+1))
  elif printf '%s' "$FULL" | grep -q "syntax error"; then printf '%-6s 🔴 紅在語法錯 = 紅錯地方\n' "$n"; BAD=$((BAD+1))
  elif printf '%s' "$FULL" | grep -qF "$W"; then printf '%-6s ✅ %.64s\n' "$n" "$FULL"; OK=$((OK+1))
  else printf '%-6s ⚠️ 期望[%s] 而紅在別處 %.56s\n' "$n" "$W" "$FULL"; BAD=$((BAD+1))
  fi
done
echo "--- 紅在指定那一格 $OK · 有問題 $BAD ---"
exit $BAD
