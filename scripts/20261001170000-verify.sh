#!/usr/bin/env bash
# `20261001170000_m4b_payment_fee_and_card_terminal.sql` 的行為驗證(報價單Q1 2026-10-01)
# 要證的:
#   · 手續費:刷卡 3100 ⇒ 手續費 77、營業額 3023(Sean 的例子;3022.5 四捨五入成 3023);3144 ⇒ 79(78.6 不是捨去)
#   · TapPay(card)同樣 2.5%;匯款 / 現金 0;沖銷列手續費反號;取不到費率 ⇒ NULL 但寫入成功(不擋付款確認)
#   · 蝦皮:收款 7,900、進帳 7,016 ⇒ 手續費 884、訂單已收齊;蝦皮單不收別的方式、別的單不收蝦皮;進帳不可大於金額
#   · 分次付款各自扣;部分退款扣退款、不退手續費;營業額 = 收款 − 手續費 − 退款
#   · 冪等:同鍵同內容 ⇒ idempotent;同鍵換標記 ⇒ 拒
#   · 新欄寫入後不可改;手動退款的刷卡標記只能配 cash
#   · 今日實收扣手續費;權限只給 service_role
#   · 突變:拿掉觸發器 / 把四捨五入改成捨去 ⇒ 對應那格轉紅
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration。
#   其中排程 / storage / 需要真資料的前置閘那幾支在這個世界套不上(預期 17 支),與收款無關;
#   收款相關 8 支函式的本體 md5 與正式庫 2026-10-01 相同(下面的前置格會核)。
# 🛑 用替身的地方(照實列):
#   · 刷卡 / 蝦皮訂單用 admin_create_manual_order 建成 cash 單後, 直接 UPDATE 補 payment_instrument / order_source
#     (建單 RPC 的付款標記參數在下一段, 等 261 貼完才加)。
#   · TapPay 收款直接 INSERT order_payments(rail = card、帶假交易號), 沒有走 confirm_order_payment。
#   · TapPay 退款直接 INSERT order_refunds(status = confirmed;暫停該表 USER trigger, 它擋直接寫入)。
# 用法:bash scripts/20261001170000-verify.sh
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261001170000_m4b_payment_fee_and_card_terminal.sql"
DOWN="$REPO/supabase/rollbacks/20261001170000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done

WIN="v262-$$"
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

# ── 世界:dump 之後已貼的 migration ──
APPLIED_N=0; SKIP_N=0
while IFS= read -r v; do
  f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"
  [ -n "$f" ] || continue
  if P -f "$f" >/dev/null 2>&1; then APPLIED_N=$((APPLIED_N+1)); else SKIP_N=$((SKIP_N+1)); fi
done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261001170000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
echo "世界:套上 $APPLIED_N 支、套不上 $SKIP_N 支(排程 / storage / 真資料前置閘)"
echo "── 前置:收款相關函式與正式庫 2026-10-01 相同 ──"
cell "admin_record_manual_payment 本體" "$(Q "select md5(prosrc) from pg_proc where proname='admin_record_manual_payment'")" "be85108ca0b8296531f25246083491c8"
cell "admin_record_manual_refund 本體" "$(Q "select md5(prosrc) from pg_proc where proname='admin_record_manual_refund'")" "71ac9c1313a3d41fcb0c92eeaf1cbcb1"
cell "admin_create_manual_order 本體" "$(Q "select md5(prosrc) from pg_proc where proname='admin_create_manual_order'")" "8e1005fa67086c1e0ecca8216312e9f3"
cell "pcm_noncard_settle_recompute 本體" "$(Q "select md5(prosrc) from pg_proc where proname='pcm_noncard_settle_recompute'")" "b9878df98a4000844024aedfb8b907c1"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上, 下面的結果不算數"; exit 3; }

P -f "$MIG" >/dev/null || { echo "🔴 migration 套不上"; exit 1; }

