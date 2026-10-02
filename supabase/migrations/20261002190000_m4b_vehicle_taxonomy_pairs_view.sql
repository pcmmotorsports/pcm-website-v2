-- 20261002190000_m4b_vehicle_taxonomy_pairs_view.sql —— 車款精簡版:改讀「沿索引跳著讀」的相異(廠牌, 車型)view
-- 主視窗 pcm-website-v2-ce 2026-10-02 裁甲(加速類、結果不變;權限屬 DB 內部, 照 Sean 0919 劃線由主視窗裁)。
--   計畫:~/pcm-mailbox/計畫-車款精簡版加速-20261002.md(Fable R1 FAIL 一個必修:新寫法若直接讀表會套 RLS、少 19 組 ⇒ 改成本支的新 view)。
--   板列 ⟦db-TAXONOMYVIEW⟧。
--
-- 量到的(2026-10-02 正式庫唯讀):
--   現在 get_vehicle_taxonomy_base() = 對 vehicle_taxonomy_public 做 DISTINCT(廠牌, 車型)⇒ 每次掃 product_fitments 20 萬列,
--   熱 256–512 ms(shared hit 167,344);正式站冷取 2.2–3.7 秒, 今天 09:55 撞 anon 3 秒上限一次(Vercel log)。
--   新寫法(兩張表各用遞迴 CTE 沿 ix_pf_lookup / ix_pfe_lookup 跳)熱 136 ms(shared hit 28,455)、4,007 組逐字相同。
--   ⚠️ product_fitments 的 visibility map 約 49% ⇒ 冷的時候仍會回表讀一部分, 不是「只讀索引」;product_fitments_effective 才幾乎全在索引裡。
--
-- 改什麼:
--   ① 新建 view public.vehicle_taxonomy_pairs_v(security_invoker = false, owner postgres)——
--      🔴 security_invoker = false 是承重的:跟現在的 vehicle_taxonomy_public 同一個理由, 讀底表時用 owner 身分、不套 RLS
--      (底表 RLS 只給「上架商品」看 ⇒ 若用 invoker 身分讀, 只剩下架商品的車款會消失, 正式庫實查 4,007 → 3,988)。
--      只有 moto_brand、model_code 兩欄, 不帶 product_id 或任何商品欄(同 vehicle_taxonomy_public 的紅線)。
--   ② get_vehicle_taxonomy_base() 本體改讀①(CREATE OR REPLACE;簽章、STABLE、SET search_path、owner、EXECUTE 名單都不變)。
-- 權限:新 view 兩道 REVOKE 後只 GRANT SELECT 給 anon、authenticated(函式是 invoker, 客人呼叫時要讀得到它)、service_role、pcm_readonly(有才給)。
-- 結果不變的證明:同一個交易裡先存貼前輸出(postgres 身分 + anon 身分各一份), 貼後兩種身分都要與貼前逐字相同(事後閘④⑤)。
-- 影響:函式簽章不變 ⇒ 貼板和推程式沒有先後問題, 程式不用改。
-- 還原:supabase/rollbacks/20261002190000-rollback.sql(函式換回 95ce06b5… 本體, DROP 新 view)。
-- 驗證:scripts/20261002190000-verify.sh(拋棄式 PG, 非 superuser 貼, 有下架商品與 RLS 的資料)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF pg_catalog.to_regprocedure('public.get_vehicle_taxonomy_base()') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.get_vehicle_taxonomy_base() 不存在 ⇒ 停';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '95ce06b5a052d51763c6eeba540670b5' THEN
    RAISE EXCEPTION '前置閘①:車款精簡版本體 md5 = %, 不是 95ce06b5a052d51763c6eeba540670b5(已貼過或底已經換了)', v_md5;
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure)
     OR (SELECT p.provolatile FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure) <> 's'
     OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure) IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION '前置閘②:車款精簡版不是 invoker / STABLE / search_path 空字串 / owner postgres 其中一項';
  END IF;
  IF pg_catalog.to_regclass('public.vehicle_taxonomy_pairs_v') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:public.vehicle_taxonomy_pairs_v 已經存在 ⇒ 撞名, 停';
  END IF;
  -- 沿索引跳著讀依賴兩欄都沒有 NULL(row comparison 遇到 NULL 會提早停)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid IN ('public.product_fitments'::regclass, 'public.product_fitments_effective'::regclass)
                AND a.attname IN ('moto_brand', 'model_code') AND NOT a.attnotnull) THEN
    RAISE EXCEPTION '前置閘④:product_fitments / product_fitments_effective 的 moto_brand、model_code 不是 NOT NULL ⇒ 跳著讀會漏, 停';
  END IF;
  IF pg_catalog.to_regclass('public.ix_pf_lookup') IS NULL OR pg_catalog.to_regclass('public.ix_pfe_lookup') IS NULL THEN
    RAISE EXCEPTION '前置閘⑤:ix_pf_lookup / ix_pfe_lookup 不在 ⇒ 跳著讀沒有索引可走, 停';
  END IF;
