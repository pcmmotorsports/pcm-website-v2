-- 20260927120000_m4b_admin_save_manual_order_address.sql —— 後台手動建單後,把收件地址存進客人地址簿
-- pcm:idempotent: yes
--   ↑ 重跑同形:函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定,前置閘之前本庫查無此名。
-- ACL-GATE-EXEMPT: public.admin_save_manual_order_address -- SECURITY DEFINER owner RPC,只給 service_role EXECUTE(後台建單 server action 以 service_role 呼叫);anon / authenticated 全收(同 20260927060000)。
--
-- 🛑 未貼。只做不貼,貼的人是 Sean(或他明文授權的那一次)。
--    plan:~/pcm-mailbox/計畫-手動建單地址存進客人地址簿-20260927.md(Sean 2026-09-27 三題全甲)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 2026-09-27:「手動訂單建立客人後有輸入地址,但地址沒有存到客人資訊裡,再建訂單就沒有地址」。
-- 客人地址簿是 customer_addresses(20260523034911:40,前台「我的地址」同一張),而後台從來不寫它 ——
-- Sean 2026-08-28 Q-建單2 甲 已經要「建單時順手存進地址簿」(manual-order-form.ts:150「片乙」),一直沒做。
-- 🔴 不在 app 層直接寫表:20260905190000(b9-RLSHARDEN)記錄「service_role 對地址簿零寫入」,
--    地址簿上刻意沒有給 service_role 的寫入政策 ⇒ 走 SECURITY DEFINER 函式(owner 寫)+ 同交易稽核。
-- 🔴 不改 admin_create_manual_order(碰錢,鐵則 12):建單成功後另外呼叫本支;本支失敗不影響訂單。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_save_manual_order_address(p_order_id, p_actor, p_request_id) RETURNS text
--   · 操作人必須是在職員工(staff.is_active,照 20260927060000),否則 RAISE '無權執行此操作'
--   · 只處理後台手動單(order_source 是 manual_ 開頭);其他 ⇒ 'SKIPPED'
--   · 地址取訂單的 shipping_address_snapshot {name, phone, line}(admin_create_manual_order 已去前後空白);三格缺一 ⇒ 'SKIPPED'
--   · 同一位客人同時兩張單 ⇒ advisory 鎖(客人 id)排隊,避免重複新增、避免兩筆都當預設
--   · 地址簿已有「姓名、電話、地址去掉前後空白後都相同」的那一筆 ⇒ 只更新 updated_at(= 最近用過)、回 'EXISTS'、不寫稽核(資料沒變)
--   · 沒有 ⇒ 新增一筆;客人原本一筆地址都沒有 ⇒ 設為預設(Sean Q3 甲),否則不動客人自己選的預設;
--     同交易寫 admin_audit_log('customer.address.save_from_order', target 'customer:<id>');回 'INSERTED'
--   · 訂單不存在 ⇒ 'NOT_FOUND'
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 只建一支函式,不動表、不鎖表 ⇒ 任何時段都可以貼。
-- · 🔴 照 CLAUDE.md〈貼板與推的順序〉:本支【先貼】,後台那顆碼才合 dev(新 RPC ⇒ 部署時序閘會擋)。
--   (萬一順序錯了:碼先上時呼叫會 PGRST202 ⇒ 建單照樣成功,畫面多一句「無法確認地址是否已存進客人資料」——
--    那是保底,不是可以先上的理由。Codex R1 nit 1)
-- · 回滾:supabase/rollbacks/20260927120000-rollback.sql(DROP FUNCTION)。已存進地址簿的地址留著(稽核可查)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在';
  END IF;
  IF pg_catalog.to_regclass('public.customer_addresses') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.customer_addresses 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘失敗 — staff.is_active 不存在(在職員工檢查需要它)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.orders'::regclass AND NOT attisdropped
         AND attname IN ('customer_user_id', 'shipping_address_snapshot', 'order_source')) <> 3 THEN
    RAISE EXCEPTION '前置閘失敗 — orders 缺 customer_user_id / shipping_address_snapshot / order_source';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_save_manual_order_address(
  p_order_id   uuid,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_customer  uuid;
  v_snap      jsonb;
  v_source    text;
  v_name      text;
  v_phone     text;
  v_line      text;
  v_existing  uuid;
  v_default   boolean;
  v_new_id    uuid;
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析,缺 ⇒ 拒,不以未知身分寫稽核)
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_save_manual_order_address: 缺 order_id';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_save_manual_order_address: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_save_manual_order_address: 缺 request_id';
  END IF;

  -- 1b. 在職員工(照 20260927060000)
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 1c. 讀訂單
  SELECT o.customer_user_id, o.shipping_address_snapshot, o.order_source
    INTO v_customer, v_snap, v_source
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_customer IS NULL OR v_source IS NULL OR v_source NOT LIKE 'manual\_%' THEN
    RETURN 'SKIPPED';
  END IF;

  v_name  := pg_catalog.btrim(COALESCE(v_snap ->> 'name', ''));
  v_phone := pg_catalog.btrim(COALESCE(v_snap ->> 'phone', ''));
  v_line  := pg_catalog.btrim(COALESCE(v_snap ->> 'line', ''));
  IF v_name = '' OR v_phone = '' OR v_line = '' THEN
    RETURN 'SKIPPED';
  END IF;

  -- 1d. 同一位客人排隊:避免兩張單同時各新增一筆、或兩筆都當預設(交易結束自動放)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('admin_save_manual_order_address:' || v_customer::text));

  -- 1e. 已有相同的一筆 ⇒ 只標「最近用過」
  SELECT a.id INTO v_existing
    FROM public.customer_addresses a
   WHERE a.customer_user_id = v_customer
     AND pg_catalog.btrim(a.name) = v_name
     AND pg_catalog.btrim(COALESCE(a.phone, '')) = v_phone
     AND pg_catalog.btrim(a.line) = v_line
   ORDER BY a.updated_at DESC, a.id
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.customer_addresses SET updated_at = pg_catalog.now() WHERE id = v_existing;
    RETURN 'EXISTS';
  END IF;

  -- 1f. 新增;客人原本沒有任何地址 ⇒ 這筆當預設(Sean Q3 甲)
  -- 🔴 顧客站寫地址不拿上面那把 advisory 鎖(Codex R1 建議 1):客人剛好同時在前台新增第一筆預設地址
  --    ⇒ 撞 customer_addresses_one_default_per_customer ⇒ 改存成非預設,不讓整支失敗(預設由客人那筆當)
  v_default := NOT EXISTS (SELECT 1 FROM public.customer_addresses a WHERE a.customer_user_id = v_customer);
  BEGIN
    INSERT INTO public.customer_addresses (customer_user_id, is_default, name, phone, line)
    VALUES (v_customer, v_default, v_name, v_phone, v_line)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    IF NOT v_default THEN
      RAISE;
    END IF;
    v_default := false;
    INSERT INTO public.customer_addresses (customer_user_id, is_default, name, phone, line)
    VALUES (v_customer, false, v_name, v_phone, v_line)
    RETURNING id INTO v_new_id;
  END;

  -- 1g. 同交易寫稽核
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'customer.address.save_from_order',
    'customer:' || v_customer::text,
    NULL,
    pg_catalog.jsonb_build_object(
      'address_id', v_new_id, 'order_id', p_order_id,
      'name', v_name, 'phone', v_phone, 'line', v_line, 'is_default', v_default
    ),
    NULL,
    p_request_id,
    'admin'
  );

  RETURN 'INSERTED';
END;
$fn$;

COMMENT ON FUNCTION public.admin_save_manual_order_address(uuid, text, text) IS
  '後台手動建單後把收件地址存進客人地址簿(20260927120000;Sean 2026-08-28 Q-建單2 甲、2026-09-27 三題全甲)。'
  '只處理 manual_ 開頭的單;相同地址 ⇒ 只更新 updated_at(EXISTS);否則新增(客人原本沒有地址才設預設)並同交易寫 admin_audit_log。'
  '回 INSERTED / EXISTS / SKIPPED / NOT_FOUND。SECURITY DEFINER,search_path 空字串;EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_save_manual_order_address(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_manual_order_address(uuid, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_save_manual_order_address(uuid, text, text)']::text[];
  v_fn  oid;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'admin_save_manual_order_address:函式沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_save_manual_order_address:anon / authenticated 仍可 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_save_manual_order_address:service_role 沒有 EXECUTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'admin_save_manual_order_address:不是 SECURITY DEFINER 或 search_path 不是空字串';
  END IF;
  RAISE NOTICE '✅ admin_save_manual_order_address:函式在、只有 service_role 可執行、SECURITY DEFINER + search_path 空字串';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
