#!/usr/bin/env bash
# ============================================================
# A5a 驗證 harness:admin_upsert_item_procurement 採購 upsert owner RPC
# ============================================================
# plan = docs/specs/2026-08-03-e10-a5a-item-procurement-upsert-plan.md §5
# 用法:先 scripts/d1t2-rehearsal.sh provision <workdir>(A5a migration 已在序列內),
#       再 scripts/a5a-verify.sh <workdir>
# 形狀照 a4a-verify.sh / a2b1-verify.sh:三計數器 + 身分閘 + case 全 BEGIN…ROLLBACK 零留痕
# + DB 內突變(anchor 三重 preflight)。例外(誠實列出、各自帶清理與殘留斷言):
#   D 區四個 barrier 格需要 committed 狀態(跨連線才觀察得到鎖);
#   D2/D3 會真的把一家供應商停用並 commit,cleanup 還原並比對基準。
# 🔴 突變格語意 = 「攻擊 SQL 在 mutant 下觀察到行為翻面」則 ok;沒翻面 = 該格紅。
# 🔴 本 harness 測的是**回傳碼與副作用**,不是 trigger 紅 —— A2b1/A4a 的守門本體由它們自己的
#    harness 承重,這裡只證「本 RPC 有把它翻譯成固定碼、且沒有重複實作」。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a5a-work}"
URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
AURL="${URL}?application_name=a5a_sess_a"
FN="public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text)"
MIGFILE="supabase/migrations/20260803160000_m4b_e10_a5a_admin_upsert_item_procurement.sql"
PASS=0; FAIL=0; SKIP=0; MUT=0; CELL=0
EXPECTED_TOTAL=144
EXPECTED_MUT=8
EXPECTED_CELL=127

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
cell() { CELL=$((CELL+$1)); }
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(六重;照 a4a 五重 + 本片函式存在)────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;紅色判定依賴英文 ERROR 前綴;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE oid = '$FN'::regprocedure")" = "1" ] \
  || { echo "🔴 A5a 未套(函式不在);先 psql -f $MIGFILE"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN ('order_item_procurement_allocation_guard_ac','order_item_procurement_summary_recompute_zc') AND NOT tgisinternal AND tgenabled='O'")" = "2" ] \
  || { echo "🔴 A2b1/A4a trigger 不在或非 enabled O(上一輪突變殘留?);拒跑"; exit 1; }

# ── 判定原語 ─────────────────────────────────────────────────
# case_ok label body —— body 內以 RAISE 表示失敗;全程 BEGIN…ROLLBACK
case_ok() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then ok "$label"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|FATAL' | cut -c1-170)"; fi
}

# code_case label 期望碼 setup 呼叫引數 —— 斷言 RPC 回傳恰為期望碼
code_case() {
  local label="$1" want="$2" setup="$3" call="$4" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$setup
DO \$a5a\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement($call);
  IF v_got IS DISTINCT FROM '$want' THEN
    RAISE EXCEPTION 'A5A_CODE_MISMATCH:期望 $want 實得 %', coalesce(v_got, '<NULL>');
  END IF;
  RAISE NOTICE 'A5A_CODE_OK';
END
\$a5a\$;
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'A5A_CODE_OK'; then ok "$label ⇒ $want"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|A5A_' | cut -c1-170)"; fi
}

# raise_case label 期望SQLSTATE(空=任意) setup 呼叫引數 —— 斷言 RPC 丟例外(RAISE 面)
raise_case() {
  local label="$1" state="$2" setup="$3" call="$4" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$setup
DO \$a5a\$
DECLARE v_got text;
BEGIN
  BEGIN
    v_got := public.admin_upsert_item_procurement($call);
    RAISE EXCEPTION 'A5A_NOT_RAISED:竟回傳 %', coalesce(v_got, '<NULL>');
  EXCEPTION WHEN SQLSTATE '${state:-P0001}' THEN
    RAISE NOTICE 'A5A_RAISE_OK';
  END;
END
\$a5a\$;
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'A5A_RAISE_OK'; then ok "$label ⇒ RAISE(${state:-P0001})"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|A5A_' | cut -c1-170)"; fi
}

# DB 內函式突變(照 a2b1/a4a mut_block;anchor 三重 preflight)
mut_block() {
  cat <<'MUTSQL'
DO $mut$
DECLARE
  v_oid oid := current_setting('harness.mut_fnsig')::regprocedure;
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
$mut$;
MUTSQL
}

# mutate_fn label mfrom mto occ setup attack —— attack 觀察到翻面時印 A5A_FLIP_OK
mutate_fn() {
  local label="$1" mfrom="$2" mto="$3" want_occ="$4" setup="$5" attack="$6" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfn="$FN" -v mfrom="$mfrom" -v mto="$mto" -v mocc="$want_occ" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_fnsig', :'mfn',   true);
SELECT set_config('harness.mut_from',  :'mfrom', true);
SELECT set_config('harness.mut_to',    :'mto',   true);
SELECT set_config('harness.mut_occ',   :'mocc',  true);
$(mut_block)
$setup
$attack
ROLLBACK;
SQL
)"
  local rc=$?
  MUT=$((MUT+1))
  if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'A5A_FLIP_OK'; then ok "突變 $label ⇒ 行為翻面被觀察到"
  else bad "突變 $label ⇒ $(printf '%s' "$out" | grep -m1 -E 'ERROR|A5A_' | cut -c1-170)"; fi
}

# ── 單連線 FIFO session(D 區 barrier;照 a4a:170-180)────────
PA=""
wait_idle_a() {
  local i st
  for i in $(seq 1 60); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name='a5a_sess_a' LIMIT 1" 2>/dev/null)"
    # aborted 也是 idle 的一種(A 的語句失敗了)—— 不能無限等,但 D 區每格會自己斷言結果,
    # 真的 abort 時該格的期望碼就對不上而翻紅,不會假綠。
    case "$st" in "idle in transaction"|"idle in transaction (aborted)"|idle) return 0 ;; esac
    sleep 0.5
  done
  echo "  🔴 barrier 逾時:session A 30 秒未回 idle(state=$st);中止不假裝跑過"; exit 1
}
open1() { rm -f "$WORK/a5a-fa"; mkfifo "$WORK/a5a-fa"; ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$WORK/a5a-fa" > "$WORK/a5a-outa.txt" 2>&1 ) & PA=$!; exec 3>"$WORK/a5a-fa"; wait_idle_a; }
# 🔴 關卡2 MF10:泛化的 wait_event_type='Lock' 只證明「B 在等某個鎖」,不證明「擋它的是 A」——
#    B 可能卡在別的東西上而該格照樣綠。改用 pg_blocking_pids() 明確指認 session A 的 pid,
#    並要求 blocker 集合**恰為** {A}(不只是包含 A)。回 1 = 真的被 A 擋住。
blocked_by_a() {
  local tag="$1"
  psql "$URL" -tAX -c "
    SELECT count(*) FROM pg_stat_activity b
     WHERE b.query LIKE '%${tag}%' AND b.pid <> pg_backend_pid()
       AND pg_blocking_pids(b.pid) = ARRAY(
             SELECT a.pid FROM pg_stat_activity a WHERE a.application_name='a5a_sess_a')
       AND cardinality(pg_blocking_pids(b.pid)) = 1" 2>/dev/null
}
send1() { printf '%s\n' "$1" >&3; wait_idle_a; }
close1() { exec 3>&- 2>/dev/null || true; [ -n "$PA" ] && wait "$PA" 2>/dev/null || true; PA=""; }

echo "== A5a verify($(date '+%H:%M:%S'))WORK=$WORK =="

# ── H. harness 自檢(閘先證明會發火)──────────────────────────
echo "== H. harness 自檢 =="
count_gate 1 2 && bad "H1 自檢:count_gate 對錯數竟回真" || ok "H1 自檢:count_gate 對錯數回非 0(收尾三閘同一份實作)"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
BEGIN;
DO $h2$
DECLARE v_got text;
BEGIN
  v_got := 'CREATED';
  IF v_got IS DISTINCT FROM 'NO_CHANGE' THEN
    RAISE EXCEPTION 'A5A_CODE_MISMATCH:期望 NO_CHANGE 實得 %', v_got;
  END IF;
  RAISE NOTICE 'A5A_CODE_OK';
END
$h2$;
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A5A_CODE_OK' && bad "H2 自檢:code_case 形狀對不符的碼竟回 OK" \
  || ok "H2 自檢:code_case 對不符的碼會發火(判定不假綠)"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfn="$FN" -v mfrom="THIS_ANCHOR_DOES_NOT_EXIST" -v mto="x" -v mocc="1" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_fnsig', :'mfn',   true);
SELECT set_config('harness.mut_from',  :'mfrom', true);
SELECT set_config('harness.mut_to',    :'mto',   true);
SELECT set_config('harness.mut_occ',   :'mocc',  true);
$(mut_block)
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'anchor 未在函式定義中命中' \
  && ok "H3 自檢:突變 anchor 未命中會發火" || bad "H3 自檢:未命中竟未發火"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfn="$FN" -v mfrom="FOR SHARE" -v mto="FOR SHARE" -v mocc="9" <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_fnsig', :'mfn',   true);
SELECT set_config('harness.mut_from',  :'mfrom', true);
SELECT set_config('harness.mut_to',    :'mto',   true);
SELECT set_config('harness.mut_occ',   :'mocc',  true);
$(mut_block)
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -qE '突變(未套上|.*出現)' \
  && ok "H4 自檢:突變 occ 不符/無效替換會發火" || bad "H4 自檢:occ 不符竟未發火"

