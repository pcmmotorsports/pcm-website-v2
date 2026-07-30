#!/usr/bin/env bash
# ============================================================
# A1 併發鎖量測 — 「套用這支 migration 時,正在結帳的人會被卡多久?」
# ============================================================
# 對應 = docs/specs/2026-07-30-e10-a1-order-item-summary-columns-plan.md §3.3
# 用法:scripts/a1-lock-probe.sh /tmp/a1v   (需先由 a1-verify.sh all 建好拋棄式 cluster)
#
# ── 為什麼需要這支 ──────────────────────────────────────────
# A1 對 live 的 order_items 加唯一約束,會取得 ACCESS EXCLUSIVE 並**持有到 COMMIT**。
# migration 檔裡的 `SET LOCAL lock_timeout = '5s'` 限制的是**本 migration 等鎖多久**,
# 它**完全不限制**「結帳交易等待本 migration」——這兩件事常被混為一談。
#
# ── 🔴 第一版是假證明(codex 關卡2 R2 抓,逐字記下)──────────
# 原版:背景啟動 migration → **立刻**量一次 INSERT → 得到 18ms → 宣稱「幾乎不阻塞」。
# 錯在哪:**沒有任何機制保證量測時鎖已經被 migration 取得**。INSERT 完全可能搶在
# ALTER TABLE 之前拿到鎖、順利跑完 ⇒ 那個 18ms 量的是「沒有競爭時的 INSERT」,
# 與 migration 持鎖多久毫無關係。**一個沒有 barrier 的競賽測試,綠了也不代表任何事。**
# 該數字一度被寫進 STATUS,已撤回。
#
# ── 改成三段,每段各自說清楚它能證明什麼 ────────────────────
# ① **持鎖上限**(確定性):量 migration 整個交易的牆鐘時間。
#    鎖在第一句 ALTER TABLE 就取得、持有到 COMMIT ⇒ **交易總時長就是持鎖窗的上限**,
#    這個量測不需要 barrier,因為它量的不是競爭、是時長。
# ② **消融**(證明量得到):故意持鎖 2 秒,INSERT 量測必須跟著跳到接近 2 秒。
#    ②不成立就整支中止 —— 一個抓不到阻塞的量測,報什麼數字都沒意義。
# ③ **barrier 版競爭測試**:輪詢 pg_locks,**確認 migration 的 AccessExclusiveLock 已被授予**
#    之後才發 INSERT。若整個 migration 期間都沒觀察到(= 持鎖窗短於取樣解析度),
#    **明說觀察不到、不報數字**,不拿「沒量到」當「沒有阻塞」。
#    🔴 而且「沒觀察到」也**不能反推持鎖窗有多短** —— 取樣是靠反覆啟動 psql,
#      實際間隔遠大於迴圈裡寫的 5ms(R3 抓)。
#
# ⚠️ 誠實邊界:本機單機 PG17.10、單一併發連線、隔離庫資料量。**不等於正式站**
#    (Supabase pooler、真實併發、真實資料量都不同)。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="${1:?用法: a1-lock-probe.sh <workdir,例 /tmp/a1v>}"
MIG="supabase/migrations/20260730150000_m4b_e10_a1_order_item_summary_columns.sql"
PORT=54329
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

# ══ 身分閘(R2 must-fix:原版只看檔案 marker,等於對 54329 上任何資料庫都敢 DROP)══
case "$(cd / && printf '%s' "$WORK")" in
  /tmp/?*) : ;;
  *) echo "🔴 workdir 必須在 /tmp 底下(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in *..*) echo "🔴 workdir 不得含 .."; exit 2 ;; esac
