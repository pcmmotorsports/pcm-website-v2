-- 20260901003000_m4b_coupon_p3_create_order_discount_param.sql
-- 券片3a · `create_order` 加一個 `p_coupon_code` —— **而 3a 把券結帳【封住】。**
--
-- ⚠️ 檔名裡的 `discount_param` 是第一版的名字。**留著不改** —— 版本號是 apply 的身分,
--    改檔名會讓帳本與交接訊息裡的引用全部斷掉。而它現在收的是券碼不是金額, 見下。
--
-- ══ 🔴 為什麼要動這支 ═══════════════════════════════════════════════════════
-- 客人在結帳頁輸入券碼 ⇒ 他要看到折後價、要付折後的錢
-- ⇒ `orders.discount_total` / `orders.total` 必須反映它
-- 🛑 而上一代那個欄位是**寫死的 `0`** ⇒ 沒有任何路徑寫得進去。
--
-- ══ 🔴🔴 收【券碼】不收【金額】—— 而那是被一個洞逼出來的 ═════════════════════
-- ⛔ ~~主視窗原裁:「多一個 `p_discount_total`, 它只是接受一個已經算好的金額」~~
-- 🔴 codex 抓到、主視窗自己去正式庫量過並重裁:
--    `create_order` 是 SECURITY DEFINER 且 `GRANT EXECUTE … TO authenticated`,
--    而 Supabase 把 public schema 的函式**全部開成 PostgREST RPC 端點**
--    ⇒ **任何登入的客人拿 anon key + 自己的 JWT 就叫得動它, 並自己填那個金額。**
--    🟢 正式庫實測:authenticated EXECUTE ⇒ true · anon ⇒ false · SECURITY DEFINER ⇒ true
--       ACL = `postgres=X/postgres , authenticated=X/postgres`
--       🟢 對照組 `admin_search_customers` 對 authenticated ⇒ **false**(那把尺會說「不」)
-- 🛑 而這條紅線寫在 `packages/adapters/src/supabase/mappers/order.ts` 上面幾行:
--    「**永不**夾帶 price / …;價 / 運費 / 歸屬 / tier **全 RPC server 權威算**」
--    ⇒ 而 `CLAUDE.md` Server 端鐵則逐字:「**不信任 client 送的欄位**」
-- 📌 **⇒ 判準(主視窗採用):職責分離是設計偏好, 客人填金額是漏洞 —— 兩者不同量級。**
-- 🔴 而**參數是【換掉】不是【加驗證】** —— 留著金額參數再加一道閘, 那個洞的形狀還在。
--
-- ══ 🔴🔴 而 3a 把券結帳【封住】(主視窗裁「丁」)═══════════════════════════════
--   本片:`p_coupon_code` 存在、管線接好, 而**任何非 null 值 ⇒ RAISE「優惠券結帳尚未啟用」**
--   3b :把那道 RAISE 換成 `public.redeem_coupon` 的試算呼叫
-- 🛑 為什麼:3a 若早於 3b(寫 redemption + 告警)上線, 帶券建單**扣不到券的三道上限**
--    ⇒ 同一張券可無限次用, 而沒有任何告警。
-- 📌 判準是【忘記的時候會發生什麼】:
--      寫進 apply 清單, 忘了 ⇒ 券可無限次用   🔴 洞
--      封住,           忘了 ⇒ 券結帳不啟用    ✅ 惰性
--    **⇒ 一個被遺忘的 3a 是【惰性的】, 不是【有洞的】。而它零新 DB 物件、零「要記得」。**
--
-- ══ 🔴 抄的是哪一代(抄錯一代 = 把後面幾代整個回捲, 而三綠不會紅)══════════
--   `bash scripts/latest-definition-of.sh create_order`:
--     newest = 20260825130000(repo 最後一代;共 9 代 / 14 個定義點)
--     live   = 20260825130000(帳本 APPLIED.tsv 最後一支已記的)⇒ ✅ 相同, 沒有漂
--   🛑 而工具自己印的射程照抄:**`live` 答的是【帳本】不是正式庫。**
--
-- ══ **函式本體**的 delta(而 DDL / ACL / 前置閘 / 自檢 另有實質差異)═══════════
--   ① 參數列 +1:`p_coupon_code text DEFAULT NULL`
--   ② 段 7:券碼有值 ⇒ RAISE(3a 封鎖);無值 ⇒ `v_discount_total := 0`;
--      `v_total := v_subtotal + v_shipping_fee - v_discount_total`
--   ③ INSERT 那個寫死的 `0` ⇒ `v_discount_total`
--
-- ══ 🔴🔴 apply 前的【硬前置條件】(codex R3 must-fix①)═══════════════════════
--   本檔 `DROP` + 重建 ⇒ **若正式庫那支身上有一個沒進 repo 的補丁, 它會被靜默覆蓋**,
--   而影響面是**每一張訂單**。
--   🛑 檔內那三格錨只證「我依賴的那三行沒漂」—— **證不了其餘 300 行沒漂。**
--   🔴 **⇒ apply 之前, 由【有正式庫存取的人】做一次:**
--       `SELECT md5(pg_get_functiondef(
--          'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure));`
--       並與**同一份 repo 舊版在乾淨庫上重建後的 md5** 比對。**不比對就不要 apply。**
--   📌 這一句寫在【檔案裡】而不是只寫在交接訊息裡 —— 因為 apply 的人會打開這支檔。
--
-- ══ 🔴 一格【到得了而本片沒解】的洞, 具名 ═══════════════════════════════════
--   上一代那道「整車 total <= 0 ⇒ RAISE」的閘**留著不動**, 而它的錯誤訊息逐字寫著:
--   「若這是合法的 0 元單(**全額折價券**/儲值金), **本閘需重議**」⇒ 它預告的正是這一片。
--   🔴 而它到得了(量到的):門市取貨 ⇒ 運費 0;或小計 ≥ 5000 ⇒ 運費 0
--     ⇒ 一張把小計折光的券 + 門市取貨 ⇒ `total = 0` ⇒ 建單直接 RAISE
--   🛑 而客人看到的是「付款失敗,請稍後再試」(`charge-actions.ts` 零原始 error 透傳)
--     ⇒ **而再試一次永遠不會成功。**
--   ⇒ **本片不改那道閘**(改它 = 允許 0 元單 = 另一片且是錢)。已交主視窗端 Sean。
--   🔵 而 3a 封住券結帳之後, 這一格**今天打不到** —— 它會隨 3b 一起到。
--
-- ══ rollback(forward-only)═════════════════════════════════════════════════
--   回捲 = 重新 apply `20260825130000` 那一版的函式本體(9 參數)。
--   ⛔ ~~`DEFAULT 0` 讓舊呼叫端不改也跑得動 ⇒ 回捲不必同時改 TS~~
--   🔴 **那句只有在「兩支並存」時成立, 而本檔 DROP 掉了舊簽名** ——
--      因為實測到並存會讓既有呼叫端拿到 `is not unique` 而**全部炸掉**(見自檢 ②)。
--   ✅ 正確的回捲 = **DROP 10 參數那支 + 重新 apply 20260825130000 的函式本體
--      + 重新 `GRANT EXECUTE … TO authenticated`**(DROP 會帶走 ACL)。
--   🔵 而 `DEFAULT 0` 仍然有用:它讓【還沒改的 TS 呼叫端】在新函式上跑得動 ⇒ **上線順序可以先 DB 後 TS。**
--   🛑 而回捲之後, **已經帶折扣建立的訂單不會被改回去** —— 那些單的 `discount_total` 留著。
--      那不是 bug, 是 forward-only 的代價。明寫。