# ── 基準與 fixture(committed;EXIT trap 清除)────────────────
echo
echo "== 基準與 fixture =="
PROC_N0="$(q "SELECT count(*) FROM public.order_item_procurement")"
AUDIT_N0="$(q "SELECT count(*) FROM public.admin_audit_log")"
SUMM_N0="$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
SUPP_ACT0="$(q "SELECT count(*) FROM public.suppliers WHERE is_active")"
# 🔴 關卡2 MF6:只比「啟用數」的話,D2/D3 真的 UPDATE 過 suppliers ⇒ touch trigger 改掉 updated_at,
#    而收尾仍會宣稱零留痕。改成兩層:①除 updated_at 外的全欄指紋必須完全相同
#    ②updated_at 被動過的列數要被明確列出(committed barrier 格的已知代價,不假裝沒有)。
SUPP_FP0="$(q "SELECT md5(coalesce(string_agg(id::text||'|'||label||'|'||is_active::text, ',' ORDER BY id),''))
                 FROM public.suppliers")"
SUPP_TS0="$(q "SELECT md5(coalesce(string_agg(id::text||'|'||updated_at::text, ',' ORDER BY id),'')) FROM public.suppliers")"
[ -n "$PROC_N0" ] && [ -n "$AUDIT_N0" ] && [ -n "$SUMM_N0" ] && [ -n "$SUPP_ACT0" ] \
  && ok "基準已取(proc=$PROC_N0 audit=$AUDIT_N0 summ=$SUMM_N0 active_suppliers=$SUPP_ACT0)" || bad "基準取得失敗"

MUTATED=0
ORIGDEF_FILE="$WORK/a5a-fn-orig.sql"
cleanup_all() {
  close1 2>/dev/null || true
  if [ "$MUTATED" = "1" ] && [ -s "$ORIGDEF_FILE" ]; then
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
    if [ -n "${MD5_FN:-}" ] && [ "$(q "SELECT md5(pg_get_functiondef('$FN'::regprocedure))")" = "$MD5_FN" ]; then
      MUTATED=0
    else
      echo "🔴🔴 cleanup:mutant 還原失敗 —— 本庫仍是突變版" >&2
    fi
  fi
  psql "$URL" -tAX >/dev/null 2>&1 <<'CLEAN' || echo "🔴 cleanup:fixture 清理失敗(殘留)" >&2
BEGIN;
DELETE FROM public.admin_audit_log WHERE request_id LIKE 'a5a-%';
DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN
  (SELECT p.id FROM public.order_item_procurement p JOIN public.order_items i ON i.id=p.order_item_id
    WHERE i.variant_sku LIKE 'A5AV-%');
DELETE FROM public.order_item_procurement WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A5AV-%');
DELETE FROM public.order_item_quantity_summary WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A5AV-%');
UPDATE public.suppliers SET is_active = true WHERE NOT is_active;
COMMIT;
CLEAN
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9993-0001'" >/dev/null 2>&1 || true
  rm -f "$WORK/a5a-fa"
}
trap 'exit 130' INT TERM
trap cleanup_all EXIT

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_order uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'fixture 失敗:customers 為空'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE display_id='PCM-9993-0001') THEN
    RAISE EXCEPTION 'fixture 失敗:PCM-9993-0001 已存在';
  END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9993-0001', v_cust,
          jsonb_build_object('name','A5a 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A5AV-P5', '{"title":"a5a p5","sku":"A5AV-P5","spec":{}}'::jsonb, 5, 0, 0);
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A5AV-P1', '{"title":"a5a p1","sku":"A5AV-P1","spec":{}}'::jsonb, 1, 0, 0);
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "fixture 已建(PCM-9993-0001;P5 qty=5 / P1 qty=1;零採購)" \
  || bad "fixture 建立失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-170)"

ITEM5="$(q "SELECT id FROM public.order_items WHERE variant_sku='A5AV-P5'")"
ITEM1="$(q "SELECT id FROM public.order_items WHERE variant_sku='A5AV-P1'")"
SA="$(q "SELECT id FROM public.suppliers ORDER BY label LIMIT 1")"
SB="$(q "SELECT id FROM public.suppliers ORDER BY label OFFSET 1 LIMIT 1")"
SC="$(q "SELECT id FROM public.suppliers ORDER BY label OFFSET 2 LIMIT 1")"
if [ -n "$ITEM5" ] && [ -n "$ITEM1" ] && [ -n "$SA" ] && [ -n "$SB" ] && [ -n "$SC" ]; then
  ok "fixture id 已取(items×2、suppliers×3)"
else
  bad "fixture id 缺 —— 後續全部無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1
fi
MD5_FN="$(q "SELECT md5(pg_get_functiondef('$FN'::regprocedure))")"
psql "$URL" -tAX -c "SELECT pg_get_functiondef('$FN'::regprocedure)" > "$ORIGDEF_FILE" 2>/dev/null
[ -n "$MD5_FN" ] && [ -s "$ORIGDEF_FILE" ] && ok "函式 md5 基準 + 原始定義已存(突變還原用)" \
  || bad "md5 基準/原始定義取得失敗"

# 呼叫引數樣板(11 參數;$1..= 逐格覆寫)
# 順序:item, supplier, allocated, reply, channel, submitted, order_no, reason, arrival, actor, request
C_BASE="'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-1'"
C_FULL="'$ITEM5'::uuid, '$SA'::uuid, 2, 'confirmed', 'line', TIMESTAMPTZ '2026-07-01 10:00+08', 'SO-123', '缺貨等待', DATE '2026-09-01', 'sean', 'a5a-2'"
MK_BASE="SELECT public.admin_upsert_item_procurement($C_BASE);"
MK_FULL="SELECT public.admin_upsert_item_procurement($C_FULL);"

echo
echo "== A. 結構格(6 cells;與 migration 檔內 DO 獨立重證)=="
PRE=$((PASS+FAIL))
[ "$(q "SELECT prosecdef FROM pg_proc WHERE oid='$FN'::regprocedure")" = "t" ] \
  && ok "[A1] SECURITY DEFINER" || bad "[A1] 非 SECDEF"
[ "$(q "SELECT array_to_string(proconfig,',') FROM pg_proc WHERE oid='$FN'::regprocedure")" = "search_path=public, pg_temp" ] \
  && ok "[A2] search_path 釘死" || bad "[A2] proconfig 不符"
[ "$(q "SELECT string_agg(pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable, ',' ORDER BY 1)
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
       WHERE p.oid='$FN'::regprocedure AND a.grantee <> p.proowner")" = "service_role:EXECUTE:false" ] \
  && ok "[A3] 函式 ACL 恰 service_role:EXECUTE:false" || bad "[A3] 函式 ACL 不符"
[ "$(q "SELECT has_function_privilege('anon','$FN','EXECUTE') OR has_function_privilege('authenticated','$FN','EXECUTE')")" = "f" ] \
  && ok "[A4] anon/authenticated 無 EXECUTE" || bad "[A4] client role 竟可執行"
[ "$(q "SELECT string_agg(pg_get_userbyid(a.grantee)||':'||a.privilege_type, ',' ORDER BY 1)
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
       WHERE c.oid='public.order_item_procurement'::regclass AND a.grantee <> c.relowner")" = "service_role:SELECT" ] \
  && ok "[A5] 採購表仍只有 service_role SELECT(本 RPC 是唯一應用寫入口的前提)" || bad "[A5] 採購表 ACL 被放寬"
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.order_item_procurement'::regclass AND NOT attisdropped AND attacl IS NOT NULL")" = "0" ] \
  && ok "[A6] 採購表零欄級 ACL" || bad "[A6] 出現欄級 ACL 後門"
cell $(( (PASS+FAIL) - PRE ))

echo
echo "== B. 正向與碼面(32 cells)=="
PRE=$((PASS+FAIL))
code_case "[B1] 首建" CREATED "" "$C_BASE"
case_ok "[B1b] 首建副作用:列落地 + 兩戳記同值 + 摘要連動 + 稽核恰 1 筆" "
$MK_BASE
DO \$b\$
DECLARE v_p public.order_item_procurement%ROWTYPE; v_s integer; v_a integer; v_t text; v_j jsonb;
BEGIN
  SELECT * INTO v_p FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
  IF NOT FOUND THEN RAISE EXCEPTION '列未落地'; END IF;
  IF v_p.allocated_quantity<>2 OR v_p.reply_status<>'no_reply' OR v_p.received_quantity<>0 THEN
    RAISE EXCEPTION '欄值不符:alloc=% reply=% recv=%', v_p.allocated_quantity, v_p.reply_status, v_p.received_quantity; END IF;
  IF v_p.first_ordered_at IS NULL OR v_p.status_changed_at IS NULL THEN RAISE EXCEPTION '戳記為 NULL'; END IF;
  IF v_p.first_ordered_at <> v_p.status_changed_at THEN RAISE EXCEPTION '首建時兩戳記應同值'; END IF;
  SELECT ordered_quantity INTO v_s FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_s IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'A4a 摘要未連動:%', coalesce(v_s::text,'<缺列>'); END IF;
  SELECT count(*) INTO v_a FROM public.admin_audit_log WHERE request_id='a5a-1';
  IF v_a<>1 THEN RAISE EXCEPTION '稽核應恰 1 筆,實 %', v_a; END IF;
  SELECT action||'|'||target INTO v_t FROM public.admin_audit_log WHERE request_id='a5a-1';
  IF v_t <> 'procurement.create|procurement:'||v_p.id::text THEN RAISE EXCEPTION '稽核 action/target 不符:%', v_t; END IF;
  IF (SELECT before IS NOT NULL FROM public.admin_audit_log WHERE request_id='a5a-1') THEN
    RAISE EXCEPTION '新建的稽核 before 應為 NULL'; END IF;
  -- 🔴 關卡2 MF7:只驗一欄的話,after 少寫/寫錯其餘六欄照樣全綠。逐欄 + 兩鍵一起釘。
  SELECT after INTO v_j FROM public.admin_audit_log WHERE request_id='a5a-1';
  IF v_j->>'order_item_id' <> '$ITEM5' OR v_j->>'supplier_id' <> '$SA'
     OR v_j->>'allocated_quantity' <> '2' OR v_j->>'reply_status' <> 'no_reply'
     OR v_j->>'contact_channel' IS NOT NULL OR v_j->>'submitted_at' IS NOT NULL
     OR v_j->>'supplier_order_no' IS NOT NULL OR v_j->>'exception_reason' IS NOT NULL
     OR v_j->>'expected_arrival_date' IS NOT NULL THEN
    RAISE EXCEPTION '稽核 after 九鍵未逐欄吻合:%', v_j::text; END IF;
