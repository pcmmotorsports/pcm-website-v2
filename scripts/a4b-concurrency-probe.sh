#!/usr/bin/env bash
# ============================================================
# A4b:A4a 重算 trigger 的兩 session 競態負測 + 漂移 assert(master plan row 31)
# ============================================================
# plan = docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md §8
# 用法:scripts/d1t2-rehearsal.sh provision <workdir>(A4a migration 已含)後,
#       scripts/a4b-concurrency-probe.sh <workdir>
# 形狀:FIFO 雙 session + pg_blocking_pids 判別力 barrier(a2b2 原語)。
# 情境:SA1 遺失更新關閉(row 30 指定雙連線負測)/ SA2 消融(committed 去 helper NKU,
#       斷言打**終態**非阻塞 —— 關卡1 R1-3:mutant 下 B 改在摘要 PK 上短暫等待,阻塞觀察無判別力)
#       / SA2b 取消 vs 取消純對照(a2b1 的鎖完全不在場,把 helper NKU 的承重徹底隔離)
#       / SA3 receipts 競態(proc 列 NKU 承重)/ SA4 漂移 assert(全表掃描代抽樣,判別力更強)。
# 零留痕:committed 列逐情境清除 + 收尾計數回基準 + helper md5 比對。
set -uo pipefail

WORK="${1:-/tmp/a4a-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
AURL="${URL}?application_name=a4b_sess_a"
BURL="${URL}?application_name=a4b_sess_b"
HELPER="public.pcm_a4a_recompute_order_item_summary(uuid)"
FN_RCPT="public.pcm_a4a_receipts_received_sync()"
PASS=0; FAIL=0; MUT=0; CELL=0
EXPECTED_TOTAL=33
EXPECTED_CELL=6
EXPECTED_MUT=2

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
cell() { CELL=$((CELL+$1)); }
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(七道,照 a2b2)────────────────────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC 預設;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN ('order_item_procurement_summary_recompute_zc','order_item_procurement_receipts_received_sync_ac','order_cancellation_items_summary_recompute_ac') AND NOT tgisinternal")" = "3" ] \
  || { echo "🔴 A4a 三支重算 trigger 不齊(migration 未套?);拒跑"; exit 1; }
[ "$(q "SELECT strpos(pg_get_functiondef('$HELPER'::regprocedure),'FOR NO KEY UPDATE') > 0")" = "t" ] \
  || { echo "🔴 helper 缺 NKU 錨 —— 上一輪 crash 的 mutant 殘留?先還原再跑"; exit 1; }

# 漂移 oracle(與 a4a-verify 同一份獨立推導 SQL;R3-F3)
ORACLE_SQL="SELECT (SELECT count(*) FROM public.order_item_procurement p
              WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity)
                    FROM public.order_item_procurement_receipts r WHERE r.procurement_id = p.id),0))
          + (SELECT count(*) FROM public.order_item_quantity_summary s
              WHERE s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=s.order_item_id),0)
                 OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=s.order_item_id),0)
                 OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                       WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=s.order_item_id)),0))
          + (SELECT count(*) FROM (SELECT p.order_item_id FROM public.order_item_procurement p
                                   UNION SELECT c.order_item_id FROM public.order_cancellation_items c) x
              WHERE NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = x.order_item_id))"

