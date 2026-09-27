-- 20260928030000_m4b_admin_product_attention_fields.sql —— 商品頁乙 A2:後台「要處理」篩選要用的兩個計算欄
-- pcm:idempotent: yes
--   ↑ 重跑同形:兩支函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定,前置閘之前本庫查無此名。
-- ACL-GATE-EXEMPT: public.admin_card_image_missing, public.admin_title_lacks_cjk -- 唯讀計算欄函式,只給 service_role EXECUTE(後台 server 以 service_role 讀);anon / authenticated 全收。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md(M0、片 A2)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- 後台商品列表要有「代表圖待補」「標題無中文字」兩顆篩選,並顯示件數(Sean 2026-09-28 Q2 甲)。
-- · 代表圖待補:同步寫進來的 images 永遠有一張(scripts/rpm-transform.ts:735),沒圖時是供應商的「查無圖片」圖
--   或我們的 /placeholder-product.png(rpm-transform.ts:36)⇒ 不能用「images 是空的」判。
--   前台「無圖排最後」用的是 pcm_card_image_is_placeholder(20260916120000:63),那條規則是一條長正規表示式,
--   PostgREST 篩選語法寫不出一樣的判斷 ⇒ 用計算欄直接呼叫它,前後台是同一份規則。
-- · 標題無中文字:看「客人看到的標題」= 員工改過的優先,去空白規則逐字同 products_public(20260927040000:167)。
-- PostgREST 的計算欄 = 參數是資料表列型別的函式 ⇒ 後台可以直接 ?admin_card_image_missing=is.true 篩選與計數。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_card_image_missing(public.products) RETURNS boolean
--   第一張圖是空的 / 空白 / 佔位圖(pcm_card_image_is_placeholder)/ 我們自己的 /placeholder-product.png
-- public.admin_title_lacks_cjk(public.products) RETURNS boolean
--   客人看到的標題沒有任何中日韓統一漢字(U+4E00–U+9FFF、擴充 A U+3400–U+4DBF)
-- 兩支都是 LANGUAGE sql IMMUTABLE、SECURITY INVOKER(不提權),EXECUTE 只給 service_role。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 只建兩支函式,不動表、不鎖表 ⇒ 任何時段都可以貼。
-- · 後台 A2 那顆碼要在本支貼完之後才推:碼先上 ⇒ 列表照常,但「代表圖待補」「標題無中文字」兩顆的件數靜靜地不顯示,
--   點那兩顆才會「商品列表載入失敗」(匯出同理)。不會寫壞資料,但畫面上不容易看出來。
-- · 回滾:supabase/rollbacks/20260928030000-rollback.sql(DROP FUNCTION;要先退後台碼)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_card_image_is_placeholder(text)') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.pcm_card_image_is_placeholder(text) 不存在(20260916120000 未套用)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.products'::regclass AND attname = 'staff_overrides' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '前置閘失敗 — products.staff_overrides 不存在(20260927040000 未套用)';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_card_image_missing(p public.products)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT public.pcm_card_image_is_placeholder(p.images ->> 0)
      OR (p.images ->> 0) = '/placeholder-product.png';
$fn$;

CREATE OR REPLACE FUNCTION public.admin_title_lacks_cjk(p public.products)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'title', E' \t\r\n　'), ''), p.title)
         !~ '[一-鿿㐀-䶿]';
$fn$;

COMMENT ON FUNCTION public.admin_card_image_missing(public.products) IS
  '商品頁乙 A2(20260928030000):後台「代表圖待補」計算欄。第一張圖空白、佔位圖(pcm_card_image_is_placeholder,與前台無圖排最後同一份規則)或 /placeholder-product.png ⇒ true。EXECUTE 僅 service_role。';
COMMENT ON FUNCTION public.admin_title_lacks_cjk(public.products) IS
  '商品頁乙 A2(20260928030000):後台「標題無中文字」計算欄。客人看到的標題(staff_overrides.title 優先,去空白同 products_public)沒有 U+4E00–9FFF / U+3400–4DBF ⇒ true。EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_card_image_missing(public.products) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_title_lacks_cjk(public.products) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_card_image_missing(public.products) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_title_lacks_cjk(public.products) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_card_image_missing(public.products)',
    'public.admin_title_lacks_cjk(public.products)'
  ]::text[];
  v_name text;
  v_fn   oid;
BEGIN
  FOREACH v_name IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(v_name);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '%:函式沒有建立成功', v_name;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%:anon / authenticated 仍可 EXECUTE', v_name;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%:service_role 沒有 EXECUTE', v_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_fn AND prosecdef) THEN
      RAISE EXCEPTION '%:不應是 SECURITY DEFINER', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 20260928030000:兩支計算欄函式在、只有 service_role 可執行、SECURITY INVOKER';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
