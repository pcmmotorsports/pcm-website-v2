#!/usr/bin/env bash
# ============================================================
# A4a 驗證 harness:order_item_quantity_summary 重算 trigger 家族
# ============================================================
# plan = docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md §5
# 用法:先 **PORT=54363** scripts/d1t2-rehearsal.sh provision <workdir> 且 A4a migration 已套,
#       再 scripts/a4a-verify.sh <workdir>
# 🔴🔴 **`PORT=54363` 那一段不是可省的**(2026-08-07 S2b-4b 實測踩過同型):`d1t2-rehearsal.sh`
#    有**它自己的** `PORT="${PORT:-54329}"` 預設。本支改用專屬埠 54363 之後,若 provision 時
#    沒帶 PORT,cluster 會起在 54329 而本支去連 54363 ⇒ 當場「連不上」。
#    (姊妹片 `a1-verify.sh` 自己 provision,所以它是 `export PORT` 解決;本支不 provision,只能靠這行用法。)
# 形狀照 a2b1-verify.sh:三計數器 + 身分閘五重 + case 全 BEGIN…ROLLBACK 零留痕
# + DB 內突變(anchor 三重 preflight)。例外(誠實列出、各自帶清理與殘留斷言):
#   R9b/R9c/R10a/N3/N6b/N6c 需要 committed 狀態;N3 是唯一 committed 函式突變
#   (跨連線才觀察得到鎖),trap 還原、收尾比對六函式 md5 + 五 trigger 定義與啟用態(S2b-4a 項 23b)。
# 🔴 突變格語意 = 「攻擊 SQL 在 mutant 下觀察到行為翻面」則 ok;沒翻面 = 該格紅。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a4a-work}"
# 🔴 **專屬埠 54363**(B2-S2b plan §3.6 定案;2026-08-07 S2b-4b 落地)。
#    原本與 `a1-verify.sh` **共用 54329** —— 兩支併行起跑時後起的那支會撞埠,
#    而「跑完 teardown」**不解決撞埠**(先起的那支還沒 teardown,後起的照樣撞)⇒ 分埠與 teardown 兩件都要做。
#    `PORT=` 環境變數仍可覆寫。
URL="postgresql://postgres@127.0.0.1:${PORT:-54363}/postgres"
AURL="${URL}?application_name=a4a_sess_a"
HELPER="public.pcm_a4a_recompute_order_item_summary(uuid)"
FN_GUARD="public.pcm_a4a_received_quantity_guard()"
FN_PROC="public.pcm_a4a_procurement_summary_recompute()"
FN_RCPT="public.pcm_a4a_receipts_received_sync()"
FN_CANC="public.pcm_a4a_cancellation_summary_recompute()"
TG_BT="order_item_procurement_received_quantity_guard_bt"
TG_ZC="order_item_procurement_summary_recompute_zc"
TG_RC="order_item_procurement_receipts_received_sync_ac"
TG_CC="order_cancellation_items_summary_recompute_ac"
GUARD_A2B1="order_item_procurement_allocation_guard_ac"
# 🔴 B2-S2b-1 登記(plan 項 23b 的「第 6 支函式 / 第 5 支 trigger」;建物件的片負責把自己登記進守門)
FN_SHIP="public.pcm_a4a_shipments_summary_recompute()"
TG_SS="shipments_summary_recompute_ac"
MIGFILE="supabase/migrations/20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql"
PASS=0; FAIL=0; SKIP=0; MUT=0; CELL=0
EXPECTED_TOTAL=66
EXPECTED_MUT=10
EXPECTED_CELL=41

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
cell() { CELL=$((CELL+$1)); }
count_gate() { [ "$2" -eq "$1" ]; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(五重;照 a2b1)────────────────────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='$TG_ZC' AND NOT tgisinternal")" = "1" ] \
  || { echo "🔴 A4a 未套(zc 不在);先 psql -f $MIGFILE"; exit 1; }

# ── 判定原語(照 a2b1)───────────────────────────────────────
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

expect_guard() {
  local label="$1" state="$2" conname="$3" beginsql="$4" setup="$5" attack="$6" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
$beginsql
$setup
DO \$a4aatk\$
DECLARE v_con text;
BEGIN
  BEGIN
    $attack
    RAISE EXCEPTION 'A4A_NOT_BLOCKED';
  EXCEPTION WHEN SQLSTATE '$state' THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF '$conname' <> '' AND v_con IS DISTINCT FROM '$conname' THEN
      RAISE EXCEPTION 'A4A_WRONG_CONSTRAINT:%', v_con;
    END IF;
    RAISE NOTICE 'A4A_RED_OK';
  END;
END
\$a4aatk\$;
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'A4A_RED_OK'; then ok "$label(紅在 $state${conname:+ / $conname})"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|A4A_' | cut -c1-160)"; fi
}

# DB 內突變(照 a2b1 mut_block;fnsig 由 harness.mut_fnsig 指定 —— 本片五支函式)
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

# mutate_fn label fnsig mfrom mto setup attack occ [beginsql]
mutate_fn() {
  local label="$1" fnsig="$2" mfrom="$3" mto="$4" setup="$5" attack="$6" want_occ="$7" beginsql="${8:-BEGIN;}" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -v mfn="$fnsig" -v mfrom="$mfrom" -v mto="$mto" -v mocc="$want_occ" <<SQL 2>&1
$beginsql
SELECT set_config('harness.mut_fnsig', :'mfn',  true);
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
  # 🔴 形狀債(R2 nit,2026-08-06):綠判定是掃**整份 stdout+stderr** 找 A4A_FLIP_OK。
  # 若哪天某格的 setup/attack/mut_to 字面本身含這個字串,錯誤訊息回顯就會構成假綠。
  # 現況全格已逐項確認不含(本檔唯一產生該字串的地方是各格自己的 RAISE NOTICE);
  # 新增格時請確認同一件事,或把判定改成只認最後一行。
  if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'A4A_FLIP_OK'; then ok "$label"
  else bad "$label — $(printf '%s' "$out" | grep -m1 -E 'ERROR|A4A_' | cut -c1-160)"; fi
}

# 獨立推導漂移 oracle(R3-F3:逐軸 correlated subquery,與 helper 的 JOIN 形狀不同;A4b 重用)
# 🔀 codex 關卡2 K2-1:第三式「有活動必有列」—— 缺它的話,刪掉活動品項的摘要列 oracle 仍回 0(假綠)。
# 🔴 B2-S2b-3a 前段(2026-08-06):**四軸化 + 候選全集補齊**。
#   ①值分歧那一段(**第二式**)補第四軸 shipped
#   ②**第三式**(「有活動必有列」)的候選全集補 **`shipment_items`** ——
#     少了它,只出過貨、沒進過採購/取消的品項(shipment-only)缺摘要列時不會被掃到。
# 🔴🔴 **第三式刻意 <u>不</u> 補 summary**(R1 must-fix:我上一版補了,而那是**恆 0 的 no-op**):
#   第三式的 WHERE 是 `NOT EXISTS (… FROM order_item_quantity_summary …)` ⇒
#   **來自 summary 的候選必然被自己排除**(`order_item_id` 為 NOT NULL,連 NULL 那條縫都沒有)。
#   plan §3.4 的表寫「本檔缺 summary 與 shipment_items 兩者」——**那個前提是錯的**:
#   summary-only 的形狀(真相活動全刪、摘要殘留非 0)由**第二式**承重(它全掃 summary、逐軸比真值),
#   不是第三式。plan 那一格已同批更正。
# 🔴 `-- SHIPPED-TRUTH-BEGIN/END` 之間是**真相式的受守護區塊**,本 repo 有 6 個副本。
# 🔴🔴 **現在還沒有守門在比對它們**(R2 must-fix:上一版寫成現在式 = 宣稱超出事實)——
#   同步守門是 **S2b-3a 後段**的交付物(落在 `scripts/b2s2b-verify.sh`)。
#   **在它落地之前,改這幾行不會有任何東西轉紅**;落地之後才會「改一處必須同批改凍結表」。
#   **區塊內刻意零縮排**:縮排差異會讓逐字比對永遠不等,不要順手重排。
ORACLE_SQL="SELECT (SELECT count(*) FROM public.order_item_procurement p
              WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity)
                    FROM public.order_item_procurement_receipts r WHERE r.procurement_id = p.id),0))
          + (SELECT count(*) FROM public.order_item_quantity_summary s
              WHERE s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=s.order_item_id),0)
                 OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=s.order_item_id),0)
                 OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                       WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=s.order_item_id)),0)
                 OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = s.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
             )
          + (SELECT count(*) FROM (SELECT p.order_item_id FROM public.order_item_procurement p
                                   UNION SELECT c.order_item_id FROM public.order_cancellation_items c
                                   UNION SELECT si2.order_item_id FROM public.shipment_items si2) x
              WHERE NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = x.order_item_id))"