# ── FIFO 雙 session(a2b2 原語)──────────────────────────────
PA=""; PB=""
wait_idle() {
  local who="$1" i st
  for i in $(seq 1 120); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name='a4b_sess_${who}' LIMIT 1" 2>/dev/null)"
    case "$st" in idle|'idle in transaction') return 0 ;; esac
    sleep 0.25
  done
  echo "  🔴 barrier 逾時:session $who 30s 未回 idle(state=$st);中止"; exit 1
}
wait_blocked_by() {
  local waiter="$1" blocker="$2" tries="${3:-120}" quiet="${4:-0}" i bpid n
  bpid="$(q "SELECT pid FROM pg_stat_activity WHERE application_name='a4b_sess_${blocker}' LIMIT 1")"
  [ -n "$bpid" ] || { [ "$quiet" = "1" ] || echo "  🔴 找不到 blocker pid"; return 1; }
  for i in $(seq 1 "$tries"); do
    n="$(q "SELECT count(*) FROM pg_stat_activity w WHERE w.application_name='a4b_sess_${waiter}' AND w.wait_event_type='Lock' AND pg_blocking_pids(w.pid) @> ARRAY[${bpid}::integer]")"
    [ "$n" = "1" ] && return 0
    sleep 0.25
  done
  [ "$quiet" = "1" ] || echo "  🔴 barrier 逾時:$waiter 未被 $blocker 擋住"
  return 1
}
open2() {
  rm -f "$WORK/a4b-fa" "$WORK/a4b-fb"; mkfifo "$WORK/a4b-fa" "$WORK/a4b-fb"
  ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$WORK/a4b-fa" > "$WORK/a4b-outa.txt" 2>&1 ) & PA=$!
  ( psql "$BURL" -tA -v ON_ERROR_STOP=0 -f "$WORK/a4b-fb" > "$WORK/a4b-outb.txt" 2>&1 ) & PB=$!
  exec 3>"$WORK/a4b-fa"; exec 4>"$WORK/a4b-fb"
  wait_idle a; wait_idle b
}
sa() { printf '%s\n' "$1" >&3; wait_idle a; }
sb() { printf '%s\n' "$1" >&4; wait_idle b; }
sb_raw() { printf '%s\n' "$1" >&4; }
close2() { exec 3>&- 2>/dev/null || true; exec 4>&- 2>/dev/null || true
  [ -n "$PA" ] && wait "$PA" 2>/dev/null || true; [ -n "$PB" ] && wait "$PB" 2>/dev/null || true; PA=""; PB=""; }

echo "== A4b concurrency probe($(date '+%H:%M:%S'))WORK=$WORK =="
echo "-- H 區自我測試 --"
if count_gate "$EXPECTED_TOTAL" 2; then bad "H1:count_gate 竟放行"; else ok "H1:count_gate 對不符值發火"; fi

echo "== 基準與 fixture =="
ORDERS_N0="$(q "SELECT count(*) FROM public.orders")"
PROC_N0="$(q "SELECT count(*) FROM public.order_item_procurement")"
SUMM_N0="$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
[ -n "$ORDERS_N0" ] && [ -n "$PROC_N0" ] && [ -n "$SUMM_N0" ] \
  && ok "基準已取(orders=$ORDERS_N0 proc=$PROC_N0 summ=$SUMM_N0)" || bad "基準取得失敗"

MUTATED=0; MUTATED_R=0
ORIGDEF_FILE="$WORK/a4b-helper-orig.sql"
ORIGDEF_R_FILE="$WORK/a4b-rcpt-orig.sql"
cleanup_all() {
  close2 2>/dev/null || true
  if [ "$MUTATED" = "1" ] && [ -s "$ORIGDEF_FILE" ]; then
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
    if [ -n "${MD5_0:-}" ] && [ "$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")" = "$MD5_0" ]; then
      MUTATED=0
    else
      echo "🔴🔴 cleanup:helper mutant 還原失敗 —— 庫仍是突變版" >&2
    fi
  fi
  if [ "$MUTATED_R" = "1" ] && [ -s "$ORIGDEF_R_FILE" ]; then
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_R_FILE" >/dev/null 2>&1
    if [ -n "${MD5_R0:-}" ] && [ "$(q "SELECT md5(pg_get_functiondef('$FN_RCPT'::regprocedure))")" = "$MD5_R0" ]; then
      MUTATED_R=0
    else
      echo "🔴🔴 cleanup:receipts-sync mutant 還原失敗" >&2
    fi
  fi
  psql "$URL" -tAX >/dev/null 2>&1 <<'CLEAN' || echo "🔴 cleanup:fixture 清理失敗" >&2
BEGIN;
DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN
  (SELECT p.id FROM public.order_item_procurement p JOIN public.order_items i ON i.id=p.order_item_id WHERE i.variant_sku='A4B-P5');
DELETE FROM public.order_item_procurement WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku='A4B-P5');
DELETE FROM public.order_cancellation_items WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku='A4B-P5');
DELETE FROM public.order_cancellations WHERE order_id IN
  (SELECT id FROM public.orders WHERE display_id='PCM-9991-0001');
