-- ═══════════════════════════════════════════════════════════════════════════
-- 貼板 83b · QB-12 對帳(🟢 **唯讀 —— 全檔只有 SELECT, 零寫入**)
-- ═══════════════════════════════════════════════════════════════════════════
-- 怎麼用:**貼 83 之前跑一次、貼完跑一次、跑完 83r 之後再跑一次**, 三份輸出並排比。
-- 🛑 **格 (a) 不只是對帳, 它是【前置條件】** —— 貼 83 之前那一發若不是 0, **就不要貼**。
-- 🛑 純 SQL, 不含 psql meta 指令 ⇒ Supabase SQL Editor 貼得動。
-- ═══════════════════════════════════════════════════════════════════════════

-- 🟢 正對照:證明這份輸出真的是這支查詢產的(而不是別人的舊畫面)
SELECT '0-CONTROL 必有' AS 格, md5('x') AS 值, '' AS 備註;

-- ── (a) 前置條件:經銷身分的客人數 ──────────────────────────────────────
-- 🔴 **用 count 不用 GROUP BY** —— 實測正式庫 `GROUP BY tier` 只回一列 `general`,
--    `store` 那一列**根本不存在**。📌 「沒有那一列」與「那一列是 0」在畫面上是兩件事,
--    而 count 兩種情況都回 0 ⇒ 只有 count 問得對。
SELECT '(a) store tier 客人數' AS 格, count(*)::text AS 值,
       '🔴 必須是 0 —— 不是 0 就【不要貼 83】' AS 備註
  FROM public.customers WHERE tier = 'store';
-- 🟢 正對照:同一把尺問 general ⇒ 應該是 15(2026-09-07 讀數)⇒ 尺是活的
SELECT '(a) 🟢正對照 general' AS 格, count(*)::text AS 值, '尺會動就不會是 0' AS 備註
  FROM public.customers WHERE tier = 'general';

-- ── (b) price_store 非空的筆數 ─────────────────────────────────────────
SELECT '(b) price_store 非空' AS 格, count(*)::text AS 值,
       '貼前 1 · 貼後 2 · 還原後回 1' AS 備註
  FROM public.product_variants WHERE price_store IS NOT NULL;
-- 逐筆列出來(1~2 筆而已), 讓人一眼看得出多的那筆是不是我們設的 87
SELECT '(b) 逐筆' AS 格, v.sku AS 值,
       'price_store=' || v.price_store::text || ' price_general=' || coalesce(v.price_general::text,'(NULL)') AS 備註
  FROM public.product_variants v WHERE v.price_store IS NOT NULL ORDER BY v.sku;

-- ── (b2) 目標那一列自己 ────────────────────────────────────────────────
SELECT '(b2) 目標 variant' AS 格,
       coalesce(v.price_store::text, '(NULL)') AS 值,
       'sku=' || v.sku || ' price_general=' || coalesce(v.price_general::text,'(NULL)')
         || ' ⇒ 貼後應該是 87, 還原後應該是 (NULL)' AS 備註
  FROM public.product_variants v
 WHERE v.id = '73537121-9739-4e0a-9263-9c0533f98e41';
-- 🔴 負對照:現造一個不存在的 id ⇒ 必須零列(證明上面那一列不是「查什麼都回東西」)
SELECT '(b2) 🔴負對照 假 id' AS 格, v.sku AS 值, '必須零列' AS 備註
  FROM public.product_variants v
 WHERE v.id = '00000000-0000-0000-0000-000000000000';

-- ── (c) 測試單的狀態 + order_cancellations 有沒有那一列 ──────────────────
-- 🔵 這一格**不只是對帳** —— `pcm_unpaid_cancelled` 那條寄信軌【要 order_cancellations 有列】,
--    而 `admin_mark_order_cancelled`(20260902140000:106)不寫那張表
--    ⇒ 📌 **它同時回答「那封取消信到底寄了沒」**(來源:線【帳號】`-account`)。
SELECT '(c) 測試單' AS 格,
       o.display_id AS 值,
       'payment_status=' || coalesce(o.payment_status,'(NULL)')
         || ' cancelled_at=' || coalesce(o.cancelled_at::text,'(NULL)')
         || ' total=' || coalesce(o.total::text,'(NULL)') AS 備註
  FROM public.orders o
 WHERE o.id IN (SELECT oi.order_id FROM public.order_items oi
                 WHERE oi.variant_sku = '0003090')
 ORDER BY o.created_at DESC LIMIT 5;
SELECT '(c) order_cancellations' AS 格, count(*)::text AS 值,
       '🔴 0 = 那封取消信【沒有】被排進去' AS 備註
  FROM public.order_cancellations c
 WHERE c.order_id IN (SELECT oi.order_id FROM public.order_items oi
                       WHERE oi.variant_sku = '0003090');
-- 🟢 正對照:整張 order_cancellations 有幾列(0 的話上面那個 0 沒有判別力)
SELECT '(c) 🟢正對照 整表列數' AS 格, count(*)::text AS 值,
       '這個也是 0 ⇒ 上面那個 0 是【表是空的】不是【這張單沒排到】' AS 備註
  FROM public.order_cancellations;