BEGIN;

-- ══ 🔴🔴 前置閘 —— **逐字帶自上一代 `20260825130000`(它的段 1)** ═══════════════
--    ⛔ **本檔第一版【沒有】這段, 是 codex 抓到的。**
--    🛑 而那段的註解裡就寫著我今晚以為是自己發現的那句話 ——
--       「apply 成功」與「這支函式跑得動」是兩個宣稱, 而斷言只證明得了前者。
--    📌 **⇒ 我抄了函式本體, 而沒抄【它為什麼安全的那一半】。**
--       那 39 行距離我抄的第一行只有 39 行, 而我跳過了它們。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 段 1:前置閘 —— 🔴 這一段是【本檔實跑之後才補上的】, 而它的成因值得留著 ──────
--
--   本檔第一版**沒有**這段。在拋棄式庫上實跑時我量到:
--     `20260730120100`(N3b)自己 apply **失敗**(rc=3,因為 N3a 沒到位、產號器不存在),
--     🔴 **而本檔照樣 rc=0** —— 因為 plpgsql 是**晚綁定**的:函式體裡引用一支不存在的函式,
--        `CREATE OR REPLACE` 一樣會過, 我的字面斷言也一樣全綠(它們查的是 `prosrc` 文字)。
--   ⇒ **「apply 成功」與「這支函式跑得動」是兩個宣稱, 而本檔的斷言只證明得了前者。**
--   ⇒ 所以把 N3b 的前置閘逐字帶過來:本檔重下的是**整支 654 行**, 它繼承的依賴一個都沒少。
DO $$
BEGIN
  IF to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION '0 元閘前置失敗 — public.pcm_generate_display_id() 不存在。'
                    ' 請先套用 20260730120000(N3a);db push 應會自動依版本號排序';
  END IF;
  -- 🔴 `IS DISTINCT FROM true` 是承重的, 不是囉唆(codex R1 must-fix):
  --   產號器若回 `NULL`, `NULL !~ regex` 的結果是 **NULL 不是 true**
  --   ⇒ 寫成 `IF x !~ … THEN` 的話這個 IF **不成立 ⇒ 直接放行** ⇒ 前置閘假綠。
  --   ⚠️ 這個寫法是從 `20260730120100` 逐字抄來的 ⇒ **那一支也有同一個洞**(本片不改它)。
  IF (public.pcm_generate_display_id() ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0 元閘前置失敗 — pcm_generate_display_id() 的產出不符 §5.4a 合約(NULL 也算不符)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname  = 'orders_display_id_format'
       AND pg_get_constraintdef(oid) LIKE '%[23456789BCDFGHJKMNPQRSTVWXYZ]{6}%'
  ) THEN
    RAISE EXCEPTION '0 元閘前置失敗 — orders_display_id_format 沒有接受新 6 碼格式的分支。'
                    ' 請先套用 20260729010000(D0);否則本片 apply 會全綠、'
                    ' 但第一筆真結帳會死在 check_violation(不重試、對客一般失敗)';
  END IF;
