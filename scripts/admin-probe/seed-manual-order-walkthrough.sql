-- ⟦b4-INVOICE5PCT⟧ / 手動建單走查用的**補充種子**(2026-09-05, 線【帳號】)。
--
-- 🔴 **為什麼另開一支而不改 `seed.sql`**:runbook 逐字「不要改 seed.sql —— 它全窗共用,
--    多幾筆可能動到別片的期望值」。
-- 🔴 **為什麼需要它**:`up.sh` 起完自己印「這台機器有 42 / 56 張表是空的」, 而
--    `product_variants` 在那串裡 ⇒ 手動建單的料號查詢(`manual-order-catalog.ts:195` 打
--    `product_variants`)會回空 ⇒ 📌 **畫面印「查無」, 而那與「功能壞了」長得一樣。**
--
-- 🔵 SKU 前綴用 `WALK-` ⇒ 與別片的種子不會互相命中。
INSERT INTO public.product_variants (id, product_id, sku, spec, price_general, price_store, availability, sort_order)
SELECT
  ('bbbb0000-0000-4000-8000-00000000000' || n)::uuid,
  p.id,
  'WALK-' || lpad(n::text, 3, '0'),
  jsonb_build_object('color', (ARRAY['black','silver','gold'])[1 + (n % 3)]),
  -- 🔴 三個價格互不相同、也不是整數千 ⇒ 換錯欄 / 少乘一次在畫面上看得出來
  1500 + n * 137,
  1200 + n * 100,
  'in-stock',  -- 🔴 是 in-stock 不是 in_stock:CHECK pv_availability_valid 只認 in-stock / out-of-stock(實測撞到)
  n
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM public.products LIMIT 5) p
CROSS JOIN generate_series(1, 1) AS g(x)
CROSS JOIN LATERAL (SELECT p.rn::int AS n) AS nn
ON CONFLICT (id) DO NOTHING;

SELECT 'product_variants 現有 ' || count(*) || ' 列' FROM public.product_variants;
SELECT sku || ' | 網站價 ' || price_general || ' | 經銷價 ' || price_store FROM public.product_variants ORDER BY sku;