# ── 單連線 FIFO session(R14 / N3;照 a2b1:146-159)────────────
PA=""
wait_idle_a() {
  local i st
  for i in $(seq 1 60); do
    st="$(psql "$URL" -qtAc "SELECT state FROM pg_stat_activity WHERE application_name = 'a4a_sess_a' LIMIT 1" 2>/dev/null)"
    case "$st" in "idle in transaction"|idle) return 0 ;; esac
    sleep 0.5
  done
  echo "  🔴 barrier 逾時:session A 30 秒未回 idle(state=$st);中止不假裝跑過"; exit 1
}
open1() { rm -f "$WORK/a4a-fa"; mkfifo "$WORK/a4a-fa"; ( psql "$AURL" -qtA -v ON_ERROR_STOP=0 -f "$WORK/a4a-fa" > "$WORK/a4a-outa.txt" 2>&1 ) & PA=$!; exec 3>"$WORK/a4a-fa"; wait_idle_a; }
send1() { printf '%s\n' "$1" >&3; wait_idle_a; }
close1() { exec 3>&- 2>/dev/null || true; [ -n "$PA" ] && wait "$PA" 2>/dev/null || true; PA=""; }

# ── H. harness 自檢(先過才有資格往下)────────────────────────
echo "== H. harness 自檢 =="
count_gate 1 2 && bad "H1 自檢:count_gate 對錯數竟回真" || ok "H1 自檢:count_gate 對錯數回非 0"
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
BEGIN;
DO $h2$
BEGIN
  BEGIN
    PERFORM 1;
    RAISE EXCEPTION 'A4A_NOT_BLOCKED';
  EXCEPTION WHEN SQLSTATE 'P2B01' THEN RAISE NOTICE 'A4A_RED_OK';
  END;
END
$h2$;
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A4A_RED_OK' && bad "H2 自檢:expect_guard 形狀對未被擋的攻擊竟回 RED_OK" \
  || ok "H2 自檢:未被擋的攻擊不會產生 RED_OK(判定不假綠)"
[ "$(q "$ORACLE_SQL")" = "0" ] || { echo "🔴 起跑前 oracle 非 0 —— 庫已髒;拒跑"; exit 1; }
ok "H3 自檢:起跑前漂移 oracle = 0(oracle 消融證明在 fixture 後的 H4)"

# ── 基準與 fixture(committed;EXIT trap 清除)────────────────
echo
echo "== 基準與 fixture =="
ORDERS_N0="$(q "SELECT count(*) FROM public.orders")"
PROC_N0="$(q "SELECT count(*) FROM public.order_item_procurement")"
SUMM_N0="$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
[ -n "$ORDERS_N0" ] && [ -n "$PROC_N0" ] && [ -n "$SUMM_N0" ] \
  && ok "基準已取(orders=$ORDERS_N0 proc=$PROC_N0 summ=$SUMM_N0)" || bad "基準取得失敗"

MUTATED=0
ORIGDEF_FILE="$WORK/a4a-helper-orig.sql"
cleanup_all() {
  close1 2>/dev/null || true
  if [ "$MUTATED" = "1" ] && [ -s "$ORIGDEF_FILE" ]; then
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
    if [ -n "${MD5_HELPER:-}" ] \
       && [ "$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")" = "$MD5_HELPER" ]; then
      MUTATED=0
    else
      echo "🔴🔴 cleanup:N3 mutant 還原失敗 —— 本庫仍是突變版" >&2
    fi
  fi
  psql "$URL" -tAX >/dev/null 2>&1 <<'CLEAN' || echo "🔴 cleanup:fixture 清理失敗(殘留)" >&2
BEGIN;
DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN
  (SELECT p.id FROM public.order_item_procurement p JOIN public.order_items i ON i.id=p.order_item_id WHERE i.variant_sku LIKE 'A4AV-%');
DELETE FROM public.order_item_procurement WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AV-%');
DELETE FROM public.order_cancellation_items WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AV-%');
DELETE FROM public.order_cancellations WHERE order_id IN
  (SELECT id FROM public.orders WHERE display_id='PCM-9995-0001');
DELETE FROM public.order_item_quantity_summary WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AV-%');
COMMIT;
CLEAN
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9995-0001'" >/dev/null 2>&1 || true
  rm -f "$WORK/a4a-fa"
}
trap 'exit 130' INT TERM
trap cleanup_all EXIT

o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_order uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'fixture 失敗:customers 為空'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE display_id='PCM-9995-0001') THEN
    RAISE EXCEPTION 'fixture 失敗:PCM-9995-0001 已存在';
  END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9995-0001', v_cust,
          jsonb_build_object('name','A4a 探針','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A4AV-P5', '{"title":"a4a p5","sku":"A4AV-P5","spec":{}}'::jsonb, 5, 0, 0);
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A4AV-P3', '{"title":"a4a p3","sku":"A4AV-P3","spec":{}}'::jsonb, 3, 0, 0);
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "fixture 已建(PCM-9995-0001;P5 qty=5 / P3 qty=3;零活動)" \
  || bad "fixture 建立失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"

ORDER_ID="$(q "SELECT id FROM public.orders WHERE display_id='PCM-9995-0001'")"
ITEM5="$(q "SELECT id FROM public.order_items WHERE variant_sku='A4AV-P5'")"
ITEM3="$(q "SELECT id FROM public.order_items WHERE variant_sku='A4AV-P3'")"
S1="$(q "SELECT id FROM public.suppliers ORDER BY id LIMIT 1")"
S2="$(q "SELECT id FROM public.suppliers ORDER BY id OFFSET 1 LIMIT 1")"
STAFF="$(q "SELECT id FROM public.staff ORDER BY id LIMIT 1")"
if [ -n "$ORDER_ID" ] && [ -n "$ITEM5" ] && [ -n "$ITEM3" ] && [ -n "$S1" ] && [ -n "$S2" ] && [ -n "$STAFF" ]; then
  ok "fixture id 已取(items×2 suppliers×2 staff=$STAFF)"
else
  bad "fixture id 缺 —— 後續全部無意義"; echo "PASS=$PASS FAIL=$FAIL"; exit 1
fi
MD5_HELPER="$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")"
MD5_GUARD="$(q "SELECT md5(pg_get_functiondef('$FN_GUARD'::regprocedure))")"
MD5_PROC="$(q "SELECT md5(pg_get_functiondef('$FN_PROC'::regprocedure))")"
MD5_RCPT="$(q "SELECT md5(pg_get_functiondef('$FN_RCPT'::regprocedure))")"
MD5_CANC="$(q "SELECT md5(pg_get_functiondef('$FN_CANC'::regprocedure))")"
MD5_SHIP="$(q "SELECT md5(pg_get_functiondef('$FN_SHIP'::regprocedure))")"   # B2-S2b-1 第 6 支
psql "$URL" -tAX -c "SELECT pg_get_functiondef('$HELPER'::regprocedure)" > "$ORIGDEF_FILE" 2>/dev/null

