#!/usr/bin/env bash
# `20261002110000_m4b_order_edit_vehicle_and_invoice_toggle.sql`(貼板 264)的行為驗證
# 要證的(Sean 2026-10-02):
#   · 車款:手動單改車(字典 / 照打, 年份)、清掉;年份錯擋 P9V02;網站單不能改 P9V01;操作紀錄有前後值
#   · 發票 Q2 甲:未付改開 ⇒ 總額加 5%、仍未付款;已付改開 ⇒ 部分付款;改回不開 ⇒ 稅歸 0、多收開待退款;
#     已登記發票號碼不能改回 P9V05;蝦皮單不能改 P9V03;其他路徑直接翻旗標仍擋;同值 ⇒ NOOP
#   · 突變:拿掉付款狀態重算 ⇒ 已付改開那格被自驗擋下(P9V06), 不會留下狀態對不上的單
#   · 回滾來回、已貼過再貼 ⇒ 前置閘擋
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema dump + 之後已貼(APPLIED.tsv)的 migration(含 263)。
# 先紅:套本支之前跑同一批格子(新鍵不在白名單 ⇒ 每格都要是紅的)。
# 用法:bash scripts/20261002110000-verify.sh
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIG="$REPO/supabase/migrations/20261002110000_m4b_order_edit_vehicle_and_invoice_toggle.sql"
DOWN="$REPO/supabase/rollbacks/20261002110000-rollback.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done

WIN="v264-$$"
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

APPLIED_N=0; SKIP_N=0
while IFS= read -r v; do
  f="$(ls "$REPO"/supabase/migrations/"${v}"_*.sql 2>/dev/null | head -1)"
  [ -n "$f" ] || continue
  if P -f "$f" >/dev/null 2>&1; then APPLIED_N=$((APPLIED_N+1)); else SKIP_N=$((SKIP_N+1)); fi
done < <(awk -F'\t' '$1 ~ /^2026/ && $1 > "20260915100000" && $1 < "20261002110000" {print $1}' "$REPO/supabase/APPLIED.tsv" | sort -u)
echo "世界:套上 $APPLIED_N 支、套不上 $SKIP_N 支(排程 / storage / 真資料前置閘)"
echo "── 前置:六支函式與正式庫 2026-10-02 相同 ──"
MD5Q="select string_agg(proname || '=' || md5(prosrc), ',' order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('admin_update_order_workflow','pcm_invoice_requested_false_is_final','pcm_noncard_settle_recompute','pcm_partial_cancel_recompute','admin_compute_order_settlement','pcm_order_total')"
BEFORE_MD5="admin_compute_order_settlement=f134e95d24e768a84fd53d26f29aed70,admin_update_order_workflow=e263af1afb7f0c96d60f881283839204,pcm_invoice_requested_false_is_final=927668019d2dfc87bcd2427042a33351,pcm_noncard_settle_recompute=b9878df98a4000844024aedfb8b907c1,pcm_order_total=68fa4a822584a324c65f321ca404c49f,pcm_partial_cancel_recompute=fca021185afc790b48ca8e10e43a0809"
cell "六支函式本體 = 正式庫" "$(Q "$MD5Q")" "$BEFORE_MD5"
VIEWQ="select md5(pg_get_viewdef('public.pcm_order_effective_amounts_v'::regclass, true))"
cell "剩下應收 view = 正式庫" "$(Q "$VIEWQ")" "89c088a1f021259dc62916c9ffbb3343"
[ "$FAIL" = 0 ] || { echo "ENV-FAIL:世界和正式庫對不上, 下面的結果不算數"; exit 3; }

P >/dev/null <<'SQL' || { echo "ENV-FAIL:測試小工具建不起來"; exit 3; }
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_264', '測試員', true);
CREATE FUNCTION public.zz_cust() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v, v::text || '@264.test', '{}'::jsonb);
  INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES (v, v::text || '@264.test', '測試客人', '0912345678', 'general');
  RETURN v;
END $f$;
-- 建一張手動單:單價 7700 + 運費 200 = 7900(開發票 ⇒ 稅 395、總額 8295)。p_paid ⇒ 建單時現金收全額。
CREATE FUNCTION public.zz_order(p_source text, p_invoice boolean, p_paid boolean) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (public.admin_create_manual_order(
    p_customer_user_id => public.zz_cust(), p_manual_request_id => gen_random_uuid(), p_actor => 'probe_264',
    p_order_source => p_source, p_payment_channel => 'cash', p_shipping_method => 'home',
    p_ship_to => '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
    p_invoice => jsonb_build_object('type', 'personal', 'requested', p_invoice), p_shipping_fee => 200,
    p_lines => '[{"sku":"Q1","title":"測試品","qty":1,"unit_price":7700,"spec":{}}]'::jsonb,
    p_paid_full => p_paid) ->> 'order_id')::uuid;
