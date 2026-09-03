-- 🔴🔴 **整支種子必須在【一個交易】裡跑,而這不是效能考量** ——
--    `pcm_e13_items_subtotal_guard` / `pcm_e13_orders_subtotal_guard` 是
--    **DEFERRABLE INITIALLY DEFERRED** 的 constraint trigger:它們在 **COMMIT 時**才檢查
--    「orders.subtotal = Σ order_items.line_total」。
--    ⇒ psql 預設 autocommit ⇒ **每一句各自 commit** ⇒ 插完 order_items 那一刻就被檢查,
--      而那時 subtotal 還沒對齊 ⇒ 炸。
--    ⇒ 包成一個交易,最後那句 UPDATE 對齊完才 COMMIT ⇒ **deferred 才發揮它的用途**。
--    (2026-08-19 建這支腳本時實際踩到:錯誤訊息指著 order_items 那一句,
--     而真正的原因是「這一句自己 commit 了」。)
-- 🔴🔴 **這一段【必須在 BEGIN 之前】—— 2026-09-01 線【出貨】`-1e` 實測後搬上來**
--    症狀:`cannot ALTER TABLE "orders" because it has pending trigger events`
--    成因:整支種子是【一個交易】(見檔頭), 而 `ALTER` 前面已經有 INSERT
--          ⇒ DEFERRED 觸發器還掛在那個交易上 ⇒ Postgres 拒絕 ALTER 那張表。
--    ⇒ 📌 而那個錯誤訊息【不會說】「把 ALTER 搬到 BEGIN 前面」—— 那要撞過才知道。
--       🔴 **而撞到的人看到的是一支【完全正常的 seed 檔】停在中間。**(線【出貨】原句)
--    ⚠️ 代價明寫:它在交易外 ⇒ 種子後面炸掉的話, 這個約束改動【會留著】。
--       拋棄式鑽機上那是可接受的(整座 PG 用完就丟);**在任何非拋棄式的庫上不成立。**
--    📎 哪幾道是 DEFERRABLE:`~/pcm-mailbox/表-INSERT觸發器哪幾道會擋人-20260901.md`(`-a0` 2026-09-01)

-- ── 🔴🔴 補上 D0 那條【沒 apply 成功】的約束放寬(2026-08-30 加)────────────────────
-- **這是 runbook §3-a 那個病的一個【真實現場】**:逐字「失敗的那幾支會讓本機的約束比正式站舊
-- —— 而它不會紅, 只會靜靜地說謊」。
-- 現場:`20260729010000`(D0)在本鑽機 **FAIL**(它的驗收閘說「service_role 對 orders 的 SELECT 不見了」,
--   那是鑽機 bootstrap 的洞, 不是那支 migration 的錯)
--   ⇒ `orders_display_id_format` 停在**舊版**(只收 `PCM-YYYY-NNNN`)
--   ⇒ 而 `pcm_generate_display_id()`(N3a, **有 apply 成功**)產的是**新的 6 碼**
--   ⇒ **新產生器 + 舊約束** ⇒ 任何自己產號的路徑(手動建單就是)必死 `23514`。
-- 🔴🔴 **而那個答案在起站當下就被印出來了** —— `20260730120100`(N3b)的前置閘逐字:
--   「`orders_display_id_format` 沒有接受新 6 碼格式的分支。請先套用 20260729010000(D0);
--    否則本片 apply 會全綠、但第一筆真結帳會死在 check_violation」
--   ⇒ 📌 **寫那道閘的人, 把我後來花一小時找到的東西, 一句話寫在 apply.log 裡** ——
--      而那個 log 沒有人讀。**訊號存在 ≠ 訊號被讀。**
-- ⚠️ 這裡**只補那一條約束**, 不重跑整支 D0(它還做別的事, 而那些在鑽機上不需要)。
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_display_id_format;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_display_id_format
  CHECK (
    display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$'
    OR display_id ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$'
  );

BEGIN;

-- admin 鑽機種子 —— **空庫沒有判別力**,所以這裡種到「後台每一頁都看得到東西」為止。
--
-- 🔴 種子的設計原則:**每一種狀態至少一筆**,而不是「多種幾筆好看」——
--    後台的病多半長在「某個狀態沒有人看過」那一格上(例:已取消、未開發票、缺料)。
-- ⚠️ 這些是**捏的資料**,不是正式庫的複製。任何「正式站也長這樣」的結論都不成立。