END \$b\$;"
code_case "[B2] 同 payload 重放" NO_CHANGE "$MK_BASE" "$C_BASE"
case_ok "[B2b] 重放副作用:零寫入、兩戳記不動、稽核不增" "
$MK_BASE
DO \$b\$
DECLARE v_t1 timestamptz; v_t2 timestamptz; v_n1 integer; v_got text;
BEGIN
  SELECT first_ordered_at, status_changed_at INTO v_t1, v_t2 FROM public.order_item_procurement
   WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
  SELECT count(*) INTO v_n1 FROM public.admin_audit_log WHERE request_id LIKE 'a5a-%';
  PERFORM pg_sleep(0.01);
  v_got := public.admin_upsert_item_procurement($C_BASE);
  IF v_got <> 'NO_CHANGE' THEN RAISE EXCEPTION '重放應 NO_CHANGE,實 %', v_got; END IF;
  IF (SELECT first_ordered_at FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA') <> v_t1
     OR (SELECT status_changed_at FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA') <> v_t2 THEN
    RAISE EXCEPTION '重放竟動了時間戳'; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE request_id LIKE 'a5a-%') <> v_n1 THEN
    RAISE EXCEPTION '重放竟寫了稽核'; END IF;
END \$b\$;"
case_ok "[B2c] 供應商事後停用 → 同 payload 重放仍 NO_CHANGE(A9h 冪等不被狀態轉換擊破)" "
$MK_BASE
UPDATE public.suppliers SET is_active=false WHERE id='$SA';
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement($C_BASE);
  IF v_got <> 'NO_CHANGE' THEN RAISE EXCEPTION '停用後重放應 NO_CHANGE,實 %', v_got; END IF;
END \$b\$;"
code_case "[B3] 改回覆狀態 → UPDATED" UPDATED "$MK_BASE" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'confirmed', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-3'"
case_ok "[B3b] 更新副作用:status_changed_at 動 / first_ordered_at 不動 / 稽核 before-after / target 非 NULL" "
$MK_BASE
DO \$b\$
DECLARE v_f0 timestamptz; v_f1 timestamptz; v_s1 timestamptz; v_id uuid; v_got text; v_r record;
BEGIN
  -- 🔴 關卡2 n4:上一版把更新後的值覆寫回 v_f1 再跟「同一列現值」比 = 恆真斷言。
  --    改成 v_f0(更新前)vs v_f1(更新後)兩個獨立快照。
  SELECT id, first_ordered_at INTO v_id, v_f0
    FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
  PERFORM pg_sleep(0.01);
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'confirmed', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-3');
  IF v_got <> 'UPDATED' THEN RAISE EXCEPTION '應 UPDATED,實 %', v_got; END IF;
  SELECT first_ordered_at, status_changed_at INTO v_f1, v_s1 FROM public.order_item_procurement WHERE id=v_id;
  IF v_f1 <> v_f0 THEN RAISE EXCEPTION 'first_ordered_at 竟被更新動到:% → %', v_f0, v_f1; END IF;
  IF v_s1 <= v_f1 THEN RAISE EXCEPTION 'status_changed_at 應晚於 first_ordered_at(首寫語意):f=% s=%', v_f1, v_s1; END IF;
  SELECT * INTO v_r FROM public.admin_audit_log WHERE request_id='a5a-3';
  IF v_r.action <> 'procurement.update' THEN RAISE EXCEPTION 'action 應為 procurement.update,實 %', v_r.action; END IF;
  IF v_r.target <> 'procurement:'||v_id::text THEN RAISE EXCEPTION 'target 不得落 NULL/錯值:%', v_r.target; END IF;
  -- 🔴 MF7:before/after **七欄逐欄**(只比 reply_status 的話,其餘六欄寫錯仍全綠)
  IF v_r.before->>'allocated_quantity' <> '2' OR v_r.before->>'reply_status' <> 'no_reply'
     OR v_r.before->>'contact_channel' IS NOT NULL OR v_r.before->>'submitted_at' IS NOT NULL
     OR v_r.before->>'supplier_order_no' IS NOT NULL OR v_r.before->>'exception_reason' IS NOT NULL
     OR v_r.before->>'expected_arrival_date' IS NOT NULL THEN
    RAISE EXCEPTION 'before 七欄未逐欄吻合:%', v_r.before::text; END IF;
  IF v_r.after->>'allocated_quantity' <> '2' OR v_r.after->>'reply_status' <> 'confirmed'
     OR v_r.after->>'contact_channel' IS NOT NULL OR v_r.after->>'submitted_at' IS NOT NULL
     OR v_r.after->>'supplier_order_no' IS NOT NULL OR v_r.after->>'exception_reason' IS NOT NULL
     OR v_r.after->>'expected_arrival_date' IS NOT NULL THEN
    RAISE EXCEPTION 'after 七欄未逐欄吻合:%', v_r.after::text; END IF;
END \$b\$;"
# B3c 七欄逐欄更新矩陣(R3-F4/R1-7):每欄單改 → UPDATED + 落庫值;再重放 → NO_CHANGE
# 🔴 分隔符用 | 不用 :(欄位內含 ::text 與 HH24:MI,用冒號會把樣板切壞 —— 本片實測踩到)
for pair in \
  "allocated|3, 'no_reply', NULL, NULL, NULL, NULL, NULL|allocated_quantity::text|3" \
  "reply|2, 'partial', NULL, NULL, NULL, NULL, NULL|reply_status|partial" \
  "channel|2, 'no_reply', 'phone', NULL, NULL, NULL, NULL|contact_channel|phone" \
  "submitted|2, 'no_reply', NULL, TIMESTAMPTZ '2026-07-02 09:00+08', NULL, NULL, NULL|to_char(submitted_at AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD HH24:MI')|2026-07-02 09:00" \
  "orderno|2, 'no_reply', NULL, NULL, 'SO-9', NULL, NULL|supplier_order_no|SO-9" \
  "reason|2, 'no_reply', NULL, NULL, NULL, '對方缺料', NULL|exception_reason|對方缺料" \
  "arrival|2, 'no_reply', NULL, NULL, NULL, NULL, DATE '2026-10-05'|expected_arrival_date::text|2026-10-05" ; do
  IFS='|' read -r nm args col want <<EOF2
$pair
EOF2
  case_ok "[B3c-$nm] 單欄更新 → UPDATED + 落庫值 = $want,再重放 → NO_CHANGE" "
$MK_BASE
DO \$b\$
DECLARE v_got text; v_val text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, $args, 'sean', 'a5a-c-$nm');
  IF v_got <> 'UPDATED' THEN RAISE EXCEPTION '單欄更新應 UPDATED,實 %', v_got; END IF;
  SELECT $col INTO v_val FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
  IF v_val IS DISTINCT FROM '$want' THEN RAISE EXCEPTION '落庫值應 % 實 %', '$want', coalesce(v_val,'<NULL>'); END IF;
  -- 🔴 關卡2 MF7:七種更新各自都要留稽核(否則「只有改 reply 才寫 audit」照樣全綠)
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                  WHERE request_id='a5a-c-$nm' AND action='procurement.update') THEN
    RAISE EXCEPTION '本欄更新未留稽核(action=procurement.update)'; END IF;
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, $args, 'sean', 'a5a-c2-$nm');
  IF v_got <> 'NO_CHANGE' THEN RAISE EXCEPTION '同值重放應 NO_CHANGE,實 %', v_got; END IF;