END $f$;
-- 用目前的 version 送一包 patch:回 UPDATED / NOOP / CONFLICT, 失敗回 SQLSTATE。
CREATE FUNCTION public.zz_wf(p_order uuid, p_patch jsonb) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE st text;
BEGIN
  RETURN public.admin_update_order_workflow(p_order, (SELECT version FROM public.orders WHERE id = p_order), p_patch, 'probe_264', gen_random_uuid()::text);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE;
  RETURN st;
END $f$;
SQL
wf() { Q "select public.zz_wf('$1', '$2'::jsonb)"; }
mk() { Q "select public.zz_order('$1', $2, $3)"; }
money_of() { Q "select invoice_requested::text || '|' || tax_total || '|' || total || '|' || payment_status from public.orders where id = '$1'"; }
pending_of() { Q "select coalesce(sum(amount_at_cancel), 0) from public.order_pending_refunds where order_id = '$1' and voided_at is null and settled_at is null"; }

run_cells() {
  local O
  echo "  ── 車款 ──"
  O="$(mk manual_line true false)"
  cell "改車(字典 + 年份)⇒ UPDATED" "$(wf "$O" '{"vehicle":{"kind":"dict","brand":"Yamaha","model":"YZF-R6","year":2019}}')" "UPDATED"
  cell "訂單上的車 = 字典 + 年份 + source" "$(Q "select vehicle_snapshot::text from public.orders where id = '$O'")" '{"kind": "dict", "year": 2019, "brand": "Yamaha", "model": "YZF-R6", "source": "manual_dict"}'
  cell "操作紀錄 after 有車" "$(Q "select (after -> 'vehicle_snapshot' ->> 'model') from public.admin_audit_log where target = 'order:$O' and action = 'order.workflow.update' order by id desc limit 1")" "YZF-R6"
  cell "改成照打" "$(wf "$O" '{"vehicle":{"kind":"free","raw":"自組車","year":2021}}')|$(Q "select vehicle_snapshot ->> 'source' from public.orders where id = '$O'")" "UPDATED|manual_text"
  cell "訂單列表 view 讀得到訂單上的車(本機後台抓到:少這欄整個列表載入失敗)" "$(Q "select vehicle_snapshot ->> 'raw' from public.admin_order_list_v where id = '$O'")" "自組車"
  cell "清掉(null)" "$(wf "$O" '{"vehicle":null}')|$(Q "select coalesce(vehicle_snapshot::text, 'NULL') from public.orders where id = '$O'")" "UPDATED|NULL"
  cell "年份錯 ⇒ P9V02" "$(wf "$O" '{"vehicle":{"kind":"free","raw":"CBR","year":1800}}')" "P9V02"
  Q "update public.orders set order_source = 'web' where id = '$(mk manual_phone true false)'" >/dev/null
  cell "網站單改車 ⇒ P9V01" "$(wf "$(Q "select id from public.orders where order_source = 'web' order by created_at desc limit 1")" '{"vehicle":null}')" "P9V01"

  echo "  ── 發票(Sean Q2 甲)──"
  O="$(mk manual_phone false false)"
  cell "未付、沒開發票:7900 未付款" "$(money_of "$O")" "false|0|7900|unpaid"
  cell "未付改開 ⇒ UPDATED" "$(wf "$O" '{"invoice_requested":true}')" "UPDATED"
  cell "未付改開 ⇒ 稅 395、總額 8295、仍未付款" "$(money_of "$O")" "true|395|8295|unpaid"
  cell "同值再送 ⇒ NOOP" "$(wf "$O" '{"invoice_requested":true}')" "NOOP"
  cell "操作紀錄 before/after 總額" "$(Q "select (before ->> 'total') || '>' || (after ->> 'total') from public.admin_audit_log where target = 'order:$O' and action = 'order.workflow.update' order by id desc limit 1")" "7900>8295"

  O="$(mk manual_phone false true)"
  cell "已付、沒開發票:7900 已付款" "$(money_of "$O")" "false|0|7900|paid"
  cell "已付改開 ⇒ UPDATED" "$(wf "$O" '{"invoice_requested":true}')" "UPDATED"
  cell "已付改開 ⇒ 部分付款(客人補 395)" "$(money_of "$O")" "true|395|8295|partiallyPaid"

  O="$(mk manual_phone true true)"
  cell "已付、有開發票:8295 已付款" "$(money_of "$O")" "true|395|8295|paid"
  cell "改回不開 ⇒ UPDATED" "$(wf "$O" '{"invoice_requested":false}')" "UPDATED"
  cell "改回不開 ⇒ 稅 0、總額 7900、狀態不翻(多收只標字)" "$(money_of "$O")" "false|0|7900|paid"
  cell "改回不開 ⇒ 多收的 395 開待退款" "$(pending_of "$O")" "395"
  # Fable R1 必修 1:改錯了再改回要開 ⇒ 那列 395 要作廢, 單回到已付款(否則員工照單退款 ⇒ 客人多拿 395)。
  cell "再改回要開 ⇒ UPDATED" "$(wf "$O" '{"invoice_requested":true}')" "UPDATED"
  cell "再改回要開 ⇒ 8295 已付款、待退款 0" "$(money_of "$O")|$(pending_of "$O")" "true|395|8295|paid|0"
  O="$(mk manual_phone false true)"
  Q "select public.admin_record_manual_payment('$O', gen_random_uuid(), 'probe_264', 'cash', 500, now(), NULL, NULL)" >/dev/null
  cell "已收 8400 超過含稅總額 8295 ⇒ 改開被擋 P9V07" "$(wf "$O" '{"invoice_requested":true}')" "P9V07"
  # 含稅價換算的單:稅帶殘差、這條式子重現不出來(建單 RPC 的殘差路徑;這裡直接把稅與總額改成那個樣子, 總額等式仍成立)。
  O="$(mk manual_phone true false)"; Q "update public.orders set tax_total = 394, total = 8294 where id = '$O'" >/dev/null
  cell "含稅價換算的單(稅式重現不出來)⇒ 改不開被擋 P9V08" "$(wf "$O" '{"invoice_requested":false}')" "P9V08"

  O="$(mk manual_line true false)"
  Q "update public.orders set invoice_number = 'AB12345678' where id = '$O'" >/dev/null
  cell "已登記發票號碼 ⇒ 不能改回不開 P9V05" "$(wf "$O" '{"invoice_requested":false}')" "P9V05"
  O2="$(mk manual_line true false)"; Q "update public.orders set invoice_amount = 8295 where id = '$O2'" >/dev/null
  cell "只登記了發票金額(沒號碼)⇒ 也不能改回不開 P9V05" "$(wf "$O2" '{"invoice_requested":false}')" "P9V05"
  cell "同一包先清號碼再改回不開 ⇒ 仍擋 P9V05(看修改前)" "$(wf "$O" '{"invoice_number":null,"invoice_requested":false}')" "P9V05"
  cell "蝦皮單不能改發票 P9V03" "$(wf "$(Q "select public.zz_order('manual_shopee', false, false)")" '{"invoice_requested":true}')" "P9V03"
  echo "  ── 運費(Sean Q3 甲:手動單照員工填的)──"
  O="$(mk manual_phone false true)"
  cell "已付款手動單改出貨方式(宅配 ⇒ 自取)⇒ UPDATED" "$(wf "$O" '{"shipping_method":"store"}')" "UPDATED"
  cell "改出貨方式不會多開待退款(總額與運費都沒變)" "$(pending_of "$O")" "0"
  O="$(mk manual_phone false false)"; Q "update public.orders set order_source = 'web' where id = '$O'" >/dev/null
  cell "網站單照舊:小計 7700 宅配 ⇒ 運費 0(滿 5000 免運)" "$(Q "select effective_shipping_fee from public.pcm_order_effective_amounts_v where order_id = '$O'")" "0"
  Q "update public.orders set shipping_method = 'home' where id = '$O'" >/dev/null
  O2="$(Q "select (public.admin_create_manual_order(p_customer_user_id => public.zz_cust(), p_manual_request_id => gen_random_uuid(), p_actor => 'probe_264', p_order_source => 'manual_phone', p_payment_channel => 'cash', p_shipping_method => 'home', p_ship_to => '{\"name\":\"王小明\",\"phone\":\"0912000111\",\"line\":\"台北市測試路1號\"}'::jsonb, p_invoice => '{\"type\":\"personal\",\"requested\":false}'::jsonb, p_shipping_fee => 60, p_lines => '[{\"sku\":\"Q2\",\"title\":\"小東西\",\"qty\":1,\"unit_price\":3000,\"spec\":{}}]'::jsonb) ->> 'order_id')")"
  cell "手動單:運費照員工填的 60" "$(Q "select effective_shipping_fee from public.pcm_order_effective_amounts_v where order_id = '$O2'")" "60"
  Q "update public.orders set order_source = 'web' where id = '$O2'" >/dev/null
  cell "網站單照舊:小計 3000 宅配 ⇒ 運費 100" "$(Q "select effective_shipping_fee from public.pcm_order_effective_amounts_v where order_id = '$O2'")" "100"

  O="$(mk manual_phone false false)"
  cell "其他路徑直接翻旗標 ⇒ 照舊擋(23514)" "$(Q "do \$x\$ begin update public.orders set invoice_requested = true where id = '$O'; exception when others then raise notice 'STATE=%', sqlstate; end \$x\$" 2>&1 | sed -n 's/.*STATE=\([0-9A-Z]*\).*/\1/p')" "23514"
}

