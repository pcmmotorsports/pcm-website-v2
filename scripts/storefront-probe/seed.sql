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


-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 每一家品牌都要有商品(2026-08-27 `-ed` 線;主視窗批准)
--
-- 病灶:上面那 12 支只掛在【四家】品牌上(rizoma/bonamici/evotech/gb-racing),
--   而 `supplier_slug` 寫死 `'rpm'`。⇒ 「打開某一家的商品頁看看」這個動作,
--   在這台鑽機上【對其餘每一家都構造不出來】—— 而它不會報錯,
--   它會給你一頁看起來完全正常的假商品,只是那一家永遠是空的。
--   (2026-08-27 實錘:一個窗被派去「看客人打開 Gilles 商品頁看到什麼」,
--    `grep -c gilles seed.sql` ⇒ 0 ⇒ 這條鏈答不了那一題,只好改用正式站。)
--
-- 🔴 為什麼是【加】不是【改】:上面那 12 支的 handle `g3-probe-NNNN` 被
--   多份歷史 probe 紀錄與元件註解逐字引用 —— **全在註解/文件、無任何測試斷言**
--   (當場數:`grep -rIn "g3-probe-" --exclude-dir=node_modules .`;
--    ⚠️ 別用 `g3-probe` 當關鍵字,那會連鑽機目錄名 `pcm-g3-probe` 一起數進來 ——
--       我第一版寫死「共 12 處」而四種數法都湊不出 12,那個數字是我算的、沒有來源),
--   而 `g3-probe-0002` 的兩個變體是為了一條具體 FINDING 加的。動它們=弄壞別人的紀錄。
--
-- ⚠️ `supplier_slug` 這裡直接用 brand slug。**真實系統裡兩者不相等**
--   (`gb-racing`→`gbracing`、`rpm-carbon`→`rpm`、`k-speed`→`kspeed`);
--   而顧客站的頁面不讀 `supplier_slug`(只有 dev-preview fixture 與補差額商品讀)
--   ⇒ 對本鑽機不是承重欄。**要測供應商相關的東西時,這裡要先改對。**
-- 🔴 而它【看得見】,只是沒被畫出來:`20260709120000_products_add_install_resources_expose_view.sql`
--    把 `supplier_slug` 投進 `products_detail` 這個 **anon 可讀的 view**
--    ⇒ 拿鑽機的 API 回應當證據的人會讀到 `gilles`,而正式站那一格是 `rpm`。
--    ⇒ **不要把鑽機的 API payload 當成正式站 payload 的樣本。**
--
-- 每家四支,四種【組合】—— 少了哪一種,那一族的題目就在這台鑽機上構造不出來。
-- 🔴 是「車款 × 圖片 × 變體」三個維度的組合,不是四個標籤:
--   k=1 無車款、無圖、單一規格       k=2 有車款、無圖(「沒照片」那一族)
--   k=3 有車款、有圖、七個顏色變體    k=4 有車款、有圖、單一規格(常態)
-- ⚠️ 第一版我把 k=4 標成「有圖」而 `images` 給的是 `'[]'` ⇒ 它跟 k=1 走同一條佔位圖路徑,
--    **四種形狀實際只有三種,而兩個世界印同一張畫面**(code-reviewer 抓到)。
--    ⇒ 修法不是改標籤,是真的給圖;而自檢那格也補上「數形狀」,見 `up.sh`。
-- ⚠️ 圖用 **本機** `/brand-assets/assets/brands-trim/<slug>.png`,**不用外部網域**
--    (元件 2026-08-22 才把外部圖依賴拿掉,不要在鑽機裡種一個回去)。
--    該目錄的檔數少於品牌數 ⇒ 少數幾家會 404 → 元件 onError 退回佔位圖。
--    **DB 欄位仍是「有圖」** ⇒ 自檢數得到;畫面上那幾家看起來像無圖。這是已知落差,不是壞掉。
--    (當場數:`ls apps/storefront/public/brand-assets/assets/brands-trim/ | wc -l`
--     對 `psql -c 'select count(*) from brands'`)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO products (external_id, title, subtitle, description, handle, price_by_tier,
                      price_general, price_store, availability, brand_id, category_id,
                      images, fitments, highlights, supplier_slug)
