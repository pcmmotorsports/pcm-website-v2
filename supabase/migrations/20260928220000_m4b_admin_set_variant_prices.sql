-- 20260928220000_m4b_admin_set_variant_prices.sql —— 商品頁乙 P4(P-M3):主管改規格價格與特價
-- pcm:idempotent: yes
--   ↑ 重跑同形:函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。拋棄式 PG 實跑:套用 → 重跑 → 回滾 → 再套用(見 commit message)。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定,前置閘之前本庫查無此名。
-- ACL-GATE-EXEMPT: public.admin_set_variant_prices -- SECURITY DEFINER RPC,只給 service_role EXECUTE(後台 server action 以 service_role 呼叫);anon / authenticated 全收(同 20260927060000 admin_set_product_override)。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第八節(P-M3、P4)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 09-27 C2 甲:手動商品的價格在後台填、主管才能改;Sean 09-28 Q1 乙:主管可以設特價(同步商品與手動商品都可以)。
-- 🔴 後台入口的開放順序由程式控制(計畫第八節第 5 點):手動商品改價要等 P-M5(下單必帶核對值)之後,特價入口最後才開。
--    本支只提供寫入函式,貼上後沒有入口呼叫它就不會有任何價格改變。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_set_variant_prices(p_product_id uuid, p_changes jsonb, p_actor text, p_request_id text) RETURNS jsonb
--   p_changes = [{ variant_id, price_general?, price_store?, sale_price_general? }, …],1–50 筆;沒帶的鍵 = 不改。
--     price_general:0 以上整數(手動商品才能改)
--     price_store:0 以上整數或 null(null = 沒有經銷價;手動商品才能改)
--     sale_price_general:null(清掉特價)或大於 0、而且低於這個規格(改完之後)的一般價;一般價是空的規格不能設特價(計畫 R6-1)
--   回 { results: [{ variant_id, outcome }] },outcome = UPDATED / NO_CHANGE
-- · 在職【主管】才能用(staff.is_active AND is_manager,FOR SHARE 持有到交易結束);非主管 RAISE '無權執行此操作'。
-- · 不等鎖(計畫 R5-3):先 FOR UPDATE NOWAIT 鎖商品列,再 FOR UPDATE NOWAIT 鎖它的規格(分兩句;商品沒有規格時也鎖得到商品列)。
--   任何一列被別人(例如每日同步)鎖著 ⇒ 整筆不做,RAISE '商品正在更新,請稍後再試'。
--   一般同步是先改規格、再由 trigger 改商品(20260915220000:158),順序和這裡相反,所以不能等待,等待就可能互相卡住。
-- · 同步商品(supplier_slug <> 'pcm'):只能設或清特價;一般價、經銷價只能在報價單改(08-15 Q2)⇒ 帶了就 RAISE。
--   🔴 同步商品【不碰商品層價格】:同步每天會用基準款蓋回去(rpm-transform.ts:634、704–728),寫了會讓直接讀商品表的地方每天跳。
-- · 手動商品(supplier_slug = 'pcm'):改完規格後,商品層 price_general、price_by_tier 照同步的規則重算
--   (最低一般價那一款,同價取料號小的;那一款沒有經銷價 ⇒ store 取一般價)。
-- · 三個價格都沒變 ⇒ NO_CHANGE,不寫紀錄。有變 ⇒ 逐規格寫 admin_audit_log('product.price.change'),同一交易,稽核失敗整筆撤銷。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 前置:20260928200000(特價欄)已貼。只建一支函式,不動表 ⇒ 任何時段都可以貼。
-- · 回滾:supabase/rollbacks/20260928220000-rollback.sql(DROP FUNCTION;要先退後台改價與特價入口)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.product_variants'::regclass AND attname = 'sale_price_general' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘失敗 — product_variants.sale_price_general 不存在(20260928200000 未套用)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_manager' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘失敗 — staff.is_manager 不存在(主管檢查需要它)';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_set_variant_prices(
  p_product_id uuid,
  p_changes    jsonb,
  p_actor      text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_supplier  text;
  v_manual    boolean;
  v_item      jsonb;
  v_vid       uuid;
  v_before    record;
  v_general   integer;
  v_store     integer;
  v_sale      integer;
  v_results   jsonb := '[]'::jsonb;
  v_n         integer;
  v_seen      uuid[] := '{}';
  v_basis     record;
  v_tier      jsonb;
  v_changed   boolean := false;
