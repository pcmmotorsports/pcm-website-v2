-- ============================================================
-- M-2-08 前半 · `get_effective_prices` —— 登入的經銷會員拿得到自己那個 tier 的價
-- ============================================================
-- plan:docs/specs/2026-09-06-m2-08-dealer-tier-pricing-plan.md §D(形狀甲)
-- 板列:⟦auth-DEALERTIERPRICING⟧ · 派工 mainB 2026-09-07
--
-- ── 🔴🔴 為什麼一定要 SECURITY DEFINER(這不是偷懶, 是量到的) ──────────
--   2026-09-06 正式庫唯讀實測:`anon` 與 `authenticated` 對 `public.products` 的 SELECT
--   **皆為 false**(🟢 正對照 全庫 policy 102 條 · 🟢 負對照 anon DELETE = false)
--   ⇒ 📌 **一般登入者根本讀不到那張表** ⇒ invoker 權限跑不動。
--
-- ── 🔴🔴 它【不收 tier 參數】—— 而那是本片的承重點 ──────────────────
--   收參數 = 把「你是哪一級」的判斷權交給呼叫端 ⇒ 一個 bug 就等於偽造。
--   ⇒ tier 由函式**內部**從 `auth.uid()` 查 `public.customers` 取得。
--   🛑 `auth.uid()` 是 NULL(未登入 / 用 service_role 或裸 anon key 叫)⇒ **一律 general**。
--
-- ── ⚠️ 它答不出什麼(先寫, 免得下一個人以為它守住了全部)────────────
--   · 它**不算稅**。稅由付款方式決定(Sean 2026-09-06 Q24 逐字「刷卡+5%, 匯款不用」),
--     而付款方式是結帳頁才選的 ⇒ 那是 B2 與後半的格子。本檔一個字都不碰。
--   · 它**不管 premiumStore** —— 本片範圍只到 store(plan §C)。
--   · 它回的是【該 tier 的價】, **不回其他 tier 的價** ⇒ 一般會員拿不到 store 價,
--     而那正是 Server 端鐵則「經銷價絕不傳到一般會員瀏覽器」在 DB 層的落點。
-- ============================================================

-- 🔴 整支包在交易裡(`scripts/migration-txn-wrap-gate.py` 要的)——
--    理由逐字:「跑到一半失敗 ⇒ 前面那幾句【留在庫裡】…
--    📌 一道會叫的斷言, 在沒有交易包著時, 擋不住它自己前面那幾句。」
--    ⇒ 本檔尤其需要:下面那個 DO 斷言若紅, 函式與 GRANT 已經寫進去了。
BEGIN;

