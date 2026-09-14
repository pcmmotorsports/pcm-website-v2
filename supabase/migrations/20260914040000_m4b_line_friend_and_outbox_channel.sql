-- 20260914040000_m4b_line_friend_and_outbox_channel.sql —— LINE 好友狀態(customers 兩欄)+ 通知管道(email_outbox.channel)
--
-- 🛑 未貼(寫好不貼;貼是 Sean 一次一個編號)。plan `docs/plans/2026-09-14-line-friend-and-order-push-plan.md` §1-2 / §1-3, 切片 S1。
--
-- ══ Sean 拍的 ══════════════════════════════════════════════
-- 2026-09-14 逐字「我們 LINE 登入可以做到順便加官方帳號為好友,然後就可以記錄在我們系統裡面,這樣我們可以發送訊息給客人?
-- 我希望之後可以做到訂單確認發送通知」;Q9 甲 / Q10 甲 / Q11 乙。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- · `customers.line_user_id text UNIQUE`(可空;LINE 登入 callback 寫, S2 A 窗)
-- · `customers.line_friend_at timestamptz`(可空;webhook follow 寫 / unfollow 清, S3 B 窗)
-- · `email_outbox.channel text NOT NULL DEFAULT 'email' CHECK IN ('email','line')`(不開新表, plan §2 案 A;S4 施工窗的 sweeper 分支寫 'line')
--
-- ══ 權限:client 不讀這兩欄 ═══════════════════════════════════════
-- customers 今天給 authenticated 的是【整表】SELECT(`20260523034911:230`)⇒ 加欄之後 authenticated 自動讀得到新欄。
-- 🔴 `line_user_id` 是 LINE 的識別碼, 不該到瀏覽器 ⇒ 改成【逐欄】SELECT(今天那 11 欄, 一欄不多一欄不少), 新兩欄不在裡面。
--    PG 沒有「從整表 grant 裡 REVOKE 一欄」這種事 —— 只能收整表再逐欄給。
--    🔬 storefront / adapters 對 customers 的每一發 select 都是逐欄列名(`checkout/page.tsx:63` / `account/page.tsx:282` /
--       `tier.ts:111` / `SupabaseWalletAdapter.ts:128` / `SupabaseCustomerAdapter.ts` CUSTOMER_SELECT), 零 `select('*')`
--       ⇒ 逐欄 grant 不會讓任何一發讀取變成 permission denied。依賴 customers 的 12 支 view 都沒 grant 給 authenticated。
-- · authenticated 的 UPDATE 本來就是逐欄(name/phone/birthday/updated_at + 後來的 gender), 不動。
-- · email_outbox 只有 service_role 讀寫(RLS 三條 policy 都 service_role), 加欄零權限變化。
-- · service_role / postgres 整表 grant ⇒ 新欄自動有。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- `supabase/rollbacks/20260914040000-rollback.sql`:三欄 DROP、authenticated 整表 SELECT 貼回。
-- plan §3:兩欄留著也無害(可空無人讀), 退不退看 Sean。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.customers') IS NULL OR pg_catalog.to_regclass('public.email_outbox') IS NULL THEN
    RAISE EXCEPTION '前置閘一:customers / email_outbox 不在 ⇒ 這台庫不是我以為的形狀';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'line_user_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘二:customers.line_user_id 已經在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.email_outbox'::regclass AND attname = 'channel' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘三:email_outbox.channel 已經在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  -- 今天 customers 給 authenticated 的是整表 SELECT(要換成逐欄的基準);逐欄清單 = 現在的 11 欄
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.customers', 'SELECT') THEN
    RAISE EXCEPTION '前置閘四:authenticated 今天沒有 customers 的 SELECT ⇒ 權限形狀不是我以為的, 停下人工對齊';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'public.customers'::regclass AND attnum > 0 AND NOT attisdropped) <> 11 THEN
    RAISE EXCEPTION '前置閘五:customers 不是 11 欄 ⇒ 下面逐欄 grant 的清單會漏欄, 停下人工對齊';
  END IF;
END
$pre$;

-- ── 1. customers 兩欄 ─────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN line_user_id text,
  ADD COLUMN line_friend_at timestamptz;
-- UNIQUE 走 partial index:NULL 不撞(多數客人沒 LINE);同一個 LINE 帳號不得綁兩個客人。
CREATE UNIQUE INDEX customers_line_user_id_key ON public.customers (line_user_id) WHERE line_user_id IS NOT NULL;
COMMENT ON COLUMN public.customers.line_user_id IS 'LINE userId(U 開頭 33 字);LINE 登入 callback 寫(20260914040000);client 讀不到(逐欄 grant 不含它)';
COMMENT ON COLUMN public.customers.line_friend_at IS '加官方帳號好友的時刻;webhook follow 寫、unfollow 清成 NULL;NULL = 不是好友 ⇒ 推不了';

-- ── 2. authenticated:整表 SELECT → 逐欄 SELECT(今天那 11 欄, 新兩欄不給)─────────
-- ACL-GATE-EXEMPT: public.customers -- 登入客人讀自己那一列(RLS customers_select_own, 20260523034911:146);這一行是【收窄】:把整表 SELECT 換成 11 欄逐欄, 新的 line_user_id / line_friend_at 不給;同檔事後閘 ② 逐欄斷言(2026-09-14 S1)
REVOKE SELECT ON TABLE public.customers FROM authenticated;
GRANT SELECT (user_id, email, name, phone, birthday, tier, wallet_balance, total_deposit, created_at, updated_at, gender)
  ON TABLE public.customers TO authenticated;