END
$$;


-- 🔵 **本片【沒有】redeem_coupon 的前置閘, 而那是刻意的** ——
--    3a 的券碼分支是一道 RAISE, 它不呼叫那支函式 ⇒ **斷言一個沒用到的相依 = 說謊**。
--    ⇒ 那兩道閘(存在 / owner 有 EXECUTE)寫在券碼分支的註解裡, 由 3b 帶回來。

-- ══ 前置閘結束 ═══════════════════════════════════════════════════════════

-- ── 🔴 先 DROP 舊簽名 ──────────────────────────────────────────
-- 為什麼:見下面自檢 ② 的那段實測 —— 兩支並存會讓既有呼叫端拿到 `is not unique` 而全部炸。
-- 🛑 而 DROP 會連它的 ACL 一起帶走 ⇒ 下面必須重新授權(那是本檔最容易漏的一格)。
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);

CREATE OR REPLACE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text,
  p_notification_email text DEFAULT NULL,  -- 🔴 B-2 過渡期 DEFAULT;B-6 移除
  -- ⛔ ~~`p_discount_total integer DEFAULT 0` —— 「它只是接受一個已經算好的金額」~~
  -- 🔴🔴 **那一版有一個洞, 而它是 codex 抓到、主視窗自己去正式庫量過的**:
  --    `create_order` 是 SECURITY DEFINER 且 `GRANT EXECUTE … TO authenticated`,
  --    而 Supabase 把 public schema 的函式**全部開成 PostgREST RPC 端點**
  --    ⇒ **任何登入的客人拿 anon key + 自己的 JWT 就叫得動它, 並自己填那個金額。**
  --    ⇒ 把 5000 的單折到 1 元, 不需要任何一張券。
  --    🟢 主視窗 2026-09-01 正式庫實測:`authenticated` 對它的 EXECUTE ⇒ **true**;
  --       anon ⇒ false;ACL = `postgres=X/postgres , authenticated=X/postgres`;
  --       🟢 對照組 `admin_search_customers` 對 authenticated ⇒ **false**(那把尺會說「不」)
  -- 🛑 **而這條紅線就寫在 `packages/adapters/src/supabase/mappers/order.ts:142-143`**:
  --    「**永不**夾帶 price / unitPrice / tier / …;價 / 運費 / 歸屬 / tier **全 RPC server 權威算**」
  --    ⇒ 📌 一個【客人送進來的金額】正是那條禁的東西。
  --
  -- ✅ **改成收【券碼】** —— 而這不是「把券的邏輯搬進來」, 是**不再相信呼叫端算的數**:
  --    本函式**不懂**低消 / 上限 / 有效期 / 誰能用 —— 它只做**一次呼叫**, 去問那個既有的權威。
  -- 🔴 **而參數是【換掉】不是【加驗證】** —— 留著金額參數再加一道閘, 那個洞的形狀還在。
  p_coupon_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