echo "── 回滾來回(空資料):回滾後 6 支函式與正式庫 2026-10-01 逐字相同, 再套一次 ──"
MD5Q="select string_agg(proname || '=' || md5(prosrc), ',' order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname, proname) in (('public','admin_list_order_payments'),('public','admin_record_manual_payment'),('public','admin_record_manual_refund'),('public','admin_today_payment_total'),('public','pcm_d3d_manual_refund_immutable'),('public','pcm_op2b_immutable_columns'),('pcm_cron','expire_unpaid_orders'))"
P -f "$DOWN" >/dev/null 2>&1 || { echo "🔴 空資料時回滾失敗"; FAIL=1; }
cell "回滾後函式本體 = 正式庫" "$(Q "$MD5Q")" "admin_list_order_payments=38fcf5f1e5021cf8e98c4a3b643894ad,admin_record_manual_payment=be85108ca0b8296531f25246083491c8,admin_record_manual_refund=71ac9c1313a3d41fcb0c92eeaf1cbcb1,admin_today_payment_total=0eb2a625cbfd2162807be57153043c32,expire_unpaid_orders=7e1e6764def6738440a1012cbea44f05,pcm_d3d_manual_refund_immutable=942a79bbd5026d87d01614d2f02aa677,pcm_op2b_immutable_columns=942be0ed1c8d87c2a4e43e66f679314b"
cell "回滾後新欄與新表都不在" "$(Q "select count(*) from information_schema.columns where table_schema='public' and column_name in ('payment_instrument','fee_rate','fee_amount')")|$(Q "select count(*) from pg_tables where tablename='payment_fee_rates'")" "0|0"
P -f "$MIG" >/dev/null || { echo "🔴 回滾後再套失敗"; exit 1; }

cat > "$D/tools.sql" <<'SQL'
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_q1', '測試員', true);
CREATE TABLE public.zz_r (tag text PRIMARY KEY, res jsonb NOT NULL);
CREATE FUNCTION public.zz_cust() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v, v::text || '@q1.test', '{}'::jsonb);
  INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES (v, v::text || '@q1.test', '測試客人', '0912345678', 'general');
  RETURN v;
END $f$;
-- 建一張 cash 手動單:總額 = 單價 + 運費;p_kind = 'card_terminal' / 'shopee' / NULL
CREATE FUNCTION public.zz_order(p_unit integer, p_ship integer, p_kind text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb; v_id uuid;
BEGIN
  v := public.admin_create_manual_order(public.zz_cust(), gen_random_uuid(), 'probe_q1', 'manual_phone', 'cash', 'home',
         '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
         '{"type":"personal","requested":false}'::jsonb, p_ship,
         pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('sku','Q1','title','測試品','qty',1,'unit_price',p_unit,'spec','{}'::jsonb)));
  v_id := (v ->> 'order_id')::uuid;
  IF p_kind = 'shopee' THEN
    UPDATE public.orders SET order_source = 'manual_shopee', payment_instrument = 'shopee' WHERE id = v_id;
  ELSIF p_kind IS NOT NULL THEN
    UPDATE public.orders SET payment_instrument = p_kind WHERE id = v_id;
  END IF;
  RETURN v_id;
END $f$;
CREATE FUNCTION public.zz_pay(p_tag text, p_order uuid, p_key uuid, p_rail text, p_amount integer,
                              p_instr text, p_payout integer, p_at timestamptz DEFAULT now()) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r jsonb; st text; con text; msg text;
BEGIN
  BEGIN
    r := public.admin_record_manual_payment(p_order, p_key, 'probe_q1', p_rail, p_amount, p_at,
           CASE WHEN p_rail = 'bank_transfer' THEN 'REF12345' END, NULL, p_instr, p_payout);
    r := r || jsonb_build_object('state', 'OK');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, con = CONSTRAINT_NAME, msg = MESSAGE_TEXT;
    r := jsonb_build_object('state', st, 'con', COALESCE(con, '-'), 'msg', msg);
  END;
  INSERT INTO public.zz_r (tag, res) VALUES (p_tag, r) ON CONFLICT (tag) DO UPDATE SET res = EXCLUDED.res;
  RETURN r ->> 'state';
END $f$;
SQL
P -f "$D/tools.sql" >/dev/null || { echo "ENV-FAIL:測試小工具建不起來"; exit 3; }
uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
total_of() { Q "select total from public.orders where id = '$1'"; }
fee_of() { Q "select coalesce(fee_amount::text,'NULL') from public.order_payments where order_id = '$1' and reverses_payment_id is null order by created_at desc limit 1"; }
status_of() { Q "select payment_status from public.orders where id = '$1'"; }
pay() { Q "select public.zz_pay('$1', '$2', '$3', '$4', $5, $6, $7${8:+, '$8'})"; }   # 第 8 個 = 收款時點(冪等測要固定)   # tag order key rail amount instr_sql payout_sql