REVOKE ALL ON TABLE public.customers FROM anon;
-- 🔴 service_role 對 customers 的 UPDATE 是【逐欄】的(`20260717010000:174` 收掉整表 UPDATE, 之後只逐欄補 gender / email)
--    ⇒ 不給的話 S2 callback 寫 line_user_id、S3 webhook 寫 line_friend_at 都 permission denied(codex 2026-09-14 R1 must-fix ①)。
GRANT UPDATE (line_user_id, line_friend_at) ON TABLE public.customers TO service_role;

-- ── 3. email_outbox.channel ────────────────────────────────────────
ALTER TABLE public.email_outbox
  ADD COLUMN channel text NOT NULL DEFAULT 'email'
  CONSTRAINT email_outbox_channel_domain CHECK (channel IN ('email', 'line'));
COMMENT ON COLUMN public.email_outbox.channel IS '這一列走哪個管道:email(Resend)/ line(Messaging API push;S4 sweeper 對合成信箱 + LINE 好友走這條);plan 2026-09-14 §2 案 A 不開新表';

-- ── 事後閘 ────────────────────────────────────────────────────
DO $assert$
DECLARE
  v_bad text := NULL;
  v_relations text[] := ARRAY['public.customers', 'public.email_outbox']::text[];
  r text;
BEGIN
  -- ① 三欄在
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'line_user_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'line_friend_at' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.email_outbox'::regclass AND attname = 'channel' AND NOT attisdropped) THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, '三欄沒有全部建起來');
  END IF;
  -- ② 🔴 authenticated 讀不到 line_user_id / line_friend_at(主視窗指定的斷言), 而舊 11 欄照舊讀得到
  IF pg_catalog.has_column_privilege('authenticated', 'public.customers', 'line_user_id', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.customers', 'line_friend_at', 'SELECT') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'authenticated 讀得到 line_user_id / line_friend_at');
  END IF;
  IF NOT (pg_catalog.has_column_privilege('authenticated', 'public.customers', 'tier', 'SELECT')
          AND pg_catalog.has_column_privilege('authenticated', 'public.customers', 'wallet_balance', 'SELECT')
          AND pg_catalog.has_column_privilege('authenticated', 'public.customers', 'gender', 'SELECT')
          AND pg_catalog.has_column_privilege('authenticated', 'public.customers', 'email', 'SELECT')) THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'authenticated 舊欄的 SELECT 掉了(逐欄清單漏欄)');
  END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.customers', 'line_friend_at', 'UPDATE')
     OR pg_catalog.has_column_privilege('authenticated', 'public.customers', 'line_user_id', 'UPDATE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'authenticated 改得到 line 欄');
  END IF;
  -- service_role 寫得到兩新欄(S2 / S3 的寫入路), 而 tier / wallet_balance 那些敏感舊欄仍不是本檔給的
  IF NOT (pg_catalog.has_column_privilege('service_role', 'public.customers', 'line_user_id', 'UPDATE')
          AND pg_catalog.has_column_privilege('service_role', 'public.customers', 'line_friend_at', 'UPDATE')) THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'service_role 改不了 line 欄(S2 / S3 會 permission denied)');
  END IF;
  -- ③ anon 一欄都讀不到;service_role 讀得到新欄
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT') OR pg_catalog.has_any_column_privilege('anon', r, 'SELECT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon 讀得到');
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 沒有 SELECT');
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = r::regclass) THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':RLS 沒開');
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('authenticated', 'public.email_outbox', 'SELECT') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'email_outbox:authenticated 讀得到');
  END IF;
  -- ④ channel 的 CHECK 真的擋:塞一筆【其他欄都合法】的壞值(event_type 用真值, 不然既有 event_type CHECK 先擋 = 假綠;
  --    codex R1 nit ③), 只有「被擋的是 email_outbox_channel_domain」算過 —— CHECK 在 FK 之前評估, 所以 FK 炸 = CHECK 放行了。
  DECLARE
    v_con text;
  BEGIN
    INSERT INTO public.email_outbox (event_type, dedup_key, order_id, recipient_email, subject, payload, channel)
      VALUES ('order_created', 'zzz_probe_' || pg_catalog.gen_random_uuid()::text, pg_catalog.gen_random_uuid(),
              'zzz@probe.invalid', 'zzz', '{}'::jsonb, 'sms');
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'channel CHECK 沒擋住 sms(寫進去了)');
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con <> 'email_outbox_channel_domain' THEN
        v_bad := pg_catalog.concat_ws(' | ', v_bad, '擋住 sms 的不是 channel 那條 CHECK, 是 ' || v_con);
      END IF;
    WHEN foreign_key_violation THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, 'channel CHECK 放行了 sms(才輪到 FK 擋)');
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.email_outbox'::regclass AND conname = 'email_outbox_channel_domain' AND contype = 'c') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'email_outbox_channel_domain CHECK 不在');
  END IF;
  -- ⑤ 既有列全部是 email(DEFAULT 回填)
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE channel IS DISTINCT FROM 'email') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, '既有 outbox 列有非 email 的 channel');
  END IF;
  -- ⑥ UNIQUE partial index 在
  IF pg_catalog.to_regclass('public.customers_line_user_id_key') IS NULL THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'customers_line_user_id_key 不在');
  END IF;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:%', v_bad;
  END IF;
  RAISE NOTICE 'S1 貼好了:customers.line_user_id / line_friend_at(authenticated 讀不到)+ email_outbox.channel(DEFAULT email)。';
END $assert$;

COMMIT;