CALLED ON NULL INPUT
NOT LEAKPROOF
COST 100
SET search_path = ''
AS $fn$
DECLARE
  v_uid            uuid := (select auth.uid());
  -- 🔴 券片3:折扣由 `redeem_coupon` 算, 這兩個只是接它的結果。
  v_coupon         jsonb;
  v_discount_total integer;
  v_addr           record;
  v_line           jsonb;
  v_variant        record;
  v_qty            integer;
  v_variant_id     uuid;
  v_supplier_slug  text;
  v_sku            text;
  v_unit_price     integer;
  v_line_total     bigint;
  v_subtotal       bigint := 0;
  v_shipping_fee   integer;
  v_total          bigint;
  v_seen_variants  uuid[] := '{}';
  v_items          jsonb := '[]'::jsonb;
  v_invoice        jsonb;
  v_addr_snapshot  jsonb;
  v_display_id     text;
  -- N3b delta:v_seq_text 移除(不再用序號產號);新增有界重試所需兩個變數。
  v_attempt        integer;
  v_cname          text;
  v_order_id       uuid;
  -- 🔴 V-3a delta:vehicle 白名單重組工作變數(其餘 DECLARE 逐字同 20260630120000)
  v_veh            jsonb;
  v_veh_ok         boolean;
  v_veh_year       integer;
  v_vehicle        jsonb;
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0b. 🔴 #241 同意條款 guard(create_order 路徑「無 consent 不生 order」;codex H4 空字串、B2 限縮為本路徑)──
  IF p_terms_version IS NULL OR pg_catalog.btrim(p_terms_version) = '' THEN
    RAISE EXCEPTION 'create_order: 缺同意條款版本(consent)';
  END IF;

  -- ── 1. 身分 + customer profile(fail-closed)──
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_order: 未登入(auth.uid NULL)';
  END IF;
  PERFORM 1 FROM public.customers WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 查無 customer profile(uid=%)', v_uid;
  END IF;

  -- ── 2. 地址歸屬(必為本人、否則 raise;快照凍結履約地址)──
  SELECT id, name, phone, line
    INTO v_addr
    FROM public.customer_addresses
   WHERE id = p_address_id AND customer_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 地址非本人或不存在(address_id=%)', p_address_id;
  END IF;
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(home/store)──
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型 ──
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限 ──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

    IF v_variant_id IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.supplier_slug = v_supplier_slug AND pv.sku = v_sku;
    ELSE
      RAISE EXCEPTION 'create_order: line 缺 variant_id 或 (supplier_slug,sku)';
    END IF;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'create_order: 找不到 variant(variant_id=%, supplier_slug=%, sku=%)', v_variant_id, v_supplier_slug, v_sku;
    END IF;

    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;

    v_unit_price := v_variant.price_general;
    -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個
    --   「送」/ 試用品)⇒ 這道閘原本把贈品判成「無有效價格」而擋在結帳。
    --   ⚠️ **`IS NULL` 那半一個字都沒動** —— 它擋的是「查不到價格」, 與「0 元」是兩件事。
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- ── 6v. 🔴 V-3a delta:optional vehicle 白名單重組(鏡像 §4 p_invoice 手法;禁 v_line->'vehicle' 直存)──
    --   逐 kind 隔離(verdict REQUIRED-3):dict 只收 brand/model/year/source(不收 raw)、
    --   free 只收 raw/year/source(不收 brand/model);非空 text ≤200;year=JSON number 4 位整數
    --   1900-2100(regex 先驗防 ::integer 溢位 RAISE)。任何不合 → 該 line v_vehicle=NULL、
    --   不 RAISE 不擋單(選填;與 @pcm/schemas .catch(undefined) 同構)。車種鐵律:零正規化、字面凍結。
    v_vehicle := NULL;
    v_veh := v_line->'vehicle';
    IF v_veh IS NOT NULL AND pg_catalog.jsonb_typeof(v_veh) = 'object' THEN
      v_veh_ok := true;
      v_veh_year := NULL;
      IF v_veh ? 'year' THEN
        -- 🔴 cast 與驗證分離(reviewer Important):::integer 只在 regex 4 位通過「之後」的獨立
        --   statement 執行=可證明無溢位 RAISE(不依賴 AND 短路順序=PG 官方不保證求值順序);
        --   typeof/regex 本身無異常面(->> 回 text/NULL、NULL~pattern=NULL)。
        IF pg_catalog.jsonb_typeof(v_veh->'year') = 'number'
           AND (v_veh->>'year') ~ '^[0-9]{4}$' THEN
          v_veh_year := (v_veh->>'year')::integer; -- regex 已限 4 位、cast 恆安全
          IF v_veh_year < 1900 OR v_veh_year > 2100 THEN
            v_veh_ok := false; -- 超界=整顆作廢(兩層同構;非法不擋單)
          END IF;
        ELSE
          v_veh_ok := false; -- year 形狀不合=整顆作廢(兩層同構;非法不擋單)
        END IF;
      END IF;
      IF v_veh_ok AND v_veh->>'kind' = 'dict' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'brand') = 'string'
           AND pg_catalog.jsonb_typeof(v_veh->'model') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'brand'), '') <> '' AND pg_catalog.length(v_veh->>'brand') <= 200
           AND coalesce(pg_catalog.btrim(v_veh->>'model'), '') <> '' AND pg_catalog.length(v_veh->>'model') <= 200
           AND (v_veh->>'source') IN ('search', 'garage', 'picker') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'dict', 'brand', v_veh->>'brand', 'model', v_veh->>'model',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      ELSIF v_veh_ok AND v_veh->>'kind' = 'free' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'raw') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'raw'), '') <> '' AND pg_catalog.length(v_veh->>'raw') <= 200
           AND (v_veh->>'source') IN ('garage', 'freetext') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'free', 'raw', v_veh->>'raw',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      END IF;
    END IF;

    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total,
      'availability_at_checkout',
        CASE WHEN v_variant.variant_availability = 'in-stock'
              AND v_variant.product_availability = 'in-stock'
             THEN 'in-stock' ELSE 'out-of-stock' END,
      -- 🔴 V-3a delta:白名單重組後快照(NULL → JSON null → §9 NULLIF 轉回 SQL NULL)
      'vehicle',          v_vehicle
    );
  END LOOP;

  -- ── 7. 運費 ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  -- 🔴🔴 **折扣在這裡算出來(券片3)** —— 而算它的是 `redeem_coupon`, 不是呼叫端。
  IF p_coupon_code IS NULL OR pg_catalog.btrim(p_coupon_code) = '' THEN
    v_discount_total := 0;   -- 沒帶券碼 ⇒ 零折扣, 其餘一切不變
  ELSE
    -- 🔴🔴🔴 **3a 刻意【封住】券結帳** —— 主視窗 2026-09-01 裁定「丁」。
    --
    -- ⛔ ~~這裡原本呼 `public.redeem_coupon(...)` 試算~~ ⇒ **3a 單獨上線時那是一個洞**:
    --    codex R2 逐字:3a 若早於 3b apply, `authenticated` 可以直接呼 RPC、帶一張有效券碼
    --    建折扣單、照既有付款路徑付折後價, **而 redemption 那一列不會被寫**(那在 3b)
    --    ⇒ 券的三道上限(總量 / 每人 / 已用)**永遠不會被扣** ⇒ **同一張券可以無限次用**,
    --      而沒有任何告警(告警也在 3b)。
    --
    -- 🔵 **為什麼是「封住」而不是「寫進 apply 清單」** —— 判準是【忘記的時候會發生什麼】:
    --      寫清單, 忘了 ⇒ **券可以無限次用**(洞)
    --      封住,   忘了 ⇒ **券結帳不會啟用**(惰性)
    --    📌 **⇒ 一個被遺忘的 3a 是【惰性的】, 不是【有洞的】。那就是全部。**
    --    📌 **⇒ 而這是「機制優先於規則」更省的一種:機制不必是新東西,
    --       它可以是【讓預設值變成安全的那一邊】。**(零新 DB 物件、零「要記得」)
    --
    -- 🛑🛑 **3b 的第一件事就是把這一段換成那次試算呼叫** ——
    --    而 3b 的 plan 要逐字寫「本片解除 3a 的封鎖」,
    --    ⇒ **那樣兩片的關係在碼上看得見, 不在任何人的記憶裡。**
    -- ⚠️ 換回去的時候, 這兩道前置閘要一起帶回來(它們現在不在本檔, 因為本檔不呼叫它):
    --      ① `public.redeem_coupon(text,uuid,integer,boolean,uuid)` 必須存在
    --      ② 本函式的 owner 對它必須有 EXECUTE
    --         (`create_order` 是 SECURITY DEFINER ⇒ 執行期 current_user = owner;
    --          而 `redeem_coupon` 被 REVOKE 到只剩 service_role ⇒ owner 不同就 permission denied)
    RAISE EXCEPTION
      'create_order: 優惠券結帳尚未啟用(券片3b 未上線)—— 本次請不要帶券碼(收到 %)',
      pg_catalog.btrim(p_coupon_code);
  END IF;

  -- 🛑 縱深:上面那支已經夾過上下限, 而**這裡再夾一次** ——
  --    它防的不是券的邏輯, 是「有一天有人改了那支而忘了這裡」。
  IF v_discount_total IS NULL OR v_discount_total < 0 THEN
    RAISE EXCEPTION 'create_order: 算出來的折扣不是非負整數(%)', v_discount_total;
  END IF;
  IF v_discount_total > v_subtotal THEN
    -- ⚠️ **上限基準未定案 —— Sean 2026-09-01 待拍。**
    --    稿 `design-reference/components/CheckoutPage.jsx:95` 逐字
    --      `Math.max(0, subtotal + shipping - couponDiscount)` ⇒ **折的是小計 + 運費**
    --    而券 RPC `20260831160000:216` 逐字 `least(v_calc, p_subtotal)` ⇒ **上限 = 小計**
    --    ⇒ 兩者在【折扣 > 小計】時分岔(例:小計 300 · 運費 100 · 定額 500 券
    --      ⇒ 稿 total 0 / 本函式 total 100)。
    -- 🔵 本函式**暫時照乙(上限 = 小計)**, 那是保守的那一邊。
    -- 🔴 **若 Sean 拍甲, 改動落點就是這一行 + 券 RPC 那一行 + 那兩處要收運費**。
    RAISE EXCEPTION
      'create_order: 算出來的折扣 % 超過小計 %(上限基準未定案, 見本行註解)', v_discount_total, v_subtotal;
  END IF;
  v_total := v_subtotal + v_shipping_fee - v_discount_total;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;
  -- 🔴🔴 2026-08-25 新閘:整車金額為 0 ⇒ 擋在建單前(Sean 拍甲「順手加一道」)。
  --
  --   **這【不是】一條「訂單金額必須大於 0」的商業規則。** 它說的是一件工程事實:
  --   一張 total = 0 的單, **目前沒有一條路付得掉它** —— 刷卡腿與付款帳本都拒 0。
  --   ⚠️ **而「它們拒 0」是從那兩道的【定義】讀來的, 本片沒有實跑那兩道。** 這一格是推論。
  --
  --   為什麼它會發生:0 元贈品放行之後, 「只有贈品 + 門市取貨」⇒ subtotal 0 + 運費 0 ⇒ total 0。
  --   Sean 早先拍的「贈品永遠跟著別的商品一起買」是**業務假設, 不是一道閘** ——
  --   `create_order` 與購物車都沒有在強制它。本閘把那個假設變成一道真的閘。
  --
  --   🔴 **日後若出現【合法的 0 元單】, 這道閘要一起重議, 不是繞過它**:
  --     · 100% 折抵的優惠券(Sean 2026-08-24 已把優惠券從「零條目」拍成要做)
  --     · 全額儲值金付款
  --     · 全額折抵的退換貨補寄
  --   那時要問的是「這張 0 元單走哪一條付款路」, 而不是「怎麼讓它通過」。
  --
  --   ⚠️ 誤擋乾跑(2026-08-25 service_role 對正式站實測, 只取 count):
  --     orders 20 筆 · `total = 0` ⇒ **0 筆** · `total < 0` ⇒ 0 筆 · `subtotal = 0` ⇒ 0 筆
  --     order_items 23 筆 · `unit_price = 0` ⇒ 0 筆
  --     尺的證明:撈一筆真的 total(13050)回頭 `eq.` 它 ⇒ 命中 1(算子挑得出東西);
  --               負對照 `total = -987654321` ⇒ 0;正對照 `total > 0` ⇒ 20 = 全部(加法自洽)
  --   ⇒ **對現有資料誤擋 0 筆。**
  --
  --   📌 客人面看到的**不是**這句話:`charge-actions.ts:364` 零原始 error 透傳,
  --     一律回 `MSG.generic`(`:86` 逐字「付款失敗,請稍後再試或聯繫客服 LINE」)。
  --     ⚠️ 而那句對本情境**是誤導的** —— 再試一次永遠不會成功。客人面文案要另外處理(未做)。
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'create_order: 整車金額為 0(subtotal=%, shipping_fee=%)—— 目前沒有一條付款路徑可以結清它(刷卡腿與付款帳本皆拒 0);贈品需與正價商品同車。若這是合法的 0 元單(全額折價券/儲值金), 本閘需重議', v_subtotal, v_shipping_fee;
  END IF;

  -- ── 8. 產號 + 寫 order(N3b:6 碼亂碼 + 有界重試)──
  -- 🔴 唯一 delta 就在這一段。重試迴圈**只包 orders 的 INSERT**:
  --    plpgsql 的 BEGIN…EXCEPTION 是子交易,捕捉後只回滾這一次 INSERT;
  --    8b 的 consent 與 9 的 items 都排在迴圈之後 ⇒ 不會被重複寫入。
  -- 🔴 重試迴圈刻意寫在這一層、不在 helper 裡(v2 §5.4a / R3):
  --    helper 只回候選值,它不可能捕捉 INSERT 的 unique violation。
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();

      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id,
        notification_email
      ) VALUES (
        v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
        v_subtotal::integer, v_shipping_fee, v_discount_total, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
        p_notification_email
      )
      RETURNING id INTO v_order_id;

      EXIT;   -- 成功寫入 ⇒ 離開重試迴圈
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴 只吞 display_id 的碰撞。其他 unique violation(例如 cart_session_id 去重、
      --    tappay_rec_trade_id)**原樣上拋** —— 那些是語意訊號,重試會把它們吃掉。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        -- 明確報錯、不靜默、不降級。token 供 app 層 catch 後告警(N3b-app、backlog #300)。
        RAISE EXCEPTION 'create_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)'
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- 迴圈理論上不可能在未設值的情況下離開(成功才 EXIT、用盡必 RAISE),
  -- 但「理論上不可能」也是一條沒被測的斷言 ⇒ 明寫出來、fail-closed。
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 重試迴圈結束但 v_order_id 未設值(不該發生)'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 8b. 🔴 #241 同 transaction 原子寫同意紀錄(Gemini 否決拆 RPC 的幽靈訂單;create_order 路徑無 consent 不生 order)──
  --    IP/UA left() 截斷(codex M8;NULL 輸入 left 回 NULL、容忍 best-effort 缺值)。
  INSERT INTO public.order_legal_consents (order_id, terms_version, consented_at, client_ip, client_user_agent)
  VALUES (v_order_id, p_terms_version, pg_catalog.now(),
          pg_catalog.left(p_client_ip, 128), pg_catalog.left(p_client_ua, 1024));

  -- ── 9. 寫 items(V-3a delta:多寫 vehicle_snapshot;NULLIF 把 JSON null 轉回 SQL NULL)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout, vehicle_snapshot
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer,
      v_line->>'availability_at_checkout',
      NULLIF(v_line->'vehicle', 'null'::jsonb)
    );
  END LOOP;

  -- ── 10. return DTO ──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