echo "── 刷卡手續費(Sean 例:3100 ⇒ 3023)──"
O1="$(Q "select public.zz_order(3000, 100, 'card_terminal')")"
cell "建出來的單總額" "$(total_of "$O1")" "3100"
cell "刷卡 3100 登記成功" "$(pay c1 "$O1" "$(uuid)" cash 3100 "'card_terminal'" NULL)" "OK"
cell "手續費 77(3100 − round(3022.5) = 3100 − 3023)" "$(fee_of "$O1")" "77"
cell "費率記下 0.025" "$(Q "select fee_rate from public.order_payments where order_id = '$O1'")" "0.02500"
cell "營業額 3023" "$(Q "select amount - fee_amount from public.order_payments where order_id = '$O1'")" "3023"
cell "訂單已收齊" "$(status_of "$O1")" "paid"
O2="$(Q "select public.zz_order(3044, 100, 'card_terminal')")"
pay c2 "$O2" "$(uuid)" cash 3144 "'card_terminal'" NULL >/dev/null
cell "3144 ⇒ 手續費 79(78.6, 營業額 3065.4 ⇒ 3065;捨去會是 78)" "$(fee_of "$O2")" "79"

echo "── 不收手續費的方式 ──"
O3="$(Q "select public.zz_order(3000, 100, NULL)")"
pay c3 "$O3" "$(uuid)" cash 3100 NULL NULL >/dev/null
cell "一般現金 ⇒ 0" "$(fee_of "$O3")" "0"

echo "── TapPay(card)也扣 2.5%(Q32 甲)──"
O4="$(Q "select public.zz_order(3000, 100, NULL)")"
Q "insert into public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor) values ('$O4', 'card', 3100, now() - interval '1 minute', 'TRADE-Q1-1', 'probe_q1')" >/dev/null
cell "TapPay 3100 ⇒ 77" "$(fee_of "$O4")" "77"

echo "── 沖銷:手續費反號 ──"
PIDC="$(Q "select id from public.order_payments where order_id = '$O1'")"
Q "select public.admin_reverse_manual_payment('$PIDC', 'probe_q1', '登錯了')" >/dev/null
cell "沖銷列手續費 −77" "$(Q "select fee_amount from public.order_payments where reverses_payment_id = '$PIDC'")" "-77"
cell "沖銷列標記照抄刷卡" "$(Q "select payment_instrument from public.order_payments where reverses_payment_id = '$PIDC'")" "card_terminal"

echo "── 蝦皮(7,900 / 進帳 7,016 ⇒ 884)──"
O5="$(Q "select public.zz_order(7700, 200, 'shopee')")"
cell "蝦皮單總額 7900" "$(total_of "$O5")" "7900"
cell "蝦皮進帳 7016 登記成功" "$(pay s1 "$O5" "$(uuid)" cash 7900 "'shopee'" 7016)" "OK"
cell "手續費 = 7900 − 7016 = 884" "$(fee_of "$O5")" "884"
cell "蝦皮單已收齊(不出現未收 884)" "$(status_of "$O5")" "paid"
cell "收款明細回付款方式標記與手續費" "$(Q "select (e->>'payment_instrument') || '/' || (e->>'fee_amount') from jsonb_array_elements(public.admin_list_order_payments('$O5')) e")" "shopee/884"
# Sean Q47 甲:蝦皮調整金額 ⇒ 沖銷原進帳、重新登記一筆
PIDS="$(Q "select id from public.order_payments where order_id = '$O5'")"
Q "select public.admin_reverse_manual_payment('$PIDS', 'probe_q1', '蝦皮調整金額')" >/dev/null
cell "沖銷蝦皮進帳:手續費 −884、標記照抄" "$(Q "select fee_amount || '/' || payment_instrument from public.order_payments where reverses_payment_id = '$PIDS'")" "-884/shopee"
cell "重新登記進帳 7100 成功" "$(pay s1b "$O5" "$(uuid)" cash 7900 "'shopee'" 7100)" "OK"
cell "重新登記後的手續費 800" "$(fee_of "$O5")" "800"
cell "這張單淨收 7100(7016 − 7016 + 7100)" "$(Q "select sum(amount - fee_amount) from public.order_payments where order_id = '$O5'")" "7100"
cell "重新登記後仍是已收齊" "$(status_of "$O5")" "paid"
O6="$(Q "select public.zz_order(7700, 200, 'shopee')")"
cell "蝦皮單登記一般現金 ⇒ 拒" "$(pay s2 "$O6" "$(uuid)" cash 7900 NULL NULL)" "P0001"
cell "蝦皮進帳大於金額 ⇒ 拒" "$(pay s3 "$O6" "$(uuid)" cash 7900 "'shopee'" 8000)" "P0001"
cell "一般單登記蝦皮進帳 ⇒ 拒" "$(pay s4 "$O3" "$(uuid)" cash 100 "'shopee'" 90)" "P0001"
cell "非蝦皮帶進帳金額 ⇒ 拒" "$(pay s5 "$O3" "$(uuid)" cash 100 "'card_terminal'" 90)" "P0001"
cell "刷卡配匯款 ⇒ 拒" "$(pay s6 "$O3" "$(uuid)" bank_transfer 100 "'card_terminal'" NULL)" "P0001"
cell "訂單:蝦皮標記配非蝦皮來源 ⇒ CHECK 擋" "$(Q "do \$x\$ begin update public.orders set payment_instrument = 'shopee' where id = '$O3'; exception when check_violation then raise notice 'x'; end \$x\$; select coalesce(payment_instrument, 'NULL') from public.orders where id = '$O3'")" "NULL"
# Fable R1 #1:現行建單 RPC 建出來的蝦皮單沒有標記 ⇒ 這一段不可以擋(反向約束等建單 RPC 那段才收緊)
cell "現行建單 RPC 建蝦皮來源的單照樣建得起來" "$(Q "select (public.admin_create_manual_order(public.zz_cust(), gen_random_uuid(), 'probe_q1', 'manual_shopee', 'bank_transfer', 'home', '{\"name\":\"王小明\",\"phone\":\"0912000111\",\"line\":\"台北市測試路1號\"}'::jsonb, '{\"type\":\"personal\",\"requested\":false}'::jsonb, 100, '[{\"sku\":\"Q1\",\"title\":\"測試品\",\"qty\":1,\"unit_price\":100,\"spec\":{}}]'::jsonb) ->> 'order_id') is not null")" "t"

