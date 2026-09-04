#!/bin/bash
# ci-self-contained: no — 走 PCM_READONLY_DATABASE_URL 連【正式庫唯讀】(CI 沒有那把憑證, 也不該有)。
# ⟦b9-RLSHARDEN⟧ 前置盤點 —— **哪些碼路徑今天【真的依賴】service_role 的 BYPASSRLS?**
#
# 🔴 **「用了 service_role」與「用了而且 RLS 會擋它」是兩個宣稱** —— 本檔只答後者。
# 🟢 **唯讀、零寫入。** 唯讀與 apply 是兩個授權, Sean 只給了前一個 ⇒ 本檔不得改成會 apply。
# 🛑 **連線字串絕不印進輸出。**
# 🔵 **跑不動是【對的】, 不是壞掉** —— 它由你的 session 權限決定;
#    跑不動時本檔印「沒有查」, 而**那與「查無」是兩件事**。
#
# 用法:bash docs/probes/2026-09-05-rlsharden-prereq.sh
#
# 🔴 **它答得出 / 答不出什麼(先讀這段)**
#   ✅ 答得出:那 7 個物件 RLS 開了沒、每條 policy 給誰、管哪個動作、permissive 還是 restrictive。
#   ✅ 答得出:分母對帳(public 底下總共幾條 policy / 幾條點名 service_role)。
#   ⛔ **答不出:service_role 的【其他】消費者** —— 本檔的分母是
#      `⟦b9-SRVMIN⟧` 量到的 email/cron 那 7 個物件, **不是全站**。
#   ⛔ 答不出:GRANT 那一層。**RLS 與 GRANT 是兩道各自獨立的閘, 兩道都要過**
#      ⇒ GRANT 那半在 `2026-09-05-service-role-min-scope.sh`。
set -u
OUTDIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$OUTDIR/結果-rlsharden-prereq-$(date '+%Y%m%d-%H%M').txt"
cd /Users/sean_1/pcm-website-v2 || exit 3
set -a ; . ./.env.local > /dev/null 2>&1 ; set +a
if [ -z "${PCM_READONLY_DATABASE_URL:-}" ]; then
  printf '%s\n' "🔴 沒載到 PCM_READONLY_DATABASE_URL —— 【沒有查】, 不是【查無】。" > "$OUT"
  printf '%s\n' "   成因多半是本 session 的權限或 .env.local 不在 /Users/sean_1/pcm-website-v2。" >> "$OUT"
  echo "沒有查 ⇒ $OUT"; exit 3
fi
/opt/homebrew/bin/psql "$PCM_READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f "$OUTDIR/2026-09-05-rlsharden-prereq.sql" > "$OUT" 2>&1 ; RC=$?
printf '\nrc=%s  跑於 %s\n' "$RC" "$(date '+%Y-%m-%d %H:%M')" >> "$OUT"
# 🔴 零列要說得出是哪一種零 —— 「沒有這種函式」與「我沒查到」印同一個 0。
grep -qE '^\(0 rows\)' "$OUT" && \
  printf '%s\n' "🔴 有區段回 0 列 ⇒ 先確認【正對照那一格非 0】, 再讀那個 0。" >> "$OUT"
echo "rc=$RC ⇒ $OUT"; exit "$RC"
