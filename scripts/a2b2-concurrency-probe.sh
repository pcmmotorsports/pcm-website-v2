#!/usr/bin/env bash
# ============================================================
# A2b2:A2b1 守門的兩 session 競態負測(master plan row 29;plan §10)
# ============================================================
# 用法:scripts/d1t2-rehearsal.sh provision <workdir> 之後,scripts/a2b2-concurrency-probe.sh <workdir>
# 形狀:FIFO 雙 session(a7t :110-132 原語)+ pg_blocking_pids 判別力(s2c :44-45 教訓:
#   「有沒有在等鎖」會被第三方代打,必須綁定「擋住 B 的就是 A」)。
# 情境:S1 競態關閉 / S2 邊界放行 / S3 消融(唯一 committed 函式突變,同 a2b1 M1 還原機制)
#       / S4 跨 session delta / S5 🔀(2026-08-03 A4a 落地,Sean Q1=A)契約債⑥已關閉:
#       原「窗口實證」期望翻紅 —— 取消寫入自 A4a 起取 parent NKU ⇒ B 被擋、超量態不再可達;
#       S3 消融腿並 committed DISABLE A4a zc trigger(它鎖同一把 parent,不隔離 = 鎖消失也觀察不到)。
# 零留痕:committed 列逐情境清除 + 收尾四表計數回基準 + 函式 md5 比對。
set -uo pipefail

WORK="${1:-/tmp/a2b1-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
AURL="${URL}?application_name=a2b2_sess_a"
BURL="${URL}?application_name=a2b2_sess_b"
FNSIG="public.pcm_a2b1_procurement_allocation_guard()"
PASS=0; FAIL=0; MUT=0; CELL=0
EXPECTED_TOTAL=37
EXPECTED_CELL=5
EXPECTED_MUT=1
# (code-reviewer N4:本檔無任何 SKIP 來源 ⇒ SKIP 計數與其閘為恆真死重,整組移除、不抄樣板)

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
cell() { CELL=$((CELL+$1)); }
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }
sqlstate_of() { psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$1" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1; }

# ── 身分閘(marker/datadir/db/RC/lc_messages/trigger 在位/函式未突變 七道)────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC 預設;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='order_item_procurement_allocation_guard_ac' AND NOT tgisinternal")" = "1" ] \
  || { echo "🔴 A2b1 trigger 不在(migration 未套?);拒跑"; exit 1; }
[ "$(q "SELECT strpos(pg_get_functiondef('$FNSIG'::regprocedure),'FOR NO KEY UPDATE') > 0")" = "t" ] \
  || { echo "🔴 守門函式缺 NKU 錨 —— 上一輪 crash 的 mutant 殘留?先還原再跑(N10 明確訊息)"; exit 1; }
[ "$(q "SELECT tgenabled FROM pg_trigger WHERE tgname='order_item_procurement_summary_recompute_zc' AND NOT tgisinternal")" = "O" ] \
  || { echo "🔴 A4a zc trigger 非 enabled O(上一輪 S3 中斷殘留?);先 ENABLE 再跑 —— 起跑閘不由測試自行洗白(codex K2-5)"; exit 1; }

# ── FIFO 雙 session ─────────────────────────────────────────
PA=""; PB=""
wait_idle() {
  local who="$1" i st
  for i in $(seq 1 120); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name='a2b2_sess_${who}' LIMIT 1" 2>/dev/null)"
    case "$st" in idle|'idle in transaction') return 0 ;; esac
    sleep 0.25
  done
  echo "  🔴 barrier 逾時:session $who 30s 未回 idle(state=$st);中止"; exit 1
}
# 判別力 barrier:waiter 必須 active + 等 Lock + pg_blocking_pids 恰含 blocker 的 pid
# $3 = 輪詢次數(預設 120 = 30s);$4 = quiet(消融腿期望「等不到」時不吵)
wait_blocked_by() {
  local waiter="$1" blocker="$2" tries="${3:-120}" quiet="${4:-0}" i bpid n
  bpid="$(q "SELECT pid FROM pg_stat_activity WHERE application_name='a2b2_sess_${blocker}' LIMIT 1")"
  [ -n "$bpid" ] || { [ "$quiet" = "1" ] || echo "  🔴 找不到 blocker session pid"; return 1; }
  for i in $(seq 1 "$tries"); do
    n="$(q "SELECT count(*) FROM pg_stat_activity w WHERE w.application_name='a2b2_sess_${waiter}' AND w.wait_event_type='Lock' AND pg_blocking_pids(w.pid) @> ARRAY[${bpid}::integer]")"
    [ "$n" = "1" ] && return 0
    sleep 0.25
  done
  [ "$quiet" = "1" ] || echo "  🔴 barrier 逾時:$waiter 未被 $blocker 擋住"
  return 1
}
open2() {
  rm -f "$WORK/a2b2-fa" "$WORK/a2b2-fb"; mkfifo "$WORK/a2b2-fa" "$WORK/a2b2-fb"
  ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$WORK/a2b2-fa" > "$WORK/a2b2-outa.txt" 2>&1 ) & PA=$!
  ( psql "$BURL" -tA -v ON_ERROR_STOP=0 -f "$WORK/a2b2-fb" > "$WORK/a2b2-outb.txt" 2>&1 ) & PB=$!
  exec 3>"$WORK/a2b2-fa"; exec 4>"$WORK/a2b2-fb"
  wait_idle a; wait_idle b
  sb '\set VERBOSITY verbose'
}
sa() { printf '%s\n' "$1" >&3; wait_idle a; }
sb() { printf '%s\n' "$1" >&4; wait_idle b; }
sb_raw() { printf '%s\n' "$1" >&4; }   # 不等(B 會 block 在鎖上)
close2() { exec 3>&- 2>/dev/null || true; exec 4>&- 2>/dev/null || true
  [ -n "$PA" ] && wait "$PA" 2>/dev/null || true; [ -n "$PB" ] && wait "$PB" 2>/dev/null || true; PA=""; PB=""; }
