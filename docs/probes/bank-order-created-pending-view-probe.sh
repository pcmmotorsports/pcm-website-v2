#!/bin/bash
# 拋棄式 PG 探針 · 貼板 45 的三支 view(150000 base / 160000 member 新版 / 170000 email 掃描面)
#
# 🔴 **它證什麼**:三支照順序 apply 得起來 · 述詞真的在篩 · 突變殺得到該殺的格 ·
#    member 新版的欄名逐字不變 · 規則只剩一份。
# 🛑 **它【證不到】什麼**(寫在前面, 不寫在腳註):
#    · ⛔ ~~這裡沒有 Supabase 的角色 ⇒ ACL 那幾道事後閘跑不到~~
#      🔴 **那句是我沒建角色, 不是本機做不到**(第一發實測 `role "anon" does not exist`)——
#      建了三個角色之後, migration 裡的 ACL 事後閘**真的會跑**。
#      ⚠️ 而它仍**證不到**正式庫的 RLS 與 PostgREST 可達性:這裡的角色沒有 Supabase 的預設授權。
#    · 列層 own-only 用一個 stub `auth.uid()` 驗(格 16/17)。
#    · 它證不到正式庫的 PostgREST 可達性, 也證不到「寄出當下條件還成立」(那是碼那一半)。
# 🛑 rc 由讀數決定(FAILED > 0 ⇒ exit 1), 不是由「跑完了」決定。

set -u
export LC_ALL=C LANG=C
D=$(mktemp -d); P=54362
export PGHOST="$D" PGPORT="$P" PGDATABASE=postgres
trap 'pg_ctl -D "$D/pg" -w stop >/dev/null 2>&1; rm -rf "$D"' EXIT

M="/Users/sean_1/pcm-wt-mail/supabase/migrations"
initdb -D "$D/pg" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -h '' -p $P" -l "$D/log" -w start >/dev/null 2>&1 || { echo "🔴 PG 起不來"; exit 2; }

PASS=0; FAILED=0
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "🟢 $1  ($2)"
  else FAILED=$((FAILED+1)); echo "🔴 $1  期望[$3] 實得[$2]"; fi
}
Q() { psql -U postgres -At -X -c "$1" 2>/dev/null; }

# ── fixture ────────────────────────────────────────────────────────
psql -U postgres -q -X -v ON_ERROR_STOP=1 > "$D/fx.log" 2>&1 <<'SQL'
-- 🔴 Supabase 的三個角色 —— 少了它們 migration 的 REVOKE/GRANT 會 ERROR
--    (第一發實測:`role "anon" does not exist` ⇒ 本探針的檔頭原本說「ACL 跑不到」是【我沒建角色】,
--     不是「本機做不到」⇒ 建了之後 ACL 那幾道事後閘【真的會跑】。)
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- stub:探針用它切換「現在是誰在看」
CREATE TABLE auth.whoami (id uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM auth.whoami LIMIT 1 $$;

CREATE TABLE public.customers (user_id uuid PRIMARY KEY, email text);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id text NOT NULL,
  customer_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  total integer NOT NULL,
  payment_status text NOT NULL DEFAULT 'unpaid',
  payment_channel text NOT NULL DEFAULT 'tappay',
  order_source text NOT NULL DEFAULT 'web',
  manual_request_id uuid,
  cancelled_at timestamptz,
  notification_email text
);
CREATE TABLE public.order_refunds (order_id uuid, status text);
CREATE TABLE public.order_manual_refunds (order_id uuid, voided_at timestamptz);
CREATE VIEW public.order_paid_totals_v AS
  SELECT o.id AS order_id, 0::integer AS paid_total FROM public.orders o;
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid, event_type text NOT NULL, dedup_key text NOT NULL,
  CONSTRAINT email_outbox_event_type_check CHECK (event_type IN (
    'order_created','order_shipped','order_cancelled','order_unpaid_cancelled','shipment_tracking_corrected'))
);
CREATE FUNCTION public.pcm_js_trim_whitespace() RETURNS text LANGUAGE sql IMMUTABLE AS $fx$
  SELECT E' \t\n\r\f'
