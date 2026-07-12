-- =============================================================================
-- S1 變體補足 · 完整 apply SQL(Sean 手動於各庫 SQL Editor 執行)
-- 2026-07-12 · 已過 adversarial-reviewer + codex(gpt-5.6-sol)兩輪對抗審 + 真資料驗證
-- 修正輪次:adversarial F1/F2/F3/F6 → codex must-fix#2/#4/#5/#6 全數收斂(見各處註)
-- 執行順序:先 PART 1(報價單 B庫)→ 再 PART 2(網站庫)。兩庫互不跨查、可各自 apply。
-- 回滾:全部可 DROP,products.fitments / product_fitments / product_groups_v 原始物件皆未動。
-- ★ 待 Sean 拍板 codex#1(見末)後定案 apply ★
-- =============================================================================


-- #############################################################################
-- PART 1 · 報價單 B庫  dllwkkfanaebrsuyuedy
-- 新增對外 view;只給 service_role(網站每日同步讀),不開 anon/PUBLIC。
-- #############################################################################

CREATE OR REPLACE VIEW storefront_fitments_v
WITH (security_invoker = true)
AS
SELECT DISTINCT
  g.supplier_slug,
  g.main_sku,
  elem->>'brand' AS moto_brand,
  elem->>'model' AS model_code,
  g.year_start,
  CASE WHEN g.year_start IS NULL THEN NULL ELSE g.year_end END AS year_end,
  CASE WHEN elem->>'model' = ANY(g.all_models) THEN 'direct' ELSE 'inherited' END AS match_source,
  CASE WHEN elem->>'model' = ANY(g.all_models) THEN elem->>'model' ELSE fc.ancestor END AS source_model_code
FROM product_groups_v g
-- codex#4/F1:jsonb_array_elements + 逐元素守衛(擋陣列內 scalar/缺 brand·model 髒元素,對齊 sibling 20260708130000)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(g.search_vehicles) = 'array' THEN g.search_vehicles ELSE '[]'::jsonb END
) AS elem
LEFT JOIN LATERAL (
   SELECT c.ancestor
   FROM model_family_closure_v c
   WHERE c.brand = elem->>'brand'
     AND c.descendant = elem->>'model'
     AND c.ancestor = ANY(g.all_models)
   ORDER BY c.depth ASC
   LIMIT 1
) fc ON true
WHERE jsonb_typeof(elem) = 'object'
  AND jsonb_typeof(elem->'brand') = 'string'
  AND jsonb_typeof(elem->'model') = 'string'
  AND btrim(elem->>'brand') <> ''
  AND btrim(elem->>'model') <> ''
  -- codex#4/F2 fail-closed:inherited 必須能追溯母款、否則丟棄(不偽造 provenance);direct 恆通過
  AND (elem->>'model' = ANY(g.all_models) OR fc.ancestor IS NOT NULL);

-- codex#5:自包含權限——REVOKE PUBLIC + 顯式 GRANT service_role(CREATE OR REPLACE 可能保留舊 ACL)
REVOKE ALL ON storefront_fitments_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON storefront_fitments_v TO service_role;

-- apply 後驗證(應回 7 列:MT-09 direct + 6 繼承含 MT-09 SP,年份 2021-2026):
--   SELECT * FROM storefront_fitments_v WHERE main_sku = 'Y016' ORDER BY match_source DESC, model_code;
-- 權限驗證(應顯示 service_role 有、anon/authenticated 無):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='storefront_fitments_v';


-- #############################################################################
-- PART 2 · 網站庫  bmpnplmnldofgaohnaok
-- effective 車款表(direct+inherited 超集,每日同步灌)+ 車款搜尋 RPC。
-- ★不碰 product_fitments(推薦引擎)、不碰 products.fitments(原始 provenance)★
-- #############################################################################

-- ── 2A. 表 + 索引 + CHECK(codex#6 補 interval/非空白/provenance)──
CREATE TABLE product_fitments_effective (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  moto_brand        text NOT NULL,
  model_code        text NOT NULL,
  year_start        int,
  year_end          int,
  match_source      text NOT NULL,
  source_model_code text NOT NULL,
  CONSTRAINT pfe_year_state_valid    CHECK (year_start IS NOT NULL OR year_end IS NULL),
  CONSTRAINT pfe_year_interval_valid CHECK (year_start IS NULL OR year_end IS NULL OR year_end >= year_start),
  CONSTRAINT pfe_match_source_valid  CHECK (match_source IN ('direct','inherited')),
  CONSTRAINT pfe_nonblank_valid      CHECK (btrim(moto_brand) <> '' AND btrim(model_code) <> '' AND btrim(source_model_code) <> ''),
  -- provenance 完整性:direct 來源=自身;inherited 來源≠自身(對齊 view fail-closed 輸出)
  CONSTRAINT pfe_provenance_valid    CHECK (
    (match_source = 'direct'    AND source_model_code =  model_code) OR
    (match_source = 'inherited' AND source_model_code <> model_code))
);

CREATE UNIQUE INDEX ux_pfe_row ON product_fitments_effective
  (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT;
CREATE INDEX ix_pfe_lookup  ON product_fitments_effective (moto_brand, model_code, year_start, year_end);
CREATE INDEX ix_pfe_product ON product_fitments_effective (product_id);

COMMENT ON TABLE product_fitments_effective IS
  '展開後(direct+inherited)車款索引。來源=報價單 storefront_fitments_v 每日 staging-snapshot 同步(service_role 寫、單交易替換)。車款搜尋讀此表;product_fitments(direct、trigger 衍生)另供推薦引擎。可 DROP 重建。';

-- ── 2B. RLS(delisted 連動隱藏,照 product_fitments 範式)──
ALTER TABLE product_fitments_effective ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_fitments_effective_select_public ON product_fitments_effective;
CREATE POLICY product_fitments_effective_select_public
  ON product_fitments_effective
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = product_fitments_effective.product_id
      AND p.delisted_at IS NULL
  ));