OUTB_MARK=0
outb_mark()  { OUTB_MARK="$(wc -l < "$WORK/a2b2-outb.txt" | tr -d ' ')"; }
outb_since() { tail -n "+$((OUTB_MARK+1))" "$WORK/a2b2-outb.txt"; }

echo "== A2b2 concurrency probe($(date '+%H:%M:%S'))WORK=$WORK =="
echo "-- H 區自我測試 --"
if count_gate "$EXPECTED_TOTAL" 2; then bad "H1:count_gate 竟放行 2≠$EXPECTED_TOTAL"; else ok "H1:count_gate 對不符值發火(收尾同一份)"; fi

echo "== 基準與 fixture =="
ORDERS_N0="$(q "SELECT count(*) FROM public.orders")"
ITEMS_N0="$(q "SELECT count(*) FROM public.order_items")"
PROC_N0="$(q "SELECT count(*) FROM public.order_item_procurement")"
CANC_N0="$(q "SELECT count(*) FROM public.order_cancellation_items")"
HDR_N0="$(q "SELECT count(*) FROM public.order_cancellations")"
[ -n "$ORDERS_N0" ] && [ -n "$ITEMS_N0" ] && [ -n "$PROC_N0" ] && [ -n "$CANC_N0" ] && [ -n "$HDR_N0" ] \
  && ok "基準已取(orders=$ORDERS_N0 items=$ITEMS_N0 proc=$PROC_N0 canc=$CANC_N0 hdr=$HDR_N0)" || bad "基準取得失敗"