$fx$;
-- 上一代 member view(= 20260905330000 的形狀, 探針只需要它的語意特徵在)
CREATE VIEW public.member_order_balance_v
  WITH (security_invoker = false, security_barrier = true) AS
SELECT o.id AS order_id,
  CASE WHEN EXISTS (SELECT 1 FROM public.order_refunds rf WHERE rf.order_id = o.id AND rf.status = 'confirmed')
         OR EXISTS (SELECT 1 FROM public.order_manual_refunds mr WHERE mr.order_id = o.id AND mr.voided_at IS NULL)
       THEN NULL ELSE o.total - COALESCE(p.paid_total, 0) END AS balance_due
FROM public.orders o
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id
WHERE o.customer_user_id = auth.uid();
SQL
chk "00 fixture 建起來" "$?" "0"
[ "$FAILED" = "0" ] || { cat "$D/fx.log"; echo "PASSED=$PASS FAILED=$FAILED"; exit 1; }

# ── 依序 apply 四支 ─────────────────────────────────────────────────
for V in 20260906140000_m4b_outbox_bank_order_created_event \
         20260906150000_m4b_order_balance_base_v \
         20260906160000_m4b_member_balance_from_base \
         20260906170000_m4b_bank_order_created_pending_view; do
  psql -U postgres -q -X -v ON_ERROR_STOP=1 -f "$M/$V.sql" > "$D/$V.log" 2>&1
  chk "01 apply $V" "$?" "0"
  if [ "$FAILED" != "0" ]; then echo "--- $V ---"; cat "$D/$V.log"; echo "PASSED=$PASS FAILED=$FAILED"; exit 1; fi
done

# ── 🔴 順序守門:170000 在 150000 之前跑要被擋(用另一個 schema 演不到, 改驗前置閘存在)
chk "02 170000 帶著「150000 還沒貼」的前置閘" \
    "$(grep -c '20260906150000 還沒貼' "$M/20260906170000_m4b_bank_order_created_pending_view.sql")" "1"
chk "02b 160000 帶著同一道" \
    "$(grep -c '20260906150000 還沒貼' "$M/20260906160000_m4b_member_balance_from_base.sql")" "1"

# ── 資料:六個世界 ───────────────────────────────────────────────────
psql -U postgres -q -X >/dev/null 2>&1 <<'SQL'
INSERT INTO auth.users(id) VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO public.customers(user_id,email) VALUES ('11111111-1111-1111-1111-111111111111','buyer@example.com');
-- ① 該寄:web 匯款單, unpaid, 未取消, 有餘額, 有信箱
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001','PCM-1','11111111-1111-1111-1111-111111111111',5000,'bank_transfer');
-- ② 刷卡單
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel) VALUES
  ('aaaaaaa2-0000-0000-0000-000000000002','PCM-2','11111111-1111-1111-1111-111111111111',5000,'tappay');
-- ③ 已取消的匯款單
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel,cancelled_at) VALUES
  ('aaaaaaa3-0000-0000-0000-000000000003','PCM-3','11111111-1111-1111-1111-111111111111',5000,'bank_transfer',now());
-- ④ 後台手動匯款單(order_source 是 manual_phone 而且有 manual_request_id)
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel,order_source,manual_request_id) VALUES
  ('aaaaaaa4-0000-0000-0000-000000000004','PCM-4','11111111-1111-1111-1111-111111111111',5000,'bank_transfer','manual_phone','bbbbbbb4-0000-0000-0000-000000000004');
-- ⑤ order_source 是 web 而 manual_request_id 非 NULL(第二條述詞單獨要擋的那個)
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel,manual_request_id) VALUES
  ('aaaaaaa5-0000-0000-0000-000000000005','PCM-5','11111111-1111-1111-1111-111111111111',5000,'bank_transfer','bbbbbbb5-0000-0000-0000-000000000005');