echo "── 貼前(先紅)──"
FAIL_SAVE=$FAIL; N_SAVE=$N
OUT_BEFORE="$(run_cells 2>/dev/null)"
printf '%s\n' "$OUT_BEFORE" | sed 's/^/  [貼前] /'
RED_N="$(printf '%s\n' "$OUT_BEFORE" | grep -c 'FAIL')"; ALL_N="$(printf '%s\n' "$OUT_BEFORE" | grep -c 'PASS\|FAIL')"
FAIL=$FAIL_SAVE; N=$N_SAVE
# 貼前本來就成立的 8 格:建單後三個起始狀態、「再改回要開 ⇒ 8295 已付款、待退款 0」(貼前那張單根本改不動, 停在原樣)、
#   改出貨方式回 UPDATED、兩格網站單運費規則、其他路徑翻旗標(09-04 那道本來就擋)。
#   紅的包含「改出貨方式不多開待退款」(貼前會開 200)與「手動單運費 60」(貼前算成 100)。
cell "貼前除了本來就成立的 8 格, 其餘都是紅的" "$RED_N/$ALL_N" "$((ALL_N-8))/$ALL_N"

P -f "$MIG" >/dev/null || { echo "🔴 migration 套不上"; exit 1; }
echo "── 貼後 ──"
run_cells
cell "已貼過再貼 ⇒ 前置閘整筆擋" "$(P -f "$MIG" 2>&1 | grep -c '貼板 264 前置閘')" "1"