END \$b\$;"
done
case_ok "[B3d] 非 NULL → NULL 是合法更新(全量 payload 語意;呼叫端漏欄會清空 = 債② 的理由)" "
$MK_FULL
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'confirmed', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-n1');
  IF v_got <> 'UPDATED' THEN RAISE EXCEPTION '清空應 UPDATED,實 %', v_got; END IF;
  IF (SELECT supplier_order_no IS NOT NULL OR exception_reason IS NOT NULL OR contact_channel IS NOT NULL
        FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA') THEN
    RAISE EXCEPTION '選填欄未被清成 NULL'; END IF;
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'confirmed', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-n2');
  IF v_got <> 'NO_CHANGE' THEN RAISE EXCEPTION 'NULL→NULL 應 NO_CHANGE,實 %', v_got; END IF;
END \$b\$;"
case_ok "[B4] 調升到上界(5 = quantity)→ UPDATED 且 A4a 摘要跟著變(關卡2 MF12:plan 宣稱驗連動)" "
$MK_BASE
DO \$b\$
DECLARE v_got text; v_s integer;
BEGIN
  SELECT ordered_quantity INTO v_s FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_s IS DISTINCT FROM 2 THEN RAISE EXCEPTION '前提:摘要應為 2,實 %', coalesce(v_s::text,'<缺列>'); END IF;
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 5, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-4');
  IF v_got <> 'UPDATED' THEN RAISE EXCEPTION '應 UPDATED,實 %', v_got; END IF;
  SELECT ordered_quantity INTO v_s FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_s IS DISTINCT FROM 5 THEN RAISE EXCEPTION '調升後摘要應為 5,實 %(A4a 漏掉 UPDATE 事件)', coalesce(v_s::text,'<缺列>'); END IF;
END \$b\$;"
code_case "[B5] 首建超量(6 > quantity 5)⇒ A2b1 翻譯" OVER_ALLOCATION "" "'$ITEM5'::uuid, '$SA'::uuid, 6, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-5'"
case_ok "[B5b] 超量後零列零稽核(子交易回滾乾淨)" "
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 6, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-5b');
  IF v_got <> 'OVER_ALLOCATION' THEN RAISE EXCEPTION '應 OVER_ALLOCATION,實 %', v_got; END IF;
  IF EXISTS (SELECT 1 FROM public.order_item_procurement WHERE order_item_id='$ITEM5') THEN
    RAISE EXCEPTION '超量竟留下採購列'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id='a5a-5b') THEN
    RAISE EXCEPTION '超量竟寫了稽核'; END IF;
END \$b\$;"
code_case "[B6] 調升超量(2→6)⇒ 翻譯" OVER_ALLOCATION "$MK_BASE" "'$ITEM5'::uuid, '$SA'::uuid, 6, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-6'"
code_case "[B6b] 兩家合計超量(A 家 3 + B 家 3 > 5)" OVER_ALLOCATION "
SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 3, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-6b1');" \
  "'$ITEM5'::uuid, '$SB'::uuid, 3, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-6b2'"
code_case "[B7] 調降到低於已到貨(到貨 2、調降至 1)⇒ 固定碼非 raw 23514" ALLOCATED_BELOW_RECEIVED "
$MK_BASE
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT id, 2, now(), 'sean' FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';" \
  "'$ITEM5'::uuid, '$SA'::uuid, 1, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-7'"
code_case "[B7b] 調降到恰等於已到貨(邊界合法)" UPDATED "
SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 4, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-7b0');
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT id, 2, now(), 'sean' FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';" \
  "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-7b'"
code_case "[B8] 停用供應商 → 新建被拒(row 32 指定負測)" SUPPLIER_INACTIVE "
UPDATE public.suppliers SET is_active=false WHERE id='$SA';" "$C_BASE"
code_case "[B8b] 停用供應商 → 既有列調升被拒(Q1=A:調升 = 下新單)" SUPPLIER_INACTIVE "
$MK_BASE
UPDATE public.suppliers SET is_active=false WHERE id='$SA';" \
  "'$ITEM5'::uuid, '$SA'::uuid, 3, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-8b'"
code_case "[B8c] 停用供應商 → 事實欄更新照常(Sean Q1=A 的核心)" UPDATED "
$MK_BASE
UPDATE public.suppliers SET is_active=false WHERE id='$SA';" \
  "'$ITEM5'::uuid, '$SA'::uuid, 2, 'out_of_stock', 'phone', NULL, NULL, '對方停業', NULL, 'sean', 'a5a-8c'"
code_case "[B8d] 停用供應商 → 調降照常(不是下新單)" UPDATED "
SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 3, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-8d0');
UPDATE public.suppliers SET is_active=false WHERE id='$SA';" \
  "'$ITEM5'::uuid, '$SA'::uuid, 1, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-8d'"
code_case "[B9] 供應商不存在" SUPPLIER_NOT_FOUND "" \
  "'$ITEM5'::uuid, '00000000-0000-0000-0000-0000000000ff'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-9'"
code_case "[B10] 品項不存在" ORDER_ITEM_NOT_FOUND "" \
  "'00000000-0000-0000-0000-0000000000ee'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-10'"
code_case "[B11] 同品項第二家供應商 → CREATED(1:N)" CREATED "$MK_BASE" \
  "'$ITEM5'::uuid, '$SB'::uuid, 3, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-11'"
case_ok "[B11b] 兩家並存 ⇒ 摘要 = 兩列 SUM" "
$MK_BASE
SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SB'::uuid, 3, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-11b');
DO \$b\$
DECLARE v_s integer;
BEGIN
  SELECT ordered_quantity INTO v_s FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_s IS DISTINCT FROM 5 THEN RAISE EXCEPTION '摘要應為 2+3=5,實 %', coalesce(v_s::text,'<缺列>'); END IF;
END \$b\$;"
code_case "[B12] 全欄 payload 首建" CREATED "" "$C_FULL"
case_ok "[B12b] 全欄落庫值逐欄正確" "
$MK_FULL
DO \$b\$
DECLARE v_p public.order_item_procurement%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
  IF v_p.reply_status<>'confirmed' OR v_p.contact_channel<>'line' OR v_p.supplier_order_no<>'SO-123'
     OR v_p.exception_reason<>'缺貨等待' OR v_p.expected_arrival_date<>DATE '2026-09-01'
     OR v_p.submitted_at<>TIMESTAMPTZ '2026-07-01 10:00+08' THEN
    RAISE EXCEPTION '全欄落庫值不符'; END IF;
END \$b\$;"
cell $(( (PASS+FAIL) - PRE ))

echo
echo "== B-INV. 輸入驗證碼面(38 cells;每碼至少一案可達 + 端點/隱形字/時區漂移)=="
PRE=$((PASS+FAIL))
code_case "[I1] order_item_id NULL" INVALID_INPUT "" "NULL::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i1'"
code_case "[I2] supplier_id NULL" INVALID_INPUT "" "'$ITEM5'::uuid, NULL::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i2'"
code_case "[I3] allocated NULL" INVALID_ALLOCATED "" "'$ITEM5'::uuid, '$SA'::uuid, NULL, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i3'"
code_case "[I4] allocated 0" INVALID_ALLOCATED "" "'$ITEM5'::uuid, '$SA'::uuid, 0, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i4'"
code_case "[I5] allocated 100001" INVALID_ALLOCATED "" "'$ITEM5'::uuid, '$SA'::uuid, 100001, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i5'"
code_case "[I6] reply NULL(不默認)" INVALID_REPLY_STATUS "" "'$ITEM5'::uuid, '$SA'::uuid, 2, NULL, NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i6'"
code_case "[I7] reply 非 allowlist" INVALID_REPLY_STATUS "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'bogus', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i7'"
code_case "[I8] channel 含控制字元" INVALID_CONTACT_CHANNEL "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', E'li\tne', NULL, NULL, NULL, NULL, 'sean', 'a5a-i8'"
code_case "[I9] channel 超長" INVALID_CONTACT_CHANNEL "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', repeat('x',201), NULL, NULL, NULL, NULL, 'sean', 'a5a-i9'"
code_case "[I10] 單號內含零寬(U+200B)" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO' || U&'\\200B' || '9', NULL, NULL, 'sean', 'a5a-i10'"
code_case "[I11] 單號內含盲文空白(U+2800;A2 CHECK 放行、本片擋)" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO' || U&'\\2800' || '9', NULL, NULL, 'sean', 'a5a-i11'"
code_case "[I12] 單號內含軟連字號(U+00AD)" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO' || U&'\\00AD' || '9', NULL, NULL, 'sean', 'a5a-i12'"
code_case "[I13] 單號內含 Hangul filler(U+3164)" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO' || U&'\\3164' || '9', NULL, NULL, 'sean', 'a5a-i13'"
# 🔴 A2 的單號 regex(20260729020000:99)只擋**首尾**空白,`.*` 允許內部空白 ⇒ 'SO 9' 合法。
#    本片鏡像該 CHECK、不加嚴(加嚴會讓 A2 已放行的既有資料形狀在 RPC 這層被拒 = 兩套規則)。
code_case "[I14] 單號內含一般空白 ⇒ 照 A2 放行(只擋首尾,不擋內部)" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO 9', NULL, NULL, 'sean', 'a5a-i14'"
code_case "[I15] 異常原因超長(>500)" INVALID_EXCEPTION_REASON "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, repeat('長',501), NULL, 'sean', 'a5a-i15'"
code_case "[I16] submitted_at 界外(1999)" SUBMITTED_AT_OUT_OF_RANGE "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '1999-01-01', NULL, NULL, NULL, 'sean', 'a5a-i16'"
code_case "[I17] submitted_at 未來(+1 day)" SUBMITTED_AT_IN_FUTURE "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, clock_timestamp() + interval '1 day', NULL, NULL, NULL, 'sean', 'a5a-i17'"
code_case "[I18] expected_arrival 界外(2101)" EXPECTED_ARRIVAL_OUT_OF_RANGE "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, DATE '2101-01-01', 'sean', 'a5a-i18'"
code_case "[I19] expected_arrival 未來合法(2026-12-31)" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, DATE '2026-12-31', 'sean', 'a5a-i19'"
# 🔴 關卡2 MF11 補格:allowlist 剩下的值、時間界的**端點**、單號的長度與控制字元、
#    reason 的控制字元、以及 v_zw 裡尚未被任何格碰到的三種零寬 —— 這些規則壞掉時原本仍會全綠。
for rs in confirmed price_changed out_of_stock partial; do
  code_case "[I20-$rs] reply allowlist 值 $rs 可達" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, '$rs', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-i20-$rs'"
