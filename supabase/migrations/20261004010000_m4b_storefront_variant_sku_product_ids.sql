-- 20261004010000_m4b_storefront_variant_sku_product_ids.sql —— 料號回查改用 SECURITY DEFINER 函式
-- Sean 2026-10-04 00:5x 經主視窗批 Q1 甲 Q2 甲。計畫:~/Projects/pcm-mailbox/計畫-料號回查改權限函式-20261004.md。
--
-- 量到的(2026-10-04 正式庫唯讀, pcm_readonly 會略過資料列權限):
--   客人搜尋 0 筆時的變體料號回查(SupabaseProductAdapter.searchByVariantSku)以 anon 查 product_variants_public 的 `sku ILIKE`,
--   而 product_variants 有資料列權限、texticlike 不是 leakproof(pg_proc.proleakproof = f)⇒ 不能先用索引過濾, 整張表掃
--   (66,602 列;1.8–4.6 秒, 10-03 18:57 四筆逾時)。
--   改成「正規化料號 LIKE(走既有 product_variants_sku_norm_trgm_idx)+ 原始料號 ILIKE 複核 + 上架檢查」:
--   PRN01 500 列 82 ms、RN0 500 列 67 ms、找不到 91 ms(都含約 65 ms 網路往返, 熱快取)。
-- 改什麼:新增一支函式, 不改任何既有物件、不加索引、不改資料。
--   結果與原本的 `sku ILIKE '%q%'`(加上架檢查)相同:原始字面包含 ⇒ 去掉符號後也包含, 所以正規化那道只縮小候選、不改結果。
--   唯一的差別(Sean Q1 甲):去掉符號後不到 3 個字(例如 A-1、#12)⇒ 回 0 列(原本會整表掃)。
--   「符號」指 A–Z、a–z、0–9 以外的所有字元, 含非 ASCII 字母(ÖHL 只算 2 個字);正式庫料號 2026-10-04 沒有非 ASCII 字元。
-- 安全:
--   · SECURITY DEFINER(owner postgres, rolbypassrls = t)⇒ 不受資料列權限管 ⇒ 已下架商品由本函式【自己】擋,
--     照 product_variants_select_public 原文(母商品 delisted_at IS NULL), 在 LIMIT 之前。
--   · 只回 product_id;不回料號或任何價格欄位。不標 LEAKPROOF。SET search_path TO '', 物件一律寫 schema。
--   · 權限照 docs/patterns/revoking-function-execute-in-supabase.md:PUBLIC 與 anon/authenticated 兩道都先收,
--     再明確 GRANT 給 anon、authenticated、service_role(本來就是給客人搜尋用的, 形狀同 storefront_search_product_ids)。
--   · 裸 CREATE, 不加 OR REPLACE(撞名要報錯, 不能靜靜跳過)。
-- 先後:先貼本檔再推程式(scripts/deploy-order-gate.sh 會擋「程式叫到正式庫還沒有的函式」)。
--   本檔貼上、程式還沒推之前, 沒有人呼叫這支函式, 不影響任何東西。可以用 scripts/apply-paste-board.sh 正常貼(有 BEGIN/COMMIT)。
-- 還原:supabase/rollbacks/20261004010000-rollback.sql —— 要【先還原程式】再刪函式。
-- 驗證:scripts/20261004010000-verify.sh(拋棄式 PG, 非 superuser 貼, anon 身分走索引、結果與原寫法逐筆相同、下架擋住、權限矩陣)。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 🔴 search_path 清空(只在本交易內):pg_get_indexdef 印運算子類別時, 看得見的 schema 不加前綴 ——
--    正式庫 postgres 的 search_path 含 extensions ⇒ 印 gin_trgm_ops, 唯讀帳號與拋棄式 PG 印 extensions.gin_trgm_ops
--    ⇒ 前置閘①在正式庫誤擋(Sean 2026-10-04 00:5x 實撞, 交易已退回、沒有寫入)。清空後兩邊都印 extensions.gin_trgm_ops。
--    本檔的表與自訂函式都寫了 schema;count / coalesce / substr / replace 這些內建函式沒寫,
--    而 pg_catalog 在空 search_path 下照樣會被搜尋(拋棄式 PG 以正式庫的 search_path 實跑 30 格過)。
SET LOCAL search_path TO '';

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.storefront_variant_sku_product_ids(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.storefront_variant_sku_product_ids(text) 已存在 ⇒ 停(不覆蓋)';
  END IF;
  IF pg_catalog.to_regclass('public.product_variants_sku_norm_trgm_idx') IS NULL
     OR pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.product_variants_sku_norm_trgm_idx'))
        <> 'CREATE INDEX product_variants_sku_norm_trgm_idx ON public.product_variants USING gin (upper(regexp_replace(sku, ''[^A-Za-z0-9]''::text, ''''::text, ''g''::text)) extensions.gin_trgm_ops)' THEN
    RAISE EXCEPTION '前置閘①:product_variants_sku_norm_trgm_idx 不在或運算式不同 ⇒ 本函式會整表掃 ⇒ 停';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'postgres' AND r.rolbypassrls) THEN
    RAISE EXCEPTION '前置閘②:postgres 不是 BYPASSRLS ⇒ DEFINER 仍受資料列權限管, 照樣用不上索引 ⇒ 停';
  END IF;
  IF pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.product_variants'::regclass)) <> 'postgres' THEN
    RAISE EXCEPTION '前置閘③:product_variants 的 owner 不是 postgres ⇒ 停';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy po
                  WHERE po.polrelid = 'public.product_variants'::regclass AND po.polname = 'product_variants_select_public') THEN
    RAISE EXCEPTION '前置閘④:product_variants_select_public 不在 ⇒ 本函式照抄的那條權限規則可能已經變了 ⇒ 停下來看';
  END IF;
END
$pre$;

CREATE FUNCTION public.storefront_variant_sku_product_ids(p_q text)
 RETURNS TABLE(product_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH q AS (
    SELECT pg_catalog.btrim(p_q) AS raw,
           pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(p_q), '[^A-Za-z0-9]', '', 'g')) AS n
  )
  SELECT pv.product_id
    FROM public.product_variants pv, q
   -- 長度上限與前台 SEARCH_MAX_QUERY_LENGTH(100)相同;去掉符號後至少 3 個字(Sean Q1 甲)
   WHERE pg_catalog.length(q.raw) BETWEEN 3 AND 100
     AND pg_catalog.length(q.n) >= 3
     -- 候選:運算式與 product_variants_sku_norm_trgm_idx 逐字相同 ⇒ 走索引。q.n 只剩英數 ⇒ 不必 escape、不會是空字串
     AND pg_catalog.upper(pg_catalog.regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q.n || '%'
     -- 複核:原始料號字面包含(與原本的 ILIKE 同語意)。escape 順序先 \ 再 % 再 _
     AND pv.sku ILIKE '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(q.raw, '\', '\\'), '%', '\%'), '_', '\_') || '%'
     -- 照 product_variants_select_public 原文擋掉已下架商品(在 LIMIT 之前)
     AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)
   LIMIT 500;
$function$;

-- owner 固定 postgres(rolbypassrls = t):DEFINER 以 owner 身分執行, owner 要能略過資料列權限才用得上索引。
--   正式庫由 postgres 貼 ⇒ 這行等於沒動;拋棄式 PG 用非 superuser 的 zz_paster 貼時才有作用。
ALTER FUNCTION public.storefront_variant_sku_product_ids(text) OWNER TO postgres;

-- ACL-GATE-EXEMPT: public.storefront_variant_sku_product_ids -- 客人搜尋用的 DEFINER 函式, REVOKE PUBLIC/anon/authenticated 後具名還原 anon/authenticated/service_role, 形狀同 storefront_search_product_ids(計畫 2026-10-04 Sean Q2 甲)
REVOKE ALL ON FUNCTION public.storefront_variant_sku_product_ids(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_variant_sku_product_ids(text) TO anon, authenticated, service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.storefront_variant_sku_product_ids(text)']::text[];
  v_fn  text;
  v_oid regprocedure := 'public.storefront_variant_sku_product_ids(text)'::regprocedure;
  v_md5 text;
  v_n   bigint;
  r     record;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_md5 <> '26e512d279d3ef0c5f1f6a06b135de23' THEN
    RAISE EXCEPTION '事後閘①:函式本體 md5 = % , 不是 26e512d279d3ef0c5f1f6a06b135de23', v_md5;
  END IF;
  IF NOT (SELECT p.prosecdef AND p.provolatile = 's' AND NOT p.proleakproof FROM pg_catalog.pg_proc p WHERE p.oid = v_oid)
     OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> 'postgres' THEN
    RAISE EXCEPTION '事後閘②:不是 STABLE SECURITY DEFINER、被標成 LEAKPROOF、search_path 不是空字串、或 owner 不是 postgres';
  END IF;
  -- ③ EXECUTE 的授權對象剛好是這 4 個(PUBLIC 的 grantee oid 是 0, 也算在總數裡 ⇒ 多一個就會紅)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = v_oid AND x.privilege_type = 'EXECUTE';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘③a:EXECUTE 授權對象不是剛好 4 個(實得 %)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = v_oid AND x.privilege_type = 'EXECUTE'
     AND pg_catalog.pg_get_userbyid(x.grantee) IN ('anon', 'authenticated', 'postgres', 'service_role');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘③b:EXECUTE 授權對象不是 anon / authenticated / postgres / service_role(實得 %)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
   WHERE p.oid = v_oid AND pg_catalog.pg_get_userbyid(x.grantee) = 'qk83m2_negctl_20261004';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘③c:負對照不是 0 ⇒ 上面那把尺壞了(v_n=%)', v_n;
  END IF;
  -- ③d 這支本來就是給客人搜尋用的 ⇒ 三個角色都要執行得到(方向與一般 admin 函式相反)
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF NOT (pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
            AND pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE')
            AND pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION '事後閘③d:% 不是 anon / authenticated / service_role 都執行得到 ⇒ 客人搜尋會失敗', v_fn;
    END IF;
  END LOOP;

  -- ④ 太短或沒有英數 ⇒ 0 列(Sean Q1 甲)
  SELECT count(*) INTO v_n FROM (
    SELECT 1 FROM public.storefront_variant_sku_product_ids(NULL)
    UNION ALL SELECT 1 FROM public.storefront_variant_sku_product_ids('')
    UNION ALL SELECT 1 FROM public.storefront_variant_sku_product_ids('ab')
    UNION ALL SELECT 1 FROM public.storefront_variant_sku_product_ids('A-1')
    UNION ALL SELECT 1 FROM public.storefront_variant_sku_product_ids('---')
    UNION ALL SELECT 1 FROM public.storefront_variant_sku_product_ids('%%%')) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘④:太短或沒有英數的查詢回了 % 列', v_n;
  END IF;

  -- ⑤ 結果與原寫法(原始 ILIKE + 上架檢查)相同:拿 10 個上架規格料號的中間 4 個字當片段, 兩邊的商品集合要一樣
  v_n := 0;
  FOR r IN
    SELECT substr(pv.sku, 2, 4) AS frag
      FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
     WHERE p.delisted_at IS NULL AND pg_catalog.length(pg_catalog.regexp_replace(substr(pv.sku, 2, 4), '[^A-Za-z0-9]', '', 'g')) >= 3
       -- 片段頭尾不能是空白:函式會 btrim, 原寫法不會 ⇒ 帶空白的片段兩邊本來就不同(Fable R1 nit)
       AND substr(pv.sku, 2, 4) = pg_catalog.btrim(substr(pv.sku, 2, 4))
     ORDER BY pv.id LIMIT 10
  LOOP
    IF EXISTS (
      (SELECT f.product_id FROM public.storefront_variant_sku_product_ids(r.frag) f
       EXCEPT
       SELECT pv.product_id FROM public.product_variants pv
        WHERE pv.sku ILIKE '%' || replace(replace(replace(r.frag, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL))
    ) THEN
      RAISE EXCEPTION '事後閘⑤a:片段「%」函式回了原寫法沒有的商品', r.frag;
    END IF;
    IF (SELECT count(*) FROM public.storefront_variant_sku_product_ids(r.frag)) < 500 AND EXISTS (
      SELECT pv.product_id FROM public.product_variants pv
       WHERE pv.sku ILIKE '%' || replace(replace(replace(r.frag, '\', '\\'), '%', '\%'), '_', '\_') || '%'
         AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)
      EXCEPT
      SELECT f.product_id FROM public.storefront_variant_sku_product_ids(r.frag) f
    ) THEN
      RAISE EXCEPTION '事後閘⑤b:片段「%」原寫法找得到的商品, 函式沒回', r.frag;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RAISE NOTICE '事後閘⑤:沒有可用的上架規格料號片段 ⇒ 本格沒有判別力(不是通過)';
  END IF;

  -- ⑥ 已下架商品的料號:函式不回(找一個只掛在下架商品上的料號)
  SELECT pv.product_id AS id, pv.sku INTO r
    FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
   WHERE p.delisted_at IS NOT NULL AND pg_catalog.length(pg_catalog.regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g')) >= 3
   ORDER BY pv.id LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.storefront_variant_sku_product_ids(r.sku) f WHERE f.product_id = r.id) THEN
      RAISE EXCEPTION '事後閘⑥:下架商品 % 用料號「%」查得到', r.id, r.sku;
    END IF;
  ELSE
    RAISE NOTICE '事後閘⑥:沒有下架商品的規格料號 ⇒ 本格沒有判別力(不是通過)';
  END IF;
END
$post$;

COMMIT;
