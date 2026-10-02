-- 20261002210000_m4b_admin_set_manual_product_images.sql —— 後台「新增商品」建的商品(supplier_slug = 'pcm'),照片寫回網站
-- ACL-GATE-EXEMPT: public.admin_set_manual_product_images -- SECURITY DEFINER owner RPC,只給 service_role EXECUTE(後台 server action 以 service_role 呼叫);anon / authenticated 全收(同 20260927060000 admin_set_product_override)。
--
-- 🛑 未貼。只寫不貼,貼的人是 Sean(或他明文授權的那一次)。
--    plan:~/pcm-mailbox/計畫-手動商品照片寫回網站-20261002.md(Sean 2026-10-02 Q1 甲批,主視窗 pcm-website-v2-ce 轉派)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- 手動商品的照片只存在報價單共用圖庫。報價單 products 表刻意沒有 pcm(報價單 20260928100000),
-- 每日同步讀的 storefront_catalog_v 也就沒有它 ⇒ 網站 products.images 永遠是 [](後台摘要卡「沒有代表圖」、顧客站沒圖)。
-- product-repository.ts 的寫入規矩:走 RPC,不在 app 層直接 .update() 表;現有 RPC 沒有一支能寫 images ⇒ 新增這一支。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_set_manual_product_images(p_product_id, p_images, p_actor, p_request_id) RETURNS text
--   · 只收 supplier_slug = 'pcm' 的商品(其他品牌的照片由每日同步寫, 後台寫了也會被蓋回去)⇒ 其餘 RAISE
--   · p_images:jsonb 字串陣列(可以是空的 = 照片全刪了);每個是 https 網址、最長 2048 字、不重複;最多 50 張
--     (網址形狀同報價單圖庫 G2 與後台 gallery-actions.ts isPhotoUrl)
--   · 操作人必須是在職員工(照片區全員可用, Sean C4 甲;寫法照 20260927060000)
--   · 鎖列讀 before → 同值 NO_CHANGE 零寫入零稽核 → UPDATE images → 同交易寫 admin_audit_log('product.images.sync')
--   · 回 UPDATED / NO_CHANGE / NOT_FOUND;參數不合法 ⇒ RAISE
-- 🔵 products 的 content_changed 觸發器會自己更新 content_changed_at,不用在這裡寫。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 只建一支函式,不動表、不鎖表 ⇒ 任何時段都可以貼。
-- · 後台那顆碼要在本支貼完之後才推:碼先上 ⇒ RPC 不存在(PGRST202)⇒ 照片區的操作照常完成(多張上傳也會全部傳完), 只多一句「網站上的照片沒有跟著更新」, 不會寫壞資料。
-- · 回滾:supabase/rollbacks/20261002210000-rollback.sql(DROP FUNCTION;要先退後台碼)。
-- · 驗證:scripts/20261002210000-verify.sh(拋棄式 PG, 非 superuser 貼)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_manual_product_images(uuid, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_set_manual_product_images 已經存在(已貼過?)';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘失敗 — staff.is_active 不存在(在職員工檢查需要它)';
  END IF;
  IF (SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products'::regclass AND a.attname = 'images' AND NOT a.attisdropped) IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION '前置閘失敗 — products.images 不是 jsonb';
  END IF;
END
$pre$;

CREATE FUNCTION public.admin_set_manual_product_images(
  p_product_id uuid,
  p_images     jsonb,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_supplier text;
  v_before   jsonb;
  v_item     jsonb;
  v_url      text;
  v_seen     text[] := ARRAY[]::text[];
BEGIN
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_set_manual_product_images: 缺 actor';
  END IF;
  -- 操作人必須是在職員工(錯誤字面與 20260927060000 相同 ⇒ 後台對應到「沒有權限」)
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_set_manual_product_images: 缺 request_id';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'admin_set_manual_product_images: 缺 product_id';
  END IF;

  -- 照片清單:字串陣列、https、≤ 2048 字、不重複、≤ 50 張
  IF p_images IS NULL OR pg_catalog.jsonb_typeof(p_images) <> 'array' THEN
    RAISE EXCEPTION 'admin_set_manual_product_images: 照片必須是陣列';
  END IF;
  IF pg_catalog.jsonb_array_length(p_images) > 50 THEN
    RAISE EXCEPTION 'admin_set_manual_product_images: 照片最多 50 張';
  END IF;
  FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(p_images) AS t(e) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'string' THEN
      RAISE EXCEPTION 'admin_set_manual_product_images: 每張照片都必須是網址文字';
    END IF;
    v_url := v_item #>> '{}';
    IF v_url !~ '^https://\S+$' OR pg_catalog.char_length(v_url) > 2048 THEN
      RAISE EXCEPTION 'admin_set_manual_product_images: 照片網址必須是 https、最長 2048 字';
    END IF;
    IF v_url = ANY (v_seen) THEN
      RAISE EXCEPTION 'admin_set_manual_product_images: 照片網址重複';
    END IF;
    v_seen := v_seen || v_url;
  END LOOP;

  -- 鎖列 + before(同商品並發序列化;查無 ⇒ 固定碼)
  SELECT p.supplier_slug, p.images INTO v_supplier, v_before
    FROM public.products p
   WHERE p.id = p_product_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_supplier IS DISTINCT FROM 'pcm' THEN
    RAISE EXCEPTION 'admin_set_manual_product_images: 只有後台新增的商品可以從這裡寫照片';
  END IF;

  IF v_before IS NOT DISTINCT FROM p_images THEN
    RETURN 'NO_CHANGE';
  END IF;

  UPDATE public.products
     SET images     = p_images,
         updated_at = pg_catalog.now()
   WHERE id = p_product_id;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'product.images.sync',
    'product:' || p_product_id::text,
    pg_catalog.jsonb_build_object('images', v_before),
    pg_catalog.jsonb_build_object('images', p_images),
    NULL,
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$fn$;

ALTER FUNCTION public.admin_set_manual_product_images(uuid, jsonb, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.admin_set_manual_product_images(uuid, jsonb, text, text) IS
  '手動商品照片寫回網站(20261002210000):只收 supplier_slug = pcm;p_images = 報價單圖庫沒隱藏的照片網址(依順序)。'
  'https、≤ 2048 字、不重複、≤ 50 張;在職員工才能寫。鎖列 → 同值 NO_CHANGE → UPDATE images → 同交易寫 admin_audit_log(product.images.sync)。'
  '回 UPDATED / NO_CHANGE / NOT_FOUND。EXECUTE 僅 service_role。';

-- 兩道 REVOKE(docs/patterns/revoking-function-execute-in-supabase.md §1):PUBLIC 那份與具名授權各收一次
REVOKE ALL ON FUNCTION public.admin_set_manual_product_images(uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_manual_product_images(uuid, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_manual_product_images(uuid, jsonb, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_set_manual_product_images(uuid, jsonb, text, text)']::text[];
  v_fn  oid;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'admin_set_manual_product_images:函式沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_manual_product_images:anon / authenticated 仍可 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_manual_product_images:service_role 沒有 EXECUTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
       AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'admin_set_manual_product_images:不是 SECURITY DEFINER、search_path 不是空字串, 或 owner 不是 postgres';
  END IF;
  RAISE NOTICE '✅ admin_set_manual_product_images:函式在、只有 service_role 可執行、SECURITY DEFINER + search_path 空字串 + owner postgres';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
