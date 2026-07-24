-- ============================================================================
-- 補差額用賣場 · 1 元自訂商品 seed(2026-07-24)
-- ----------------------------------------------------------------------------
-- 用途:Sean 要在正式站放一個「補差額用賣場」1 元商品(公開、長期留存),
--       客人依需補差額數量加購;同時作為正式站真刷卡驗收的標的。
--
-- 為何是手動 seed:admin 後台無商品 CRUD、商品僅由供應商同步或 DB insert 產生。
-- 🟢 已於 2026-07-24 apply 正式庫(project bmpnplmnldofgaohnaok):Sean 明確授權「你幫我推上去、你有 mcp」
--    → Claude 經 Supabase MCP execute_sql 執行(非 Sean 手動 SQL Editor)。交易模擬+對抗審查(GO)先行、
--    apply 後實查 in_public_view=1 / 收費/件=1 / supplier=manual。本檔保留供紀錄與日後重建(冪等可再跑)。
--
-- 安全與正確性依據(皆自正式庫 pg_catalog / create_order 活體定義實查):
--   1. 收費金額 = product_variants.price_general(create_order:v_unit_price := v_variant.price_general,
--      不分 tier、一律此值)→ price_general=1 ⇒ 每種客人皆收 NT$1。價格單位=整數台幣元
--      (實查現有 NT$50 螺絲其 price_general=50)。
--   2. 防同步刪除:rpm-reconcile 的 delist/硬刪一律 .eq('supplier_slug', <supplier>) scope
--      → supplier_slug='manual'(非任何已登記供應商 slug)⇒ 同步碰不到它。
--      🔴 products / product_variants 兩張表的 supplier_slug 欄 DEFAULT 皆為 'rpm',必須顯式覆蓋。
--   3. price_by_tier CHECK 只要 'general' + 'store' 兩 key(premiumStore 非必要,實查約束)。
--   4. availability CHECK 只認 'in-stock' / 'out-of-stock'。
--   5. 變體 spec 不得含 price_store / price_by_tier / cost 鍵(create_order fail-closed)→ 用 {}。
--   6. 公開可見:products_public view 靠 RLS USING(delisted_at IS NULL) 顯示 → delisted_at 留 NULL。
--      空 images 不會壞頁(ProductCard 缺圖 fallback placeholder)。
--   7. 可購買:create_order 硬閘 = 變體存在 + delisted_at IS NULL + price_general>0 + spec 為乾淨 object。
--      🔴 availability 非 create_order 硬閘(缺貨閘已移除、僅快照 availability_at_checkout;活體實查:
--      唯一 RAISE 是 delisted_at IS NOT NULL);但前台「加入購物車」仍看 availability → 故設 in-stock。
--      無車種相容 gate(vehicle 為選填 metadata、不擋單)。
--
-- 冪等:全程 IF NOT EXISTS 守衛,重複執行不會重建、不會報錯。
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_brand_id uuid;
  v_cat_id   uuid;
  v_prod_id  uuid;
  v_sort     integer;
BEGIN
  -- ── 1. 品牌:PCM(自家品牌,與供應商品牌分開)──────────────────────────
  SELECT id INTO v_brand_id FROM public.brands WHERE slug = 'pcm';
  IF v_brand_id IS NULL THEN
    INSERT INTO public.brands (name, slug, premium_extra_pct)
    VALUES ('PCM', 'pcm', 0)
    RETURNING id INTO v_brand_id;
  END IF;

  -- ── 2. 分類:服務／其他(頂層,fullwidth ／ 避免 raw_path 被 '/' 拆段)──
  SELECT id INTO v_cat_id
  FROM public.categories
  WHERE name = '服務／其他' AND parent_category_id IS NULL;
  IF v_cat_id IS NULL THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort FROM public.categories;
    INSERT INTO public.categories (name, raw_path, segments, sort_order)
    VALUES ('服務／其他', '服務／其他', '["服務／其他"]'::jsonb, v_sort)
    RETURNING id INTO v_cat_id;
  END IF;

  -- ── 3. 商品:補差額用賣場 ────────────────────────────────────────────
  SELECT id INTO v_prod_id FROM public.products WHERE external_id = 'manual-balance-payment';
  IF v_prod_id IS NULL THEN
    INSERT INTO public.products (
      external_id, title, subtitle, description, handle,
      price_by_tier, price_general, price_store,
      availability, supplier_slug, brand_id, category_id
    ) VALUES (
      'manual-balance-payment',
      '補差額用賣場',
      '每件 NT$1 · 結帳時依需補差額數量加購',
      '本商品供補足訂單價差使用,每件 NT$1。請於結帳時依需補足的金額調整購買數量(例:需補 NT$50 即購買 50 件)。',
      'pcm-balance-payment',
      '{"general":{"amount":1,"currency":"TWD"},"store":{"amount":1,"currency":"TWD"}}'::jsonb,
      1, 1,
      'in-stock', 'manual', v_brand_id, v_cat_id
    )
    RETURNING id INTO v_prod_id;
  END IF;

  -- ── 4. 變體:NT$1 單一變體(create_order 依此變體 price_general 收費)──
  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE sku = 'PCM-BALANCE-1') THEN
    INSERT INTO public.product_variants (
      product_id, sku, price_general, price_store,
      availability, supplier_slug, spec
    ) VALUES (
      v_prod_id, 'PCM-BALANCE-1', 1, 1,
      'in-stock', 'manual', '{}'::jsonb
    );
  END IF;
END $$;

COMMIT;

-- ── 執行後自我驗收(可單獨再跑一次確認)────────────────────────────────
-- 應回 1 列、handle=pcm-balance-payment、可購買條件全滿足:
SELECT p.handle, p.title, p.supplier_slug, p.delisted_at,
       v.sku, v.price_general AS 收費金額_每件, v.availability, v.supplier_slug AS 變體來源
FROM public.products p
JOIN public.product_variants v ON v.product_id = p.id
WHERE p.external_id = 'manual-balance-payment';