# 🔴 S2b-4a 項 23b:trigger 定義 + 啟用態的**收尾漂移基準**。
# 收尾零殘留閘原本只比五支**函式**的 md5,trigger 一支都沒守 —— 而 N7 會在交易內
# DROP + CREATE 回 $TG_CC。那個 ROLLBACK 哪天沒生效,收尾照樣報全綠。
# 🔴 這裡刻意**不**重複驗名字/形狀/啟用態:[A1]-[A5](本檔 `grep -n '\[A1\]'` 起算的那五格)
#    已守過 A1 四支同名唯一、A2 表函式映射、A3 tgtype、A4 deferrability + 全 enabled O、A5 constraint-ness。
#    🔴 但兩者**不是同一個面**,別當成完全等價:A1-A5 用 **tgname 白名單**取集合,本 SQL 用
#    **`proname LIKE 'pcm_a4a%'`** 取集合(所以「多出一支掛在 a4a 函式上的 trigger」只有本式看得見);
#    且 A1-A5 跑在本基準擷取**之後**。本基準職責單一 = 給收尾比「跑前 vs 跑後」,不重做開跑時的結構守門。
# 🔴 S2b-1 **已落地**,本集合現在是**五支**(多一支 shipments 的 `AFTER UPDATE OF shipped_at` 重算 trigger)。
#    本 SQL 用 `proname LIKE 'pcm_a4a%'` 取集合 ⇒ **新 trigger 函式沿用 pcm_a4a 前綴是契約**,
#    換前綴的那天這一式就看不見它了(migration 的 COMMENT 也寫了同一句)。
#    🔴 更正(S2b-1 落地時改寫,不留活字):4a 原本寫「A1 的『四支』計數改五是 S2b-1 的範圍」——
#    **S2b-1 最後沒有動 A1**,改走 `[A12]` 獨立格路線(理由見該格註解:A1-A5 的字面已被多輪突變證明過,
#    retrofit 進去等於重開它們的判別力問題)。**A1 蓄意凍在四支,不是欠改。**
# 🔴 `tgenabled` 是 `"char"` 不是 text:少了 ::text 這句會 `operator is not unique` 整句 ERROR,
#    而 q() 把 stderr 併進 stdout ⇒ 基準與收尾各拿到**同一段錯誤訊息**、比對永遠相等 = 守門恆綠。
#    2026-08-06 本片實測踩到:全綠但閘是死的,靠「把 bug 放回去」的負測才抓出來。
TG_DEF_SQL="SELECT coalesce(string_agg(t.tgname||'::'||t.tgenabled::text||'::'||md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), '') FROM pg_trigger t
              JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE p.proname LIKE 'pcm_a4a%' AND NOT t.tgisinternal"
TG_DEF0="$(q "$TG_DEF_SQL")"
# 🔴 fail-closed:不能只驗「非空」—— 錯誤訊息也是非空字串,正是上面那個坑放行的原因。
#    改驗形狀:恰五段(A4a 四支 + B2-S2b 一支)、每段三個欄位、且第一個欄位是預期的 trigger 名。
#    🔴 形狀只在**基準**這端驗、收尾那端只比字串:不對稱但仍 fail-closed ——
#    收尾若整句爆掉,拿到的錯誤訊息 ≠ 已驗過形狀的基準 ⇒ 紅。反過來才會漏,而反過來被本式擋掉。
TG_DEF0_SHAPE="$(printf '%s' "$TG_DEF0" | awk -F'|' '{n=NF; ok=(n==5); for(i=1;i<=n;i++){c=split($i,a,"::"); if(c!=3) ok=0} print (ok?"5x3":"bad:"n)}')"
[ -n "$MD5_HELPER" ] && [ -s "$ORIGDEF_FILE" ] \
  && [ "$TG_DEF0_SHAPE" = "5x3" ] && [ "${TG_DEF0%%::*}" = "$TG_CC" ] \
  && ok "六函式 md5 + 五 trigger 定義基準已取(形狀 5x3 已驗)、helper 原始定義已存(N3 還原用)" \
  || bad "md5/trigger 基準或原始定義取得失敗 —— trigger 基準形狀 [$TG_DEF0_SHAPE]"

# 常用 SQL 片段
CANCEL_2="INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a1'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a4a-c1'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a1'::uuid, '$ORDER_ID', '$ITEM5', 2);"
CANCEL_PLUS1="INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a2'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a4a-c2'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a2'::uuid, '$ORDER_ID', '$ITEM5', 1);"

# oracle 消融自檢(R3-F3:證 oracle 抓得到;交易內竄改 → 必紅 → 回滾)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
INSERT INTO public.order_item_quantity_summary (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
VALUES ('$ITEM5', 5, 1, 0, 0);
SELECT 'ORACLE_RED=' || ($ORACLE_SQL);
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'ORACLE_RED=1' && ok "H4 oracle 消融:竄改摘要 → oracle 紅(抓得到)" \
  || bad "H4 oracle 消融失敗 — oracle 對假摘要竟回 0"
# H4b(codex K2-1):刪列方向 —— 有活動品項的摘要列被刪,oracle 必紅(第三式承重)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
$CANCEL_2
DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
SELECT 'ORACLE_RED=' || ($ORACLE_SQL);
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'ORACLE_RED=1' && ok "H4b oracle 消融(刪列向):活動品項缺摘要列 → oracle 紅(第三式抓得到)" \
  || bad "H4b oracle 刪列向失敗 — 缺列竟回 0(K2-1 假綠形狀)"

echo
echo "== A. 結構格(12 cells;與 migration 檔內 DO 獨立重證)=="
PRE_CELL=$((PASS+FAIL))
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN ('$TG_BT','$TG_ZC','$TG_RC','$TG_CC') AND NOT tgisinternal")" = "4" ] \
  && ok "[A1] 四支 trigger 存在且同名唯一" || bad "[A1] trigger 數不為 4"
[ "$(q "SELECT string_agg(tgrelid::regclass::text || '>' || tgfoid::regproc::text, ',' ORDER BY tgname)
        FROM pg_trigger WHERE tgname IN ('$TG_BT','$TG_ZC','$TG_RC','$TG_CC') AND NOT tgisinternal")" = \
"order_cancellation_items>pcm_a4a_cancellation_summary_recompute,order_item_procurement_receipts>pcm_a4a_receipts_received_sync,order_item_procurement>pcm_a4a_received_quantity_guard,order_item_procurement>pcm_a4a_procurement_summary_recompute" ] \
  && ok "[A2] 四支各掛對表、指對函式" || bad "[A2] 表/函式映射不符"
[ "$(q "SELECT string_agg(tgname||'='||tgtype::text, ',' ORDER BY tgname) FROM pg_trigger
        WHERE tgname IN ('$TG_BT','$TG_ZC','$TG_RC','$TG_CC') AND NOT tgisinternal")" = \
"order_cancellation_items_summary_recompute_ac=29,order_item_procurement_receipts_received_sync_ac=29,order_item_procurement_received_quantity_guard_bt=23,order_item_procurement_summary_recompute_zc=29" ] \
  && ok "[A3] tgtype:bt=BEFORE ROW I/U(23)、三支 AFTER ROW I/U/D(29)" || bad "[A3] tgtype 不符"