-- ── 客人(兩個 —— 「換帳號」那一類題目沒有第二個人就構造不出來)──────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111','probe@example.com','{"name":"探針客人甲"}'),
  ('22222222-2222-2222-2222-222222222222','probe2@example.com','{"name":"探針客人乙"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customers (user_id, email, name, phone, tier) VALUES
  ('11111111-1111-1111-1111-111111111111','probe@example.com','探針客人甲','0912345678','general'),
  ('22222222-2222-2222-2222-222222222222','probe2@example.com','探針客人乙','0987654321','general')
ON CONFLICT (user_id) DO NOTHING;

-- ── 商品(12 件,跨 4 品牌 4 分類 —— 篩選/搜尋那幾軸要有東西可篩)──────────────
INSERT INTO products (external_id, title, subtitle, handle, price_by_tier,
                      price_general, price_store, availability, brand_id, category_id,
                      images, fitments, highlights, supplier_slug)
SELECT 'ADMIN-PROBE-' || lpad(g::text, 4, '0'),
  (ARRAY['碳纖維前土除','鋁合金腳踏後移組','煞車拉桿組(可調)','排氣管尾段 Slip-On',
         '水箱護網','鏈條調整器','後視鏡(短柄)','油杯蓋組','車牌架(可調角度)',
         '離合器拉桿護弓','齒盤蓋','側柱加大底座'])[1 + ((g - 1) % 12)] || ' — ' || b.name,
  (ARRAY['乾式碳纖維 · 亮面','CNC 削切 · 陽極處理','六段可調 · 折疊式','鈦合金 · 附回壓塞'])[1 + ((g - 1) % 4)],
  'admin-probe-' || lpad(g::text, 4, '0'),
  jsonb_build_object('general', 3200 + g * 470, 'store', 2600 + g * 400),
  3200 + g * 470, 2600 + g * 400,
  CASE WHEN g % 7 = 0 THEN 'out-of-stock' ELSE 'in-stock' END,
  b.id, c.id, '[]'::jsonb, '[]'::jsonb,
  jsonb_build_array('探針種子資料','非正式庫內容'),
  'rpm'
FROM generate_series(1, 12) g
CROSS JOIN LATERAL (SELECT id, name FROM brands ORDER BY name OFFSET ((g - 1) % 4) LIMIT 1) b
CROSS JOIN LATERAL (SELECT id FROM categories WHERE parent_category_id IS NOT NULL
                    ORDER BY raw_path OFFSET ((g - 1) % 4) LIMIT 1) c;

-- ── 訂單(7 張;付款 × 開票 × 金流管道 三軸都鋪開)──────────────────────────────
-- 🔴 開票那一軸刻意鋪三種值:後台改單表單能填發票,而「未開立」是預設
--    ⇒ 沒有 issued/voided 的種子,那兩個分支【永遠沒有人看過】。
--
-- 🔴🔴 **2026-08-19:`payment_channel` 從【沒寫】改成【明寫】,而那是 W6 `W6-043` M2 的本體。**
--    以前這個欄位不在欄位清單裡 ⇒ 六列全部吃 `NOT NULL DEFAULT 'tappay'`
--    (`20260712203000_m4a_orders_admin_columns.sql:48`)。
--    ⇒ 後果不是資料錯,是**量具失去判別力**:產品真正下的述詞是
--      `payment_channel.neq.tappay,payment_status.neq.unpaid`(`SupabaseOrderAdapter.ts:830-831`),
--      而在「全部都是 tappay」的種子上,它與「只看 payment_status」**輸出一模一樣**
--      ⇒ 自檢那格印著「這一格證明篩選【真的在篩】」,而它**分不出那兩把尺**。
--    ⚠️ 而下面 `payment_method` 那個 `CASE`(g=1 為 NULL)**是另一欄**——
--      讀種子的人會以為「g=1 沒有金流管道」,**而它其實是 tappay**。兩欄的分界見該欄 COMMENT。
--    ⇒ 第 7 列 = **`bank_transfer` × `unpaid`**:它是這份種子裡**唯一**能把兩把尺分開的資料
--      (真述詞下它**該顯示**,退化成只看 payment_status 就會**被藏起來**)。
INSERT INTO orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                    payment_status, fulfillment_status, subtotal, shipping_fee, discount_total,
                    total, shipping_method, invoice, paid_at, payment_method, payment_channel,
                    invoice_status, invoice_number, invoice_amount)