done
code_case "[I21] submitted_at 恰在下界端點(2020-01-01Z)⇒ 開區間、拒" SUBMITTED_AT_OUT_OF_RANGE "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '2020-01-01 00:00:00+00', NULL, NULL, NULL, 'sean', 'a5a-i21'"
# 🔴 本片自測抓到(關卡1/2 皆未抓):界的字面若不帶偏移,判定會隨呼叫端 session TimeZone 漂移。
#    這一格把「同一輸入在兩個時區下結果相同」釘住 —— 拿掉 migration 裡的 +00 就會翻紅。
code_case "[I21b] 同一端點在 UTC session 下判定不變(時區漂移守門)" SUBMITTED_AT_OUT_OF_RANGE "
SET LOCAL TimeZone='UTC';" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '2020-01-01 00:00:00+00', NULL, NULL, NULL, 'sean', 'a5a-i21b'"
code_case "[I21c] 同一端點在 America/New_York session 下判定不變" SUBMITTED_AT_OUT_OF_RANGE "
SET LOCAL TimeZone='America/New_York';" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '2020-01-01 00:00:00+00', NULL, NULL, NULL, 'sean', 'a5a-i21c'"
code_case "[I22] submitted_at 剛過下界(+1 秒)⇒ 收" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '2020-01-01 00:00:01+00', NULL, NULL, NULL, 'sean', 'a5a-i22'"
code_case "[I23] submitted_at 未來但在 5 分鐘寬限內 ⇒ 收(裝置時鐘偏移)" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, clock_timestamp() + interval '2 minutes', NULL, NULL, NULL, 'sean', 'a5a-i23'"
code_case "[I24] expected_arrival 恰在下界端點(2020-01-01)⇒ 閉區間、收" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, DATE '2020-01-01', 'sean', 'a5a-i24'"
code_case "[I25] expected_arrival 恰在上界端點(2100-01-01)⇒ 閉區間、收" CREATED "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, DATE '2100-01-01', 'sean', 'a5a-i25'"
code_case "[I26] 單號超長(>200)" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, repeat('S',201), NULL, NULL, 'sean', 'a5a-i26'"
code_case "[I27] 單號含控制字元" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, E'SO\t9', NULL, NULL, 'sean', 'a5a-i27'"
code_case "[I28] 異常原因含控制字元" INVALID_EXCEPTION_REASON "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, E'缺\t料', NULL, 'sean', 'a5a-i28'"
for zw in 200C 200D FEFF; do
  code_case "[I29-$zw] 單號內含 U+$zw(v_zw 逐碼位可達)" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO' || U&'\\$zw' || '9', NULL, NULL, 'sean', 'a5a-i29-$zw'"
done
cell $(( (PASS+FAIL) - PRE ))

echo
echo "== B-NORM. 正規化(6 cells;三文字欄各兩格)=="
PRE=$((PASS+FAIL))
case_ok "[N1] 三欄前後空白被剝(落庫值乾淨)" "
DO \$b\$
DECLARE v_p public.order_item_procurement%ROWTYPE; v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply',
             '  line  ', NULL, '  SO-77  ', '  缺料  ', NULL, 'sean', 'a5a-nm1');
  IF v_got <> 'CREATED' THEN RAISE EXCEPTION '應 CREATED,實 %', v_got; END IF;
  SELECT * INTO v_p FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
  IF v_p.contact_channel <> 'line' THEN RAISE EXCEPTION 'channel 未剝空白:[%]', v_p.contact_channel; END IF;
  IF v_p.supplier_order_no <> 'SO-77' THEN RAISE EXCEPTION '單號未剝空白:[%]', v_p.supplier_order_no; END IF;
  IF v_p.exception_reason <> '缺料' THEN RAISE EXCEPTION '異常原因未剝空白:[%]', v_p.exception_reason; END IF;
END \$b\$;"
for pair in "channel:'  line  ':'line':contact_channel" "orderno:'  SO-77  ':'SO-77':supplier_order_no" "reason:'  缺料  ':'缺料':exception_reason"; do
  IFS=':' read -r nm padded clean col <<EOF3
$pair
EOF3
  case_ok "[N2-$nm] 帶空白版寫入後、乾淨值重放 → NO_CHANGE(冪等靠正規化在比對之前)" "
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply',
             CASE WHEN '$col'='contact_channel' THEN $padded ELSE NULL END, NULL,
             CASE WHEN '$col'='supplier_order_no' THEN $padded ELSE NULL END,
             CASE WHEN '$col'='exception_reason' THEN $padded ELSE NULL END,
             NULL, 'sean', 'a5a-nm2-$nm');
  IF v_got <> 'CREATED' THEN RAISE EXCEPTION '首建應 CREATED,實 %', v_got; END IF;
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply',
             CASE WHEN '$col'='contact_channel' THEN $clean ELSE NULL END, NULL,
             CASE WHEN '$col'='supplier_order_no' THEN $clean ELSE NULL END,
             CASE WHEN '$col'='exception_reason' THEN $clean ELSE NULL END,
             NULL, 'sean', 'a5a-nm3-$nm');
  IF v_got <> 'NO_CHANGE' THEN RAISE EXCEPTION '乾淨值重放應 NO_CHANGE,實 %(該欄漏 btrim)', v_got; END IF;
END \$b\$;"
done
case_ok "[N3] 肉眼全空(U+2800 / 全形空白)→ 正規化成 NULL、不是假值" "
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply',
             U&'\\2800' || U&'\\3000', NULL, NULL, U&'\\00AD', NULL, 'sean', 'a5a-nm4');
  IF v_got <> 'CREATED' THEN RAISE EXCEPTION '應 CREATED,實 %', v_got; END IF;
  IF (SELECT contact_channel IS NOT NULL OR exception_reason IS NOT NULL
        FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA') THEN
    RAISE EXCEPTION '肉眼全空的值竟入庫成非 NULL'; END IF;
END \$b\$;"
case_ok "[N4] 單號全空白 → NULL(不撞 A2 的 regex CHECK)" "
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply',
             NULL, NULL, '   ', NULL, NULL, 'sean', 'a5a-nm5');
  IF v_got <> 'CREATED' THEN RAISE EXCEPTION '應 CREATED,實 %', v_got; END IF;
  IF (SELECT supplier_order_no IS NOT NULL FROM public.order_item_procurement
       WHERE order_item_id='$ITEM5' AND supplier_id='$SA') THEN
    RAISE EXCEPTION '全空白單號竟入庫成非 NULL'; END IF;
END \$b\$;"
cell $(( (PASS+FAIL) - PRE ))

echo
echo "== B-RAISE/ACL/ISO. caller 面與環境面(11 cells)=="
PRE=$((PASS+FAIL))
raise_case "[R1] actor NULL" "" "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, NULL, 'a5a-r1'"
raise_case "[R2] actor 全空白" "" "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, '   ', 'a5a-r2'"
raise_case "[R3] actor 含控制字元" "" "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, E'se\tan', 'a5a-r3'"
raise_case "[R4] request_id NULL" "" "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', NULL"
raise_case "[R5] request_id 全空白" "" "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', '   '"
case_ok "[R6] actor/request 寫進稽核的是剝過空白的值(稽核鍵不被靜默分裂)" "
DO \$b\$
BEGIN
  PERFORM public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply',
            NULL, NULL, NULL, NULL, NULL, '  sean  ', '  a5a-r6  ');
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id='a5a-r6' AND actor='sean') THEN
    RAISE EXCEPTION '稽核未存剝過空白的 actor/request_id'; END IF;
END \$b\$;"
o="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT public.admin_upsert_item_procurement($C_BASE);
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A5a 隔離閘' && ok "[R7] REPEATABLE READ 下呼叫 ⇒ 隔離閘 P2B02" || bad "[R7] RR 竟未被隔離閘擋:$(printf '%s' "$o"|head -2|tr '\n' ' ')"
o="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT public.admin_upsert_item_procurement($C_BASE);
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A5a 隔離閘' && ok "[R8] SERIALIZABLE 下亦拒(不信 SSI,同 A2b1 Q1=A)" || bad "[R8] SERIALIZABLE 竟放行"
code_case "[R9] 呼叫端先 SET CONSTRAINTS DEFERRED,超量仍回固定碼(步 0b 關掉逃逸)" OVER_ALLOCATION "
SET CONSTRAINTS public.order_item_procurement_allocation_guard_ac, public.order_item_procurement_summary_recompute_zc DEFERRED;" \
  "'$ITEM5'::uuid, '$SA'::uuid, 9, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-r9'"
case_ok "[R10] received_quantity 全程 0 且直寫仍被 A4a 的 P4A01 擋(兄弟守門未被污染)" "
$MK_BASE
DO \$b\$
BEGIN
  IF (SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA') <> 0 THEN
    RAISE EXCEPTION '本 RPC 竟寫了 received_quantity'; END IF;
  BEGIN
    UPDATE public.order_item_procurement SET received_quantity=1 WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
    RAISE EXCEPTION '直寫 received_quantity 竟未被擋';
  EXCEPTION WHEN SQLSTATE 'P4A01' THEN NULL;
  END;
END \$b\$;"
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname='admin_upsert_item_procurement'")" = "1" ] \
  && ok "[R11] 同名函式全庫唯一(多載會讓呼叫端解析到別支)" || bad "[R11] 出現多載"