-- codex#5:自包含權限——REVOKE 預設 over-grant、只開 anon/authenticated SELECT、顯式 service_role DML
REVOKE ALL PRIVILEGES ON TABLE product_fitments_effective FROM PUBLIC, anon, authenticated;
GRANT SELECT ON product_fitments_effective TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_fitments_effective TO service_role;

-- ── 2C. 車款搜尋 RPC(product_fitments ∪ 新表 去重;回傳形狀對齊 mapper)──
-- codex#8:schema-qualify + 固定 search_path(降名稱解析/schema 漂移風險)。
-- codex#2:★消費端必須分頁★——PostgREST 對 SETOF RPC 套 Max Rows=1000,品牌-only(p_model NULL)可能破千被靜默截斷。
--   RPC 已備穩定 ORDER BY p.id;adapter 需用 .range() 迴圈撈全(比照既有 fetchAllPaginated),不可假設單次呼叫回全部。
CREATE OR REPLACE FUNCTION search_products_by_vehicle(
  p_brand text,
  p_model text DEFAULT NULL,
  p_year  int  DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH matched AS (
    SELECT product_id FROM public.product_fitments
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
    UNION
    SELECT product_id FROM public.product_fitments_effective
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
  )
  SELECT jsonb_build_object(
    'id', p.id, 'external_id', p.external_id, 'title', p.title, 'subtitle', p.subtitle,
    'description', p.description, 'highlights', p.highlights, 'manuals', p.manuals,
    'video_url', p.video_url, 'handle', p.handle, 'fitments', p.fitments,
    'images', p.images, 'availability', p.availability,
    'brand_id', p.brand_id, 'category_id', p.category_id, 'price_general', p.price_general,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'brands', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                                 'premium_extra_pct', b.premium_extra_pct),
    'categories', jsonb_build_object('raw_path', c.raw_path, 'segments', c.segments)
  )
  FROM public.products_public p
  JOIN matched      m ON m.product_id = p.id
  -- F6:INNER JOIN 刻意(壞資料商品靜默漏 > 500 整頁);brand_id/category_id 為 FK 正常不為 NULL
  JOIN public.brands     b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  ORDER BY p.id;   -- 穩定序,支援消費端 .range() 分頁
$fn$;

