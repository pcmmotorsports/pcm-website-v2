#!/usr/bin/env bash
# two-controls.sh —— 量一個字面時,把【兩把對照】一起印出來。
#
# 🔴 為什麼有這支(2026-08-30 一晚踩八次之後做的):
#    那一晚每一次量錯,輸出看起來都完全正常 —— 而共通形狀是
#    **尺用了別的地方的字彙 / 掃了錯的檔** ⇒ 它印一個乾淨的 0。
#
# 🔴🔴 **而【負對照擋不到那一種】—— 這支檔存在的理由就是這一句:**
#    尺壞掉時,負對照【照樣印 0】,與「真的沒有」一模一樣。
#    當場實測(同一份資料):
#      尺對、目標在   ⇒ 命中 2 / 負對照 0    ← 分得開
#      尺錯(掃錯檔)  ⇒ 命中 0 / 負對照 0    ← **分不開**
#    ⇒ 📌 **抓得到「尺壞了」的是【正對照】,不是負對照。**
#    ⇒ 所以本支【強制】你給一個正對照,不給就不跑。
#
# 🔵 而負對照仍然要有,它擋的是另一件事(尺太寬 / 恆真)——
#    它是【現造的】:每次執行都不一樣,所以
#    **它從來沒有存在於任何檔案裡 ⇒ 沒有人寫得進去 ⇒ 不會自殺。**
#    (那一晚三個寫死的負對照字串全部因為被寫進板子而失效。)
#
# 用法:
#   bash scripts/two-controls.sh <要量的 pattern> <正對照 pattern> <檔或目錄...>
# 例:
#   bash scripts/two-controls.sh 'heartbeat' 'emailOverdue' packages/use-cases/src/check-anomaly-alerts.ts
#
# 🛑 射程:它只跑 `grep -r`。答不出「這個 pattern 是不是對的字彙」——
#    那正是正對照要你自己想的那一格。
set -u

if [ "${1:-}" = "--selftest" ]; then
  d=$(mktemp -d); printf 'alpha\nbravo\n' > "$d/f.txt"
  ok=1
  out=$(bash "$0" alpha bravo "$d/f.txt" 2>&1) || ok=0
  echo "$out" | grep -q '^命中 *= *1' || { echo "🔴 selftest: 命中應為 1"; ok=0; }
  echo "$out" | grep -q '^正對照 *= *1' || { echo "🔴 selftest: 正對照應為 1"; ok=0; }
  echo "$out" | grep -q '^負對照 *= *0' || { echo "🔴 selftest: 負對照應為 0"; ok=0; }
  # 世界二:正對照【撈不到】⇒ 必須 rc=2 並出聲
  bash "$0" alpha zzz-not-present "$d/f.txt" >/dev/null 2>&1; rc=$?
  [ "$rc" = "2" ] || { echo "🔴 selftest: 正對照 0 命中時應 rc=2, 實得 $rc"; ok=0; }
  # 世界三:缺參數 ⇒ rc=2
  bash "$0" alpha >/dev/null 2>&1; rc=$?
  [ "$rc" = "2" ] || { echo "🔴 selftest: 缺參數應 rc=2, 實得 $rc"; ok=0; }
  rm -rf "$d"
  [ "$ok" = "1" ] && { echo "✅ selftest PASS(三個世界印不同的東西)"; exit 0; }
  echo "🔴 selftest FAIL"; exit 1
fi

if [ "$#" -lt 3 ]; then
  echo "用法: bash scripts/two-controls.sh <要量的 pattern> <正對照 pattern> <檔或目錄...>" >&2
  echo "🔴 正對照【不是選配】—— 沒有它，一個壞掉的尺與『真的沒有』印同一個 0。" >&2
  exit 2
fi

TARGET="$1"; POS="$2"; shift 2

# 🔴 現造:每次執行都不一樣 ⇒ 它不可能已經在任何檔案裡
NEG="negctl-$(date +%s)-$$-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

c_target=$(grep -rc -- "$TARGET" "$@" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')
c_pos=$(grep -rc -- "$POS" "$@" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')
c_neg=$(grep -rc -- "$NEG" "$@" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')

printf '命中   = %s   (%s)\n' "$c_target" "$TARGET"
printf '正對照 = %s   (%s)\n' "$c_pos" "$POS"
printf '負對照 = %s   (現造 %s)\n' "$c_neg" "$NEG"

rc=0
if [ "$c_pos" -eq 0 ]; then
  echo "🔴 正對照 0 命中 ⇒ 這把尺【沒有接上】—— 本次的『命中 $c_target』不算數。" >&2
  rc=2
fi
if [ "$c_neg" -ne 0 ]; then
  echo "🔴 負對照非 0 ⇒ 這把尺太寬(或 grep 參數被吃掉) ⇒ 結果作廢。" >&2
  rc=2
fi
exit "$rc"