-- ⑥ 有 confirmed 退款 ⇒ base 回 NULL ⇒ 不寄
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel) VALUES
  ('aaaaaaa6-0000-0000-0000-000000000006','PCM-6','11111111-1111-1111-1111-111111111111',5000,'bank_transfer');
INSERT INTO public.order_refunds(order_id,status) VALUES ('aaaaaaa6-0000-0000-0000-000000000006','confirmed');
-- ⑦ 兩個信箱都空
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel) VALUES
  ('aaaaaaa7-0000-0000-0000-000000000007','PCM-7',NULL,5000,'bank_transfer');
-- ⑧ 已排過信
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel) VALUES
  ('aaaaaaa8-0000-0000-0000-000000000008','PCM-8','11111111-1111-1111-1111-111111111111',5000,'bank_transfer');
INSERT INTO public.email_outbox(order_id,event_type,dedup_key) VALUES
  ('aaaaaaa8-0000-0000-0000-000000000008','bank_order_created','aaaaaaa8-0000-0000-0000-000000000008');
-- ⑨ 已付款
INSERT INTO public.orders(id,display_id,customer_user_id,total,payment_channel,payment_status) VALUES
  ('aaaaaaa9-0000-0000-0000-000000000009','PCM-9','11111111-1111-1111-1111-111111111111',5000,'bank_transfer','paid');
SQL

IN_VIEW="SELECT count(*) FROM public.pcm_bank_order_created_email_pending WHERE order_id="
chk "03 🟢 該寄的那張【在】(正對照 —— 沒有它, 下面每個 0 都證不到事)" "$(Q "${IN_VIEW}'aaaaaaa1-0000-0000-0000-000000000001'")" "1"
chk "04 刷卡單 不在"                 "$(Q "${IN_VIEW}'aaaaaaa2-0000-0000-0000-000000000002'")" "0"
chk "05 已取消 不在"                 "$(Q "${IN_VIEW}'aaaaaaa3-0000-0000-0000-000000000003'")" "0"
chk "06 後台手動單 不在"             "$(Q "${IN_VIEW}'aaaaaaa4-0000-0000-0000-000000000004'")" "0"
chk "07 web 而有 manual_request_id 不在" "$(Q "${IN_VIEW}'aaaaaaa5-0000-0000-0000-000000000005'")" "0"
chk "08 🔴 有退款(餘額算不出來)不在" "$(Q "${IN_VIEW}'aaaaaaa6-0000-0000-0000-000000000006'")" "0"
chk "09 兩個信箱都空 不在"           "$(Q "${IN_VIEW}'aaaaaaa7-0000-0000-0000-000000000007'")" "0"
chk "10 已排過信 不在"               "$(Q "${IN_VIEW}'aaaaaaa8-0000-0000-0000-000000000008'")" "0"
chk "11 已付款 不在"                 "$(Q "${IN_VIEW}'aaaaaaa9-0000-0000-0000-000000000009'")" "0"
chk "12 全表就那一列"                "$(Q "SELECT count(*) FROM public.pcm_bank_order_created_email_pending")" "1"