[ "$(q "SELECT (SELECT tgdeferrable AND NOT tginitdeferred FROM pg_trigger WHERE tgname='$TG_ZC' AND NOT tgisinternal)
        AND (SELECT NOT tgdeferrable FROM pg_trigger WHERE tgname='$TG_RC' AND NOT tgisinternal)
        AND (SELECT NOT tgdeferrable FROM pg_trigger WHERE tgname='$TG_CC' AND NOT tgisinternal)
        AND (SELECT bool_and(tgenabled='O') FROM pg_trigger WHERE tgname IN ('$TG_BT','$TG_ZC','$TG_RC','$TG_CC') AND NOT tgisinternal)")" = "t" ] \
  && ok "[A4] zc=DEFERRABLE II、rc/cc=NOT DEFERRABLE(R1-19)、全 enabled O" || bad "[A4] deferrability 不符"
[ "$(q "SELECT (SELECT count(*) FROM pg_trigger t JOIN pg_constraint c ON c.oid=t.tgconstraint AND c.contype='t'
                 WHERE t.tgname IN ('$TG_ZC','$TG_RC','$TG_CC') AND NOT t.tgisinternal) = 3
        AND (SELECT tgconstraint = 0 FROM pg_trigger WHERE tgname='$TG_BT' AND NOT tgisinternal)")" = "t" ] \
  && ok "[A5] 三支 constraint trigger + bt 為一般 trigger" || bad "[A5] constraint-ness 不符"
# 🔴 [A12] B2-S2b-1 的第 5 支 trigger(plan 項 23b 登記)。獨立一格、不改 A1-A5 的凍結字面 ——
#    那四支的斷言已被多輪突變證明過,retrofit 進去等於重開它們的判別力問題。
# 🔴 定義比對用**全等**不用 `LIKE`(codex 關卡2 must-fix):`LIKE '%…%'` 只看事件面那一段,
#    trigger 被重建成「同事件面 + `WHEN false`」照樣過,但它**永遠不會重算** —— 那正是本格要擋的東西。
[ "$(q "SELECT (t.tgrelid::regclass::text = 'shipments')
            AND (t.tgfoid::regproc::text = 'pcm_a4a_shipments_summary_recompute')
            AND (t.tgconstraint <> 0) AND NOT t.tgdeferrable AND NOT t.tginitdeferred
            AND (t.tgenabled = 'O')
            AND (pg_get_triggerdef(t.oid) = 'CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac AFTER UPDATE OF shipped_at, deleted_at ON public.shipments NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION pcm_a4a_shipments_summary_recompute()')
          FROM pg_trigger t WHERE t.tgname='$TG_SS' AND NOT t.tgisinternal")" = "t" ] \
  && ok "[A12] 第 5 支 shipments 重算 trigger 形狀逐字(B2-S2b-1)" \
  || bad "[A12] shipments 重算 trigger 缺或形狀不符 —— 實得 [$(q "SELECT coalesce(pg_get_triggerdef(oid),'<不存在>') FROM pg_trigger WHERE tgname='$TG_SS' AND NOT tgisinternal")]"
[ "$(q "SELECT g.tgname < z.tgname FROM pg_trigger g, pg_trigger z
        WHERE g.tgrelid='public.order_item_procurement'::regclass AND g.tgname='$GUARD_A2B1' AND NOT g.tgisinternal
          AND z.tgrelid='public.order_item_procurement'::regclass AND z.tgname='$TG_ZC' AND NOT z.tgisinternal")" = "t" ] \
  && ok "[A6] 名稱序契約:a2b1 guard < 本片 zc(P2B01 先於 23514 的地基)" || bad "[A6] 名稱序破裂"
[ "$(q "SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'])
        FROM pg_proc WHERE oid IN ('$HELPER'::regprocedure,'$FN_GUARD'::regprocedure,'$FN_PROC'::regprocedure,'$FN_RCPT'::regprocedure,'$FN_CANC'::regprocedure)")" = "t" ] \
  && [ "$(q "SELECT bool_and(proconfig @> ARRAY['lock_timeout=5s']) FROM pg_proc
             WHERE oid IN ('$HELPER'::regprocedure,'$FN_PROC'::regprocedure,'$FN_RCPT'::regprocedure,'$FN_CANC'::regprocedure)")" = "t" ] \
  && [ "$(q "SELECT prosecdef AND proconfig @> ARRAY['search_path=\"\"'] AND proconfig @> ARRAY['lock_timeout=5s']
             FROM pg_proc WHERE oid='$FN_SHIP'::regprocedure")" = "t" ] \
  && ok "[A7] 六函式函式頭:五支 SECDEF+search_path(public, pg_temp)、四支 lock_timeout;第 6 支 SECDEF+search_path='' " \
  || bad "[A7] 函式頭不符"
# 🔴 第 6 支必須納入 ACL 面(codex 關卡2 must-fix):原本 A7/A8 只涵蓋五支,
#    新函式若在**開跑前**就已漂移,收尾的 md5 只會把那個壞狀態當成基準 = 漂移閘看不見它。
#    🔴 它的 search_path 是 ''(與另外五支不同),所以 A7 那半得另立一條、不能併進 bool_and。
[ "$(q "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
        WHERE p.oid IN ('$HELPER'::regprocedure,'$FN_GUARD'::regprocedure,'$FN_PROC'::regprocedure,'$FN_RCPT'::regprocedure,'$FN_CANC'::regprocedure,'$FN_SHIP'::regprocedure)
          AND a.grantee <> p.proowner")" = "0" ] \
  && [ "$(q "SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))
             FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                  unnest(ARRAY['$HELPER','$FN_GUARD','$FN_PROC','$FN_RCPT','$FN_CANC','$FN_SHIP']) f")" = "f" ] \
  && [ "$(q "SELECT bool_and(proacl IS NOT NULL) FROM pg_proc
             WHERE oid IN ('$HELPER'::regprocedure,'$FN_GUARD'::regprocedure,'$FN_PROC'::regprocedure,'$FN_RCPT'::regprocedure,'$FN_CANC'::regprocedure,'$FN_SHIP'::regprocedure)")" = "t" ] \
  && ok "[A8] 六函式零 grantee(proacl 非 NULL 已併驗,防 aclexplode(NULL) 恆綠)+ 三 role 顯式否定" \
  || bad "[A8] 函式 ACL 不符"
[ "$(q "SELECT (length(d) - length(replace(d,'FOR NO KEY UPDATE','')))/length('FOR NO KEY UPDATE') = 1
        AND strpos(d,'received_quantity') = 0
        AND strpos(d,'FOR NO KEY UPDATE') < strpos(d,'sum(p.allocated_quantity)')
        AND strpos(d,'sum(p.allocated_quantity)') < strpos(d,'ON CONFLICT (order_item_id) DO UPDATE')
        FROM (SELECT pg_get_functiondef('$HELPER'::regprocedure) d) s")" = "t" ] \
  && ok "[A9] helper 錨:NKU 恰 1、不讀累計欄、全序 鎖→SUM→upsert" || bad "[A9] helper 錨不符"
[ "$(q "SELECT strpos(pg_get_functiondef('$FN_PROC'::regprocedure),'a4a_iso_rc_procurement') > 0
        AND strpos(pg_get_functiondef('$FN_RCPT'::regprocedure),'a4a_iso_rc_receipts') > 0
        AND strpos(pg_get_functiondef('$FN_CANC'::regprocedure),'a4a_iso_rc_cancellation') > 0
        AND strpos(pg_get_functiondef('$FN_GUARD'::regprocedure),'pcm_a4a.received_sync') > 0
        AND strpos(pg_get_functiondef('$FN_GUARD'::regprocedure),'nullif') > 0")" = "t" ] \
  && ok "[A10] 三閘 tag 逐表具名(D3)+ guard 旗標與 nullif 錨" || bad "[A10] tag/旗標錨不符"
[ "$(q "SELECT count(*) FROM pg_class WHERE oid IN ('public.order_items'::regclass,'public.order_item_procurement'::regclass,'public.order_item_procurement_receipts'::regclass,'public.order_cancellation_items'::regclass,'public.order_item_quantity_summary'::regclass)
        AND (relowner <> (SELECT proowner FROM pg_proc WHERE oid='$HELPER'::regprocedure) OR relforcerowsecurity)")" = "0" ] \
  && ok "[A11] owner 對齊五表 + 零 FORCE RLS(R2-8)" || bad "[A11] owner/FORCE RLS 不符"