END
$pre$;

-- 貼前快照:postgres 身分與 anon 身分各一份(客人是 anon;兩者今天應相同)
CREATE TEMP TABLE zz_tax_before ON COMMIT DROP AS SELECT public.get_vehicle_taxonomy_base() AS j;
SET LOCAL ROLE anon;
CREATE TEMP TABLE zz_tax_before_anon ON COMMIT DROP AS SELECT public.get_vehicle_taxonomy_base() AS j;
SET LOCAL ROLE postgres;  -- 不用 RESET ROLE(scripts/migration-reset-role-guard.sh:CLI 貼時會掉回 session_user)

CREATE VIEW public.vehicle_taxonomy_pairs_v
  WITH (security_invoker = false) AS
WITH RECURSIVE
  a AS (
    (SELECT f.moto_brand, f.model_code FROM public.product_fitments f ORDER BY f.moto_brand, f.model_code LIMIT 1)
    UNION ALL
    SELECT n.moto_brand, n.model_code
      FROM a CROSS JOIN LATERAL (
        SELECT f.moto_brand, f.model_code FROM public.product_fitments f
         WHERE (f.moto_brand, f.model_code) > (a.moto_brand, a.model_code)
         ORDER BY f.moto_brand, f.model_code LIMIT 1) n
  ),
  b AS (
    (SELECT e.moto_brand, e.model_code FROM public.product_fitments_effective e ORDER BY e.moto_brand, e.model_code LIMIT 1)
    UNION ALL
    SELECT n.moto_brand, n.model_code
      FROM b CROSS JOIN LATERAL (
        SELECT e.moto_brand, e.model_code FROM public.product_fitments_effective e
         WHERE (e.moto_brand, e.model_code) > (b.moto_brand, b.model_code)
         ORDER BY e.moto_brand, e.model_code LIMIT 1) n
  )
SELECT a.moto_brand, a.model_code FROM a
UNION
SELECT b.moto_brand, b.model_code FROM b;
ALTER VIEW public.vehicle_taxonomy_pairs_v OWNER TO postgres;
COMMENT ON VIEW public.vehicle_taxonomy_pairs_v IS
  '車款精簡版用的相異(廠牌, 車型)(20261002190000):兩張 fitments 表各沿 (moto_brand, model_code, …) 索引跳著讀, 不整份掃。'
  '🔴 security_invoker=false 是刻意的, 理由同 vehicle_taxonomy_public:不套底表 RLS 的下架 join(用 invoker 身分會少只剩下架商品的車款)。'
  '⛔ 不得加 product_id 或任何商品欄 —— 那會讓本 view 變成繞過 RLS 的商品查詢路徑。'
  '⚠️ 跳著讀依賴兩張表的 moto_brand、model_code 都是 NOT NULL(遇到 NULL 會提早停、漏組);拿掉 NOT NULL 前要先改本 view。';

-- ══ 收權:兩道 REVOKE 再 GRANT(docs/patterns/revoking-function-execute-in-supabase.md §1, 表 / view 版)══
REVOKE ALL ON public.vehicle_taxonomy_pairs_v FROM PUBLIC;
REVOKE ALL ON public.vehicle_taxonomy_pairs_v FROM anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.vehicle_taxonomy_pairs_v -- 車款精簡版 get_vehicle_taxonomy_base() 是 invoker, 顧客站客人(anon)呼叫時要讀得到它;只有(廠牌, 車型)兩欄, 比照 vehicle_taxonomy_public 現有 anon/authenticated SELECT(2026-10-02 唯讀實查);主視窗 pcm-website-v2-ce 2026-10-02 裁甲(20261002190000)
GRANT SELECT ON public.vehicle_taxonomy_pairs_v TO anon, authenticated, service_role;
DO $ro$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly') THEN
    EXECUTE 'GRANT SELECT ON public.vehicle_taxonomy_pairs_v TO pcm_readonly';
  END IF;
END $ro$;

CREATE OR REPLACE FUNCTION public.get_vehicle_taxonomy_base()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  -- 🆕 20261002190000:改讀 `vehicle_taxonomy_pairs_v`(沿索引跳著讀的相異(廠牌, 車型)), 不再對 `vehicle_taxonomy_public`
  --    做 DISTINCT —— 舊寫法每次把 product_fitments 20 萬列整份掃一遍(正式庫唯讀 EXPLAIN 熱 256–512 ms, 冷取 2.2–3.7 秒、
  --    偶爾撞 anon 3 秒上限)。🔴 結果逐字不變:同一組(廠牌, 車型)、同一個排序、年份兩欄一律 NULL。
  -- 🔵 `MATERIALIZED` 讓聚合只算一次(照舊那支的做法)。
  WITH r AS MATERIALIZED (
    SELECT COALESCE(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_array(d.moto_brand, d.model_code, NULL, NULL)
               ORDER BY d.moto_brand, d.model_code),
             '[]'::jsonb) AS rows_json
      FROM public.vehicle_taxonomy_pairs_v d
  )
  SELECT pg_catalog.jsonb_build_object(
           'n', pg_catalog.jsonb_array_length(r.rows_json),
           'rows', r.rows_json)
    FROM r;
