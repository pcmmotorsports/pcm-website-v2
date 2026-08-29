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

-- ════════════════════════════════════════════════════════════════════
-- 🔴 訂單種子(2026-08-29 線D;主視窗批准)
--
-- 病灶:這份種子【建訂單的 INSERT = 0】(當天實測;正對照:建商品的 INSERT = 4)
--   ⇒ 客人的「訂單記錄」與「訂單詳情」在這台鑽機上【永遠是空狀態】
--   ⇒ 而那兩片正是 Sean 2026-08-29 批的客人面工作 ⇒ **沒有任何人在真瀏覽器裡看過它們**
--   ⚠️ 而更毒的是:空狀態量出來的「0 溢出 / 沒問題」看起來像一份合格的驗收報告。
--     ⇒ 當天線D 就交過那樣一份,並自己標了「這兩發對訂單卡片的判別力是零」。
--
-- ⚠️ 資料【刻意明顯是假的】(名字/地址/金額)——免得有人把鑽機截圖當成真實訂單。
-- 🔴 演反面的方法:把本段整個拿掉重跑 up.sh ⇒ 那些卡片必須消失。
--    不做這一步的話,你不知道你看到的卡片是不是這段種出來的。
-- ════════════════════════════════════════════════════════════════════

-- ── 訂單 1:多品項(3 件)、已付款已出貨 ── 驗商品列/縮圖/品牌標/小計 ──
-- ── 訂單 2:單品項 ── 驗最小情況 ──
-- ── 訂單 3:有折扣 ── 驗 discount_total(線G 剛動過那一格,沒有被看過) ──
-- ── 訂單 4:未付款、尚未叫貨 ── 驗狀態徽章的另一種顏色 ──
-- ── 訂單 5:已取消(cancelled_at 有值)── Sean 2026-08-29 拍板「已取消的單回到客人帳號」──
INSERT INTO orders (
  display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  payment_status, fulfillment_status, subtotal, shipping_fee, discount_total, total,
  shipping_method, invoice, paid_at, payment_method, cancelled_at, cancelled_reason
)
SELECT o.display_id, c.user_id,
  '{"name":"探針測試客人(假資料)","phone":"0900-000-000","line":"測試市測試區測試路 000 號(假地址)"}'::jsonb,
  'general'::member_tier, o.pay::payment_status, o.ful::fulfillment_status,
  o.sub, o.ship, o.disc, o.sub + o.ship - o.disc,
  -- 🔴 `payment_method` 跟著 `paid_at` 走,不是每張都填:
  --    元件註解逐字寫著「`paymentMethod` 為 null = 尚無成功請款(**不是**「資料缺失」)
  --    ⇒ 仍印 `—`,這一格空著是**看得出來比較好**的那種空」
  --    (`OrderDetailView.tsx:229-230`)
  -- ⇒ 所以【未付款那張 9004 刻意留 null】,那不是漏種,是那一格的正解。
  -- ⇒ 已付款的填 'tappay' —— 正式路徑的字面(`20260611120000_..._confirm_payment_rpc.sql:181` 寫死)。
  -- 📌 這樣同一份種子同時演得出【有值】與【該空】兩個世界;全填的話,
  --    「空著是對的」那條路在這台鑽機上就構造不出來了。
  'home', '{"type":"personal"}'::jsonb, o.paid_at,
  CASE WHEN o.paid_at IS NULL THEN NULL ELSE 'tappay' END,
  o.cancelled_at, o.cancelled_reason
FROM customers c
CROSS JOIN (VALUES
  ('PCM-2026-9001', 'paid',   'shipped',    5400, 160,   0, now() - interval '9 days', NULL::timestamptz, NULL::text),
  ('PCM-2026-9002', 'paid',   'inStock',    1800, 160,   0, now() - interval '6 days', NULL,              NULL),
  ('PCM-2026-9003', 'paid',   'ordered',    4200, 160, 700, now() - interval '4 days', NULL,              NULL),
  ('PCM-2026-9004', 'unpaid', 'notOrdered', 2100, 160,   0, NULL,                      NULL,              NULL),
  ('PCM-2026-9005', 'paid',   'notOrdered', 1500, 160,   0, now() - interval '2 days',
     now() - interval '1 day', '探針假資料:客人要求取消')
) AS o(display_id, pay, ful, sub, ship, disc, paid_at, cancelled_at, cancelled_reason)
WHERE c.email = 'probe@example.com'
; -- 不寫 ON CONFLICT:重跑 up.sh 是在全新的資料庫上,撞到 = 有東西不對,要看見它