-- 🔴 裸 `CREATE`, **不是 `CREATE OR REPLACE`** —— 它是新物件, 撞名要當場紅。
--    `scripts/migration-static-checks.sh` ① 逐字:「OR REPLACE 會把撞名靜靜蓋掉,
--    而你的 REVOKE 與斷言照樣綠 —— 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。」
CREATE FUNCTION public.get_effective_prices(p_product_ids uuid[])
RETURNS TABLE (product_id uuid, amount integer, currency text, tier text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tier text := 'general';
  v_uid  uuid := auth.uid();
BEGIN
  -- 🔴 輸入上限:防有人一次要十萬個 id 把 definer 權限當成掃表工具。
  IF p_product_ids IS NULL OR pg_catalog.cardinality(p_product_ids) = 0 THEN
    RETURN;
  END IF;
  -- 🔴🔴 **`array_length(a, 1)` 只量【第一維】** —— codex R1 must-fix ①:
  --    餵一個 2×200 的陣列, 第一維長度是 **2** ⇒ 上限形同虛設而實際查了 400 個 id。
  --    ✅ `cardinality()` 數的是**總元素數**;而多維陣列本身沒有正當用途 ⇒ 直接拒。
  IF pg_catalog.array_ndims(p_product_ids) <> 1 THEN
    RAISE EXCEPTION 'get_effective_prices:只收一維陣列(收到 % 維)',
      pg_catalog.array_ndims(p_product_ids);
  END IF;
  IF pg_catalog.cardinality(p_product_ids) > 200 THEN
    RAISE EXCEPTION 'get_effective_prices:一次最多 200 個 id(收到 %)',
      pg_catalog.cardinality(p_product_ids);
  END IF;

  -- 🔴 tier 只從 auth.uid() 查, 不從參數來。查不到 ⇒ 維持 general(fail-closed 方向:
  --    「拿不到身分」的結果是【看到公開價】, 不是【看到經銷價】)。
  -- 🔴 plan §G(codex R1 must-fix ③):**缺身分不得靜默成功。**
  --    有 EXECUTE 的人卻沒有 uid ⇒ 那不是訪客, 是接線壞了(client 用了不帶 JWT 的 key)。
  --    而它與「這件商品沒有經銷折扣」在回傳值上**長得一模一樣** ⇒ 沒有訊號就永遠不會有人知道。
  --    🛑 只記【有沒有拿到 uid】與【有沒有找到 customer】—— **不記 uid 本身**(那是個資)。
  IF v_uid IS NULL THEN
    RAISE WARNING 'get_effective_prices:沒有 auth.uid() ⇒ 一律 general。'
      '呼叫端若是【登入的客人】, 這代表它用了不帶 JWT 的 client(接線壞了, 不是訪客)。';
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT c.tier INTO v_tier
      FROM public.customers c
     WHERE c.user_id = v_uid
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE WARNING 'get_effective_prices:有 auth.uid() 而 customers 查無此人 ⇒ 一律 general。'
        '這通常代表註冊流程沒有把 customers 那一列建起來。';
    END IF;
    IF v_tier IS NULL OR v_tier NOT IN ('general', 'store') THEN
      -- 🔵 `premiumStore` 也走這裡 ⇒ 本片降級成 general(plan §C:本片不做 premiumStore)。
      v_tier := 'general';
    END IF;
  END IF;

  -- 🔴🔴 **無效金額不得靜默回成功**(codex R1 must-fix ②)——
  --    表上的 CHECK 只保證 `general` / `store` 兩個【鍵存在】, 不保證裡面有 `amount`、
  --    也不保證它是正數。⇒ store 缺 amount ⇒ 以前會**成功回一列 amount = NULL**,
  --    而呼叫端的「RPC 失敗」處理**不會啟動** ⇒ 客人看到空白或 0, 而系統覺得一切正常。
  -- ✅ 處置分兩層:①那個 tier 取不到有效金額 ⇒ **退回 general**(不是回 NULL)
  --              ②連 general 都取不到 ⇒ **RAISE** —— 那是資料壞了, 要有人知道。
  RETURN QUERY
  SELECT p.id,
         CASE
           WHEN (p.price_by_tier -> v_tier ->> 'amount') ~ '^[0-9]+$'
             THEN (p.price_by_tier -> v_tier ->> 'amount')::integer
           WHEN (p.price_by_tier -> 'general' ->> 'amount') ~ '^[0-9]+$'
             THEN (p.price_by_tier -> 'general' ->> 'amount')::integer
           ELSE NULL
         END,
         -- 🔴 `coalesce` **不加 `pg_catalog.` 前綴** —— 它是 SQL 關鍵字不是 pg_catalog 裡的函式,
         --    加了前綴會在【執行期】丟 `function pg_catalog.coalesce(text, unknown) does not exist`。
         --    🛑 而 `SET search_path = ''` 之下它照樣解析得到(關鍵字不走 search_path)。
         --    🔬 這一格是**拋棄式 PG 實跑抓到的** —— 七道靜態檢查全過、apply 也成功、
         --      收權斷言也過(它們都沒有真的【叫】這支函式回一列)⇒ 📌 **只有真的叫一次才問得出來。**
         coalesce(p.price_by_tier -> v_tier ->> 'currency', 'TWD'),
         v_tier
    FROM public.products p
   WHERE p.id = ANY(p_product_ids)
     -- 🔵 下架的不回(與公開投影 `USING (delisted_at IS NULL)` 同一條線)。
     AND p.delisted_at IS NULL;

  -- 🔴 ②那一層:上面那個 CASE 只在「連 general 也壞」時才會留下 NULL ⇒ 這裡把它變成【出聲】。
  --    🛑 分開寫而不寫進 CASE:CASE 裡 RAISE 不了, 而**回一個 NULL 然後假裝成功**正是本條要修的病。
  IF EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.id = ANY(p_product_ids)
       AND p.delisted_at IS NULL
       AND (p.price_by_tier -> 'general' ->> 'amount') !~ '^[0-9]+$'
       AND (p.price_by_tier -> v_tier ->> 'amount') !~ '^[0-9]+$'
  ) THEN
    RAISE WARNING 'get_effective_prices:有商品連 general 都取不到有效金額 ⇒ 那一列的 amount 是 NULL。'
      '這是【資料壞了】不是【沒有折扣】, 要有人去看。';
  END IF;
END;
$fn$;