MUTATED=0
ORIGDEF_FILE="$WORK/a2b2-fn-orig.sql"
cleanup_all() {
  close2 2>/dev/null || true
  psql "$URL" -tAX -c "ALTER TABLE public.order_item_procurement ENABLE TRIGGER order_item_procurement_summary_recompute_zc" >/dev/null 2>&1 || true
  if [ "$MUTATED" = "1" ] && [ -s "$ORIGDEF_FILE" ]; then
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
    if [ -n "${FNMD5_0:-}" ] && [ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" = "$FNMD5_0" ]; then
      MUTATED=0
    else
      echo "🔴🔴 cleanup:S3 mutant 還原失敗 —— 庫仍是突變版,重跑 a2b1-verify 會在 A7 錨紅" >&2
    fi
  fi
  psql "$URL" -tAX -c "DELETE FROM public.order_item_procurement WHERE order_item_id IN (SELECT id FROM public.order_items WHERE variant_sku='A2B2-P5')" >/dev/null 2>&1 || echo "🔴 cleanup:proc 殘留" >&2
  psql "$URL" -tAX -c "BEGIN; DELETE FROM public.order_cancellation_items WHERE order_item_id IN (SELECT id FROM public.order_items WHERE variant_sku='A2B2-P5'); DELETE FROM public.order_cancellations WHERE order_id IN (SELECT id FROM public.orders WHERE display_id='PCM-9996-0001'); COMMIT" >/dev/null 2>&1 || echo "🔴 cleanup:cancellation 殘留" >&2
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9996-0001'" >/dev/null 2>&1 || echo "🔴 cleanup:order 殘留" >&2
  rm -f "$WORK/a2b2-fa" "$WORK/a2b2-fb"
}
trap 'exit 130' INT TERM
trap cleanup_all EXIT

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_order uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'fixture 失敗:customers 為空'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE display_id='PCM-9996-0001') THEN
    RAISE EXCEPTION 'fixture 失敗:PCM-9996-0001 已存在';
  END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9996-0001', v_cust,
          jsonb_build_object('name','A2b2 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A2B2-P5', '{"title":"a2b2 p5","sku":"A2B2-P5","spec":{}}'::jsonb, 5, 0, 0);
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "fixture 已建(PCM-9996-0001;P5 qty=5)" \
  || bad "fixture 失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
ORDER_ID="$(q "SELECT id FROM public.orders WHERE display_id='PCM-9996-0001'")"
ITEM="$(q "SELECT id FROM public.order_items WHERE variant_sku='A2B2-P5'")"
SA="$(q "SELECT id FROM public.suppliers ORDER BY id LIMIT 1")"
SB="$(q "SELECT id FROM public.suppliers ORDER BY id OFFSET 1 LIMIT 1")"
STAFF="$(q "SELECT id FROM public.staff ORDER BY id LIMIT 1")"
if [ -n "$ORDER_ID" ] && [ -n "$ITEM" ] && [ -n "$SA" ] && [ -n "$SB" ] && [ -n "$STAFF" ]; then
  ok "fixture id 已取"
else
  bad "fixture id 缺 —— 後續無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1
fi
FNMD5_0="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
psql "$URL" -tAX -c "SELECT pg_get_functiondef('$FNSIG'::regprocedure)" > "$ORIGDEF_FILE" 2>/dev/null
[ -n "$FNMD5_0" ] && [ -s "$ORIGDEF_FILE" ] && ok "函式 md5 基準 + 原始定義已存檔" || bad "md5/定義基準取得失敗"

INS_A3="INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SA',3);"
INS_B3="INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SB',3);"

run_race() {   # $1 = A 的量;B 恆 3;回傳留在 outb_since
  open2
  sa "BEGIN;"
  sa "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SA',$1);"
  outb_mark
  sb_raw "$INS_B3"
  wait_blocked_by b a && ok "  barrier:B 正在等鎖且 pg_blocking_pids(B) 恰含 A(擋住 B 的就是 A)" \
    || bad "  barrier:B 沒有被 A 擋住"
  sa "COMMIT;"
  wait_idle b
  close2
}

echo
echo "== S1 競態關閉:A 先 3、B 併發 3 ⇒ B 等鎖後 P2B01 =="
cell 1
run_race 3
if outb_since | grep -q 'P2B01' && outb_since | grep -q 'A2b1 超量'; then
  ok "[S1] B 在 A commit 後紅在 P2B01(鎖後重讀看到 A 的 3+3>5)"