cell $(( (PASS+FAIL) - PRE ))

echo
echo "== C. 檢查順序衝突矩陣 + 拒絕碼零寫入(17 cells)=="
PRE=$((PASS+FAIL))
o="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, NULL, 'a5a-c01');
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A5a 隔離閘' && ok "[C0,1] RR + 缺 actor ⇒ 隔離閘先" || bad "[C0,1] 順序錯"
# 🔴 關卡2 MF9:plan 規定的 (0b,1) 格原本漏了 —— 少了它,把 SET CONSTRAINTS 移到 actor 驗證之後
#    R9/M8(actor 都合法)照樣綠,「步 0b 在步 1 之前」這條順序宣稱沒有任何格釘住。
#    構造:外層先 defer 兩支 constraint 並製造一筆 pending 超量,再以**缺 actor** 呼叫 ——
#    若 0b 真的在步 1 之前,SET CONSTRAINTS 會讓那筆 pending 先炸成 raw P2B01(而非 actor 的 RAISE)。
o="$(psql "$URL" -tAX <<SQL 2>&1
BEGIN;
SET CONSTRAINTS public.order_item_procurement_allocation_guard_ac, public.order_item_procurement_summary_recompute_zc DEFERRED;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, reply_status)
VALUES ('$ITEM5', '$SA', 9, 'no_reply');
SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, NULL, 'a5a-c0b1');
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A2b1 超量' \
  && ok "[C0b,1] 外層 pending 超量 + 缺 actor ⇒ SET CONSTRAINTS 先發火(步 0b 在步 1 之前)" \
  || bad "[C0b,1] 順序錯:期望先冒 A2b1 超量,實得 $(printf '%s' "$o" | grep -m1 -E 'ERROR' | cut -c1-120)"
raise_case "[C1,2] 缺 actor + NULL 鍵 ⇒ actor 的 RAISE 先於 INVALID_INPUT" "" "" "NULL::uuid, NULL::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, NULL, 'a5a-c12'"
code_case "[C2,3] NULL 鍵 + allocated 0 ⇒ INVALID_INPUT 先" INVALID_INPUT "" "NULL::uuid, '$SA'::uuid, 0, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-c23'"
code_case "[C3,4] allocated 0 + reply bogus ⇒ INVALID_ALLOCATED 先" INVALID_ALLOCATED "" "'$ITEM5'::uuid, '$SA'::uuid, 0, 'bogus', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-c34'"
code_case "[C4,5] reply bogus + channel 控制字元 ⇒ INVALID_REPLY_STATUS 先" INVALID_REPLY_STATUS "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'bogus', E'a\tb', NULL, NULL, NULL, NULL, 'sean', 'a5a-c45'"
code_case "[C5,6] channel 控制字元 + 單號零寬 ⇒ INVALID_CONTACT_CHANNEL 先" INVALID_CONTACT_CHANNEL "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', E'a\tb', NULL, 'SO' || U&'\\200B' || '9', NULL, NULL, 'sean', 'a5a-c56'"
code_case "[C6,7] 單號零寬 + 原因超長 ⇒ INVALID_SUPPLIER_ORDER_NO 先" INVALID_SUPPLIER_ORDER_NO "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, 'SO' || U&'\\200B' || '9', repeat('長',501), NULL, 'sean', 'a5a-c67'"
code_case "[C7,8] 原因超長 + submitted 界外 ⇒ INVALID_EXCEPTION_REASON 先" INVALID_EXCEPTION_REASON "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '1999-01-01', NULL, repeat('長',501), NULL, 'sean', 'a5a-c78'"
code_case "[C8a,8b] submitted 同時界外且未來(2101)⇒ OUT_OF_RANGE 先" SUBMITTED_AT_OUT_OF_RANGE "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '2101-06-01', NULL, NULL, NULL, 'sean', 'a5a-c8'"
code_case "[C8,9] submitted 界外 + arrival 界外 ⇒ SUBMITTED_AT_OUT_OF_RANGE 先" SUBMITTED_AT_OUT_OF_RANGE "" "'$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, TIMESTAMPTZ '1999-01-01', NULL, NULL, DATE '2101-01-01', 'sean', 'a5a-c89'"
code_case "[C9,10] arrival 界外 + 假品項 ⇒ EXPECTED_ARRIVAL_OUT_OF_RANGE 先" EXPECTED_ARRIVAL_OUT_OF_RANGE "" "'00000000-0000-0000-0000-0000000000ee'::uuid, '$SA'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, DATE '2101-01-01', 'sean', 'a5a-c910'"
code_case "[C10,11g] 假品項 + 假供應商 ⇒ ORDER_ITEM_NOT_FOUND 先" ORDER_ITEM_NOT_FOUND "" "'00000000-0000-0000-0000-0000000000ee'::uuid, '00000000-0000-0000-0000-0000000000ff'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-c1011'"
code_case "[C11a,11g] 停用供應商 + 同 payload ⇒ NO_CHANGE 先於停用閘" NO_CHANGE "
$MK_BASE
UPDATE public.suppliers SET is_active=false WHERE id='$SA';" "$C_BASE"
code_case "[C11g,11b] 停用 + 調升超量 ⇒ SUPPLIER_INACTIVE 先於 OVER_ALLOCATION" SUPPLIER_INACTIVE "
$MK_BASE
UPDATE public.suppliers SET is_active=false WHERE id='$SA';" \
  "'$ITEM5'::uuid, '$SA'::uuid, 9, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-c11b'"
# 🔴 關卡2 MF8:上面每一格都只驗「回傳碼對」。若某條拒絕路徑在回傳前**寫了稽核**
#    (或寫了資料),交易內案例 ROLLBACK、committed 案例又被 cleanup 刪掉 ⇒ 全綠。
#    ⇒ 用一格把「所有拒絕碼一律零寫入零稽核」一次釘住(逐碼跑、每碼跑完立刻斷言)。
case_ok "[C-NOWRITE] 12 條拒絕路徑逐碼驗:零採購列、零稽核列" "
DO \$b\$
DECLARE
  v_got text; v_n integer; v_a integer;
  v_cases text[][] := ARRAY[
    ['INVALID_INPUT','1'], ['INVALID_ALLOCATED','2'], ['INVALID_REPLY_STATUS','3'],
    ['INVALID_CONTACT_CHANNEL','4'], ['INVALID_SUPPLIER_ORDER_NO','5'], ['INVALID_EXCEPTION_REASON','6'],
    ['SUBMITTED_AT_OUT_OF_RANGE','7'], ['SUBMITTED_AT_IN_FUTURE','8'], ['EXPECTED_ARRIVAL_OUT_OF_RANGE','9'],
    ['ORDER_ITEM_NOT_FOUND','10'], ['SUPPLIER_NOT_FOUND','11'], ['OVER_ALLOCATION','12']];
BEGIN
  FOR i IN 1..array_length(v_cases,1) LOOP
    v_got := CASE v_cases[i][1]
      WHEN 'INVALID_INPUT'                 THEN public.admin_upsert_item_procurement(NULL::uuid,'$SA'::uuid,2,'no_reply',NULL,NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'INVALID_ALLOCATED'             THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,0,'no_reply',NULL,NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'INVALID_REPLY_STATUS'          THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'bogus',NULL,NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'INVALID_CONTACT_CHANNEL'       THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'no_reply',repeat('x',201),NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'INVALID_SUPPLIER_ORDER_NO'     THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'no_reply',NULL,NULL,repeat('S',201),NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'INVALID_EXCEPTION_REASON'      THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'no_reply',NULL,NULL,NULL,repeat('長',501),NULL,'sean','a5a-nw'||i)
      WHEN 'SUBMITTED_AT_OUT_OF_RANGE'     THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'no_reply',NULL,TIMESTAMPTZ '1999-01-01',NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'SUBMITTED_AT_IN_FUTURE'        THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'no_reply',NULL,clock_timestamp()+interval '1 day',NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'EXPECTED_ARRIVAL_OUT_OF_RANGE' THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,2,'no_reply',NULL,NULL,NULL,NULL,DATE '2101-01-01','sean','a5a-nw'||i)
      WHEN 'ORDER_ITEM_NOT_FOUND'          THEN public.admin_upsert_item_procurement('00000000-0000-0000-0000-0000000000ee'::uuid,'$SA'::uuid,2,'no_reply',NULL,NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'SUPPLIER_NOT_FOUND'            THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'00000000-0000-0000-0000-0000000000ff'::uuid,2,'no_reply',NULL,NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
      WHEN 'OVER_ALLOCATION'               THEN public.admin_upsert_item_procurement('$ITEM5'::uuid,'$SA'::uuid,9,'no_reply',NULL,NULL,NULL,NULL,NULL,'sean','a5a-nw'||i)
    END;
    IF v_got IS DISTINCT FROM v_cases[i][1] THEN
      RAISE EXCEPTION '第 % 碼期望 % 實得 %', i, v_cases[i][1], coalesce(v_got,'<NULL>'); END IF;
    SELECT count(*) INTO v_n FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
    SELECT count(*) INTO v_a FROM public.admin_audit_log WHERE request_id LIKE 'a5a-nw%';
    IF v_n <> 0 THEN RAISE EXCEPTION '% 竟寫了 % 列採購', v_cases[i][1], v_n; END IF;
    IF v_a <> 0 THEN RAISE EXCEPTION '% 竟寫了 % 筆稽核', v_cases[i][1], v_a; END IF;
  END LOOP;
END \$b\$;"
# SUPPLIER_INACTIVE 需要先有停用供應商,單獨一格(同樣驗零寫入零稽核)
case_ok "[C-NOWRITE2] SUPPLIER_INACTIVE 亦零寫入零稽核" "
UPDATE public.suppliers SET is_active=false WHERE id='$SA';
DO \$b\$
DECLARE v_got text;
BEGIN
  v_got := public.admin_upsert_item_procurement($C_BASE);
  IF v_got <> 'SUPPLIER_INACTIVE' THEN RAISE EXCEPTION '應 SUPPLIER_INACTIVE,實 %', v_got; END IF;
  IF EXISTS (SELECT 1 FROM public.order_item_procurement WHERE order_item_id='$ITEM5') THEN
    RAISE EXCEPTION '竟寫了採購列'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id='a5a-1') THEN
    RAISE EXCEPTION '竟寫了稽核'; END IF;