echo
echo "== B. 行為格 =="
# R1 惰性建列
case_ok "[R1] 採購 INSERT → 摘要列 (2,0,0)、quantity 複製" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',2);
DO \$r1\$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF s IS NULL OR s.ordered_quantity<>2 OR s.instock_quantity<>0 OR s.cancelled_quantity<>0 OR s.quantity<>5 THEN
    RAISE EXCEPTION 'R1:摘要 (%,%,%,q=%) 應 (2,0,0,q=5)', s.ordered_quantity, s.instock_quantity, s.cancelled_quantity, s.quantity;
  END IF;
END \$r1\$;"

# R2 只 INSERT receipt 的 statement 觸發同步(row 30 指定案例)
case_ok "[R2] 只 INSERT receipt → received=2 且 instock=2(row 30 指定)" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 2, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
DO \$r2\$
DECLARE v_r integer; v_i integer;
BEGIN
  SELECT received_quantity INTO v_r FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
  SELECT instock_quantity INTO v_i FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_r IS DISTINCT FROM 2 OR v_i IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R2:received=% instock=%(應 2/2)', v_r, v_i;
  END IF;
END \$r2\$;"

# R3 分批累計 + 超收擋(A2 合約債③)
case_ok "[R3a] 兩批 2+1 到貨 → received=3 恰滿" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 2, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
DO \$r3\$
DECLARE v_r integer;
BEGIN
  SELECT received_quantity INTO v_r FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
  IF v_r IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'R3a:received=%(應 3)', v_r; END IF;
END \$r3\$;"
expect_guard "[R3b] 第三批超 allocated → 整筆 abort" 23514 "order_item_procurement_received_range" "BEGIN;" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 3, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';" \
"INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';"

# R4 取消軸
case_ok "[R4] 取消 INSERT → cancelled=2 惰性建列" \
"$CANCEL_2
DO \$r4\$
DECLARE v integer;
BEGIN
  SELECT cancelled_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'R4:cancelled=%(應 2)', v; END IF;
END \$r4\$;"

# R5 UPDATE 升降跟動
case_ok "[R5] alloc 3→4→2,摘要 ordered 逐步跟動" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
UPDATE public.order_item_procurement SET allocated_quantity=4 WHERE order_item_id='$ITEM5';
DO \$r5a\$ DECLARE v integer; BEGIN
  SELECT ordered_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'R5:升後 ordered=%(應 4)', v; END IF; END \$r5a\$;
UPDATE public.order_item_procurement SET allocated_quantity=2 WHERE order_item_id='$ITEM5';
DO \$r5b\$ DECLARE v integer; BEGIN
  SELECT ordered_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'R5:降後 ordered=%(應 2)', v; END IF; END \$r5b\$;"

# R6 三表 DELETE 各自回算
case_ok "[R6] receipt/proc/cancel DELETE 各自回算(摘要列保留歸零)" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 2, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
$CANCEL_2
DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN (SELECT id FROM public.order_item_procurement WHERE order_item_id='$ITEM5');
DO \$r6a\$ DECLARE v integer; BEGIN
  SELECT instock_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'R6:receipt 刪後 instock=%', v; END IF; END \$r6a\$;
DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM5';
DELETE FROM public.order_cancellations WHERE id='bbbbbbbb-0000-0000-0000-0000000000a1'::uuid;
DO \$r6b\$ DECLARE s record; BEGIN
  SELECT * INTO s FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF s IS NULL OR s.ordered_quantity<>0 OR s.instock_quantity<>0 OR s.cancelled_quantity<>0 THEN
    RAISE EXCEPTION 'R6:全刪後摘要 (%,%,%) 應 (0,0,0) 且列保留', s.ordered_quantity, s.instock_quantity, s.cancelled_quantity;
  END IF; END \$r6b\$;"

# R7 換 parent:兩側摘要皆正確
case_ok "[R7] 換 parent P5→P3:兩側摘要 (0,0,0)/(2,1,0)" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',2);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
UPDATE public.order_item_procurement SET order_item_id='$ITEM3' WHERE order_item_id='$ITEM5';
DO \$r7\$
DECLARE s5 record; s3 record;
BEGIN
  SELECT * INTO s5 FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  SELECT * INTO s3 FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM3';
  IF s5.ordered_quantity<>0 OR s5.instock_quantity<>0 THEN RAISE EXCEPTION 'R7:P5 未清 (%,%)', s5.ordered_quantity, s5.instock_quantity; END IF;
  IF s3 IS NULL OR s3.ordered_quantity<>2 OR s3.instock_quantity<>1 THEN RAISE EXCEPTION 'R7:P3 不符 (%,%)', s3.ordered_quantity, s3.instock_quantity; END IF;
END \$r7\$;"

# R8 直寫守門三面
expect_guard "[R8a] UPDATE received_quantity(1→2 改動)" P4A01 "a4a_received_quantity_machine_maintained" "BEGIN;" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';" \
"UPDATE public.order_item_procurement SET received_quantity=2 WHERE order_item_id='$ITEM5';"
expect_guard "[R8b] INSERT 帶非 0 received" P4A01 "a4a_received_quantity_machine_maintained" "BEGIN;" "" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, received_quantity) VALUES ('$ITEM5','$S1',3,5);"
case_ok "[R8c] metadata-only UPDATE(reply_status)不受守門影響" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
UPDATE public.order_item_procurement SET reply_status='confirmed' WHERE order_item_id='$ITEM5';"
# R8d(code-reviewer R1 Critical):drift 判別格 —— 殺「值比對」退化版。
# 旗標路徑造 drift(received=0、receipts SUM=1)→ 清旗標 → 直寫 =SUM 的「正確值」(≠OLD)。
# 現行改動判定:1 IS DISTINCT FROM 0 ⇒ P4A01;若退化回 R1-4 被否決的「NEW=SUM 就放」值比對版
# ⇒ 本格放行轉紅 —— R8a/R8b 全是「寫錯值」、殺不到那個變體,本格是唯一判別點。
expect_guard "[R8d] drift 下直寫 =SUM 正確值(≠OLD)仍 P4A01(路徑判別非值比對)" P4A01 "a4a_received_quantity_machine_maintained" "BEGIN;" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
SELECT set_config('pcm_a4a.received_sync','1',true);
UPDATE public.order_item_procurement SET received_quantity=0 WHERE order_item_id='$ITEM5';
SELECT set_config('pcm_a4a.received_sync','',true);" \
"UPDATE public.order_item_procurement SET received_quantity=1 WHERE order_item_id='$ITEM5';"

# R9 隔離閘(tag 逐表)
expect_guard "[R9a] RR 取消 INSERT" P2B02 "a4a_iso_rc_cancellation" "BEGIN ISOLATION LEVEL REPEATABLE READ;" "" \
"$CANCEL_2"
expect_guard "[R9a2] SERIALIZABLE 取消 INSERT(Q1=A 不信 SSI)" P2B02 "a4a_iso_rc_cancellation" "BEGIN ISOLATION LEVEL SERIALIZABLE;" "" \
"$CANCEL_2"
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1)" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM5'")" = "1" ] \
  && ok "[R9-setup] committed 採購列在位(R9b/R9c 的 RR 事件需要既有列)" || bad "[R9-setup] 失敗"