$fn$;

DO $post$
DECLARE
  -- 收權斷言清單(migration-static-checks 規則③):本支新增的可授權物件
  v_relations text[] :=ARRAY['public.vehicle_taxonomy_pairs_v']::text[];
  v_md5    text;
  v_before jsonb;
  v_after  jsonb;
  v_anon   jsonb;
BEGIN
  -- ① 函式本體換成新的、屬性不變
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '377aebadd8ee0fb5e1c2999eb485389f' THEN
    RAISE EXCEPTION '事後閘①:車款精簡版本體 md5 = %, 不是 377aebadd8ee0fb5e1c2999eb485389f', v_md5;
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure)
     OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure) IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION '事後閘①:車款精簡版的 invoker / search_path 被改了';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', 'public.get_vehicle_taxonomy_base()'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_vehicle_taxonomy_base()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①:anon / authenticated 叫不動車款精簡版';
  END IF;
  -- ② 新 view:owner postgres、security_invoker=false、PUBLIC 收乾淨、anon 讀得到但寫不了
  IF (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c WHERE c.oid = 'public.vehicle_taxonomy_pairs_v'::regclass) <> 'postgres'
     OR NOT ((SELECT c.reloptions FROM pg_catalog.pg_class c WHERE c.oid = 'public.vehicle_taxonomy_pairs_v'::regclass) @> ARRAY['security_invoker=false']) THEN
    RAISE EXCEPTION '事後閘②:新 view 的 owner 不是 postgres 或 security_invoker 不是 false';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
                   LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) x
              WHERE c.oid = 'public.vehicle_taxonomy_pairs_v'::regclass AND x.grantee = 0) THEN
    RAISE EXCEPTION '事後閘②:新 view 的 PUBLIC 權限沒有收掉';
  END IF;
  IF NOT pg_catalog.has_table_privilege('anon', 'public.vehicle_taxonomy_pairs_v', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.vehicle_taxonomy_pairs_v', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.vehicle_taxonomy_pairs_v', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.vehicle_taxonomy_pairs_v', 'DELETE') THEN
    RAISE EXCEPTION '事後閘②:anon 對新 view 的權限不是「只能讀」';
  END IF;
  -- ③ 不得是空的
  SELECT j INTO v_before FROM zz_tax_before;
  IF v_before IS NULL OR (v_before ->> 'n')::integer = 0 THEN
    RAISE EXCEPTION '事後閘③:貼前快照是空的 ⇒ 下面兩格沒有判別力, 停';
  END IF;
  -- ④ postgres 身分:貼後輸出與貼前逐字相同
  v_after := public.get_vehicle_taxonomy_base();
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '事後閘④:postgres 身分貼前 % 組、貼後 % 組, 輸出不一樣 ⇒ 結果變了, 停',
      v_before ->> 'n', v_after ->> 'n';
  END IF;
END
$post$;

-- ⑤ anon 身分(客人):貼後輸出與貼前逐字相同 —— Fable R1 必修:RLS 只在這個身分下才看得到差別
SET LOCAL ROLE anon;
CREATE TEMP TABLE zz_tax_after_anon ON COMMIT DROP AS SELECT public.get_vehicle_taxonomy_base() AS j;
SET LOCAL ROLE postgres;  -- 不用 RESET ROLE(scripts/migration-reset-role-guard.sh:CLI 貼時會掉回 session_user)
DO $post_anon$
DECLARE v_b jsonb; v_a jsonb; v_p jsonb;
BEGIN
  SELECT j INTO v_b FROM zz_tax_before_anon;
  SELECT j INTO v_a FROM zz_tax_after_anon;
  SELECT j INTO v_p FROM zz_tax_before;
  IF v_b IS DISTINCT FROM v_p THEN
    RAISE EXCEPTION '事後閘⑤a:貼前 anon(% 組)與 postgres(% 組)就不一樣 ⇒ 底和預期不同, 停', v_b ->> 'n', v_p ->> 'n';
  END IF;
  IF v_a IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION '事後閘⑤b:anon 身分貼前 % 組、貼後 % 組 ⇒ 客人看到的車款變了(多半是 RLS 套上去了), 停',
      v_b ->> 'n', v_a ->> 'n';
  END IF;
END
$post_anon$;

COMMIT;