echo "── 突變:拿掉付款狀態重算 ⇒ 已付改開被自驗擋下 P9V06(不留下狀態對不上的單)──"
P >/dev/null <<'SQL' || { echo "ENV-FAIL:突變套不上"; exit 3; }
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.admin_update_order_workflow(uuid,integer,jsonb,text,text)'::regprocedure);
  IF strpos(d, 'PERFORM public.pcm_noncard_settle_recompute(p_order_id);') = 0 THEN RAISE EXCEPTION '突變找不到目標字串'; END IF;
  EXECUTE replace(d, 'PERFORM public.pcm_noncard_settle_recompute(p_order_id);', '');
END $m$;
SQL
O="$(mk manual_phone false true)"
cell "突變後已付改開 ⇒ P9V06, 單維持原樣" "$(wf "$O" '{"invoice_requested":true}')|$(money_of "$O")" "P9V06|false|0|7900|paid"

echo "── 回滾來回 ──"
P -f "$DOWN" >/dev/null || { echo "🔴 回滾失敗"; FAIL=1; }
cell "回滾後兩支 = 貼前版本" "$(Q "$MD5Q")" "$BEFORE_MD5"
cell "回滾後剩下應收 view = 貼前版本" "$(Q "$VIEWQ")" "89c088a1f021259dc62916c9ffbb3343"
P -f "$MIG" >/dev/null || { echo "🔴 回滾後再套一次失敗"; FAIL=1; }
cell "回滾後可以再套一次" "$(Q "select (strpos(prosrc, 'invoice_requested_on_by_rpc') > 0)::text from pg_proc where proname = 'admin_update_order_workflow'")" "true"

if [ "$FAIL" = 0 ]; then echo "全部 $N 格通過"; exit 0; else echo "🔴 有格子失敗(共 $N 格)"; exit 1; fi