REVOKE ALL ON FUNCTION search_products_by_vehicle(text,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_products_by_vehicle(text,text,int) TO anon, authenticated, service_role;

-- =============================================================================
-- ★ apply 後表是空的屬正常 ★:等每日同步管線(下一步、跨報價單 repo)灌資料後 RPC 才回結果。
-- 同步管線規格(codex#3,寫在管線階段):
--   staging snapshot → 驗 orphan/重複/CHECK/筆數異常率 → 超門檻 rollback 保舊快照
--   → 單交易替換正式表 → 清除「來源已零列」的商品舊列 → 記錄 last-success/rowcount/orphan + 告警。
-- =============================================================================


-- #############################################################################
-- PART 3 · 網站庫 · 同步管線三件套(2026-07-12 第二 session、Claude 經 MCP 已 apply)
-- staging 表 + sync log 表 + reset/commit 兩支 service_role-only RPC。
-- 消費端 = 報價單 repo scripts/sync_storefront_fitments.py(直連 B庫讀 view、REST 寫網站庫;
--   每日 launchd 16:10 = launchd/com.pcm.storefront-fitments-sync.plist)。
-- 過 adversarial-reviewer 三輪(R1 FAIL:F1 supplier 歸零/F2 併發互踩 → R2 FAIL:
--   N8 誤判/函式級 timeout 無效 → R3 PASS);首次真跑 0→103237 列成功。
-- 踩坑註:①PostgREST 連線掛 safeupdate → 函式內全表 DELETE 必須帶 WHERE true(否則 21000)
--   ②authenticator statement_timeout=8s、函式級 SET 不重新武裝已起跑計時器 →
--     ALTER ROLE service_role SET statement_timeout='300s'(rolconfig 由 PostgREST 逐請求套用)。
-- #############################################################################

CREATE TABLE product_fitments_effective_staging (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  moto_brand        text NOT NULL,
  model_code        text NOT NULL,
  year_start        int,
  year_end          int,
  match_source      text NOT NULL,
  source_model_code text NOT NULL,
  run_id            uuid NOT NULL,  -- F2:每 run 一 uuid;commit 驗全屬本 run、併發互踩必 abort
  CONSTRAINT pfes_year_state_valid    CHECK (year_start IS NOT NULL OR year_end IS NULL),
  CONSTRAINT pfes_year_interval_valid CHECK (year_start IS NULL OR year_end IS NULL OR year_end >= year_start),
  CONSTRAINT pfes_match_source_valid  CHECK (match_source IN ('direct','inherited')),
  CONSTRAINT pfes_nonblank_valid      CHECK (btrim(moto_brand) <> '' AND btrim(model_code) <> '' AND btrim(source_model_code) <> ''),
  CONSTRAINT pfes_provenance_valid    CHECK (
    (match_source = 'direct'    AND source_model_code =  model_code) OR
    (match_source = 'inherited' AND source_model_code <> model_code))
);
CREATE UNIQUE INDEX ux_pfes_row ON product_fitments_effective_staging
  (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT;
ALTER TABLE product_fitments_effective_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE product_fitments_effective_staging FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_fitments_effective_staging TO service_role;

CREATE TABLE product_fitments_effective_sync_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL CHECK (status IN ('success','abort')),
  source_rows int,
  staged_rows int,
  orphan_rows int,
  old_count   int,
  new_count   int,
  note        text,
  run_id      uuid  -- N8/F-R2-1:腳本以 run_id 精確判「commit 回應遺失但實已成功」
);
ALTER TABLE product_fitments_effective_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE product_fitments_effective_sync_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON product_fitments_effective_sync_log TO service_role;

CREATE OR REPLACE FUNCTION pfe_staging_reset()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_deleted int;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  WITH del AS (DELETE FROM public.product_fitments_effective_staging WHERE true RETURNING 1)
  SELECT count(*)::int INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$fn$;
REVOKE ALL ON FUNCTION pfe_staging_reset() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pfe_staging_reset() TO service_role;

CREATE OR REPLACE FUNCTION pfe_sync_commit(
  p_run_id uuid,
  p_source_rows int,
  p_orphan_rows int,
  p_allow_anomaly boolean DEFAULT false,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '300s'
AS $fn$
DECLARE
  v_old int;
  v_new int;
  v_foreign int;
  rec record;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  SELECT count(*) INTO v_old FROM public.product_fitments_effective;
  SELECT count(*), count(*) FILTER (WHERE run_id <> p_run_id)
    INTO v_new, v_foreign
  FROM public.product_fitments_effective_staging;
  IF v_new = 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging empty, refuse swap (keep old % rows)', v_old;
  END IF;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging has % rows from another run, refuse swap (concurrent sync?)', v_foreign;
  END IF;
  IF v_old > 0 AND v_new < v_old AND (v_old - v_new)::numeric / v_old > 0.10 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: shrink % -> % exceeds 10 pct, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  IF v_old > 0 AND v_new > v_old * 2 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: growth % -> % exceeds 2x, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  -- F1:任一 supplier 由 >0 → 0 = 來源整家蒸發疑慮、拒換(全域 10% shrink gate 蓋不住小供應商)
  FOR rec IN
    SELECT p.supplier_slug,
           count(*) FILTER (WHERE x.src = 'old') AS old_cnt,
           count(*) FILTER (WHERE x.src = 'new') AS new_cnt
    FROM (
      SELECT product_id, 'old'::text AS src FROM public.product_fitments_effective
      UNION ALL
      SELECT product_id, 'new'::text FROM public.product_fitments_effective_staging
    ) x
    JOIN public.products p ON p.id = x.product_id
    GROUP BY p.supplier_slug
    HAVING count(*) FILTER (WHERE x.src = 'old') > 0
       AND count(*) FILTER (WHERE x.src = 'new') = 0
  LOOP
    IF NOT p_allow_anomaly THEN
      RAISE EXCEPTION 'pfe_sync_commit: supplier % effective rows % -> 0, refuse swap (supplier vanished from source view?)', rec.supplier_slug, rec.old_cnt;
    END IF;
  END LOOP;
  DELETE FROM public.product_fitments_effective WHERE true;
  INSERT INTO public.product_fitments_effective
    (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
  SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code
  FROM public.product_fitments_effective_staging;
  DELETE FROM public.product_fitments_effective_staging WHERE true;
  INSERT INTO public.product_fitments_effective_sync_log
    (status, source_rows, staged_rows, orphan_rows, old_count, new_count, note, run_id)
  VALUES ('success', p_source_rows, v_new, p_orphan_rows, v_old, v_new, p_note, p_run_id);
  RETURN jsonb_build_object('old_count', v_old, 'new_count', v_new);
END;
$fn$;
REVOKE ALL ON FUNCTION pfe_sync_commit(uuid,int,int,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pfe_sync_commit(uuid,int,int,boolean,text) TO service_role;

-- 逐請求套用 300s(authenticator 預設 8s;103k DELETE+INSERT 貼線必炸;函式級 SET 不重武裝)
ALTER ROLE service_role SET statement_timeout = '300s';
NOTIFY pgrst, 'reload config';
