#!/bin/sh
# acl-drift-gate 自檢格數地板閘 —— 薄殼。數字住在 scripts/acl-drift-gate-selftest-baseline.txt
#
# 🔴 為什麼不把數字寫在這支裡:那樣它又跟比對的碼住同一支檔 ——
#    而「規則與測它的測試住同一支檔」正是板列 ⟦b9-GATESELFEDIT⟧ 要治的病。
# 🔴 離場碼:0 過 / 1 格數變少(擋下)/ 2 工具層壞了(讀不到基準或跑不動 ⇒ fail-closed)
set -u
BASE=scripts/acl-drift-gate-selftest-baseline.txt
if [ ! -f "$BASE" ]; then
  printf '%s\n' "🔴 讀不到 $BASE ⇒ 地板閘【沒有跑】⇒ 擋下(fail-closed)" >&2
  printf '%s\n' "   「沒跑」與「跑了而格數夠」不得印同一個結果。" >&2
  exit 2
fi
FLOOR=$(sed -n 's/^FLOOR=\([0-9][0-9]*\)$/\1/p' "$BASE" | head -1)
if [ -z "$FLOOR" ]; then
  printf '%s\n' "🔴 $BASE 裡找不到 FLOOR=<整數> ⇒ 擋下(fail-closed)" >&2
  exit 2
fi
OUT=$(python3 scripts/acl-drift-gate.py --selftest 2>&1) ; RC=$?
printf '%s\n' "$OUT"
if [ "$RC" -ne 0 ]; then
  printf '%s\n' "🔴 acl-drift-gate --selftest 自己就不是綠的(rc=$RC)⇒ 擋下" >&2
  exit "$RC"
fi
# 🔴 只認它最後那一行的形狀;抓不到 ⇒ fail-closed(不要把「讀不到」讀成「夠」)
N=$(printf '%s\n' "$OUT" | sed -n 's/^── selftest: \([0-9][0-9]*\) PASS.*/\1/p' | tail -1)
if [ -z "$N" ]; then
  printf '%s\n' "🔴 抓不到 selftest 的格數(它的輸出形狀變了?)⇒ 擋下(fail-closed)" >&2
  exit 2
fi
if [ "$N" -lt "$FLOOR" ]; then
  printf '%s\n' "🔴 acl-drift-gate 的自檢格數【變少了】:$N < 地板 $FLOOR" >&2
  printf '%s\n' "   ⇒ 這顆 commit 砍掉了守門格子。若那是刻意的:" >&2
  printf '%s\n' "     ① 把 $BASE 的 FLOOR 改成新的數" >&2
  printf '%s\n' "     ② 在 commit body 寫一句【為什麼】—— 那正是這道閘存在的理由" >&2
  exit 1
fi
printf '%s\n' "   ⚪ 自檢格數 $N ≥ 地板 $FLOOR(地板住在 $BASE)"
