#!/usr/bin/env bash
# ============================================================
# A8c1 驗證 harness:begin_charge_attempt 金流 begin 側取消守門
# ============================================================
# plan = docs/specs/2026-08-04-e10-a8c1-begin-cancel-guard-plan.md(v6)§5
# 用法:先 provision(d1t2-rehearsal 家族、port 54331 副本),再 scripts/a8c1-verify.sh /tmp/a8c-work
# 形狀照 a2b1-verify.sh:身分閘 + BEGIN…ROLLBACK 零留痕 + DB 內突變 + 計數閘。
# committed 例外全集 = {C4a, C4b, C5, E1, L1, L2, L3a, L3b, L4, L4b, M5示範}(各自清理+殘留斷言;plan §5.2)。
# 🔴 突變矩陣語意:每個 mutant 跑滿 19 格 vector,逐格與期望紅綠比對,多紅/少紅皆 FAIL。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a8c-work}"
PORT="${A8C1_VERIFY_PORT:-54331}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C
MIGFILE="supabase/migrations/20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql"
MIG0C="supabase/migrations/20260613140000_m3_3ds_0c_bank_txn_pending_invoices.sql"
MD5_0C="55e32431df7af3ab6eefa18555af9e6b"
MD5_NEW="f621a56231e20f7f0b2618b40ac1276d"
GENERIC="begin_charge_attempt: 付款處理失敗"

PASS=0; FAIL=0
EXPECTED_TOTAL=38
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q() { psql "$URL" -qtAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(marker + datadir + db 名 + RC + lc_messages + A8c1 已套)──────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC 預設;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
CUR_MD5="$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")"
[ "$CUR_MD5" = "$MD5_NEW" ] || { echo "🔴 begin 現定義非 A8c1 新版(md5=$CUR_MD5);先 provision 含本片;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id LIKE 'PCM-999%'")" = "0" ] \
  || { echo "🔴 殘留 PCM-999* fixture(前輪未清);拒跑"; exit 1; }
ok "身分閘六重(含 A8c1 已套 md5、零殘留 fixture)"

CUST="$(q "SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1")"
[ -n "$CUST" ] || { echo "🔴 customers 空;拒跑"; exit 1; }

# ── 九表零留痕基線 ─────────────────────────────────────────
NINE="orders order_items payment_charge_attempts order_cancellations order_cancellation_items order_item_quantity_summary payment_double_charge_anomalies staff customers"
snap9() {
  local t n
  for t in $NINE; do
    n="$(q "SELECT count(*) FROM public.$t")"
    case "$n" in ''|*[!0-9]*) echo "🔴 snap9:$t 計數非數值($n);硬停" >&2; exit 1;; esac
    printf '%s=%s ' "$t" "$n"
  done
}
BASE9="$(snap9)" || { echo "🔴 snap9 基線失敗;拒跑"; exit 1; }

# ── §5.3 差分 oracle:REPLACE 回 0c → fdef A → 重放 migration → fdef B → diff=黃金 ──
[ "$(grep -c 'CREATE OR REPLACE FUNCTION public.begin_charge_attempt' "$MIGFILE")" = "1" ] \
  && ok "§5.3② migration 檔內 begin 定義恰 1 次" || bad "§5.3② 定義次數異常"
awk '/^CREATE OR REPLACE FUNCTION public.begin_charge_attempt/,/^\$fn\$;$/' "$MIG0C" > "$WORK/body-0c.sql"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/body-0c.sql" >/dev/null 2>&1 \
  || { bad "§5.3 REPLACE 回 0c 失敗"; exit 1; }
q "SELECT pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure)" > "$WORK/fdef-A.txt"
[ "$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")" = "$MD5_0C" ] \
  && ok "§5.3 基線=0c(md5)" || { bad "§5.3 基線非 0c"; exit 1; }
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1 \
  && ok "§5.3 migration 重放成功(含前置閘四 md5)" || { bad "§5.3 migration 重放失敗"; exit 1; }
q "SELECT pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure)" > "$WORK/fdef-B.txt"
[ "$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "§5.3④ 重放後 md5=新版封條" || bad "§5.3④ md5 不符"
diff -u "$WORK/fdef-A.txt" "$WORK/fdef-B.txt" | tail -n +3 > "$WORK/fdef-actual.diff"
cat > "$WORK/fdef-golden.diff" <<'GOLDEN'
@@ -15,24 +15,39 @@
   v_dup_bank     text;  -- 🔴 3DS-0c 新增(needs_settle 帶 existing_bank_transaction_id)
   v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';  -- PF-E 通用訊息
 BEGIN
+  -- 🔴 A8c1 隔離閘(fail-closed;A2b1 同款教訓):非 READ COMMITTED 下,FOR UPDATE 等鎖醒來後
+  --    快照仍舊、部分取消不動 orders 列不觸發 RR 序列化錯誤 ⇒ EXISTS 看不到已 commit 取消。
+  --    正常呼叫端(PgChargeAttemptAdapter 單語句 autocommit)恆 RC、不受影響。
+  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
+    RAISE EXCEPTION 'begin_charge_attempt: isolation guard' USING ERRCODE = 'P8C01';
+  END IF;
+
   -- 訂單存在 + 取歸屬 + cart_session_id(customer_user_id/cart_session_id 從 orders 讀、零信任參數)
-  SELECT id, customer_user_id, payment_status, cart_session_id
+  SELECT id, customer_user_id, payment_status, cart_session_id, cancelled_at
     INTO v_order
     FROM public.orders
-   WHERE id = p_order_id;
+   WHERE id = p_order_id
+     FOR UPDATE;
   IF NOT FOUND THEN
     RAISE EXCEPTION '%', v_generic_msg;
   END IF;
 
+  -- 🔴 A8c1 取消守門(master plan row 34;R8 部署序=守門先於取消):存在任何取消紀錄 ⇒ 拒開卡。
+  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約:守門不讀摘要表);
+  --    互斥保證=上方 FOR UPDATE 與取消 RPC(A8a1/A8a2 依 §5.0 合約)同鎖;通用訊息=PF-E。
+  IF v_order.cancelled_at IS NOT NULL
+     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
+    RAISE EXCEPTION '%', v_generic_msg;
+  END IF;
+
   -- 🔴 3DS-0b fail-closed:cart_session_id 必有(5-param create_order 入口強制寫;舊 4-param 已 DROP → 無無 key 單)
   IF v_order.cart_session_id IS NULL THEN
     RAISE EXCEPTION '%', v_generic_msg;
   END IF;
 
   -- 已 paid / refunded / partiallyPaid → 不開新 charge(與撞鎖同層級回覆、不洩具體狀態)