SELECT
  'PCM-2026-' || lpad((1000 + g)::text, 4, '0'),
  CASE WHEN g % 2 = 0 THEN '11111111-1111-1111-1111-111111111111'::uuid
                      ELSE '22222222-2222-2222-2222-222222222222'::uuid END,
  jsonb_build_object('name','探針收件人','phone','0912345678','line','台中市西屯區文心路二段 201 號'),
  'general',
  -- 🔴 enum 逐字(2026-08-19 對本機實查,不是憑印象):
  --    payment_status     = unpaid / paid / partiallyPaid / refunded / partiallyRefunded
  --    fulfillment_status = notOrdered / ordered / inStock / shipped
  --    ⚠️ **沒有 `refunding`** —— 我第一版寫了它,炸在這裡。
  --    數法:select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='payment_status';
  (ARRAY['unpaid','paid','paid','paid','partiallyRefunded','refunded','unpaid'])[g]::payment_status,
  (ARRAY['notOrdered','notOrdered','ordered','shipped','inStock','ordered','notOrdered'])[g]::fulfillment_status,
  s.sub, CASE WHEN s.sub >= 5000 THEN 0 ELSE 100 END, 0,
  s.sub + CASE WHEN s.sub >= 5000 THEN 0 ELSE 100 END,
  -- 🔴🔴 **這裡只能是 'home' / 'store',不能寫中文** —— 而錯誤訊息會指向一個【你沒有設的欄】:
  --    `orders_freeze_shipping_snapshot_bi` 是 BEFORE INSERT trigger,**無條件**執行
  --    `NEW.shipping_method_at_checkout := NEW.shipping_method`,
  --    而 `shipping_method_at_checkout` 有白名單 CHECK(只認 home/store)。
  --    ⇒ 你寫 `shipping_method='宅配到府'` ⇒ 炸的是
  --      `orders_shipping_method_at_checkout_whitelist` ——**一個你根本沒碰的欄位名**。
  --    ⇒ 而**設定 `shipping_method_at_checkout` 也沒有用**:trigger 在你之後覆寫它。
  --    (2026-08-19 建這支腳本時真的踩了兩輪才找到。)
  'home',
  jsonb_build_object('type','personal','carrier','/ABC1234'),
  CASE WHEN g IN (1, 7) THEN NULL ELSE now() - (g || ' days')::interval END,
  CASE WHEN g IN (1, 7) THEN NULL ELSE 'tappay' END,
  -- 🔴 金流管道:前六列 tappay(維持原本的世界),第 7 列 bank_transfer。
  --    白名單 CHECK 只認 tappay / bank_transfer / cash / none
  --    (`20260712203000_m4a_orders_admin_columns.sql:51`,寫別的會炸在 CHECK 上)。
  (ARRAY['tappay','tappay','tappay','tappay','tappay','tappay','bank_transfer'])[g],
  -- 未開立 ×5 / 已開立 ×1 / 已作廢 ×1
  (ARRAY['not_issued','not_issued','issued','not_issued','not_issued','voided','not_issued'])[g],
  CASE WHEN g = 3 THEN 'AB-12345678' WHEN g = 6 THEN 'CD-87654321' ELSE NULL END,
  CASE WHEN g = 3 THEN s.sub WHEN g = 6 THEN s.sub ELSE NULL END
FROM generate_series(1, 7) g
CROSS JOIN LATERAL (SELECT (2400 + g * 1300) AS sub) s;

-- ── 訂單品項(每張 2 項 —— 品項表那一片要有多列才看得出版面)──────────────────
-- 🔴 `order_items` **沒有 `product_id`** —— 它存的是 `variant_sku` + `product_snapshot`
--    (快照式,商品改名/下架都不會動到歷史訂單)。憑印象寫 `product_id` 會炸。
--    數法:select column_name from information_schema.columns where table_name='order_items';
INSERT INTO order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT o.id, p.external_id,
       -- 🔴 `product_snapshot` 是 **exact key set**:恰好 title / sku / spec 三鍵,多一個少一個都炸
       --    (`order_items_snapshot_whitelist`);`spec` 必須是 object 且值全為 string,
       --    且**明文禁止** price_store / price_by_tier / cost 三個鍵(經銷價不進快照)。
       --    ⚠️ 我第一版寫 `variantSku` 當鍵名 ⇒ 多一個鍵、少一個 `sku`/`spec` ⇒ 炸。
       jsonb_build_object('title', p.title, 'sku', p.external_id,
                          'spec', jsonb_build_object('顏色','消光黑')),
       n.q, p.price_general, p.price_general * n.q