else
  bad "[S1] B 未紅在 P2B01:$(outb_since | grep -m1 ERROR | cut -c1-140)"
fi
[ "$(q "SELECT count(*) || '/' || COALESCE(sum(allocated_quantity),0) FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "1/3" ] \
  && ok "[S1] 終態恰 A 的一列 3 件" || bad "[S1] 終態不符"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[S1] 已清回基準" || bad "[S1] 殘留"

echo
echo "== S2 邊界放行:A 先 2、B 併發 3 ⇒ B 等鎖後放行、合計恰滿 =="
cell 1
run_race 2
if outb_since | grep -q 'INSERT 0 1'; then
  ok "[S2] B 等鎖後放行(序列化不誤殺)"
else
  bad "[S2] B 未放行:$(outb_since | grep -m1 -E 'ERROR' | cut -c1-140)"
fi
[ "$(q "SELECT count(*) || '/' || COALESCE(sum(allocated_quantity),0) FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "2/5" ] \
  && ok "[S2] 終態兩列合計 5 恰滿" || bad "[S2] 終態不符"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[S2] 已清回基準" || bad "[S2] 殘留"

echo
echo "== S3 消融:committed 拿掉 NKU ⇒ 同交錯兩筆都過、超量真的發生;還原後重跑又紅 =="
cell 1
MUTATED=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $m$
DECLARE v_oid oid := 'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure; v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(v_def, ' FOR NO KEY UPDATE', '');
  IF v_new = v_def THEN RAISE EXCEPTION 'S3:anchor 未命中'; END IF;
  IF (length(v_def) - length(v_new)) / length(' FOR NO KEY UPDATE') <> 1 THEN RAISE EXCEPTION 'S3:anchor 非恰 1 次'; END IF;
  EXECUTE v_new;
