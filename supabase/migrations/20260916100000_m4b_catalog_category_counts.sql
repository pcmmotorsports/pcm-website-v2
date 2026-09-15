-- 20260916100000_m4b_catalog_category_counts.sql —— 分類件數一發 GROUP BY(型錄頁逾時 P1)
-- M-4b · 主視窗 pcm-website-v2-b7 派(版本號主視窗指定);plan:docs/plans/2026-09-15-catalog-timeout-db-plan.md §4 P1
--
-- ══ 起因 ═══════════════════════════════════════════════════
-- 顧客站側欄分類樹 listCategories 逐分類打 `HEAD products_public?category_id=eq.<id>`(count exact)。
-- 2026-09-15 edge_logs 24h:那一形 51,261 次、平均 353ms、合計 18,112 秒 = 其餘端點總和 ~13 倍
-- ⇒ 塞滿 PostgREST 連線 ⇒ 其他型錄查詢排隊到 client 15s 被砍(plan §2 E1–E9)。
-- 5aeee7823 已先限流(同時 6 發);本檔讓它變成一發。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- **只新增**一支 `public.catalog_category_counts()`,不改任何既有函式 / 表 / view。
-- 語意 = 舊法逐字:`count(*) FROM products_public WHERE category_id = <id>`,只是一次 GROUP BY 全部分類。
--   · 讀 products_public(不是 products_list_public:後者 INNER JOIN brands / categories,缺品牌的商品會被少算)
--   · SECURITY INVOKER ⇒ anon 呼叫時照樣吃 products 的 RLS(delisted_at IS NULL),與舊法同一個人看同一份
--   · 只回 (category_id, product_count);沒有商品的分類不回列 ⇒ 前端補 0
--   · product_image_trim.url 是 PK ⇒ view 裡那個 LEFT JOIN 不會讓列變多
--
-- 效能(2026-09-15 正式庫唯讀 EXPLAIN ANALYZE,pcm_readonly 跑同一句 SELECT,不是函式本身):
--   HashAggregate over Seq Scan products 26,491 列 ⇒ 30.9ms、shared hit 8,149、回 86 列
--   (對照:舊法一發 HEAD 在 edge_logs 平均 353ms × 115 發)
--
-- 權限:主視窗派工逐字「anon 可執行、其他全收」⇒ EXECUTE 只給 anon(顧客站 catalog client 是 anon)。
--   兩道 REVOKE(PUBLIC + anon/authenticated 具名)先下,再具名 GRANT anon
--   (docs/patterns/revoking-function-execute-in-supabase.md §1、§3.6)。
--
-- ══ 上線順序 ═══════════════════════════════════════════════
-- 🔴 照 CLAUDE.md「板先貼、APPLIED.tsv 那一列同顆 commit」:TS 那顆(`.rpc('catalog_category_counts')`)
--    在本檔記帳之前推 dev 會被 scripts/deploy-order-gate.sh 擋(adversarial-reviewer R1 nit 1)⇒ 先貼本檔再合 TS。
-- 退回路(PGRST202 / 42883 ⇒ 逐分類 count, 同時 6 發)照樣有用:退回檔跑完之後、PostgREST schema cache 刷新之前、
--    以及貼板到 reload 之間,側欄件數不會壞。
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916100000):新增 1 支 public 函式。
--
-- ══ 拋棄式 PG 驗證 ════════════════════════════════════════════
-- ⚠️ 在「schema dump + 板 178–190」那種空庫上貼,本檔會被自己的事後閘③⓪擋(categories 0 列 ⇒ 行為沒被驗到)。
--    ⇒ 驗證前先塞種子(至少 categories + products 各幾列)再貼。正式庫 categories 115 列不受影響。
--
-- ══ rollback ════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句,rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260916100000-rollback.sql:DROP FUNCTION。無資料寫入;程式會自己退回逐分類 count。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 事後閘會對正式資料逐分類各 count 一次(115 發,走 idx_products_category_id)⇒ 給 60s 上界
SET LOCAL statement_timeout = '60s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.catalog_category_counts()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:catalog_category_counts() 已存在 ⇒ 本檔貼過了且沒退, 停下人工對齊';
  END IF;
  IF pg_catalog.to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘二:public.products_public 不存在';
  END IF;
  IF (SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.products_public'::regclass AND a.attname = 'category_id' AND NOT a.attisdropped)
     IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION '前置閘三:products_public.category_id 不在或不是 uuid';
  END IF;
  -- 🔵 用 pg_options_to_table 讀選項, 不寫 `security_invoker` 等號字面:invoker-view-execute-gate 會把那串字當成本檔在建 invoker view
  IF (SELECT o.option_value
        FROM pg_catalog.pg_class c, LATERAL pg_catalog.pg_options_to_table(c.reloptions) o
       WHERE c.oid = 'public.products_public'::regclass AND o.option_name = 'security_invoker')
     IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '前置閘四:products_public 的 security_invoker 選項不是 true ⇒ anon 會繞過 RLS 數到下架商品, 停';
  END IF;
END
$pre$;

-- 🔴 用 CREATE, 不用 CREATE OR REPLACE:撞名要報錯停下(pattern §3.2)。
CREATE FUNCTION public.catalog_category_counts()
RETURNS TABLE (category_id uuid, product_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.category_id, count(*)
    FROM public.products_public p
   WHERE p.category_id IS NOT NULL
   GROUP BY p.category_id;
$fn$;

COMMENT ON FUNCTION public.catalog_category_counts() IS
  '顧客站側欄分類件數(20260916100000;型錄頁逾時 P1)。= 逐分類 count(*) FROM products_public WHERE category_id=<id> 的一發版;'
  ' SECURITY INVOKER ⇒ 吃呼叫者的 RLS(anon 只數上架)。沒有商品的分類不回列。EXECUTE 只給 anon。';

-- ── 權限:兩道 REVOKE 都下, 再具名 GRANT ─────────────────────────────────────
-- ACL-GATE-EXEMPT: public.catalog_category_counts -- 顧客站側欄分類件數, listCategories 用 anon client 呼叫 ⇒ anon 必須能執行;INVOKER 讀公開投影 products_public、只回分類 id 與件數(主視窗 b7 2026-09-15 派工「anon 可執行、其他全收」, 20260916100000)
REVOKE ALL ON FUNCTION public.catalog_category_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_category_counts() FROM service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.catalog_category_counts() TO anon;

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;裸 CREATE FUNCTION 1 支)
  v_functions text[] := ARRAY['public.catalog_category_counts()']::text[];
  c_fn     regprocedure := v_functions[1]::regprocedure;
  r        record;
  v_cats   integer;
  v_n      integer := 0;
  v_extra  integer;
BEGIN
  -- ① 屬性
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = c_fn) THEN
    RAISE EXCEPTION '事後閘①a:變成 SECURITY DEFINER 了 ⇒ 停';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = c_fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION '事後閘①b:search_path 不是 public, pg_temp(實得 %)',
      (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = c_fn);
  END IF;
  IF pg_catalog.pg_get_function_result(c_fn) IS DISTINCT FROM 'TABLE(category_id uuid, product_count bigint)' THEN
    RAISE EXCEPTION '事後閘①c:回傳型別不是 TABLE(category_id uuid, product_count bigint)';
  END IF;

  -- ② ACL:只准 postgres(owner)/ anon;PUBLIC 不准;proacl 不得是 NULL(pattern §3.6)
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = c_fn) IS NULL THEN
    RAISE EXCEPTION '事後閘②a:proacl 是 NULL ⇒ 等於 PUBLIC 可執行';
  END IF;
  FOR r IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS who
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = c_fn AND a.privilege_type = 'EXECUTE'
  LOOP
    IF r.who NOT IN ('postgres', 'anon') THEN
      RAISE EXCEPTION '事後閘②b:% 持有 EXECUTE ⇒ 名單外', r.who;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('anon', c_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②c:anon 拿不到 EXECUTE ⇒ 顧客站會一直走退回路';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', c_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', c_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②d:authenticated / service_role 執行得到 ⇒ 與派工「其他全收」不符';
  END IF;

  -- ③ 行為閘:對這個庫的資料, 每一個分類都比「函式的件數(沒回列 = 0)」與「舊法逐分類 count」
  --    兩邊同一個角色跑(貼板角色)⇒ 比的是述詞相同, 不是 RLS。不一致 ⇒ 整支回滾。
  SELECT pg_catalog.count(*) INTO v_cats FROM public.categories;
  IF v_cats = 0 THEN
    RAISE EXCEPTION '事後閘③⓪:categories 0 列 ⇒ 行為沒有被驗到 ⇒ 停';
  END IF;
  FOR r IN
    SELECT c.id,
           coalesce(f.product_count, 0) AS got,
           (SELECT pg_catalog.count(*) FROM public.products_public p WHERE p.category_id = c.id) AS want
      FROM public.categories c
      LEFT JOIN public.catalog_category_counts() f ON f.category_id = c.id
  LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION '事後閘③a:分類 % ⇒ 函式 % ≠ 逐分類 count %', r.id, r.got, r.want;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> v_cats THEN
    RAISE EXCEPTION '事後閘③b:比對了 % 個分類(期望 %)', v_n, v_cats;
  END IF;
  -- 函式回的分類必須都在 categories 裡(FK 保證;沒有就代表 view 投影變了)
  SELECT pg_catalog.count(*) INTO v_extra
    FROM public.catalog_category_counts() f
   WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = f.category_id);
  IF v_extra <> 0 THEN
    RAISE EXCEPTION '事後閘③c:函式回了 % 個不在 categories 的分類', v_extra;
  END IF;

  RAISE NOTICE '✅ catalog_category_counts 事後閘全過:屬性 3 · ACL 4 · 行為 % 個分類逐一相符', v_n;
END
$post$;

-- PostgREST 重讀 schema(交易內 ⇒ COMMIT 時才送)
NOTIFY pgrst, 'reload schema';

COMMIT;