FROM orders o
CROSS JOIN LATERAL (SELECT generate_series(1, 2) AS q) n
CROSS JOIN LATERAL (SELECT title, external_id, price_general FROM products
                    WHERE external_id LIKE 'ADMIN-PROBE-%'
                    ORDER BY external_id
                    OFFSET ((('x' || substr(md5(o.display_id || n.q::text), 1, 4))::bit(16)::int) % 12)
                    LIMIT 1) p;

-- ── 對帳:orders.subtotal 必須 = Σ order_items.line_total ────────────────────
-- 🔴 `pcm_e13_orders_subtotal_guard` 是 **DEFERRABLE INITIALLY DEFERRED** 的 constraint trigger
--    ⇒ 它在 **COMMIT 時**才檢查 ⇒ 種子可以「先各自插入、最後一次對齊」。
--    ⚠️ 而 `orders_total_balances` 是**表級 CHECK**(逐列即時)⇒ `subtotal` 與 `total`
--       **必須在同一個 UPDATE 裡一起改**,分兩句會在中間那一刻就違反 total 平衡。
UPDATE orders o
   SET subtotal = s.sum_line,
       total    = s.sum_line + o.shipping_fee - o.discount_total,
       invoice_amount = CASE WHEN o.invoice_number IS NULL THEN NULL
                             ELSE s.sum_line + o.shipping_fee - o.discount_total END
  FROM (SELECT order_id, sum(line_total) AS sum_line FROM order_items GROUP BY order_id) s
 WHERE s.order_id = o.id;

-- ── 🔴 員工一列(2026-08-30 加)——【真 session 的第三道閘要它】────────────────────
-- `authorizeAdminMutation` 第 ③ 道是 `getSessionActor()` → `resolveStaff(id)` →
-- `listActiveStaff()` 裡撈得到才算數。這張表本來是**空的** ⇒ 就算票是對的,第 ③ 道仍然回 null。
-- ⚠️ 兩個 CHECK 要過:`staff_id_format ^[a-z0-9_]{1,64}$`、`staff_label_nonempty`。
-- 🔴 `is_manager = true`:讓 `authorizeManagerMutation` 那一支(⟦b4-MGR0⟧)也走得通 ——
--    否則「管理者專用」的那幾個動作在鑽機上仍然是死的,而那與本次要修的是同一種病。
--    ⚠️ **代價明寫**:這台鑽機上的人是管理者 ⇒ **鑽機證不了「非管理者會被擋下」**。
--    要驗那一面,把這一列改成 `false` 再跑一次 —— 那是另一個世界,不是同一發。
INSERT INTO staff (id, label, is_manager, is_active)
VALUES ('probe_staff', '探針員工', true, true)
ON CONFLICT (id) DO UPDATE SET is_manager = true, is_active = true;


-- ── 🔴🔴 把 `order_display_seq` 推到與種子單一致(2026-08-30 加)──────────────────
-- **成因是量到的, 不是想到的**:種子用**寫死的** `display_id`(`PCM-2026-1001`…)插單,
-- 而**完全沒有動那個序號** ⇒ 它停在 `last_value=1, is_called=f`。
-- ⇒ 任何【自己產號】的路徑(`admin_create_manual_order` 就是)會產出 `PCM-2026-1`
--    ⇒ 撞 `orders_display_id_format`(`^PCM-[0-9]{4}-[0-9]{4,}$` **要 4 位以上**)⇒ `sqlstate 23514`。
-- 🔴 **而那個失敗【看起來像產品壞了】** —— 畫面回 `manual_order_bug`、log 的 `constraint` 是 `null`
--    (那支刻意不記訊息, 因為含 PII ⇒ **那是對的, 不要為了 debug 改它**)。
--    ⇒ 📌 **要分辨「真 bug」與「我的資料不夠真」, 唯一的路是【在拋棄式庫上重放同一筆 payload】,
--       讓 Postgres 自己把 constraint 名字印出來。**本機庫沒有 PII 顧慮 ⇒ 這條路不必動產品碼。
-- ⚠️ 正式庫沒有這個問題:那個序號已經跑過幾千次, 天生就是 4 位以上。
--    ⇒ **這是【鑽機的資料不夠真】, 不是產品缺陷。**
SELECT setval('order_display_seq',
              GREATEST((SELECT COALESCE(MAX(split_part(display_id, '-', 3)::bigint), 0) FROM orders), 1000),
              true);