-- ── 段 5:COMMENT ───────────────────────────────────────────────

-- ── 🔴🔴 權限:新簽名 = 【新物件】⇒ 它出生自帶 PUBLIC EXECUTE, 而舊那支的授權【不會跟過來】
-- 舊那支的授權(`20260719120000:514` 逐字):`GRANT EXECUTE … TO authenticated;`
-- ⇒ 不重新授權的話:客人結帳當場 permission denied, 而 **PUBLIC 反而執行得了**。
-- 📌 **一個「只是加一個參數」的改動, 把一支函式的權限整個重置了 —— 而 diff 上看不出來。**
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) FROM anon;
-- 🔴 具名角色不會被 `FROM PUBLIC` 收到 ⇒ 先收乾淨再重發, 免得留下 GRANT OPTION。
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) FROM authenticated;
-- ACL-GATE-EXEMPT: public.create_order -- 還原 20260719120000:514 既有授權;客人結帳唯一入口(2026-09-01)
-- 🔴 **為什麼不是 service_role**:結帳是【客人自己】按的, 身分由函式內 `auth.uid()` 重查
--    ⇒ 它必須以登入客人的 JWT 呼叫 ⇒ 只有 `authenticated` 拿得到。
--    改成 service_role = 要 server 代打, 而那會讓 `auth.uid()` 變成 server 的身分 ⇒ 歸屬全錯。
-- 🛑 **而這一行【不是新開】的權限** —— 上一代(9 參)本來就有, 而本檔的 `DROP` 把它帶走了
--    ⇒ 不還原的話:**客人結帳當場 permission denied, 而 PUBLIC 反而執行得了。**
-- ⚠️ 而本閘的理由成立:同檔那道 ACL 自檢**只在 apply 當下跑一次**, 正式庫不會 replay
--    ⇒ 這一行之後漂了, 沒有東西會再紅。**那個限制我不否認, 只是這一行必須存在。**
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) TO authenticated;

COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) IS
  'M-4b 券片3(2026-09-01):在 20260825130000 之上【只加一個】p_coupon_code text DEFAULT NULL。'
  '⇒ 帶券碼時本函式呼 public.redeem_coupon 的【試算路徑】算出折扣, 再 total = subtotal + shipping_fee − 折扣。'
  '🔴 **金額不是呼叫端送的** —— 前一版收 p_discount_total(金額), 而 create_order 是 SECURITY DEFINER '
  '且 GRANT TO authenticated + PostgREST 自動暴露 ⇒ 任何登入的客人可以自己填那個金額。已刪。'
  '🛑 券的【規則】(低消/上限/有效期/誰能用)一格都不在這裡 —— 本函式只做一次呼叫去問那個權威。'
  '🔴 fail-closed:券無效 ⇒ RAISE(不靜靜地不折);算出來的折扣為負或超過小計 ⇒ RAISE。'
  '⚠️ 上限基準(小計 vs 小計+運費)未定案 —— 稿 CheckoutPage.jsx:95 折的是小計+運費, 本函式照小計。Sean 2026-09-01 待拍。'
  '🔴 而 :374 那道「total <= 0 ⇒ RAISE」留著不動;一張把小計折光的券 + 門市取貨(運費 0)會撞到它 —— 具名未解。'
  '其餘 executable 逐字同 20260825130000。';

