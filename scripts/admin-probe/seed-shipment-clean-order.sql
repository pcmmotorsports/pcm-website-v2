-- 出貨動線的【乾淨起點】種子(2026-09-18;Sean 拍乙:另外造一張全新的單,不要將就 1005)。
--
-- 🔴 **為什麼要造新單, 而不是用既有的哪一張**:
--    2026-09-18 實查鑽機八張單的付款 / 出貨狀態 ⇒ **沒有一張是「已付清 + 貨到 + 沒配過箱」**
--      1001 unpaid · 1002-1004 partiallyPaid 而且都已有箱 · 1006 refunded(實質關單)
--      1007 unpaid · ZZQPRB 無品項 · 1005 partiallyRefunded(畫面印「還差 22,760」)
--    ⇒ 📌 拿其中任何一張寫建箱測試, 都會把「尾款未收 / 已退款」混進測試的前提裡,
--      而那會讓下一個人分不出「測試在測建箱」還是「在測一張髒單的行為」。
--
-- 🎯 **這一份種的是【起點】**:單號 `PCM-2026-9001`
--    🔵 為什麼是 9001:`orders_display_id_format` 只收 ^PCM-[0-9]{4}-[0-9]{4,}$ 或六碼 base32
--      ⇒ 我第一版寫 `PCM-PROBE-SHIP` 被 CHECK 擋下。9xxx 這一段與既有的 1001-1007 不會撞。。
--    · 已付清(order_payments 覆蓋全額)
--    · 貨已到(走真的到貨明細, 見下面四道守門)
--    · 沒配過箱
--
-- 🔴🔴 **四道守門一道都不繞**(2026-09-18 逐道撞過, 每一道都擋下我一次):
--    ① `order_items.instock_quantity` 由 A4a trigger 推導 ⇒ 不得手填
--    ② 採購列的 `received_quantity` **也**是推導的 ⇒ 真相表是 `order_item_procurement_receipts`
--    ③ `allocated_quantity` 不得超過 `order_items.quantity`(A2b1 超量)
--    ④ `received_by` 的形狀是 ^[a-z0-9_]{1,64}$ ⇒ **連字號不合法**
--    🛑 繞過去的種子等於在種一個不存在的世界。
--
-- ⚠️ **固定 UUID + ON CONFLICT DO NOTHING 的代價**(我自己撞過一次):
--    換了目標品項卻沿用同一組 id ⇒ 舊列留著、新列被跳過, 而驗證會長得像算式錯了。
--    ⇒ 本檔用**專屬的 `c1ea…` 號段**,與 `seed-shipment-ready.sql` 的 `5eed…` 段**不重疊**。
--    重種:DELETE 掉 received_by='clean_seed' 的到貨明細與 supplier_id='c1ea…0001' 的採購列, 再跑一次。
--
-- 🛑 不碰 `seed-shipment-list.sql`(1001–1004)與 `seed-shipment-ready.sql`(1005/1007)——
--    三份用**不同的單、不同的號段**, 執行順序無關。
--
-- 跑法:psql -h 127.0.0.1 -p $ADMIN_PROBE_PG -U postgres -f scripts/admin-probe/seed-shipment-clean-order.sql

\set ON_ERROR_STOP on
BEGIN;

-- ① 供應商(專屬一個, 不共用 5eed 那個)
INSERT INTO public.suppliers (id, label)
VALUES ('c1ea0000-0000-4000-8000-000000000001', '鑽機乾淨單供應商')
ON CONFLICT (id) DO NOTHING;

-- ② 單本體 —— 快照欄位抄既有那張(不自己編收件人 / 發票結構), 只把狀態設成【已付清】
--    🔵 total 故意設成好算的 10,000, 讓下面那筆付款「剛好付清」一眼看得出來。
INSERT INTO public.orders
  (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
   subtotal, shipping_fee, total, shipping_method, invoice, shipping_method_at_checkout,
   payment_channel, payment_status, fulfillment_status, created_at, updated_at)
SELECT 'c1ea0000-0000-4000-8000-000000000101', 'PCM-2026-9001', o.customer_user_id,
       o.shipping_address_snapshot, o.tier_at_checkout,
       10000, 0, 10000, o.shipping_method, o.invoice, o.shipping_method_at_checkout,
       'bank_transfer', 'paid', 'notOrdered', now(), now()
  FROM public.orders o WHERE o.display_id = 'PCM-2026-1001'
ON CONFLICT (id) DO NOTHING;

