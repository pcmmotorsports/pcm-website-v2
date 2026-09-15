#!/usr/bin/env bash
# `20260915234000_m4b_p02b_record_manual_payment_expired_bank_late_registration.sql` 的行為驗證
#
# 要證的(plan docs/plans/2026-09-15-expired-bank-order-late-registration-plan.md §10.1):
#   · 逾期自動取消的乾淨匯款單:期限內補登 ⇒ 復活並依金額判狀態;期限後 ⇒ 入帳 + 恰 1 列待退款
#   · 員工取消 / 刷卡取代 ⇒ P2B52;現金 ⇒ P2B54;c1–c7 任一歷史 ⇒ P2B51;結算判不清 ⇒ 整筆回滾
#   · 客人期限後另下新單(界 = due_at,不是 cancelled_at)⇒ 不復活
#   · 冪等:重放回當初處置;同鍵不同內容 ⇒ P2B53;退款態後重放仍 idempotent
#   · 真兩連線:同單兩員工、補登 vs 建單(兩種先後)、補登 vs begin_charge_attempt(死鎖探測)、補登 vs 排程
#   · 失敗注入、突變(每個突變都要讓對應那格轉紅)、回滾
#
# 世界:拋棄式 PG = 正式庫 2026-09-15 schema-only dump(Sean Q41 甲,零資料),先套 20260915233000 再測本片。
#
# 🛑 答不出什麼 / 用替身的地方(照實列):
#   · 刷卡取代(superseded_by_card)用直接 UPDATE 造取消欄,沒有走 begin_charge_attempt 的 supersede 那條路。
#   · 「待退款結清後單變退款態」用直接 UPDATE payment_status = 'refunded' 模擬,沒有走真的退款結清。
#   · c2(部分取消)/ c3 / c4 / c5 / c6 / c7 的歷史列是直接 INSERT(必要時暫停該表 USER trigger);c1 走真 RPC(收款 → 沖銷 → 排程取消)。
#   · 結算判不清:暫停 subtotal 守門後改 orders.subtotal 讓品項快照對不上。
#   · pg_cron 不會自己跑,排程一律手動呼叫。
#   · 【沒有動態測】(codex DB2 R1 should-fix 2,照實列):前台 create_order 真呼叫(要登入身分、購物車、地址、商品;
#     只做靜態核對它的鎖字面與本片同 key,動態都用 admin_create_manual_order)· 復活後第一次兌券 · 合法改價 RPC 之後再補登。
#   · 死鎖交錯只做「begin_charge_attempt 形狀」那一種:持鎖端照它的鎖序(訂單列 → 客人鎖 → 同 cart supersede UPDATE)
#     以裸 SQL 分段執行;supersede 的 WHERE 用比正式寬的條件(同 cart、未取消),寬條件不成環則正式條件也不會多鎖列。
#
# 並發判準(同 20260915233000-verify.sh 的教訓):持鎖端 = fifo 控制、送 COMMIT 前一定在交易中;
#   被擋 = pg_blocking_pids(受測) 含持鎖端;沒被擋 = 受測做完時持鎖端仍 idle in transaction;
#   觀測 SQL 失敗 / 連線 rc≠0 ⇒ error。
#
# 用法:bash scripts/20260915234000-verify.sh
set -u
export LC_ALL=C LANG=C
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MIGA="$REPO/supabase/migrations/20260915233000_m4b_p02a_bank_due_at_helper_and_manual_order_customer_lock.sql"
DOWNA="$REPO/supabase/rollbacks/20260915233000_down.sql"
MIG="$REPO/supabase/migrations/20260915234000_m4b_p02b_record_manual_payment_expired_bank_late_registration.sql"
DOWN="$REPO/supabase/rollbacks/20260915234000_down.sql"
UP="$HOME/pcm-mailbox/schema-dump-20260915/up.sh"
for f in "$MIGA" "$DOWNA" "$MIG" "$DOWN" "$UP"; do test -f "$f" || { echo "ENV-FAIL:找不到 $f"; exit 3; }; done
NEW_MD5="$(sed -n 's/.*⇒ 升;= \([0-9a-f]\{32\}\)(本代).*/\1/p' "$MIG" | head -1)"
NEW_CMT="$(sed -n 's/.*COMMENT md5 = [0-9a-f]\{32\} 或本代 \([0-9a-f]\{32\}\);.*/\1/p' "$MIG" | head -1)"
OLD_MD5='86e3948c900377ebdf256ab700e41979'
OLD_CMT='b5cb93c79247931343b6139a603a0fc3'
[ ${#NEW_MD5} -eq 32 ] && [ ${#NEW_CMT} -eq 32 ] || { echo "ENV-FAIL:從 migration 檔頭讀不到本代 md5($NEW_MD5 / $NEW_CMT)"; exit 3; }

WIN="v234-$$"
OUT="$(bash "$UP" "$WIN" 2>&1)" || { printf '%s\n' "$OUT"; echo "ENV-FAIL:拋棄式 PG 起不來"; exit 3; }
PORT="$(printf '%s\n' "$OUT" | sed -n 's/^本次 PG 埠 = \([0-9]*\).*/\1/p')"
ERRN="$(printf '%s\n' "$OUT" | sed -n 's/^套 dump 的 ERROR 行數 = \([0-9]*\).*/\1/p')"
D="/tmp/pcm-sd-$WIN"
TMPD="$(mktemp -d)"
cleanup() { exec 7>&- 2>/dev/null; pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D" "$TMPD"; }
trap cleanup EXIT
[ -n "$PORT" ] || { printf '%s\n' "$OUT"; echo "ENV-FAIL:讀不到埠"; exit 3; }
[ "$ERRN" = "0" ] || { echo "ENV-FAIL:套 dump 有 ERROR($ERRN 行)"; exit 3; }

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
P() { "${PSQL[@]}" "$@"; }
Q() { P -tA -c "$1"; }
Qx() { local o; o="$(P -tA -c "$1" 2>&1)" || return 1; printf '%s' "$o"; }
FAIL=0; N=0
cell() {
  N=$((N+1))
  if [ "$2" = "$3" ]; then printf '  PASS %-66s (%s)\n' "$1" "$2"
  else printf '  🔴 FAIL %-63s 實得 [%s] 期望 [%s]\n' "$1" "$2" "$3"; FAIL=1; fi
}
uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
PAY_OID="'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure"

# ── 世界:前一片 + 測試用小工具(只存在於拋棄式庫)──
P -f "$MIGA" >/dev/null 2>&1 || { echo "ENV-FAIL:20260915233000 套不上"; exit 3; }
cat > "$TMPD/tools.sql" <<'SQL'
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_alice', '測試員小愛', true);
CREATE TABLE public.zz_results (tag text PRIMARY KEY, res jsonb NOT NULL);
CREATE TABLE public.zz_saved (name text PRIMARY KEY, def text NOT NULL);
CREATE FUNCTION public.zz_mk_cust() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v, v::text || '@p02b.test', '{}'::jsonb);
  INSERT INTO public.customers (user_id, email, name, phone, tier) VALUES (v, v::text || '@p02b.test', '測試客人', '0912345678', 'general');
  RETURN v;
END $f$;
-- 建一張手動單(總額 = 品項 100 + 運費 100 = 200);p_back_days 非 NULL ⇒ 建單時間回填成台北「今天 - N 天」12:00
CREATE FUNCTION public.zz_mk_order(p_cust uuid, p_channel text, p_back_days integer) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb; v_id uuid;
BEGIN
  v := public.admin_create_manual_order(p_cust, gen_random_uuid(), 'probe_alice', 'manual_phone', p_channel, 'home',
         '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
         '{"type":"personal","requested":false}'::jsonb, 100,
         '[{"sku":"P02B","title":"測試品","qty":1,"unit_price":100,"spec":{}}]'::jsonb);
  v_id := (v ->> 'order_id')::uuid;
  IF p_back_days IS NOT NULL THEN
    UPDATE public.orders SET created_at = ((date_trunc('day', timezone('Asia/Taipei', now())) - make_interval(days => p_back_days) + time '12:00') AT TIME ZONE 'Asia/Taipei')
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $f$;
-- 同上但開發票(含稅)
CREATE FUNCTION public.zz_mk_order_inv(p_cust uuid) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb; v_id uuid;
BEGIN
  v := public.admin_create_manual_order(p_cust, gen_random_uuid(), 'probe_alice', 'manual_phone', 'bank_transfer', 'home',
         '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
         '{"type":"personal","requested":true}'::jsonb, 100,
         '[{"sku":"P02B","title":"測試品","qty":1,"unit_price":100,"spec":{}}]'::jsonb);
  v_id := (v ->> 'order_id')::uuid;
  UPDATE public.orders SET created_at = ((date_trunc('day', timezone('Asia/Taipei', now())) - interval '7 days' + time '12:00') AT TIME ZONE 'Asia/Taipei')
   WHERE id = v_id;
  RETURN v_id;
END $f$;
-- 呼叫收款 RPC,結果記進 zz_results(失敗記 SQLSTATE / constraint)
CREATE FUNCTION public.zz_pay(p_tag text, p_order uuid, p_key uuid, p_rail text, p_amount integer, p_at timestamptz) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r jsonb; st text; con text;
BEGIN
  BEGIN
    r := public.admin_record_manual_payment(p_order, p_key, 'probe_alice', p_rail, p_amount, p_at,
           CASE WHEN p_rail = 'bank_transfer' THEN 'REF12345' END, NULL);
    r := r || jsonb_build_object('state', 'OK');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, con = CONSTRAINT_NAME;
    r := jsonb_build_object('state', st, 'con', COALESCE(con, '-'));
  END;
  INSERT INTO public.zz_results (tag, res) VALUES (p_tag, r) ON CONFLICT (tag) DO UPDATE SET res = EXCLUDED.res;
  RETURN r ->> 'state';
END $f$;
SQL
P -f "$TMPD/tools.sql" >/dev/null || { echo "ENV-FAIL:測試小工具建不起來"; exit 3; }

R() { Q "SELECT COALESCE(res ->> '$2', '<none>') FROM public.zz_results WHERE tag = '$1'"; }
due() { printf "(SELECT public.pcm_bank_transfer_due_at(o.created_at) FROM public.orders o WHERE o.id = '%s')" "$1"; }
pay() { Q "SELECT public.zz_pay('$1', '$2', '$3', '$4', $5, $6)"; }   # tag order key rail amount at_sql
expire() { Q "SELECT pcm_cron.expire_unpaid_orders(500)" >/dev/null; }
reason_of() { Q "SELECT COALESCE(cancelled_reason, '<null>') FROM public.orders WHERE id = '$1'"; }
cnt() { Q "SELECT count(*) FROM $1"; }

# 並發探測。$1 持鎖端一句 $2 受測一句 ⇒ waited / not_waited / error:…
probe() {
  local hs="$1" ws="$2" hp wp hrc wrc st=none r=0 i
  rm -f "$TMPD/h.fifo"; mkfifo "$TMPD/h.fifo"
  PGAPPNAME=p02b-holder "${PSQL[@]}" -f "$TMPD/h.fifo" >"$TMPD/h.out" 2>&1 &
  hp=$!
  exec 7>"$TMPD/h.fifo"
  printf '%s\n' 'BEGIN;' "$hs;" >&7
  for i in $(seq 1 100); do
    r="$(Qx "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'p02b-holder' AND state = 'idle in transaction'")" || { r=obsfail; break; }
    [ "$r" = "1" ] && break
    sleep 0.1
  done
  if [ "$r" != "1" ]; then
    printf 'ROLLBACK;\n' >&7; exec 7>&-; wait "$hp"
    echo "error:持鎖端沒有停在交易中($r)$(head -c 160 "$TMPD/h.out")"; return
  fi
  PGAPPNAME=p02b-waiter "${PSQL[@]}" -tA -c "$ws" >"$TMPD/w.out" 2>&1 &
  wp=$!
  for i in $(seq 1 50); do
    if ! kill -0 "$wp" 2>/dev/null; then st=done; break; fi
    r="$(Qx "SELECT count(*) FROM pg_stat_activity w, pg_stat_activity h WHERE w.application_name = 'p02b-waiter' AND h.application_name = 'p02b-holder' AND h.pid = ANY (pg_blocking_pids(w.pid))")" || { st=obsfail; break; }
    if [ "$r" = "1" ]; then
      # 🔴 codex DB2 R1 should-fix 1:分清楚擋住它的是【客人 advisory lock】還是列鎖
      r="$(Qx "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'p02b-waiter' AND NOT l.granted AND l.locktype = 'advisory'")" || { st=obsfail; break; }
      [ "$r" = "1" ] && st=blocked_advisory || st=blocked_row
      break
    fi
    sleep 0.1
  done
  if [ "$st" = "done" ]; then
    r="$(Qx "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'p02b-holder' AND state = 'idle in transaction'")" || r=obsfail
    [ "$r" = "1" ] && st=done_while_held || st="done_holder=$r"
  fi
  printf 'COMMIT;\n' >&7; exec 7>&-
  wait "$hp"; hrc=$?
  wait "$wp"; wrc=$?
  [ "$st" = "obsfail" ] && { echo "error:觀測 SQL 失敗"; return; }
  [ "$hrc" = "0" ] || { echo "error:持鎖端 rc=$hrc $(head -c 160 "$TMPD/h.out")"; return; }
  [ "$wrc" = "0" ] || { echo "error:受測 rc=$wrc $(head -c 160 "$TMPD/w.out")"; return; }
  if grep -q 'deadlock' "$TMPD/h.out" "$TMPD/w.out"; then echo "error:deadlock"; return; fi
  case "$st" in blocked_advisory) echo waited_advisory ;; blocked_row) echo waited_row ;; done_while_held) echo not_waited ;; *) echo "error:$st" ;; esac
}

