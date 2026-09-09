-- ⟦db-SEARCHFACETMUTEX⟧ 最小世界 —— `scripts/20260909010000-verify.sh` 專用
-- 🛑 這是**替身**不是正式庫的那六支:欄位只留被測函式與被委函式讀得到的那些,
--    沒有 RLS、沒有索引、沒有 security_invoker。⇒ 它證邏輯, 不證部署。
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE public.brands (id uuid PRIMARY KEY, name text, slug text);

CREATE TABLE public.products_public (
  id uuid PRIMARY KEY, brand_id uuid,
  title text, subtitle text, description text, external_id text
);

CREATE TABLE public.products_list_public (
  id uuid PRIMARY KEY, title text, subtitle text, handle text,
  brand_id uuid, category_id uuid, availability text, fitments jsonb,
  price_general integer, supplier_slug text, card_image text, fits text,
  brand_name text, brand_slug text, category_raw text, created_at timestamptz
);

CREATE TABLE public.product_variants_public (product_id uuid, sku text);

CREATE TABLE public.product_image_trim (
  url text, status text, bbox_left numeric, bbox_top numeric,
  bbox_width numeric, bbox_height numeric, natural_width integer, natural_height integer
);

CREATE TABLE public.product_fitments (
  product_id uuid, moto_brand text, model_code text, year_start integer, year_end integer
);
CREATE VIEW public.product_fitments_effective AS SELECT * FROM public.product_fitments;

-- ── 4 筆商品。🔴 每一筆都是為了某一題而在:
--    P1 標題含「碳纖維」+「排氣」   ⇒ ⑦⑧ 的分母、⑧ 的排除項(分類不對)
--    P2 完全不含碳纖維             ⇒ ⑦ 的負例(它必須被濾掉)
--    P3 標題含碳纖維 + 分類外觀配件 ⇒ 🔴 ⑧【關鍵字 AND 分類】唯一該中的那一筆
--    P4 **只有 description 含碳纖維** ⇒ 證明比對真的走到被委那支的四欄, 不是只比 title
INSERT INTO public.brands VALUES
  ('11111111-1111-1111-1111-111111111111','Bonamici','bonamici'),
  ('22222222-2222-2222-2222-222222222222','DBK','dbk');

INSERT INTO public.products_public (id, brand_id, title, subtitle, description, external_id) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','碳纖維排氣管尾段','排氣系統','全段碳纖維','PST3'),
  ('aaaaaaa1-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','油箱貼','外觀','止滑橡膠','CRB221L'),
  ('aaaaaaa1-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','碳纖維前土除','外觀','乾式碳纖','TH10'),
  ('aaaaaaa1-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','煞車拉桿','手控','碳纖維握把','CRB226O');

INSERT INTO public.products_list_public
  (id, title, subtitle, handle, brand_id, category_id, availability, fitments,
   price_general, supplier_slug, card_image, fits, brand_name, brand_slug, category_raw, created_at)
VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001','碳纖維排氣管尾段','排氣系統','bonamici-pst3','11111111-1111-1111-1111-111111111111',NULL,'in_stock','[]'::jsonb,
   5000,'bonamici',NULL,'通用款','Bonamici','bonamici','排氣系統', now() - interval '30 days'),
  ('aaaaaaa1-0000-0000-0000-000000000002','油箱貼','外觀','dbk-crb221l','22222222-2222-2222-2222-222222222222',NULL,'in_stock','[]'::jsonb,
   800,'dbk',NULL,'通用款','DBK','dbk','外觀配件', now() - interval '30 days'),
  ('aaaaaaa1-0000-0000-0000-000000000003','碳纖維前土除','外觀','bonamici-th10','11111111-1111-1111-1111-111111111111',NULL,'in_stock','[]'::jsonb,
   9000,'bonamici',NULL,'通用款','Bonamici','bonamici','外觀配件', now() - interval '30 days'),
  ('aaaaaaa1-0000-0000-0000-000000000004','煞車拉桿','手控','dbk-crb226o','22222222-2222-2222-2222-222222222222',NULL,'in_stock','[]'::jsonb,
   3000,'dbk',NULL,'通用款','DBK','dbk','煞車系統', now() - interval '30 days');

-- ── 🔴🔴 [codex R1 must-fix 4] 車款那條路(p_brand 非 NULL)的資料 ──────────────
--   原本十格【全部】走第一條路 ⇒ 📌 第二條路就算完全忽略 p_terms, 十格照樣全綠。
--   ⇒ 事後閘③ 數到「述詞 2 份」是【字面】, 而字面在不在與那條路會不會被走到是兩件事。
-- 🔑 P1 / P2 / P3 掛 Ducati, P4 不掛 ⇒ 讓「車款」與「關鍵字」兩個條件各自都有排除力:
--    只有車款      ⇒ 3(P1 P2 P3)
--    車款 + 碳纖維 ⇒ 2(P2 沒有碳纖維)   ⇐ 它若忽略關鍵字, 這格會是 3
INSERT INTO public.product_fitments (product_id, moto_brand, model_code, year_start, year_end) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001','Ducati','V4', 2018, 2026),
  ('aaaaaaa1-0000-0000-0000-000000000002','Ducati','V4', 2018, 2026),
  ('aaaaaaa1-0000-0000-0000-000000000003','Ducati','V4', 2018, 2026);

-- ── 🔴🔴 [codex R3 must-fix] 讓 anon 真的叫得動 —— 上面每一格原本都是 postgres 跑的 ────
--   📌 正式庫上兩支函式都是 SECURITY INVOKER ⇒ 客人以 anon 進來, 讀不到表就是 42501 或零列,
--     而**以 postgres 跑的每一格都不會發現**。
-- ⚠️ 這裡只補【表與函式的授權】—— **RLS 這一層本 fixture 沒有**(替身表沒開 RLS)
--    ⇒ 🛑 所以 anon 那幾格證的是「權限這一層通」, **不證「RLS 之後還看得到同樣多列」**。
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.products_public, public.products_list_public,
                public.product_variants_public, public.brands,
                public.product_fitments, public.product_fitments_effective,
                public.product_image_trim TO anon, authenticated, service_role;