-  -- 此讀無 row lock:與並發 confirm 有理論 race(檢查後翻 paid → 為已 paid 單插 pending row),
-  -- 後果僅該單持 per-order 鎖(fail-closed、②-⑥ 對帳可解)、閘 join orders 已 paid 放行不誤卡、
-  -- 零雙扣路徑;②-③c 編排層知悉(code-reviewer 2026-06-12 觀察)。
+  -- 🔴 A8c1 起本讀持 FOR UPDATE 列鎖:0c 自陳的「檢查後翻 paid」理論 race 已被鎖關閉
+  --    (與 confirm 的 PF-B 同鎖全序列化;舊註解「此讀無 row lock」自本片起不再為真)。
   IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
     RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
   END IF;
GOLDEN
if diff -q "$WORK/fdef-actual.diff" "$WORK/fdef-golden.diff" >/dev/null; then
  ok "§5.3① 庫內物件差分=黃金 diff(byte-exact、零正規化)"
else
  bad "§5.3① 差分與黃金不符:"; diff "$WORK/fdef-golden.diff" "$WORK/fdef-actual.diff" | head -20
fi

# ── §5.3⑥ 三支 COMMENT post-oracle + begin COMMENT ──────────────
cmtmd5() { q "SELECT md5(obj_description('$1'::regprocedure, 'pg_proc'))"; }
# 🔴 md5 pin 全文(codex 關卡2:子字串比對抓不到倒寫與錯字)
[ "$(cmtmd5 'public.begin_charge_attempt(uuid)')" = "95569ce8d85dc38c0e95acf6e204d5d6" ] \
  && ok "COMMENT begin=新字面(md5 pin)" || bad "COMMENT begin md5 不符"
[ "$(cmtmd5 'public.mark_charge_attempt_failed(uuid,uuid)')" = "2015836900b9ecb5d017cdd9e85a3469" ] \
  && ok "COMMENT mark_failed=新字面(md5 pin)" || bad "COMMENT mark_failed md5 不符"
[ "$(cmtmd5 'public.mark_charge_attempt_charged(uuid,uuid,text)')" = "821aa6cb7feafeccd7509085e2433ffa" ] \
  && ok "COMMENT mark_charged=新字面(md5 pin)" || bad "COMMENT mark_charged md5 不符"
[ "$(cmtmd5 'public.close_released_attempt(uuid,text)')" = "921aff9a38368d3c512ac69cb71fe0e1" ] \
  && ok "COMMENT close_released=新字面(md5 pin)" || bad "COMMENT close_released md5 不符"

# ── §3.8 前置閘負向格(code-reviewer nit#6:證閘抓得到漂移)────────────
q "SELECT pg_get_functiondef('public.mark_charge_attempt_failed(uuid,uuid)'::regprocedure)" > "$WORK/fdef-mf.txt"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/body-0c.sql" >/dev/null 2>&1
python3 - "$WORK/fdef-mf.txt" "$WORK/fdef-mf-mut.txt" <<'PYNEG'
import sys
s=open(sys.argv[1]).read()
a="BEGIN\n"
assert s.count(a)>=1
open(sys.argv[2],'w').write(s.replace(a,"BEGIN\n  -- md5gate-negative probe\n",1))
PYNEG
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/fdef-mf-mut.txt" >/dev/null 2>&1
NEGOUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"
NEGRC=$?
if [ "$NEGRC" -ne 0 ] && printf '%s' "$NEGOUT" | grep -q 'mark_charge_attempt_failed 定義漂移'; then
  ok "前置閘負向格:mark_failed 漂移 ⇒ migration RAISE 拒跑"
else
  bad "前置閘負向格:rc=$NEGRC 未紅在漂移閘"
fi
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/fdef-mf.txt" >/dev/null 2>&1
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1
[ "$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")" = "$MD5_NEW" ] \
  && [ "$(q "SELECT md5(pg_get_functiondef('public.mark_charge_attempt_failed(uuid,uuid)'::regprocedure))")" = "fd87db5732a12c4688babc6a46c1e508" ] \
  && ok "前置閘負向格還原(begin=新版、mark_failed=已知值)" || bad "前置閘負向格還原失敗"

# ── §6-9 剝殼交易模擬格(收編;A7 實錘=檔內 COMMIT 會擊穿模擬,必剝殼)────
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/body-0c.sql" >/dev/null 2>&1
grep -vE "^BEGIN;$|^COMMIT;$" "$MIGFILE" > "$WORK/mig-stripped.sql"
STRIPOUT="$( (echo "BEGIN;"; cat "$WORK/mig-stripped.sql"; echo "ROLLBACK;") | psql "$URL" -v ON_ERROR_STOP=1 -qtAX 2>&1)"
STRIPRC=$?
MD5AFTER="$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")"
if [ "$STRIPRC" -eq 0 ] && [ "$MD5AFTER" = "$MD5_0C" ]; then
  ok "§6-9 剝殼模擬:全文+斷言於單交易通過、ROLLBACK 後零留痕(md5=0c)"
else
  bad "§6-9 剝殼模擬 rc=$STRIPRC md5=$MD5AFTER — $(printf '%s' "$STRIPOUT" | grep -m1 ERROR | cut -c1-140)"