echo "── 冪等 ──"
K="$(uuid)"; O7="$(Q "select public.zz_order(3000, 100, 'card_terminal')")"; AT="$(Q "select now()::text")"
pay i1 "$O7" "$K" cash 1000 "'card_terminal'" NULL "$AT" >/dev/null
cell "同鍵同內容重送 ⇒ idempotent" "$(pay i2 "$O7" "$K" cash 1000 "'card_terminal'" NULL "$AT")|$(Q "select res->>'idempotent' from public.zz_r where tag='i2'")" "OK|true"
cell "同鍵換掉刷卡標記 ⇒ 拒(同鍵不同內容 P2B53)" "$(pay i3 "$O7" "$K" cash 1000 NULL NULL "$AT")" "P2B53"

echo "── 分次付款:每筆各自扣(Q37 甲)──"
O8="$(Q "select public.zz_order(3000, 100, 'card_terminal')")"
pay p1 "$O8" "$(uuid)" cash 1000 NULL NULL >/dev/null
pay p2 "$O8" "$(uuid)" cash 2100 "'card_terminal'" NULL >/dev/null
cell "現金 1000 手續費 0、刷卡 2100 手續費 52(2047.5 ⇒ 2048)" "$(Q "select string_agg(amount||':'||fee_amount, ',' order by amount) from public.order_payments where order_id = '$O8'")" "1000:0,2100:52"
cell "兩筆收齊" "$(status_of "$O8")" "paid"

echo "── 不可改 ──"
cell "改 fee_amount ⇒ P2B34" "$(Q "do \$x\$ begin update public.order_payments set fee_amount = 0 where order_id = '$O8' and amount = 2100; exception when others then raise notice '%', sqlstate; end \$x\$;" 2>&1 | sed -n 's/.*NOTICE:  //p')" "P2B34"
cell "改 payment_instrument ⇒ P2B34" "$(Q "do \$x\$ begin update public.order_payments set payment_instrument = null where order_id = '$O8' and amount = 2100; exception when others then raise notice '%', sqlstate; end \$x\$;" 2>&1 | sed -n 's/.*NOTICE:  //p')" "P2B34"