AMT=200
echo "── ⓪ 本片之前(負對照:逾期取消的乾淨匯款單一律被舊一代拒)"
C0="$(uuid)"; O0="$(Q "SELECT public.zz_mk_order('$C0'::uuid, 'bank_transfer', 7)" 2>/dev/null)"
[ -n "$O0" ] || { C0="$(Q "SELECT public.zz_mk_cust()")"; O0="$(Q "SELECT public.zz_mk_order('$C0', 'bank_transfer', 7)")"; }
expire
cell "⓪ 夾具:訂單總額 200、被排程取消成 payment_expired" "$(Q "SELECT total FROM public.orders WHERE id='$O0'")/$(reason_of "$O0")" "200/payment_expired"
pay t0 "$O0" "$(uuid)" bank_transfer $AMT "$(due "$O0") - interval '1 day'" >/dev/null
cell "⓪ 舊一代:期限內補登被通用訊息拒" "$(R t0 state)" "P0001"

echo "── ① 套本片"
ATTR_Q="SELECT proacl::text||'|'||proconfig::text||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner) FROM pg_proc WHERE oid=$PAY_OID"
ATTR0="$(Q "$ATTR_Q")"
P -f "$MIG" >/dev/null 2>&1; cell "① 第一次套用 rc" "$?" "0"
P -f "$MIG" >/dev/null 2>&1; cell "① 第二次套用(冪等)rc" "$?" "0"
cell "① 本體 md5 / COMMENT md5 是本代" "$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid=$PAY_OID")/$(Q "SELECT md5(obj_description($PAY_OID, 'pg_proc'))")" "$NEW_MD5/$NEW_CMT"
cell "① ACL / proconfig / SECURITY DEFINER / owner 套用前後相同" "$(Q "$ATTR_Q")" "$ATTR0"
Q "INSERT INTO public.zz_saved VALUES ('pay', pg_get_functiondef($PAY_OID)), ('recompute', pg_get_functiondef('public.pcm_noncard_settle_recompute(uuid)'::regprocedure)), ('open_for', pg_get_functiondef('public.pcm_pending_refund_open_for(uuid,boolean)'::regprocedure)), ('amounts', pg_get_functiondef('public.pcm_pending_refund_amounts(uuid)'::regprocedure))" >/dev/null
restore() { P -c "DO \$\$ BEGIN EXECUTE (SELECT def FROM public.zz_saved WHERE name = '$1'); END \$\$;" >/dev/null; }