fi
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1
[ "$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "§6-9 還原(begin=新版)" || bad "§6-9 還原失敗"

# ── fixture SQL 片段(每格自帶;in-tx 格共用 prelude)────────────────
# mkord <psql-var-prefix> <display> [cart]:插單(subtotal=100 平衡);回傳 id 於 :oid
FIX_ORDER="INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES (:'disp', :'cust', jsonb_build_object('name','a8c1','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), :'cart'::uuid)
RETURNING id"

# cell_intx <label> <sql-body>:BEGIN…ROLLBACK 包裹;body 內以 RAISE NOTICE 'CELLOK' 表通過。
cell_intx() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -v cust="$CUST" -qtAX <<SQL 2>&1
BEGIN;
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'CELLOK'; then return 0
  else CELL_ERR="$(printf '%s' "$out" | grep -m1 -E 'ERROR|CELLFAIL' | cut -c1-160)"; return 1; fi
}

# 期望通用 RAISE 的 DO 樣板:呼 begin、必吃到 GENERIC 訊息
EXPECT_RAISE="DO \$c\$
DECLARE v jsonb;
BEGIN
  BEGIN
    v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
    RAISE EXCEPTION 'CELLFAIL 未 RAISE(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'begin_charge_attempt: 付款處理失敗' THEN RAISE NOTICE 'CELLOK';
    ELSE RAISE; END IF;
  END;
END \$c\$;"

# ── 19 格 vector(S1-S8 + C1,C2,C3,C4a,C4b,C5,C6,C7,C8,C9a,C9b)──────
echo 0 > "$WORK/.dispcnt"
next_disp() {  # 檔案型計數器:$( ) subshell 內呼叫也能全域遞增
  local n; n="$(cat "$WORK/.dispcnt")"; n=$((n+1)); echo "$n" > "$WORK/.dispcnt"
  printf 'PCM-9992-%04d' "$n"
}

cell_S() {  # $1=情境代號
  local s="$1" frag="" d2="" d3=""
  local CALL="DO \$c\$ DECLARE v jsonb; BEGIN v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp'))); END \$c\$;"
  case "$s" in
    1) d2="$(next_disp)"
       frag="UPDATE public.orders SET payment_status='paid', paid_at=now(), tappay_rec_trade_id='RECS1' || :'disp' WHERE id=:'o_id';
\set disp $d2
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF v->>'reason'='duplicate' AND (v->>'existing_paid')::boolean THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF; END \$c\$;" ;;
    2) d2="$(next_disp)"
       frag="$CALL
UPDATE public.payment_charge_attempts SET status='charged', rec_trade_id='RECS2' || :'disp', bank_transaction_id='BANKS2A8C1' WHERE order_id=:'o_id';
\set disp $d2
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF v->>'reason'='needs_settle' AND v->>'existing_bank_transaction_id'='BANKS2A8C1' THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF; END \$c\$;" ;;
    3) d2="$(next_disp)"
       frag="$CALL
\set disp $d2
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF v->>'reason'='needs_settle' AND (v->'existing_rec_trade_id')::text='null' AND (v->'existing_bank_transaction_id')::text='null' THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF; END \$c\$;" ;;
    4) d2="$(next_disp)"
       frag="$CALL
\set disp $d2
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF v->>'reason'='user_in_flight' THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF; END \$c\$;" ;;
    5) frag="DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF (v->>'acquired')::boolean AND v->>'fallback_token' IS NOT NULL
     AND (SELECT count(*) FROM public.payment_charge_attempts a JOIN public.orders o ON o.id=a.order_id WHERE o.display_id=current_setting('a8c1.disp'))=1
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF; END \$c\$;" ;;
    6) frag="UPDATE public.orders SET cart_session_id=NULL WHERE id=:'o_id';
$EXPECT_RAISE" ;;
    7) frag="INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES (:'o_id', :'cust', public.charge_attempt_token_hash(gen_random_uuid()));
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF v->>'reason'='order_locked' THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF; END \$c\$;" ;;
    8) d2="$(next_disp)"; d3="$(next_disp)"
       frag="$CALL
UPDATE public.payment_charge_attempts SET status='charged', rec_trade_id='RECS8' || :'disp', bank_transaction_id='BANKS8A8C1' WHERE order_id=:'o_id';
\set disp $d2
$FIX_ORDER \gset p2_
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES (:'p2_id', :'cust', public.charge_attempt_token_hash(gen_random_uuid()));
\set disp $d3
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF v->>'reason'='needs_settle' AND v->>'existing_bank_transaction_id'='BANKS8A8C1' THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL %(charged 應優先於 pending)', v; END IF; END \$c\$;" ;;
  esac
  cell_intx "S$s" "
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset o_
$frag
"
}