[ -f "$WORK/.a1-throwaway" ] || { echo "🔴 $WORK 不是 a1-verify 建的拋棄式 workdir;拒絕執行"; exit 2; }
[ -f "$WORK/cluster-id" ]    || { echo "🔴 缺 $WORK/cluster-id —— 無法確認 port $PORT 上是哪個 cluster;拒絕執行"; exit 2; }
psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || { echo "🔴 連不上 $URL(先跑 a1-verify.sh all)"; exit 1; }
CID="$(psql "$URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' 2>/dev/null)"
[ "$CID" = "$(cat "$WORK/cluster-id")" ] || {
  echo "🔴 cluster 身分不符(實 $CID / 期望 $(cat "$WORK/cluster-id"))—— port $PORT 上可能是別的資料庫;零寫入退出"; exit 2; }

ORDER_ID="$(psql "$URL" -qtA -c "SELECT id FROM public.orders LIMIT 1")"
[ -n "$ORDER_ID" ] || { echo "🔴 orders 零列,量不了"; exit 1; }

# 一次「模擬結帳寫入」:開交易 → INSERT order_items → ROLLBACK。
# 輸出 "<毫秒> <psql退出碼>" —— 🔴 退出碼必須一起看:失敗的 INSERT 會「很快」,
# 把它當成「沒被阻塞」就是假綠(R2 must-fix)。
measure_insert() {
  python3 - "$URL" "$ORDER_ID" <<'PY'
import subprocess, sys, time
url, oid = sys.argv[1], sys.argv[2]
sql = (f"BEGIN; INSERT INTO public.order_items "
       f"(order_id, variant_sku, product_snapshot, quantity, unit_price, line_total) VALUES "
       f"('{oid}', 'LOCKPROBE', '{{\"title\":\"lp\",\"sku\":\"lp\",\"spec\":{{}}}}'::jsonb, 1, 1, 1); ROLLBACK;")
t = time.time()
r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-qtA", "-c", sql],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"{int((time.time() - t) * 1000)} {r.returncode}")
PY
}

drop_a1() {
  psql "$URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP TABLE IF EXISTS public.order_item_quantity_summary;" \
    -c "ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_id_quantity_key;" >/dev/null 2>&1 \
    || { echo "🔴 drop_a1 失敗(fail-closed,不繼續)"; exit 1; }
}

NROWS="$(psql "$URL" -qtA -c 'SELECT count(*) FROM public.order_items')"
echo "== A1 併發鎖量測(order_items 現有 ${NROWS} 列)=="

# ── ① 持鎖上限:migration 整個交易的牆鐘時間 ──────────────────
drop_a1
APPLY_MS="$(python3 - "$URL" "$MIG" <<'PY'
import subprocess, sys, time
url, mig = sys.argv[1], sys.argv[2]
t = time.time()
r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-q", "-f", mig],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"{int((time.time() - t) * 1000)} {r.returncode}")
PY
)"
set -- $APPLY_MS
APPLY_T="$1"; APPLY_RC="$2"
[ "$APPLY_RC" = "0" ] || { echo "  🔴 migration 套用失敗(rc=$APPLY_RC),不報任何數字"; exit 1; }
echo "  ① 持鎖上限(migration 整個交易,含 psql 啟動):${APPLY_T} ms"
echo "     鎖在第一句 ALTER TABLE 取得、持有到 COMMIT ⇒ 交易總時長 = 持鎖窗上限。"

# ── ② 消融:證明 INSERT 量測抓得到阻塞 ────────────────────────
BASE="$(measure_insert)"; set -- $BASE; BASE_T="$1"; BASE_RC="$2"
[ "$BASE_RC" = "0" ] || { echo "  🔴 基準 INSERT 本身就失敗(rc=$BASE_RC);中止"; exit 1; }
echo "  ② 基準(無人持鎖):${BASE_T} ms"

psql "$URL" -qtA -c "BEGIN; LOCK TABLE public.order_items IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
HOLDER=$!
# 等到**確實觀察到**那把鎖被授予,才開始量(不靠 sleep 猜)
for _ in $(seq 1 200); do
  n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_locks WHERE relation='public.order_items'::regclass AND mode='AccessExclusiveLock' AND granted" 2>/dev/null)"
  [ "$n" = "1" ] && break
  sleep 0.02
