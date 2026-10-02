#!/usr/bin/env bash
# `20261002100000_m4b_manual_order_record_payment_at_create.sql`(貼板 263)的行為驗證
# 要證的(Sean 2026-10-02「建單時登記收款」Q1–Q4 甲):
#   · 已收全額:現金 / 刷卡 / 匯款建單即已付款;金額 = 函式算的訂單總額(含稅);刷卡手續費 2.5%;收款時間 = 訂單成立時間
#   · 部分收款 ⇒ 部分付款;超過總額 ⇒ P2S05 且訂單沒建;匯款沒填單號 ⇒ 擋且訂單沒建
#   · 全額與部分同時填、蝦皮單填收款、沒收款卻帶單號 ⇒ 擋
#   · 沒勾 ⇒ 跟貼板前一樣(未付款、0 筆收款);蝦皮進帳照舊
#   · 冪等:同鍵同內容 ⇒ idempotent 不重複記錢;同鍵改收款金額 ⇒ P858B
#   · 回滾來回:回滾後函式 = 貼板 262 版本、註解沒有殘留;再套一次;已貼過再貼 ⇒ 前置閘擋
#   · 突變:收款時間改 clock_timestamp() ⇒ 全額那格不再是已付款(證明 now() 是承重的)
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration(含貼板 262)。
# 先紅:套本支之前跑同一批格子, 新參數不存在 ⇒ 每格都要是紅的(「貼前」段)。
# 用法:bash scripts/20261002100000-verify.sh
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002100000_m4b_manual_order_record_payment_at_create.sql"
DOWN="$REPO/supabase/rollbacks/20261002100000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done

WIN="v263-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"
D="/tmp/pcm-sd-$WIN"
cleanup() { pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
[ -n "$PORT" ] || { printf '%s\n' "$OUT"; echo "ENV-FAIL:讀不到埠"; exit 3; }

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
P() { "${PSQL[@]}" "$@"; }
Q() { P -tA -c "$1"; }
FAIL=0; N=0
cell() {
  N=$((N+1))
  if [ "$2" = "$3" ]; then printf '  PASS %-60s (%s)\n' "$1" "$2"
  else printf '  🔴 FAIL %-57s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi
}

# ── 世界:dump 之後已貼的 migration(到 262 為止)──
APPLIED_N=0; SKIP_N=0
while IFS= read -r v; do
  f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"
  [ -n "$f" ] || continue
  if P -f "$f" >/dev/null 2>&1; then APPLIED_N=$((APPLIED_N+1)); else SKIP_N=$((SKIP_N+1)); fi
done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002100000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
echo "世界:套上 $APPLIED_N 支、套不上 $SKIP_N 支(排程 / storage / 真資料前置閘)"
echo "── 前置:兩支函式與正式庫貼板 262 之後相同 ──"
cell "admin_create_manual_order 本體" "$(Q "select md5(prosrc) from pg_proc where proname='admin_create_manual_order'")" "ae32a0bf11be9de1392885d031e94f7a"
cell "admin_record_manual_payment 本體" "$(Q "select md5(prosrc) from pg_proc where proname='admin_record_manual_payment'")" "621ce2206bbac674168749e994248cfc"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上, 下面的結果不算數"; exit 3; }

P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試小工具建不起來"; exit 3; }
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_263', '測試員', true);
CREATE FUNCTION public.zz_cust() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v, v::text || '@263.test', '{}'::jsonb);
  INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES (v, v::text || '@263.test', '測試客人', '0912345678', 'general');
  RETURN v;
END $f$;
-- 用具名參數建單(單價 7700 + 運費 200 = 7900;p_invoice_req = true ⇒ 加 5% 稅):成功回 order_id, 失敗回 SQLSTATE。
CREATE FUNCTION public.zz_cp(p_source text, p_channel text, p_instr text, p_payout integer,
                             p_full boolean, p_amount integer, p_ref text, p_note text,
                             p_key uuid DEFAULT gen_random_uuid(), p_cust uuid DEFAULT NULL, p_invoice_req boolean DEFAULT false)
  RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r jsonb; st text;
BEGIN
  r := public.admin_create_manual_order(
         p_customer_user_id => coalesce(p_cust, public.zz_cust()), p_manual_request_id => p_key, p_actor => 'probe_263',
         p_order_source => p_source, p_payment_channel => p_channel, p_shipping_method => 'home',
         p_ship_to => '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
         p_invoice => jsonb_build_object('type', 'personal', 'requested', p_invoice_req), p_shipping_fee => 200,
         p_lines => '[{"sku":"Q1","title":"測試品","qty":1,"unit_price":7700,"spec":{}}]'::jsonb,
         p_payment_instrument => p_instr, p_shopee_payout => p_payout,
         p_paid_full => p_full, p_paid_amount => p_amount, p_bank_reference => p_ref, p_payer_note => p_note);
  RETURN CASE WHEN (r ->> 'idempotent')::boolean THEN 'IDEMPOTENT:' ELSE '' END || (r ->> 'order_id');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE;
  RETURN st;
