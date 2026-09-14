-- 20260914040000-rollback.sql —— 退回 20260914040000_m4b_line_friend_and_outbox_channel.sql
--
-- 🔴 先確認沒有呼叫端:grep -rn "line_user_id\|line_friend_at\|channel" apps packages(S2 callback / S3 webhook / S4 sweeper)。
-- 🔴 DROP COLUMN 會把已記的 LINE 好友狀態一起丟;plan §3 說兩欄留著也無害 —— 退不退看 Sean。
-- 🔴 email_outbox 若已有 channel='line' 的列(S4 上線後), DROP 欄之後那些列會被當成 email 再寄一次 ⇒ 先把它們處理掉再退。
-- 本檔零 DELETE。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 🔴 先鎖住 outbox 再檢查(codex R1 must-fix ②):普通 SELECT 不擋 INSERT/UPDATE, 檢查完到 DROP 之間別人可以塞一列 line 進來。
--    SHARE ROW EXCLUSIVE 擋所有寫入、持到 COMMIT;lock_timeout 5s 拿不到就整支退出, 不硬等。
LOCK TABLE public.email_outbox IN SHARE ROW EXCLUSIVE MODE;

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'line_user_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION '退回前置閘:customers.line_user_id 不在 ⇒ 沒貼過 20260914040000, 不必退';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE channel = 'line') THEN
    RAISE EXCEPTION '退回前置閘:email_outbox 還有 channel = line 的列, 退回後它們會被當 email 重寄 ⇒ 先處理再退';
  END IF;
END
$pre$;

DROP INDEX IF EXISTS public.customers_line_user_id_key;
ALTER TABLE public.customers DROP COLUMN line_friend_at, DROP COLUMN line_user_id;
ALTER TABLE public.email_outbox DROP COLUMN channel;

-- authenticated 的 SELECT 貼回原本的整表形狀(`20260523034911:230`)。
-- 🔴 逐欄的 grant 要另外收(codex R1 nit ⑤):整表 REVOKE 不會把逐欄授權拿掉, 留著 = ACL 與原本不同形狀。
REVOKE SELECT (user_id, email, name, phone, birthday, tier, wallet_balance, total_deposit, created_at, updated_at, gender)
  ON TABLE public.customers FROM authenticated;
REVOKE SELECT ON TABLE public.customers FROM authenticated;
GRANT SELECT ON TABLE public.customers TO authenticated;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname IN ('line_user_id', 'line_friend_at') AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.email_outbox'::regclass AND attname = 'channel' AND NOT attisdropped) THEN
    RAISE EXCEPTION '退回後置閘:欄還在';
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.customers', 'SELECT') THEN
    RAISE EXCEPTION '退回後置閘:authenticated 的整表 SELECT 沒貼回來';
  END IF;
END
$post$;

COMMIT;