-- 品項:金額必須自己對得起來(order_items_line_balances / orders_total_balances 兩道 CHECK)
INSERT INTO order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT ord.id, i.sku,
  jsonb_build_object('title', i.title, 'sku', i.sku, 'spec', jsonb_build_object('顏色', i.color)),
  i.qty, i.price, i.price * i.qty
FROM orders ord
JOIN (VALUES
  ('PCM-2026-9001', 'G3-0001-BLK', '腳踏後移組 — BONAMICI RACING(假資料)', '黑色', 1, 2100),
  ('PCM-2026-9001', 'G3-0002-RED', '煞車拉桿 — TERMIGNONI(假資料)',       '紅色', 1, 1800),
  ('PCM-2026-9001', 'G3-0003-SLV', '防摔球 — RPM CARBON(假資料)',         '銀色', 1, 1500),
  ('PCM-2026-9002', 'G3-0002-RED', '煞車拉桿 — TERMIGNONI(假資料)',       '紅色', 1, 1800),
  ('PCM-2026-9003', 'G3-0001-BLK', '腳踏後移組 — BONAMICI RACING(假資料)', '黑色', 2, 2100),
  ('PCM-2026-9004', 'G3-0001-GLD', '腳踏後移組 — MOTOGADGET(假資料)',     '金色', 1, 2100),
  ('PCM-2026-9005', 'G3-0003-SLV', '防摔球 — EBC BRAKES(假資料)',         '銀色', 1, 1500)
) AS i(display_id, sku, title, color, qty, price) ON i.display_id = ord.display_id
;

-- ── 訂單 6:**500 件品項** ⇒ 逼出 itemCountTruncated ──────────────────
-- 🔴 這一張【不是真實情況】,它是一個【狀態夾具】:
--    `ORDER_LIST_ITEMS_EMBED_LIMIT = 500`(packages/adapters/src/supabase/mappers/order.ts:524)
--    ⇒ `itemCountTruncated` 的判準是 `order_items.length >= 500`
--    ⇒ 想看那句「商品列也是被切過的」提示長什麼樣,**只有 500 件構造得出來**。
-- ⚠️ 主視窗原話是「不要種 500 件 —— 那是上限不是真實情況」,而它同時要求演 truncated。
--    這兩句互相衝突 ⇒ 我選了【演得出來】,並在這裡寫明它是夾具、不是樣本。
--    ⇒ 不想要它 ⇒ 刪掉本段兩個 statement 即可,前五張單不受影響。
-- 📌 那句提示是 codex 抓出來補的,而**補完沒有人看過它** ⇒ 它可能長得醜或位置不對。
INSERT INTO orders (
  display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  payment_status, fulfillment_status, subtotal, shipping_fee, discount_total, total,
  shipping_method, invoice, paid_at, payment_method
)
SELECT 'PCM-2026-9006', c.user_id,
  '{"name":"探針測試客人(假資料)","phone":"0900-000-000","line":"測試市測試區測試路 000 號(假地址)"}'::jsonb,
  'general'::member_tier, 'paid'::payment_status, 'ordered'::fulfillment_status,
  500 * 100, 160, 0, 500 * 100 + 160,
  'home', '{"type":"personal"}'::jsonb, now() - interval '3 days', 'tappay'
FROM customers c WHERE c.email = 'probe@example.com'
;
INSERT INTO order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT ord.id,
  'G3-BULK-' || lpad(g::text, 4, '0'),
  jsonb_build_object('title', '大量品項夾具 #' || g || '(假資料)',
                     'sku',   'G3-BULK-' || lpad(g::text, 4, '0'),
                     'spec',  jsonb_build_object('顏色', '黑色')),
  1, 100, 100
FROM orders ord CROSS JOIN generate_series(1, 500) AS g
WHERE ord.display_id = 'PCM-2026-9006'
;