END $f$;
SQL
cp() { Q "select public.zz_cp($1)"; }
status_of() { Q "select payment_status from public.orders where id = '$1'"; }
pays_of() { Q "select coalesce(string_agg(rail || ':' || amount || ':' || coalesce(payment_instrument, '-') || ':fee' || coalesce(fee_amount::text, 'NULL') || ':' || coalesce(bank_reference, '-') || ':' || coalesce(payer_note, '-'), ',' order by created_at), 'none') from public.order_payments where order_id = '$1'"; }
orders_now() { Q "select count(*) from public.orders"; }
is_uuid() { case "$1" in ????????-????-????-????-????????????) echo uuid ;; *) echo "$1" ;; esac; }

# 同一批格子跑兩次:貼前(每格要紅)與貼後(每格要綠)。回 "通過數/總數"。
run_cells() {
  local O B before after k
  O="$(cp "'manual_phone', 'cash', NULL, NULL, true, NULL, NULL, NULL")"
  cell "現金已收全額 ⇒ 建單成功" "$(is_uuid "$O")" "uuid"
  cell "現金已收全額 ⇒ 已付款" "$(status_of "$O")" "paid"
  cell "現金已收全額 ⇒ 一筆 7900 現金、手續費 0" "$(pays_of "$O")" "cash:7900:-:fee0:-:-"
  cell "收款時間 = 訂單成立時間(now(), Q2 甲)" "$(Q "select bool_and(p.received_at = o.created_at) from public.order_payments p join public.orders o on o.id = p.order_id where o.id = '$O'")" "t"
  O="$(cp "'manual_phone', 'cash', 'card_terminal', NULL, true, NULL, NULL, NULL")"
  cell "刷卡已收全額 ⇒ 已付款" "$(status_of "$O")" "paid"
  cell "刷卡 7900 ⇒ 手續費 197(7900 − round(7702.5))" "$(pays_of "$O")" "cash:7900:card_terminal:fee197:-:-"
  O="$(cp "'manual_line', 'bank_transfer', NULL, NULL, true, NULL, 'A12345', '客人 10/1 匯款'")"
  cell "匯款已收全額 ⇒ 已付款" "$(status_of "$O")" "paid"
  cell "匯款 ⇒ 記下單號與備註" "$(pays_of "$O")" "bank_transfer:7900:-:fee0:A12345:客人 10/1 匯款"
  O="$(cp "'manual_phone', 'cash', NULL, NULL, true, NULL, NULL, NULL, gen_random_uuid(), NULL, true")"
  cell "開發票 ⇒ 全額 = 含稅總額" "$(Q "select (select amount from public.order_payments where order_id = o.id) = o.total and o.total > 7900 from public.orders o where o.id = '$O'")" "t"
  O="$(cp "'manual_phone', 'cash', NULL, NULL, false, 3000, NULL, '訂金'")"
  cell "部分收款 3000 ⇒ 部分付款" "$(status_of "$O")" "partiallyPaid"
  cell "部分收款 ⇒ 一筆 3000" "$(pays_of "$O")" "cash:3000:-:fee0:-:訂金"
  B="$(orders_now)"
  cell "超過總額 ⇒ P2S05" "$(cp "'manual_phone', 'cash', NULL, NULL, false, 9000, NULL, NULL")" "P2S05"
  cell "匯款沒填單號 ⇒ 擋" "$(cp "'manual_phone', 'bank_transfer', NULL, NULL, true, NULL, NULL, NULL")" "P0001"
  cell "全額與部分同時填 ⇒ 擋" "$(cp "'manual_phone', 'cash', NULL, NULL, true, 100, NULL, NULL")" "P0001"
  cell "蝦皮單填收款 ⇒ 擋" "$(cp "'manual_shopee', 'cash', NULL, NULL, true, NULL, NULL, NULL")" "P0001"
  cell "沒收款卻帶單號 ⇒ 擋" "$(cp "'manual_phone', 'bank_transfer', NULL, NULL, false, NULL, 'A1', NULL")" "P0001"
  cell "上面五個被擋的都沒有留下訂單" "$(orders_now)" "$B"
  O="$(cp "'manual_phone', 'bank_transfer', NULL, NULL, false, NULL, NULL, NULL")"
  cell "沒勾 ⇒ 未付款、0 筆收款(跟貼板前一樣)" "$(status_of "$O")|$(pays_of "$O")" "unpaid|none"
  O="$(cp "'manual_shopee', 'cash', NULL, 7016, false, NULL, NULL, NULL")"
  cell "蝦皮進帳照舊 ⇒ 已付款、手續費 884" "$(status_of "$O")|$(pays_of "$O")" "paid|cash:7900:shopee:fee884:-:-"
  k="$(python3 -c 'import uuid; print(uuid.uuid4())')"; c="$(Q "select public.zz_cust()")"
  before="$(cp "'manual_phone', 'cash', NULL, NULL, true, NULL, NULL, NULL, '$k', '$c'")"
  after="$(cp "'manual_phone', 'cash', NULL, NULL, true, NULL, NULL, NULL, '$k', '$c'")"
  cell "同鍵同內容重送 ⇒ 回同一張單、不重複記錢" "$after|$(Q "select count(*) from public.order_payments where order_id = '${before}'")" "IDEMPOTENT:$before|1"
  cell "同鍵改成部分收款 ⇒ P858B" "$(cp "'manual_phone', 'cash', NULL, NULL, false, 3000, NULL, NULL, '$k', '$c'")" "P858B"
}