cell_C1() { cell_intx C1 "
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset o_
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id=:'o_id';
$EXPECT_RAISE"; }

_c2_common() { echo "
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset o_
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'o_id', 'A8C1-' || :'disp', jsonb_build_object('title','a8c1','sku','A8C1','spec',jsonb_build_object()), 2, 0, 0)
RETURNING id \gset i_
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'o_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256((:'disp')::bytea),'hex'))
RETURNING id \gset h_"; }

cell_C2() { cell_intx C2 "$(_c2_common)
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES (:'h_id', :'o_id', :'i_id', 1);
$EXPECT_RAISE"; }

cell_C2b() { cell_intx C2b "$(_c2_common)
$EXPECT_RAISE"; }

cell_C3() { cell_intx C3 "
DO \$pf\$ BEGIN IF (SELECT count(*) FROM public.order_cancellations) <> 0 THEN
  RAISE EXCEPTION 'CELLFAIL preflight:cancellations 殘留(環境髒)'; END IF; END \$pf\$;
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset o_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF (v->>'acquired')::boolean THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF;
END \$c\$;"; }

cell_C6() { cell_intx C6 "
DO \$pf\$ BEGIN IF (SELECT count(*) FROM public.order_cancellations) <> 0 THEN
  RAISE EXCEPTION 'CELLFAIL preflight:cancellations 殘留(環境髒)'; END IF; END \$pf\$;
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.other', :'disp', true);
$FIX_ORDER \gset x_
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'x_id', 'A8C1C6-' || :'disp', jsonb_build_object('title','a8c1','sku','A8C1','spec',jsonb_build_object()), 1, 0, 0)
RETURNING id \gset xi_
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'x_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256((:'disp' || '6')::bytea),'hex'))
RETURNING id \gset xh_
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES (:'xh_id', :'x_id', :'xi_id', 1);
\set disp2 $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp2', true);
\set disp :disp2
$FIX_ORDER \gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF (v->>'acquired')::boolean THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL 他單取消誤傷本單 %', v; END IF;
END \$c\$;"; }

cell_C7() { cell_intx C7 "
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset o_
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消',
       payment_status='paid', paid_at=now(), tappay_rec_trade_id='RECC7' || :'disp' WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_C8() { cell_intx C8 "
\set disp $(next_disp)
\set cart '$(uuidgen | tr 'A-Z' 'a-z')'
SELECT set_config('a8c1.disp', :'disp', true);
$FIX_ORDER \gset o_
SAVEPOINT sp_cancel;
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id=:'o_id';
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'o_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256((:'disp' || '8')::bytea),'hex'));
ROLLBACK TO SAVEPOINT sp_cancel;
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.begin_charge_attempt((SELECT id FROM public.orders WHERE display_id = current_setting('a8c1.disp')));
  IF (v->>'acquired')::boolean THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL 回滾的取消不應擋 %', v; END IF;
END \$c\$;"; }

cell_C9() {  # $1=a|b
  local lvl="REPEATABLE READ"; [ "$1" = "b" ] && lvl="SERIALIZABLE"
  local out state
  out="$(psql "$URL" -qtAX -c "\set VERBOSITY verbose" \
        -c "BEGIN TRANSACTION ISOLATION LEVEL $lvl;" \
        -c "SELECT public.begin_charge_attempt('00000000-0000-4000-8000-0000000000a1');" \
        -c "ROLLBACK;" 2>&1)"
  state="$(printf '%s' "$out" | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1)"
  if [ "$state" = "P8C01" ]; then return 0
  else CELL_ERR="C9$1 期望 P8C01 實得 [$state] $(printf '%s' "$out" | head -1 | cut -c1-100)"; return 1; fi
}

# ── committed 併發格(C4a/C4b/C5;pg_blocking_pids barrier)────────────
wait_blocked_by() {  # $1=waiter app_name $2=blocker app_name $3=timeout_s;回 0=觀察到
  local i=0
  while [ $i -lt $((10*$3)) ]; do
    local n
    n="$(q "SELECT count(*) FROM pg_stat_activity w JOIN LATERAL unnest(pg_blocking_pids(w.pid)) b(bp) ON true
            JOIN pg_stat_activity h ON h.pid=b.bp
            WHERE w.application_name='$1' AND h.application_name='$2'")"
    [ "$n" -ge 1 ] 2>/dev/null && return 0
    sleep 0.1; i=$((i+1))
  done
  return 1
}

CLEANUP_FAIL=0
cleanup_disp() {  # $1=display_id …:刪其 attempts/cancellation items/headers/items/order;錯誤必浮面
  local d out
  for d in "$@"; do
    out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX <<SQL 2>&1
DO \$x\$
DECLARE v_o uuid;
BEGIN
  SELECT id INTO v_o FROM public.orders WHERE display_id='$d';
  IF v_o IS NULL THEN RETURN; END IF;
  DELETE FROM public.order_cancellation_items WHERE order_id=v_o;
  DELETE FROM public.order_cancellations WHERE order_id=v_o;
  DELETE FROM public.payment_double_charge_anomalies WHERE old_order_id=v_o;
  DELETE FROM public.payment_charge_attempts WHERE order_id=v_o;
  DELETE FROM public.order_item_quantity_summary s USING public.order_items i WHERE s.order_item_id=i.id AND i.order_id=v_o;
  DELETE FROM public.order_items WHERE order_id=v_o;
  DELETE FROM public.orders WHERE id=v_o;
END \$x\$;
SQL
)"
    if [ $? -ne 0 ]; then CLEANUP_FAIL=1; echo "  🔴 cleanup($d) 失敗:$(printf '%s' "$out" | grep -m1 ERROR | cut -c1-120)"; fi
    [ "$(q "SELECT count(*) FROM public.orders WHERE display_id='$d'")" = "0" ] \
      || { CLEANUP_FAIL=1; echo "  🔴 cleanup($d):order 列仍在"; }
  done
}

mkord_committed() {  # $1=display [$2=cancelled(full)] → stdout order_id;含 1 item
  psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL
WITH o AS (
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
  VALUES ('$1', '$CUST', jsonb_build_object('name','a8c1','phone','0900000000','line','x'),
    'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
  RETURNING id
), i AS (
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT id, 'A8C1CC-' || '$1', jsonb_build_object('title','a8c1','sku','A8C1','spec',jsonb_build_object()), 2, 0, 0 FROM o
  RETURNING order_id
)
SELECT DISTINCT order_id FROM i;
SQL
}

cell_C4() {  # $1=a(整單)|b(部分)
  local mode="$1" D O RC out extra="" APPC="a8c1_c4c_$RANDOM$$" APPB="a8c1_c4b_$RANDOM$$"
  D="$(next_disp)"; O="$(mkord_committed "$D")"
  [ "$mode" = "a" ] && extra="UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id='$O';"
  psql "$URL?application_name=$APPC" -v ON_ERROR_STOP=1 -qtAX <<SQL >/dev/null 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O' FOR UPDATE;
$extra
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES ('$O', 'sean', gen_random_uuid(), 'customer_request', encode(sha256(('c4$mode-$D')::bytea),'hex'));
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT c.id, '$O', i.id, 1 FROM public.order_cancellations c, public.order_items i
 WHERE c.order_id='$O' AND i.order_id='$O' LIMIT 1;
SELECT pg_sleep(3);
COMMIT;
SQL
  local APID=$!
  sleep 0.5
  psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -tAX \
    -c "SELECT public.begin_charge_attempt('$O')" > "$WORK/c4$mode.out" 2>&1 &
  local BPID=$!
  local BARRIER=1
  wait_blocked_by "$APPB" "$APPC" 3 && BARRIER=0
  wait $BPID; RC=$?
  wait $APID
  out="$(cat "$WORK/c4$mode.out")"
  local RES=1
  if [ "$BARRIER" -eq 0 ] && [ "$RC" -ne 0 ] && printf '%s' "$out" | grep -q "$GENERIC"; then RES=0
  else CELL_ERR="C4$mode barrier=$BARRIER rc=$RC out=$(printf '%s' "$out" | head -1 | cut -c1-120)"; fi
  cleanup_disp "$D"
  return $RES
}

cell_C5() {
  local D O RC out APPB5="a8c1_c5b_$RANDOM$$" APPC5="a8c1_c5c_$RANDOM$$"
  D="$(next_disp)"; O="$(mkord_committed "$D")"
  psql "$URL?application_name=$APPB5" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/c5a.out" 2>&1 &
BEGIN;
SELECT public.begin_charge_attempt('$O');
SELECT pg_sleep(3);
COMMIT;
SQL
  local XPID=$!
  sleep 0.5
  psql "$URL?application_name=$APPC5" -v ON_ERROR_STOP=1 -tAX <<SQL > "$WORK/c5b.out" 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O' FOR UPDATE;
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.payment_charge_attempts WHERE order_id='$O' AND status IN ('pending','charged'))
       THEN 'ALLOWEDSET_REJECT' ELSE 'ALLOWEDSET_PASS' END;
ROLLBACK;
SQL
  local YPID=$!
  local BARRIER=1
  wait_blocked_by "$APPC5" "$APPB5" 3 && BARRIER=0
  wait $YPID; wait $XPID
  local RES=1
  local C5DL
  C5DL="$(grep -c 'deadlock detected' "$WORK/c5a.out" "$WORK/c5b.out" | awk -F: '{t+=$2} END{print t}')"
  if [ "$BARRIER" -eq 0 ] && [ "$C5DL" = "0" ] && grep -q 'acquired.*true' "$WORK/c5a.out" && grep -q 'ALLOWEDSET_REJECT' "$WORK/c5b.out"; then RES=0
  else CELL_ERR="C5 barrier=$BARRIER a=$(head -1 "$WORK/c5a.out" | cut -c1-80) b=$(grep -m1 ALLOWEDSET "$WORK/c5b.out")"; fi
  cleanup_disp "$D"
  return $RES
}

run_vector() {  # 輸出 19 位 1/0(順序 S1-8, C1,C2,C3,C4a,C4b,C5,C6,C7,C8,C9a,C9b)
  # preflight(plan §5.2):取消殘留=環境壞、當場硬停,不讓 C3/C6 紅集漂移誤診
  [ "$(q "SELECT count(*) FROM public.order_cancellations")" = "0" ] \
    || { echo "🔴 run_vector preflight:order_cancellations 殘留;環境髒、硬停"; exit 1; }
  local v=""
  for s in 1 2 3 4 5 6 7 8; do cell_S "$s" && v="${v}1" || v="${v}0"; done
  cell_C1 && v="${v}1" || v="${v}0"
  cell_C2 && v="${v}1" || v="${v}0"
  cell_C3 && v="${v}1" || v="${v}0"
  cell_C4 a && v="${v}1" || v="${v}0"
  cell_C4 b && v="${v}1" || v="${v}0"
  cell_C5 && v="${v}1" || v="${v}0"
  cell_C6 && v="${v}1" || v="${v}0"
  cell_C7 && v="${v}1" || v="${v}0"
  cell_C8 && v="${v}1" || v="${v}0"
  cell_C9 a && v="${v}1" || v="${v}0"
  cell_C9 b && v="${v}1" || v="${v}0"
  printf '%s' "$v"
}

# ── 基線 vector(19 格全綠)+ C2b ─────────────────────────────
echo "== 基線 19 格 vector(S1-S8 + C×11)=="
BASE_VEC="$(run_vector)"
if [ "$BASE_VEC" = "1111111111111111111" ]; then ok "基線 vector 全綠($BASE_VEC)"
else bad "基線 vector=$BASE_VEC(最後錯誤:${CELL_ERR:-})"; fi
cell_C2b && ok "C2b header-only(合成態)→ RAISE(來源表判別)" || bad "C2b — ${CELL_ERR:-}"

# ── E1:55P03 面 ─────────────────────────────────────────
D_E1="$(next_disp)"; O_E1="$(mkord_committed "$D_E1")"
psql "$URL?application_name=a8c1_holder" -qtAX <<SQL >/dev/null 2>&1 &
BEGIN; SELECT id FROM public.orders WHERE id='$O_E1' FOR UPDATE; SELECT pg_sleep(4); ROLLBACK;
SQL
HPID=$!
sleep 0.5
E1OUT="$(psql "$URL" -qtAX -c "\set VERBOSITY verbose" -c "SET lock_timeout='1s'" \
  -c "SELECT public.begin_charge_attempt('$O_E1')" 2>&1)"
E1STATE="$(printf '%s' "$E1OUT" | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1)"
E1N="$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O_E1'")"
wait $HPID
[ "$E1STATE" = "55P03" ] && [ "$E1N" = "0" ] && ok "E1 55P03 面(逾時+attempts 零新列)" \
  || bad "E1 state=$E1STATE attempts=$E1N"
cleanup_disp "$D_E1"

# ── L 格 ───────────────────────────────────────────────
# L1 判別力:先插 child 取 KEY SHARE、再升級 FOR UPDATE → 40P01 必現
psql "$URL" -qtAX -c "CREATE TABLE public._a8c1_probe (id serial PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id))" >/dev/null
D_L1="$(next_disp)"; O_L1="$(mkord_committed "$D_L1")"
l1run() { psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
INSERT INTO public._a8c1_probe (order_id) VALUES ('$O_L1');
SELECT pg_sleep(2);
SELECT id FROM public.orders WHERE id='$O_L1' FOR UPDATE;
ROLLBACK;
SQL
}
l1run > "$WORK/l1a.out" 2>&1 & P1=$!
l1run > "$WORK/l1b.out" 2>&1 & P2=$!
wait $P1; wait $P2
DL="$(grep -l 'deadlock detected' "$WORK/l1a.out" "$WORK/l1b.out" 2>/dev/null | wc -l | tr -d ' ')"
[ "$DL" -ge 1 ] && ok "L1 判別力:升級形狀 40P01 必現" || bad "L1 未觀察到 40P01"
psql "$URL" -qtAX -c "DROP TABLE public._a8c1_probe" >/dev/null

# L2 lock-first 無死結(begin 樣式 vs cancel 樣式)
psql "$URL" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/l2a.out" 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O_L1' FOR UPDATE;
SELECT pg_sleep(2);
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES ('$O_L1', '$CUST', public.charge_attempt_token_hash(gen_random_uuid()));
ROLLBACK;
SQL
P1=$!
sleep 0.5
psql "$URL" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/l2b.out" 2>&1
BEGIN;
SELECT id FROM public.orders WHERE id='$O_L1' FOR UPDATE;
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES ('$O_L1', 'sean', gen_random_uuid(), 'customer_request', encode(sha256('l2'::bytea),'hex'));
ROLLBACK;
SQL
RCB=$?
wait $P1; RCA=$?
NODL="$(grep -c 'deadlock detected' "$WORK/l2a.out" "$WORK/l2b.out" | awk -F: '{s+=$2} END{print s}')"
[ "$RCA" -eq 0 ] && [ "$RCB" -eq 0 ] && [ "$NODL" = "0" ] && ok "L2 lock-first 序列化零 40P01" \
  || bad "L2 rca=$RCA rcb=$RCB dl=$NODL"
cleanup_disp "$D_L1"

# L3a 真 RPC mark_failed:阻塞後完成、零 40P01、arbiter 不等待
D_L3="$(next_disp)"; O_L3="$(mkord_committed "$D_L3")"
A_L3="$(q "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES ('$O_L3', '$CUST', public.charge_attempt_token_hash(gen_random_uuid())) RETURNING id")"
APP_B="a8c1_l3ab_$RANDOM$$"; APP_M="a8c1_l3am_$RANDOM$$"
rm -f "$WORK/l3a-go"
psql "$URL?application_name=$APP_B" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/l3a-t2.out" 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O_L3' FOR UPDATE;
\! until [ -f "$WORK/l3a-go" ]; do sleep 0.1; done
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES ('$O_L3', '$CUST', public.charge_attempt_token_hash(gen_random_uuid()))
ON CONFLICT (order_id) WHERE status IN ('pending','charged') DO NOTHING;
COMMIT;
SQL
P1=$!
sleep 0.3
psql "$URL?application_name=$APP_M" -v ON_ERROR_STOP=1 -tAX -c "SELECT public.mark_charge_attempt_failed('$A_L3','$O_L3')" > "$WORK/l3a-t1.out" 2>&1 &
PM=$!
L3ABARR=1
wait_blocked_by "$APP_M" "$APP_B" 5 && L3ABARR=0
touch "$WORK/l3a-go"
wait $PM; RC1=$?
wait $P1; RC2=$?
DL="$(grep -c 'deadlock detected' "$WORK/l3a-t1.out" "$WORK/l3a-t2.out" | awk -F: '{s+=$2} END{print s}')"
ST="$(q "SELECT status FROM public.payment_charge_attempts WHERE id='$A_L3'")"
NL3="$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O_L3'")"
[ "$L3ABARR" -eq 0 ] && [ "$DL" = "0" ] && [ "$RC1" -eq 0 ] && [ "$RC2" -eq 0 ] && [ "$ST" = "failed" ] && [ "$NL3" = "1" ] \
  && ok "L3a mark_failed×begin:barrier 證真重疊、零 40P01、DO NOTHING 不等待" \
  || bad "L3a barrier=$L3ABARR dl=$DL rc=$RC1/$RC2 st=$ST n=$NL3"
cleanup_disp "$D_L3"

# L3b 真 RPC close_released_attempt:同構(升證據等級)
D_L3B="$(next_disp)"; O_L3B="$(mkord_committed "$D_L3B")"
A_L3B="$(q "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES ('$O_L3B', '$CUST', public.charge_attempt_token_hash(gen_random_uuid())) RETURNING id")"
psql "$URL" -qtAX -c "UPDATE public.payment_charge_attempts SET status='released', released_at=now() WHERE id='$A_L3B'" >/dev/null
APP_B2="a8c1_l3bb_$RANDOM$$"; APP_C2="a8c1_l3bc_$RANDOM$$"
rm -f "$WORK/l3b-go"
psql "$URL?application_name=$APP_B2" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/l3b-t2.out" 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O_L3B' FOR UPDATE;
\! until [ -f "$WORK/l3b-go" ]; do sleep 0.1; done
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES ('$O_L3B', '$CUST', public.charge_attempt_token_hash(gen_random_uuid()))
ON CONFLICT (order_id) WHERE status IN ('pending','charged') DO NOTHING;
COMMIT;
SQL
P1=$!
sleep 0.3
psql "$URL?application_name=$APP_C2" -v ON_ERROR_STOP=1 -tAX -c "SELECT public.close_released_attempt('$A_L3B','a8c1 L3b probe')" > "$WORK/l3b-t1.out" 2>&1 &
PC=$!
L3BBARR=1
wait_blocked_by "$APP_C2" "$APP_B2" 5 && L3BBARR=0
touch "$WORK/l3b-go"
wait $PC; RC1=$?
wait $P1; RC2=$?
DL="$(grep -c 'deadlock detected' "$WORK/l3b-t1.out" "$WORK/l3b-t2.out" | awk -F: '{s+=$2} END{print s}')"
ST="$(q "SELECT status FROM public.payment_charge_attempts WHERE id='$A_L3B'")"
NL3B="$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O_L3B'")"
[ "$L3BBARR" -eq 0 ] && [ "$DL" = "0" ] && [ "$RC1" -eq 0 ] && [ "$RC2" -eq 0 ] && [ "$ST" = "failed" ] && [ "$NL3B" = "1" ] \
  && ok "L3b close_released×begin:barrier 證真重疊、arbiter 邊(lock-only released)不等待、零 40P01" \
  || bad "L3b barrier=$L3BBARR dl=$DL rc=$RC1/$RC2 st=$ST n=$NL3B"
cleanup_disp "$D_L3B"

# L4b released 佔鎖 ⇒ begin=order_locked(倖存者分析地基)
D_L4B="$(next_disp)"; O_L4B="$(mkord_committed "$D_L4B")"
q "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
   VALUES ('$O_L4B', '$CUST', public.charge_attempt_token_hash(gen_random_uuid()))" >/dev/null
q "UPDATE public.payment_charge_attempts SET status='released', released_at=now() WHERE order_id='$O_L4B'" >/dev/null
L4BOUT="$(q "SELECT public.begin_charge_attempt('$O_L4B')")"
case "$L4BOUT" in *order_locked*) ok "L4b released 佔 order_lock_idx ⇒ begin=order_locked";;
  *) bad "L4b out=$L4BOUT";; esac