new_expired() {  # 一位新客人 + 一張 7 天前的匯款單,排程取消 ⇒ 印 order id
  local c o; c="$(Q "SELECT public.zz_mk_cust()")"; o="$(Q "SELECT public.zz_mk_order('$c', '${1:-bank_transfer}', 7)")"; expire; printf '%s' "$o"
}
cust_of() { Q "SELECT customer_user_id FROM public.orders WHERE id = '$1'"; }

echo "── ② 三條主路"
O1="$(new_expired)"; K1="$(uuid)"
# 🔴 付款信 view 刻意排除「手動電話 / LINE 單而沒填通知信箱」的單(pcm_order_created_email_pending 最後一條)
#    ⇒ 本格要驗「復活後會排付款信」,夾具必須是【會寄信】的那種單:補一個通知信箱。
Q "UPDATE public.orders SET notification_email = 'notify@p02b.test' WHERE id = '$O1'" >/dev/null
cell "②1 夾具:乾淨逾期單、有通知信箱" "$(reason_of "$O1")/$(Q "SELECT notification_email FROM public.orders WHERE id='$O1'")" "payment_expired/notify@p02b.test"
pay t1 "$O1" "$K1" bank_transfer $AMT "$(due "$O1") - interval '1 day'" >/dev/null
cell "②1 期限內:回傳 OK / revived / refund_opened / new_order_exists" "$(R t1 state)/$(R t1 revived)/$(R t1 refund_opened)/$(R t1 new_order_exists)" "OK/true/false/false"
cell "②1 期限內:取消兩欄清空、狀態 paid" "$(Q "SELECT (cancelled_at IS NULL)::text||'/'||(cancelled_reason IS NULL)::text||'/'||payment_status FROM public.orders WHERE id='$O1'")" "true/true/paid"
cell "②1 期限內:待退款 0 列、復活稽核 1 列、付款信 view 挑得到" "$(cnt "public.order_pending_refunds WHERE order_id='$O1'")/$(cnt "public.admin_audit_log WHERE action='order.revive_expired' AND target='order:$O1'")/$(cnt "public.pcm_order_created_email_pending WHERE order_id='$O1'")" "0/1/1"

O2="$(new_expired)"; K2="$(uuid)"
pay t2 "$O2" "$K2" bank_transfer $AMT "$(due "$O2")" >/dev/null
cell "②2 期限上:回傳 OK / revived / refund_opened / new_order_exists" "$(R t2 state)/$(R t2 revived)/$(R t2 refund_opened)/$(R t2 new_order_exists)" "OK/false/true/false"
cell "②2 期限上:單仍取消、unpaid、收款 1 列" "$(Q "SELECT (cancelled_at IS NOT NULL)::text||'/'||payment_status FROM public.orders WHERE id='$O2'")/$(cnt "public.order_payments WHERE order_id='$O2'")" "true/unpaid/1"
cell "②2 期限上:待退款恰 1 列且 = (bank_transfer, 200, 活著)" "$(cnt "public.order_pending_refunds WHERE order_id='$O2'")/$(cnt "public.order_pending_refunds WHERE order_id='$O2' AND rail='bank_transfer' AND amount_at_cancel=200 AND voided_at IS NULL AND settled_at IS NULL")" "1/1"

C3="$(Q "SELECT public.zz_mk_cust()")"; O3="$(Q "SELECT public.zz_mk_order('$C3', 'bank_transfer', NULL)")"
Q "SELECT public.admin_cancel_order('$O3', '$(uuid)', 'probe_alice', 'customer_request', NULL, NULL)" >/dev/null 2>&1
cell "②3 夾具:admin_cancel_order 真的取消了" "$(Q "SELECT (cancelled_at IS NOT NULL)::text FROM public.orders WHERE id='$O3'")" "true"
pay t3 "$O3" "$(uuid)" bank_transfer $AMT "now() - interval '1 minute'" >/dev/null
cell "②3 員工取消的單 ⇒ P2B52、收款 0 列" "$(R t3 state)/$(cnt "public.order_payments WHERE order_id='$O3'")" "P2B52/0"

echo "── ③ 範圍與分流"
O4a="$(new_expired cash)"
pay t4a "$O4a" "$(uuid)" cash $AMT "$(due "$O4a") - interval '1 day'" >/dev/null
cell "③ 現金單逾期取消、用現金補登 ⇒ P2B54" "$(reason_of "$O4a")/$(R t4a state)" "payment_expired/P2B54"
O4b="$(new_expired)"
pay t4b "$O4b" "$(uuid)" cash $AMT "$(due "$O4b") - interval '1 day'" >/dev/null
cell "③ 匯款單逾期取消、用現金補登 ⇒ P2B54、收款 0 列" "$(R t4b state)/$(cnt "public.order_payments WHERE order_id='$O4b'")" "P2B54/0"
C5="$(Q "SELECT public.zz_mk_cust()")"; O5="$(Q "SELECT public.zz_mk_order('$C5', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET cancelled_at = now(), cancelled_reason = 'superseded_by_card' WHERE id = '$O5'" >/dev/null
pay t5 "$O5" "$(uuid)" bank_transfer $AMT "now() - interval '1 minute'" >/dev/null
cell "③ 刷卡取代(直接 UPDATE 替身)⇒ P2B52" "$(R t5 state)" "P2B52"

echo "── ④ 乾淨單 c1–c7(每張只有那一條不乾淨)"
# c1 走真 RPC:收款 → 沖銷 → 排程取消
C6="$(Q "SELECT public.zz_mk_cust()")"; O6="$(Q "SELECT public.zz_mk_order('$C6', 'bank_transfer', 7)")"
pay c1pay "$O6" "$(uuid)" bank_transfer 100 "$(due "$O6") - interval '2 days'" >/dev/null
Q "SELECT public.admin_reverse_manual_payment('$(R c1pay payment_id)', 'probe_alice', 'P02B 沖銷測試')" >/dev/null 2>&1
expire
cell "④c1 夾具:收款 + 沖銷淨額 0 後被排程取消" "$(R c1pay state)/$(cnt "public.order_payments WHERE order_id='$O6'")/$(reason_of "$O6")" "OK/2/payment_expired"
pay c1 "$O6" "$(uuid)" bank_transfer $AMT "$(due "$O6") - interval '1 day'" >/dev/null
cell "④c1 有收款歷史(含沖銷)⇒ P2B51、收款列數不變" "$(R c1 state)/$(R c1 con)/$(cnt "public.order_payments WHERE order_id='$O6'")" "P2B51/pcm_p02_expired_has_history/2"

O7="$(new_expired)"
P -c "ALTER TABLE public.order_cancellations DISABLE TRIGGER USER; ALTER TABLE public.order_cancellation_items DISABLE TRIGGER USER;
WITH c AS (INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
           VALUES ('$O7', 'customer_request', gen_random_uuid(), repeat('a', 64), 'probe_alice') RETURNING id)
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT c.id, '$O7', (SELECT i.id FROM public.order_items i WHERE i.order_id = '$O7' LIMIT 1), 1 FROM c;
ALTER TABLE public.order_cancellations ENABLE TRIGGER USER; ALTER TABLE public.order_cancellation_items ENABLE TRIGGER USER;" >/dev/null 2>&1
cell "④c2 夾具:部分取消列在" "$(cnt "public.order_cancellation_items WHERE order_id='$O7'")" "1"
pay c2 "$O7" "$(uuid)" bank_transfer $AMT "$(due "$O7") - interval '1 day'" >/dev/null
cell "④c2 有部分取消 ⇒ P2B51" "$(R c2 state)" "P2B51"

O8="$(new_expired)"
Q "WITH k AS (INSERT INTO public.coupons (code, discount_type, discount_value, stacks_with_tier, created_by) VALUES ('P02B$(date +%s)', 'fixed', 10, false, 'probe_alice') RETURNING id)
   INSERT INTO public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied, reverted_at) SELECT k.id, '$O8', '$(cust_of "$O8")', 10, now() FROM k" >/dev/null 2>&1