echo "── 貼前(先紅:新參數還不存在, 下面每格都應該是 FAIL)──"
FAIL_SAVE=$FAIL; N_SAVE=$N
OUT_BEFORE="$(run_cells 2>/dev/null)"
printf '%s\n' "$OUT_BEFORE" | sed 's/^/  [貼前] /'
RED_N="$(printf '%s\n' "$OUT_BEFORE" | grep -c 'FAIL')"; ALL_N="$(printf '%s\n' "$OUT_BEFORE" | grep -c 'PASS\|FAIL')"
FAIL=$FAIL_SAVE; N=$N_SAVE
# 「沒有留下訂單」那一格貼前也成立(貼前每一發都建不出單), 所以貼前紅的是其餘每一格。
cell "貼前除了「沒有留下訂單」那格, 其餘都是紅的" "$RED_N/$ALL_N" "$((ALL_N-1))/$ALL_N"

P -f "$MIG" >/dev/null || { echo "🔴 migration 套不上"; exit 1; }
echo "── 貼後 ──"
run_cells
cell "函式只有 1 支(舊 17 參那支已拿掉)" "$(Q "select count(*) from pg_proc where proname='admin_create_manual_order'")" "1"
cell "權限:anon / authenticated 不可、service_role 可" "$(Q "select has_function_privilege('anon', p.oid, 'EXECUTE')::text || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || has_function_privilege('service_role', p.oid, 'EXECUTE')::text from pg_proc p where proname='admin_create_manual_order'")" "falsefalsetrue"
cell "註解保留 262 的那段、加上 263 的那段" "$(Q "select (obj_description(p.oid, 'pg_proc') like '%貼板 262%')::text || (obj_description(p.oid, 'pg_proc') like '%貼板 263%')::text from pg_proc p where proname='admin_create_manual_order'")" "truetrue"
cell "已貼過再貼 ⇒ 前置閘整筆擋" "$(P -f "$MIG" 2>&1 | grep -c '貼板 263 前置閘')" "1"

echo "── 回滾來回 ──"
P -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗"; FAIL=1; }
cell "回滾後建單函式 = 貼板 262 版本" "$(Q "select md5(prosrc) from pg_proc where proname='admin_create_manual_order'")" "ae32a0bf11be9de1392885d031e94f7a"
cell "回滾後註解沒有殘留 263" "$(Q "select (obj_description(p.oid, 'pg_proc') like '%貼板 263%')::text from pg_proc p where proname='admin_create_manual_order'")" "false"
cell "回滾後權限照舊" "$(Q "select has_function_privilege('anon', p.oid, 'EXECUTE')::text || has_function_privilege('service_role', p.oid, 'EXECUTE')::text from pg_proc p where proname='admin_create_manual_order'")" "falsetrue"
P -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(Q "select count(*) from pg_proc where proname='admin_create_manual_order' and pronargs = 21")" "1"

echo "── 突變:收款時間改 clock_timestamp() ⇒ 全額那格不再是已付款 ──"
P >/dev/null <<'SQL' || { echo "ENV-FAIL:突變套不上"; exit 3; }
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.admin_create_manual_order'::regproc);
  IF strpos(d, 'pg_catalog.now(), p_bank_reference') = 0 THEN RAISE EXCEPTION '突變找不到目標字串'; END IF;
  EXECUTE replace(d, 'pg_catalog.now(), p_bank_reference', 'pg_catalog.clock_timestamp(), p_bank_reference');
END $m$;
SQL
O="$(cp "'manual_phone', 'cash', NULL, NULL, true, NULL, NULL, NULL")"
cell "突變後 ⇒ 單照樣建立, 但停在未付款(結清判定把它當成未來的收款)" "$(is_uuid "$O")|$(status_of "$O")" "uuid|unpaid"

if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