cleanup_disp "$D_L4B"

# L4 genesis 環兩趟(victim 各釘一向;begin 樣式=模擬序、genesis=真 RPC)
l4_pass() {  # $1=victim(begin|genesis) → 0/1
  local victim="$1" D O A BT GT RES=1
  D="$(next_disp)"; O="$(mkord_committed "$D")"
  A="$(q "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
          VALUES ('$O', '$CUST', public.charge_attempt_token_hash(gen_random_uuid())) RETURNING id")"
  q "UPDATE public.payment_charge_attempts SET status='released', released_at=now() WHERE id='$A'" >/dev/null
  if [ "$victim" = "begin" ]; then BT='100ms'; GT='10s'; else BT='10s'; GT='500ms'; fi
  # begin 樣式:先持鎖 → 等 barrier 檔案 → INSERT(環第二條邊);app_name 唯一化防冒充
  local APPB="a8c1_l4b_$RANDOM$$" APPG="a8c1_l4g_$RANDOM$$" BARRFAIL=0
  rm -f "$WORK/l4-go"
  ( psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/l4-begin.out" 2>&1
SET deadlock_timeout='$BT';
BEGIN;
SELECT id FROM public.orders WHERE id='$O' FOR UPDATE;
\! until [ -f "$WORK/l4-go" ]; do sleep 0.1; done
INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
VALUES ('$O', '$CUST', public.charge_attempt_token_hash(gen_random_uuid()))
ON CONFLICT (order_id) WHERE status IN ('pending','charged') DO NOTHING;
COMMIT;
SQL
  ) & local BP=$!
  sleep 0.5
  ( psql "$URL?application_name=$APPG" -v ON_ERROR_STOP=1 -tAX \
      -c "SET deadlock_timeout='$GT'" \
      -c "SELECT public.mark_charge_attempt_charged('$A','$O','RECL4$(cat "$WORK/.dispcnt")$RANDOM')" > "$WORK/l4-gen.out" 2>&1
  ) & local GP=$!
  # barrier(sticky):genesis 已被 begin 擋住(=UPDATE 完成、卡在 anomaly 的 orders KEY SHARE);
  # 未達成=本格必紅,不因終態碰巧吻合而綠(codex 關卡2 抓)
  if wait_blocked_by "$APPG" "$APPB" 5; then touch "$WORK/l4-go"
  else touch "$WORK/l4-go"; BARRFAIL=1; CELL_ERR="L4($victim) barrier 未達成"; fi
  wait $BP; wait $GP
  local DLB DLG
  DLB="$(grep -c 'deadlock detected' "$WORK/l4-begin.out" || true)"
  DLG="$(grep -c 'deadlock detected' "$WORK/l4-gen.out" || true)"
  if [ "$victim" = "begin" ]; then
    if [ "$DLB" -ge 1 ] && [ "$DLG" -eq 0 ] \
       && [ "$(q "SELECT status FROM public.payment_charge_attempts WHERE id='$A'")" = "charged" ] \
       && [ "$(q "SELECT count(*) FROM public.payment_double_charge_anomalies WHERE old_order_id='$O'")" = "1" ]; then RES=0
    else CELL_ERR="L4(begin victim) dlb=$DLB dlg=$DLG"; fi
  else
    # 趟2 oracle:genesis victim 回滾 ⇒ released 列仍在鎖索引 ⇒ 模擬 begin 的 INSERT 必 DO NOTHING
    # (=order_locked 語意):attempts 恆 1 列且 status=released、begin 側零 ERROR。
    local NA ST2
    NA="$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O'")"
    ST2="$(q "SELECT status FROM public.payment_charge_attempts WHERE id='$A'")"
    if [ "$DLG" -ge 1 ] && [ "$DLB" -eq 0 ] && [ "$NA" = "1" ] && [ "$ST2" = "released" ] \
       && ! grep -q 'ERROR' "$WORK/l4-begin.out"; then RES=0
    else CELL_ERR="L4(genesis victim) dlb=$DLB dlg=$DLG attempts=$NA st=$ST2"; fi
  fi
  [ "$BARRFAIL" -eq 0 ] || RES=1
  cleanup_disp "$D"
  return $RES
}
l4_pass begin   && ok "L4 趟1 victim=begin(40P01;genesis 完成 charged+anomaly=1)" || bad "L4 趟1 — ${CELL_ERR:-}"
l4_pass genesis && ok "L4 趟2 victim=genesis(40P01;倖存 begin=order_locked 非 acquired)" || bad "L4 趟2 — ${CELL_ERR:-}"

