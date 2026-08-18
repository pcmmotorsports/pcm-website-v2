#!/usr/bin/env bash
# scripts/verify-create-order-9param.sh
#
# 上線前置檢查:正式庫的 create_order 到底有沒有第 9 個參數 p_notification_email。
#
# 🔴 為什麼需要這支(不是多疑,是帳本說不出這件事):
#   supabase/APPLIED.tsv 的第 3 欄是「什麼時候 apply 的」,而整本帳 **89% 寫著 backfill**
#   = 事後補登、不是 apply 當下觀察到的。量法(可重跑,數字旁邊帶著命令走):
#       grep -vcE '^#|^$' supabase/APPLIED.tsv                                    ⇒ 分母 179
#       grep -vE '^#|^$' supabase/APPLIED.tsv | cut -f3 | sort | uniq -c | sort -rn  ⇒ backfill 159
#       159 / 179 = 89%
#   ⇒ 帳本有那一列 ≠ 那件事被觀察過。這支腳本就是那道缺掉的觀察。
#
# 🔴 為什麼不能用「結帳跑得動」代替:
#   CHECKOUT_NOTIFICATION_EMAIL_ENABLED 預設 off ⇒ 送出去的一直是 8 參呼叫
#   ⇒ 結帳正常【不代表】第 9 參可用。那個檢查在兩個世界印同一個東西。
#   照 M-4a B-4 送第 9 參之後才會爆,而爆點在部署之後、repo 內三綠與 vitest 全看不到。
#   📎 同形狀 2026-08-07 讓正式站壞了約 8 小時。
#
# 用法:  bash scripts/verify-create-order-9param.sh '<postgres 連線字串>'
#        連線字串由執行者當場提供。🔴 本腳本不讀 .env*、不寫檔、不改任何東西(只有 SELECT)。
#
# exit: 0=有第 9 參可以部署 / 3=沒有第 9 參不可部署 / 4=連 create_order 都找不到
#       2=用法錯 / 1=工具自己壞了(psql 沒裝或連不上)  —— 四種分得開,不要混成一個「失敗」
set -uo pipefail

CONN="${1:-${PGURL:-}}"
if [ -z "$CONN" ]; then
  echo "用法: bash scripts/verify-create-order-9param.sh '<postgres 連線字串>'" >&2
  exit 2
fi
command -v psql > /dev/null 2>&1 || { echo "🔴 工具問題:找不到 psql,這不是檢查結果" >&2; exit 1; }

SQL="SELECT p.pronargs || '|' || pg_get_function_arguments(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_order';"

OUT=$(psql "$CONN" -X -A -t -v ON_ERROR_STOP=1 -c "$SQL" 2>&1)
RC=$?
if [ $RC -ne 0 ]; then
  echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】檢查結果,不要當成「沒有第 9 參」" >&2
  echo "$OUT" >&2
  exit 1
fi

if [ -z "$OUT" ]; then
  echo "🔴 這個資料庫裡【找不到 public.create_order 這支函式】。"
  echo "   ⇒ 你可能連到了錯的資料庫。先確認連線字串,再談部署。"
  exit 4
fi

echo "查到 $(printf '%s\n' "$OUT" | grep -c .) 支 create_order:"
printf '%s\n' "$OUT" | while IFS='|' read -r n args; do
  echo "  · 參數 $n 個:$args"
done
echo

if printf '%s\n' "$OUT" | grep -q 'p_notification_email'; then
  echo "✅ create_order 已經含有 p_notification_email。"
  echo "   ⇒ M-4a B-4 可以部署。"
  exit 0
fi

echo "🔴 create_order 【沒有】p_notification_email 這個參數。"
echo "   ⇒ 現在部署 M-4a B-4 會讓【結帳整條斷掉】(PGRST202 / 42883),"
echo "     而且是上線之後才會發現 —— 我們這邊的測試一格都測不到。"
echo "   ⇒ 先 apply supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql"
exit 3