cell "④c3 夾具:已退回的兌券列在" "$(cnt "public.coupon_redemptions WHERE order_id='$O8' AND reverted_at IS NOT NULL")" "1"
pay c3 "$O8" "$(uuid)" bank_transfer $AMT "$(due "$O8") - interval '1 day'" >/dev/null
cell "④c3 有兌券紀錄(已退回)⇒ P2B51" "$(R c3 state)" "P2B51"

O9="$(new_expired)"
Q "INSERT INTO public.order_pending_refunds (order_id, rail, amount_at_cancel, voided_at, void_reason) VALUES ('$O9', 'bank_transfer', 100, now(), 'P02B 作廢測試')" >/dev/null 2>&1
cell "④c4 夾具:已作廢待退款列在" "$(cnt "public.order_pending_refunds WHERE order_id='$O9'")" "1"
pay c4 "$O9" "$(uuid)" bank_transfer $AMT "$(due "$O9") - interval '1 day'" >/dev/null
cell "④c4 有待退款歷史(已作廢)⇒ P2B51" "$(R c4 state)" "P2B51"

O10="$(new_expired)"
P -c "ALTER TABLE public.order_manual_refunds DISABLE TRIGGER USER;
INSERT INTO public.order_manual_refunds (order_id, rail, refund_amount, reason, actor, occurred_at, request_id) VALUES ('$O10', 'bank_transfer', 50, 'P02B', 'probe_alice', now(), gen_random_uuid());
ALTER TABLE public.order_manual_refunds ENABLE TRIGGER USER;" >/dev/null 2>&1
cell "④c5 夾具:人工退款列在" "$(cnt "public.order_manual_refunds WHERE order_id='$O10'")" "1"
pay c5 "$O10" "$(uuid)" bank_transfer $AMT "$(due "$O10") - interval '1 day'" >/dev/null
cell "④c5 有人工退款 ⇒ P2B51" "$(R c5 state)" "P2B51"

outbox() { Q "INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, last_error_code) VALUES ('$2', '$1', gen_random_uuid()::text, 'x@p02b.test', 's', '{}'::jsonb, '$3', $4)" >/dev/null 2>&1; }
O11="$(new_expired)"; outbox "$O11" order_created skipped_order_ineligible NULL
pay c6a "$O11" "$(uuid)" bank_transfer $AMT "$(due "$O11") - interval '1 day'" >/dev/null
cell "④c6 付款信 skipped_order_ineligible ⇒ P2B51" "$(cnt "public.email_outbox WHERE order_id='$O11'")/$(R c6a state)" "1/P2B51"
O12="$(new_expired)"; outbox "$O12" order_created failed "'recipient_stale_at_send'"
pay c6b "$O12" "$(uuid)" bank_transfer $AMT "$(due "$O12") - interval '1 day'" >/dev/null
cell "④c6 付款信是可重排的錯誤碼 ⇒ 仍 P2B51(保守)" "$(cnt "public.email_outbox WHERE order_id='$O12'")/$(R c6b state)" "1/P2B51"
O13="$(new_expired)"; outbox "$O13" bank_order_created sent NULL
pay c6n "$O13" "$(uuid)" bank_transfer $AMT "$(due "$O13") - interval '1 day'" >/dev/null
cell "④c6 負對照:只有匯款資訊信 ⇒ 不擋、照樣復活" "$(cnt "public.email_outbox WHERE order_id='$O13'")/$(R c6n state)/$(R c6n revived)" "1/OK/true"

O14="$(new_expired)"
Q "INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, fallback_token_hash) VALUES ('$O14', '$(cust_of "$O14")', 'pending', repeat('a', 64))" >/dev/null 2>&1
cell "④c7 夾具:非 failed 的刷卡嘗試列在" "$(cnt "public.payment_charge_attempts WHERE order_id='$O14'")" "1"
pay c7 "$O14" "$(uuid)" bank_transfer $AMT "$(due "$O14") - interval '1 day'" >/dev/null
cell "④c7 有在途刷卡 ⇒ P2B51" "$(R c7 state)" "P2B51"

echo "── ⑤ 結算判定"
O15="$(new_expired)"; pay u "$O15" "$(uuid)" bank_transfer 150 "$(due "$O15") - interval '1 day'" >/dev/null
cell "⑤ 少付 150 ⇒ 復活、partiallyPaid" "$(R u state)/$(R u revived)/$(Q "SELECT payment_status FROM public.orders WHERE id='$O15'")" "OK/true/partiallyPaid"
O16="$(new_expired)"; pay o "$O16" "$(uuid)" bank_transfer 250 "$(due "$O16") - interval '1 day'" >/dev/null
cell "⑤ 多付 250 ⇒ 復活、unpaid、取消欄已清" "$(R o state)/$(R o revived)/$(Q "SELECT payment_status||'/'||(cancelled_at IS NULL)::text FROM public.orders WHERE id='$O16'")" "OK/true/unpaid/true"
C16i="$(Q "SELECT public.zz_mk_cust()")"; O16i="$(Q "SELECT public.zz_mk_order_inv('$C16i')")"; expire
T16i="$(Q "SELECT total FROM public.orders WHERE id='$O16i'")"
pay inv "$O16i" "$(uuid)" bank_transfer "$T16i" "$(due "$O16i") - interval '1 day'" >/dev/null
cell "⑤ 開發票含稅的單(總額 ≠ 200)付足額 ⇒ 復活、paid" "$([ "$T16i" != "200" ] && echo taxed || echo "not_taxed:$T16i")/$(reason_of "$O16i")/$(R inv revived)/$(Q "SELECT payment_status FROM public.orders WHERE id='$O16i'")" "taxed/<null>/true/paid"
O17="$(new_expired)"
# 🔴 subtotal 與 total 一起 +1:orders_total_balances(subtotal + 運費 - 折扣 = total)要成立,
#    而品項合計仍是 100 ⇒ 結算 P3(品項快照完整)不成立。第一版只改 subtotal ⇒ 撞 CHECK 而錯誤被吞、夾具沒生效。
P -c "ALTER TABLE public.orders DISABLE TRIGGER pcm_e13_orders_subtotal_guard; UPDATE public.orders SET subtotal = subtotal + 1, total = total + 1 WHERE id = '$O17'; ALTER TABLE public.orders ENABLE TRIGGER pcm_e13_orders_subtotal_guard;" >/dev/null 2>&1
cell "⑤ 夾具:小計 101 ≠ 品項合計 100、總額 201" "$(Q "SELECT subtotal||'/'||(SELECT sum(i.line_total) FROM public.order_items i WHERE i.order_id=o.id)||'/'||total FROM public.orders o WHERE id='$O17'")" "101/100/201"
pay h "$O17" "$(uuid)" bank_transfer 201 "$(due "$O17") - interval '1 day'" >/dev/null
cell "⑤ 品項快照對不上 ⇒ P2B51 結算判不清、整筆回滾" "$(R h state)/$(R h con)/$(cnt "public.order_payments WHERE order_id='$O17'")/$(reason_of "$O17")" "P2B51/pcm_p02_revive_settlement_unclear/0/payment_expired"
O18="$(new_expired)"
P -c "CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS \$f\$ BEGIN RETURN; END \$f\$;" >/dev/null
pay s "$O18" "$(uuid)" bank_transfer $AMT "$(due "$O18") - interval '1 day'" >/dev/null
restore recompute
cell "⑤ 重算吞例外不翻狀態 ⇒ P2B51、整筆回滾、單仍取消" "$(R s state)/$(R s con)/$(cnt "public.order_payments WHERE order_id='$O18'")/$(reason_of "$O18")" "P2B51/pcm_p02_revive_settlement_unclear/0/payment_expired"
cell "⑤ 重算函式已還原" "$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pcm_noncard_settle_recompute(uuid)'::regprocedure")" "bc8d977dd098677dbba8a445a7ff6a56"