COMMIT;
CLEAN
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9991-0001'" >/dev/null 2>&1 || true
  rm -f "$WORK/a4b-fa" "$WORK/a4b-fb"
}
trap 'exit 130' INT TERM
trap cleanup_all EXIT

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_order uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'fixture 失敗:customers 為空'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE display_id='PCM-9991-0001') THEN
    RAISE EXCEPTION 'fixture 失敗:PCM-9991-0001 已存在';
  END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9991-0001', v_cust,
          jsonb_build_object('name','A4b 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A4B-P5', '{"title":"a4b p5","sku":"A4B-P5","spec":{}}'::jsonb, 5, 0, 0);
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "fixture 已建(PCM-9991-0001;P5 qty=5)" \
  || bad "fixture 失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
ORDER_ID="$(q "SELECT id FROM public.orders WHERE display_id='PCM-9991-0001'")"
ITEM="$(q "SELECT id FROM public.order_items WHERE variant_sku='A4B-P5'")"
SUP="$(q "SELECT id FROM public.suppliers ORDER BY id LIMIT 1")"
STAFF="$(q "SELECT id FROM public.staff ORDER BY id LIMIT 1")"
if [ -n "$ORDER_ID" ] && [ -n "$ITEM" ] && [ -n "$SUP" ] && [ -n "$STAFF" ]; then
  ok "fixture id 已取"
else
  bad "fixture id 缺 —— 後續無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1
fi
MD5_0="$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")"
psql "$URL" -tAX -c "SELECT pg_get_functiondef('$HELPER'::regprocedure)" > "$ORIGDEF_FILE" 2>/dev/null
MD5_R0="$(q "SELECT md5(pg_get_functiondef('$FN_RCPT'::regprocedure))")"
psql "$URL" -tAX -c "SELECT pg_get_functiondef('$FN_RCPT'::regprocedure)" > "$ORIGDEF_R_FILE" 2>/dev/null
[ -n "$MD5_0" ] && [ -s "$ORIGDEF_FILE" ] && [ -n "$MD5_R0" ] && [ -s "$ORIGDEF_R_FILE" ] \
  && ok "helper + receipts-sync 兩函式 md5 基準與原始定義已存檔" || bad "md5/定義基準失敗"

SUMMARY_ROW="SELECT ordered_quantity||','||instock_quantity||','||cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM'"
CLEAN_ITEM="DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'; DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM'; DELETE FROM public.order_cancellations WHERE order_id='$ORDER_ID'; DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM';"

# SA1 交錯(A=採購首建列、B=取消首建列;$1=描述;呼叫端自行斷言終態)
run_sa1() {
  open2
  sa "BEGIN;"
  sa "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SUP',2);"
  sb "BEGIN;"
  sb "INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor) VALUES (gen_random_uuid(), '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256(('a4b-'||clock_timestamp()::text)::bytea),'hex'), '$STAFF') RETURNING id \\gset canc_"
  sb_raw "INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity) VALUES (:'canc_id', '$ORDER_ID', '$ITEM', 1);"
  if [ "$1" = "expect_block" ]; then
    wait_blocked_by b a && ok "  barrier:B(取消)被 A(採購)擋住且 blocking pid 恰為 A" \
      || bad "  barrier:B 未被 A 擋住"
  else
    # 🔀 codex K2-R2 nit:mutant 腿 B 仍會在摘要 PK / tuple 鎖上阻塞 ⇒ 拿它當時序 barrier
    # (只保時序不當判定;等不到 = 交錯壞掉,硬停不假跑)
    wait_blocked_by b a 120 1 || { echo "  🔴 mutant 腿 barrier:B 未達阻塞點(交錯失效);中止"; exit 1; }
  fi
  sa "COMMIT;"
  wait_idle b
  sb "COMMIT;"
  close2
}

echo
echo "== SA1 遺失更新關閉:採購 vs 取消同品項首次建列(row 30 指定)=="
cell 1
run_sa1 expect_block
[ "$(q "$SUMMARY_ROW")" = "2,0,1" ] \
  && ok "[SA1] 終態兩軸皆正確 (2,0,1) —— 後寫者沒有覆蓋另一軸" || bad "[SA1] 終態 $(q "$SUMMARY_ROW") ≠ (2,0,1) 遺失更新?"
q "$CLEAN_ITEM" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[SA1] 已清回基準" || bad "[SA1] 殘留"

