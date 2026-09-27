-- 20260927060000_m4b_admin_set_product_override.sql —— 商品編輯丙方案片 2:後台寫 staff_overrides 的唯一入口
-- pcm:idempotent: yes
--   ↑ 重跑同形:函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。拋棄式 PG 實跑:套用 → 重跑 → 回滾 → 再套用(見 commit message)。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定,重跑只會換成同一份本體,不會蓋掉別人的同名函式(前置閘之前本庫查無此名)。
-- ACL-GATE-EXEMPT: public.admin_set_product_override -- SECURITY DEFINER owner RPC,只給 service_role EXECUTE(後台 server action 以 service_role 呼叫);anon / authenticated 全收(同 20260819040000 admin_set_product_listing)。
--
-- 🛑 未貼。只做不貼,貼的人是 Sean(或他明文授權的那一次)。
--    plan:~/pcm-mailbox/計畫-後台商品編輯與上傳圖片-20260927.md(片 2)· 設計稿 ~/pcm-mailbox/設計稿-商品編輯-基本資料-20260927.html
--
-- ══ 為什麼 ══════════════════════════════════════════
-- 片 1(20260927040000,已貼)開了 products.staff_overrides,但沒有任何寫入口。Sean 2026-09-27 C4 甲:所有員工都能改,留變更紀錄
-- (08-15 Q1:不用填原因,但要有紀錄)。product-repository.ts 的寫入規矩:走 RPC,不在 app 層直接 .update() 表 —— 直接寫表不留稽核。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_set_product_override(p_product_id, p_field, p_value, p_actor, p_request_id) RETURNS text
--   · p_field 只收 'title' / 'subtitle' / 'highlights'(其餘 RAISE;description 走說明鎖,不在這裡 —— 見 20260927040000 檔頭)
--   · p_value = NULL ⇒ 刪掉那個鍵 = 「還原成供應商的」(片 1 CHECK:取消覆寫要刪鍵,不能寫 null)
--   · title / subtitle:jsonb 字串;去前後空白後是空的 ⇒ 當成刪鍵;上限 200 / 300 字;不收控制字元
--   · highlights:jsonb 字串陣列;每點去前後空白、空的丟掉;全丟光 ⇒ 刪鍵;最多 12 點、每點 200 字;不收控制字元
--   · 鎖列讀 before → 同值回 NO_CHANGE 零寫入零稽核 → UPDATE staff_overrides → 同交易寫 admin_audit_log('product.override.change')
--   · 回 UPDATED / NO_CHANGE / NOT_FOUND;參數不合法 ⇒ RAISE(後台顯示「內容不合規則」)
-- 🔵 寫入後 products_content_changed_guard(20260927040000 那一代)會自動更新 content_changed_at,不用在這裡寫。
-- 🔵 空白字元集沿用 20260819040000(樣板 20260717010000)的 31 字元全集 —— 比片 1 CHECK 的 5 種寬,
--    所以這裡收下的值一定過得了 CHECK(先 trim 得比 CHECK 更乾淨)。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 只建一支函式,不動表、不鎖表 ⇒ 任何時段都可以貼。
-- · 後台那顆碼要在本支貼完之後才推:碼先上 ⇒ RPC 不存在(PGRST202)⇒ 員工按儲存會看到「儲存失敗」,不會寫壞資料。
-- · 回滾:supabase/rollbacks/20260927060000-rollback.sql(DROP FUNCTION;要先退後台碼)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.products'::regclass AND conname = 'products_staff_overrides_shape' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION '前置閘失敗 — products.staff_overrides 或它的 CHECK 不存在(20260927040000 未套用)';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_set_product_override(
  p_product_id uuid,
  p_field      text,
  p_value      jsonb,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 空白字元集:逐字沿用 20260819040000(樣板 20260717010000)的 31 字元全集。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_before_all  jsonb;
  v_before      jsonb;
  v_after       jsonb;
  v_text        text;
  v_item        jsonb;
  v_items       jsonb := '[]'::jsonb;
  v_max         int;
