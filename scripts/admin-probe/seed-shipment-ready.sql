-- 出貨動線【起點】的種子(2026-09-18;Sean 拍甲「建箱 / 標出貨兩個動作要補測試」的第一步)。
--
-- 🔴 **為什麼要有它,而既有的 `seed-shipment-list.sql` 不夠**:
--    那一份種的是**結果**(已出貨 / 已作廢的四箱)—— 它讓「出貨清單那一頁」有東西可看。
--    而「建箱 → 標出貨」這兩個**動作**需要的是**起點**:一張還沒配箱、而貨【已經到了】的單。
--    ⇒ 2026-09-18 實查鑽機:**八張單的到貨量全部是 0** ⇒ 今天那顆「建箱」鈕**按不下去**,
--      而那與「那顆鈕壞了」在畫面上長得一模一樣。
--
-- 🎯 **「可建箱」的定義是從【碼】反推的, 不是看畫面猜的**:
--    `components/orders/shipment-dialog.tsx:577`  逐字 `disabled={c.remaining === 0}`
--    `lib/shipping/shipment-candidates.ts:294-295` 逐字:
--        const raw = summary.instockQuantity - already;
--        const remaining = raw > 0 ? raw : 0;
--    ⇒ **可建箱 ⇔ 該品項「已到貨量」減「已配箱量」> 0。**
--    🔵 而同一支檔 :565-568 特別註明「判能不能出一律看 `remaining`、**不看 `blockedReason`**」
--       ⇒ 所以本種子只要把 `remaining` 做出來就夠, 不必去湊那三句原因文案。
--
-- 🔴🔴 **而 `instock_quantity` 【不能手填】** —— `20260729020000` 檔頭逐字:
--    「order_items 的 ordered_quantity / instock_quantity 由本表明細推導(A4a trigger), **不得手填**」
--    ⇒ 📌 **所以本種子寫的是 `order_item_procurement`(真相表), 讓 trigger 自己推出到貨量。**
--      手填摘要表會被下一次 recompute 洗掉, 而那時候測試會紅在一個跟它無關的地方。
--
-- 🛑 **不碰 `seed-shipment-list.sql` 用的那幾張單**(1001–1004, 今天那片靠它而它是綠的):
--    本種子只動 **PCM-2026-1005(正)** 與 **PCM-2026-1007(負對照)** ——
--    2026-09-18 實查:這兩張的「已配箱」都是 0 ⇒ 兩份種子不會互相覆蓋, 執行順序也不重要。
--
-- 🔴🔴 **為什麼是 1005 而不是別張 —— 而它【不是一張乾淨的單】, 這點必須寫出來**:
--    2026-09-18 實查八張單的付款/出貨狀態, **沒有一張是「已付清 + 貨到 + 沒配過箱」**:
--      1001 unpaid / 1002-1004 partiallyPaid 而且都已有箱 / 1006 **refunded(已退款、實質關單)**
--      1007 unpaid / ZZQPRB 沒有品項
--      1005 partiallyRefunded(畫面印「還差 22,760」)而【已配箱 0】⇒ **是唯一可用的那張**
--    ⇒ 📌 **所以拿它寫測試的人要知道:這張單的付款狀態不乾淨。**
--      要一張真正乾淨的起點,得在種子裡**另外造一張新單**(那是比本片大的一件事)。
--    🔵 我第一版挑的是 1006, 而它是 **refunded** ⇒ 拿一張已退款的單去測建箱是沒有意義的。
--      **是去查「為什麼它不在訂單列表上」才發現的** —— 不是看資料表猜的。

-- ⚠️ **冪等的代價,寫下來**:本檔用固定 UUID + `ON CONFLICT (id) DO NOTHING`。
--    🔴 那表示**改了目標品項卻沿用同一組 id 時, 舊列會原封不動地留著而新列被跳過** ——
--      我自己就撞了一次:把正對照從 1006 換到 1005、id 沒換 ⇒ 驗證印出四列全部「不可建箱」,
--      而**看起來像我的算式錯了**。⇒ 重種前先清:
--        DELETE FROM order_item_procurement_receipts WHERE received_by='probe_seed';
--        DELETE FROM order_item_procurement WHERE supplier_id='5eed0000-0000-4000-8000-000000000001';
--
-- 🔵 冪等:固定 UUID + `ON CONFLICT DO NOTHING`(抄 `seed-shipment-list.sql` 的做法)。
--
-- 跑法:
--   psql -h 127.0.0.1 -p $ADMIN_PROBE_PG -U postgres -f scripts/admin-probe/seed-shipment-ready.sql

