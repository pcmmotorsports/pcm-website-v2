#!/bin/bash
# ci-self-contained: no — 同上, 需要正式庫唯讀連線 ⇒ CI 跑不了。
# ⟦b9-SRVMIN⟧ —— storefront 三道 service_role/raw-DB 持有,【實際用到的範圍】有多寬?
#
# 🟢 **唯讀、零寫入。** 而唯讀與 apply 是兩個授權,Sean 只給了前一個
#    ⇒ 🛑 本檔不得被改成會 apply 任何東西。
# 🛑 **連線字串絕不印進輸出。** 下面只用 $PCM_READONLY_DATABASE_URL 這個【名字】。
# 🔵 **跑不動是【對的】,不是壞掉** —— 它由你的 session 權限決定(2026-09-03 主視窗被擋,它沒有繞)。
#    ⇒ 跑不動時本檔印「沒有查」,而**那與「查無」是兩件事**。
#
# 用法:bash docs/probes/2026-09-05-service-role-min-scope.sh
#
# 🔴 **它答得出 / 答不出什麼(先讀這段,它決定下面的輸出能不能當結論)**
#   ✅ 答得出:那 35 支函式是不是 SECURITY DEFINER(`prosecdef`)
#             —— 而**那決定「只給 EXECUTE」夠不夠**。
#   ✅ 答得出:email 那 7 個物件上,`service_role` 實際被授了哪些動詞。
#   ⛔ 答不出:「這些權限【夠不夠】跑完一次真實流程」—— 那要實跑,不是查授權。
#   ⛔ 答不出:函式【內部】還碰了什麼表 —— DEFINER 之下那是 owner 的事,
#             而**收窄呼叫端不會改變它**。
set -u
OUTDIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$OUTDIR/結果-service-role-min-$(date '+%Y%m%d-%H%M').txt"
cd /Users/sean_1/pcm-website-v2 || exit 3
set -a ; . ./.env.local > /dev/null 2>&1 ; set +a
if [ -z "${PCM_READONLY_DATABASE_URL:-}" ]; then
  printf '%s\n' "🔴 沒載到 PCM_READONLY_DATABASE_URL —— 【沒有查】, 不是【查無】。" > "$OUT"
  printf '%s\n' "   成因多半是本 session 的權限或 .env.local 不在 /Users/sean_1/pcm-website-v2。" >> "$OUT"
  echo "沒有查 ⇒ $OUT"; exit 3
fi
/opt/homebrew/bin/psql "$PCM_READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f "$OUTDIR/2026-09-05-service-role-min-scope.sql" > "$OUT" 2>&1 ; RC=$?
printf '\nrc=%s  跑於 %s\n' "$RC" "$(date '+%Y-%m-%d %H:%M')" >> "$OUT"
# 🔴 零列要說得出是哪一種零 —— 「沒有這種函式」與「我沒查到」印同一個 0。
grep -qE '^\(0 rows\)' "$OUT" && \
  printf '%s\n' "🔴 有區段回 0 列 ⇒ 先確認【正對照那一格非 0】, 再讀那個 0。" >> "$OUT"
echo "rc=$RC ⇒ $OUT"; exit "$RC"