END $m$;
SQL
)"
if [ $? -eq 0 ]; then
  MUT=$((MUT+1))
  ok "[S3] mutant 已套(NKU 移除;唯一 committed 突變)"
  # 🔀 A4a 連動:zc trigger 鎖同一把 parent ⇒ 消融腿必須隔離它(committed、跨 session 可見)
  q "ALTER TABLE public.order_item_procurement DISABLE TRIGGER order_item_procurement_summary_recompute_zc" >/dev/null
  # 🔴 等長同形消融(code-reviewer MF2/MF3):與 run_race 完全同交錯 —— A 開 txn 插 3、
  #    B raw 併發插 3、A 最後才 COMMIT;差別只在斷言方向:短窗 barrier 必須「等不到」
  #    (= barrier 斷言在無鎖版真的會失敗、非恆真),且 B 在 A 交易仍開著時就完成。
  open2
  sa "BEGIN;"
  sa "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SA',3);"
  outb_mark
  sb_raw "$INS_B3"
  if wait_blocked_by b a 8 1; then
    bad "[S3] 消融腿:B 竟然被 A 擋住(鎖還在?)"
  else
    ok "[S3] 消融腿:短窗內 B 未被 A 擋(barrier 斷言在無鎖版會失敗 = 非恆真)"
  fi
  wait_idle b
  B_DONE_WHILE_A_OPEN=0
  outb_since | grep -q 'INSERT 0 1' && B_DONE_WHILE_A_OPEN=1
  sa "COMMIT;"
  close2
  if [ "$B_DONE_WHILE_A_OPEN" = "1" ] \
     && [ "$(q "SELECT COALESCE(sum(allocated_quantity),0) FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "6" ]; then
    ok "[S3] 無鎖版 B 在 A 交易開著時就完成 ⇒ 終態 6 > 5 超量真的發生(鎖是承重的)"
  else
    bad "[S3] 消融後未觀察到超量:$(outb_since | grep -m1 -E 'ERROR|INSERT' | cut -c1-140)"
  fi
  q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" >/dev/null
  [ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[S3] 消融腿已清回基準" || bad "[S3] 消融腿殘留"
else
  MUT=$((MUT+1))
  bad "[S3] mutant 套用失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
  bad "[S3](消融腿 barrier 觀察未執行)"
  bad "[S3](消融觀察未執行)"
  bad "[S3](清理檢查未執行)"
fi
q "ALTER TABLE public.order_item_procurement ENABLE TRIGGER order_item_procurement_summary_recompute_zc" >/dev/null
psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
RC=$?
if [ "$RC" -eq 0 ] && [ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" = "$FNMD5_0" ] \
   && [ "$(q "SELECT tgenabled FROM pg_trigger WHERE tgname='order_item_procurement_summary_recompute_zc' AND NOT tgisinternal")" = "O" ]; then
  MUTATED=0
  ok "[S3] 還原完成(rc=0、md5 = 基準;A4a zc trigger enabled 復歸 O)"
else
  bad "[S3] 還原失敗(rc=$RC)—— 旗未降,EXIT trap 會再試"
fi
run_race 3
outb_since | grep -q 'P2B01' \
  && ok "[S3] 還原後同交錯重跑 ⇒ B 又紅在 P2B01(消融有判別力、非環境巧合)" \
  || bad "[S3] 還原後重跑未紅"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "[S3] 重跑腿已清回基準" || bad "[S3] 重跑腿殘留"

echo
echo "== S4 跨 session delta:A committed 取消 2 ⇒ B 開 4 紅、開 3 過 =="
cell 1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000b1'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b2-s4'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000b1'::uuid, '$ORDER_ID', '$ITEM', 2);
COMMIT;
SQL
)"
[ $? -eq 0 ] && ok "[S4] 取消 2 已 committed(另一 session 的既成事實)" \
  || bad "[S4] 取消 fixture 失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
ST="$(sqlstate_of "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SA',4)")"
[ "$ST" = "P2B01" ] && ok "[S4] 開 4 紅在 P2B01(守門看見別 session 的 committed 取消)" \
  || bad "[S4] 開 4 未紅在 P2B01(state=$ST)"
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SA',3)" | grep -q 'INSERT 0 1' \
  && ok "[S4] 開 3 過(row 29 delta 負測跨 session 版)" || bad "[S4] 開 3 竟被擋"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "BEGIN" -c "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" -c "DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM'" -c "DELETE FROM public.order_cancellations WHERE order_id='$ORDER_ID'" -c "COMMIT" >/dev/null 2>&1 \
  && ok "[S4] 已清(proc + 取消兩表)" || bad "[S4] 清理失敗"

echo
echo "== S5 🔀 契約債⑥已關閉(A4a):A 未提交取消 2 ⇒ B 滿額 5 被 A 擋、A commit 後 B 紅 P2B01 =="
# 原版(2026-08-03 凌晨)證「窗口存在」:B 放行、終態超量。A4a 對 order_cancellation_items
# 掛同一把 parent NKU 後,窗口物理關閉 —— 本格期望翻紅 = nightly handoff 終章既定事項②兌現。
cell 1
open2
sa "BEGIN;"
sa "INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor) VALUES ('bbbbbbbb-0000-0000-0000-0000000000b2'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b2-s5'::bytea),'hex'), '$STAFF');"
sa "INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity) VALUES ('bbbbbbbb-0000-0000-0000-0000000000b2'::uuid, '$ORDER_ID', '$ITEM', 2);"
outb_mark
sb_raw "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SB',5);"
wait_blocked_by b a && ok "[S5] B 被 A 擋住且 pg_blocking_pids(B) 恰含 A(取消側的鎖 = A4a 關窗的那把)" \
  || bad "[S5] B 沒有被 A 擋住(契約債⑥竟仍開著?)"
sa "COMMIT;"
wait_idle b
close2
if outb_since | grep -q 'P2B01' && outb_since | grep -q 'A2b1 超量'; then
  ok "[S5] A commit 後 B 紅在 P2B01(鎖後重讀看到取消 2 ⇒ 5 > 5−2)"
else
  bad "[S5] B 未紅在 P2B01:$(outb_since | grep -m1 -E 'ERROR|INSERT' | cut -c1-140)"
fi
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM'")" = "0" ] \
  && ok "[S5] 終態零採購列 —— 超量態不再可達(原版的超量終態已不可構造)" \
  || bad "[S5] 終態竟有採購列(窗口沒關死?)"
ST5="$(sqlstate_of "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM','$SA',4)")"
[ "$ST5" = "P2B01" ] \
  && ok "[S5] 場景內對照:committed 取消 2 之後開 4 必紅 P2B01(守門活著、delta 正確)" \
  || bad "[S5] 對照失敗:開 4 沒被攔(state=$ST5)"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "BEGIN" -c "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM'" -c "DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM'" -c "DELETE FROM public.order_cancellations WHERE order_id='$ORDER_ID'" -c "COMMIT" >/dev/null 2>&1 \
  && ok "[S5] 已清" || bad "[S5] 清理失敗"

echo
echo "== 零留痕收尾 =="
[ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" = "$FNMD5_0" ] && ok "函式 md5 = 基準" || bad "函式 md5 被改"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9996-0001'" 2>&1)"
[ $? -eq 0 ] && ok "fixture 訂單已刪(CASCADE 帶走 item)" || bad "fixture 刪除失敗:$(printf '%s' "$o" | head -1 | cut -c1-140)"
[ "$(q "SELECT count(*) FROM public.orders")" = "$ORDERS_N0" ] && ok "orders 回基準 $ORDERS_N0" || bad "orders 污染"
[ "$(q "SELECT count(*) FROM public.order_items")" = "$ITEMS_N0" ] && ok "order_items 回基準(N8:不再只靠 CASCADE 的外部事實)" || bad "order_items 污染"
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "procurement 回基準" || bad "procurement 污染"
[ "$(q "SELECT count(*) FROM public.order_cancellation_items")" = "$CANC_N0" ] && ok "cancellation_items 回基準" || bad "canc 污染"
[ "$(q "SELECT count(*) FROM public.order_cancellations")" = "$HDR_N0" ] && ok "cancellations 回基準" || bad "hdr 污染"

echo
echo "== 誠實邊界 =="
echo "   🔴 收尾 md5 只蓋 pg_get_functiondef、不含 proacl/proowner(S3 用 CREATE OR REPLACE 保留
      ACL 故低風險);ACL/owner 的完整重驗分工給兄弟序列的 a2b1-verify(A5/A6/A10 格)—— N9 挑明。"