SELECT
  'PB-' || b.slug || '-' || k,
  (ARRAY['防摔球','煞車拉桿','腳踏後移組','水箱護網'])[k] || ' — ' || b.name,
  (ARRAY['通用款 · 無車型限制','無照片 · 有適用車款','七色可選 · 有照片','常態 · 有照片有車款'])[k],
  '這是探針種子資料(每家品牌各四支)。第 ' || k || ' 支刻意做成'
    || (ARRAY['通用款、無適用車款、無圖','有車款、無圖','有車款、有圖、七個顏色變體','有車款、有圖、單一規格'])[k]
    || '，讓那一族的題目在鑽機上構造得出來。',
  'probe-' || b.slug || '-' || k,
  jsonb_build_object('general', 1200 + k * 300, 'store', 900 + k * 250),
  1200 + k * 300, 900 + k * 250,
  'in-stock',
  b.id, c.id,
  CASE WHEN k IN (3, 4) THEN jsonb_build_array('/brand-assets/assets/brands-trim/' || b.slug || '.png')
       ELSE '[]'::jsonb END,
  CASE WHEN k = 1 THEN '[]'::jsonb
       ELSE jsonb_build_array(
              jsonb_build_object('brand','Yamaha','modelCode','YZF-R7','yearStart',2021,'yearEnd',2025)) END,
  jsonb_build_array('探針假資料，不是真商品', '形狀:' || (ARRAY['通用款無圖','有車款無圖','有圖多變體','有圖常態'])[k]),
  b.slug
FROM (SELECT id, name, slug, row_number() OVER (ORDER BY slug) AS bn FROM brands) b
CROSS JOIN generate_series(1, 4) k
-- 分類用「有幾個就輪幾個」,不寫死名字 —— 寫死名字的話,分類改名這支種子會安靜地插不進去。
CROSS JOIN LATERAL (
  SELECT id FROM categories ORDER BY id
  OFFSET ((b.bn + k) % GREATEST((SELECT count(*) FROM categories), 1)) LIMIT 1
) c
-- 🔴 刻意不寫 ON CONFLICT:鑽機每次都是全新 DB(不會撞),
--    而 ON CONFLICT 會把這支種子綁死在「那個 unique 約束有套上」——
--    而本鑽機【有一批 migration 套不上是常態】(`up.sh` 起鏈時自己會印 `migration ok=N fail=M`,
--    以那一行的當下值為準 —— 這裡刻意不寫死數字:`up.sh:30` 寫 27、我第一次跑量到 44,
--    **同一台機器兩個數字** ⇒ 它會隨 migration 增加而變,寫死就會有人引用到過期值)
--    ⇒ 綁死「那個 unique 約束有套上」是一個會安靜壞掉的依賴。
;

-- k=3 那支給七個顏色 —— 「換規格」那一族的題目在【每一家】都走得完,不再只有一支商品有。
-- 🔴 `supplier_slug` 要顯式給 —— 不給的話吃 DEFAULT 'rpm'
--    (`20260602135934_s1_supplier_slug_delisted_clean_metadata.sql:35`)
--    ⇒ 父商品是 `gilles` 而它的變體是 `rpm`,鑽機上父子不一致,
--      而 `create_order` 的 `(supplier_slug, sku)` 備援路徑在這裡就解不出來。
INSERT INTO product_variants (product_id, supplier_slug, sku, spec, price_general, price_store, availability, sort_order)
SELECT p.id, p.supplier_slug,
       upper(replace(p.handle, 'probe-', '')) || '-' || v.code,
       jsonb_build_object('顏色', v.zh),
       p.price_general + v.delta, p.price_store + v.delta, 'in-stock', v.so
FROM products p
CROSS JOIN (VALUES
  ('BLK','黑色',0,0), ('BLU','藍色',0,1), ('GLD','金色',100,2), ('NAT','原色',0,3),
  ('RED','紅色',0,4), ('SLV','銀色',0,5), ('TTN','鈦色',200,6)
) AS v(code, zh, delta, so)
WHERE p.handle LIKE 'probe-%-3'
; -- 同上:不寫 ON CONFLICT
