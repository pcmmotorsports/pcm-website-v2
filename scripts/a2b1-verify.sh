#!/usr/bin/env bash
# ============================================================
# A2b1 驗證 harness:order_item_procurement 跨列總量守門 trigger
# ============================================================
# plan = docs/specs/2026-08-03-e10-a2b1-procurement-allocation-guard-plan.md §5
# 用法:先 scripts/d1t2-rehearsal.sh provision /tmp/a2b1-work,再 scripts/a2b1-verify.sh /tmp/a2b1-work
# 形狀照 a6-verify.sh:三計數器(EXPECTED_TOTAL/EXPECTED_MUT/EXPECTED_CELL)+ 身分閘三重
# + case 全部 BEGIN…ROLLBACK 零留痕 + DB 內突變(anchor 三重 preflight)。
# 例外(誠實列出、各自帶清理與殘留斷言):
#   B9c / B13a / M12 / M1 需要 committed 狀態(跨交易或跨連線可見),事後刪除並比對基準;
#   M1 是唯一 committed 的函式突變(跨連線才觀察得到鎖),trap 會還原、收尾比對 md5。
# 🔴 突變格的語意 = 「攻擊 SQL 在 mutant 下觀察到行為翻面」則 ok;
#    mutant 沒翻面(= 突變殺不死)會讓該格紅 —— 這正是要的訊號。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a2b1-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
AURL="${URL}?application_name=a2b1_sess_a"
FNSIG="public.pcm_a2b1_procurement_allocation_guard()"
MIGFILE="supabase/migrations/20260803130000_m4b_e10_a2b1_procurement_allocation_guard.sql"
TGNAME="order_item_procurement_allocation_guard_ac"
CON_MAIN="a2b1_allocation_within_orderable"
CON_ISO="a2b1_isolation_read_committed_only"
PASS=0; FAIL=0; SKIP=0; MUT=0; CELL=0
EXPECTED_TOTAL=69
EXPECTED_MUT=13
EXPECTED_CELL=25

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
cell() { CELL=$((CELL+$1)); }
skip_gate() { [ "$1" -eq 0 ]; }
# 收尾三道計數閘的唯一實作;H1 自檢與收尾共用同一份(codex K2 MF9:自檢必須打真閘)
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }
sqlstate_of() { psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "$1" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(marker + data_directory + db 名三重;照 a6-verify.sh:45-52)──────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in
  "$WORK"/*) : ;;
  *) echo "🔴 連到的 DB data_directory=$DATADIR,不在 $WORK 底下;拒跑"; exit 1 ;;
esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
ISO="$(q "SHOW default_transaction_isolation")"
[ "$ISO" = "read committed" ] || { echo "🔴 default_transaction_isolation=$ISO;本 harness 的 RC 格會失義;拒跑"; exit 1; }
LCM="$(q "SHOW lc_messages")"
[ "$LCM" = "C" ] || { echo "🔴 lc_messages=$LCM 非 C;紅色判定 grep 依賴英文 ERROR 前綴會靜默失義;拒跑"; exit 1; }

# ── 判定原語 ─────────────────────────────────────────────────
case_ok() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then ok "$label"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

# expect_guard label 期望SQLSTATE 期望constraint(空=不驗) BEGIN句 setup attack
# attack 在 DO 內執行;被期望碼擋下且 constraint 相符 → 印 sentinel → ok。
expect_guard() {
  local label="$1" state="$2" conname="$3" beginsql="$4" setup="$5" attack="$6" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
$beginsql
$setup
DO \$a2b1atk\$
DECLARE v_con text;
BEGIN
  BEGIN
    $attack
    RAISE EXCEPTION 'A2B1_NOT_BLOCKED';
  EXCEPTION WHEN SQLSTATE '$state' THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF '$conname' <> '' AND v_con IS DISTINCT FROM '$conname' THEN
      RAISE EXCEPTION 'A2B1_WRONG_CONSTRAINT:%', v_con;
    END IF;
    RAISE NOTICE 'A2B1_RED_OK';
  END;
END
\$a2b1atk\$;
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'A2B1_RED_OK'; then ok "$label(紅在 $state${conname:+ / $conname})"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|A2B1' | cut -c1-160)"; fi
}

# mut_block:DB 內函式突變(照 a6-verify.sh:82-109;anchor 命中 + 出現次數 + catalog 實變三重 preflight)
mut_block() {
  cat <<MUTSQL
DO \$mut\$
DECLARE
  v_oid oid := '$FNSIG'::regprocedure;
  v_def text; v_new text; v_md5 text; v_from text; v_occ integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_def;
  v_md5  := pg_catalog.md5(v_def);
  v_from := current_setting('harness.mut_from');
  v_new  := pg_catalog.replace(v_def, v_from, current_setting('harness.mut_to'));
  IF pg_catalog.md5(v_new) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:anchor 未在函式定義中命中';
  END IF;
  v_occ := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_from, '')))
           / pg_catalog.length(v_from);
  IF v_occ <> current_setting('harness.mut_occ')::integer THEN
    RAISE EXCEPTION '突變 anchor 出現 % 次,與宣告的 % 次不符', v_occ, current_setting('harness.mut_occ');
  END IF;
  EXECUTE v_new;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid)) = v_md5 THEN
    RAISE EXCEPTION '突變未套上:catalog 定義沒有改變';
  END IF;
END
\$mut\$;
MUTSQL
}

# mutate_fn label mfrom mto setup attack occ [beginsql]
mutate_fn() {
  local label="$1" mfrom="$2" mto="$3" setup="$4" attack="$5" want_occ="$6" beginsql="${7:-BEGIN;}" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="$mfrom" -v mto="$mto" -v mocc="$want_occ" <<SQL 2>&1
$beginsql
$setup
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
$attack
ROLLBACK;
SQL
)"
  local rc=$?
  MUT=$((MUT+1))
  if [ $rc -eq 0 ]; then ok "突變 $label ⇒ 行為翻面被觀察到"
  else bad "突變 $label ⇒ $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-160)"; fi
}

# ── 單連線 FIFO session(B12 / M1;照 a7t-concurrency-probe.sh:110-132 縮裁)──
PA=""
wait_idle_a() {
  local i st
  for i in $(seq 1 120); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name = 'a2b1_sess_a' LIMIT 1" 2>/dev/null)"
    case "$st" in idle|'idle in transaction') return 0 ;; esac
    sleep 0.25
  done
  echo "  🔴 barrier 逾時:session A 30 秒未回 idle(state=$st);中止不假裝跑過"; exit 1
}
open1() { rm -f "$WORK/a2b1-fa"; mkfifo "$WORK/a2b1-fa"; ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$WORK/a2b1-fa" > "$WORK/a2b1-outa.txt" 2>&1 ) & PA=$!; exec 3>"$WORK/a2b1-fa"; wait_idle_a; }
sa() { printf '%s\n' "$1" >&3; wait_idle_a; }
close1() { exec 3>&- 2>/dev/null || true; [ -n "$PA" ] && wait "$PA" 2>/dev/null || true; PA=""; }

echo "== A2b1 verify($(date '+%H:%M:%S'))WORK=$WORK =="
echo "-- H 區自我測試(閘先證明會發火)--"
if count_gate "$EXPECTED_TOTAL" 2; then bad "H1 自檢:count_gate 竟放行 2≠$EXPECTED_TOTAL"; else ok "H1 自檢:count_gate 對不符值發火(收尾三閘同一份實作)"; fi
if skip_gate 1; then bad "H2 自檢:skip_gate 竟放行 1"; else ok "H2 自檢:skip_gate 對非零發火(收尾同一份)"; fi
skip_gate 0 && ok "H2 自檢:skip_gate 對 0 放行" || bad "H2 自檢:skip_gate 對 0 竟發火"
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id='PCM-9997-FAKE'")" = "0" ] \
  && ok "H3 自檢:存在性查詢對不存在 fixture 回 0" || bad "H3 自檢:竟非 0"

# 突變自檢:mut_block 的兩道 preflight 要會發火(anchor 未命中 / occ 不符)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="THIS_ANCHOR_DOES_NOT_EXIST" -v mto="x" -v mocc="1" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
ROLLBACK;
SQL
)"
[ $? -ne 0 ] && printf '%s' "$o" | grep -q 'anchor 未在函式定義中命中' \
  && ok "突變自檢①:anchor 未命中會發火" || bad "突變自檢①:未命中竟未發火"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfrom="FOR NO KEY UPDATE" -v mto="x" -v mocc="9" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_from', :'mfrom', true);
SELECT set_config('harness.mut_to',   :'mto',   true);
SELECT set_config('harness.mut_occ',  :'mocc',  true);
$(mut_block)
ROLLBACK;
SQL
)"
[ $? -ne 0 ] && printf '%s' "$o" | grep -q '不符' \
  && ok "突變自檢②:occ 不符會發火" || bad "突變自檢②:occ 不符竟未發火"

echo "== 基準與 fixture(committed;EXIT trap 清除)=="
ORDERS_N0="$(q "SELECT count(*) FROM public.orders")"
PROC_N0="$(q "SELECT count(*) FROM public.order_item_procurement")"
CANC_N0="$(q "SELECT count(*) FROM public.order_cancellation_items")"
SUMM_N0="$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
[ -n "$ORDERS_N0" ] && [ -n "$PROC_N0" ] && [ -n "$CANC_N0" ] && [ -n "$SUMM_N0" ] \
  && ok "基準已取(orders=$ORDERS_N0 proc=$PROC_N0 canc=$CANC_N0 summ=$SUMM_N0)" || bad "基準取得失敗"

MUTATED=0
ORIGDEF_FILE="$WORK/a2b1-fn-orig.sql"
cleanup_all() {
  close1 2>/dev/null || true
  if [ "$MUTATED" = "1" ] && [ -s "$ORIGDEF_FILE" ]; then
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
    if [ -n "${FNDEF_MD5_BEFORE:-}" ] \
       && [ "$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")" = "$FNDEF_MD5_BEFORE" ]; then
      MUTATED=0
    else
      echo "🔴🔴 cleanup:M1 mutant 還原失敗 —— 本 harness 庫仍是突變版;重跑本檔會在 A7 結構錨紅" >&2
    fi
  fi
  psql "$URL" -tAX -c "DELETE FROM public.order_item_procurement WHERE order_item_id IN (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A2B1-%')" >/dev/null 2>&1 \
    || echo "🔴 cleanup:procurement fixture 刪除失敗(殘留)" >&2
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9997-0001'" >/dev/null 2>&1 \
    || echo "🔴 cleanup:fixture 訂單刪除失敗(殘留)" >&2
  rm -f "$WORK/a2b1-fa"
}
# 🔴 signal 只設退出碼;清理由 EXIT trap 做(codex K2 MF5:trap 內不 exit 會讓腳本續跑)
trap 'exit 130' INT TERM
trap cleanup_all EXIT

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_cnt integer; v_order uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'fixture 失敗:customers 為空'; END IF;
  SELECT count(*) INTO v_cnt FROM public.orders WHERE display_id='PCM-9997-0001';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'fixture 失敗:PCM-9997-0001 已存在'; END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9997-0001', v_cust,
          jsonb_build_object('name','A2b1 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  -- 🔴 異質 quantity(5 與 3;R1-11:同質會讓 quantity 常數化突變存活)
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A2B1-P5', '{"title":"a2b1 p5","sku":"A2B1-P5","spec":{}}'::jsonb, 5, 0, 0);
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A2B1-P3', '{"title":"a2b1 p3","sku":"A2B1-P3","spec":{}}'::jsonb, 3, 0, 0);
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "fixture 已建(PCM-9997-0001;P5 qty=5 / P3 qty=3)" \
  || bad "fixture 建立失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"

ORDER_ID="$(q "SELECT id FROM public.orders WHERE display_id='PCM-9997-0001'")"
ITEM5="$(q "SELECT id FROM public.order_items WHERE variant_sku='A2B1-P5'")"
ITEM3="$(q "SELECT id FROM public.order_items WHERE variant_sku='A2B1-P3'")"
S1="$(q "SELECT id FROM public.suppliers ORDER BY id LIMIT 1")"
S2="$(q "SELECT id FROM public.suppliers ORDER BY id OFFSET 1 LIMIT 1")"
S3="$(q "SELECT id FROM public.suppliers ORDER BY id OFFSET 2 LIMIT 1")"
STAFF="$(q "SELECT id FROM public.staff ORDER BY id LIMIT 1")"
if [ -n "$ORDER_ID" ] && [ -n "$ITEM5" ] && [ -n "$ITEM3" ] && [ -n "$S1" ] && [ -n "$S2" ] && [ -n "$S3" ] && [ -n "$STAFF" ]; then
  ok "fixture id 已取(items×2 suppliers×3 staff=$STAFF)"
else
  bad "fixture id 缺(order=$ORDER_ID i5=$ITEM5 i3=$ITEM3 s=$S1/$S2/$S3 staff=$STAFF)—— 後續全部無意義"
  echo "PASS=$PASS FAIL=$FAIL"; exit 1
fi
FNDEF_MD5_BEFORE="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
[ -n "$FNDEF_MD5_BEFORE" ] && ok "函式 md5 基準已取" || bad "函式 md5 基準取不到"
psql "$URL" -tAX -c "SELECT pg_get_functiondef('$FNSIG'::regprocedure)" > "$ORIGDEF_FILE" 2>/dev/null
[ -s "$ORIGDEF_FILE" ] && ok "原始函式定義已存檔(M1 還原用)" || bad "原始函式定義存檔失敗"

# 常用 SQL 片段(shell 內插;取消 fixture 一律在交易內、隨 ROLLBACK 蒸發)
CANCEL_2_TWO_HEADERS="
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b1-h1'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, '$ORDER_ID', '$ITEM5', 1);
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a2'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b1-h2'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a2'::uuid, '$ORDER_ID', '$ITEM5', 1);"

echo
echo "== A. 結構格(10 cells;與 migration 檔內 DO 驗收獨立重證)=="
cell 10
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='$TGNAME' AND NOT tgisinternal")" = "1" ] \
  && ok "[A1] trigger 存在且全庫同名唯一" || bad "[A1] trigger 數不為 1"
[ "$(q "SELECT tgrelid::regclass::text || '|' || tgfoid::regproc::text FROM pg_trigger WHERE tgname='$TGNAME' AND NOT tgisinternal")" = "order_item_procurement|pcm_a2b1_procurement_allocation_guard" ] \
  && ok "[A1b] 掛對表、指對函式" || bad "[A1b] 表或函式不符"
[ "$(q "SELECT (tgtype & 1)<>0 AND (tgtype & 2)=0 AND (tgtype & 4)<>0 AND (tgtype & 8)=0 AND (tgtype & 16)<>0 AND (tgtype & 32)=0 FROM pg_trigger WHERE tgname='$TGNAME' AND NOT tgisinternal")" = "t" ] \
  && ok "[A2] tgtype = AFTER ROW INSERT OR UPDATE(無 DELETE/TRUNCATE)" || bad "[A2] tgtype 位元不符"
[ "$(q "SELECT tgdeferrable AND NOT tginitdeferred AND tgenabled='O' FROM pg_trigger WHERE tgname='$TGNAME' AND NOT tgisinternal")" = "t" ] \
  && ok "[A3] DEFERRABLE INITIALLY IMMEDIATE + enabled O(Q2=A)" || bad "[A3] deferrable 形狀不符"
[ "$(q "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_trigger t ON t.tgconstraint=c.oid WHERE t.tgname='$TGNAME' AND c.contype='t')")" = "t" ] \
  && ok "[A4] constraint trigger(pg_constraint contype=t)" || bad "[A4] 非 constraint trigger"
[ "$(q "SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND proconfig @> ARRAY['lock_timeout=5s'] FROM pg_proc WHERE oid='$FNSIG'::regprocedure")" = "t" ] \
  && ok "[A5] SECURITY DEFINER + search_path + lock_timeout 釘死" || bad "[A5] 函式頭不符"
[ "$(q "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid='$FNSIG'::regprocedure AND a.grantee <> p.proowner")" = "0" ] \
  && [ "$(q "SELECT has_function_privilege('anon','$FNSIG','EXECUTE') OR has_function_privilege('authenticated','$FNSIG','EXECUTE') OR has_function_privilege('service_role','$FNSIG','EXECUTE')")" = "f" ] \
  && ok "[A6] 函式 ACL allowlist(owner 外零 grantee)+ 三 role 顯式否定" || bad "[A6] 函式 ACL 不符"
[ "$(q "SELECT (length(d) - length(replace(d,'FOR NO KEY UPDATE','')))/length('FOR NO KEY UPDATE') FROM (SELECT pg_get_functiondef('$FNSIG'::regprocedure) d) s")" = "1" ] \
  && ok "[A7] FOR NO KEY UPDATE 恰 1 次(M1 的結構錨)" || bad "[A7] NKU 錨不符"
[ "$(q "SELECT strpos(pg_get_functiondef('$FNSIG'::regprocedure),'order_item_quantity_summary')")" = "0" ] \
  && ok "[A8] 摘要快取表零引用(C1)" || bad "[A8] 守門竟引用摘要表"
[ "$(q "SELECT strpos(pg_get_functiondef('$FNSIG'::regprocedure),'<> ''read committed''') > 0")" = "t" ] \
  && ok "[A9] 隔離閘可執行式存在(錨 <> 比較、不錨註解)" || bad "[A9] 隔離閘可執行式不存在"
[ "$(q "SELECT count(*) FROM pg_class WHERE oid IN ('public.order_items'::regclass,'public.order_item_procurement'::regclass,'public.order_cancellation_items'::regclass) AND (relowner <> (SELECT proowner FROM pg_proc WHERE oid='$FNSIG'::regprocedure) OR relforcerowsecurity)")" = "0" ] \
  && ok "[A10] owner 對齊三表 + 零 FORCE RLS" || bad "[A10] owner/FORCE RLS 不符"

echo
echo "== B. 行為格(15 cells)=="
cell 15
# B1 邊界正向:恰好用滿
case_ok "[B1] P5 單列 allocated=5 恰滿 → 過" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',5);"

# B2 超 1:P2B01 + 精確 constraint
expect_guard "[B2] P5 單列 6 → 擋" P2B01 "$CON_MAIN" "BEGIN;" "" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);"

# B3 跨列聚合(兩家恰滿 + 第三家 +1 被擋)
case_ok "[B3] 兩家 3+2 恰滿過;第三家 +1 紅在 P2B01" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S2',2);
DO \$a2b1b3\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S3',1);
    RAISE EXCEPTION 'B3:第三家 +1 竟放行';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1b3\$;"

# B3b 異質 quantity(殺 M11)
case_ok "[B3b] P3 填 3 過;填 4 紅在 P2B01(異質 quantity)" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM3','$S1',3);
DO \$a2b1b3b\$
BEGIN
  BEGIN
    UPDATE public.order_item_procurement SET allocated_quantity = 4 WHERE order_item_id='$ITEM3' AND supplier_id='$S1';
    RAISE EXCEPTION 'B3b:P3 調到 4 竟放行';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1b3b\$;"

# B4 delta 本體:先取消 2(跨兩 header)再開 4 → 擋;開 3 → 過
case_ok "[B4] 取消 2(1+1 跨兩 header)後開 4 紅、開 3 過" \
"$CANCEL_2_TWO_HEADERS
DO \$a2b1b4\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',4);
    RAISE EXCEPTION 'B4:取消後開 4 竟放行';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1b4\$;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);"

# B5 不追溯三段:開滿 → 取消成功 → 調升紅 → 調降過
case_ok "[B5] 開滿 5 → 取消 2 成功(不追溯)→ +1 紅 → −1 過" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S2',2);
$CANCEL_2_TWO_HEADERS
DO \$a2b1b5\$
DECLARE v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.order_cancellation_items WHERE order_item_id='$ITEM5';
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'B5:取消明細應 2 列實 %(取消被追溯擋下=違反 §5.1b:452)', v_cnt; END IF;
  BEGIN
    UPDATE public.order_item_procurement SET allocated_quantity = 4 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
    RAISE EXCEPTION 'B5:超量態調升竟放行';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
  UPDATE public.order_item_procurement SET allocated_quantity = 2 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
END
\$a2b1b5\$;"

# B5d 超量合法態的 metadata UPDATE 必須過(殺 M6b;取消後改回覆狀態是日常流程)
case_ok "[B5d] 超量合法態只改 reply_status → 必須過" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',5);
$CANCEL_2_TWO_HEADERS
UPDATE public.order_item_procurement SET reply_status = 'out_of_stock' WHERE order_item_id='$ITEM5' AND supplier_id='$S1';"

# B6 調升界內(正向格;不宣稱殺突變)
case_ok "[B6] UPDATE 調升 2→4 界內 → 過" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',2);
UPDATE public.order_item_procurement SET allocated_quantity = 4 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';"

# B7 換 parent 造成超量
case_ok "[B7] 換 parent 到 P3 造成 3+1>3 → 紅在 P2B01" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM3','$S2',3);
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);
DO \$a2b1b7\$
BEGIN
  BEGIN
    UPDATE public.order_item_procurement SET order_item_id = '$ITEM3' WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
    RAISE EXCEPTION 'B7:換 parent 超量竟放行';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1b7\$;"

# B8 摘要竄改雙向(C1 負測字面;殺 M2)
case_ok "[B8] 摘要說 0 而真相取消 2 → 仍擋;摘要說 5 而真相 0 → 仍放" \
"$CANCEL_2_TWO_HEADERS
INSERT INTO public.order_item_quantity_summary (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
VALUES ('$ITEM5', 5, 0, 0, 0);
DO \$a2b1b8\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',4);
    RAISE EXCEPTION 'B8-1:摘要=0 竟蓋過真相=2(守門在讀快取)';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1b8\$;
DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM5';
DELETE FROM public.order_cancellations WHERE order_id='$ORDER_ID';
UPDATE public.order_item_quantity_summary SET cancelled_quantity = 5 WHERE order_item_id='$ITEM5';
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S2',5);"

# B9 隔離閘三向(a/b 擋 INSERT;c gate-first 連調降也擋;殺 M4/M12)
expect_guard "[B9a] REPEATABLE READ INSERT → P2B02" P2B02 "$CON_ISO" \
"BEGIN ISOLATION LEVEL REPEATABLE READ;" "" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);"
expect_guard "[B9b] SERIALIZABLE INSERT → P2B02" P2B02 "$CON_ISO" \
"BEGIN ISOLATION LEVEL SERIALIZABLE;" "" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);"
# B9c 需 committed 列(RR 內建不了:INSERT 會先吃 P2B02);事後清、驗殘留
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3)" >/dev/null
expect_guard "[B9c] RR 調降 UPDATE → P2B02(gate-first,Q3=A)" P2B02 "$CON_ISO" \
"BEGIN ISOLATION LEVEL REPEATABLE READ;" "" \
"UPDATE public.order_item_procurement SET allocated_quantity = 2 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$S1'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[B9c] committed 設置列已清、回基準" || bad "[B9c] 殘留未清"

# B10 bigint 路徑(兩列 int 上限取消、跨兩 header;殺 M5)
case_ok "[B10] 取消合計 4294967294(跨兩 header)後開 1 → 紅在 P2B01 非 22003" \
"INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b1-max1'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid, '$ORDER_ID', '$ITEM5', 2147483647);
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000b2'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b1-max2'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000b2'::uuid, '$ORDER_ID', '$ITEM5', 2147483647);
DO \$a2b1b10\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);
    RAISE EXCEPTION 'B10:int 上限取消後竟放行';
  EXCEPTION
    WHEN SQLSTATE 'P2B01' THEN NULL;
    WHEN SQLSTATE '22003' THEN RAISE EXCEPTION 'B10:紅在 22003 = 有 int 中間值(bigint 路徑破)';
  END;
END
\$a2b1b10\$;"

# B11 單 statement 多列
expect_guard "[B11] 多列 VALUES 3+3 合計超 → 整句擋" P2B01 "$CON_MAIN" "BEGIN;" "" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3),('$ITEM5','$S2',3);"
case_ok "[B11b] 多列 VALUES 3+2 恰滿 → 過" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3),('$ITEM5','$S2',2);"

# B12 鎖觀測(NOWAIT 探針;55P03 只證「存在與 NKU 衝突的列鎖」,與 A7 結構錨合殺 M1)
open1
sa "BEGIN;"
sa "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);"
ST="$(sqlstate_of "SELECT quantity FROM public.order_items WHERE id='$ITEM5' FOR NO KEY UPDATE NOWAIT")"
[ "$ST" = "55P03" ] && ok "[B12] 交易內 INSERT 後 NKU NOWAIT 探針 55P03(鎖真的在)" \
  || bad "[B12] 探針未被擋(state=$ST)—— parent 鎖不存在?"
sa "ROLLBACK;"
close1
PROBE_OK="$(q "SELECT quantity FROM public.order_items WHERE id='$ITEM5' FOR NO KEY UPDATE NOWAIT")"
[ "$PROBE_OK" = "5" ] && ok "[B12b] ROLLBACK 後探針立即成功(對照組:擋的就是那把鎖)" \
  || bad "[B12b] 對照組失敗($PROBE_OK)"

# B13 DID 三態(Q2=A)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
SET CONSTRAINTS $TGNAME DEFERRED;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
UPDATE public.order_item_procurement SET allocated_quantity = 4 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
COMMIT;
SQL
)"
if [ $? -eq 0 ]; then
  ok "[B13a] DEFERRED 先超後補 → COMMIT 過"
  q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$S1'" >/dev/null
  [ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
    && ok "[B13a-clean] 已清回基準" || bad "[B13a-clean] 殘留"
else
  bad "[B13a] 先超後補竟失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
  bad "[B13a-clean](未執行)"
fi
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
\\set VERBOSITY verbose
BEGIN;
SET CONSTRAINTS $TGNAME DEFERRED;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
COMMIT;
SQL
)"
[ $? -ne 0 ] && printf '%s' "$o" | grep -q 'A2b1 超量' && printf '%s' "$o" | grep -q 'P2B01' \
  && ok "[B13b] DEFERRED 超量不補 → COMMIT 紅在守門(P2B01)" || bad "[B13b] 超量不補的 COMMIT 未紅在 P2B01"
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[B13b-clean] COMMIT 失敗自動回滾、零殘留" || bad "[B13b-clean] 殘留"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
\\set VERBOSITY verbose
BEGIN;
SET CONSTRAINTS $TGNAME DEFERRED;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
SET CONSTRAINTS $TGNAME IMMEDIATE;
ROLLBACK;
SQL
)"
[ $? -ne 0 ] && printf '%s' "$o" | grep -q 'A2b1 超量' && printf '%s' "$o" | grep -q 'P2B01' \
  && ok "[B13c] SET IMMEDIATE 佇列回沖 → 當場紅在 P2B01(R2-10)" || bad "[B13c] 佇列回沖未紅在 P2B01"

echo
echo "== C. 突變(13;每格 = mutant 下行為翻面被觀察到)=="
# M2 讀快取(真相 2、快取缺列 ⇒ mutant 放行 4)
mutate_fn "M2 cancelled 改讀摘要表 ⇒ B8 翻面" \
"FROM public.order_cancellation_items c" "FROM public.order_item_quantity_summary c" \
"$CANCEL_2_TWO_HEADERS" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',4);" 1
# M3 去 cancelled 項
mutate_fn "M3 公式去 − v_cancelled ⇒ B4 翻面" \
"IF v_alloc > v_qty - v_cancelled THEN" "IF v_alloc > v_qty THEN" \
"$CANCEL_2_TWO_HEADERS" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',4);" 1
# M4 隔離閘弄死(條件恆假)⇒ RR INSERT 放行
mutate_fn "M4 拿掉隔離閘 ⇒ B9a 翻面" \
"<> 'read committed'" "<> pg_catalog.current_setting('transaction_isolation')" \
"" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);" 1 \
"BEGIN ISOLATION LEVEL REPEATABLE READ;"
# M5 變數窄化 ⇒ B10 紅在 22003
mutate_fn "M5 v_cancelled 窄化 integer ⇒ B10 改紅 22003" \
"v_cancelled bigint" "v_cancelled integer" \
"INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b1-m5a'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, '$ORDER_ID', '$ITEM5', 2147483647);
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c2'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a2b1-m5b'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c2'::uuid, '$ORDER_ID', '$ITEM5', 2147483647);" \
"DO \$a2b1m5\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);
    RAISE EXCEPTION 'M5:mutant 竟放行';
  EXCEPTION
    WHEN SQLSTATE '22003' THEN NULL;
    WHEN SQLSTATE 'P2B01' THEN RAISE EXCEPTION 'M5:mutant 仍紅在 P2B01 = 窄化沒生效';
  END;
END
\$a2b1m5\$;" 1
# M6 skip 全放(砍調升判斷)⇒ 超量態調升放行
mutate_fn "M6 skip 砍調升判斷 ⇒ B5 調升翻面" \
"AND NEW.allocated_quantity <= OLD.allocated_quantity THEN" "THEN" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',5);
$CANCEL_2_TWO_HEADERS" \
"UPDATE public.order_item_procurement SET allocated_quantity = 6 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';" 1
# M6b <= 改 < ⇒ 超量態 metadata UPDATE 被誤擋
mutate_fn "M6b skip <= 改 < ⇒ B5d 翻面(metadata 被誤擋)" \
"NEW.allocated_quantity <= OLD.allocated_quantity" "NEW.allocated_quantity < OLD.allocated_quantity" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',5);
$CANCEL_2_TWO_HEADERS" \
"DO \$a2b1m6b\$
BEGIN
  BEGIN
    UPDATE public.order_item_procurement SET reply_status = 'out_of_stock' WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
    RAISE EXCEPTION 'M6b:mutant 下 metadata UPDATE 竟未被擋';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1m6b\$;" 1
# M7 > 改 >= ⇒ 恰滿被誤擋
mutate_fn "M7 > 改 >= ⇒ B1 邊界翻面" \
"IF v_alloc > v_qty - v_cancelled THEN" "IF v_alloc >= v_qty - v_cancelled THEN" \
"" \
"DO \$a2b1m7\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',5);
    RAISE EXCEPTION 'M7:mutant 下恰滿竟未被擋';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN NULL;
  END;
END
\$a2b1m7\$;" 1
# M8 constraint tag 改名 ⇒ B2 的名字斷言翻面
mutate_fn "M8 constraint tag 改名 ⇒ B2 名字斷言翻面" \
"CONSTRAINT = 'a2b1_allocation_within_orderable'" "CONSTRAINT = 'a2b1_wrong_name'" \
"" \
"DO \$a2b1m8\$
DECLARE v_con text;
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
    RAISE EXCEPTION 'M8:竟放行';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'a2b1_allocation_within_orderable' THEN RAISE EXCEPTION 'M8:tag 沒變 = 突變沒生效'; END IF;
  END;
END
\$a2b1m8\$;" 1
# M10 ERRCODE 改碼 ⇒ B2 SQLSTATE 斷言翻面
mutate_fn "M10 P2B01 改 P2B99 ⇒ B2 SQLSTATE 翻面" \
"ERRCODE = 'P2B01'" "ERRCODE = 'P2B99'" \
"" \
"DO \$a2b1m10\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
    RAISE EXCEPTION 'M10:竟放行';
  EXCEPTION
    WHEN SQLSTATE 'P2B99' THEN NULL;
    WHEN SQLSTATE 'P2B01' THEN RAISE EXCEPTION 'M10:仍是 P2B01 = 突變沒生效';
  END;
END
\$a2b1m10\$;" 1
# M11 quantity 常數化 5 ⇒ P3 的 4 被放行
mutate_fn "M11 quantity 常數化 5 ⇒ B3b 翻面" \
"SELECT oi.quantity INTO v_qty" "SELECT 5 INTO v_qty" \
"" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM3','$S1',4);" 1
# M12 閘縮成 INSERT-only(= 閘不蓋 skip 路徑)⇒ RR 調降 UPDATE 放行
# 🔴 committed setup 必須驗到位(codex K2 MF2:靜默失敗 ⇒ 零列 UPDATE 不觸發 trigger、
#    NULL 判斷不發火 = 雙重假綠)
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3)" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$S1' AND allocated_quantity=3")" = "1" ] \
  && ok "[M12-setup] committed 設置列確認在位(attack 的 UPDATE 有真目標)" \
  || bad "[M12-setup] 設置列不在 —— M12 會假綠"
mutate_fn "M12 閘縮 INSERT-only ⇒ B9c 翻面(RR 調降放行)" \
"IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN" \
"IF TG_OP = 'INSERT' AND pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN" \
"" \
"UPDATE public.order_item_procurement SET allocated_quantity = 2 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
DO \$a2b1m12\$
DECLARE v integer;
BEGIN
  SELECT allocated_quantity INTO v FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
  IF v IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'M12:調降沒生效(v=%)', COALESCE(v::text,'NULL'); END IF;
END
\$a2b1m12\$;" 1 \
"BEGIN ISOLATION LEVEL REPEATABLE READ;"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$S1'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[M12-clean] committed 設置列已清" || bad "[M12-clean] 殘留"

# M9(DDL 突變):trigger 砍 UPDATE 事件 ⇒ 超量態調升放行(交易內 DDL、ROLLBACK 還原)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
DROP TRIGGER $TGNAME ON public.order_item_procurement;
CREATE CONSTRAINT TRIGGER $TGNAME
  AFTER INSERT ON public.order_item_procurement
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a2b1_procurement_allocation_guard();
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',5);
$CANCEL_2_TWO_HEADERS
UPDATE public.order_item_procurement SET allocated_quantity = 6 WHERE order_item_id='$ITEM5' AND supplier_id='$S1';
ROLLBACK;
SQL
)"
rc=$?
MUT=$((MUT+1))
[ $rc -eq 0 ] && ok "突變 M9 trigger 砍 UPDATE 事件 ⇒ 調升放行(翻面)" \
  || bad "突變 M9 ⇒ $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
# M9 是唯一 DDL 突變 ⇒ 事後重驗 trigger 形狀(與函式 md5 那道對稱;code-reviewer N4)
[ "$(q "SELECT (tgtype & 1)<>0 AND (tgtype & 2)=0 AND (tgtype & 4)<>0 AND (tgtype & 8)=0 AND (tgtype & 16)<>0 AND (tgtype & 32)=0 AND tgdeferrable AND NOT tginitdeferred FROM pg_trigger WHERE tgname='$TGNAME' AND NOT tgisinternal")" = "t" ] \
  && ok "[M9-restore] trigger 形狀已還原(ROLLBACK 生效)" || bad "[M9-restore] trigger 形狀被 DDL 突變殘留改掉"

# M1(唯一 committed 突變:拿掉 NKU,跨連線才觀察得到)⇒ B12 探針翻面
MUTATED=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $m1$
DECLARE v_oid oid := 'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure;
        v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(v_def, ' FOR NO KEY UPDATE', '');
  IF v_new = v_def THEN RAISE EXCEPTION 'M1:anchor 未命中'; END IF;
  IF (length(v_def) - length(replace(v_def, ' FOR NO KEY UPDATE', ''))) / length(' FOR NO KEY UPDATE') <> 1 THEN
    RAISE EXCEPTION 'M1:anchor 出現次數非 1';
  END IF;
  EXECUTE v_new;
END $m1$;
SQL
)"
if [ $? -eq 0 ]; then
  open1
  sa "BEGIN;"
  sa "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);"
  PROBE_M1="$(q "SELECT quantity FROM public.order_items WHERE id='$ITEM5' FOR NO KEY UPDATE NOWAIT")"
  MUT=$((MUT+1))
  [ "$PROBE_M1" = "5" ] && ok "突變 M1 拿掉 NKU ⇒ B12 探針翻面(NOWAIT 竟成功 = 鎖不在了)" \
    || bad "突變 M1 ⇒ 探針仍被擋($PROBE_M1)= 鎖被別的機制提供?"
  sa "ROLLBACK;"
  close1
else
  MUT=$((MUT+1))
  bad "突變 M1 套用失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
fi
# 🔴 還原走 ON_ERROR_STOP、且 md5 相符才降旗(codex K2 MF3:先降旗會讓 trap 不再重試)
psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
RESTORE_RC=$?
FNDEF_MD5_RESTORED="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
if [ "$RESTORE_RC" -eq 0 ] && [ "$FNDEF_MD5_RESTORED" = "$FNDEF_MD5_BEFORE" ]; then
  MUTATED=0
  ok "[M1-restore] 函式已還原(rc=0)且 md5 = 基準"
else
  bad "[M1-restore] 還原失敗(rc=$RESTORE_RC md5=$FNDEF_MD5_RESTORED)—— MUTATED 旗未降,EXIT trap 會再試"
fi

echo
echo "== 零留痕收尾 =="
FNDEF_MD5_AFTER="$(q "SELECT md5(pg_get_functiondef('$FNSIG'::regprocedure))")"
[ "$FNDEF_MD5_AFTER" = "$FNDEF_MD5_BEFORE" ] && ok "函式 md5 未變" || bad "函式 md5 被改:$FNDEF_MD5_AFTER"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9997-0001'" 2>&1)"
[ $? -eq 0 ] && ok "fixture 訂單已刪(CASCADE 帶走 items;採購零殘留 ⇒ RESTRICT 不擋)" \
  || bad "fixture 刪除失敗:$(printf '%s' "$o" | head -1 | cut -c1-140)"
[ "$(q "SELECT count(*) FROM public.orders")" = "$ORDERS_N0" ] && ok "orders 回基準 $ORDERS_N0" || bad "orders 污染"
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] && ok "procurement 回基準 $PROC_N0" || bad "procurement 污染"
[ "$(q "SELECT count(*) FROM public.order_cancellation_items")" = "$CANC_N0" ] && ok "cancellation_items 回基準 $CANC_N0" || bad "cancellation_items 污染"
[ "$(q "SELECT count(*) FROM public.order_item_quantity_summary")" = "$SUMM_N0" ] && ok "summary 回基準 $SUMM_N0" || bad "summary 污染"

echo
echo "== 誠實邊界(不得對外說滿)=="
echo "   🔴 兩連線真競態(同時 INSERT、一勝一紅 P2B01)本片未測 —— 那是 A2b2;"
echo "      B12 只證「守門真的持有一把與 NKU 衝突的 parent 列鎖」,不證併發序列化端到端。"
echo "   🔴 M1 之外全部突變走交易內還原;M1 是 committed 突變(跨連線可見性所需),"
echo "      還原後以 md5 比對;若本檔中途被 kill,EXIT trap 會還原(fail-open 風險=trap 沒跑,"
echo "      重跑本檔會在 A7 結構錨當場紅)。"
echo "   🔴 隔離閘擋不住 DELETE(未掛 trigger)與零列 UPDATE;replica 模式可跳過 tgenabled=O。"
echo "   🔴 本機 PG17 + C locale ≠ 正式站;ACL 結論跑在 shim 角色圖上,不等於 PostgREST 層。"
echo
echo "== 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP / 格 CELL=$CELL / 突變 MUT=$MUT =="
echo "   釘數:EXPECTED_TOTAL=$EXPECTED_TOTAL EXPECTED_CELL=$EXPECTED_CELL EXPECTED_MUT=$EXPECTED_MUT"
skip_gate "$SKIP" || { echo "🔴 [H2] SKIP 非零"; exit 1; }
count_gate "$EXPECTED_TOTAL" "$((PASS+FAIL))" || { echo "🔴 [H1] 總案例數 $((PASS+FAIL)) ≠ 釘數 $EXPECTED_TOTAL"; exit 1; }
count_gate "$EXPECTED_CELL" "$CELL" || { echo "🔴 [H1b] manifest 格數 $CELL ≠ 釘數 $EXPECTED_CELL"; exit 1; }
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 [H1c] 突變數 $MUT ≠ 釘數 $EXPECTED_MUT"; exit 1; }
[ "$FAIL" -eq 0 ] || exit 1
echo "🎉 A2b1 verify 全綠"