echo
echo "== SA2b-基準:取消 vs 取消(正常世界,cancelled=4)=="
cell 1
run_sa2b() {
  open2
  sa "BEGIN;"
  sa "INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor) VALUES (gen_random_uuid(), '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256(('a4b-a-'||clock_timestamp()::text)::bytea),'hex'), '$STAFF') RETURNING id \\gset canca_"
  sa "INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity) VALUES (:'canca_id', '$ORDER_ID', '$ITEM', 2);"
  sb "BEGIN;"
  sb "INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor) VALUES (gen_random_uuid(), '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256(('a4b-b-'||clock_timestamp()::text)::bytea),'hex'), '$STAFF') RETURNING id \\gset cancb_"
  sb_raw "INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity) VALUES (:'cancb_id', '$ORDER_ID', '$ITEM', 2);"
  if [ "$1" = "expect_block" ]; then
    wait_blocked_by b a && ok "  barrier:B 被 A 擋住(a2b1 完全不在場 ⇒ 這把鎖只能是 helper 的 NKU)" \
      || bad "  barrier:B 未被 A 擋住"
  else
    wait_blocked_by b a 120 1 || { echo "  🔴 mutant 腿 barrier:B 未達阻塞點(交錯失效);中止"; exit 1; }
  fi
  sa "COMMIT;"
  wait_idle b
  sb "COMMIT;"
  close2
}
run_sa2b expect_block
[ "$(q "SELECT cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM'")" = "4" ] \
  && ok "[SA2b-基準] cancelled=4(B 鎖後重讀看到 A 的 2)" || bad "[SA2b-基準] cancelled=$(q "SELECT cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM'") ≠ 4"
q "$CLEAN_ITEM" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_cancellation_items")" = "0" ] && ok "[SA2b-基準] 已清" || bad "[SA2b-基準] 殘留"

echo
echo "== SA2 消融:committed 去 helper NKU ⇒ 終態遺失更新真的發生(:377 指定)=="
cell 1
MUTATED=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $m$
DECLARE v_oid oid := 'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure; v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(v_def, ' FOR NO KEY UPDATE', '');
  IF v_new = v_def THEN RAISE EXCEPTION 'SA2:anchor 未命中'; END IF;
  IF (length(v_def) - length(v_new)) / length(' FOR NO KEY UPDATE') <> 1 THEN RAISE EXCEPTION 'SA2:anchor 非恰 1 次'; END IF;
  EXECUTE v_new;
