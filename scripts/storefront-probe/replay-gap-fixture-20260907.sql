-- 🔴🔴 這是【replay 失敗的補丁】, 不是 bootstrap;來源 = 正式庫唯讀 catalog 於 2026-09-07 13:40:32 CST
--    產生指令:bash scripts/replay-gap-fixture.sh <本檔> create_order m3_jsonb_values_all_string pcm_generate_display_id redeem_coupon coupon_redeem_order_problem
--    🛑 **不要把本檔的內容搬進 runbook §2 的 bootstrap** —— 這裡每一個物件都是
--      【某一支 migration 自己會建的】, 而它們不見是因為那支 migration replay 失敗了。
--    ⚠️ 它只含你點名的那幾個, **不知道還缺什麼**。

-- ── create_order(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text, p_coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- ── ⟦auth-DEALERTIERPRICING⟧ B2c(2026-09-07):經銷單的價是【未稅】的 ──
  -- 🔬 Sean 2026-09-07 00:4x Q24 逐字:「甲=未稅 但是不標未稅, 單純 刷卡+5%, 匯款不用」
  --    `:441`「稅基含運費」· `:440`「一律填未稅, 系統算稅」
  v_tier           public.member_tier;
  v_tax            bigint  := 0;
  v_price_tax_mode text    := 'inclusive';
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0aa. 🔴🔴 B2c:先問【他是誰】—— 因為取價與稅【都】掛在這個答案上 ──
  --   🛑 **查不到就停, 不得退成 general** —— 退成 general 的後果不是「少一個折扣」,
  --     是**一位經銷商用一般價買走**, 而畫面上完全正常。
  --     📌 這與前台 `resolveAuthenticatedTierStrict()` 是**同一個判準**(B2a codex R1 must-fix ①);
  --       兩層各自 fail-closed, 而**這一層才是收錢的那一層**。
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'create_order: 查不到 customers.tier(user=%)⇒ 不得以一般價結帳', v_uid;
  END IF;
  IF v_tier = 'store'::public.member_tier THEN
    v_price_tax_mode := 'exclusive';
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

  -- ── 1b. ⟦b4-BANKCARDRACE⟧ 同一個購物車不得在【已經付成功】之後再開一張單 ──────
  --
  -- 🔴🔴 **這一段解的是「兩個分頁,客人兩邊都付」**:刷卡那條路(`begin_charge_attempt`)
  --    在它自己的交易裡把同 cart 的匯款單 supersede 掉(`20260904050000:202-217`
  --    `SET cancelled_at = now(), cancelled_reason = 'superseded_by_card'`),
  --    而那個 UPDATE **掃不到還沒 commit 的列**,更掃不到**它 commit 之後**才建的列。
  --    ⇒ 🛑 **後者根本不是 race** —— 在本段之前,那張後來的匯款單【永遠】沒有人會處理。
  --
  -- 🔴 **為什麼鎖要拿在這裡、而且是【同一把】**:
  --    `20260904050000:118` 逐字 `PERFORM pg_catalog.pg_advisory_xact_lock(
  --      pg_catalog.hashtextextended(v_order.customer_user_id::text, 0))`。
  --    📌 **一把 advisory lock 只序列化【有拿它的人】** —— 而在本段之前,建單這條路
  --    整支函式 `advisory` 命中 **0**、`FOR UPDATE` 命中 **0**(兩支多載都是,唯讀量過)
  --    ⇒ 那把鎖對建單形同不存在。**同 key、同型、同鎖序**才叫加入協定。
  --
  -- 🛑 **述詞【刻意只認「已經付成功」】,不認 pending / failed** —— 這一格是承重的:
  --    `ClearCartOnSuccess.tsx:18` 逐字「callback page 僅在 **paid 分支** 傳 regenerate」
  --    ⇒ 📌 **刷卡失敗或 pending 之後 `cart_session_id` 不會換。**
  --    ⇒ 若把 pending/failed 也擋掉,擋到的第一個人不是雙付的客人,
  --      **是刷卡失敗想再試一次的客人** —— 他會再也結不了帳。
  --    ⛔ ~~原本要用 partial unique index~~ **放棄**(主視窗 2026-09-06 裁甲):
  --      索引只表達得了「同一組欄位不得重複」,而本不變量是**跨列、有條件**的。
  --      📌 索引不需要任何人同意 —— 而代價是**它也不聽任何條件**。
  --
  -- 🔵 「已經付成功」的兩種形狀,逐字對齊既有述詞(不發明):
  --    · `o.payment_status = 'paid'` —— 與 `20260904050000:132` 那格同字面
  --    · 有一筆 `payment_charge_attempts.status = 'charged'` —— 與同檔 `:131` 同字面
  --    ⚠️ **不用 `a.status <> 'failed'`**(supersede 那段 `:216` 用的是它):那條**含 pending**,
  --      而 pending 正是上面說的「要允許重試」的那個世界。
  --      🛑 三處刻意**不共用**(理由同 `20260904050000:200` 那段:抽成共用點會變成一個
  --      【會一起被改壞】的東西)⇒ **改任一處之前先讀另外兩處。**
  --
  -- 🔴 查詢本身失敗 ⇒ **原樣往上拋,不吞** —— fail-closed。
  --    (與重算那支刻意吞例外的形狀相反:那裡吞是為了不讓客人的收款回滾,
  --     這裡沒有那個代價 —— 建單還沒發生。)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));

  PERFORM 1
     FROM public.orders o
    WHERE o.customer_user_id = v_uid
      AND o.cart_session_id  = p_cart_session_id
      AND o.cancelled_at IS NULL
      AND (
            o.payment_status = 'paid'::public.payment_status
         OR EXISTS (
              SELECT 1 FROM public.payment_charge_attempts a
               WHERE a.order_id = o.id AND a.status = 'charged'
            )
          )
    LIMIT 1;
  IF FOUND THEN
    -- 🔴 **具名 SQLSTATE + 固定字面** —— app 端要靠它分辨這一種失敗,
    --    而**文案還沒有**(Q-同車兩單文案已排給 Sean)⇒ 在那之前客人看到的是原樣錯誤。
    --    🛑 改這個字面或這個 code = 改一個**呼叫端在比對的東西**,不是改文案。
    RAISE EXCEPTION 'create_order: 這個購物車已經有一張付款成功的訂單(pcm_cart_already_paid)'
      USING ERRCODE = 'P0002';
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
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
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

    -- ⛔ ~~`v_unit_price := v_variant.price_general;`~~ ⇒ 🔴 **B2c:經銷單要收經銷價。**
    --   🛑 這一半與「寫 `price_tax_mode='exclusive'`」**缺一更糟**:
    --     只寫 exclusive 而價還是 general ⇒ 那張單**自稱未稅而收的是含稅價** ⇒ 帳與發票都會錯。
    --   🔵 `coalesce(price_store, price_general)` 與前台 RPC `get_effective_prices` 的變體那一半
    --     **逐字同形** —— 不自創第二種取價法(那支:`coalesce(v.price_store, v.price_general)`)。
    IF v_tier = 'store'::public.member_tier THEN
      -- 🔴 **`coalesce` 不加 pg_catalog 前綴** —— 它是 SQL 關鍵字不是函式;
      --   加了會炸 `function pg_catalog.coalesce(integer, integer) does not exist`
      --   (本 repo 至少 8 支 migration 的註解各記過一次, 而我今晚仍然打了兩次)。
      --   ⚠️ 而 `SET search_path = ''` 之下它仍然找得到 —— 關鍵字不走 search_path。
      v_unit_price := coalesce(v_variant.price_store, v_variant.price_general);
    ELSE
      v_unit_price := v_variant.price_general;
    END IF;
    -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個
    --   「送」/ 試用品)⇒ 這道閘原本把贈品判成「無有效價格」而擋在結帳。
    --   ⚠️ **`IS NULL` 那半一個字都沒動** —— 它擋的是「查不到價格」, 與「0 元」是兩件事。
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      -- ⛔ ~~訊息原本寫死 `price_general`~~ ⇒ B2c 之後這條路也可能是 `price_store`
      --   ⇒ 一句寫死的欄位名會讓讀 log 的人去查錯的那一欄。
      RAISE EXCEPTION 'create_order: 變體無有效單價(tier=%, variant=%)', v_tier, v_variant.id;
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
  -- ── 🔴🔴 B2c:這一支【沒有 `p_payment_channel`】—— 而稅由付款方式決定 ──
  --   🛑 **所以它算不出經銷單的稅。** 三種處置裡:
  --     ①猜 tappay ⇒ 匯款客人被多收 5%   ②猜 bank_transfer ⇒ 刷卡客人少收 5%
  --     ✅ ③**擋下來** —— 這一支「今天沒有已知呼叫端」(`20260906500000:635` 逐字),
  --        擋住的代價是 0, 而猜錯的代價是每一張經銷單都錯。
  --   ⚠️ 一般會員這條路**一個字都沒變** —— 本閘只在 tier = store 時開火。
  IF v_price_tax_mode = 'exclusive' THEN
    RAISE EXCEPTION 'create_order(10 參 legacy): 經銷單需要付款方式才能算稅 ⇒ 請走 11 參那支(user=%)', v_uid;
  END IF;
  v_total := v_subtotal + v_shipping_fee - v_discount_total + v_tax;
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
        subtotal, shipping_fee, discount_total, tax_total, price_tax_mode, total, shipping_method, invoice, cart_session_id,
        notification_email
      ) VALUES (
        -- ⛔ ~~`'general'::public.member_tier` 寫死~~ ⇒ 🔴 B2c:寫【他真正的】等級。
        --   🔵 本支已在上面擋掉 store(算不出稅), 所以走到這裡的 `v_tier` 必為非 store;
        --     **仍然寫變數而不是寫死** —— premiumStore 也是一個真答案, 而寫死會把它記成 general。
        v_display_id, v_uid, p_address_id, v_addr_snapshot, v_tier,
        v_subtotal::integer, v_shipping_fee, v_discount_total, v_tax::integer, v_price_tax_mode, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_payment_channel text, p_notification_email text DEFAULT NULL::text, p_coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- ── ⟦auth-DEALERTIERPRICING⟧ B2c(2026-09-07):經銷單的價是【未稅】的 ──
  -- 🔬 Sean 2026-09-07 00:4x Q24 逐字:「甲=未稅 但是不標未稅, 單純 刷卡+5%, 匯款不用」
  --    `:441`「稅基含運費」· `:440`「一律填未稅, 系統算稅」
  v_tier           public.member_tier;
  v_tax            bigint  := 0;
  v_price_tax_mode text    := 'inclusive';
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0aa. 🔴🔴 B2c:先問【他是誰】—— 因為取價與稅【都】掛在這個答案上 ──
  --   🛑 **查不到就停, 不得退成 general** —— 退成 general 的後果不是「少一個折扣」,
  --     是**一位經銷商用一般價買走**, 而畫面上完全正常。
  --     📌 這與前台 `resolveAuthenticatedTierStrict()` 是**同一個判準**(B2a codex R1 must-fix ①);
  --       兩層各自 fail-closed, 而**這一層才是收錢的那一層**。
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'create_order: 查不到 customers.tier(user=%)⇒ 不得以一般價結帳', v_uid;
  END IF;
  IF v_tier = 'store'::public.member_tier THEN
    v_price_tax_mode := 'exclusive';
  END IF;

  -- ── 0a-2. 🔴🔴 **付款管道白名單**(2026-09-04 段 1)──
  --   🛑 **這個參數【刻意不給 DEFAULT】, 而那是承重的不是風格。**
  --     本函式與舊的 10 參數版**並存**(部署三步的中間態)⇒ 兩支要各自被唯一命中。
  --     🔬 而分辨器**不是參數個數**(舊 8..10 / 新 9..11, 中間是重疊的)——
  --       **是【名字集合】**:舊那支沒有 `p_payment_channel` ⇒ 送它就配不上舊的;
  --       新那支它必填 ⇒ 不送就配不上新的。**兩邊各自被一個必填的名字釘死。**
  --     🔬 實測(PostgREST 14.16 + 拋棄式 PG 17.10, 同形狀四發全唯一):
  --       舊 4 名 ⇒ OLD · 舊 2 必填 ⇒ OLD · 新 5 名 ⇒ NEW · 新 3 必填 ⇒ NEW
  --     🔴 **而給了 DEFAULT 會怎樣, 我也量了**:兩支都吃得下同一個名字集合 ⇒
  --       `PGRST203 Could not choose the best candidate function between: …`
  --   ⚠️ **射程**:上面兩發是 **PostgREST 14.16**;正式站是 Supabase 的版本
  --     ⇒ 🛑 **「正式站也一樣」是【推的】** ⇒ 貼完 A 之後要在正式站點一次結帳(不送出)驗它。
  --   🔵 **白名單只收兩種**:`tappay` 與 `bank_transfer`。
  --     `cash` 不收 —— 它是**員工手動建單**那條路的值(`admin_create_manual_order`),顧客站給不了;
  --     `none` 不收 —— 它今天零寫入端、沒有人拍過它的語意。
  IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('tappay', 'bank_transfer') THEN
    RAISE EXCEPTION 'create_order: 付款管道 [%] 不在白名單(只收 tappay / bank_transfer)', COALESCE(p_payment_channel, '<null>');
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

  -- ── 1b. ⟦b4-BANKCARDRACE⟧ 同一個購物車不得在【已經付成功】之後再開一張單 ──────
  --
  -- 🔴🔴 **這一段解的是「兩個分頁,客人兩邊都付」**:刷卡那條路(`begin_charge_attempt`)
  --    在它自己的交易裡把同 cart 的匯款單 supersede 掉(`20260904050000:202-217`
  --    `SET cancelled_at = now(), cancelled_reason = 'superseded_by_card'`),
  --    而那個 UPDATE **掃不到還沒 commit 的列**,更掃不到**它 commit 之後**才建的列。
  --    ⇒ 🛑 **後者根本不是 race** —— 在本段之前,那張後來的匯款單【永遠】沒有人會處理。
  --
  -- 🔴 **為什麼鎖要拿在這裡、而且是【同一把】**:
  --    `20260904050000:118` 逐字 `PERFORM pg_catalog.pg_advisory_xact_lock(
  --      pg_catalog.hashtextextended(v_order.customer_user_id::text, 0))`。
  --    📌 **一把 advisory lock 只序列化【有拿它的人】** —— 而在本段之前,建單這條路
  --    整支函式 `advisory` 命中 **0**、`FOR UPDATE` 命中 **0**(兩支多載都是,唯讀量過)
  --    ⇒ 那把鎖對建單形同不存在。**同 key、同型、同鎖序**才叫加入協定。
  --
  -- 🛑 **述詞【刻意只認「已經付成功」】,不認 pending / failed** —— 這一格是承重的:
  --    `ClearCartOnSuccess.tsx:18` 逐字「callback page 僅在 **paid 分支** 傳 regenerate」
  --    ⇒ 📌 **刷卡失敗或 pending 之後 `cart_session_id` 不會換。**
  --    ⇒ 若把 pending/failed 也擋掉,擋到的第一個人不是雙付的客人,
  --      **是刷卡失敗想再試一次的客人** —— 他會再也結不了帳。
  --    ⛔ ~~原本要用 partial unique index~~ **放棄**(主視窗 2026-09-06 裁甲):
  --      索引只表達得了「同一組欄位不得重複」,而本不變量是**跨列、有條件**的。
  --      📌 索引不需要任何人同意 —— 而代價是**它也不聽任何條件**。
  --
  -- 🔵 「已經付成功」的兩種形狀,逐字對齊既有述詞(不發明):
  --    · `o.payment_status = 'paid'` —— 與 `20260904050000:132` 那格同字面
  --    · 有一筆 `payment_charge_attempts.status = 'charged'` —— 與同檔 `:131` 同字面
  --    ⚠️ **不用 `a.status <> 'failed'`**(supersede 那段 `:216` 用的是它):那條**含 pending**,
  --      而 pending 正是上面說的「要允許重試」的那個世界。
  --      🛑 三處刻意**不共用**(理由同 `20260904050000:200` 那段:抽成共用點會變成一個
  --      【會一起被改壞】的東西)⇒ **改任一處之前先讀另外兩處。**
  --
  -- 🔴 查詢本身失敗 ⇒ **原樣往上拋,不吞** —— fail-closed。
  --    (與重算那支刻意吞例外的形狀相反:那裡吞是為了不讓客人的收款回滾,
  --     這裡沒有那個代價 —— 建單還沒發生。)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));

  PERFORM 1
     FROM public.orders o
    WHERE o.customer_user_id = v_uid
      AND o.cart_session_id  = p_cart_session_id
      AND o.cancelled_at IS NULL
      AND (
            o.payment_status = 'paid'::public.payment_status
         OR EXISTS (
              SELECT 1 FROM public.payment_charge_attempts a
               WHERE a.order_id = o.id AND a.status = 'charged'
            )
          )
    LIMIT 1;
  IF FOUND THEN
    -- 🔴 **具名 SQLSTATE + 固定字面** —— app 端要靠它分辨這一種失敗,
    --    而**文案還沒有**(Q-同車兩單文案已排給 Sean)⇒ 在那之前客人看到的是原樣錯誤。
    --    🛑 改這個字面或這個 code = 改一個**呼叫端在比對的東西**,不是改文案。
    RAISE EXCEPTION 'create_order: 這個購物車已經有一張付款成功的訂單(pcm_cart_already_paid)'
      USING ERRCODE = 'P0002';
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
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
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

    -- ⛔ ~~`v_unit_price := v_variant.price_general;`~~ ⇒ 🔴 **B2c:經銷單要收經銷價。**
    --   🛑 這一半與「寫 `price_tax_mode='exclusive'`」**缺一更糟**:
    --     只寫 exclusive 而價還是 general ⇒ 那張單**自稱未稅而收的是含稅價** ⇒ 帳與發票都會錯。
    --   🔵 `coalesce(price_store, price_general)` 與前台 RPC `get_effective_prices` 的變體那一半
    --     **逐字同形** —— 不自創第二種取價法(那支:`coalesce(v.price_store, v.price_general)`)。
    IF v_tier = 'store'::public.member_tier THEN
      -- 🔴 **`coalesce` 不加 pg_catalog 前綴** —— 它是 SQL 關鍵字不是函式;
      --   加了會炸 `function pg_catalog.coalesce(integer, integer) does not exist`
      --   (本 repo 至少 8 支 migration 的註解各記過一次, 而我今晚仍然打了兩次)。
      --   ⚠️ 而 `SET search_path = ''` 之下它仍然找得到 —— 關鍵字不走 search_path。
      v_unit_price := coalesce(v_variant.price_store, v_variant.price_general);
    ELSE
      v_unit_price := v_variant.price_general;
    END IF;
    -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個
    --   「送」/ 試用品)⇒ 這道閘原本把贈品判成「無有效價格」而擋在結帳。
    --   ⚠️ **`IS NULL` 那半一個字都沒動** —— 它擋的是「查不到價格」, 與「0 元」是兩件事。
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      -- ⛔ ~~訊息原本寫死 `price_general`~~ ⇒ B2c 之後這條路也可能是 `price_store`
      --   ⇒ 一句寫死的欄位名會讓讀 log 的人去查錯的那一欄。
      RAISE EXCEPTION 'create_order: 變體無有效單價(tier=%, variant=%)', v_tier, v_variant.id;
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
  -- ── 🔴 B2c:稅【外加】, 而加不加由付款方式決定 ──────────────────
  --   🔬 算式與捨入**逐字抄後台那支**(`20260905360000:443`), 不自創第二種:
  --        `round(((subtotal + shipping - discount)::numeric) * 0.05)::bigint`
  --   🛑 `p_payment_channel` 已在 0a-2 那道白名單閘裡驗過 ⇒ 這裡只認 `bank_transfer` 一個值,
  --     **其餘一律當要課稅** —— 不認得的管道**寧可多收也不少收**? 不:多收更糟。
  --     ✅ 所以是【白名單反過來】—— 閘已保證它只會是 tappay / bank_transfer 兩者之一,
  --       這裡的 ELSE 分支在那道閘成立時走不到;而它仍然寫出來, 因為「今天走不到」不是「以後走不到」。
  IF v_price_tax_mode = 'exclusive' AND p_payment_channel <> 'bank_transfer' THEN
    v_tax := pg_catalog.round(((v_subtotal + v_shipping_fee - v_discount_total)::numeric) * 0.05)::bigint;
  ELSE
    v_tax := 0;
  END IF;
  v_total := v_subtotal + v_shipping_fee - v_discount_total + v_tax;
  IF v_tax > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 稅額溢位(tax=%)', v_tax;
  END IF;
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
        subtotal, shipping_fee, discount_total, tax_total, price_tax_mode, total, shipping_method, invoice, cart_session_id,
        notification_email, payment_channel
      ) VALUES (
        -- ⛔ ~~`'general'::public.member_tier` 寫死~~ ⇒ 🔴 B2c:寫【他真正的】等級。
        --   📌 這一格是**單據上唯一記得「這張單當時用哪一層價」的地方** —— 寫死 general
        --     等於把經銷單偽裝成一般單, 而退款/發票/對帳都會照它走。
        v_display_id, v_uid, p_address_id, v_addr_snapshot, v_tier,
        v_subtotal::integer, v_shipping_fee, v_discount_total, v_tax::integer, v_price_tax_mode, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
        p_notification_email, p_payment_channel
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
$function$;

-- ── m3_jsonb_values_all_string(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.m3_jsonb_values_all_string(j jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(j) = 'object' THEN NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(j) AS kv(k, v)
      WHERE pg_catalog.jsonb_typeof(kv.v) <> 'string'
    )
    ELSE false
  END;
$function$;

-- ── pcm_generate_display_id(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.pcm_generate_display_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- §5.4a 字母表:36 英數 −(0,O,1,I,L 易混淆)−(A,E,U 母音)= 28 字元、大寫 only。
  c_alphabet  constant text    := '23456789BCDFGHJKMNPQRSTVWXYZ';
  c_len       constant integer := 6;      -- §5.4a 固定 6 碼、無前綴
  -- rejection sampling 門檻:256 = 9×28 + 4 ⇒ byte 0..251 均勻對應 28 格(每格 9 個),
  -- byte 252..255 必須丟棄。🔴 寫成 253 只多收 byte 252(→ 字母表第 1 個字元),
  --    會讓 `2` 多 1/9 權重 —— 而 regex / 長度 / 不退化 / 函式自我驗證**全都抓不到**
  --    (產出的每個字元都合法、長度也對,只是分布偏了),
  --    只有本片的卡方探針(3.4 的探針 3)抓得到:隔離庫多次實跑 chi2 落在 **100 以上**(實測 101 / 129 / 149 / 161 / 181),門檻 82。
  --    ⚠️ 卡方是隨機量、每次不同 ⇒ 註解只記範圍,不記單次數字(記死了必然漂移)。
  c_reject_at constant integer := 252;
  -- 每批抽 16 bytes;每 byte 可用率 252/256 = 98.4% ⇒ 一批湊不滿 6 碼的機率極低。
  c_batch     constant integer := 16;
  -- 抽取批次上限:防「RNG 病態時無界迴圈掛住結帳連線」。正常路徑第 1 批就湊滿。
  c_max_draws constant integer := 16;
  v_out    text    := '';
  v_bytes  bytea;
  v_b      integer;
  v_i      integer;
  v_draws  integer := 0;
BEGIN
  WHILE pg_catalog.length(v_out) < c_len LOOP
    v_draws := v_draws + 1;
    IF v_draws > c_max_draws THEN
      -- 不靜默、不降級:寧可讓呼叫端看到明確錯誤,也不回一個短的/可預測的號碼。
      RAISE EXCEPTION 'pcm_generate_display_id: 亂數抽取批次用盡(% 批仍湊不滿 % 碼)'
                      ' (pcm_display_id_rng_exhausted)', c_max_draws, c_len
        USING ERRCODE = 'P0001';
    END IF;

    v_bytes := extensions.gen_random_bytes(c_batch);

    FOR v_i IN 0 .. c_batch - 1 LOOP
      EXIT WHEN pg_catalog.length(v_out) >= c_len;
      v_b := pg_catalog.get_byte(v_bytes, v_i);          -- get_byte 是 0-indexed
      CONTINUE WHEN v_b >= c_reject_at;                  -- rejection sampling(禁 % 28 直取)
      v_out := v_out || pg_catalog.substr(c_alphabet, (v_b % 28) + 1, 1);  -- substr 是 1-indexed
    END LOOP;
  END LOOP;

  -- 自我驗證:函式不該把不符合約的值交出去(下游 CHECK 是第二道防線、不是第一道)。
  IF v_out !~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$' THEN
    RAISE EXCEPTION 'pcm_generate_display_id: 產出不符 §5.4a 合約(%)', v_out
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_out;
END;
$function$;

-- ── redeem_coupon(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.redeem_coupon(p_code text, p_user_id uuid, p_subtotal integer, p_has_tier_price boolean, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- 空白字元集**照抄** `20260716210000_m4a_admin_adjust_wallet_rpc.sql:54-60`, 不自己發明。
  -- ⚠️ PG 的 E'' 不支援 \v ⇒ 垂直 tab 用八進位 \013。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\00A0' || U&'\2007' || U&'\202F' || U&'\3000' || U&'\200B' || U&'\FEFF';
  v_code      text;
  v_dry_run   boolean := p_order_id IS NULL;
  v_c         public.coupons%ROWTYPE;
  v_owner     uuid;
  v_problem   text;
  v_used      integer;
  v_by_acct   integer;
  v_discount  integer;
  v_calc      integer;   -- 用【這一次的 p_subtotal】算出來的折抵;NULL = 這個小計不該有折抵
  v_prev      public.coupon_redemptions%ROWTYPE;
BEGIN
  -- 🔴🔴 **R3-must-fix:那三道上限暗藏一個【沒有寫出來】的假設 —— `READ COMMITTED`。**
  --    我們的做法是「`FOR UPDATE` 鎖券那一列 ⇒ 等對手 commit ⇒ 再 `count(*)`」。
  --    ⚠️ 而在 `REPEATABLE READ` 之下, **等到鎖之後讀到的仍是交易開始時的快照**
  --      ⇒ 對手剛寫進去的那一列**看不見** ⇒ 兩張單一起越過 `max_redemptions`。
  --    📌 **鎖擋得住「同時寫」, 擋不住「看不到」** —— 那是兩件事, 而輸出上長得一樣。
  -- 🛑 函式內**不能**改隔離等級(`SET TRANSACTION` 必須是交易的第一個動作)⇒ 只能拒絕。
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION
      'redeem_coupon: 隔離等級是 %, 而三道上限的正確性依賴 read committed —— 拒絕執行',
      current_setting('transaction_isolation');
  END IF;

  -- 1a. 參數 fail-closed。
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'redeem_coupon: 缺 user_id';
  END IF;
  IF p_subtotal IS NULL OR p_subtotal < 0 THEN
    RAISE EXCEPTION 'redeem_coupon: subtotal 必須是非負整數';
  END IF;
  IF p_has_tier_price IS NULL THEN
    -- 🔴 **不預設 false** —— 預設 false = 悄悄放行一張不該與會員價並用的券。
    RAISE EXCEPTION 'redeem_coupon: 缺 has_tier_price';
  END IF;

  -- 1a-2. 🔴🔴 **訂單歸屬** —— 片1 `:349-356` 逐字把這一格指定給片2:
  --   「兩個 FK 各自保證『訂單存在』『客人存在』, 而【沒有東西保證那兩個是同一個人】
  --     ⇒ 寫得進『甲的訂單算到乙頭上』, 而每人上限就從那一列開始數錯人。」
  --   ⇒ 它給了兩條路:提複合外鍵的 plan, 或**在建 redemption 的 RPC 裡驗這一格**。走後者。
  -- 🛑 不符**不是**一個拒絕理由 —— 那是呼叫端傳錯或有人在試 ⇒ 丟例外, 不回一個看起來正常的 JSON。
  -- 🔴🔴 **R2-must-fix:訊息合一** —— 原版「訂單不存在」與「不屬於這個帳號」是**兩句不同的話**
  --    ⇒ 拿一串 uuid 猜過去, 兩句話就把「這張單存不存在」分出來了。**同一句, 不分。**
  -- 🔴🔴 **R2-must-fix:付款狀態** —— 片1 `:7` 逐字「**Q「用掉一次」什麼時候算 ⇒ 乙:付款成功才算**」,
  --    同檔 `:11` 逐字「⇒ 片2 落點:**寫 redemption 的時機綁付款成功那一步, 不綁建單**」。
  --    ⇒ 原版沒驗 ⇒ 一張 unpaid 的單就能吃掉限量券的名額, 而它一天後會自動失效
  --      (`20260828060000_..._expire_unpaid_orders:153`)⇒ **名額被一張不存在的單吃走。**
  --    🛑 這是 **Sean 拍的乙**, 不是我判的。
  IF NOT v_dry_run THEN
    -- 🔴🔴 **R3-must-fix:訂單那一列要 `FOR UPDATE`** —— 原版是普通 `SELECT`
    --    ⇒ 我讀到 `paid` 之後、INSERT 之前, 退款 / 取消那條路可以 commit
    --    ⇒ 我照樣寫下一列「有效」的 redemption, 掛在一張已經被退掉的單上。
    -- ⚠️ **鎖序=先單再券**(這裡 → 1c)。今天只有這支函式碰 `coupons`,
    --    ⇒ 未來若有另一條路【先鎖券再鎖單】, 那就是死結。寫下來, 不要靠記得。
    -- 🔵🔵 **2026-08-31:三道 inline 檢查 → 一支 predicate**(Sean 拍甲, 主視窗 `-24` 轉)。
    --    ⛔ ~~原本這裡逐一問 `payment_status` / `cancelled_at` / `order_cancellations`~~
    --    🔴 **為什麼收掉**:codex 五輪裡有三輪落在同一層 —— R3 抓 1 個、R4 抓 1 個、
    --      **R5 一次抓 3 個**(`order_refunds` / `order_manual_refunds` / `order_payments`)
    --      ⇒ **這條路上的數字在變大, 不是變小。**每多一條退款/取消路徑就多一個落點,
    --      而漏掉的那一次不會有東西叫。
    -- 📌 **⇒ 一格一格補是輸的做法;收成一個地方, 下一個落點只要改那裡。**
    --    predicate = `20260831155000_m4b_coupon_order_problem_predicate.sql`(**十個問題碼**, 實測含正反兩向,
    --    四發正向突變 + 三發反向突變各殺各的)。
    -- 🛑 **它比原本【嚴】** —— 部分退款之後訂單其實還有效、只是金額變小, 而它一律回問題碼。
    --    那是刻意的:**在錢這一層, 誤擋的代價是客人再按一次;漏擋的代價是錢算錯。**
    SELECT o.customer_user_id INTO v_owner
      FROM public.orders o WHERE o.id = p_order_id
      FOR UPDATE;
    IF NOT FOUND OR v_owner IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'redeem_coupon: 訂單不存在或不屬於這個帳號(order_id=%)', p_order_id;
    END IF;
    v_problem := public.coupon_redeem_order_problem(p_order_id);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION
        'redeem_coupon: 這張單不算數(problem=%)—— 見 coupon_redeem_order_problem 的問題碼清單(order_id=%)',
        v_problem, p_order_id;
    END IF;
  END IF;

  -- 1b. 券碼正規化:**只剝頭尾**, 不剝中段。
  --    🔴 剝中段(把 'SA VE10' 變成 'SAVE10')= 幫客人把打錯的碼改成一張真的券 ⇒ 不做。
  v_code := upper(pg_catalog.btrim(coalesce(p_code, ''), v_ws));
  IF v_code = '' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  -- 1c. 取券。**兌換模式才鎖列** —— 試算不鎖(鎖了會讓「看一下券」序列化整個結帳)。
  IF v_dry_run THEN
    SELECT * INTO v_c FROM public.coupons WHERE code = v_code;
  ELSE
    SELECT * INTO v_c FROM public.coupons WHERE code = v_code FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  -- 1c-1. 🔴🔴 **折抵【只算一次】, 冪等路徑與正常路徑共用同一個值**(codex R2 must-fix)。
  --    ⛔ ~~原版:冪等路徑直接回 `v_prev.discount_applied`, 而正常路徑另外算一次~~
  --    ⇒ **兩條路徑, 兩個答案** ⇒ 先用小計 4000 折 40, 重送時傳 10000
  --      ⇒ 靜默回 40, 而正確是 100。**少折 60 元, 而沒有東西會叫。**
  --    ⚠️ 而我第一版的修法(只擋「折抵 > 小計」)**只涵蓋一個方向** ——
  --      codex 逐字:「反方向『小計變大』必須擋或驗證, 否則百分比券會靜默少折」。
  -- 📌 **⇒ 加第二道檢查是在補洞;只算一次是把洞的來源拿掉。**
  IF p_subtotal < greatest(v_c.min_spend, 1) THEN
    v_calc := NULL;   -- 這個小計不該有折抵(理由見 1d)
  ELSE
    v_calc := CASE v_c.discount_type
      WHEN 'fixed'   THEN v_c.discount_value
      WHEN 'percent' THEN round(p_subtotal::numeric * v_c.discount_value::numeric / 100)::integer
    END;
    v_calc := least(v_calc, p_subtotal);   -- 上限 = 小計(算術, 不是政策)
    v_calc := greatest(v_calc, 1);          -- 下限 = 1 元(Sean 2026-08-31 拍甲)
  END IF;

  -- 1c-2. 🔵 **同一張單重送 ⇒ 冪等回成功**(codex must-fix):
  --   付款流程會重試, 而「同一張單、同一張券、同一個帳號」再送一次**不是錯誤**。
  --   ⇒ 回上一次的結果, 不再寫第二列(`UNIQUE (order_id)` 本來就不准)。
  -- 🛑 而**換一張券**送同一張單 ⇒ 那是另一件事 ⇒ 例外。
  -- 🔴🔴 **R2-must-fix:那個例外要在【七條規則之前】丟** —— 原版放在最後,
  --    ⇒ 新券若 inactive/expired/exhausted, 會先回一個看起來正常的拒絕理由,
  --      **永遠走不到那個例外** ⇒ 呼叫端以為「這張券不能用」, 而真正的事實是
  --      「這張單已經用了另一張券」。**兩件事, 一個答案。**
  IF NOT v_dry_run THEN
    SELECT * INTO v_prev FROM public.coupon_redemptions r WHERE r.order_id = p_order_id;
    IF FOUND AND v_prev.reverted_at IS NULL THEN
      IF v_prev.coupon_id = v_c.id AND v_prev.user_id = p_user_id THEN
        -- 🔴🔴 **拿【這一次算出來的】跟【已記錄的】比, 兩邊都要相同才叫冪等**(codex R2)。
        --    ⛔ ~~第一版只擋「折抵 > 小計」~~ —— 那**只涵蓋小計變小那個方向**;
        --      小計變【大】時(4000 → 10000)它一句話都不會說, 而客人少折 60 元。
        -- 📌 **冪等 =「同一件事再做一次給同一個答案」, 不是「不管你問什麼都給舊答案」。**
        --    ⇒ 對不上 = 呼叫端這兩次送的小計不一樣 ⇒ 丟例外, 不回一個看起來正常的 JSON。
        IF v_calc IS DISTINCT FROM v_prev.discount_applied THEN
          RAISE EXCEPTION
            'redeem_coupon: 重送算出的折抵 % 與已記錄的 % 不同(order_id=%, subtotal=%)—— 兩次的小計對不上',
            coalesce(v_calc::text, 'NULL'), v_prev.discount_applied, p_order_id, p_subtotal;
        END IF;
        RETURN jsonb_build_object('valid', true, 'discount_applied', v_prev.discount_applied,
                                  'coupon_id', v_c.id);
      END IF;
      RAISE EXCEPTION
        'redeem_coupon: 這張單已經有一列 redemption 而它不是這一張券(order_id=%)—— 封閉集沒有對應的拒絕理由, 需要拍板',
        p_order_id;
    END IF;
  END IF;

  -- 1d. 七條規則, 順序見檔頭。
  IF NOT v_c.is_active THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'inactive');
  END IF;

  -- 🔴 `ends_on` 語意是「結束日當天仍可用」⇒ 用 `<` 不是 `<=`。
  --    時區用 Asia/Taipei ——「8/31 到期」對客人是台北的 8/31。
  -- 🔴🔴 **用 `clock_timestamp()` 不是 `now()`**(codex must-fix):`now()` **固定在交易開始**
  --    ⇒ 23:59 開的交易在 00:05 兌換時仍用前一天判定 ⇒ 已到期的券在那個交易裡還能用。
  IF v_c.ends_on IS NOT NULL
     AND v_c.ends_on < ((clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  IF p_has_tier_price AND NOT v_c.stacks_with_tier THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'tier_conflict');
  END IF;

  -- 🔴 每一個數次數的地方都要帶 `reverted_at IS NULL`(片1 `:186` 逐字警告)——
  --    漏掉任何一處 ⇒ 那張券看起來已用完, 而客人明明退過貨, 且不會有任何東西紅。
  IF v_c.max_per_account IS NOT NULL THEN
    SELECT count(*) INTO v_by_acct
      FROM public.coupon_redemptions r
     WHERE r.coupon_id = v_c.id AND r.user_id = p_user_id AND r.reverted_at IS NULL;
    IF v_by_acct >= v_c.max_per_account THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'already_used_by_account');
    END IF;
  END IF;

  IF v_c.max_redemptions IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM public.coupon_redemptions r
     WHERE r.coupon_id = v_c.id AND r.reverted_at IS NULL;
    IF v_used >= v_c.max_redemptions THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted');
    END IF;
  END IF;

  -- 🔴🔴 **`greatest(min_spend, 1)` —— 這一格是我判的, 不是 Sean 拍的。**
  --    他 2026-08-31 拍【甲:最低折 1 元】, 而那句話帶出一個**他沒有被問到的邊界**:
  --    小計 0 元的單(PCM 有零元單)⇒ 折抵下限 1 會**大於小計** ⇒ 負數金額。
  --    ⇒ 我的判斷:**「最低折 1 元」等於把這張券的有效低消抬到至少 1 元**
  --      —— 一張 0 元的單本來就沒有東西可以折。⇒ 回既有的 `below_min_spend`,
  --      **不發明第八個拒絕理由**。
  -- ⛔ ~~**codex 說這是新金額政策 —— 我查了, 那個前提不成立**~~
  -- 🔴🔴 **我錯了, 而 codex R2 的反駁是對的:`total` 與 `subtotal` 是【兩個欄位】。**
  --    `create_order` 段 7 擋的是 `v_total <= 0`, 而 `total = subtotal + 運費`
  --    ⇒ **商品小計 0 + 宅配運費 100 ⇒ total 100 ⇒ 建得起來、付得掉**
  --    ⇒ **兌換模式真的收得到 `p_subtotal = 0`。** 我把「整車金額」讀成涵蓋 subtotal 了。
  -- 📌 **⇒ 這正是「範圍在轉述中被丟掉」那一族:我引用了一個真的拍板,
  --    而我引用的射程比它實際涵蓋的寬一格。而那一格剛好是這裡。**
  -- 🛑 **⇒ 那真的是一題待 Sean 拍, 而 codex 也講出了那一格具體是什麼**:
  --      「商品小計 0 + 運費 100 的單, 券要【拒掉】還是【允許折運費】?」
  -- ✅ **他答了:2026-08-31 19:5x 拍【甲:拒掉】** ——
  --    ⚠️ **來源屬性**:他本人在**哨兵視窗**打的字, 由哨兵 `-26`[72f94a] 逐字轉給本窗;
  --       **不是本窗第一手收到的**。⇒ 不要把這裡讀成「他對這個視窗說過」。
  --    ⇒ ⛔ ~~暫時的預設, 不是他的答案~~ ⇒ **現在的行為就是他拍的答案。**
  --    🔵 **兩條獨立路徑各轉一次, 而兩邊逐字一致**:哨兵 `-26`[72f94a] 與主視窗 `-24`[231383]
  --       各自轉了同一個「甲」, 且都附上同一份選項字面。⇒ 這一格不是單一來源。
  -- 🔵 而這一格誤傳的代價低:**甲 = 碼本來就在做的事** ⇒ 這則轉述沒有讓我【改變】任何行為,
  --    只讓我把註解從「暫時」改成「拍板」。⇒ **若他答的是乙(要改行為), 我會回頭要一次確認才動手。**
  --
  -- 🔵 以下是我原本那段查證, 保留 —— 它證明了那個拍板存在, 只是射程不到這裡:
  --    `20260825130000_m4b_zero_price_checkout_and_cart_total_gate.sql` 檔頭逐字:
  --      Sean 2026-08-25 拍【甲:修結帳那道閘的時候順手加一道「整車金額要大於 0」】
  --      ⇒ `create_order` 段 7:`v_total <= 0 ⇒ RAISE`
  --    ⇒ **一張 total = 0 的訂單【建不起來】** ⇒ 兌換模式(`p_order_id` 有值)**到不了這一格**。
  --    ⇒ 到得了的只有**試算**(車上只有 0 元贈品, 客人去試打一張券)——
  --      而那台車**本來就結不了帳**, 而 `below_min_spend` 對客人是正確且可行動的答案。
  --    ⇒ **不是新政策, 是把一個既有拍板的後果講出來。**
  -- ⚠️ 而 codex 的語意批評有一半是對的:券面 `min_spend = 0` 時這個理由**對內部**不精確。
  --    ⇒ 代價寫在這裡, 不藏:**封閉集沒有「金額為 0」這個值, 而我不發明第八個。**
  -- 🛑 **這一格仍然可以被推翻** —— 要一個專屬理由的話, 那要動封閉集(TS + SQL ENUM 兩側)。
  IF p_subtotal < greatest(v_c.min_spend, 1) THEN
    -- 🔴🔴 **R2-must-fix:`shortfall` 不回** —— `packages/domain/src/order/coupon.ts:84` 逐字
    --    「**今天預設不回**(plan §1-4):要不要把差額算給客人看 **Sean 還沒答**」。
    --    ⇒ 原版直接回了 ⇒ **SQL 這一側自己開啟了一個沒有人授權的行為**,
    --      而 TS 那一側的註解還寫著「不回」⇒ 兩份文件各自為真。
    -- 🛑 算式留在下面那行的註解裡, 他說要的時候一行就打開。不要重新發明。
    --    (打開的寫法:加回 'shortfall', v_c.min_spend - p_subtotal)
    RETURN jsonb_build_object('valid', false, 'reason', 'below_min_spend');
  END IF;

  -- 1e. 折抵金額。percent 四捨五入(片1 `:114`:與 `pricing.ts:53` 同一個做法, Sean 拍的)。
  -- 🔴🔴 **先轉 numeric 再乘**(codex must-fix):`p_subtotal * discount_value` 是 integer 乘法
  --    ⇒ 30,000,000 × 100 在**除以 100.0 之前就 overflow** ⇒ 兌換整個失敗。
  v_discount := v_calc;   -- 🔵 1c-1 已經算好了 —— **這裡不再算第二次**(見 1c-1 的理由)。
  -- 🔴🔴 **Sean 2026-08-31 拍【甲:最低折 1 元】**(片1 `:357-361` 的三選一)。
  --    他看到的題目與代價(主視窗 `-24` 端, 逐字):
  --      甲 最低折 1 元 —— 一行碼、不用改資料表、客人看到「-1 元」(推薦)
  --      乙 拒絕這張券 —— 客人拿到「不能用」而不知道為什麼
  --      丙 允許折 0 —— 🔴 要改資料表規則, 而且券被用掉卻一毛沒少
  -- 🔵 **而他選的甲, 正好是唯一不用動已 apply 的表的那一個** ——
  --    丙 要改片1 那張表的 `CHECK (discount_applied > 0)`(片1 `:358` 逐字點名)。
  -- ⛔ ~~舊版在這裡 `RAISE EXCEPTION`~~ —— 那是**佔位不是答案**, 現在有答案了。
  --
  -- 🛑 **先夾上限, 再抬下限, 而抬完不可能超過上限** —— 因為上面那道
  --    `p_subtotal >= greatest(min_spend, 1)` 保證了 `p_subtotal >= 1`。**不會出負數。**
  -- 🟢 收尾斷言:走到這裡的值必須落在 [1, p_subtotal]。
  --    這一格不是裝飾 —— 上面那兩行的正確性**依賴一個在別處的前提**(`p_subtotal >= 1`),
  --    而那個前提哪天被改掉時, **這裡是唯一會叫的地方**。
  IF v_discount < 1 OR v_discount > p_subtotal THEN
    RAISE EXCEPTION
      'redeem_coupon: 折抵 % 落在 [1, %] 之外 —— 上下限的前提被破壞了(code=%)',
      v_discount, p_subtotal, v_code;
  END IF;

  IF v_dry_run THEN
    RETURN jsonb_build_object('valid', true, 'discount_applied', v_discount,
                              'coupon_id', v_c.id);
  END IF;

  -- 1f. 寫 redemption。
  BEGIN
    INSERT INTO public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
    VALUES (v_c.id, p_order_id, p_user_id, v_discount);
  EXCEPTION WHEN unique_violation THEN
    -- 🔵 **這一格【不是】死碼**(R2 修完之後容易被讀成死碼):1c-2 已經先擋掉了看得見的那一種,
    --    而**併發**下, 別的交易可以在我檢查完之後、INSERT 之前插進那一列 ⇒ 只有這裡接得住。
    --    (`FOR UPDATE` 鎖的是【券】那一列, 不是【單】那一列 ⇒ 兩張不同券的併發撞不到同一把鎖。)
    -- 🔴 封閉集沒有對應的值 ⇒ **不發明第八個** —— 加值是一個決定, 不是補洞。
    RAISE EXCEPTION
      'redeem_coupon: 這張單已經有一列 redemption 而它不是這一張券(order_id=%)—— 封閉集沒有對應的拒絕理由, 需要拍板',
      p_order_id;
  END;

  RETURN jsonb_build_object('valid', true, 'discount_applied', v_discount,
                            'coupon_id', v_c.id);
END;
$function$;

-- ── coupon_redeem_order_problem(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.coupon_redeem_order_problem(p_order_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id)
      THEN 'not_found'
    -- 🔴🔴 **順序:失效的理由排在「沒付款」之前**(codex must-fix④):
    --    `not_paid` 排最前面的話, 一張**未付款而且已取消**的單會回 `not_paid`
    --    ⇒ 短碼失真, 讀 log 的人會去查付款而不是查取消。
    --    ⇒ 而 `partiallyRefunded` 這種付款狀態也會遮掉真正的退款原因。
    WHEN (SELECT o.cancelled_at FROM public.orders o WHERE o.id = p_order_id) IS NOT NULL
      THEN 'cancelled'
    -- 部分取消:它連 `cancelled_at` 都不寫(`20260820030000:668` 只在全數取消時 UPDATE)。
    WHEN EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)
      THEN 'partially_cancelled'
    -- 🔴🔴 **卡片退款帳:黑名單不是白名單**(codex must-fix①)。
    --    ⛔ ~~原本寫 `status <> 'failed'`~~ —— 那把 **`deferred` 也當成動了錢**,
    --      而 `deferred` 逐字是「10024 = **還不能做**」(`20260803150000:23`)⇒ 沒扣到款。
    --    🛑 而那個 CHECK **已經被加寬過**:`:186` 把三值改成
    --      `('processing','confirmed','failed','deferred')` —— 我讀的是建表時那一版。
    --    📌 **⇒ 又一次「引用的射程比它實際涵蓋的窄/寬一格」** —— 今天第二次。
    -- 🔵 **選黑名單是刻意的**:未來加的新狀態會【擋】而不是【放行】。
    --    在錢這一層, 對未知保守 = 客人再按一次;對未知放行 = 錢算錯。
    -- 🔴🔴 **要看【有效終局】不是原始 status**(codex R2)——
    --    `order_refund_manual_corrections`(`20260814190000:69`)可以把一筆退款
    --    人工更正成 `money_moved` / `no_money_moved`, 而那張表的 `:101` 逐字寫著
    --    **「corrected_to=money_moved 不會讓該筆退款變成 confirmed」**
    --    ⇒ 一筆 `failed` 而被更正成「錢其實有動」的退款, 只看 `status` 會**放行**。
    -- 🔵 **而那個領域自己已經有一支 view**:`order_refund_effective_verdict`
    --    (同檔, 每筆 refund 取 `seq` 最大的那次更正)⇒ **用它, 不自己重推。**
    -- 📌 **⇒ 我原本在寫一個「單一真相」, 而那個領域【已經有】一支** ——
    --    差別是它只答退款那一段, 而我要的是整張單。**用它的答案, 不重造它。**
    WHEN EXISTS (
      SELECT 1 FROM public.order_refunds r
      LEFT JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
      WHERE r.order_id = p_order_id
        AND CASE
              WHEN v.corrected_to = 'money_moved'    THEN true
              WHEN v.corrected_to = 'no_money_moved' THEN false
              -- 🔴 ⟦b4-TAPPAYDIRECT⟧ A2 2026-09-07 加 'voided'。
              --    這是**反面述詞**:加一個新狀態值, 它**預設把新值含進去**
              --    ⇒ 一筆補登錯了、已作廢、**錢其實沒退**的訂單, 仍然會被判成 'refunded'
              --    ⇒ `redeem_coupon` 拒絕兌券 ⇒ 📌 **客人的優惠券用不了。**
              --    🎯 我掃「哪些地方會【算】voided」時只掃了正面述詞(`status IN (...)`),
              --      而那一族加新值是**自動排除**;反面這一族是**自動包含**。兩族方向相反。
              ELSE r.status NOT IN ('failed', 'deferred', 'voided')
            END)
      THEN 'refunded'
    -- 人工退款帳。`voided_at` 有值 = 這筆退款被作廢 ⇒ 不算。
    WHEN EXISTS (SELECT 1 FROM public.order_manual_refunds m
                  WHERE m.order_id = p_order_id AND m.voided_at IS NULL)
      THEN 'manually_refunded'
    -- 🔴🔴 **第四本帳:`payment_refunds`**(codex must-fix②)——
    --    它**不直接連 orders**, 而是經 `payment_charge_attempts.order_id`
    --    (`20260810140000:75-77`)⇒ 只看那三張表會漏掉整條卡片退款鏈。
    -- 📌 **⇒ 這正是我在券那支檔頭寫的「打地鼠」的下一格**:我以為收成一個地方就收完了,
    --    而**收成一個地方只是讓下一格【改一個檔】, 不是讓它不存在。**
    -- 🔴🔴 **父列只代表【退款意圖】, 不代表錢動了**(codex R3 must-fix)。
    --    可執行的判準在 `payment_refund_effective_terminal.indicates_refund`
    --    (`20260812140000:308-341`)—— 而那支 view 自己就是 fail-closed 的
    --    (判不出來一律當「錢動過」;該檔 `:316-320` 逐字寫了為什麼不可以 COALESCE false)。
    WHEN EXISTS (
      SELECT 1 FROM public.payment_refunds pr
      JOIN public.payment_charge_attempts pa ON pa.id = pr.attempt_id
      JOIN public.payment_refund_effective_terminal et
        ON et.refund_id = pr.id AND et.indicates_refund IS TRUE
     WHERE pa.order_id = p_order_id)
      THEN 'payment_refunded'
    -- 🔴 **有父列而【沒有】有效終局 ⇒ 那是「不知道」, 不是「已退款」**(同上 must-fix)。
    --    ⇒ 擋, 而**短碼要說實話** —— 謊稱 `payment_refunded` 會讓讀 log 的人
    --      去查一筆不存在的退款。📌 **保守地擋, 與謊稱理由, 是兩件事。**
    -- 🔴🔴 **而「有終局且它說沒退錢」⇒ 那是【已判定】不是【不知道】⇒ 放行。**
    --    這一格是實測改的:我第一版寫成「有父列就回 unknown」⇒ 一筆人工判定
    --    `refunded=false` 的退款照樣被擋 ⇒ 與上面 `order_refunds` 那邊
    --    「更正成 `no_money_moved` ⇒ 放行」**兩套標準**。
    --    📌 **同一件事在兩張帳上要有同一個答案 —— 不然那不是保守, 是不一致。**
    WHEN EXISTS (
      SELECT 1 FROM public.payment_refunds pr
      JOIN public.payment_charge_attempts pa ON pa.id = pr.attempt_id
     WHERE pa.order_id = p_order_id
       AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et2
                        WHERE et2.refund_id = pr.id))
      THEN 'refund_unknown'
    -- 🔴🔴 **沖銷:比淨額, 不是「有沒有沖銷列」**(codex must-fix③)——
    --    ⛔ ~~原本只要有一列 `reverses_payment_id IS NOT NULL` 就永久擋~~
    --    ⇒ **沖銷之沖銷**(把錯誤的沖銷再沖回來)會讓收款恢復, 而那張單被永遠擋住。
    -- 🔵 而比淨額同時解掉原本那個 NULL 陷阱:卡刷不一定在這張表留列
    --    ⇒ 兩邊都是 NULL ⇒ `NULL < NULL` 是 NULL ⇒ **不成立 ⇒ 不誤擋**。
    WHEN (SELECT sum(amount) FROM public.order_payments WHERE order_id = p_order_id)
       < (SELECT sum(amount) FROM public.order_payments
           WHERE order_id = p_order_id AND reverses_payment_id IS NULL)
      THEN 'payment_reversed'
    -- 🔴🔴 **第五本帳:Dashboard 雙扣退款**(codex R2)——
    --    `payment_double_charge_anomalies`(`20260624120003`)有自己的 `old_order_id`
    --    ⇒ 一張因為雙扣而被退款的舊單, 前面四本帳可能一列都沒有。
    WHEN EXISTS (SELECT 1 FROM public.payment_double_charge_anomalies a
                  WHERE a.old_order_id = p_order_id)
      THEN 'double_charge_refunded'
    -- 付款軸放最後 —— 它是最常見而最不具體的理由。
    WHEN (SELECT o.payment_status::text FROM public.orders o WHERE o.id = p_order_id)
         IS DISTINCT FROM 'paid'
      THEN 'not_paid'
    ELSE NULL
  END;
$function$;

