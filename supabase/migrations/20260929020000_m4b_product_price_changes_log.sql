-- 20260929020000_m4b_product_price_changes_log.sql
-- 每日 LINE 摘要「商品」一行的資料來源:規格一般價【真的變了】時記一列。
-- Sean 2026-09-29 答 Q1 甲(有變動才印一行)、Q2 甲(下架不印)、Q3 甲(跨 09:00/21:00 那幾秒開始的交易可能少算, 接受)。
-- 計畫(Fable R1–R4、Codex R3/R5 審過):~/pcm-mailbox/計畫-每日摘要加新品與變價-20260929.md 第 5 版。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 新表 product_price_changes:一列 = 一個規格的一般價在某一刻從 old_price 變成 new_price。
--    old_price / new_price 可為 NULL(供應商缺價那天 price_general 會是 NULL, 設 NOT NULL 會讓整批同步失敗)。
--    product_id 另存:規格日後被刪(孤兒刪除 / 改料號)時仍對得回品名;不對 variant_id 設 FK, 刪規格不受影響。
-- ② product_variants 上 AFTER UPDATE trigger, 條件 `OLD.price_general IS DISTINCT FROM NEW.price_general`:
--    同步每天把幾千列 upsert 一次, 價格沒變的不觸發。INSERT(新規格、孤兒刪除後重建)不寫 ⇒ 算進新上架不算變價。
--    包含員工在後台手動改一般價(admin_set_variant_prices);不含特價、經銷價。
-- ③ 讀取端排序一律照 id(identity 在寫入那一刻配號), 不照 changed_at(now() 是交易開始的時間, 交錯時會排反;Codex R5)。
--
-- ══ 權限 ═══════════════════════════════════════════════════
-- · trigger function SECURITY DEFINER + SET search_path = '' ⇒ 不論誰寫 product_variants(同步用 service_role、
--   後台 RPC), 都由擁有者寫進紀錄表;service_role 不需要 INSERT。EXECUTE 收回(trigger 呼叫不看 EXECUTE)。
-- · 表開 RLS, 只給 service_role SELECT(每日摘要用 service client 讀);anon / authenticated / pcm_readonly 不開。
-- · IDENTITY 序列明寫 REVOKE(scripts/public-sequence-acl.test.ts 那份清單同一顆 commit 補上)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260929020000-rollback.sql:刪 trigger、function、表。表裡只有紀錄, 刪了不影響商品資料。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.product_price_changes') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:public.product_price_changes 已存在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.product_variants'::regclass AND attname = 'price_general' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘二:product_variants.price_general 不在';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.product_variants'::regclass AND tgname = 'trg_product_variants_price_change_log') THEN
    RAISE EXCEPTION '前置閘三:trigger trg_product_variants_price_change_log 已存在';
  END IF;
END
$pre$;

CREATE TABLE public.product_price_changes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    uuid        NOT NULL,
  product_id    uuid        NOT NULL,
  supplier_slug text        NOT NULL,
  sku           text        NOT NULL,
  old_price     integer,
  new_price     integer,
  changed_at    timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX product_price_changes_changed_at_idx ON public.product_price_changes (changed_at);

COMMENT ON TABLE public.product_price_changes IS
  '規格一般價真的變動時由 trg_product_variants_price_change_log 寫一列(20260929020000)。每日 LINE 摘要「商品」一行讀它;排序照 id, 不照 changed_at。';

ALTER TABLE public.product_price_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_price_changes_service_role_select ON public.product_price_changes
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.product_price_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.product_price_changes TO service_role;
REVOKE ALL ON SEQUENCE public.product_price_changes_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.product_variants_price_change_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.product_price_changes (variant_id, product_id, supplier_slug, sku, old_price, new_price)
  VALUES (NEW.id, NEW.product_id, NEW.supplier_slug, NEW.sku, OLD.price_general, NEW.price_general);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.product_variants_price_change_log() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_product_variants_price_change_log
  -- 不寫 `UPDATE OF price_general`:那只在 SET 明列該欄時觸發, BEFORE trigger 改的價會漏;條件交給 WHEN。
  AFTER UPDATE ON public.product_variants
  FOR EACH ROW
  WHEN (OLD.price_general IS DISTINCT FROM NEW.price_general)
  EXECUTE FUNCTION public.product_variants_price_change_log();

DO $post$
DECLARE
  -- 收權斷言清單(scripts/migration-static-checks.sh 規則③ 對可授權物件數):本檔新建的表與函式。
  v_relations text[] := ARRAY['public.product_price_changes']::text[];
  v_functions text[] := ARRAY['public.product_variants_price_change_log()']::text[];
  r text;
  v_n int;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT,INSERT,UPDATE,DELETE')
       OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION '後置閘〇:% 對 anon / authenticated 開著權限', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘〇:% 對 anon / authenticated 開著 EXECUTE', r;
    END IF;
  END LOOP;
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.product_variants'::regclass AND tgname = 'trg_product_variants_price_change_log' AND tgenabled = 'O';
  IF v_n <> 1 THEN RAISE EXCEPTION '後置閘一:trigger 不在或沒啟用'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.product_price_changes'::regclass) THEN
    RAISE EXCEPTION '後置閘二:product_price_changes 沒開 RLS';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.product_price_changes', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.product_price_changes', 'SELECT') THEN
    RAISE EXCEPTION '後置閘三:anon / authenticated 讀得到 product_price_changes';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.product_price_changes', 'SELECT') THEN
    RAISE EXCEPTION '後置閘四:service_role 讀不到 product_price_changes ⇒ 摘要讀不到';
  END IF;
  IF pg_catalog.has_sequence_privilege('anon', 'public.product_price_changes_id_seq', 'USAGE')
     OR pg_catalog.has_sequence_privilege('authenticated', 'public.product_price_changes_id_seq', 'USAGE') THEN
    RAISE EXCEPTION '後置閘五:序列對 anon / authenticated 開著';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.product_variants_price_change_log()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.product_variants_price_change_log()', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘六:trigger function 對 anon / authenticated 開著 EXECUTE';
  END IF;
  IF (SELECT pg_catalog.array_to_string(proconfig, ',') || '|' || prosecdef::text FROM pg_catalog.pg_proc
       WHERE oid = 'public.product_variants_price_change_log()'::regprocedure) IS DISTINCT FROM 'search_path=""|true' THEN
    RAISE EXCEPTION '後置閘七:trigger function 不是 SECURITY DEFINER + search_path 空字串';
  END IF;
  RAISE NOTICE '✅ 20260929020000:product_price_changes 與 trigger 建好, 權限檢查通過。';
END
$post$;

COMMIT;
