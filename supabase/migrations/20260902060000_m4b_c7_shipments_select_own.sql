-- ⟦f3-SHIPPROGRESS1⟧ 片1:讓客人讀得到【自己那張單】的出貨真相
--
-- ══ 🔴 這一支在解什麼 ═══════════════════════════════════════════════════════════
--   顧客站訂單詳情頁的進度軸,「已出貨」那一格今天是【寫死的 false】
--   (`apps/storefront/src/components/account/OrderDetailView.tsx:154`)。
--   ⇒ 而 2026-09-02 Sean 用他自己的真單 `C8MYDB` 撞到:**出貨通知信到了他信箱,
--     而畫面上「已出貨」還是灰的** ⇒ 信說出貨了、畫面說還沒。
--   🔴 而成因不是「回寫斷了」—— 是**客人那條路結構上讀不到 `shipments`**:
--     `apps/storefront/src/lib/auth/composition.ts:85` 的 `getOrderRepo()` 用 authenticated client,
--     同檔契約逐字「**本檔永不注入 service_role**」;而 `shipments` 對 authenticated 零 GRANT、零 policy。
--
-- ══ ✅ Sean 2026-09-02 拍板(而這是【第二次確認過】的) ═══════════════════════════
--   Q:客人那條路要怎麼拿到出貨資料?
--     🅐 開一條 shipments 的 RLS(客人拿到自己那張單的**整列**)   ← **他選這個**
--     🅑 開一支 SECURITY DEFINER RPC,只回需要的那幾欄
--   🔴 **第一次他答「整列吧?不然客人看不懂」—— 而那個理由建立在誤解上**
--     (他以為 🅑 = 客人畫面上看到的比較少)。
--   ⇒ 主視窗澄清「**客人畫面上看到的一模一樣,差別是我們把多少東西交出去**」
--     + 重貼那 5 個內部欄 ⇒ **他仍然選 🅐**。
--   📌 **⇒ 所以這一支是【知情之後的決定】,不是【沒被告知】。**
--   ⚠️ 而端題的那一方偏 🅑 ⇒ 逐字記著,免得下一個人以為沒有人反對過。
--
-- ══ 🔴 而 🅐 的代價,寫在這裡讓下一個人看得到 ═══════════════════════════════════
--   `shipments` 共 15 欄,而其中【5 欄是我們與貨運商之間的東西】:
--     carrier_note(給貨運商的備註)· deleted_at · void_reason(作廢原因)
--     hct_request_id · hct_raw_response(**第三方回給我們的原始 JSON**)· hct_status
--   🔴 而這一片真正需要的只有 **1 欄**:`shipped_at`。做完整版也只要 4 欄。
--   🛑 **⇒ 這扇門今天是乾淨的**(2026-09-02 唯讀量:shipments 共 2 列,
--     而 `hct_raw_response` 非 NULL ⇒ **0 列**)——
--     **⇒ 而那正是它的問題:它會在新竹 API 接起來那天自己變大,而那時沒有人會回來看它。**
--   ✅ **那一格的解藥不是這一句話,是 `scripts/shipments-exposed-columns.test.ts`**
--     —— 它把「今天開放給客人的欄位集合」釘死,**表長出新欄那一刻它會紅**。
--
-- ══ 🔵 而它與 `20260826160000`(service_role 那條)不衝突 ════════════════════════
--   那一支【還沒 apply】(`APPLIED.tsv` ⇒ 0;🟢 正對照建表那支 `20260805170000` ⇒ 1)。
--   ⇒ 正式庫今天 `shipments` / `shipment_items` 的 policy 數是 **0 / 0**
--     (🟢 正對照 orders / order_items ⇒ 1 / 1 —— 那把尺分得出兩種)。
--   ⇒ 兩支各建各的具名 policy、角色不同(service_role vs authenticated)⇒ **先後貼都可以**。
--
-- ══ 🔴 形狀【照抄】既有那兩條,不自己發明 ═════════════════════════════════════
--   `20260604120000_m3_s2a_orders_order_items.sql:193-201`:
--     orders      ⇒ USING (customer_user_id = (select auth.uid()))
--     order_items ⇒ USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = … AND o.customer_user_id = …))
--   🟢 而 `shipments` 自己就有 `customer_user_id`(建表 `20260805170000`)
--     ⇒ **不必 join** ⇒ 與 orders 那條【逐字同形】。
--   🔵 而 `shipment_items` 沒有那一欄 ⇒ 照 order_items 那條的形狀,經 shipments 繞一次。