expect_guard "[R9b] RR receipt INSERT" P2B02 "a4a_iso_rc_receipts" "BEGIN ISOLATION LEVEL REPEATABLE READ;" "" \
"INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';"
expect_guard "[R9c] RR 採購 DELETE(a2b1 未掛 DELETE ⇒ 本片閘的可達路徑;R2-2)" P2B02 "a4a_iso_rc_procurement" "BEGIN ISOLATION LEVEL REPEATABLE READ;" "" \
"DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5';"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5'" >/dev/null
q "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[R9-clean] committed 設置已清(含摘要列)" || bad "[R9-clean] 殘留"

# R10 DID:defer 兩名(契約債②)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
SET CONSTRAINTS $GUARD_A2B1, $TG_ZC DEFERRED;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
UPDATE public.order_item_procurement SET allocated_quantity=5 WHERE order_item_id='$ITEM5';
COMMIT;
SQL
)"
[ $? -eq 0 ] && [ "$(q "SELECT ordered_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'")" = "5" ] \
  && ok "[R10a] defer 兩名「先超後補」→ COMMIT 過、摘要=5(Q2=A 流程在 A4a 世界的正身)" \
  || bad "[R10a] 先超後補失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5'" >/dev/null
q "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[R10a-clean] 已清回基準" || bad "[R10a-clean] 殘留"
o="$(psql "$URL" -tAX <<SQL 2>&1
\set VERBOSITY verbose
BEGIN;
SET CONSTRAINTS $GUARD_A2B1, $TG_ZC DEFERRED;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',6);
COMMIT;
SQL
)"
printf '%s' "$o" | grep -q 'P2B01' && printf '%s' "$o" | grep -q 'A2b1 超量' \
  && ok "[R10b] defer 兩名超量不補 → COMMIT 紅在 P2B01 + a2b1 訊息(名稱序:guard 先於重算的 23514;COMMIT 層無 DO 可取 tag,以 SQLSTATE+訊息字面錨)" \
  || bad "[R10b] 錯誤歸因不符 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-200)"
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[R10b-clean] COMMIT 失敗自動回滾、零殘留" || bad "[R10b-clean] 殘留"

# R11 超量取消 → CHECK 網通電證明(K7)
expect_guard "[R11] 取消 6 > quantity 5 → CHECK 網擋(上界自本片啟用)" 23514 "oiqs_cancelled_le_quantity" "BEGIN;" "" \
"INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a3'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a4a-c3'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a3'::uuid, '$ORDER_ID', '$ITEM5', 6);"

# R12 竄改自癒
case_ok "[R12] 摘要被竄改後,下一次來源事件自癒(0→3 = 完整真相)" \
"$CANCEL_2
UPDATE public.order_item_quantity_summary SET cancelled_quantity=0 WHERE order_item_id='$ITEM5';
$CANCEL_PLUS1
DO \$r12\$ DECLARE v integer; BEGIN
  SELECT cancelled_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'R12:cancelled=%(應 3 = 自癒含被藏的 2)', v; END IF; END \$r12\$;"

# R13 混合活動後 oracle 0(oracle 抓得到已由 H4 消融證明)
case_ok "[R13] 混合活動(採購+到貨+取消)後漂移 oracle = 0" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
$CANCEL_2
DO \$r13\$ DECLARE v integer; BEGIN
  v := ($ORACLE_SQL);
  IF v <> 0 THEN RAISE EXCEPTION 'R13:oracle=%(應 0)', v; END IF; END \$r13\$;"

# R14 FIFO 鎖觀測(B12 同型;receipt 路徑 —— a2b1 guard 在 skip 枝、不鎖 parent,鎖只來自本片)
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3)" >/dev/null
open1
send1 "BEGIN;"
send1 "INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by) SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';"
ST="$(psql "$URL" -tAX -c "\set VERBOSITY verbose" -c "SELECT oi.quantity FROM public.order_items oi WHERE oi.id='$ITEM5' FOR NO KEY UPDATE NOWAIT" 2>&1 | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1)"
[ "$ST" = "55P03" ] && ok "[R14] 交易內 receipt 持 parent NKU,第二連線 NOWAIT 55P03(鎖真的在、且來自本片)" \
  || bad "[R14] 探針未被擋(state=$ST)"
send1 "ROLLBACK;"
PROBE_OK="$(q "SELECT oi.quantity FROM public.order_items oi WHERE oi.id='$ITEM5' FOR NO KEY UPDATE NOWAIT")"
[ "$PROBE_OK" = "5" ] && ok "[R14b] ROLLBACK 後探針立即成功(擋的就是那把鎖)" || bad "[R14b] 對照組失敗($PROBE_OK)"
close1
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5'" >/dev/null
q "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'" >/dev/null

# R15 INT_MAX 病理邊界:錯誤形狀 = 22003(R1-7)
expect_guard "[R15] quantity=INT_MAX、取消跨過上限 → 22003(指派溢位先於具名 CHECK;誠實列界)" 22003 "" "BEGIN;" \
"ALTER TABLE public.order_cancellation_items DISABLE TRIGGER $TG_CC;
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES ('$ORDER_ID', 'A4AV-MAX', '{\"title\":\"max\",\"sku\":\"A4AV-MAX\",\"spec\":{}}'::jsonb, 2147483647, 0, 0);
-- ↑ jsonb 若入庫失敗會紅在本 setup、非 22003(expect_guard 對 setup 錯誤同樣報 FAIL,無假綠)
INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a4'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a4a-c4'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT 'bbbbbbbb-0000-0000-0000-0000000000a4'::uuid, '$ORDER_ID', id, 2147483647 FROM public.order_items WHERE variant_sku='A4AV-MAX';
SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
ALTER TABLE public.order_cancellation_items ENABLE TRIGGER $TG_CC;
SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;" \
"INSERT INTO public.order_cancellations (id, order_id, reason_code, idempotency_key, payload_hash, actor)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000a5'::uuid, '$ORDER_ID', 'customer_request', gen_random_uuid(), encode(sha256('a4a-c5'::bytea),'hex'), '$STAFF');
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT 'bbbbbbbb-0000-0000-0000-0000000000a5'::uuid, '$ORDER_ID', id, 1 FROM public.order_items WHERE variant_sku='A4AV-MAX';"

# R16 sync abort 後旗標零殘留(R3-F4;GUC 隨子交易回滾語意)
case_ok "[R16] 超收 23514 被 savepoint 接住後,同交易直寫仍 P4A01(旗標零殘留)" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
DO \$r16a\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
    SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
    RAISE EXCEPTION 'R16:超收竟放行';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END \$r16a\$;
DO \$r16b\$
BEGIN
  BEGIN
    UPDATE public.order_item_procurement SET received_quantity=9 WHERE order_item_id='$ITEM5';
    RAISE EXCEPTION 'R16:sync abort 後直寫竟放行(旗標殘留!)';
  EXCEPTION WHEN SQLSTATE 'P4A01' THEN NULL;
  END;
END \$r16b\$;"

CELL=$((PASS+FAIL-PRE_CELL))

echo
echo "== C. 突變(10 真突變,MUT 逐次執行計數 —— codex K2-3;setup/clean/restore/自檢為輔助 checkpoint,計入 TOTAL 不計入 MUT)=="
PRE_MUTBLOCK=$((PASS+FAIL))
# N1 停用 receipts trigger ⇒ R2 翻面(row 30 指定突變)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
ALTER TABLE public.order_item_procurement_receipts DISABLE TRIGGER $TG_RC;
INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 2, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
DO \$n1\$
DECLARE v_r integer; v_i integer;
BEGIN
  SELECT received_quantity INTO v_r FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
  SELECT instock_quantity INTO v_i FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_r = 0 AND v_i = 0 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N1:未翻面(r=% i=%)', v_r, v_i; END IF;
END \$n1\$;
ROLLBACK;
SQL
)"
MUT=$((MUT+1))
printf '%s' "$o" | grep -q 'A4A_FLIP_OK' && ok "突變 N1 停用 receipts trigger ⇒ 只 INSERT receipt 完全無效(R2 翻面)" \
  || bad "突變 N1 — $(printf '%s' "$o" | grep -m1 -E 'ERROR|A4A_' | cut -c1-160)"