# ── 突變矩陣 M1-M6(DB 內 CREATE OR REPLACE;anchor preflight;每輪跑滿 19 格)──
echo "== 突變矩陣 M1-M6 × 19 格 =="
q "SELECT pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure)" > "$WORK/fdef-base.txt"
restore_base() { psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/fdef-base.txt" >/dev/null 2>&1; }
trap restore_base EXIT

gen_mutant() {  # $1=編號;python 產 mutant SQL(anchor 唯一性 preflight 內建)
  python3 - "$1" "$WORK/fdef-base.txt" "$WORK/mutant.sql" <<'PYEOF'
import sys
n, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()
def sub(anchor, repl):
    if src.count(anchor) != 1:
        sys.exit(f"anchor 非唯一({src.count(anchor)}):{anchor[:60]}")
    return src.replace(anchor, repl)
GUARD = """  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ISO = """  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'begin_charge_attempt: isolation guard' USING ERRCODE = 'P8C01';
  END IF;"""
if n == '1':   out = sub(GUARD, "  -- M1 mutant: guard removed")
elif n == '2': out = sub("   WHERE id = p_order_id\n     FOR UPDATE;", "   WHERE id = p_order_id;")
elif n == '3': out = sub(GUARD, GUARD.replace("""v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)""",
                                              "v_order.cancelled_at IS NOT NULL"))
elif n == '4': out = sub(GUARD, GUARD.replace("""v_order.cancelled_at IS NOT NULL
     OR EXISTS""", "EXISTS"))
elif n == '5': out = sub(ISO, "  -- M5 mutant: isolation gate removed")
elif n == '6': out = sub(" WHERE c.order_id = p_order_id", "")
else: sys.exit("unknown mutant")
open(out_p, 'w').write(out)
PYEOF
}

#            S1-S8      C1 C2 C3 C4a C4b C5 C6 C7 C8 C9a C9b
EXPECT[1]="11111111 0 0 1 0 0 1 1 0 1 1 1"
EXPECT[2]="11111111 1 1 1 0 0 1 1 1 1 1 1"
EXPECT[3]="11111111 1 0 1 1 0 1 1 1 1 1 1"
EXPECT[4]="11111111 0 1 1 1 1 1 1 0 1 1 1"
EXPECT[5]="11111111 1 1 1 1 1 1 1 1 1 0 0"
EXPECT[6]="11111111 1 1 1 1 1 1 0 1 1 1 1"

for M in 1 2 3 4 5 6; do
  if ! ERR="$(gen_mutant "$M" 2>&1)"; then bad "M$M anchor preflight — $ERR"; continue; fi
  psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/mutant.sql" >/dev/null 2>&1 || { bad "M$M 套用失敗"; continue; }
  MMD5="$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")"
  [ "$MMD5" != "$MD5_NEW" ] || { bad "M$M 套用後 md5 未變(突變無效)"; restore_base; continue; }
  VEC="$(run_vector)"
  EXP="$(printf '%s' "${EXPECT[$M]}" | tr -d ' ')"
  if [ "$VEC" = "$EXP" ]; then ok "M$M vector 逐格吻合($VEC)"
  else bad "M$M vector=$VEC 期望=$EXP(最後錯誤:${CELL_ERR:-})"; fi
  restore_base
  [ "$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")" = "$MD5_NEW" ] \
    && ok "M$M 還原後 md5=基準" || bad "M$M 還原失敗"
done

# M5 附加示範(非計分):RR 下部分取消 commit 後 begin 仍 acquired=洞實證
gen_mutant 5 && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/mutant.sql" >/dev/null 2>&1
D_M5="$(next_disp)"; O_M5="$(mkord_committed "$D_M5")"
psql "$URL?application_name=a8c1_m5c" -v ON_ERROR_STOP=1 -qtAX <<SQL >/dev/null 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O_M5' FOR UPDATE;
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES ('$O_M5', 'sean', gen_random_uuid(), 'customer_request', encode(sha256('m5'::bytea),'hex'));
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT c.id, '$O_M5', i.id, 1 FROM public.order_cancellations c, public.order_items i
 WHERE c.order_id='$O_M5' AND i.order_id='$O_M5' LIMIT 1;
SELECT pg_sleep(2);
COMMIT;
SQL
P1=$!
sleep 0.5
M5OUT="$(psql "$URL" -qtAX -c "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;" \
  -c "SELECT 1 FROM public.customers LIMIT 1;" \
  -c "SELECT public.begin_charge_attempt('$O_M5');" -c "COMMIT;" 2>&1)"
wait $P1
case "$M5OUT" in *acquired*true*) ok "M5 示範:RR 舊快照漏看已 commit 部分取消 ⇒ acquired(洞實證)";;
  *) bad "M5 示範未重現(out=$(printf '%s' "$M5OUT" | head -1 | cut -c1-100))";; esac
restore_base
cleanup_disp "$D_M5"
trap - EXIT

# ── 九表零留痕 ────────────────────────────────────────────
END9="$(snap9)" || { echo "🔴 snap9 終判失敗"; FAIL=$((FAIL+1)); END9="SNAP9-FAILED"; }
if [ "$BASE9" = "$END9" ] && [ "$CLEANUP_FAIL" -eq 0 ]; then ok "九表零留痕(含 cleanup 零吞錯)"
else bad "留痕或 cleanup 吞錯(CLEANUP_FAIL=$CLEANUP_FAIL):"; echo "  基線 $BASE9"; echo "  結束 $END9"; fi

echo "== 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECTED_TOTAL)=="
[ "$FAIL" -eq 0 ] || exit 1
[ "$PASS" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 計數閘:PASS=$PASS ≠ $EXPECTED_TOTAL(格被靜默跳過?)"; exit 1; }
exit 0