COMMIT;

-- ── 客人的收件地址與車庫(2026-08-31 線【客人帳戶區】`-08` 補)──────────────
-- 🔴 **為什麼補**:spec `#25` 那一格逐字卡在「地址 / 愛車**判不了** —— 鑽機那兩張表是空的
--    ⇒ 畫面印『目前沒有收件地址』= **沒資料, 不是不能改**」。
--    ⇒ 📌 **那是【鑽機的缺】被記成【產品的未知】** —— 而它擋了那一格九天。
--    ⇒ 種了之後當場判得出來:兩段都印得出來, 而**那兩段裡的互動元素數 = 0** ⇒ 看得到、改不了。
-- ⚠️ 而畫面上那兩段的標題是「收件地址」與**「車庫」**(不是「愛車」)——
--    我第一發用 `愛車|車輛` 找標題得到零命中, 而那不是「沒有那一段」。
INSERT INTO public.customer_addresses
  (id, customer_user_id, is_default, name, phone, line, invoice_type,
   invoice_title, invoice_tax_id, invoice_donate_code, email)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', true,
   '探針客人甲', '0912345678', '台北市中山區測試路 1 號 3 樓', 'personal', '', '', '', 'probe@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO public.customer_vehicles
  (id, customer_user_id, is_primary, name, year, engine, km, mods, dict_brand_name, dict_model_name)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', true,
   'BMW M3 (探針)', '2019', 'S58', '42000', '中冷 / 排氣', 'BMW', 'M3')
ON CONFLICT DO NOTHING;

-- ── 一筆【哨兵收款】(2026-08-31 線【客人帳戶區】`-08` 種;主視窗 `-48` 批「甲 種」)──────
-- 🔴 **為什麼種它**:首頁「今日對帳」的「今日實收(淨)」走 RPC `admin_today_payment_total`。
--    那支 RPC **在鑽機上存在**, 而 `order_payments` **一列都沒有** ⇒ 它今天回 `(0,0)`,
--    而**換一天也回 `(0,0)`** ⇒ 📌 **【正對照造不出來】** ⇒
--    **我分不出「管線正常而真的沒錢」與「管線壞了」** —— 那一格因此驗不了。
--    (同 `#25` 那次:**量具的缺被記成產品的未知**。而收款是【下一個會擋人的空表】。)
--
-- 🔴 **它被做成【一眼看得出是假的】, 不是【查得到它是假的】**(主視窗指定, 比「濾得掉」強一級):
--    · `amount = 1` —— **NT$1**, 現實中不會有人匯 1 元
--    · `bank_reference = 'ZZQ-PROBE-SEED-20260831'` · `note` 也帶同一個字面
--    ⇒ 📌 **「濾得掉」把工作留給下一個人;「一眼看得出」把工作做掉了。**
--
-- ✅ **而分母【已經算好】, 不要下一個人自己扣**(主視窗指定):
--    這台鑽機上的 `order_payments` = **種的 1 筆 + 真的 0 筆**。
--    數法:`select count(*) filter (where bank_reference like 'ZZQ-PROBE-SEED%'
--            or note like '%ZZQ-PROBE-SEED%') from public.order_payments`
--
-- ✅ **種完之後那個正對照就造得出來了**(當場實跑):
--    `admin_today_payment_total` 今天 ⇒ `(1,1)` · 昨天 ⇒ `(0,0)`;首頁畫面 ⇒ **今日實收(淨) NT$ 1**
--    ⇒ 🔴 **⇒ 那條管線【看得見資料】** ⇒ **種之前那個 0 是真的 0, 不是尺沒接上。**
-- 🔴🔴 **2026-09-04:`LIMIT 1` 拿掉 —— 而它原本製造一個【假陽性】。**
--    🔬 走查實測(線 `-db`):`:112` 那個 ARRAY 把**三張**單設成 `paid`,
--       而這一段只插**一筆**(`ORDER BY created_at LIMIT 1`)
--       ⇒ 🎯 **⇒ 另外兩張永遠是「列表寫已收未定 · 明細寫已收 0 元 · 尚未登錄任何收款」**
--       ⇒ ⇒ 🛑 **⇒ 而那看起來就是「列表與明細互相矛盾」—— 一個很有說服力的缺陷。**
--       ⇒ ⇒ ⇒ 📌 **⇒ 下一個走這條路的人會撞到同一發, 而他不會知道那是種子造的。**
--
-- ✅ **修法選「三張都插」而不是「ARRAY 只設一張 paid」**, 理由:
--    ① 一張 `paid` 的單**本來就該有收款列** ⇒ 補齊是讓種子更像真的, 縮 ARRAY 是讓世界變小
--    ② 而縮 ARRAY 會連帶少掉兩個「已付款」的世界 ⇒ **下一個人要測已付款時就沒有樣本**
--    🔵 而**金額仍然是 1 元**:那是「一眼看得出是假的」那條紀律, 不因為變成三筆就放寬。
--
-- ⚠️ **而分母跟著變**:這台鑽機上的 `order_payments` = 種的 **3 筆**(原本 1 筆)+ 真的 0 筆。
INSERT INTO public.order_payments
  (id, order_id, rail, amount, received_at, bank_reference, request_id, actor, note)