# N2 helper 去 cancelled 軸 ⇒ R4 翻面
mutate_fn "突變 N2 helper 去 cancelled 軸 ⇒ R4 翻面(cancelled 恆 0)" "$HELPER" \
"COALESCE(sum(c.cancelled_quantity), 0)" "0::bigint" \
"$CANCEL_2" \
"DO \$n2\$ DECLARE v integer; BEGIN
  SELECT cancelled_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v = 0 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N2:未翻面(v=%)', v; END IF; END \$n2\$;" 1

# N4 sync 去有效 UPDATE ⇒ received 恆 0 而 instock 真相直讀仍對
mutate_fn "突變 N4 sync SET 改自值 ⇒ received 恆 0、instock 仍 2(翻面在 received 軸)" "$FN_RCPT" \
"SET received_quantity = v_sum" "SET received_quantity = received_quantity" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
SELECT p.id, 2, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';" \
"DO \$n4\$ DECLARE v_r integer; v_i integer; BEGIN
  SELECT received_quantity INTO v_r FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
  SELECT instock_quantity INTO v_i FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v_r = 0 AND v_i = 2 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N4:未翻面(r=% i=%)', v_r, v_i; END IF; END \$n4\$;" 1

# N5 guard 判定恆假 ⇒ R8 翻面(直寫成功)
mutate_fn "突變 N5 guard 判定恆假 ⇒ 直寫 received 竟成功(R8 翻面)" "$FN_GUARD" \
"IS DISTINCT FROM OLD.received_quantity" "IS DISTINCT FROM NEW.received_quantity" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);" \
"UPDATE public.order_item_procurement SET received_quantity=2 WHERE order_item_id='$ITEM5';
DO \$n5\$ DECLARE v integer; BEGIN
  SELECT received_quantity INTO v FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
  IF v = 2 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N5:未翻面(v=%)', v; END IF; END \$n5\$;" 1

# N6 三閘逐支拿掉(kill 靠各自 tag;D3/R1-8)
mutate_fn "突變 N6a 取消閘拿掉 ⇒ RR 取消 INSERT 竟成功" "$FN_CANC" \
"pg_catalog.current_setting('transaction_isolation') <> 'read committed'" \
"pg_catalog.current_setting('transaction_isolation') <> pg_catalog.current_setting('transaction_isolation')" \
"$CANCEL_2" \
"DO \$n6a\$ DECLARE v integer; BEGIN
  SELECT cancelled_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v = 2 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N6a:未翻面(v=%)', v; END IF; END \$n6a\$;" 1 \
"BEGIN ISOLATION LEVEL REPEATABLE READ;"
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',1)" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement WHERE order_item_id='$ITEM5'")" = "1" ] \
  && ok "[N6-setup] committed 採購列在位" || bad "[N6-setup] 失敗"
# N6b:receipts 閘拿掉後,RR receipt 的錯誤來源位移 —— 級聯 UPDATE 撞上 a2b1 的閘
# (gate-first 蓋 skip 路徑)⇒ 翻面證據 = P2B02 的 tag 從 a4a_iso_rc_receipts 變 a2b1 的。
mutate_fn "突變 N6b receipts 閘拿掉 ⇒ P2B02 tag 位移到 a2b1(第一響應者換人 = 本閘已死)" "$FN_RCPT" \
"pg_catalog.current_setting('transaction_isolation') <> 'read committed'" \
"pg_catalog.current_setting('transaction_isolation') <> pg_catalog.current_setting('transaction_isolation')" \
"" \
"DO \$n6b\$ DECLARE v_con text; BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
    SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';
    RAISE EXCEPTION 'N6b:RR 下竟全通(a2b1 級聯閘也沒接手?)';
  EXCEPTION WHEN SQLSTATE 'P2B02' THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'a2b1_isolation_read_committed_only' THEN RAISE NOTICE 'A4A_FLIP_OK';
    ELSE RAISE EXCEPTION 'N6b:tag 未位移(仍 %)', v_con; END IF;
  END;
END \$n6b\$;" 1 \
"BEGIN ISOLATION LEVEL REPEATABLE READ;"
mutate_fn "突變 N6c 採購閘拿掉 ⇒ RR DELETE 竟成功" "$FN_PROC" \
"pg_catalog.current_setting('transaction_isolation') <> 'read committed'" \
"pg_catalog.current_setting('transaction_isolation') <> pg_catalog.current_setting('transaction_isolation')" \
"" \
"DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
DO \$n6c\$ DECLARE v integer; BEGIN
  SELECT count(*) INTO v FROM public.order_item_procurement WHERE order_item_id='$ITEM5';
  IF v = 0 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N6c:未翻面(v=%)', v; END IF; END \$n6c\$;" 1 \
"BEGIN ISOLATION LEVEL REPEATABLE READ;"
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5'" >/dev/null
q "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'" >/dev/null
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && ok "[N6-clean] committed 設置已清" || bad "[N6-clean] 殘留"

# N7 取消 trigger 砍 DELETE 事件 ⇒ R6 取消軸翻面
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
DROP TRIGGER $TG_CC ON public.order_cancellation_items;
CREATE CONSTRAINT TRIGGER $TG_CC
  AFTER INSERT OR UPDATE ON public.order_cancellation_items
  NOT DEFERRABLE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a4a_cancellation_summary_recompute();
$CANCEL_2
DELETE FROM public.order_cancellation_items WHERE order_item_id='$ITEM5';
DO \$n7\$ DECLARE v integer; BEGIN
  SELECT cancelled_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v = 2 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N7:未翻面(v=%)', v; END IF; END \$n7\$;
ROLLBACK;
SQL
)"
MUT=$((MUT+1))
printf '%s' "$o" | grep -q 'A4A_FLIP_OK' && ok "突變 N7 trigger 砍 DELETE 事件 ⇒ 刪取消不回算(R6 翻面)" \
  || bad "突變 N7 — $(printf '%s' "$o" | grep -m1 -E 'ERROR|A4A_' | cut -c1-160)"

# N8 upsert 的 ordered 軸被改寫回自值 ⇒ R5 翻面
# 🔴 S2b-4a 項 23(封窗案 A):舊錨是「在 SET 清單的最後一個元素後面接 WHERE false」,
#    那個形狀把「cancelled_quantity 必須是最後一欄」寫死成了突變的前提。
#    S2b-1 四軸化會在它後面追加 shipped_quantity,突變於是產出
#      cancelled_quantity = EXCLUDED.cancelled_quantity WHERE false, shipped_quantity = ...
#    ⇒ 42601 syntax_error(2026-08-06 於 port 54357 實測確認)。
#    🔴 而且**錨仍然命中**,所以 mut_block 的三重 preflight 一個都擋不下來 —— 它壞在下游 EXECUTE。
#    新錨改成「就地把 ordered 這一軸的 RHS 換成自值」:不依賴欄序、不新增子句,
#    在三軸現況、以及**手造的四軸版**(probe 內把 shipped_quantity 追加進 SET 清單再套上)
#    兩個版本上都恰命中 1 次且產出合法 SQL —— 2026-08-06 於 port 54357 實跑。
#    🔴 誠實界:四軸 helper 此刻**尚不存在**(S2b-1 才建),上句的「四軸版」是 probe 手造的,
#    不是對真的 S2b-1 產物測的;S2b-1 落地後這一格是它的回歸點。
# 🔴 判定維持**fail-closed 正向形**(`IF v = 3 THEN 綠 ELSE 炸`),不寫成 `IF v <> 3 THEN 炸`:
#    摘要列不存在時 v 是 NULL,`NULL <> 3` 求值為 NULL ⇒ IF 不觸發 ⇒ 直接落到 NOTICE = 全綠。
#    本片一度真的寫成後者,審查抓出、實測確認(對不存在的 id 跑同形 DO 塊會印 A4A_FLIP_OK)。
#    NULL 另外單獨擋:那才是「helper 整支沒跑」的觀察面。
# 🔴 本格的**配對正向格 = `[R5]`(`grep -n '\[R5\]'`,同一個 $ITEM5、同一句 SET allocated_quantity=4)**。
#    單看本格無法區分「突變生效」與「zc trigger 對 UPDATE 根本不觸發」——
#    那個因果基礎由同一 run 的 R5 提供。**刪或改 R5 會靜默抽走本格唯一的因果基礎,而三綠不會變色**
#    ⇒ 動 R5 的人請一併重估本格(R2 nit,2026-08-06)。
mutate_fn "突變 N8 upsert 的 ordered 軸改寫回自值 ⇒ alloc 3→4 摘要凍在 3(R5 翻面)" "$HELPER" \
"= EXCLUDED.ordered_quantity" "= order_item_quantity_summary.ordered_quantity" \
"INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3);" \
"UPDATE public.order_item_procurement SET allocated_quantity=4 WHERE order_item_id='$ITEM5';
DO \$n8\$ DECLARE v integer; BEGIN
  SELECT ordered_quantity INTO v FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5';
  IF v IS NULL THEN RAISE EXCEPTION 'N8:摘要列不存在 —— helper 整支沒跑,不是翻面'; END IF;
  IF v = 3 THEN RAISE NOTICE 'A4A_FLIP_OK'; ELSE RAISE EXCEPTION 'N8:未翻面(v=%)', v; END IF; END \$n8\$;" 1