echo "   🔀 S5 已於 2026-08-03 隨 A4a 落地翻紅:現在證的是「洞被 A4a 的取消側 NKU 關閉」;"
echo "      原「窗口存在」版本保留在 git 歷史(nightly a2b1-chain 交接檔終章)。"
echo "   🔴 S3 是唯一 committed 函式突變;還原以 md5 比對、trap 兜底。"
echo "   🔴 本 harness 在 shim 角色圖 + 本機 PG17;PostgREST 層與正式站 runtime 不在證明範圍。"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL / 格 CELL=$CELL / 突變 MUT=$MUT =="
echo "   釘數:EXPECTED_TOTAL=$EXPECTED_TOTAL EXPECTED_CELL=$EXPECTED_CELL EXPECTED_MUT=$EXPECTED_MUT"
count_gate "$EXPECTED_TOTAL" "$((PASS+FAIL))" || { echo "🔴 總數 $((PASS+FAIL)) ≠ $EXPECTED_TOTAL"; exit 1; }
count_gate "$EXPECTED_CELL" "$CELL" || { echo "🔴 CELL $CELL ≠ $EXPECTED_CELL"; exit 1; }
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 MUT $MUT ≠ $EXPECTED_MUT"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
echo "🎉 A2b2 concurrency probe 全綠"