END $m$;
SQL
)"
if [ $? -eq 0 ]; then
  MUT=$((MUT+1))
  ok "[SA2] mutant 已套(helper NKU 移除;唯一 committed 突變)"
  # 同 SA1 交錯;斷言打終態(B 在摘要 PK 上短暫等待屬預期,阻塞非判別點 —— R1-3)
  run_sa1 no_block_assert
  R="$(q "$SUMMARY_ROW")"
  [ "$R" = "0,0,1" ] \
    && ok "[SA2] 無鎖版終態 (0,0,1) —— B 的過時 upsert 把 A 的 ordered=2 覆蓋成 0(遺失更新實錘、鎖承重)" \
    || bad "[SA2] 終態 $R(預期 0,0,1;若 =2,0,1 表示鎖被別的機制供給)"
  q "$CLEAN_ITEM" >/dev/null
  [ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[SA2] 已清" || bad "[SA2] 殘留"
  # SA2b 消融腿:取消 vs 取消 ⇒ 累積漂移(2+2 只剩 2)
  run_sa2b no_block_assert
  RB="$(q "SELECT cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM'")"
  [ "$RB" = "2" ] \
    && ok "[SA2b-消融] cancelled=2 ≠ 4 —— 純取消對照也漂移(helper NKU 的承重與 a2b1 徹底無關)" \
    || bad "[SA2b-消融] cancelled=$RB(預期 2)"
  q "$CLEAN_ITEM" >/dev/null
  [ "$(q "SELECT count(*) FROM public.order_cancellation_items")" = "0" ] && ok "[SA2b-消融] 已清" || bad "[SA2b-消融] 殘留"
else
  MUT=$((MUT+1))
  bad "[SA2] mutant 套用失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
  bad "[SA2](終態觀察未執行)"; bad "[SA2](清理未執行)"; bad "[SA2b-消融](未執行)"; bad "[SA2b-消融](清理未執行)"
fi
psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
RC=$?
if [ "$RC" -eq 0 ] && [ "$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")" = "$MD5_0" ]; then
  MUTATED=0
  ok "[SA2] 還原完成(rc=0、md5 = 基準)"
else
  bad "[SA2] 還原失敗(rc=$RC)—— 旗未降,EXIT trap 會再試"
fi
run_sa1 expect_block
[ "$(q "$SUMMARY_ROW")" = "2,0,1" ] \
  && ok "[SA2-還原] 同交錯重跑終態又正確 (2,0,1)(消融有判別力、非環境巧合)" || bad "[SA2-還原] 重跑終態 $(q "$SUMMARY_ROW")"
q "$CLEAN_ITEM" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[SA2-還原] 已清" || bad "[SA2-還原] 殘留"

echo
echo "== SA3 receipts 競態:同 proc 列併發到貨 ⇒ 序列化、received 不多不少 =="
cell 1
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SUP',5)" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "1" ] \
  && ok "[SA3] committed 採購列在位(alloc 5)" || bad "[SA3] 設置失敗"
run_sa3() {   # $1=expect_block|no_block_assert;A 收 2、B 收 1;呼叫端斷言終態
  open2
  sa "BEGIN;"
  sa "INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by) SELECT p.id, 2, now(), 'a4b_probe' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM';"
  sb_raw "INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by) SELECT p.id, 1, now(), 'a4b_probe' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM';"
  if [ "$1" = "expect_block" ]; then
    wait_blocked_by b a && ok "  barrier:B 被 A 擋住(阻塞觀察;承重證明在 SA3b 消融終態)" || bad "  barrier:B 未被擋"
  else
    wait_blocked_by b a 120 1 || { echo "  🔴 SA3b barrier:B 未達 UPDATE 阻塞點(交錯失效);中止"; exit 1; }
  fi
  sa "COMMIT;"
  wait_idle b
  close2
}
clean_sa3_receipts() {
  q "DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN (SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM')" >/dev/null
  psql "$URL" -qtAX -c "SELECT set_config('pcm_a4a.received_sync','1',false)" -c "UPDATE public.order_item_procurement SET received_quantity=0 WHERE order_item_id='$ITEM'" -c "SELECT set_config('pcm_a4a.received_sync','',false)" >/dev/null 2>&1
}
run_sa3 expect_block
[ "$(q "SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "3" ] \
  && [ "$(q "SELECT instock_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM'")" = "3" ] \
  && ok "[SA3] received=3 且 instock=3(兩批和,不多不少)" || bad "[SA3] received/instock 不符"
clean_sa3_receipts

# SA3b(codex K2-2):sync 的 proc NKU 消融 —— 阻塞可被 UPDATE tuple 鎖代打,承重只能由終態證明:
# 無 NKU 時 B 的 v_sum 在等待前已算好(只見自己的 1)⇒ 覆蓋 A 的 2 ⇒ received=1 ≠ 3。
cell 1
MUTATED_R=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $m$
DECLARE v_oid oid := 'public.pcm_a4a_receipts_received_sync()'::regprocedure; v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(v_def, ' FOR NO KEY UPDATE', '');
  IF v_new = v_def THEN RAISE EXCEPTION 'SA3b:anchor 未命中'; END IF;
  IF (length(v_def) - length(v_new)) / length(' FOR NO KEY UPDATE') <> 1 THEN RAISE EXCEPTION 'SA3b:anchor 非恰 1 次'; END IF;
  EXECUTE v_new;
END $m$;
SQL
)"
if [ $? -eq 0 ]; then
  MUT=$((MUT+1))
  ok "[SA3b] mutant 已套(sync 的 proc NKU 移除;committed)"
  run_sa3 no_block_assert
  RR3="$(q "SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM'")"
  [ "$RR3" = "1" ] \
    && ok "[SA3b] 無鎖版終態 received=1 ≠ 3 —— B 的過時 v_sum 覆蓋 A 的批次(NKU 承重、非 tuple 鎖代打)" \
    || bad "[SA3b] 終態 received=$RR3(預期 1;=3 表示鎖被別的機制供給)"
  clean_sa3_receipts
else
  MUT=$((MUT+1))
  bad "[SA3b] mutant 套用失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
  bad "[SA3b](終態觀察未執行)"
fi
psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_R_FILE" >/dev/null 2>&1
RCR=$?
if [ "$RCR" -eq 0 ] && [ "$(q "SELECT md5(pg_get_functiondef('$FN_RCPT'::regprocedure))")" = "$MD5_R0" ]; then
  MUTATED_R=0
  ok "[SA3b] 還原完成(rc=0、md5 = 基準)"
else
  bad "[SA3b] 還原失敗(rc=$RCR)—— 旗未降,EXIT trap 會再試"
fi
run_sa3 expect_block
[ "$(q "SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "3" ] \
  && ok "[SA3b-還原] 同交錯重跑 received=3(消融有判別力)" || bad "[SA3b-還原] 重跑不符"
clean_sa3_receipts
q "$CLEAN_ITEM" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[SA3] 已清" || bad "[SA3] 殘留"

echo
echo "== SA4 漂移 assert:混合 committed 活動後全表掃描三等式(row 31)=="
cell 1
psql "$URL" -v ON_ERROR_STOP=1 -tAX >/dev/null 2>&1 <<SQL
BEGIN;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SUP',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 2, now(), 'a4b_probe' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM';
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('cccccccc-0000-0000-0000-0000000000c1'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a4b-sa4'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('cccccccc-0000-0000-0000-0000000000c1'::uuid, '$ORDER_ID', '$ITEM', 1);
COMMIT;
SQL
[ "$(q "$ORACLE_SQL")" = "0" ] && [ "$(q "$SUMMARY_ROW")" = "3,2,1" ] \
  && ok "[SA4] 混合活動 (3,2,1) + 全表漂移 oracle = 0(oracle 判別力由 a4a-verify H4 消融背書)" \
  || bad "[SA4] oracle=$(q "$ORACLE_SQL") row=$(q "$SUMMARY_ROW")"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "BEGIN" -c "DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN (SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM')" -c "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" -c "DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM'" -c "DELETE FROM public.order_cancellations WHERE order_id='$ORDER_ID'" -c "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM'" -c "COMMIT" >/dev/null 2>&1 \
  && ok "[SA4] 已清" || bad "[SA4] 清理失敗"

echo
echo "== 零留痕收尾 =="
[ "$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")" = "$MD5_0" ] && ok "helper md5 = 基準" || bad "helper md5 被改"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9991-0001'" 2>&1)"
[ $? -eq 0 ] \
  && [ "$(q "SELECT count(*) FROM public.orders")" = "$ORDERS_N0" ] \
  && [ "$(q "SELECT count(*) FROM public.order_item_quantity_summary")" = "$SUMM_N0" ] \
  && ok "fixture 訂單已刪、orders/summary 回基準" || bad "殘留:$(printf '%s' "$o" | head -1 | cut -c1-120)"

echo
echo "== 誠實邊界 =="
echo "   🔴 SA2 的『阻塞與否』非判別點(mutant 下 B 改在摘要 PK 上等待)—— 判別點是終態(R1-3)。"
echo "   🔴 反向 re-parent 環①與多列環②③(migration 檔頭)未在本 harness 重現 —— fail-closed 40P01 類,"
echo "      非資料錯;writer 契約見 migration 註解。"
echo "   🔴 本 harness 在本機 PG17 + shim;PostgREST 層與正式站 runtime 不在證明範圍。"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL / 格 CELL=$CELL / 突變 MUT=$MUT =="
echo "   釘數:EXPECTED_TOTAL=$EXPECTED_TOTAL EXPECTED_CELL=$EXPECTED_CELL EXPECTED_MUT=$EXPECTED_MUT"
count_gate "$EXPECTED_TOTAL" "$((PASS+FAIL))" || { echo "🔴 總數 $((PASS+FAIL)) ≠ $EXPECTED_TOTAL"; exit 1; }
count_gate "$EXPECTED_CELL" "$CELL" || { echo "🔴 CELL $CELL ≠ $EXPECTED_CELL"; exit 1; }
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 MUT $MUT ≠ $EXPECTED_MUT"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
echo "🎉 A4b concurrency probe 全綠"