-- ③ 品項:一樣兩件, 形狀抄既有品項的 product_snapshot(不自己編商品結構)
INSERT INTO public.order_items
  (id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT 'c1ea0000-0000-4000-8000-000000000201',
       'c1ea0000-0000-4000-8000-000000000101',
       oi.variant_sku, oi.product_snapshot, 2, 3000, 6000
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
 WHERE o.display_id = 'PCM-2026-1001' ORDER BY oi.id LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.order_items
  (id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
SELECT 'c1ea0000-0000-4000-8000-000000000202',
       'c1ea0000-0000-4000-8000-000000000101',
       oi.variant_sku, oi.product_snapshot, 1, 4000, 4000
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
 WHERE o.display_id = 'PCM-2026-1001' ORDER BY oi.id DESC LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- ④ 付款:一筆把全額付清(10,000)⇒ 畫面上要印「已收足」, 不是「還差 N」
INSERT INTO public.order_payments
  (id, order_id, rail, amount, received_at, bank_reference, request_id, actor, note)
VALUES ('c1ea0000-0000-4000-8000-000000000301',
        'c1ea0000-0000-4000-8000-000000000101', 'bank_transfer', 10000, now(),
        'CLEAN-PROBE-SEED-20260918', 'c1ea0000-0000-4000-8000-000000000302', 'probe_staff',
        '鑽機乾淨單種子:一筆付清, 讓出貨測試的起點不含「尾款未收」這個變因')
ON CONFLICT (id) DO NOTHING;

-- ⑤ 採購列(下訂)—— `received_quantity` 留 0 不寫(守門②)
INSERT INTO public.order_item_procurement
  (id, order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at)
VALUES
  ('c1ea0000-0000-4000-8000-000000000401', 'c1ea0000-0000-4000-8000-000000000201',
   'c1ea0000-0000-4000-8000-000000000001', 2, 'confirmed', now() - interval '2 days'),
  ('c1ea0000-0000-4000-8000-000000000402', 'c1ea0000-0000-4000-8000-000000000202',
   'c1ea0000-0000-4000-8000-000000000001', 1, 'confirmed', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── 🔵 負對照②:**到貨【之前】這張單也不可建箱** ─────────────────────────────
--   🎯 這一格證明「可建箱」是被【到貨】打開的, **不是這張單天生就開著**。
--   🛑 沒有它, 「我種對了」與「這張單本來就可以建箱」分不開。
--
--   🔴🔴 **而它只在【第一次從乾淨狀態跑】的時候有意義** —— 重跑時到貨明細已經在了,
--      這一格會印 2 / 1 而不是 0。
--      ⛔ ~~第一版的標題逐字寫「期望兩列都是 0」~~ —— **那在重跑時是一句假話**,
--         而假話旁邊擺著一個 2 比沒有標題更糟。
--      ⇒ ✅ 改成**自己說得出它在哪一種情況**:下面那句判定會分「負對照成立」與「這次是重跑」。
\echo ''
\echo '=== 負對照②:到貨【之前】這張單可不可建箱 ==='
SELECT oi.id,
       coalesce(s.instock_quantity, 0) AS 已到貨,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM public.order_item_procurement_receipts r
                          JOIN public.order_item_procurement p ON p.id = r.procurement_id
                          WHERE p.order_item_id = oi.id)
           THEN '🟢 負對照成立:還沒到貨 ⇒ 不可建箱'
         ELSE '⚪ 這次是重跑(到貨明細已經在了)⇒ 這一格【不適用】, 不是失敗'
       END AS 判定
FROM public.order_items oi
LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
WHERE oi.order_id = 'c1ea0000-0000-4000-8000-000000000101' ORDER BY oi.id;

-- ⑥ 到貨明細(守門①②的真相表)⇒ 這一步之後才變成可建箱
BEGIN;
INSERT INTO public.order_item_procurement_receipts
  (id, procurement_id, quantity, received_at, received_by)
VALUES
  -- 🔴 received_by 不能有連字號(守門④)
  ('c1ea0000-0000-4000-8000-000000000501', 'c1ea0000-0000-4000-8000-000000000401',
   2, now() - interval '4 hours', 'clean_seed'),
  ('c1ea0000-0000-4000-8000-000000000502', 'c1ea0000-0000-4000-8000-000000000402',
   1, now() - interval '4 hours', 'clean_seed')
ON CONFLICT (id) DO NOTHING;
COMMIT;

-- ── 🔬 驗證:不是「插入成功」, 是【那顆鈕可以按】的那個條件成立 ────────────────
\echo ''
\echo '=== 驗證:remaining = max(0, 已到貨 - 已配箱), 照 shipment-candidates.ts:294-295 ==='
SELECT o.display_id, o.payment_status AS 付款,
       oi.id AS order_item_id,
       coalesce(s.instock_quantity, 0) AS 已到貨,
       coalesce((SELECT sum(si.shipped_quantity) FROM public.shipment_items si
                 JOIN public.shipments sh ON sh.id = si.shipment_id
                 WHERE si.order_item_id = oi.id AND sh.deleted_at IS NULL), 0) AS 已配箱,
       greatest(0, coalesce(s.instock_quantity, 0)
                   - coalesce((SELECT sum(si.shipped_quantity) FROM public.shipment_items si
                               JOIN public.shipments sh ON sh.id = si.shipment_id
                               WHERE si.order_item_id = oi.id AND sh.deleted_at IS NULL), 0)) AS remaining,
       CASE WHEN greatest(0, coalesce(s.instock_quantity, 0)
                             - coalesce((SELECT sum(si.shipped_quantity) FROM public.shipment_items si
                                         JOIN public.shipments sh ON sh.id = si.shipment_id
                                         WHERE si.order_item_id = oi.id AND sh.deleted_at IS NULL), 0)) > 0
            THEN '🟢 可建箱' ELSE '🔴 不可建箱' END AS 判定
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
WHERE o.display_id = 'PCM-2026-9001'
ORDER BY oi.id;

\echo ''
\echo '=== 付款:已收 vs 應收(期望剛好付清)==='
SELECT o.display_id, o.total AS 應收,
       coalesce((SELECT sum(p.amount) FROM public.order_payments p WHERE p.order_id = o.id), 0) AS 已收,
       o.payment_status AS 狀態
FROM public.orders o WHERE o.display_id = 'PCM-2026-9001';