done
[ "$n" = "1" ] || { echo "  🔴 消融:等不到人工持鎖被授予,量測前提不成立;中止"; kill "$HOLDER" 2>/dev/null; exit 1; }
ABL="$(measure_insert)"; set -- $ABL; ABL_T="$1"; ABL_RC="$2"
wait "$HOLDER" 2>/dev/null
[ "$ABL_RC" = "0" ] || { echo "  🔴 消融的 INSERT 失敗(rc=$ABL_RC)—— 它是被鎖擋住而非等待,量測無效;中止"; exit 1; }
echo "  ② 消融(確認持鎖後才量):${ABL_T} ms"
if [ "$ABL_T" -lt 800 ]; then
  echo "  🔴 消融沒量到阻塞(${ABL_T} ms)—— 這個量測**證明不了自己抓得到**,不報 ③。中止。"
  exit 1
fi
echo "  ✅ 消融成立:量測確實抓得到阻塞"

# ── ③ barrier 版競爭測試 ─────────────────────────────────────
# 🔴 與第一版的差別就在這裡:**先觀察到 migration 的鎖被授予,才發 INSERT**。
#    觀察不到就明說觀察不到,不拿「沒量到」當「沒有阻塞」。
drop_a1
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1 &
APPLY_PID=$!
SEEN=0
for _ in $(seq 1 500); do
  n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_locks WHERE relation='public.order_items'::regclass AND mode='AccessExclusiveLock' AND granted" 2>/dev/null)"
  if [ "$n" = "1" ]; then SEEN=1; break; fi
  kill -0 "$APPLY_PID" 2>/dev/null || break
  sleep 0.005
done
if [ "$SEEN" = "1" ]; then
  REAL="$(measure_insert)"; set -- $REAL; REAL_T="$1"; REAL_RC="$2"
  wait "$APPLY_PID"; RRC=$?
  [ "$RRC" -eq 0 ] || { echo "  🔴 ③ migration 非零退出($RRC),不採信本段;中止"; exit 1; }
  [ "$REAL_RC" = "0" ] || { echo "  🔴 ③ 的 INSERT 失敗(rc=$REAL_RC),不採信;中止"; exit 1; }
  echo "  ③ 競爭(**已確認持鎖後**才發 INSERT):${REAL_T} ms(基準 ${BASE_T} ms)"
  if [ "$REAL_T" -lt $((BASE_T + 200)) ]; then
    echo "     🔴 這個數字**只能證明沒觀察到阻塞,不能證明沒有阻塞** —— 從觀察到鎖"
    echo "        到 psql 真的送出 INSERT 之間有數十毫秒,migration 可能已經 COMMIT。"
    echo "        ③ 的用途是「量到高值時證明有阻塞」;量到低值時不可反推。以 ① 為準。"
  fi
else
  wait "$APPLY_PID"; RRC=$?
  [ "$RRC" -eq 0 ] || { echo "  🔴 ③ migration 非零退出($RRC);中止"; exit 1; }
  echo "  ③ **整個 migration 期間都沒觀察到 AccessExclusiveLock 被授予**"
  echo "     🔴 **不得由此推論持鎖窗有多短**(R3 抓):每一輪取樣都重新啟動一個 psql,"
  echo "        實際取樣間隔含程序啟動與查詢時間、遠大於迴圈裡那個 5ms"
  echo "        ⇒ 一段數十毫秒的鎖完全可能整個落在兩次取樣之間。"
  echo "        本段只能說「未觀察到」,**不能給任何上界或下界**。結論一律以 ① 為準。"
fi

drop_a1
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1 || { echo "🔴 還原套用失敗"; exit 1; }

echo
echo "  📌 可主張的結論:**持鎖窗上限 = ${APPLY_T} ms**(① 量得,含 psql 啟動開銷 ⇒ 實際更短)。"
echo "  ⚠️ 本機單機、單一併發連線、隔離庫 ${NROWS} 列;不等於正式站。"