# N-self 突變機械自檢:錯 anchor 必炸
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
SELECT set_config('harness.mut_fnsig', '$HELPER', true);
SELECT set_config('harness.mut_from', 'THIS_ANCHOR_DOES_NOT_EXIST', true);
SELECT set_config('harness.mut_to', 'x', true);
SELECT set_config('harness.mut_occ', '1', true);
$(mut_block)
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q '突變未套上' && ok "突變機械自檢:錯 anchor 必炸(preflight 活著)" \
  || bad "突變機械自檢失敗 — 錯 anchor 竟未被擋"

# N3(唯一 committed 突變:helper 去 NKU;跨連線才觀察得到)⇒ R14 探針翻面
MUTATED=1
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
SELECT set_config('harness.mut_fnsig', '$HELPER', false);
SELECT set_config('harness.mut_from', 'FOR NO KEY UPDATE', false);
SELECT set_config('harness.mut_to', '', false);
SELECT set_config('harness.mut_occ', '1', false);
$(mut_block)
SQL
)"
if [ $? -eq 0 ]; then
  ok "[N3-setup] committed 去 NKU mutant 已套(md5 已變)"
else
  bad "[N3-setup] mutant 套用失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
fi
q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity) VALUES ('$ITEM5','$S1',3)" >/dev/null
open1
send1 "BEGIN;"
send1 "INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by) SELECT p.id, 1, now(), 'a4a_verify' FROM public.order_item_procurement p WHERE p.order_item_id='$ITEM5';"
PROBE_N3="$(q "SELECT oi.quantity FROM public.order_items oi WHERE oi.id='$ITEM5' FOR NO KEY UPDATE NOWAIT")"
MUT=$((MUT+1))
[ "$PROBE_N3" = "5" ] && ok "突變 N3 拿掉 NKU ⇒ R14 探針翻面(NOWAIT 竟成功 = parent 鎖不在了)" \
  || bad "突變 N3 未翻面(probe=$PROBE_N3)—— 鎖被別的機制供給?"
send1 "ROLLBACK;"
close1
psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$ORIGDEF_FILE" >/dev/null 2>&1
if [ "$(q "SELECT md5(pg_get_functiondef('$HELPER'::regprocedure))")" = "$MD5_HELPER" ]; then
  MUTATED=0; ok "[N3-restore] helper 已還原(md5 = 基準)"
else
  bad "[N3-restore] 還原失敗 —— 庫仍是突變版"
fi
q "DELETE FROM public.order_item_procurement WHERE order_item_id='$ITEM5'" >/dev/null
q "DELETE FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'" >/dev/null

echo
# 🔴 本閘的兩發負測(R2 nit:原本只存在於敘述,重跑者得靠猜)。把下面任一行**貼在本註解正下方**、
#    跑一次、再刪掉;預期兩發都是「恰紅一條」且 bad 訊息顯示 trigger漂移[YES]:
#    A(只動啟用態,證 tgenabled 分量):
#      q "ALTER TABLE public.order_cancellation_items DISABLE TRIGGER $TG_CC" >/dev/null
#    B(只動定義、啟用態仍 O,證 md5(pg_get_triggerdef) 分量):
#      q "DROP TRIGGER $TG_CC ON public.order_cancellation_items" >/dev/null
#      q "CREATE CONSTRAINT TRIGGER $TG_CC AFTER INSERT ON public.order_cancellation_items NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION pcm_a4a_cancellation_summary_recompute()" >/dev/null
#    🔴 兩發都會**留痕**(committed DDL),跑完必須把 trigger 還原成原定義再繼續用那座庫。
#    🔴 兩發必須跑在**同一版腳本**上才算等長同形(R2 抓到我第一次沒做到)。
echo "== 收尾:零殘留與計數 =="
[ "$(q "SELECT count(*) FROM public.order_item_procurement")" = "$PROC_N0" ] \
  && [ "$(q "SELECT count(*) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$ITEM5','$ITEM3')")" = "0" ] \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_GUARD'::regprocedure))")" = "$MD5_GUARD" ] \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_PROC'::regprocedure))")" = "$MD5_PROC" ] \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_RCPT'::regprocedure))")" = "$MD5_RCPT" ] \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_CANC'::regprocedure))")" = "$MD5_CANC" ] \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SHIP'::regprocedure))")" = "$MD5_SHIP" ] \
  && [ "$(q "$TG_DEF_SQL")" = "$TG_DEF0" ] \
  && [ "$(q "$ORACLE_SQL")" = "0" ] \
  && ok "零殘留:proc 計數復歸、fixture 摘要清空、六函式 md5 = 基準、五 trigger 定義+啟用態 = 基準、oracle 0" \
  || bad "殘留或漂移 —— proc計數[$(q "SELECT count(*) FROM public.order_item_procurement")/$PROC_N0] fixture摘要[$(q "SELECT count(*) FROM public.order_item_quantity_summary WHERE order_item_id IN ('$ITEM5','$ITEM3')")] trigger漂移[$([ "$(q "$TG_DEF_SQL")" = "$TG_DEF0" ] && echo no || echo YES)] oracle[$(q "$ORACLE_SQL")]"

echo
echo "== 結果:PASS=$PASS FAIL=$FAIL SKIP=$SKIP(CELL=$CELL MUT=$MUT)=="
GATE_OK=1
count_gate "$EXPECTED_MUT" "$MUT" || { echo "🔴 MUT 計數閘:$MUT ≠ $EXPECTED_MUT"; GATE_OK=0; }
count_gate "$EXPECTED_CELL" "$CELL" || { echo "🔴 CELL 計數閘:$CELL ≠ $EXPECTED_CELL"; GATE_OK=0; }
[ "$SKIP" -eq 0 ] || { echo "🔴 SKIP 閘:$SKIP ≠ 0"; GATE_OK=0; }
[ "$FAIL" -eq 0 ] && [ "$GATE_OK" -eq 1 ] || exit 1
[ "$EXPECTED_TOTAL" != "999" ] && { count_gate "$EXPECTED_TOTAL" "$PASS" || { echo "🔴 TOTAL 計數閘:$PASS ≠ $EXPECTED_TOTAL"; exit 1; }; }
exit 0