-- 🔵 兩道 REVOKE 是必要基線(新物件出生自帶 PUBLIC 的 EXECUTE)。
REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[]) FROM anon, service_role;
-- 🔴 **給 authenticated** —— 與本 repo 多數 definer 函式不同, 而理由是它就是要給【登入的客人】叫的。
--    未登入的 `anon` 收掉:他要的價 = general, 那條路走公開投影, 不需要這支。
-- ACL-GATE-EXEMPT: public.get_effective_prices -- 登入客人自己叫, 對照建表 20260907010000
-- 🔴 **豁免理由寫在這裡, 不只寫在錨裡**(誰要用 / 為什麼不是 service_role):
--   · **誰要用**:顧客站的 server component 代表【登入的那個客人】呼叫 ⇒ 角色就是 `authenticated`。
--   · **為什麼不是 `service_role`**:那把鑰匙**繞過 RLS**, 而本函式的整個安全性建立在
--     「tier 從 `auth.uid()` 來」—— 用 `service_role` 叫, `auth.uid()` 是 NULL ⇒ 永遠回 general
--     ⇒ 📌 給它 EXECUTE 只會多開一條【拿不到正確答案而且繞過 RLS】的路。
--   · 🛑 而 `authenticated` **不等於「任何人」** —— 未登入是 `anon`, 已被上面兩道 REVOKE 收掉。
--     一般會員叫得動, 但他拿到的是 general(見 ② 那格突變:寫錯就會變成 800 傳給他)。
GRANT EXECUTE ON FUNCTION public.get_effective_prices(uuid[]) TO authenticated;

DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_effective_prices(uuid[])']::text[];
  r       text;
  v_acl   text;
  v_owner text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT pg_catalog.array_to_string(p.proacl, ',') INTO v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '收權斷言:% 的 proacl 是 NULL(= 沿用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    IF v_acl NOT LIKE '%authenticated=%' THEN
      RAISE EXCEPTION '收權斷言:% 對 authenticated 沒有 EXECUTE(收到 %)⇒ 登入的客人叫不動', r, v_acl;
    END IF;
    -- 🔴 anon 與 service_role 都要叫不動:前者是「未登入不該走這條」,
    --    後者是「service_role 繞過 RLS ⇒ 不讓它有第二條拿 store 價的路」。
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:anon 竟然叫得動 % ⇒ 兩道 REVOKE 沒生效, 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:service_role 竟然叫得動 % ⇒ 拒繼續', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:authenticated 叫不動 % ⇒ 這支函式沒有人用得到', r;
    END IF;
    -- 🔴🔴 **owner 也要釘**(codex R1 must-fix ④)—— `SECURITY DEFINER` 用的是 **owner** 的權限,
    --    而 owner = 執行 `CREATE` 的那個角色。**若 owner 讀不到 `public.products`, 這支會安靜回空**
    --    ⇒ 而「回空」與「這幾個 id 都下架了」在呼叫端長得一樣。
    SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
      FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF NOT pg_catalog.has_table_privilege(v_owner, 'public.products', 'SELECT') THEN
      RAISE EXCEPTION '收權斷言:% 的 owner(%)讀不到 public.products ⇒ 它會安靜回空, 拒繼續', r, v_owner;
    END IF;
    IF NOT pg_catalog.has_table_privilege(v_owner, 'public.customers', 'SELECT') THEN
      RAISE EXCEPTION '收權斷言:% 的 owner(%)讀不到 public.customers ⇒ tier 永遠查不到, 拒繼續', r, v_owner;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:空陣列要安靜回零列, 不得丟例外(呼叫端的常態)。
  PERFORM public.get_effective_prices(ARRAY[]::uuid[]);
  -- 🔴🔴 **而空陣列那一發【走不到 RETURN QUERY】** —— 它在上面就 `RETURN` 了
  --    ⇒ 📌 那一句證不了函式體會不會炸。實測:`pg_catalog.coalesce` 那個錯
  --      七道靜態檢查全過、apply 成功、收權斷言也過, **只有真的叫一次回一列才紅**。
  --    ⇒ ✅ 所以再叫一發【帶一個不存在的 id】:它會走完整個 RETURN QUERY(零列, 而查詢有被規劃執行)。
  PERFORM public.get_effective_prices(ARRAY['00000000-0000-0000-0000-000000000000'::uuid]);
END;
$assert$;

COMMENT ON FUNCTION public.get_effective_prices(uuid[]) IS
$c$M-2-08 前半:回【呼叫者自己那個 tier】的有效價。
🔴 不收 tier 參數 —— tier 由內部 auth.uid() 查 customers.tier;NULL ⇒ general。
🔴 只回那一個 tier 的 amount/currency, 不回整個 price_by_tier ⇒ 一般會員拿不到 store 價。
🛑 它【不算稅】:稅由付款方式決定(Sean 2026-09-06 Q24), 那是 B2 與 M-2-08 後半的格子。
🛑 它【不管 premiumStore】:本片範圍只到 store, 其餘 tier 一律降級成 general。
⚠️ 一次最多 200 個 id。下架商品不回。$c$;

COMMIT;
