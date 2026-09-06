-- ============================================================
-- rollback:`20260815030000_m4b_20_products_listing_set_by_source_missing.sql`
-- ============================================================
-- 🔴🔴 **跑這支之前先讀完下面四條。這不是「刪兩個欄位」那麼單純。**
--
-- ── 1. 前置條件(不做會弄壞正式站)───────────────────────────────────────────
-- **必須先把應用層退回,才能跑這支。** 需要先 revert 的東西:
--   - 片2b:`scripts/rpm-transform.ts` / `scripts/rpm-reconcile.ts` / `scripts/rpm-import.ts`
--   - 片2c:`apps/admin/src/lib/products/product-repository.ts` 的 select projection
--           (`PRODUCT_LIST_COLUMNS` / `PRODUCT_DETAIL_COLUMNS` 會列出這兩欄)
--           與讀它們的元件
-- **順序反過來做的後果**:PostgREST 收到指向不存在欄位的 select ⇒ 回錯 ⇒
-- **商品後台列表頁與詳情頁整頁掛掉**(不是少一欄,是整頁)。
-- (這是 memory `feedback_app-layer-must-not-ship-before-migration-apply` 的反向面。)
--
-- ── 2. 🔴 資料遺失警告(不可逆)—— **兩欄都會遺失,不是只有一欄** ──────────────
--
-- **2a. `source_missing_at`**
-- 記的是「來源端第一次不再吐這筆的時間」。這個資料**只存在於我方,來源端沒有、也重建不回來**。
-- 🔴 **而且不要指望「重跑同步就會補回來」**(關卡2 R2 nit:原句與上面第 1 條自相矛盾)——
-- 第 1 條要求 rollback 前**先 revert 片2b**,而 revert 之後的同步**根本不寫這一欄**。
-- ⇒ 正確說法:**日後重新套用片2b 之後,也只能重建「那時當下仍然缺席」的資料;
--   中間曾經消失又回來的、以及 rollback 到重新套用之間發生的,全部永久消失。**
--
-- **2b. 🔴 `listing_set_by`(關卡2 R1 F2:原本漏了這一欄)**
-- 它記的是「**哪些商品是人決定的**」。DROP 之後:
--   - 所有 `'staff'` 標記**永久消失** —— 而**沒有任何其他地方記過這件事**
--     (`delisted_at` 只記時間、不記是誰設的,這正是本片存在的理由);
--   - **重建不回來**:同步只知道來源說什麼,不知道員工按過什麼;
--   - 後果與 plan §7-1 的 560 筆同形狀 —— **「這批是人決定的」這個事實,分不出來也分不回來。**
-- ⇒ **rollback 前若已經有 `'staff'` 列,先把它們撈出來存檔**:
--      SELECT id, external_id, supplier_slug, delisted_at
--        FROM public.products WHERE listing_set_by = 'staff';
--
-- ── 3. rollback 不會恢復同步的下架能力 ─────────────────────────────────────
-- 「同步不再寫 delisted_at」是**片2b 的 TypeScript** 決定的,不是欄位決定的。
-- 只跑這支 SQL ⇒ 欄位沒了,但同步**仍然不會**自動下架任何商品。
-- **要連下架行為一起退,必須連片2b 的 code 一起 revert(見第 1 條)。**
--
-- ── 4. 驗收(跑完逐條確認,不要只看「沒報錯」)──────────────────────────────
--   a. 兩欄確實消失:
--      SELECT column_name FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='products'
--         AND column_name IN ('listing_set_by','source_missing_at');
--      ⇒ 預期 **0 列**。
--   b. `delisted_at` 仍在、且**值未被本支動過**(這支不碰它,若變了代表跑錯東西):
--      SELECT count(*) FILTER (WHERE delisted_at IS NOT NULL) AS delisted,
--             count(*) AS total
--        FROM public.products;
--      ⇒ 與 rollback 前的數字**必須相同**。跑之前先記下來。
--   c. 商品後台列表頁與詳情頁能開(第 1 條若沒做,這裡會炸)。
-- ============================================================

-- 🔴🔴 **鎖超時 —— 沒有它, 這支在【需要它的那一天】會變成一個不動的游標**(板列 ⟦b4-LOCK1⟧)
--   🔬 線C `-24` 2026-08-28 實測(拋棄式 PG 17.10):一個連線開著交易在讀那張表 ⇒ 另一個連線的
--     表級 DDL **拿不到 `ACCESS EXCLUSIVE`, 擋在那裡**;而 `psql` **預設沒有 `lock_timeout`** ⇒ **無限等**。
--   🛑 **而「很慢」與「卡在鎖上」在那個畫面上是同一件事** —— 兩者都是一個不動的游標。
--   🔴 **時序最毒**:半夜沒人用 ⇒ 20ms;而**要用回退的那一天, 通常是白天**。
--   ✅ 修法不是把它變快, 是**把兩個世界分開**:拿不到鎖就報錯, 不要靜靜地等。
--   ⚠️ 撞到 `lock_not_available` **不是這支寫錯** —— 是當下有人握著鎖 ⇒ 等他結束再跑, **不要拿掉這一行**。
--   🔵 **本檔沒有 `BEGIN;`** ⇒ 用 **session 級** `SET`(不是 `SET LOCAL` —— 那需要交易)。
--     ⚠️ 它會活到這個 psql session 結束。單發回退沒差, 而**若你把本檔貼進一個更大的 session, 記得它還在**。
SET lock_timeout = '5s';
-- 🔵 拿到鎖之後的掃描也要有上界 —— `lock_timeout` 只管【等鎖】那一段。
SET statement_timeout = '30s';

ALTER TABLE public.products
  DROP COLUMN IF EXISTS source_missing_at,
  DROP COLUMN IF EXISTS listing_set_by;
