INSERT INTO products (external_id, title, subtitle, description, handle, price_by_tier,
                      price_general, price_store, availability, brand_id, category_id,
                      images, fitments, highlights, supplier_slug)
SELECT 'G3-' || lpad(g::text, 4, '0'),
  (ARRAY['碳纖維前土除','鋁合金腳踏後移組','煞車拉桿組(可調)','排氣管尾段 Slip-On','水箱護網','鏈條調整器',
         '後視鏡(短柄)','油杯蓋組','車牌架(可調角度)','離合器拉桿護弓','齒盤蓋','側柱加大底座'])[1 + ((g - 1) % 12)]
    || ' — ' || b.name,
  (ARRAY['乾式碳纖維 · 亮面','CNC 削切 · 陽極處理','六段可調 · 折疊式','鈦合金 · 附回壓塞'])[1 + ((g - 1) % 4)],
  '這是探針種子資料的說明文字，用來看商品詳情頁在有內容時的排版。實際商品說明會由上架流程帶入。段落長度刻意做得跟真的差不多，這樣手機視窗下的斷行與留白才量得準。',
  'g3-probe-' || lpad(g::text, 4, '0'),
  jsonb_build_object('general', 3200 + g * 470, 'store', 2600 + g * 400),
  3200 + g * 470, 2600 + g * 400,
  CASE WHEN g % 7 = 0 THEN 'out-of-stock' ELSE 'in-stock' END,
  b.id, c.id, '[]'::jsonb,
  jsonb_build_array(
    jsonb_build_object('brand','Aprilia','modelCode','RSV4 1100 Factory','yearStart',2021,'yearEnd',2024),
    jsonb_build_object('brand','Aprilia','modelCode','Tuono V4','yearStart',2021,'yearEnd',null)),
  jsonb_build_array('乾式碳纖維，非水轉印','原廠孔位直上，不需鑽孔','附不鏽鋼固定件'),
  'rpm'
FROM generate_series(1, 12) g
CROSS JOIN LATERAL (SELECT id, name FROM brands
  WHERE slug = (ARRAY['rizoma','bonamici','evotech','gb-racing'])[1 + ((g - 1) % 4)]) b
CROSS JOIN LATERAL (SELECT id FROM categories
  WHERE name = (ARRAY['土除與外觀飾蓋','儀表與控制器','尾段排氣管(Slip-On)','外觀與後視鏡'])[1 + ((g - 1) % 4)]
  LIMIT 1) c;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('11111111-1111-1111-1111-111111111111','probe@example.com','{"name":"探針測試客人"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO customers (user_id, email, name, phone, tier)
VALUES ('11111111-1111-1111-1111-111111111111','probe@example.com','探針測試客人','0912345678','general')
ON CONFLICT (user_id) DO NOTHING;

-- 🔴 第二個客人:**為了「換帳號」那一類題目**（2026-08-18 加）。
--    沒有第二個帳號的時候，「A 的資料會不會漏給 B」「A 的東西會不會被 B 的動作刪掉」
--    這一整族題目【構造不出來】—— 而構造不出來與「沒有這個 bug」在報告上長得一樣。
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('22222222-2222-2222-2222-222222222222','probe2@example.com','{"name":"探針測試客人乙"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO customers (user_id, email, name, phone, tier)
VALUES ('22222222-2222-2222-2222-222222222222','probe2@example.com','探針測試客人乙','0987654321','general')
ON CONFLICT (user_id) DO NOTHING;

-- ── 規格(變體)：只給【一支】商品，讓「換規格」那條路走得下去 ──────────────
-- 🔴 為什麼加這個(2026-08-22 線 B `-3c`)：D 窗推出一條客人面的 FINDING ——
--    「手機加購後換規格 ⇒ 面板仍說『已加入』、按 + 靜默 no-op ⇒ 螢幕說 2 而購物車是 0」。
--    那條**至今只有讀 code 的推論**，因為這份種子**零規格** ⇒ 第 2 步「換規格」走不下去。
--    ⇒ 本段就是為了讓那四步走得完。**只動鑽機種子，不動 app code、不碰正式資料。**
-- ⚠️ 只掛在 g3-probe-0002 一支上：其餘 11 支維持無規格，
--    這樣「有規格」與「無規格」兩條路在同一個鑽機裡都測得到（無規格那條是既有行為的對照組）。
INSERT INTO product_variants (product_id, sku, spec, price_general, price_store, availability, sort_order)
SELECT p.id, v.sku, v.spec, v.pg, v.ps, 'in-stock', v.so
FROM products p
CROSS JOIN (VALUES
  ('G3-0002-BLK', '{"顏色":"黑"}'::jsonb, 4140, 3400, 0),
  ('G3-0002-SLV', '{"顏色":"銀"}'::jsonb, 4400, 3600, 1)
) AS v(sku, spec, pg, ps, so)
WHERE p.handle = 'g3-probe-0002';
