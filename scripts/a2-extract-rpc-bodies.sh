#!/usr/bin/env bash
# a2-extract-rpc-bodies.sh — 把五支出貨 RPC 的【現行定義原文】抽出來。
#
# 🔴 存在理由:A2 要 DROP 舊簽章再建新的(理由見 plan §10),
#    而新版的函式體 = 舊函式體 + 一段稽核 INSERT。
#    **舊函式體 485 行,手抄必錯**,而抄錯的地方會是 plpgsql 裡某一行 ——
#    它不會在 typecheck 紅、不會在靜態檢查紅,**只會在正式站某條分支上行為變了**。
#    ⇒ 一律用抽取,不用眼睛搬。
#
# 用法:bash scripts/a2-extract-rpc-bodies.sh <輸出目錄>
# 產出:<輸出目錄>/<函式名>.sql  五支各一
# 🔴 抽完會自我驗:抽出來的每一段必須能在來源檔裡【逐字】找回去(不是「看起來像」)。
set -euo pipefail
OUT="${1:?用法: bash scripts/a2-extract-rpc-bodies.sh <輸出目錄>}"
mkdir -p "$OUT"
FNS="admin_create_shipment admin_add_shipment_items admin_mark_shipment_shipped admin_void_shipment admin_unvoid_shipment"
RC=0
for f in $FNS; do
  SRC=$(grep -rlin "create or replace function public.$f(" supabase/migrations/ | sort | tail -1)
  if [ -z "${SRC:-}" ]; then echo "🔴 $f 找不到定義"; RC=1; continue; fi
  awk -v fn="$f" '
    $0 ~ ("CREATE OR REPLACE FUNCTION public\\." fn "\\(") { inb=1 }
    inb { print }
    inb && ($0 == "$fn$;" || $0 == "$$;") { exit }
  ' "$SRC" > "$OUT/$f.sql"
  N=$(wc -l < "$OUT/$f.sql" | tr -d ' ')
  # 🔴 自我驗:抽出來的內容必須逐字存在於來源檔。用 python 做字串包含,不用 grep（多行）。
  if python3 - "$SRC" "$OUT/$f.sql" <<'PY'
import io,sys
src=io.open(sys.argv[1],encoding='utf-8').read()
got=io.open(sys.argv[2],encoding='utf-8').read()
sys.exit(0 if got and got in src else 1)
PY
  then echo "✅ $f  $N 行  來源 $SRC"
  else echo "🔴 $f 抽出來的內容【不能】在來源檔逐字找回 ⇒ 抽取邏輯壞了,不要用這份產物"; RC=1
  fi
done
# 🔴 尾端斷言:五支都要有,少一支就是靜默漏抽
GOT=$(ls "$OUT" | wc -l | tr -d ' ')
if [ "$GOT" != "5" ]; then echo "🔴 只抽到 $GOT 支,期望 5"; RC=1; fi
exit $RC
