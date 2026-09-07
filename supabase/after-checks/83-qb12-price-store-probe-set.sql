-- ═══════════════════════════════════════════════════════════════════════════
-- 貼板 83 · QB-12 經銷價正式庫驗 —— 步驟 ②:把一個 variant 的 price_store 設成 87
-- ═══════════════════════════════════════════════════════════════════════════
-- 授權:Sean 2026-09-07 拍 `QB-12 甲`;plan 由線【身分】`-auth` 主筆
--       (`~/pcm-mailbox/plan-QB12-經銷價正式庫驗-20260907.md`), 本檔由線【資料】`-db` 出。
-- 🛑 **這是【暫時的】改動 —— 驗完要用 `83r` 還原。**
--
-- 🔵 **為什麼放在 `supabase/after-checks/` 而不是 `supabase/migrations/`**:
--    它是**一次性的探針**, 驗完就還原。放進 migrations ⇒ 從零重播時會把一個
--    **測試用的價格**寫進乾淨的庫裡, 而那個價格會一路跟著每一次重播。
--    ⇒ 📌 本目錄的慣例逐字:**「那裡放的是給人貼的東西, 不進自動重播」**。
--    ⇒ 連帶:**本檔【不進 `APPLIED.tsv`】, 也不該有帳本列** —— 它不是一個「已套用的變更」。
--
-- 🛑 **純 SQL, 不含任何 psql meta 指令(`\` 開頭)** —— 本目錄慣例, 為了 Supabase SQL Editor
--    貼得動(`\set` 會在第一行就 42601)。要在 psql 裡跑而且遇錯就停 ⇒ 在**命令列**給:
--      psql -v ON_ERROR_STOP=1 -f <本檔>
--
-- 🔴🔴 **欄名:我量過 catalog, 不是照抄別人的字面**(2026-09-07 唯讀):
--      public.product_variants 的欄是 **id / sku / price_general / price_store**
--      ⛔ ~~`variant_id` / `variant_sku`~~ —— 那是 **`order_items`** 的欄名, 這張表沒有。
--      📌 兩張表講同一件事而用不同的欄名, 那正是最容易照抄錯的地方。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $qb12$
DECLARE
  c_variant  constant uuid    := '73537121-9739-4e0a-9263-9c0533f98e41';
  c_sku      constant text    := '0003090';
  c_price    constant integer := 87;
  v_n        integer;
  v_store    integer;
  v_filled   integer;
BEGIN
  -- ── 前置① 🔴 **這一格是【能不能做】的前提, 不是事後對帳** ─────────────
  --   只有經銷身分看得到 `price_store`。若有任何一個 `store` 客人,
  --   測試窗口內就有**真客人可能用 87 結帳**。
  --   🛑 **問法是 `count(*) WHERE tier='store'`, 不是 `GROUP BY tier`** ——
  --     實測正式庫 `GROUP BY tier` **只回一列 `general`**, `store` 那一列**根本不存在**
  --     ⇒ 📌 **「沒有那一列」與「那一列是 0」在畫面上是兩個不同的東西**,
  --       而 count 兩種情況都回 0 ⇒ 只有 count 問得對。
  SELECT count(*) INTO v_store FROM public.customers WHERE tier = 'store';
  IF v_store <> 0 THEN
    RAISE EXCEPTION 'QB-12 前置①失敗:customers 有 % 個 store tier ⇒ 不准貼(測試窗口內真客人會拿到 87 元)', v_store;
  END IF;

  -- ── 前置② 全庫 price_store 非空的必須恰好 1 筆(= 儲值那筆)────────────
  --   🔴 它是**分母的基準**:做完必須是 2, 還原完必須回到 1。
  SELECT count(*) INTO v_filled FROM public.product_variants WHERE price_store IS NOT NULL;
  IF v_filled <> 1 THEN
    RAISE EXCEPTION 'QB-12 前置②失敗:price_store 非空的現在有 % 筆(預期 1)⇒ 基準不成立, 停', v_filled;
  END IF;

  -- ── 前置③ 目標那一列必須存在、sku 對得上、而且現在是 NULL ──────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.product_variants
     WHERE id = c_variant AND sku = c_sku AND price_store IS NULL
  ) THEN
    RAISE EXCEPTION 'QB-12 前置③失敗:目標 variant(id=% sku=%)不存在、sku 對不上、或 price_store 已經有值 ⇒ 停',
      c_variant, c_sku;
  END IF;

  -- ── 動手 ────────────────────────────────────────────────────────────
  --   🛑 **`sku <> 'PCM-BALANCE-1'` 是【防守】** —— 全庫唯一一筆非空的 price_store 是它,
  --     動到它會弄壞儲值那條線。
  --   🛑 **而下面「恰好 1 列」是【證明】** —— 防守說「我沒打算碰它」,
  --     證明說「我真的只碰了那一個」。📌 兩個都要, 少一個就只剩意圖。
  UPDATE public.product_variants
     SET price_store = c_price
   WHERE id = c_variant
     AND sku = c_sku
     AND sku <> 'PCM-BALANCE-1'
     AND price_store IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'QB-12 fail-closed:UPDATE 動到 % 列(必須恰好 1)⇒ 整片回捲', v_n;
  END IF;

  -- ── 事後 ────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_filled FROM public.product_variants WHERE price_store IS NOT NULL;
  IF v_filled <> 2 THEN
    RAISE EXCEPTION 'QB-12 事後閘:price_store 非空的變成 % 筆(預期 2)⇒ 整片回捲', v_filled;
  END IF;

  RAISE NOTICE 'QB-12 步驟②完成:variant % 的 price_store 設成 %;非空數 1 ⇒ 2。驗完請跑 83r 還原。',
    c_variant, c_price;
END $qb12$;

COMMIT;