# ── member 新版:欄名不變 + own-only 列層 + 規則只剩一份 ──────────────
chk "13 member 欄名逐字不變" \
    "$(Q "SELECT string_agg(attname,',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.member_order_balance_v'::regclass AND attnum>0 AND NOT attisdropped")" \
    "order_id,balance_due"
chk "14 member 新體是從 base 讀的" \
    "$(Q "SELECT (strpos(definition,'order_balance_base_v')>0)::text FROM pg_views WHERE viewname='member_order_balance_v'")" "true"
chk "15 🔴 規則沒有留第二份(member 體裡看不到算式原料)" \
    "$(Q "SELECT (strpos(definition,'order_manual_refunds')>0 OR strpos(definition,'order_paid_totals_v')>0)::text FROM pg_views WHERE viewname='member_order_balance_v'")" "false"
psql -U postgres -q -X -c "INSERT INTO auth.whoami(id) VALUES ('11111111-1111-1111-1111-111111111111')" >/dev/null 2>&1
chk "16 own-only:是我 ⇒ 看得到自己的單(正對照)" \
    "$(Q "SELECT count(*) FROM public.member_order_balance_v WHERE order_id='aaaaaaa1-0000-0000-0000-000000000001'")" "1"
psql -U postgres -q -X -c "UPDATE auth.whoami SET id='99999999-9999-9999-9999-999999999999'" >/dev/null 2>&1
chk "17 own-only:換一個人 ⇒ 看不到(尺會動)" \
    "$(Q "SELECT count(*) FROM public.member_order_balance_v")" "0"
psql -U postgres -q -X -c "UPDATE auth.whoami SET id='11111111-1111-1111-1111-111111111111'" >/dev/null 2>&1
chk "18 🔴 base view 沒有 own-only(它就是為了這個而存在)" \
    "$(Q "SELECT (strpos(definition,'uid()')>0)::text FROM pg_views WHERE viewname='order_balance_base_v'")" "false"
chk "19 base 看得到【別人的】單(而 member 看不到)" \
    "$(Q "SELECT count(*) FROM public.order_balance_base_v WHERE order_id='aaaaaaa7-0000-0000-0000-000000000007'")" "1"

# ══════════════════════════════════════════════════════════════════
# 🧬 突變:每一發殺【不同】的格
# ══════════════════════════════════════════════════════════════════
mut() { # $1=名稱 $2=改過的 WHERE 片段要拿掉的那一條 $3=期望變化後的列數
  psql -U postgres -q -X >/dev/null 2>&1 -c "CREATE OR REPLACE VIEW public.mutv AS $2"
  chk "🧬 $1" "$(Q "SELECT count(*) FROM public.mutv")" "$3"
}
BASE_SEL="SELECT o.id FROM public.orders o JOIN public.order_balance_base_v bal ON bal.order_id=o.id LEFT JOIN public.customers c ON c.user_id=o.customer_user_id WHERE o.payment_channel='bank_transfer' AND o.payment_status='unpaid' AND o.cancelled_at IS NULL"
mut "20 拿掉 order_source/manual 兩條 ⇒ 手動單漏進來(1 ⇒ 3)" \
    "$BASE_SEL AND bal.balance_due>0 AND NOT EXISTS (SELECT 1 FROM public.email_outbox e WHERE e.order_id=o.id AND e.event_type='bank_order_created') AND (nullif(btrim(o.notification_email, public.pcm_js_trim_whitespace()),'') IS NOT NULL OR nullif(btrim(c.email, public.pcm_js_trim_whitespace()),'') IS NOT NULL)" "3"
mut "21 拿掉 balance_due>0 ⇒ 退款單漏進來" \
    "$BASE_SEL AND o.order_source='web' AND o.manual_request_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.email_outbox e WHERE e.order_id=o.id AND e.event_type='bank_order_created') AND (nullif(btrim(o.notification_email, public.pcm_js_trim_whitespace()),'') IS NOT NULL OR nullif(btrim(c.email, public.pcm_js_trim_whitespace()),'') IS NOT NULL)" "2"
mut "22 拿掉信箱那條 ⇒ 沒有收件人的單漏進來" \
    "$BASE_SEL AND o.order_source='web' AND o.manual_request_id IS NULL AND bal.balance_due>0 AND NOT EXISTS (SELECT 1 FROM public.email_outbox e WHERE e.order_id=o.id AND e.event_type='bank_order_created')" "2"
mut "23 拿掉 anti-join ⇒ 已寄過的又進來" \
    "$BASE_SEL AND o.order_source='web' AND o.manual_request_id IS NULL AND bal.balance_due>0 AND (nullif(btrim(o.notification_email, public.pcm_js_trim_whitespace()),'') IS NOT NULL OR nullif(btrim(c.email, public.pcm_js_trim_whitespace()),'') IS NOT NULL)" "2"

echo "PASSED=$PASS FAILED=$FAILED"
[ "$FAILED" = "0" ] || exit 1