SELECT gen_random_uuid(), o.id, 'bank_transfer', 1, now(),
       'ZZQ-PROBE-SEED-20260831-' || o.display_id, gen_random_uuid(), 'probe_staff',
       '🔴 探針種子資料(ZZQ-PROBE-SEED)—— 不是真收款。種它的理由見本檔上方註解。'
  FROM public.orders o
 WHERE o.payment_status = 'paid'
ON CONFLICT DO NOTHING;

-- ── 一張【付過款又全額退掉】的單(2026-09-04 線 `-db` 種)────────────────────────────
-- 🔴 **為什麼種它**:走查【後台看錢】撞到 —— 那張 `refunded` 的單**沒有收款列也沒有退款列**
--    ⇒ 🎯 **⇒ 它是一張「沒付過也沒退過, 而狀態寫已退款」的單** ——
--       而**那種單在真實世界不存在** ⇒ 拿它走查會量到假的東西。
--    ⇒ ⇒ 📌 **⇒ 而要驗 Sean 2026-09-04 那句「已退款的單, 付款完成那一格要打勾(他確實付過)」,
--         前提就是【他真的付過】** ⇒ 沒有收款列的話那一格根本問不出來。
--
-- ✅ **所以順序是:先收款、再退款** —— 而兩筆都掛同一張 `refunded` 的單。
-- 🔵 而**金額對得起來**:收多少就退多少(全額) ⇒ `kind = 'full'`。
-- ⚠️ 而它一樣**一眼看得出是假的**:`bank_refund_id` / `rec_trade_id` 都帶 `ZZQ-PROBE-SEED`。
INSERT INTO public.order_payments
  (id, order_id, rail, amount, received_at, bank_reference, request_id, actor, note)
SELECT gen_random_uuid(), o.id, 'bank_transfer', o.total, now() - interval '2 days',
       'ZZQ-PROBE-SEED-REFUNDED-PAID', gen_random_uuid(), 'probe_staff',
       '🔴 探針種子資料 —— 這張單【先付過】, 下面那筆退款才有前提。'
  FROM public.orders o
 WHERE o.payment_status = 'refunded'
ON CONFLICT DO NOTHING;

-- 🔴🔴 **走【人工退款】那條路, 不是 `order_refunds` —— 而那是 DB 教我的, 不是我讀出來的。**
--    我第一版插 `order_refunds` ⇒ 連撞兩道閘:
--      ① 「初態必須是 processing」⇒ 我改成兩步(insert processing ⇒ update confirmed)
--      ② 而第二道逐字:「訂單 … **沒有 `tappay_rec_trade_id`**(非信用卡交易?),無法登記退款」
--    ⇒ 🎯 **⇒ `order_refunds` 是【信用卡(TapPay)】那條路。而我種的是【銀行匯款】的單。**
--    ⇒ ⇒ 📌 **⇒ 所以「已退款」在這個系統裡【至少有兩條路】, 而它們不是同一張表:**
--         · 刷卡退款 ⇒ `public.order_refunds`(要 `tappay_rec_trade_id` · 有狀態機)
--         · 人工退款 ⇒ `public.order_manual_refunds`(`rail` 只認 bank_transfer / cash)
--    ⇒ ⇒ ⇒ 🛑 **⇒ 下一個人拿這張單當 fixture 時要知道它走的是【人工】那條。**
INSERT INTO public.order_manual_refunds
  (id, order_id, rail, refund_amount, reason, actor, occurred_at)