\set ON_ERROR_STOP on
BEGIN;

-- ① 供應商(`order_item_procurement.supplier_id` NOT NULL, 而鑽機的 suppliers 是空的)
INSERT INTO public.suppliers (id, label)
VALUES ('5eed0000-0000-4000-8000-000000000001', '鑽機測試供應商')
ON CONFLICT (id) DO NOTHING;

-- ② 採購列(兩張單都要有;`received_quantity` **留 0 不寫** —— 見下面 ③ 的理由)
--    🔴 **第三層守門**:`allocated_quantity` 不得超過該品項的 `order_items.quantity` ——
--       `pcm_a2b1_procurement_allocation_guard()` 會擋, 錯訊逐字「A2b1 超量」。
--       ⇒ 下面每一列的量都**逐筆對齊實查值**(1006: f3a5578f=1 / 58a4ba97=2;1007 同理), 不是抄一個好看的數字。
INSERT INTO public.order_item_procurement
  (id, order_item_id, supplier_id, allocated_quantity, reply_status, first_ordered_at)
VALUES
  -- 🟢 正:PCM-2026-1005
  ('5eed0000-0000-4000-8000-000000000011', '61748060-a8a6-42dc-a04e-d47d7a6a0d8a',
   '5eed0000-0000-4000-8000-000000000001', 1, 'confirmed', now() - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000000012', '1665139a-85f3-4c88-8f22-6f77354f5cce',
   '5eed0000-0000-4000-8000-000000000001', 2, 'confirmed', now() - interval '3 days'),
  -- 🔴 負對照:PCM-2026-1007(下訂了, 而【不】給它到貨明細 ⇒ 永遠 received = 0)
  ('5eed0000-0000-4000-8000-000000000021', 'e0a8c0ce-2f03-4b44-a397-5e7681cfe08b',
   '5eed0000-0000-4000-8000-000000000001', 1, 'confirmed', now() - interval '1 day'),
  ('5eed0000-0000-4000-8000-000000000022', '26d94b93-1ada-4e04-857e-1e66410f784c',
   '5eed0000-0000-4000-8000-000000000001', 2, 'confirmed', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ③ 🔴🔴 **到貨明細 —— 而這是第【二】層「不得直寫」**(動手時才撞到, 寫下來給下一個人):
--    第一層:`order_items` 的 instock_quantity 由 A4a trigger 從採購列推導(`20260729020000` 檔頭)
--    第二層:採購列的 `received_quantity` **也**是推導的 —— 直寫會被
--            `pcm_a4a_received_quantity_guard()` 擋下, 錯訊逐字:
--            「A4a:received_quantity 由重算 trigger 維護(真相 = receipts 明細 SUM),不得直寫」
--    ⇒ 📌 **真正的真相表是 `order_item_procurement_receipts`(到貨明細)。**
--      🎯 而我第一版就是直接寫 received_quantity 被擋的 —— **那道 guard 做了它該做的事。**
--    ⇒ ✅ 所以【只給 1006 到貨明細】;1007 沒有明細 ⇒ received 恆 0 ⇒ 不可建箱。
INSERT INTO public.order_item_procurement_receipts
  -- 🔴 第四層守門:received_by 的形狀是 ^[a-z0-9_]{1,64}$ ⇒ **連字號不合法**
  --    (第一版寫 'probe-seed' 被 CHECK 擋下)⇒ 用底線。
  (id, procurement_id, quantity, received_at, received_by)
VALUES
  ('5eed0000-0000-4000-8000-000000000031', '5eed0000-0000-4000-8000-000000000011',
   1, now() - interval '1 day', 'probe_seed'),
  ('5eed0000-0000-4000-8000-000000000032', '5eed0000-0000-4000-8000-000000000012',
   2, now() - interval '1 day', 'probe_seed')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── 🔬 驗證:用【碼裡那條同一個算式】重算一次 remaining ────────────────────────
--   🛑 **不是驗「插入成功」** —— 插入成功與「那顆鈕可以按」是兩件事。
--   🔵 期望:1006 兩列 remaining > 0(可建箱);1007 兩列 remaining = 0(不可建箱)。
--     兩邊都印出來, 因為**只印可建箱那一半的話, 看不出這把尺會不會對什麼都說「可以」**。
\echo ''
\echo '=== 驗證:remaining = max(0, 已到貨 - 已配箱), 照 shipment-candidates.ts:294-295 ==='
SELECT o.display_id,
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
WHERE o.display_id IN ('PCM-2026-1005', 'PCM-2026-1007')
ORDER BY o.display_id, oi.id;