-- ── 收工驗收(fail-closed;任一條不成立 = 整片回滾)──────────────
DO $$
DECLARE
  v_oid  oid;
  v_args text;
BEGIN
  -- ① 新一代真的建成了, 而且是 10 參數那一支
  v_oid := pg_catalog.to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '片3 fail-closed:10 參數的 create_order 沒建成';
  END IF;

  -- ② 🔴🔴 【舊的 9 參數那一支必須不見了】—— 而**它的失敗形狀比我原本寫的更糟**。
  --    ⛔ ~~原本我寫「舊呼叫端仍打到舊那支 ⇒ 折扣寫不進去而一切看起來正常」~~
  --    🔴 **那是錯的, 實測推翻了它**(拋棄式 PG, 2026-09-01 00:4x, 現造一支 zzq_sig_test):
  --      建 `f(text)` ⇒ 1 支;再 `CREATE OR REPLACE f(text, integer DEFAULT 0)` ⇒ **2 支**
  --      而呼叫 `f('x')` ⇒ **`ERROR: function public.zzq_sig_test(unknown) is not unique`**
  --    ⇒ 📌 **兩支並存不是「安靜地打到舊的」, 是【每一個既有呼叫端當場全部炸掉】。**
  --    ⇒ 所以本檔 DROP 掉舊簽名, 而這一格是斷言不是註解。
  IF pg_catalog.to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '片3 fail-closed:舊的 9 參數 create_order 還在 ⇒ 兩支並存 ⇒ 既有呼叫端會拿到 function is not unique 而全部炸掉(2026-09-01 實測)';
  END IF;

  -- ③ 函式本體真的帶了那個參數(防「抄了檔頭而忘了改本體」)
  -- 🔴🔴 **先剝掉函式體裡的 `--` 註解再比**(codex R2 must-fix③):
  --    `pg_get_functiondef` 把註解一起回來 ⇒ 把真正那一行【註解掉】而字面留在註解裡,
  --    下面三道字面斷言**照樣全綠**。
  -- 📌 今晚第四次同族:**一把讀原始碼字面的尺, 它的分母包含所有在講這件事的字。**
  SELECT pg_catalog.regexp_replace(
           pg_catalog.pg_get_functiondef(v_oid), '--[^\n]*', '', 'g')
    INTO v_args;
  -- 🟢 正對照:剝完之後函式本體還在(剝過頭的話下面每一格都恆綠)。
  IF v_args NOT LIKE '%INSERT INTO public.orders%' THEN
    RAISE EXCEPTION '片3 fail-closed:剝註解之後找不到 INSERT INTO public.orders ⇒ 剝過頭了';
  END IF;
  IF v_args NOT LIKE '%p_coupon_code%' THEN
    RAISE EXCEPTION '片3 fail-closed:函式本體裡找不到 p_coupon_code';
  END IF;
  -- 🔴🔴 **釘住那道封鎖**(主視窗裁「丁」):3a 帶券碼一定要 RAISE。
  --    少了它 ⇒ 3a 單獨上線就變成一個洞(券無限次用)。
  IF v_args NOT LIKE '%優惠券結帳尚未啟用%' THEN
    RAISE EXCEPTION '片3 fail-closed:券碼分支沒有那道「尚未啟用」的封鎖 ⇒ 3a 單獨上線會是洞';
  END IF;
  -- 🛑 而【現在還不准】出現那次試算呼叫 —— 那是 3b 的事,
  --    而它一旦出現而封鎖還在, 兩者會互相矛盾;它若取代了封鎖, 這一片就不再是 3a 了。
  IF v_args LIKE '%public.redeem_coupon(%' THEN
    RAISE EXCEPTION '片3 fail-closed:函式體已經在呼叫 redeem_coupon ⇒ 那是 3b, 不是 3a';
  END IF;
  -- 🛑 而【不准】再出現一個收金額的參數 —— 那個洞的形狀不可以回來。
  IF v_args LIKE '%p_discount_total%' THEN
    RAISE EXCEPTION '片3 fail-closed:函式體出現 p_discount_total ⇒ 又在收呼叫端算的金額';
  END IF;
  IF v_args NOT LIKE '%v_subtotal + v_shipping_fee - v_discount_total%' THEN
    RAISE EXCEPTION '片3 fail-closed:total 的算式沒有減掉 discount_total';
  END IF;
  -- 🔴 **INSERT 那一處也要釘**(codex must-fix):只釘參數與算式的話,
  --    第③處退回寫死 `0` ⇒ **訂單的 discount_total 永遠是 0, 而 total 卻已經減過**
  --    ⇒ 帳面自相矛盾, 而 migration 自檢仍然全綠。
  IF v_args NOT LIKE '%v_shipping_fee, v_discount_total, v_total::integer%' THEN
    RAISE EXCEPTION '片3 fail-closed:INSERT 沒有把 p_discount_total 寫進 discount_total 欄';
  END IF;

  -- ③b 🔴 **全名 overload 恰一支**(codex must-fix):`DROP IF EXISTS` 只點名了一個簽名,
  --    而一支【我不知道存在的】別的 overload 會留下 ⇒ 呼叫端拿到 `is not unique`
  --    (那個形狀今晚實測過)。⇒ 直接數 `pg_proc`, 不去猜有哪些簽名。
  IF (SELECT count(*) FROM pg_catalog.pg_proc pr
        JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
       WHERE ns.nspname = 'public' AND pr.proname = 'create_order') <> 1 THEN
    RAISE EXCEPTION '片3 fail-closed:public.create_order 不是恰一支(現有 %)',
      (SELECT count(*) FROM pg_catalog.pg_proc pr
         JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
        WHERE ns.nspname = 'public' AND pr.proname = 'create_order');
  END IF;

  -- ③c 🔴 **SECURITY DEFINER 要釘 owner**(codex must-fix):DEFINER 用的是 **owner 的權限**,
  --    ⇒ 由誰跑這支 migration, 就決定了這支函式**以誰的身分執行**。
  --    而下面那道 ACL 自檢**把 owner 排除在外** ⇒ owner 錯了它一句都不會說。
  -- 🛑 這裡只**斷言**不改:改 owner 要 superuser, 而那不是施工窗該做的。
  IF (SELECT r.rolname FROM pg_catalog.pg_proc pr
        JOIN pg_catalog.pg_roles r ON r.oid = pr.proowner WHERE pr.oid = v_oid)
     IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '片3 fail-closed:create_order 的 owner 是 %, 不是 postgres —— SECURITY DEFINER 會以那個身分跑',
      (SELECT r.rolname FROM pg_catalog.pg_proc pr
         JOIN pg_catalog.pg_roles r ON r.oid = pr.proowner WHERE pr.oid = v_oid);
  END IF;

  -- ④ 🔴 ACL:新物件出生帶 PUBLIC ⇒ 沒收乾淨的話, 一支能建單的函式對匿名開著。
  DECLARE
    v_acl aclitem[];
    v_extra text[];
  BEGIN
    SELECT proacl INTO v_acl FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '片3 fail-closed:create_order 的 proacl 是 NULL(預設 ACL ⇒ PUBLIC 可執行)';
    END IF;
    -- 🔴 LEFT JOIN 不是 JOIN:aclexplode 給 PUBLIC 的 grantee 是 oid 0, 而 pg_roles 沒有 0
    --    ⇒ 內部 JOIN 會把 PUBLIC 那一列靜靜丟掉 ⇒ 這把尺看不到它唯一要防的那一種。
    SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
      FROM (SELECT coalesce(r.rolname::text, 'PUBLIC') AS gr
              FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
              LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid) y
     WHERE gr NOT IN ('authenticated', (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                                          JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                                         WHERE p2.oid = v_oid));
    IF array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION '片3 fail-closed:create_order 的 EXECUTE 開給了預期外的角色:%', v_extra;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '片3 fail-closed:authenticated 拿不到 create_order 的 EXECUTE(客人結帳會被擋)';
    END IF;
  END;

  -- 🟢 負對照:上面那把 to_regprocedure 若對任何東西都回非 NULL, 它就沒有判別力。
  IF pg_catalog.to_regprocedure('public.zzq_no_such_create_order_7731(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION '片3 自檢:負對照命中了一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $$;

-- 🔴 **換簽之後要刷 PostgREST 的 schema cache**(codex must-fix):
--    不刷的話, 新參數的呼叫在 cache 過期前**打不中** ⇒ 而那段期間的失敗
--    看起來像「函式不存在」, 沒有人會想到是 cache。
NOTIFY pgrst, 'reload schema';

COMMIT;