BEGIN
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_set_product_override: v_ws 字元集長度異常(預期 31)';
  END IF;

  -- 1a. server 供參數 fail-closed(actor 由 server session 解析,缺 ⇒ 拒,不以未知身分寫稽核)
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_set_product_override: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_set_product_override: 缺 request_id';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'admin_set_product_override: 缺 product_id';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('title', 'subtitle', 'highlights') THEN
    RAISE EXCEPTION 'admin_set_product_override: 不支援的欄位';
  END IF;

  -- 1b. 值正規化:v_after = 要存的值;NULL = 刪鍵(還原成供應商的)
  IF p_value IS NULL THEN
    v_after := NULL;
  ELSIF p_field IN ('title', 'subtitle') THEN
    IF pg_catalog.jsonb_typeof(p_value) <> 'string' THEN
      RAISE EXCEPTION 'admin_set_product_override: % 必須是文字', p_field;
    END IF;
    v_text := pg_catalog.btrim(p_value #>> '{}', v_ws);
    -- 🔴 上限另外算:PL/pgSQL 的 IF 條件在第一個 THEN 就結束,條件裡不能直接寫 CASE … THEN(拋棄式 PG 實測 syntax error)
    v_max := CASE p_field WHEN 'title' THEN 200 ELSE 300 END;
    IF v_text = '' THEN
      v_after := NULL;  -- 只打空白 = 沒填 ⇒ 還原
    ELSIF pg_catalog.char_length(v_text) > v_max OR v_text ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'admin_set_product_override: % 太長或含控制字元', p_field;
    ELSE
      v_after := pg_catalog.to_jsonb(v_text);
    END IF;
  ELSE
    IF pg_catalog.jsonb_typeof(p_value) <> 'array' THEN
      RAISE EXCEPTION 'admin_set_product_override: highlights 必須是陣列';
    END IF;
    FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(p_value) AS t(e) LOOP
      IF pg_catalog.jsonb_typeof(v_item) <> 'string' THEN
        RAISE EXCEPTION 'admin_set_product_override: highlights 每一點都必須是文字';
      END IF;
      v_text := pg_catalog.btrim(v_item #>> '{}', v_ws);
      CONTINUE WHEN v_text = '';  -- 空白那幾行不存
      IF pg_catalog.char_length(v_text) > 200 OR v_text ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'admin_set_product_override: 賣點太長或含控制字元';
      END IF;
      v_items := v_items || pg_catalog.jsonb_build_array(v_text);
    END LOOP;
    IF pg_catalog.jsonb_array_length(v_items) > 12 THEN
      RAISE EXCEPTION 'admin_set_product_override: 賣點最多 12 點';
    END IF;
    v_after := CASE WHEN pg_catalog.jsonb_array_length(v_items) = 0 THEN NULL ELSE v_items END;
  END IF;

  -- 1c. 鎖列 + before 快照(同商品並發序列化;查無 ⇒ 固定碼)
  SELECT staff_overrides INTO v_before_all
    FROM public.products
   WHERE id = p_product_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  v_before := v_before_all -> p_field;

  -- 1d. 同值冪等:零寫入零稽核(NULL 與 NULL 也算同值)
  IF v_before IS NOT DISTINCT FROM v_after THEN
    RETURN 'NO_CHANGE';
  END IF;

  -- 1e. 目的寫入:只動這一個鍵
  UPDATE public.products
     SET staff_overrides = CASE WHEN v_after IS NULL
                                THEN staff_overrides - p_field
                                ELSE staff_overrides || pg_catalog.jsonb_build_object(p_field, v_after) END,
         updated_at      = pg_catalog.now()
   WHERE id = p_product_id;

  -- 1f. 同交易寫稽核(before / after 鍵名對稱;value = null 代表「用供應商的」)
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'product.override.change',
    'product:' || p_product_id::text,
    pg_catalog.jsonb_build_object('field', p_field, 'value', v_before),
    pg_catalog.jsonb_build_object('field', p_field, 'value', v_after),
    NULL,
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$fn$;

COMMENT ON FUNCTION public.admin_set_product_override(uuid, text, jsonb, text, text) IS
  '商品編輯丙方案片 2(20260927060000):後台寫 products.staff_overrides 的唯一入口。欄位只收 title / subtitle / highlights;'
  'p_value = NULL 或正規化後為空 ⇒ 刪鍵(還原成供應商的)。SECURITY DEFINER,search_path 空字串;鎖列讀 before → 同值 NO_CHANGE → '
  'UPDATE → 同交易寫 admin_audit_log(product.override.change)。回 UPDATED / NO_CHANGE / NOT_FOUND。EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_set_product_override(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_product_override(uuid, text, jsonb, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_set_product_override(uuid, text, jsonb, text, text)']::text[];
  v_fn  oid;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'admin_set_product_override:函式沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_product_override:anon / authenticated 仍可 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_product_override:service_role 沒有 EXECUTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'admin_set_product_override:不是 SECURITY DEFINER 或 search_path 不是空字串';
  END IF;
  RAISE NOTICE '✅ admin_set_product_override:函式在、只有 service_role 可執行、SECURITY DEFINER + search_path 空字串';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
