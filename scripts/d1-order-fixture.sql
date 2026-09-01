-- 拋棄式 harness 專用:最小訂單 fixture(**只給 provision 用,絕不 apply 到任何真的庫**)。
--
-- 🎯 為什麼存在:`supabase/migrations/20260820020000_…_a8a3g_cancel_guard_sibling_dedup.sql:137`
--   的 probe 要「借一張既有訂單」,而 replay-from-zero 的庫是空的 ⇒ 它 `:139` fail-closed 拒繼續。
--   🔴 **那道斷言是對的,而它逐字寫著「不要把這道斷言拿掉」⇒ 本檔一個字都不動它,只補它要的世界。**
--
-- 🔵 為什麼放在 `scripts/` 而不是 `supabase/migrations/`:
--   那支 migration 的註解(:127-131)說「INSERT 會被 subtotal-writers-allowlist 掃成金額寫入者」——
--   **而那條理由只對 `supabase/migrations/` 那一側成立**:
--   `apps/admin/src/lib/orders/subtotal-writers-allowlist.test.ts:9` 逐字
--   「**只掃 `supabase/migrations/*.sql`** —— 字集就是這樣,別的目錄一律看不到」。
--   ⇒ 📌 **所以本檔不會、也不該進那張白名單。**
--
-- 🛑 **迴圈跑完就刪**(刪在 `d1t2-rehearsal.sh` 套完所有 migration 之後、5/5 造假資料之前):
--   provision 5/5 逐字斷言 `SELECT count(*) FROM public.orders` = **31** ⇒ 留著它會變 32
--   ⇒ **留下來會弄壞一道既有的、正確的斷言。**
--   🔴 **而【刪的位置】改過一次,而那是量出來的**:原本刪在 a8a3g 那一支的正後方,
--     結果下一支 `20260820021000` **也要借一張訂單**(而且還多要一位 `is_active` 的 staff)
--     ⇒ 📌 **「哪幾支需要 fixture」不是一個查得到的清單, 是撞出來的** ⇒ 所以改成撐過整個迴圈。
--   ⚠️ 而它仍然可能有第三支需要【別的東西】—— 那時候它會用自己的話說, 而那是對的。

-- ⚠️ **本檔【不造 staff】, 而那是量出來之後【拿掉】的**:`20260820021000:358` 逐字
--   `SELECT s.id INTO v_actor FROM public.staff s WHERE s.is_active LIMIT 1` ⇒ 它要一位啟用中的員工;
--   我一度以為那也要補, 而實查 `20260726120000_m4b_e8a1_staff_table.sql` 就種了 `sean` / `staff_1` / `staff_2`
--   ⇒ **那支在需要它的那一支【之前】** ⇒ 前提本來就成立, 我補的那一列是多的。
--   📌 **⇒ 兩個前提一起紅的時候, 看起來像兩個缺口 —— 而其中一個只是被另一個擋住而已。**
--   ⇒ 下面的自檢仍然驗那一格(只是改成【驗它本來就成立】, 不是【驗我補成功了】)。
--
-- ⚠️ 效度限制:這是**最小**形狀,不是真實訂單的形狀(金額全 0、無 order_items、無 consents)。
--   它只夠讓那支 probe「借得到一列且 customer_user_id 非空」。要測金額行為的片不要拿它當 fixture。

\set fx_uid '''00000000-0000-4000-8000-00000000a8a3'''

INSERT INTO auth.users (id, email, created_at)
VALUES (:fx_uid::uuid, 'harness-a8a3@example.invalid', pg_catalog.now());

-- 🔴 `auth.users` 上有 trigger 會自己補一列 customers ⇒ 不加 ON CONFLICT 會撞 customers_pkey
--    (實測:2026-09-01 第一發就是死在這裡)。加了它在「有 trigger」與「沒 trigger」兩個世界都對。
INSERT INTO public.customers (user_id, email, name)
VALUES (:fx_uid::uuid, 'harness-a8a3@example.invalid', 'harness fixture')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.orders (
  display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, discount_total, total,
  shipping_method, shipping_method_at_checkout, invoice
) VALUES (
  'PCM-2026-9001', :fx_uid::uuid,
  '{"name":"harness","phone":"0900000000","line":"fixture"}'::jsonb,
  'general'::public.member_tier,
  -- 🔴 金額不是 0, 而那是【第三次撞出來的】:`20260820021000:365` 要
  --    `pcm_order_refundable_remaining(order) >= 1`, 而那支函式(實讀 prosrc)是
  --    `orders.total` 減去三段退款 ⇒ **total=0 的訂單可退餘額必然 0** ⇒ 它會 fail-closed。
  --    ⇒ 100 是任意的小額,唯一的條件是 >= 1;而 `orders_total_balances` 要求
  --      `total = subtotal + shipping_fee - discount_total` ⇒ 100 = 100 + 0 - 0。
  --    ⚠️ 它仍然不是真實訂單:沒有 order_items、沒有收款列。要測金額行為的片不要借它。
  100, 0, 0, 100,
  'home', 'home',
  '{"type":"personal"}'::jsonb
);

-- 🔴 自檢:插完當場數一次。**「插了」與「插成功了」是兩個宣稱** ——
--    ON CONFLICT DO NOTHING 那一發若把訂單那列也吞掉,下游只會看到「probe 說 orders 零列」,
--    而那句話會被讀成「fixture 沒接上」以外的一百種東西。
DO $fx$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.orders WHERE display_id = 'PCM-2026-9001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'd1-order-fixture:插完 orders 應恰 1 列,實 % 列 ⇒ fixture 沒造出來,拒繼續', n;
  END IF;
  SELECT count(*) INTO n FROM public.orders
   WHERE display_id = 'PCM-2026-9001' AND customer_user_id IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'd1-order-fixture:customer_user_id 是 NULL ⇒ 那支 probe 的 :138 仍會 fail-closed,拒繼續';
  END IF;
  SELECT count(*) INTO n FROM public.staff WHERE is_active;
  IF n < 1 THEN
    RAISE EXCEPTION 'd1-order-fixture:沒有任何 is_active 的 staff ⇒ 20260820021000:358 仍會 fail-closed,拒繼續';
  END IF;
  RAISE NOTICE 'd1-order-fixture ✅ 最小訂單 + 一位啟用中 staff 已就緒;迴圈跑完會被刪除';
END
$fx$;
