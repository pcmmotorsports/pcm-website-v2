-- 20260928200000_m4b_variant_sale_price.sql —— 商品頁乙 P2(P-M1):規格特價欄 + 「實際一般價」共用函式
-- pcm:idempotent: no
--   ↑ forward-only:欄已存在由前置閘拒重跑。拋棄式 PG 實跑:套用 → 同步式 upsert 後特價不變 → 退回(只清資料)→ 見 commit message。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第八節(P-M1、片 P2)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 2026-09-28 Q1 乙:價格放進商品頁乙計畫,包含「特價」(同步商品與手動商品都可以用,只有主管能設)。
-- 同步每天覆寫 product_variants.price_general(scripts/rpm-transform.ts:842)⇒ 特價要另開一欄,同步送出的欄位裡沒有它
-- (20260825120000:346–356 的 ON CONFLICT SET 沒有這欄;rpm-import.ts:1348 只寫 payload 欄)。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- ① product_variants.sale_price_general integer NULL + CHECK(IS NULL OR > 0)
--    欄位可空、沒有預設值 ⇒ 只改目錄、不重寫整表;CHECK 要掃一次全表(規格表約 5 萬列,20260819 量級)。
-- ② public.pcm_effective_general_price(p_price_general integer, p_sale_price_general integer) RETURNS integer IMMUTABLE
--    = 客人實際付的一般價:
--      · 一般價是空的 ⇒ 空(照今天的規則不能買:create_order 對空單價擋單,20260926100000:574)
--        🔴 不能用 LEAST:PostgreSQL 的 LEAST 會略過空值,一般價空的時候會回特價(計畫 R6-1)。
--      · 特價是空的,或特價不低於一般價 ⇒ 一般價
--      · 否則 ⇒ 特價
-- 🔴 這一支【只加欄位和函式】:任何讀價出口(view、create_order、前台)都還沒讀它 ⇒ 貼了對客人零影響。
--    讀價出口在 P-M4 才一起換(同一個交易)。
-- 🔴 設特價不會更新 content_changed_at(那支 trigger 的欄位清單沒有它,20260915220000:140–142),這是刻意的。
--
-- ══ 權限 ══════════════════════════════════════════
-- · 欄位:product_variants 對 anon / authenticated 是欄位級 GRANT SELECT(20260531142533:83)⇒ 本支【不】授權新欄,
--   P-M4 換 view 時才一起授權。service_role 本來就讀得到整張表。
-- · 函式:本支只給 service_role EXECUTE;anon / authenticated 在 P-M4 換 view 時才授權(view 是 security_invoker)。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · ALTER TABLE 會短暫鎖規格表,ADD CONSTRAINT 要掃一次全表。避開每日同步(台灣 12:30 起約 10–15 分)與客人多的時段。
-- · 回滾:supabase/rollbacks/20260928200000-rollback.sql —— 只清資料(特價全部清空),【不 DROP 欄位與函式】:
--   P-M4 之後的 create_order 會讀這欄和這支函式,DROP 掉每一張訂單都會在建單時失敗(計畫 R4-1)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.product_variants'::regclass
                AND attname = 'sale_price_general' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘①:product_variants.sale_price_general 已存在 ⇒ forward-only, 拒重跑';
  END IF;
  IF pg_catalog.format_type(
       (SELECT atttypid FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public.product_variants'::regclass AND attname = 'price_general' AND NOT attisdropped), NULL)
     IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION '前置閘②:product_variants.price_general 不是 integer ⇒ 特價欄型別要跟它一樣, 部署態與預期不符';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_effective_general_price(integer, integer)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:pcm_effective_general_price 已存在 ⇒ forward-only, 拒重跑';
  END IF;
END
$pre$;

ALTER TABLE public.product_variants
  ADD COLUMN sale_price_general integer;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_sale_price_general_positive
    CHECK (sale_price_general IS NULL OR sale_price_general > 0);

COMMENT ON COLUMN public.product_variants.sale_price_general IS
  '特價(一般會員,含稅整數元)。空 = 沒有特價。每日同步不寫這欄;只由 admin_set_variant_prices(主管)設或清。
客人實際付的一般價一律用 pcm_effective_general_price(price_general, sale_price_general),不要自己取較小值(一般價空時要維持不能買)。
經銷會員不吃特價(Sean 2026-09-28 Q-P2 乙)。';

CREATE FUNCTION public.pcm_effective_general_price(p_price_general integer, p_sale_price_general integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN p_price_general IS NULL THEN NULL
           WHEN p_sale_price_general IS NULL OR p_sale_price_general >= p_price_general THEN p_price_general
           ELSE p_sale_price_general
         END;
$fn$;

COMMENT ON FUNCTION public.pcm_effective_general_price(integer, integer) IS
  '商品頁乙 P-M1(20260928200000):客人實際付的一般價。一般價空 ⇒ 空(不能買);特價空或不低於一般價 ⇒ 一般價;否則特價。
用 CASE 不用 LEAST(LEAST 會略過空值)。結帳與所有 view 都呼叫這一支,不各自計算。';

REVOKE ALL ON FUNCTION public.pcm_effective_general_price(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_effective_general_price(integer, integer) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.pcm_effective_general_price(integer, integer)']::text[];
  v_fn   oid;
  v_def  text;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '事後閘①:pcm_effective_general_price 沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②:anon / authenticated 仍可 EXECUTE(要等 P-M4 才授權)';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘③:service_role 沒有 EXECUTE';
  END IF;
  -- 行為閘:四種情況逐一驗(一般價空 ⇒ 空,不能被特價頂上)
  IF public.pcm_effective_general_price(NULL, 500) IS NOT NULL THEN
    RAISE EXCEPTION '事後閘④:一般價空時沒有回空(會讓舊特價頂上去賣)';
  END IF;
  IF public.pcm_effective_general_price(1000, NULL) IS DISTINCT FROM 1000
     OR public.pcm_effective_general_price(1000, 800) IS DISTINCT FROM 800
     OR public.pcm_effective_general_price(1000, 1200) IS DISTINCT FROM 1000
     OR public.pcm_effective_general_price(1000, 1000) IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION '事後閘⑤:實際一般價算錯';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.product_variants'::regclass AND c.conname = 'product_variants_sale_price_general_positive';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, '> 0') = 0 THEN
    RAISE EXCEPTION '事後閘⑥:特價 CHECK 不見了或定義不對(實際 %)', v_def;
  END IF;
  IF pg_catalog.has_column_privilege('anon', 'public.product_variants', 'sale_price_general', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.product_variants', 'sale_price_general', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑦:anon / authenticated 已經讀得到特價欄(要等 P-M4 才授權)';
  END IF;
  RAISE NOTICE '✅ 20260928200000:特價欄 + CHECK、pcm_effective_general_price(四種情況行為正確)、只有 service_role 可用';
END
$post$;

COMMIT;
