-- D1t2:`product_fitments_effective` 的 DDL 快照 —— **rehearsal 隔離環境專用**。
--
-- 🔴 為什麼存在:這張表在 production 是完整資料表(148,716 列),但 supabase/migrations/
--    沒有任何一支建立它(backlog #299),而 4 支 migration 引用它、其中
--    `search_catalog_by_vehicle` 是 LANGUAGE sql、建立當下就解析 ⇒ 少了它,
--    migrations 一律卡在 2026-07-12(D1a6 實測 85 支只跑 54 支)。
-- 🔴 本檔**不是 #299 的解**:#299 要走正式 migration + 關卡2 對抗審查;本檔只讓
--    演練環境的 migration 鏈跑得完(0 列即可 —— 引用它的物件只需要 relation 存在)。
-- 來源:2026-07-29 production 唯讀 introspection(pg_attribute/pg_constraint/
--    pg_indexes/pg_policies/relacl 逐項)。
-- 🔴 定位 = **migration 相容性 stub**,不宣稱與 production 持續同步:無 schema
--    fingerprint 對帳,introspection 之後的 DDL 漂移這裡看不到(codex K2 nit)。
--    夠用的原因:演練只需要「migration 鏈解析得過」,不消費此表資料。
--    若日後 #299 落地,本檔應改為指向正式 migration 並刪除。
BEGIN;

CREATE TABLE public.product_fitments_effective (
  id bigint GENERATED ALWAYS AS IDENTITY,
  product_id uuid NOT NULL,
  moto_brand text NOT NULL,
  model_code text NOT NULL,
  year_start integer,
  year_end integer,
  match_source text NOT NULL,
  source_model_code text NOT NULL,
  CONSTRAINT product_fitments_effective_pkey PRIMARY KEY (id),
  CONSTRAINT product_fitments_effective_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT pfe_match_source_valid CHECK ((match_source = ANY (ARRAY['direct'::text, 'inherited'::text]))),
  CONSTRAINT pfe_nonblank_valid CHECK (((btrim(moto_brand) <> ''::text) AND (btrim(model_code) <> ''::text) AND (btrim(source_model_code) <> ''::text))),
  CONSTRAINT pfe_provenance_valid CHECK ((((match_source = 'direct'::text) AND (source_model_code = model_code)) OR ((match_source = 'inherited'::text) AND (source_model_code <> model_code)))),
  CONSTRAINT pfe_year_interval_valid CHECK (((year_start IS NULL) OR (year_end IS NULL) OR (year_end >= year_start))),
  CONSTRAINT pfe_year_state_valid CHECK (((year_start IS NOT NULL) OR (year_end IS NULL)))
);

CREATE UNIQUE INDEX ux_pfe_row ON public.product_fitments_effective
  USING btree (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT;
CREATE INDEX ix_pfe_lookup ON public.product_fitments_effective USING btree (moto_brand, model_code, year_start, year_end);
CREATE INDEX ix_pfe_product ON public.product_fitments_effective USING btree (product_id);

ALTER TABLE public.product_fitments_effective ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_fitments_effective_select_public ON public.product_fitments_effective
  FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_fitments_effective.product_id AND p.delisted_at IS NULL));

GRANT SELECT ON public.product_fitments_effective TO anon, authenticated;
GRANT ALL ON public.product_fitments_effective TO service_role;

COMMIT;