END \$b\$;"
cell $(( (PASS+FAIL) - PRE ))

echo
echo "== M. 突變(8;殺不死 = 該格紅)=="
PRE=$((PASS+FAIL))
MUTATED=1
mutate_fn "[M1] 拿掉供應商停用檢查 ⇒ 停用後新建竟成功" \
  "IF NOT v_active THEN" "IF false THEN" 1 \
  "UPDATE public.suppliers SET is_active=false WHERE id='$SA';" \
  "DO \$m\$ DECLARE v_got text; BEGIN
     v_got := public.admin_upsert_item_procurement($C_BASE);
     IF v_got = 'CREATED' THEN RAISE NOTICE 'A5A_FLIP_OK'; ELSE RAISE EXCEPTION '未翻面:%', v_got; END IF;
   END \$m\$;"
mutate_fn "[M2] 拿掉 no-op 比對 ⇒ 重放變成 UPDATED" \
  "RETURN 'NO_CHANGE';" "RAISE NOTICE 'noop disabled';" 1 \
  "$MK_BASE" \
  "DO \$m\$ DECLARE v_got text; BEGIN
     v_got := public.admin_upsert_item_procurement($C_BASE);
     IF v_got = 'UPDATED' THEN RAISE NOTICE 'A5A_FLIP_OK'; ELSE RAISE EXCEPTION '未翻面:%', v_got; END IF;
   END \$m\$;"
mutate_fn "[M3] 拿掉 P2B01 翻譯 ⇒ 超量冒 raw P2B01" \
  "RETURN 'OVER_ALLOCATION';" "RAISE;" 2 \
  "" \
  "DO \$m\$ BEGIN
     BEGIN
       PERFORM public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 9, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-m3');
       RAISE EXCEPTION '未翻面:竟未拋出';
     EXCEPTION WHEN SQLSTATE 'P2B01' THEN RAISE NOTICE 'A5A_FLIP_OK';
     END;
   END \$m\$;"
mutate_fn "[M4] SET 清單注入 first_ordered_at ⇒ 首寫戳記被更新覆蓋" \
  "status_changed_at     = v_stamp" "status_changed_at = v_stamp, first_ordered_at = v_stamp" 1 \
  "$MK_BASE" \
  "DO \$m\$ DECLARE v_f0 timestamptz; v_f1 timestamptz; BEGIN
     SELECT first_ordered_at INTO v_f0 FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
     PERFORM pg_sleep(0.01);
     PERFORM public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'confirmed', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-m4');
     SELECT first_ordered_at INTO v_f1 FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';
     IF v_f1 <> v_f0 THEN RAISE NOTICE 'A5A_FLIP_OK'; ELSE RAISE EXCEPTION '未翻面:首寫戳記沒被動'; END IF;
   END \$m\$;"
# 🔴 突變挑 contact_channel 不挑 supplier_order_no(R3-F4 的病灶本體):
#    單號漏剝會被本 RPC 自己的 regex 驗證擋下(看得見);channel 沒有那道後盾 ——
#    漏剝時值照樣入庫,唯一症狀就是「乾淨值重放回 UPDATED 而非 NO_CHANGE」= 冪等靜默破功。
mutate_fn "[M5] 拿掉 contact_channel 正規化 ⇒ 乾淨值重放不再是 no-op(冪等破功)" \
  "v_channel := pg_catalog.btrim(p_contact_channel, v_ws);" "v_channel := p_contact_channel;" 1 \
  "" \
  "DO \$m\$ DECLARE v_got text; BEGIN
     PERFORM public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', '  line  ', NULL, NULL, NULL, NULL, 'sean', 'a5a-m5a');
     v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 2, 'no_reply', 'line', NULL, NULL, NULL, NULL, 'sean', 'a5a-m5b');
     IF v_got = 'UPDATED' THEN RAISE NOTICE 'A5A_FLIP_OK';
     ELSE RAISE EXCEPTION '未翻面:%(漏剝空白竟仍判成同值)', v_got; END IF;
   END \$m\$;"
mutate_fn "[M6] 竄改稽核 action 字面 ⇒ 稽核斷言翻面" \
  "'procurement.create'" "'procurement.bogus'" 1 \
  "" \
  "DO \$m\$ BEGIN
     PERFORM public.admin_upsert_item_procurement($C_BASE);
     IF EXISTS (SELECT 1 FROM public.admin_audit_log WHERE request_id='a5a-1' AND action='procurement.bogus')
       THEN RAISE NOTICE 'A5A_FLIP_OK'; ELSE RAISE EXCEPTION '未翻面'; END IF;
   END \$m\$;"
mutate_fn "[M7] 拿掉 ALLOCATED_BELOW_RECEIVED 預檢 ⇒ 冒 raw 23514" \
  "RETURN 'ALLOCATED_BELOW_RECEIVED';" "RAISE NOTICE 'precheck disabled';" 1 \
  "$MK_BASE
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT id, 2, now(), 'sean' FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SA';" \
  "DO \$m\$ BEGIN
     BEGIN
       PERFORM public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 1, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-m7');
       RAISE EXCEPTION '未翻面:竟未拋出';
     EXCEPTION WHEN check_violation THEN RAISE NOTICE 'A5A_FLIP_OK';
     END;
   END \$m\$;"
mutate_fn "[M8] 拿掉入口 SET CONSTRAINTS ⇒ deferred 下 P2B01 逃出 catch" \
  "SET CONSTRAINTS public.order_item_procurement_allocation_guard_ac,
                  public.order_item_procurement_summary_recompute_zc IMMEDIATE;" \
  "PERFORM 1;" 1 \
  "SET CONSTRAINTS public.order_item_procurement_allocation_guard_ac, public.order_item_procurement_summary_recompute_zc DEFERRED;" \
  "DO \$m\$ DECLARE v_got text; BEGIN
     v_got := public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SA'::uuid, 9, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-m8');
     IF v_got = 'CREATED' THEN RAISE NOTICE 'A5A_FLIP_OK';
     ELSE RAISE EXCEPTION '未翻面:%(deferred 下超量竟仍被當場擋)', v_got; END IF;
   END \$m\$;"
MUTATED=0
[ "$(q "SELECT md5(pg_get_functiondef('$FN'::regprocedure))")" = "$MD5_FN" ] \
  && ok "[M-restore] 突變區結束、函式定義 md5 回到基準" || bad "[M-restore] 函式仍是突變版"
cell $(( (PASS+FAIL) - PRE - 1 ))

echo
echo "== D. barrier 格(11 cells / 4 組;committed 狀態,附清理與殘留斷言)=="
PRE=$((PASS+FAIL))
open1
# D1:併發同鍵雙建 —— A 先建未 commit,B 呼叫必阻塞在 unique 上,A commit 後 B 收斂為 NO_CHANGE
send1 "BEGIN;"
send1 "SELECT public.admin_upsert_item_procurement($C_BASE);"
( psql "$URL" -tAX -c "SELECT 'D1_CODE=' || public.admin_upsert_item_procurement($C_BASE)" > "$WORK/a5a-d1.txt" 2>&1 ) &
BPID=$!
BLOCKED=0
for i in $(seq 1 40); do
  n="$(blocked_by_a "D1_CODE")"
  [ "$n" = "1" ] && { BLOCKED=1; break; }
  sleep 0.25
done
[ "$BLOCKED" = "1" ] && ok "[D1a] 併發同鍵:pg_blocking_pids 指認 blocker 恰為 session A" || bad "[D1a] blocker 不是 A(或未阻塞)—— 後續收斂斷言失去意義"
send1 "COMMIT;"
wait $BPID 2>/dev/null || true
grep -q 'D1_CODE=NO_CHANGE' "$WORK/a5a-d1.txt" \
  && ok "[D1b] A commit 後 B 走第二圈、同 payload ⇒ 恰 NO_CHANGE(23505 收斂路徑)" \
  || bad "[D1b] B 的結果非 NO_CHANGE:$(head -2 "$WORK/a5a-d1.txt" | tr '\n' ' ')"
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM5'")" = "1" ] \
  && ok "[D1c] 併發後恰一列(business key 唯一性成立)" || bad "[D1c] 列數不為 1"
[ "$(q "SELECT count(*) FROM public.admin_audit_log WHERE request_id='a5a-1' AND action='procurement.create'")" = "1" ] \
  && ok "[D1d] 恰一筆 create 稽核(B 的 no-op 未寫稽核)" || bad "[D1d] create 稽核筆數不為 1"
psql "$URL" -tAX -c "DELETE FROM public.admin_audit_log WHERE request_id LIKE 'a5a-%'" >/dev/null 2>&1
psql "$URL" -tAX -c "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5'" >/dev/null 2>&1
psql "$URL" -tAX -c "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'" >/dev/null 2>&1