BEGIN
  -- 1. 操作人:在職主管
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_set_variant_prices: 缺 actor';
  END IF;
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active AND s.is_manager FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_set_variant_prices: 缺 request_id';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'admin_set_variant_prices: 缺 product_id';
  END IF;
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'admin_set_variant_prices: 價格變更格式不對';
  END IF;
  v_n := pg_catalog.jsonb_array_length(p_changes);
  IF v_n < 1 OR v_n > 50 THEN
    RAISE EXCEPTION 'admin_set_variant_prices: 一次要改 1 到 50 個規格';
  END IF;

  -- 2. 不等鎖:商品列、再它的規格(分兩句)
  BEGIN
    SELECT p.supplier_slug INTO v_supplier FROM public.products p WHERE p.id = p_product_id FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'admin_set_variant_prices: 找不到商品';
    END IF;
    PERFORM 1 FROM public.product_variants pv WHERE pv.product_id = p_product_id ORDER BY pv.id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION '商品正在更新,請稍後再試';
  END;
  v_manual := (v_supplier = 'pcm');

  -- 3. 逐規格
  FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(p_changes) AS t(e) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object' OR pg_catalog.jsonb_typeof(v_item -> 'variant_id') IS DISTINCT FROM 'string'
       OR (v_item ->> 'variant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'admin_set_variant_prices: 價格變更格式不對';
    END IF;
    v_vid := (v_item ->> 'variant_id')::uuid;
    IF v_vid = ANY (v_seen) THEN
      RAISE EXCEPTION 'admin_set_variant_prices: 同一個規格出現兩次';
    END IF;
    v_seen := v_seen || v_vid;

    SELECT pv.price_general, pv.price_store, pv.sale_price_general INTO v_before
      FROM public.product_variants pv WHERE pv.id = v_vid AND pv.product_id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'admin_set_variant_prices: 規格不屬於這件商品';
    END IF;

    v_general := v_before.price_general;
    v_store := v_before.price_store;
    v_sale := v_before.sale_price_general;

    IF v_item ? 'price_general' OR v_item ? 'price_store' THEN
      IF NOT v_manual THEN
        RAISE EXCEPTION 'admin_set_variant_prices: 同步商品的一般價與經銷價只能在報價單改';
      END IF;
    END IF;
    IF v_item ? 'price_general' THEN
      IF pg_catalog.jsonb_typeof(v_item -> 'price_general') <> 'number' OR (v_item ->> 'price_general') !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'admin_set_variant_prices: 一般價要是 0 以上的整數';
      END IF;
      v_general := (v_item ->> 'price_general')::integer;
    END IF;
    IF v_item ? 'price_store' THEN
      IF pg_catalog.jsonb_typeof(v_item -> 'price_store') = 'null' THEN
        v_store := NULL;
      ELSIF pg_catalog.jsonb_typeof(v_item -> 'price_store') <> 'number' OR (v_item ->> 'price_store') !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'admin_set_variant_prices: 經銷價要是 0 以上的整數或不填';
      ELSE
        v_store := (v_item ->> 'price_store')::integer;
      END IF;
    END IF;
    IF v_item ? 'sale_price_general' THEN
      IF pg_catalog.jsonb_typeof(v_item -> 'sale_price_general') = 'null' THEN
        v_sale := NULL;
      ELSIF pg_catalog.jsonb_typeof(v_item -> 'sale_price_general') <> 'number' OR (v_item ->> 'sale_price_general') !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'admin_set_variant_prices: 特價要是大於 0 的整數';
      ELSE
        v_sale := (v_item ->> 'sale_price_general')::integer;
      END IF;
    END IF;
    -- 特價規則(計畫 R6-1):一般價空的規格不能有特價;特價要大於 0、而且低於一般價
    IF v_sale IS NOT NULL THEN
      IF v_general IS NULL THEN
        RAISE EXCEPTION 'admin_set_variant_prices: 一般價是空的規格不能設特價';
      END IF;
      IF v_sale <= 0 OR v_sale >= v_general THEN
        RAISE EXCEPTION 'admin_set_variant_prices: 特價要大於 0,而且低於一般價';
      END IF;
    END IF;

    IF v_general IS NOT DISTINCT FROM v_before.price_general
       AND v_store IS NOT DISTINCT FROM v_before.price_store
       AND v_sale IS NOT DISTINCT FROM v_before.sale_price_general THEN
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('variant_id', v_vid, 'outcome', 'NO_CHANGE'));
      CONTINUE;
    END IF;

    UPDATE public.product_variants
       SET price_general = v_general, price_store = v_store, sale_price_general = v_sale, updated_at = pg_catalog.now()
     WHERE id = v_vid;

    INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
    VALUES (
      p_actor,
      'product.price.change',
      'product:' || p_product_id::text,
      pg_catalog.jsonb_build_object('variant_id', v_vid, 'price_general', v_before.price_general,
                                    'price_store', v_before.price_store, 'sale_price_general', v_before.sale_price_general),
      pg_catalog.jsonb_build_object('variant_id', v_vid, 'price_general', v_general,
                                    'price_store', v_store, 'sale_price_general', v_sale),
      NULL,
      p_request_id,
      'admin'
    );
    v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('variant_id', v_vid, 'outcome', 'UPDATED'));
    v_changed := true;
  END LOOP;

  -- 4. 手動商品:商品層價格照同步的規則重算(同步商品不碰;全部 NO_CHANGE 時也不碰,P4 Codex R1 必修)
  IF v_manual AND v_changed THEN
    SELECT pv.price_general, pv.price_store INTO v_basis
      FROM public.product_variants pv
     WHERE pv.product_id = p_product_id
     ORDER BY pv.price_general NULLS LAST, pv.sku COLLATE "C"
     LIMIT 1;
    IF FOUND THEN
      -- 🔴 格式同同步(scripts/rpm-transform.ts:724、732),get_effective_prices 讀 ->'general'->>'amount'
      v_tier := pg_catalog.jsonb_build_object(
        'general', pg_catalog.jsonb_build_object('amount', v_basis.price_general, 'currency', 'TWD'),
        'store', pg_catalog.jsonb_build_object('amount', COALESCE(v_basis.price_store, v_basis.price_general), 'currency', 'TWD'));
      UPDATE public.products
         SET price_general = v_basis.price_general,
             price_by_tier = v_tier,
             updated_at = pg_catalog.now()
       WHERE id = p_product_id
         AND (price_general IS DISTINCT FROM v_basis.price_general OR price_by_tier IS DISTINCT FROM v_tier);
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('results', v_results);
END;
$fn$;

COMMENT ON FUNCTION public.admin_set_variant_prices(uuid, jsonb, text, text) IS
  '商品頁乙 P4(20260928220000):主管改規格價格與特價。在職主管才能用;商品列與規格列 FOR UPDATE NOWAIT(被鎖 ⇒ 商品正在更新,請稍後再試);'
  '同步商品只能設或清特價、不碰商品層價格;手動商品可改一般價與經銷價並重算商品層;特價要大於 0 且低於一般價,一般價空不能設;'
  '三個價格都沒變回 NO_CHANGE 不寫紀錄;逐規格寫 admin_audit_log(product.price.change)。EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_set_variant_prices(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_variant_prices(uuid, jsonb, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_set_variant_prices(uuid, jsonb, text, text)']::text[];
  v_fn  oid;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'admin_set_variant_prices:函式沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_variant_prices:anon / authenticated 仍可 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_variant_prices:service_role 沒有 EXECUTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'admin_set_variant_prices:不是 SECURITY DEFINER 或 search_path 不是空字串';
  END IF;
  RAISE NOTICE '✅ admin_set_variant_prices:函式在、只有 service_role 可執行、SECURITY DEFINER + search_path 空字串';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