echo "── 手動退款(刷卡退)與營業額 ──"
O9="$(Q "select public.zz_order(3000, 100, 'card_terminal')")"
pay r0 "$O9" "$(uuid)" cash 3100 "'card_terminal'" NULL >/dev/null
cell "刷卡退款配匯款 ⇒ 拒" "$(Q "do \$x\$ begin perform public.admin_record_manual_refund('$O9', gen_random_uuid(), 'probe_q1', 'bank_transfer', 1000, '退一部分', now(), false, 'card_terminal'); exception when others then raise notice '%', sqlstate; end \$x\$;" 2>&1 | sed -n 's/.*NOTICE:  //p')" "P0001"
cell "部分退款 1000(刷卡)登記成功" "$(Q "select public.admin_record_manual_refund('$O9', gen_random_uuid(), 'probe_q1', 'cash', 1000, '退一部分', now(), false, 'card_terminal') ->> 'recorded'")" "true"
cell "退款標記記下刷卡" "$(Q "select payment_instrument from public.order_manual_refunds where order_id = '$O9'")" "card_terminal"
cell "改退款標記 ⇒ P2B45" "$(Q "do \$x\$ begin update public.order_manual_refunds set payment_instrument = null where order_id = '$O9'; exception when others then raise notice '%', sqlstate; end \$x\$;" 2>&1 | sed -n 's/.*NOTICE:  //p')" "P2B45"
# 營業額只看 O9 這張:建一個只含 O9 的時間窗不實際, 改用「全部 − 其他」驗算式;這裡直接驗 O9 的三個分量
cell "O9:收款 3100 − 手續費 77 − 退款 1000 = 2023(手續費不退)" "$(Q "select (select sum(amount - fee_amount) from public.order_payments where order_id = '$O9') - (select sum(refund_amount) from public.order_manual_refunds where order_id = '$O9' and voided_at is null)")" "2023"
cell "營業額函式 = 全庫收款 − 手續費 − 退款(自洽)" "$(Q "select (r.revenue = r.received - r.fees - r.refunds)::text from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day') r")" "true"
cell "營業額函式的手續費合計 = 收款表加總" "$(Q "select (r.fees = (select sum(fee_amount) from public.order_payments))::text from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day') r")" "true"
cell "營業額函式的退款含 TapPay 已確認" "$(Q "alter table public.order_refunds disable trigger user; insert into public.order_refunds (order_id, refund_amount, status, reason, actor, request_id, confirmed_at, rec_trade_id, kind, record_refunded_before, tappay_refund_id, bank_refund_id) values ('$O4', 500, 'confirmed', '測', 'probe_q1', 'q1-r1', now(), 'TRADE-Q1-1', 'partial', 0, 'TR-Q1-1', 'BR-Q1-1'); alter table public.order_refunds enable trigger user; select (r.refunds = 1500)::text from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day') r" 2>&1 | tail -1)" "true"

cell "營業額函式的退款含 TapPay 失敗但人工更正為錢已退" "$(Q "alter table public.order_refunds disable trigger user; insert into public.order_refunds (id, order_id, refund_amount, status, reason, actor, request_id, rec_trade_id, kind, record_refunded_before, bank_refund_id, failed_reason) values ('11111111-1111-1111-1111-111111111111', '$O4', 300, 'failed', '測', 'probe_q1', 'q1-r2', 'TRADE-Q1-1', 'partial', 0, 'BR-Q1-2', 'manual_failed'); alter table public.order_refunds enable trigger user; alter table public.order_refund_manual_corrections disable trigger user; insert into public.order_refund_manual_corrections (refund_id, seq, corrected_to, reason, actor, request_id) values ('11111111-1111-1111-1111-111111111111', 1, 'money_moved', '查到已退', 'probe_q1', 'q1-c1'); alter table public.order_refund_manual_corrections enable trigger user; select (r.refunds = 1800)::text from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day') r" 2>&1 | tail -1)" "true"
cell "更正成「沒有退」⇒ 不算" "$(Q "alter table public.order_refund_manual_corrections disable trigger user; insert into public.order_refund_manual_corrections (refund_id, seq, corrected_to, reason, actor, request_id) values ('11111111-1111-1111-1111-111111111111', 2, 'no_money_moved', '其實沒退', 'probe_q1', 'q1-c2'); alter table public.order_refund_manual_corrections enable trigger user; select (r.refunds = 1500)::text from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day') r" 2>&1 | tail -1)" "true"