# D2:A5a × S2 停用 TOCTOU(新建路徑)
send1 "BEGIN;"
send1 "SELECT public.admin_upsert_supplier('$SC'::uuid, NULL, false, NULL, 'sean', 'a5a-d2');"
( psql "$URL" -tAX -c "SELECT 'D2_CODE=' || public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SC'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-d2b')" > "$WORK/a5a-d2.txt" 2>&1 ) &
BPID=$!
BLOCKED=0
for i in $(seq 1 40); do
  n="$(blocked_by_a "D2_CODE")"
  [ "$n" = "1" ] && { BLOCKED=1; break; }
  sleep 0.25
done
[ "$BLOCKED" = "1" ] && ok "[D2a] 新建路徑:blocker 恰為 A(SHARE 真的擋得住 S2 的停用)" || bad "[D2a] B 未阻塞 ⇒ TOCTOU 窗存在"
send1 "COMMIT;"
wait $BPID 2>/dev/null || true
grep -q 'D2_CODE=SUPPLIER_INACTIVE' "$WORK/a5a-d2.txt" \
  && ok "[D2b] A commit 停用後 B 讀到最新狀態 ⇒ SUPPLIER_INACTIVE" \
  || bad "[D2b] B 的結果非 SUPPLIER_INACTIVE:$(head -2 "$WORK/a5a-d2.txt" | tr '\n' ' ')"

# D3:同型 barrier(更新路徑 —— 證明 11g 的鎖不是只在新建枝)
psql "$URL" -tAX -c "UPDATE public.suppliers SET is_active=true WHERE id='$SC'" >/dev/null 2>&1
psql "$URL" -tAX -c "SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SC'::uuid, 2, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-d3a')" >/dev/null 2>&1
send1 "BEGIN;"
send1 "SELECT public.admin_upsert_supplier('$SC'::uuid, NULL, false, NULL, 'sean', 'a5a-d3');"
( psql "$URL" -tAX -c "SELECT 'D3_CODE=' || public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SC'::uuid, 4, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-d3b')" > "$WORK/a5a-d3.txt" 2>&1 ) &
BPID=$!
BLOCKED=0
for i in $(seq 1 40); do
  n="$(blocked_by_a "D3_CODE")"
  [ "$n" = "1" ] && { BLOCKED=1; break; }
  sleep 0.25
done
[ "$BLOCKED" = "1" ] && ok "[D3a] 更新路徑(調升):blocker 恰為 A(11g 不是死枝)" || bad "[D3a] 更新路徑未取鎖 ⇒ 停用可在決策後發生"
send1 "COMMIT;"
wait $BPID 2>/dev/null || true
grep -q 'D3_CODE=SUPPLIER_INACTIVE' "$WORK/a5a-d3.txt" \
  && ok "[D3b] 更新路徑亦回 SUPPLIER_INACTIVE" || bad "[D3b] 結果非 SUPPLIER_INACTIVE:$(head -2 "$WORK/a5a-d3.txt" | tr '\n' ' ')"

# D4:A5a × A4a receipts sync(證明 ALLOCATED_BELOW_RECEIVED 讀的是鎖下最新值)
# 先把該列調到 5(D3 的調升被 INACTIVE 擋下了,現值仍是 2)—— 否則插 3 件到貨會撞
# received_range(A4a sync 把 received 寫成 3 > allocated 2),A 交易 abort、本格失義。
psql "$URL" -tAX -c "UPDATE public.suppliers SET is_active=true WHERE id='$SC'" >/dev/null 2>&1
psql "$URL" -tAX -c "SELECT public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SC'::uuid, 5, 'no_reply', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-d4a')" >/dev/null 2>&1
[ "$(q "SELECT allocated_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SC'")" = "5" ] \
  && ok "[D4-pre] D4 前置:該列 allocated 已為 5(到貨 3 件才寫得進去)" || bad "[D4-pre] 前置調升失敗 ⇒ D4 會失義"
send1 "BEGIN;"
send1 "INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
        SELECT id, 3, now(), 'sean' FROM public.order_item_procurement WHERE order_item_id='$ITEM5' AND supplier_id='$SC';"
( psql "$URL" -tAX -c "SELECT 'D4_CODE=' || public.admin_upsert_item_procurement('$ITEM5'::uuid, '$SC'::uuid, 2, 'confirmed', NULL, NULL, NULL, NULL, NULL, 'sean', 'a5a-d4b')" > "$WORK/a5a-d4.txt" 2>&1 ) &
BPID=$!
BLOCKED=0
for i in $(seq 1 40); do
  n="$(blocked_by_a "D4_CODE")"
  [ "$n" = "1" ] && { BLOCKED=1; break; }
  sleep 0.25
done
[ "$BLOCKED" = "1" ] && ok "[D4a] receipts 交錯:blocker 恰為 A(sync 的列鎖與本 RPC 互斥)" || bad "[D4a] B 未阻塞 ⇒ 預檢可能讀到舊值"
send1 "COMMIT;"
wait $BPID 2>/dev/null || true
grep -q 'D4_CODE=ALLOCATED_BELOW_RECEIVED' "$WORK/a5a-d4.txt" \
  && ok "[D4b] A commit(到貨 3)後 B 在鎖下重讀 ⇒ ALLOCATED_BELOW_RECEIVED(非 raw 23514)" \
  || bad "[D4b] 結果非 ALLOCATED_BELOW_RECEIVED:$(head -2 "$WORK/a5a-d4.txt" | tr '\n' ' ')"
close1
cell $(( (PASS+FAIL) - PRE ))

# ── 收尾:清理 + 零留痕斷言 ──────────────────────────────────
echo
echo "== 收尾 =="
cleanup_all
trap - EXIT
PROC_N1="$(q "SELECT count(*) FROM public.order_item_procurement")"
AUDIT_N1="$(q "SELECT count(*) FROM public.admin_audit_log")"
SUMM_N1="$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
SUPP_ACT1="$(q "SELECT count(*) FROM public.suppliers WHERE is_active")"
[ "$PROC_N1" = "$PROC_N0" ] && ok "零留痕:採購表回到基準($PROC_N0)" || bad "零留痕破:採購表 $PROC_N0 → $PROC_N1"
[ "$AUDIT_N1" = "$AUDIT_N0" ] && ok "零留痕:稽核表回到基準($AUDIT_N0)" || bad "零留痕破:稽核表 $AUDIT_N0 → $AUDIT_N1"
[ "$SUMM_N1" = "$SUMM_N0" ] && ok "零留痕:摘要表回到基準($SUMM_N0)" || bad "零留痕破:摘要表 $SUMM_N0 → $SUMM_N1"
[ "$SUPP_ACT1" = "$SUPP_ACT0" ] && ok "零留痕:啟用中供應商數回到基準($SUPP_ACT0)" || bad "零留痕破:供應商 $SUPP_ACT0 → $SUPP_ACT1"
SUPP_FP1="$(q "SELECT md5(coalesce(string_agg(id::text||'|'||label||'|'||is_active::text, ',' ORDER BY id),''))
                 FROM public.suppliers")"
SUPP_TS1="$(q "SELECT md5(coalesce(string_agg(id::text||'|'||updated_at::text, ',' ORDER BY id),'')) FROM public.suppliers")"
[ "$SUPP_FP1" = "$SUPP_FP0" ] && ok "零留痕:suppliers 業務欄指紋(id/label/is_active)= 基準" \
  || bad "零留痕破:suppliers 業務欄被改動"
if [ "$SUPP_TS1" = "$SUPP_TS0" ]; then
  ok "零留痕:suppliers.updated_at 亦未變動"
else
  N_TOUCHED="$(q "SELECT count(*) FROM public.suppliers WHERE updated_at > now() - interval '2 hours'")"
  ok "⚠️ 已知留痕(誠實列出,非零留痕):D2/D3 的 committed barrier 真的停用/還原過供應商 ⇒ touch trigger 改了 updated_at(近 2 小時內 $N_TOUCHED 列);業務欄已驗回到基準"
fi
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id='PCM-9993-0001'")" = "0" ] \
  && ok "零留痕:fixture 訂單已刪" || bad "零留痕破:fixture 訂單殘留"
[ "$(q "SELECT md5(pg_get_functiondef('$FN'::regprocedure))")" = "$MD5_FN" ] \
  && ok "零留痕:函式定義 md5 = 基準" || bad "零留痕破:函式定義被改動"

echo
echo "== 結果 =="
printf 'PASS=%s FAIL=%s SKIP=%s | MUT=%s CELL=%s\n' "$PASS" "$FAIL" "$SKIP" "$MUT" "$CELL"
RC=0
count_gate "$EXPECTED_TOTAL" $((PASS+FAIL)) || { echo "🔴 格數 $((PASS+FAIL)) ≠ 宣告 $EXPECTED_TOTAL(漏跑或多跑 = 覆蓋面宣稱不實)"; RC=1; }
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 突變數 $MUT ≠ 宣告 $EXPECTED_MUT"; RC=1; }
count_gate "$EXPECTED_CELL" "$CELL" || { echo "🔴 分區 cell 合計 $CELL ≠ 宣告 $EXPECTED_CELL"; RC=1; }
[ "$SKIP" -eq 0 ] || { echo "🔴 SKIP=$SKIP(本 harness 不允許條件略過)"; RC=1; }
[ "$FAIL" -eq 0 ] || RC=1
[ "$RC" -eq 0 ] && echo "✅ A5a harness 全綠" || echo "🔴 A5a harness 未全綠"
exit $RC