echo "── ⑥ 客人另下新單(界 = due_at)"
O19="$(new_expired)"; Q "SELECT public.zz_mk_order('$(cust_of "$O19")', 'bank_transfer', NULL)" >/dev/null
KN1="$(uuid)"; pay n1 "$O19" "$KN1" bank_transfer $AMT "$(due "$O19") - interval '1 day'" >/dev/null
cell "⑥ 期限後已另下新單 ⇒ 期限內匯的也不復活、開待退款" "$(R n1 state)/$(R n1 revived)/$(R n1 refund_opened)/$(R n1 new_order_exists)" "OK/false/true/true"
O20="$(new_expired)"; NO20="$(Q "SELECT public.zz_mk_order('$(cust_of "$O20")', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET created_at = $(due "$O20") + interval '10 minutes' WHERE id = '$NO20'; UPDATE public.orders SET cancelled_at = $(due "$O20") + interval '60 minutes' WHERE id = '$O20'" >/dev/null
pay n2 "$O20" "$(uuid)" bank_transfer $AMT "$(due "$O20") - interval '1 day'" >/dev/null
cell "⑥ R2 反例:新單 due+10 分、排程 due+60 分才取消 ⇒ 仍算新單" "$(R n2 refund_opened)/$(R n2 new_order_exists)" "true/true"
O21="$(new_expired)"; NO21="$(Q "SELECT public.zz_mk_order('$(cust_of "$O21")', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET created_at = $(due "$O21") - interval '1 second' WHERE id = '$NO21'" >/dev/null
pay n3 "$O21" "$(uuid)" bank_transfer $AMT "$(due "$O21") - interval '1 day'" >/dev/null
cell "⑥ 新單建於 due 前 1 秒(另一筆購買)⇒ 仍復活" "$(R n3 revived)/$(R n3 new_order_exists)" "true/false"
O22="$(new_expired)"; NO22="$(Q "SELECT public.zz_mk_order('$(cust_of "$O22")', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET cancelled_at = now(), cancelled_reason = 'P02B 測試' WHERE id = '$NO22'" >/dev/null
pay n4 "$O22" "$(uuid)" bank_transfer $AMT "$(due "$O22") - interval '1 day'" >/dev/null
cell "⑥ 新單已取消 ⇒ 仍復活" "$(R n4 revived)" "true"
O23="$(new_expired)"; Q "SELECT public.zz_mk_order(public.zz_mk_cust(), 'bank_transfer', NULL)" >/dev/null
pay n5 "$O23" "$(uuid)" bank_transfer $AMT "$(due "$O23") - interval '1 day'" >/dev/null
cell "⑥ 別的客人的新單 ⇒ 仍復活" "$(R n5 revived)" "true"

echo "── ⑦ 冪等"
pay r1 "$O1" "$K1" bank_transfer $AMT "$(due "$O1") - interval '1 day'" >/dev/null
cell "⑦ 復活那筆原封重送 ⇒ idempotent、revived、收款仍 1 列" "$(R r1 idempotent)/$(R r1 revived)/$(R r1 refund_opened)/$(cnt "public.order_payments WHERE order_id='$O1'")" "true/true/false/1"
pay r2 "$O2" "$K2" bank_transfer $AMT "$(due "$O2")" >/dev/null
cell "⑦ 待退款那筆原封重送 ⇒ idempotent、refund_opened、收款仍 1 列" "$(R r2 idempotent)/$(R r2 revived)/$(R r2 refund_opened)/$(cnt "public.order_payments WHERE order_id='$O2'")" "true/false/true/1"
pay r10 "$O19" "$KN1" bank_transfer $AMT "$(due "$O19") - interval '1 day'" >/dev/null
cell "⑦ 有新單那筆原封重送 ⇒ idempotent、refund_opened、new_order_exists 都還原" "$(R r10 idempotent)/$(R r10 refund_opened)/$(R r10 new_order_exists)" "true/true/true"
pay r3 "$O1" "$K1" bank_transfer 199 "$(due "$O1") - interval '1 day'" >/dev/null
cell "⑦ 同鍵改金額 ⇒ P2B53、收款仍 1 列" "$(R r3 state)/$(R r3 con)/$(cnt "public.order_payments WHERE order_id='$O1'")" "P2B53/pcm_p02_request_id_content_conflict/1"
pay r4 "$O1" "$K1" bank_transfer $AMT "$(due "$O1") - interval '2 days'" >/dev/null
cell "⑦ 同鍵改收款日 ⇒ P2B53" "$(R r4 state)" "P2B53"
Q "UPDATE public.orders SET payment_status = 'refunded' WHERE id = '$O2'" >/dev/null
pay r5 "$O2" "$K2" bank_transfer $AMT "$(due "$O2")" >/dev/null
cell "⑦ 單變退款態(替身)後原封重送 ⇒ idempotent,不是 P2B41" "$(R r5 state)/$(R r5 idempotent)" "OK/true"
O24="$(new_expired)"; O24b="$(new_expired)"; SAMEK="$(uuid)"
pay r6a "$O24" "$SAMEK" bank_transfer $AMT "$(due "$O24") - interval '1 day'" >/dev/null
pay r6b "$O24b" "$SAMEK" bank_transfer $AMT "$(due "$O24b")" >/dev/null
pay r6c "$O24" "$SAMEK" bank_transfer $AMT "$(due "$O24") - interval '1 day'" >/dev/null
pay r6d "$O24b" "$SAMEK" bank_transfer $AMT "$(due "$O24b")" >/dev/null
cell "⑦ 兩張單同一把鍵:各自重放只讀自己那筆的處置" "$(R r6c revived)/$(R r6c refund_opened)|$(R r6d revived)/$(R r6d refund_opened)" "true/false|false/true"
pay r7 "$O15" "$(uuid)" bank_transfer 50 "now() - interval '1 minute'" >/dev/null
cell "⑦ 同單不同鍵(已復活的單)⇒ 走一般收款" "$(R r7 state)/$(R r7 revived)/$(R r7 refund_opened)/$(cnt "public.order_payments WHERE order_id='$O15'")" "OK/false/false/2"
pay r8 "$O2" "$(uuid)" bank_transfer 50 "$(due "$O2")" >/dev/null
Q "UPDATE public.orders SET payment_status = 'unpaid' WHERE id = '$O2'" >/dev/null
pay r9 "$O2" "$(uuid)" bank_transfer 50 "$(due "$O2")" >/dev/null
cell "⑦ 期限後那張已有待退款,再來第二筆(不同鍵)⇒ P2B51" "$(R r9 state)" "P2B51"

echo "── ⑧ 真兩連線"
O25="$(new_expired)"
cell "⑧ 同單兩員工:第一位復活未 commit ⇒ 第二位被它的列鎖擋住" "$(probe "SELECT public.zz_pay('cc1', '$O25', '$(uuid)', 'bank_transfer', $AMT, $(due "$O25") - interval '1 day')" "SELECT public.zz_pay('cc2', '$O25', '$(uuid)', 'bank_transfer', 50, $(due "$O25") - interval '1 day')")" "waited_row"
cell "⑧ 同單兩員工:第一位復活、第二位醒來走一般收款、復活稽核 1 列" "$(R cc1 revived)/$(R cc2 state)/$(R cc2 revived)/$(cnt "public.admin_audit_log WHERE action='order.revive_expired' AND target='order:$O25'")" "true/OK/false/1"
O26="$(new_expired)"; C26="$(cust_of "$O26")"
cell "⑧ 建單先(未 commit)⇒ 同客人的補登被擋住" "$(probe "SELECT public.zz_mk_order('$C26', 'bank_transfer', NULL)" "SELECT public.zz_pay('cc3', '$O26', '$(uuid)', 'bank_transfer', $AMT, $(due "$O26") - interval '1 day')")" "waited_advisory"
cell "⑧ 建單先:補登醒來看到新單 ⇒ 開待退款、new_order_exists" "$(R cc3 state)/$(R cc3 revived)/$(R cc3 new_order_exists)" "OK/false/true"
O27="$(new_expired)"; C27="$(cust_of "$O27")"
cell "⑧ 補登先(未 commit)⇒ 同客人的手動建單被擋住" "$(probe "SELECT public.zz_pay('cc4', '$O27', '$(uuid)', 'bank_transfer', $AMT, $(due "$O27") - interval '1 day')" "SELECT public.zz_mk_order('$C27', 'bank_transfer', NULL)")" "waited_advisory"
cell "⑧ 補登先:復活成功、手動建單之後也建出來" "$(R cc4 revived)/$(cnt "public.orders WHERE customer_user_id='$C27'")" "true/2"
O28="$(new_expired)"; C28="$(cust_of "$O28")"; T28="$(Q "SELECT public.zz_mk_order('$C28', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET payment_channel = 'tappay', cart_session_id = gen_random_uuid() WHERE id = '$T28'" >/dev/null
cell "⑧ begin_charge_attempt 先(未 commit)⇒ 同客人的補登被擋、無死鎖" "$(probe "SELECT public.begin_charge_attempt('$T28')" "SELECT public.zz_pay('cc5', '$O28', '$(uuid)', 'bank_transfer', $AMT, $(due "$O28") - interval '1 day')")" "waited_advisory"
cell "⑧ begin_charge_attempt 先:補登醒來結果不是死鎖" "$(R cc5 state)" "OK"
O29="$(new_expired)"; C29="$(cust_of "$O29")"; T29="$(Q "SELECT public.zz_mk_order('$C29', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET payment_channel = 'tappay', cart_session_id = gen_random_uuid() WHERE id = '$T29'" >/dev/null
cell "⑧ 補登先(未 commit)⇒ 同客人的 begin_charge_attempt 被擋、無死鎖" "$(probe "SELECT public.zz_pay('cc6', '$O29', '$(uuid)', 'bank_transfer', $AMT, $(due "$O29") - interval '1 day')" "SELECT public.begin_charge_attempt('$T29')")" "waited_advisory"
C30="$(Q "SELECT public.zz_mk_cust()")"; O30="$(Q "SELECT public.zz_mk_order('$C30', 'bank_transfer', 7)")"
cell "⑧ 排程先取消(未 commit)⇒ 補登被擋住" "$(probe "SELECT pcm_cron.expire_unpaid_orders(500)" "SELECT public.zz_pay('cc7', '$O30', '$(uuid)', 'bank_transfer', $AMT, $(due "$O30") - interval '1 day')")" "waited_row"
cell "⑧ 排程先:補登醒來看到剛取消的單 ⇒ 走補登路、復活" "$(R cc7 state)/$(R cc7 revived)" "OK/true"
C31="$(Q "SELECT public.zz_mk_cust()")"; O31="$(Q "SELECT public.zz_mk_order('$C31', 'bank_transfer', 7)")"
cell "⑧ 收款先(單還沒被取消、未 commit)⇒ 排程不等它" "$(probe "SELECT public.zz_pay('cc8', '$O31', '$(uuid)', 'bank_transfer', $AMT, $(due "$O31") - interval '1 day')" "SELECT pcm_cron.expire_unpaid_orders(500)")" "not_waited"
cell "⑧ 收款先:走一般收款、單沒被取消" "$(R cc8 state)/$(R cc8 revived)/$(Q "SELECT (cancelled_at IS NULL)::text FROM public.orders WHERE id='$O31'")" "OK/false/true"

O41="$(new_expired)"
cell "⑧ 期限後兩員工:第一位開待退款未 commit ⇒ 第二位被列鎖擋住" "$(probe "SELECT public.zz_pay('cc9', '$O41', '$(uuid)', 'bank_transfer', $AMT, $(due "$O41"))" "SELECT public.zz_pay('cc10', '$O41', '$(uuid)', 'bank_transfer', 50, $(due "$O41"))")" "waited_row"
cell "⑧ 期限後兩員工:第一位開待退款、第二位醒來 P2B51、待退款仍 1 列" "$(R cc9 refund_opened)/$(R cc10 state)/$(cnt "public.order_pending_refunds WHERE order_id='$O41'")" "true/P2B51/1"
cell "⑧ 靜態:前台 create_order 拿的是同一個 key 算法(動態只測手動建單)" "$(Q "SELECT (strpos(prosrc, 'pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0))') > 0)::text FROM pg_proc WHERE oid='public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text)'::regprocedure")" "true"

# 同 cart 交錯(codex DB2 R1 should-fix 1):持鎖端照 begin_charge_attempt 的鎖序分段執行,補登卡在中間
interleave() {
  local e="$1" t="$2" cart="$3" cust="$4" hp wp hrc wrc i r st=none
  rm -f "$TMPD/h.fifo"; mkfifo "$TMPD/h.fifo"
  PGAPPNAME=p02b-holder "${PSQL[@]}" -f "$TMPD/h.fifo" >"$TMPD/h.out" 2>&1 &
  hp=$!
  exec 7>"$TMPD/h.fifo"
  printf '%s\n' 'BEGIN;' "SELECT 1 FROM public.orders WHERE id = '$t' FOR UPDATE;" "SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended('$cust'::text, 0));" >&7
  for i in $(seq 1 100); do
    r="$(Qx "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'p02b-holder' AND state = 'idle in transaction'")" || { r=obsfail; break; }
    [ "$r" = "1" ] && break; sleep 0.1
  done
  [ "$r" = "1" ] || { printf 'ROLLBACK;\n' >&7; exec 7>&-; wait "$hp"; echo "error:持鎖端沒停在交易中"; return; }
  PGAPPNAME=p02b-waiter "${PSQL[@]}" -tA -c "SELECT public.zz_pay('dl1', '$e', '$(uuid)', 'bank_transfer', 200, $(due "$e") - interval '1 day')" >"$TMPD/w.out" 2>&1 &
  wp=$!
  for i in $(seq 1 50); do
    r="$(Qx "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'p02b-waiter' AND NOT l.granted AND l.locktype = 'advisory'")" || { st=obsfail; break; }
    [ "$r" = "1" ] && { st=waiter_on_advisory; break; }
    sleep 0.1
  done
  # 補登此刻拿著 E 的列鎖、等客人鎖;持鎖端接著做 supersede 形狀的 UPDATE(寬條件)再 COMMIT
  printf '%s\n' "UPDATE public.orders SET cancelled_at = now(), cancelled_reason = 'superseded_by_card' WHERE cart_session_id = '$cart' AND id <> '$t' AND cancelled_at IS NULL;" 'COMMIT;' >&7
  exec 7>&-
  wait "$hp"; hrc=$?; wait "$wp"; wrc=$?
  if grep -q 'deadlock' "$TMPD/h.out" "$TMPD/w.out"; then echo "error:deadlock"; return; fi
  [ "$st" = "waiter_on_advisory" ] || { echo "error:補登沒有卡在客人鎖($st)"; return; }
  [ "$hrc" = "0" ] && [ "$wrc" = "0" ] || { echo "error:rc $hrc/$wrc"; return; }
  echo no_deadlock
}
O42="$(new_expired)"; C42="$(cust_of "$O42")"; T42="$(Q "SELECT public.zz_mk_order('$C42', 'bank_transfer', NULL)")"; CART42="$(uuid)"
Q "UPDATE public.orders SET payment_channel = 'tappay', cart_session_id = '$CART42' WHERE id = '$T42'; UPDATE public.orders SET cart_session_id = '$CART42' WHERE id = '$O42'" >/dev/null
cell "⑧ 同 cart 交錯:刷卡形狀持鎖端(列鎖→客人鎖→supersede UPDATE)夾住補登 ⇒ 無死鎖" "$(interleave "$O42" "$T42" "$CART42" "$C42")" "no_deadlock"
# 🔴 夾具裡那張刷卡單本身就是「同客人、期限後、未取消」的新單 ⇒ Sean Q2 乙:不復活、入帳開待退款(第一版期望寫成復活是我寫錯)。
cell "⑧ 同 cart 交錯:補登醒來照 Q2 乙走待退款(刷卡單算新單)" "$(R dl1 state)/$(R dl1 revived)/$(R dl1 refund_opened)/$(R dl1 new_order_exists)" "OK/false/true/true"
cell "⑧ 同 cart 交錯:supersede 沒有改到已取消的舊單(取消原因仍是 payment_expired)" "$(reason_of "$O42")" "payment_expired"

echo "── ⑨ 復活 → 沖銷 → 排程再取消 → 再補登"
O32="$(new_expired)"; pay z1 "$O32" "$(uuid)" bank_transfer $AMT "$(due "$O32") - interval '1 day'" >/dev/null
Q "SELECT public.admin_reverse_manual_payment('$(R z1 payment_id)', 'probe_alice', 'P02B 沖銷測試')" >/dev/null 2>&1
expire
cell "⑨ 夾具:復活後沖銷回 0、再被排程取消" "$(R z1 revived)/$(reason_of "$O32")" "true/payment_expired"
pay z2 "$O32" "$(uuid)" bank_transfer $AMT "$(due "$O32") - interval '1 day'" >/dev/null
cell "⑨ 再補登 ⇒ P2B51(已不乾淨)" "$(R z2 state)" "P2B51"

echo "── ⑩ 失敗注入"
inject_open_for_raise() { P -c "CREATE OR REPLACE FUNCTION public.pcm_pending_refund_open_for(p_order_id uuid, p_overwrite_amount boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS \$f\$ BEGIN RAISE EXCEPTION 'P02B 注入:開待退款失敗'; END \$f\$;" >/dev/null; }
O33="$(new_expired)"; inject_open_for_raise
pay f1 "$O33" "$(uuid)" bank_transfer $AMT "$(due "$O33")" >/dev/null
restore open_for
cell "⑩ 開待退款失敗(被重算吞掉)⇒ P2B40 整筆回滾、收款 0、單仍取消" "$(R f1 state)/$(R f1 con)/$(cnt "public.order_payments WHERE order_id='$O33'")/$(reason_of "$O33")" "P2B40/pcm_p02_late_refund_row_set/0/payment_expired"
cell "⑩ 開待退款函式已還原" "$(Q "SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pcm_pending_refund_open_for(uuid,boolean)'::regprocedure")" "0ca2c260e4f6077147dc3b9deb6fa4c7"

echo "── ⑪ 突變(每一個都要讓對應那格轉紅)"
mutate() {  # $1 = SQL 檔(內容:DO 區塊,把 pay 的定義做一次字串替換並確認替換前錨點存在)
  P -f "$1" >/dev/null 2>&1 && echo ok || echo fail
}
cat > "$TMPD/m1.sql" <<'SQL'
DO $m$ DECLARE d text := (SELECT def FROM public.zz_saved WHERE name = 'pay'); a text := 'ELSIF v_disposition = ''refund'' THEN';
BEGIN IF strpos(d, a) = 0 THEN RAISE EXCEPTION '突變錨點不在'; END IF; EXECUTE replace(d, a, 'ELSIF v_disposition = ''refund_mutant'' THEN'); END $m$;
SQL
cat > "$TMPD/m2.sql" <<'SQL'
DO $m$ DECLARE d text := (SELECT def FROM public.zz_saved WHERE name = 'pay'); a text := E'IF v_disposition = ''revive'' THEN\n    UPDATE public.orders o';
BEGIN IF strpos(d, a) = 0 THEN RAISE EXCEPTION '突變錨點不在'; END IF; EXECUTE replace(d, a, E'IF v_disposition = ''revive_mutant'' THEN\n    UPDATE public.orders o'); END $m$;
SQL
cat > "$TMPD/m3.sql" <<'SQL'
DO $m$ DECLARE d text := (SELECT def FROM public.zz_saved WHERE name = 'pay'); a text := 'PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));';
BEGIN IF strpos(d, a) = 0 THEN RAISE EXCEPTION '突變錨點不在'; END IF; EXECUTE replace(d, a, 'PERFORM 1;'); END $m$;
SQL
cat > "$TMPD/m4.sql" <<'SQL'
DO $m$ DECLARE d text := (SELECT def FROM public.zz_saved WHERE name = 'pay'); a text := 'AND n.created_at >= v_due_at';
BEGIN IF strpos(d, a) = 0 THEN RAISE EXCEPTION '突變錨點不在'; END IF; EXECUTE replace(d, a, 'AND n.created_at >= (SELECT o2.cancelled_at FROM public.orders o2 WHERE o2.id = p_order_id)'); END $m$;
SQL
PAY_MD5_Q="SELECT md5(prosrc) FROM pg_proc WHERE oid=$PAY_OID"

cell "⑪1 突變:拿掉待退款列集合驗證 —— 突變套上" "$(mutate "$TMPD/m1.sql")" "ok"
O34="$(new_expired)"; inject_open_for_raise
pay m1 "$O34" "$(uuid)" bank_transfer $AMT "$(due "$O34")" >/dev/null
restore open_for; restore pay
cell "⑪1 ⇒ ⑩ 那格的判定轉紅(入帳成功而沒有待退款)" "$(R m1 state)/$(cnt "public.order_pending_refunds WHERE order_id='$O34'")" "OK/0"
cell "⑪1 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

cell "⑪2 突變:復活 UPDATE 不執行 —— 突變套上" "$(mutate "$TMPD/m2.sql")" "ok"
O35="$(new_expired)"; pay m2 "$O35" "$(uuid)" bank_transfer $AMT "$(due "$O35") - interval '1 day'" >/dev/null
restore pay
cell "⑪2 ⇒ ②1 那格轉紅(沒有復活)" "$(R m2 state)/$(R m2 revived)" "P2B51/<none>"
cell "⑪2 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

cell "⑪3 突變:拿掉客人層級鎖 —— 突變套上" "$(mutate "$TMPD/m3.sql")" "ok"
O36="$(new_expired)"; C36="$(cust_of "$O36")"
M3="$(probe "SELECT public.zz_mk_order('$C36', 'bank_transfer', NULL)" "SELECT public.zz_pay('m3', '$O36', '$(uuid)', 'bank_transfer', $AMT, $(due "$O36") - interval '1 day')")"
restore pay
cell "⑪3 ⇒ ⑧「建單先」那格轉紅(補登不被擋、看不到新單而復活)" "$M3/$(R m3 revived)" "not_waited/true"
cell "⑪3 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

cell "⑪4 突變:新單的界改回 cancelled_at —— 突變套上" "$(mutate "$TMPD/m4.sql")" "ok"
O37="$(new_expired)"; NO37="$(Q "SELECT public.zz_mk_order('$(cust_of "$O37")', 'bank_transfer', NULL)")"
Q "UPDATE public.orders SET created_at = $(due "$O37") + interval '10 minutes' WHERE id = '$NO37'; UPDATE public.orders SET cancelled_at = $(due "$O37") + interval '60 minutes' WHERE id = '$O37'" >/dev/null
pay m4 "$O37" "$(uuid)" bank_transfer $AMT "$(due "$O37") - interval '1 day'" >/dev/null
restore pay
cell "⑪4 ⇒ ⑥ R2 反例那格轉紅(錯誤復活)" "$(R m4 revived)/$(R m4 new_order_exists)" "true/false"
cell "⑪4 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

cat > "$TMPD/m5.sql" <<'SQL'
DO $m$ DECLARE d text := (SELECT def FROM public.zz_saved WHERE name = 'pay'); a text := E'  IF v_disposition = ''revive'' THEN\n    -- 🔴 驗 verdict 與狀態';
BEGIN IF strpos(d, a) = 0 THEN RAISE EXCEPTION '突變錨點不在'; END IF; EXECUTE replace(d, a, E'  IF v_disposition = ''revive_mutant'' THEN\n    -- 🔴 驗 verdict 與狀態'); END $m$;
SQL
cat > "$TMPD/m6.sql" <<'SQL'
DO $m$
DECLARE d text := (SELECT def FROM public.zz_saved WHERE name = 'pay');
  a int := strpos(d, '  -- ══ 稽核 P0-2 B2:復活');
  g int := strpos(d, '  -- ══ G9 落帳');
  anchor text := E'CONSTRAINT = ''pcm_op5_row_count'';\n  END IF;\n';
  blk text; d2 text; p int;
BEGIN
  IF a = 0 OR g = 0 OR g <= a THEN RAISE EXCEPTION '突變錨點不在(a=% g=%)', a, g; END IF;
  blk := substr(d, a, g - a);
  d2 := overlay(d placing '' from a for g - a);
  p := strpos(d2, anchor);
  IF p = 0 THEN RAISE EXCEPTION '突變錨點二不在'; END IF;
  EXECUTE overlay(d2 placing blk from p + length(anchor) for 0);
END $m$;
SQL
cell "⑪5 突變:拿掉 §5.2 結算事後判定 —— 突變套上" "$(mutate "$TMPD/m5.sql")" "ok"
O43="$(new_expired)"
P -c "ALTER TABLE public.orders DISABLE TRIGGER pcm_e13_orders_subtotal_guard; UPDATE public.orders SET subtotal = subtotal + 1, total = total + 1 WHERE id = '$O43'; ALTER TABLE public.orders ENABLE TRIGGER pcm_e13_orders_subtotal_guard;" >/dev/null 2>&1
pay m5 "$O43" "$(uuid)" bank_transfer 201 "$(due "$O43") - interval '1 day'" >/dev/null
restore pay
cell "⑪5 ⇒ ⑤「品項快照對不上」那格轉紅(判不清卻照樣復活)" "$(R m5 state)/$(reason_of "$O43")" "OK/<null>"
cell "⑪5 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

cell "⑪6 突變:復活 UPDATE 挪到 INSERT 之後 —— 突變套上" "$(mutate "$TMPD/m6.sql")" "ok"
cell "⑪6 突變確實改了順序(復活段落在 G9 之後)" "$(Q "SELECT (strpos(prosrc, '-- ══ 稽核 P0-2 B2:復活') > strpos(prosrc, '-- ══ G9 落帳'))::text FROM pg_proc WHERE oid=$PAY_OID")" "true"
O44="$(new_expired)"; pay m6 "$O44" "$(uuid)" bank_transfer $AMT "$(due "$O44") - interval '1 day'" >/dev/null
restore pay
cell "⑪6 ⇒ ②1 那格轉紅(INSERT 先跑 ⇒ 沒有乾淨地復活)" "$(R m6 state)" "P2B51"
cell "⑪6 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

cell "⑪7 回滾檔前置閘:線上不是本代 ⇒ 不回滾 —— 先套一個突變" "$(mutate "$TMPD/m1.sql")" "ok"
cell "⑪7 ⇒ 回滾前置閘擋下、本體維持突變版" "$(P -f "$DOWN" 2>&1 | grep -c '回滾前置閘')/$([ "$(Q "$PAY_MD5_Q")" != "$NEW_MD5" ] && echo still_mutant || echo restored)" "1/still_mutant"
restore pay
cell "⑪7 還原後本體 md5 回到本代" "$(Q "$PAY_MD5_Q")" "$NEW_MD5"

echo "── ⑫ 回滾"
ATTR1="$(Q "$ATTR_Q")"
P -f "$DOWN" >/dev/null 2>&1; cell "⑫ 回滾 rc" "$?" "0"
cell "⑫ 本體 / COMMENT 回到 20260812150000 那一代" "$(Q "$PAY_MD5_Q")/$(Q "SELECT md5(obj_description($PAY_OID, 'pg_proc'))")" "$OLD_MD5/$OLD_CMT"
cell "⑫ 回滾前後 ACL / proconfig / SECURITY DEFINER / owner 相同" "$(Q "$ATTR_Q")" "$ATTR1"
O38="$(new_expired)"; pay b1 "$O38" "$(uuid)" bank_transfer $AMT "$(due "$O38") - interval '1 day'" >/dev/null
cell "⑫ 回滾後:逾期乾淨單期限內補登恢復成拒" "$(R b1 state)" "P0001"
O39="$(new_expired)"; pay b2 "$O39" "$(uuid)" bank_transfer $AMT "$(due "$O39")" >/dev/null
cell "⑫ 回滾後:逾期乾淨單期限後補登也恢復成拒" "$(R b2 state)" "P0001"
C40="$(Q "SELECT public.zz_mk_cust()")"; O40="$(Q "SELECT public.zz_mk_order('$C40', 'bank_transfer', NULL)")"
pay b3 "$O40" "$(uuid)" bank_transfer $AMT "now() - interval '1 minute'" >/dev/null
cell "⑫ 回滾後:一般未取消單收款照常" "$(R b3 state)" "OK"
Q "UPDATE public.orders SET payment_status = 'unpaid' WHERE id = '$O2'" >/dev/null
pay b4 "$O2" "$K2" bank_transfer $AMT "$(due "$O2")" >/dev/null
cell "⑫ 回滾後:期限後那筆原封重送被拒,而收款列確實在(拒 ≠ 沒入帳)" "$(R b4 state)/$(cnt "public.order_payments WHERE order_id='$O2' AND request_id='$K2'")" "P0001/1"
P -c "DO \$\$ BEGIN EXECUTE replace((SELECT def FROM public.zz_saved WHERE name = 'amounts'), 'WITH net AS', 'WITH  net AS'); END \$\$;" >/dev/null
cell "⑫ 前置閘判別力:依賴鏈換代(pcm_pending_refund_amounts)⇒ 前置閘③擋下" "$(P -f "$MIG" 2>&1 | grep -c '前置閘③')" "1"
restore amounts
P -f "$DOWNA" >/dev/null 2>&1; cell "⑫ 再回滾前一片(沒有人呼叫 helper 了)rc" "$?" "0"

echo
if [ "$FAIL" = "0" ]; then echo "✅ 20260915234000-verify:$N/$N PASS"; else echo "🔴 20260915234000-verify:有 FAIL"; fi
exit "$FAIL"