SELECT gen_random_uuid(), o.id, 'bank_transfer', o.total,
       '探針種子資料:全額退款(不是真退款)', 'probe_staff', now() - interval '1 day'
  FROM public.orders o
 WHERE o.payment_status = 'refunded'
ON CONFLICT DO NOTHING;

-- ── 一張【哨兵訂單】ZZQPRB + 它的哨兵收款(2026-08-31 `-08` 種;主視窗批「丙」)───────────
-- 🔴 **這張單存在的理由, 只有一個**:讓那條預設隱藏述詞的【第二項與第三項分得開】。
--    述詞(`SupabaseOrderAdapter.test.ts:409` 逐字)是 OR:
--      payment_channel.neq.tappay , payment_status.neq.unpaid , and(paid_total.neq.0 , cancelled_at.is.null)
--    ⇒ 一張單只有在【tappay 且 unpaid 且(paid_total=0 或已取消)】三件同時成立時才會被藏。
--    而在種它之前, 這台鑽機上唯一 `paid_total > 0` 的單是 `PCM-2026-1002`,
--    **它的 payment_status 是 paid** ⇒ **第二項就已經讓它顯示** ⇒ 第三項有沒有生效【分不出來】。
--
-- 🛑 **而【不能】改 `PCM-2026-1001` 來湊**(主視窗裁「乙」⇒ 我提丙 ⇒ 批丙):
--    那張單是這台鑽機上**唯一一個「被正確地藏起來」的樣本**。
--    📌 **一個「東西被正確地藏起來」的樣本, 天生比「東西正確地顯示」的樣本難取得** ——
--       **因為前者要三個條件同時成立, 而後者只要一個。**
--    ⇒ **⇒ 在鑽機上, 負向樣本要當【消耗品】管理, 不能順手改掉。**
--
-- ✅ **種完之後那組對照長這樣**(只差 `paid_total` 一項, 其餘完全相同):
--      PCM-2026-1001  tappay / unpaid / paid_total 0  ⇒ 述詞判【藏】· 真畫面【沒出現】
--      ZZQPRB         tappay / unpaid / paid_total 1  ⇒ 述詞判【顯示】· 真畫面【出現】
--    ⇒ 🔴 **變因只有一個 ⇒ 那一項【真的在生效】。**
--
-- ✅ **分母寫成兩個數, 不要合成一個**(主視窗指定):
--      哨兵收款 = **2 筆**(`bank_reference like 'ZZQ-PROBE-SEED%'`)
--      哨兵訂單 = **1 張**(`display_id = 'ZZQPRB'`)
-- ⚠️ **而 `/orders` 預設清單因此從 7 張變 8 張** ——
--    任何引用「預設清單 N 張」的量測**要帶日期**, 否則下一個人會以為它退步了。
INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                           subtotal, shipping_fee, total, shipping_method, invoice, shipping_method_at_checkout,
                           payment_channel, payment_status, fulfillment_status, created_at, updated_at)
SELECT gen_random_uuid(), 'ZZQPRB', o.customer_user_id, o.shipping_address_snapshot, o.tier_at_checkout,
       1, 0, 1, o.shipping_method, o.invoice, o.shipping_method_at_checkout,
       'tappay', 'unpaid', o.fulfillment_status, now(), now()
  FROM public.orders o WHERE o.display_id = 'PCM-2026-1001'
ON CONFLICT DO NOTHING;

INSERT INTO public.order_payments (id, order_id, rail, amount, received_at, bank_reference, request_id, actor, note)
SELECT gen_random_uuid(), o.id, 'bank_transfer', 1, now(),
       'ZZQ-PROBE-SEED-20260831-B', gen_random_uuid(), 'probe_staff',
       '探針種子(ZZQ-PROBE-SEED)—— 為了讓述詞的第二項與第三項分得開'
  FROM public.orders o WHERE o.display_id = 'ZZQPRB'
ON CONFLICT DO NOTHING;