echo "── 取不到費率:寫入成功、手續費 NULL ──"
Q "delete from public.payment_fee_rates where fee_kind = 'tappay'" >/dev/null
O10="$(Q "select public.zz_order(3000, 100, NULL)")"
Q "insert into public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor) values ('$O10', 'card', 3100, now() - interval '1 minute', 'TRADE-Q1-2', 'probe_q1')" >/dev/null
cell "沒有費率 ⇒ 寫入成功、手續費 NULL" "$(fee_of "$O10")" "NULL"
cell "營業額函式標出 1 筆沒有費率" "$(Q "select missing_fee_count from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day')")" "1"
P10="$(Q "select id from public.order_payments where order_id = '$O10'")"
Q "insert into public.order_payments (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor) select order_id, rail, -amount, received_at, id, '測沖銷', 'probe_q1' from public.order_payments where id = '$P10'" >/dev/null
cell "沒有費率的收款被沖銷 ⇒ 仍只算 1 筆(沖銷列不重複數)" "$(Q "select missing_fee_count from public.admin_revenue_between(now() - interval '1 day', now() + interval '1 day')")" "1"

echo "── 蝦皮單不參加未收款自動取消(Sean Q42 甲)──"
OX1="$(Q "select public.zz_order(1000, 100, 'shopee')")"; OX2="$(Q "select public.zz_order(1000, 100, NULL)")"
Q "update public.orders set created_at = now() - interval '8 days' where id in ('$OX1', '$OX2')" >/dev/null
Q "select pcm_cron.expire_unpaid_orders(500)" >/dev/null
cell "蝦皮單過了 5 天仍未取消" "$(Q "select coalesce(cancelled_reason, 'not_cancelled') from public.orders where id = '$OX1'")" "not_cancelled"
cell "對照:一般現金單過了 5 天被取消" "$(Q "select coalesce(cancelled_reason, 'not_cancelled') from public.orders where id = '$OX2'")" "payment_expired"

echo "── 今日實收扣手續費 ──"
cell "今日實收 = Σ(金額 − 手續費)" "$(Q "select (t.total = (select sum(amount - coalesce(fee_amount,0)) from public.order_payments))::text from public.admin_today_payment_total(now() - interval '1 day', now() + interval '1 day') t")" "true"

echo "── 權限 ──"
cell "anon 叫不到營業額函式" "$(Q "select has_function_privilege('anon', 'public.admin_revenue_between(timestamptz,timestamptz)', 'EXECUTE')")" "f"
cell "authenticated 讀不到費率表" "$(Q "select has_table_privilege('authenticated', 'public.payment_fee_rates', 'SELECT')")" "f"
cell "收款 RPC 只給 service_role" "$(Q "select has_function_privilege('anon', p.oid, 'EXECUTE')::text || has_function_privilege('service_role', p.oid, 'EXECUTE')::text from pg_proc p where proname = 'admin_record_manual_payment'")" "falsetrue"

echo "── 突變(每個都要讓對應那格轉紅)──"
Q "insert into public.payment_fee_rates (fee_kind, rate, effective_from, note) values ('tappay', 0.025, '2026-01-01', '還原')" >/dev/null
Q "alter table public.order_payments disable trigger order_payments_fee_snapshot_bi" >/dev/null
O11="$(Q "select public.zz_order(3000, 100, 'card_terminal')")"
pay m1 "$O11" "$(uuid)" cash 3100 "'card_terminal'" NULL >/dev/null
cell "突變①拿掉觸發器 ⇒ 手續費不再是 77" "$( [ "$(fee_of "$O11")" != "77" ] && echo red || echo green)" "red"
Q "alter table public.order_payments enable trigger order_payments_fee_snapshot_bi" >/dev/null
Q "create or replace function public.pcm_order_payment_fee_snapshot() returns trigger language plpgsql as \$f\$ begin new.fee_rate := 0.025; new.fee_amount := new.amount - floor(new.amount * 0.975)::int; return new; end \$f\$" >/dev/null
O12="$(Q "select public.zz_order(3000, 100, 'card_terminal')")"
pay m2 "$O12" "$(uuid)" cash 3100 "'card_terminal'" NULL >/dev/null
cell "突變②四捨五入改捨去 ⇒ 3100 的手續費變 78" "$(fee_of "$O12")" "78"

echo "── 回滾 ──"
P -f "$MIG" >/dev/null 2>&1   # 還原被突變的觸發器本體(整支重套會在 CREATE TABLE 撞名而停, 這裡只要它前段之前的狀態不重要)
cell "有刷卡資料時回滾會拒" "$(P -f "$DOWN" 2>&1 | grep -c '已有訂單 / 收款 / 退款用到刷卡或蝦皮標記')" "1"

echo
if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