BEGIN;

-- ── 0. 前置閘:表與欄位要在,RLS 要是開的(缺一就整支 rollback,不做一半)──────────
DO $pre$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('shipments','shipment_items') AND c.relrowsecurity;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '前置閘:shipments / shipment_items 要【兩張都存在且 RLS 開著】,實得 %', v_n;
  END IF;

  -- 🔴 這一片的全部理由掛在這一欄上 —— 它不在就代表我讀的不是同一張表
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.shipments'::regclass
       AND a.attname = 'customer_user_id' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION '前置閘:shipments.customer_user_id 不在 ⇒ 本支的 USING 條件無所依附';
  END IF;

  -- 🟢 負對照:同一把尺問一個現造的欄名,必須查不到(它若對什麼都成立就沒有判別力)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.shipments'::regclass AND a.attname = 'zzq_no_such_col_0902'
  ) THEN
    RAISE EXCEPTION '前置閘自檢:負對照命中一個不該存在的欄 ⇒ 量具可疑';
  END IF;
END $pre$;

-- ── 1. GRANT:只給 SELECT,而且只給 authenticated ─────────────────────────────
--   🔴 先 REVOKE 再 GRANT —— 形狀照 `20260604120000:188-191`,不留 anon / PUBLIC 的任何殘餘。
REVOKE ALL PRIVILEGES ON TABLE public.shipments      FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.shipment_items FROM PUBLIC, anon, authenticated;
-- ACL-GATE-EXEMPT: public.shipments -- 客人讀自己那張單的出貨列, Sean 2026-09-02 拍 🅐 整列(20260902060000)
-- ACL-GATE-EXEMPT: public.shipment_items -- 同上, 出貨明細子表, 由 shipments_select_own 二次過濾(Sean 2026-09-02 拍 🅐, 20260902060000)
--   🔵 這一行的日期是【被閘量出來要補的】, 不是我一開始就寫對:
--     第一版只寫 `(20260902060000)` ⇒ 閘判「理由裡沒有可稽核錨」而**上面那一行同時通過了**
--     ⇒ 差別是上一行帶了 `2026-09-02`。錨的 regex 是 `\b20\d{6}\b`(八碼)
--     ⇒ 📌 **十四碼的 migration 版本號【不match】** —— 而閘的說明文字逐字寫著「#編號 / 版本號 / 日期」。
--     ⇒ ⇒ 一個看起來完全照著說明寫的理由, 被判不成立;而它一次只報一條 ⇒ 兩行同時錯會以為只錯一行。
--   🔴🔴 這兩行是【本支 apply 之後才補上的】, 而它讓 repo 這一份與 Sean 貼下去的那一份不再逐位元相同。
--     ⇒ `APPLIED.tsv` 上記的 sha256 是【貼下去那一份】的, **不要拿它比 repo 現值**, 兩個都留、標清楚。
--   ✅ 為什麼這個例外成立(這是唯一的答案, 不是理由充分而已):
--     那道閘擋的是「apply 之後沒有任何東西會再量的權限」——
--     **而這一片恰好裝了那個會再量的東西**:`scripts/shipments-exposed-columns.test.ts`
--     (釘住 shipments 與 shipment_items 的欄位集合, 表一長新欄就紅)。
--     ⇒ 📌 **閘要的東西這一片已經給了, 只是給在另一支檔, 而閘只讀同檔。**
--     ⇒ ⇒ 這不是繞過閘, 是【閘的分母裡沒有那支檔】—— 而 EXEMPT 註解正是用來說這句話的機制。
GRANT SELECT ON TABLE public.shipments      TO authenticated;
GRANT SELECT ON TABLE public.shipment_items TO authenticated;

-- ── 2. POLICY ────────────────────────────────────────────────────────────────
--   🔴 `(select auth.uid())` 的括號寫法是刻意的(照抄 orders 那條):
--      包成 InitPlan 讓它每次查詢只算一次,而不是每一列算一次。
DROP POLICY IF EXISTS shipments_select_own      ON public.shipments;
DROP POLICY IF EXISTS shipment_items_select_own ON public.shipment_items;

CREATE POLICY shipments_select_own ON public.shipments
  FOR SELECT TO authenticated
  USING (customer_user_id = (select auth.uid()));

