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
  rm -f "$OUT"/mut-*.sql "$OUT"/oth-*.sql "$OUT"/tgt-*.txt
  python3 docs/specs/2026-08-25-saved-views-mutants.py "$OUT" > "$OUT/gen.log" 2>&1
  GENRC=$?
  EXPECTED=$(grep -oE 'EXPECTED=[0-9]+' "$OUT/gen.log" | cut -d= -f2)
  ACTUAL=$(ls "$OUT"/mut-*.sql 2>/dev/null | wc -l | tr -d ' ')
  # 🔴 比【我餵幾條】與【它跑幾支】—— 兩個不同的數, 而只印後者的話少八發也看不出來
  if [ "$GENRC" -ne 0 ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "🔴 產生器說 $EXPECTED 發, 目錄裡只有 $ACTUAL 支 ⇒ 這一輪【不算數】"
    grep "⚠️" "$OUT/gen.log"
    exit 1
  fi
  echo "產生器 $EXPECTED 發 = 目錄 $ACTUAL 支 ✅"
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
    m8) echo T4;;    m10) echo T9-②;;   m10b) echo T9-②;;   m16) echo T10;;
    m17) echo T9-②;;   m18) echo T12b;; m11) echo T13b;;  m12) echo T13d;;
    m20) echo T4;;   m5) echo 順序;;  m21) echo 鎖列;;  ma1) echo 7c-1;;
    mf1) echo 7c-3;; mf4) echo 7c-3;;   # 🔴 它被【斷言】抓到, 比我原本預期的「撞名世界檢查」更前面
                       #    ⇒ 期望值要寫【真正抓到它的那一格】, 不是【我以為會抓到它的那一格】
     mf5) echo 孤兒;; mf2) echo T23b;; mf3) echo T22b;;
    ma2) echo B;;   ma3) echo 唯一性;; ma4) echo C-2;;  m19) echo 7e-2;;
    *) echo "";;
  esac
}
OK=0; BAD=0
for f in "$OUT"/mut-*.sql; do
  n=$(basename "$f" .sql | sed 's/^mut-//')
  # 🔴 突變可能打在片1 或片1a ⇒ 兩支都要餵, 而順序固定(片1 先)
  TGT=$(cat "$OUT/tgt-$n.txt" 2>/dev/null || echo base)
  if [ "$TGT" = "fix" ]; then
    VADRAFT="$OUT/oth-$n.sql" VAFIX="$f" bash docs/specs/2026-08-25-saved-views-verify-all.sh > "$OUT/one.out" 2>&1; RC=$?
  else
    VADRAFT="$f" VAFIX="$OUT/oth-$n.sql" bash docs/specs/2026-08-25-saved-views-verify-all.sh > "$OUT/one.out" 2>&1; RC=$?
  fi
  if [ "$n" = "負對照" ]; then
    [ $RC -eq 0 ] && { echo "負對照 ✅ 全綠"; OK=$((OK+1)); } || { echo "負對照 🔴 竟然紅了 ⇒ 這一輪全部不算數"; BAD=$((BAD+1)); }
    continue
  fi
  # 🔴 比對用【完整那一行】, 只有顯示才截斷 ——
  #    截斷會砍在多位元組字元中間, 讓 grep 對整行失效(2026-08-28 實際踩到, 三發被誤判成 ⚠️)
  # 🔴 不只抓 `ERROR:` —— 有些世界(撞名那一段)是用 say 印 🔴, 不是丟 SQL 例外。
  #    2026-08-28 實測:MF4 紅了而訊息是【空的】⇒ 判成「紅在別處」。
  #    📌 **一把只認得一種失敗長相的尺, 對另一種失敗的訊息是空白的 —— 而空白會被讀成「不對」。**
  # 🔴 抓「是哪一格紅」。而這一段我 2026-08-28 連改三次都錯, 三次的病都不同, 記下來:
  #    ① 只抓 `ERROR:` ⇒ 撞名那一段的失敗是用 say 印的 ⇒ 訊息【空白】⇒ 被判成「紅在別處」
  #    ② 改成也抓 🔴   ⇒ 含 🔴 的【標籤】(「🔴 負對照 …✅」)被當成失敗 ⇒ 20 發全部誤判
  #    ③ 加「結尾不是 ✅」⇒ 抓到【彙總行】(「行為測試 rc=3 · ok 32 🔴」)與【區塊標題】
  #    📌 **同一個字元同時當【嚴重性標記】與【結果】用, 那把尺就分不出它們。**
  #    ✅ 正解:先找 SQL 例外(那是最精確的);沒有才退而求其次找 🔴,
  #       而排除 區塊標題(`──` 開頭)· 彙總行(含 `rc=`)· 標籤(以 ✅ 結尾)。
  # 🔴 **先找有名字的那種失敗**(FAIL <格> / 斷言 <格> / 碼錨 <名>), 才退回一般 ERROR。
  #    2026-08-28 實測:MF4 其實紅在「斷言 7c-3」, 而它前面有一行 `relation … does not exist`
  #    的雜訊(交易回滾後的次生錯誤)⇒ 只抓第一個 ERROR 會挑到雜訊 ⇒ 判成「紅在別處」。
  #    📌 **一次失敗會產生一串錯誤, 而【最先印的那個】通常不是原因。**
  FULL=$(grep -m1 -E "ERROR:.*(FAIL |斷言 |碼錨 )" "$OUT/one.out" | sed 's/^ *//; s#^psql:[^ ]*: *##')
  if [ -z "$FULL" ]; then
    FULL=$(grep -m1 "ERROR:" "$OUT/one.out" | sed 's/^ *//; s#^psql:[^ ]*: *##')
  fi
  if [ -z "$FULL" ]; then
    FULL=$(grep "🔴" "$OUT/one.out" | grep -v "✅$" | grep -v "^──" | grep -v "rc=" | head -1 | sed 's/^ *//')
  fi
  W=$(want_of "$n")
  if [ -z "$W" ]; then printf '%-6s ⚠️ 沒有登記期望值 ⇒ 這一發等於沒檢查\n' "$n"; BAD=$((BAD+1))
  elif [ $RC -eq 0 ]; then printf '%-6s 🔴🔴 恆綠, 零判別力\n' "$n"; BAD=$((BAD+1))
  elif printf '%s' "$FULL" | grep -q "syntax error"; then printf '%-6s 🔴 紅在語法錯 = 紅錯地方\n' "$n"; BAD=$((BAD+1))
  # 🔴 `grep -qF "T2"` 會被 `T20 / T21 / T22b / T23b` 命中;`7c` 會被 `7c-3` 命中
  #    ⇒ 一發打歪、紅在【鄰格】的突變會印 ✅(code-reviewer 2026-08-28)
  #    📌 **尺撈到的是別人。** ⇒ 錨成完整前綴:`FAIL <格>:` 或 `斷言 <格>:` 或 `碼錨 <名>:`
  # 🔴 `grep -qF "T2"` 會被 `T20/T22b` 命中(前綴相容)⇒ 打歪的突變會印 ✅。
  #    而我第一版的修法【收太緊】:錨成 `FAIL T2:` —— 而真實文字是 `FAIL T2 clerk 建共用:`
  #    ⇒ 27 發全部被判成「紅在別處」, 而它們其實都紅對了。
  #    📌 **一把收緊的尺與一把太鬆的尺, 都會給出錯的名單 —— 而收緊那把看起來比較嚴謹。**
  #    ✅ 正解:錨成「格名之後接【空白或冒號】」⇒ `T2 ` 命中而 `T20 ` 不命中。
  elif printf '%s' "$FULL" | grep -qE "FAIL $W[ ::]|斷言 $W[ ::]|碼錨 $W[ ::]|$W的 anon"; then printf '%-6s ✅ %.64s\n' "$n" "$FULL"; OK=$((OK+1))
  else printf '%-6s ⚠️ 期望[%s] 而紅在別處 %.56s\n' "$n" "$W" "$FULL"; BAD=$((BAD+1))
  fi
done
echo "--- 紅在指定那一格 $OK · 有問題 $BAD ---"
exit $BAD