--   🔵 `shipment_items` 沒有 `customer_user_id` ⇒ 經 shipments 繞一次(形狀同 order_items)。
CREATE POLICY shipment_items_select_own ON public.shipment_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shipments s
       WHERE s.id = shipment_items.shipment_id
         AND s.customer_user_id = (select auth.uid())
    )
  );

-- ── 3. 🔴🔴 那一欄的警語 —— 寫在【欄】上,不是寫在檔頭 ─────────────────────────
--   📌 檔頭會被最後一代 `CREATE OR REPLACE` 蓋過去,而 COMMENT 跟著欄走。
COMMENT ON COLUMN public.shipments.hct_raw_response IS
  '🔴🔴 **這一欄對【客人】可見。**(2026-09-02 起:shipments_select_own 讓 authenticated 讀得到自己那張單的整列。)'
  '它裝的是【第三方(新竹物流)回給我們的原始回應】。'
  '🛑 **在把任何東西寫進這一欄之前,先看這一句話** —— 那些內容會直接出現在客人拿得到的資料裡。'
  '📌 2026-09-02 開這扇門時它是空的(全表 2 列、本欄非 NULL 0 列)⇒ 而那正是它危險的地方:'
  '門今天乾淨,而它會在新竹 API 接起來那天自己變大,而那時沒有人會回來看它。'
  '✅ 而會叫的那道是 `scripts/shipments-exposed-columns.test.ts`(釘住開放欄位集合,表長新欄就紅)。';

COMMENT ON POLICY shipments_select_own ON public.shipments IS
  '⟦f3-SHIPPROGRESS1⟧ Sean 2026-09-02 拍 🅐(整列)—— 而那是【被告知那 5 個內部欄之後】的第二次確認。'
  '端題的一方偏 🅑(只回需要的欄),逐字記著,免得下一個人以為沒有人反對過。';

-- ── 4. 落地驗證:兩個世界都要問到 ────────────────────────────────────────────
DO $verify$
DECLARE v_using text; v_roles text;
BEGIN
  -- ① 政策在,而且角色與命令都對
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid), p.polroles::text
    INTO v_using, v_roles
    FROM pg_catalog.pg_policy p
   WHERE p.polrelid = 'public.shipments'::regclass AND p.polname = 'shipments_select_own';
  IF v_using IS NULL THEN
    RAISE EXCEPTION '驗證①:shipments_select_own 建不起來';
  END IF;
  IF v_using NOT LIKE '%customer_user_id%' OR v_using NOT LIKE '%auth.uid%' THEN
    RAISE EXCEPTION '驗證①:USING 條件不含 customer_user_id / auth.uid ⇒ 它可能對所有人成立。實得:%', v_using;
  END IF;

  -- ② 🟢 正對照:authenticated 現在讀得到(這一格證明 GRANT 真的下去了)
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.shipments', 'SELECT') THEN
    RAISE EXCEPTION '驗證②:authenticated 對 shipments 仍然沒有 SELECT ⇒ GRANT 沒生效';
  END IF;

  -- ③ 🔵 負對照:anon **不准**讀得到(只證「有人讀得到」不夠,要證「不是所有人」)
  IF pg_catalog.has_table_privilege('anon', 'public.shipments', 'SELECT') THEN
    RAISE EXCEPTION '驗證③:anon 竟然讀得到 shipments ⇒ 這扇門開得比拍板的還大';
  END IF;

  -- ④ 寫入面一格都不准開(本片只做讀)
  IF pg_catalog.has_table_privilege('authenticated', 'public.shipments', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shipments', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.shipments', 'DELETE') THEN
    RAISE EXCEPTION '驗證④:authenticated 拿到了寫入權 ⇒ 本片只該開 SELECT';
  END IF;

  -- ⑤ shipment_items 那條同樣走一遍
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
     WHERE p.polrelid = 'public.shipment_items'::regclass AND p.polname = 'shipment_items_select_own'
  ) THEN
    RAISE EXCEPTION '驗證⑤:shipment_items_select_own 建不起來';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.shipment_items', 'SELECT') THEN
    RAISE EXCEPTION '驗證⑤b:anon 讀得到 shipment_items';
  END IF;

  RAISE NOTICE '✅ ⟦f3-SHIPPROGRESS1⟧ 片1 落地:authenticated 可讀自己的 shipments / shipment_items;anon 不可;寫入面零開放。';
END $verify$;

COMMIT;
