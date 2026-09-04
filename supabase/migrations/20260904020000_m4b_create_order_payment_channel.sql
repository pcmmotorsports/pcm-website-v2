-- M-4b · 段 1-A:`create_order` 加 `p_payment_channel`(顧客站要能選匯款)
-- ============================================================
-- Sean 2026-09-04 拍板:「甲 要 —— 上線前一定要能匯款」+「客人自己就能選匯款下單」。
-- 而顧客站今天建的單**全部都是 tappay** —— 不論客人選什麼, 因為
-- `create_order` 的簽名裡沒有 `payment_channel`, 而 `orders.payment_channel` 是
-- `NOT NULL DEFAULT 'tappay'`。
--
-- ── 🔴🔴 這是【三步部署】的第一步, 而每一步單獨都安全 ──────────────────
--   A(本檔)CREATE 11 參數那支 ⇒ 兩支並存, 而**線上的 TS 送的名字裡沒有 `p_payment_channel`**
--          ⇒ 它精準命中舊那支 ⇒ **零影響**
--          ⚠️ 個數是浮動的:現行實際送 **9** 個名字, `coupon_code` 有值才 10(codex nit 訂正
--             我原本寫死的「10 個」)⇒ 🎯 **而路由靠的是【名字】不是個數。**
--   B      部署 TS:名字裡加上 `p_payment_channel` ⇒ 精準命中新那支 ⇒ **零影響**
--   C      另一支 migration:`DROP FUNCTION` 舊的 10 參數版 ⇒ 此時已無人呼叫
--   🎯 **⇒ 三步之間任何一個時刻都只有一個唯一解** —— 不是「零斷線的祈禱」, 是結構保證。
--
-- ── 🛑 而 `p_payment_channel` 【刻意不給 DEFAULT】, 那是承重的不是風格 ──────
--   🔬 **分辨器不是參數個數**(舊 8..10 / 新 9..11 ⇒ 中間重疊)——
--     **是【名字集合】**:舊那支沒有這個名字, 新那支它必填。**兩邊各自被一個必填的名字釘死。**
--   🔬 實測(PostgREST 14.16 + 拋棄式 PG 17.10;同形狀 = 兩支都帶兩個尾端 DEFAULT):
--     舊 4 名 ⇒ OLD · 舊 2 必填 ⇒ OLD · 新 5 名 ⇒ NEW · 新 3 必填 ⇒ NEW  ⇒ **四發全唯一**
--   🔴 **而給了 DEFAULT 會怎樣我也量了**:兩支都吃得下同一個名字集合 ⇒
--     `PGRST203 Could not choose the best candidate function between: …`
--   ⚠️ 而那一發**第一次我量錯**:我在 PostgREST 載完 schema 快取【之後】才加 DEFAULT
--     ⇒ 它讀舊快取 ⇒ 回一個「看起來沒事」的答案。**重建乾淨環境才叫。**
--     ⇒ 📌 一個「改了東西之後才量」的讀數, 與「世界一開始就長這樣」的讀數, 不是同一個東西。
--
-- ── ⚠️ 射程(照實寫)────────────────────────────────────────────────
--   上面兩發實測是 **PostgREST 14.16 + 本機 PG 17.10**;而正式站是 **Supabase 的版本**。
--   🛑 **「正式站也一樣」是【推的】, 不是量到的。**
--   ⛔ ~~「請 Sean 在正式站點一次結帳(不送出)」~~ **那一發是假綠**(codex must-fix)——
--     🔴 **「進結帳但不送出」根本沒有呼叫這支 RPC** ⇒ 它在【驗到了】與【沒驗】印同一個綠。
--     🎯 **⇒ 而那是我自己提的驗收方法。** 一個到不了目標世界的量測, 通過了也不算數。
--   ✅ **改成兩件, 而它們都真的碰得到那支 RPC**:
--     ① 貼完 A 之後 **`NOTIFY pgrst, 'reload schema';`** —— 否則 PostgREST 還用舊 schema cache,
--        而**那個舊 cache 會讓 B 上線後第一筆才炸 PGRST202**(問題出現在最壞的時點)。
--     ② 真的走一筆:**下一單(刷卡, 不帶 channel)成功** ⇒ 那才證明「舊那支還被找得到」。
--        🛑 而它要在【B 之前】做 —— B 之後送的是 11 個名字, 就驗不到這件事了。
--
-- ── 🔴 三步之間的【順序不可逆】, 而回退不是對稱的 ────────────────────────
--   ⛔ ~~「回退零風險」~~ **只在 B 之前成立**(codex must-fix):
--     · A 之後 B 之前 ⇒ DROP 新那支 ⇒ 線上照舊 ⇒ ✅ 真的零風險
--     · **B 之後**若直接 DROP 新那支 ⇒ 新 TS 仍送 11 個名字 ⇒ **PGRST202 接不住** ⇒ 結帳全掛
--       ⇒ ✅ **正確順序:先退 app、確認生效、再退 DB。**
--   🔴 **而 C(DROP 舊那支)也一樣**:一 DROP, 仍在途的舊部署 / app rollback 送 10 個名字
--     就沒有任何匹配 ⇒ ✅ **C 之前要有觀察期, 而「先恢復舊函式才能退 app」要寫在 C 那一支裡。**
--
-- ── 🔵 本檔是 `CREATE` 不是 `CREATE OR REPLACE` ────────────────────────
--   它是**新簽名** ⇒ `OR REPLACE` 對它沒有意義(它不會取代任何東西)。
--   ⛔ ~~「第二次貼會 `already exists`」~~ **實際上走不到那裡**(codex nit):
--     前置閘② 會先擋下並說「本檔已套用過, forward-only」⇒ ✅ **而那個訊息比 `already exists` 好**
--     (它說得出【為什麼】)。舊句留著劃掉, 免得下一個人以為閘沒作用。
--
-- ── 🔵 回退 ────────────────────────────────────────────────────────
--   `DROP FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text);`
--   🎯 **舊那支原封不動** ⇒ 回退之後線上立刻回到今天的行為 ⇒ **回退零風險**。
--
-- ── 🛑 本片【不做】什麼 ────────────────────────────────────────────
--   ✗ 不動舊那支(它一個 byte 都沒改)· ✗ 不動 TS · ✗ 不動 UI
--   ✗ 不 DROP 任何東西(那是步驟 C)
--   🔴 ✗ **不碰匯款的信**(那是段 4, 對外不可回收 ⇒ 鐵則 12⑤ 要單獨過審)
--   🔴 ✗ **不在這裡再寫一次「5 天」** —— 那個數字在 `PCM_REMITTANCE_EXPIRE_DAYS`
--     與 `20260903080000` 的 CASE, 而它們之間已經有一道跨語言的守門。
--
-- 🔴 **函式體是從正式庫 `pg_get_functiondef` 抽出來, 只改三處**(簽名 / 白名單 / INSERT)——
--    不是照 repo 檔手抄(repo 那份可能不是正式庫在跑的)。
--    ⛔ ~~「其餘 **380** 行逐 byte 未動」~~ **數錯了**(codex nit):舊函式體是 **381** 個實體行,
--    而 INSERT 那一處改動到 **2 行** ⇒ 可直接計數的未動行是 **379**。
--    ✅ 而「未動」今天有更硬的證據:**事後⑥ 的 prosrc 逐 byte 指紋**。
--    🔵 **位置參數的射程**(codex nit):唯一性**只成立於 PostgREST 的具名 JSON 路徑**;
--       直接用 SQL 以 9 個【位置】參數呼叫時兩支都套得上 DEFAULT ⇒ `function is not unique`。
--       ⇒ 🛑 **⇒ 任何人要在 psql 裡手動呼叫它, 一律用具名(`p_x => ...`)。**
-- ============================================================

BEGIN;

-- ── 1. 前置閘 ──
DO $pre$
DECLARE v_old_n integer; v_new_n integer; v_old_md5 text; v_old_len integer;
BEGIN
  SELECT count(*) FILTER (WHERE pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_payment_channel%'),
         count(*) FILTER (WHERE pg_get_function_identity_arguments(p.oid) LIKE '%p_payment_channel%')
    INTO v_old_n, v_new_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';

  IF v_old_n <> 1 THEN
    RAISE EXCEPTION '前置閘①:public.create_order 的【舊簽名】應有 1 支, 實得 % ⇒ 這不是我以為的那個世界, 拒繼續', v_old_n;
  END IF;

  -- 🔴🔴 **前置閘①b:舊那支的 prosrc 指紋**(codex must-fix)——
  --   ⛔ ~~只數「有 1 支舊簽名」~~ **不夠**:正式庫若在我 dump 之後被同簽名 hotfix 過,
  --     數量仍然是 1 ⇒ 這道閘照樣過 ⇒ 🛑 **而我會建一個【過時的副本】, 而 B 一上線就切到舊邏輯。**
  --   ✅ 而我的函式體是從那一份抽出來改三處的 ⇒ **它的指紋就是我這一片的前提**。
  --   🔬 量法:`SELECT md5(prosrc), length(prosrc) FROM pg_proc …`(唯讀正式庫, 2026-09-04)
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_old_md5, v_old_len
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text)');
  IF v_old_md5 <> 'a1f521268a77f741251759e11ef0c998' OR v_old_len <> 16391 THEN
    RAISE EXCEPTION '前置閘①b:舊那支的 prosrc 與我抽取時不符(md5=% len=%)⇒ 它被改過, 而我的副本是對著舊世界做的 ⇒ 拒繼續', v_old_md5, v_old_len;
  END IF;
  -- 🔴 forward-only:已經貼過就明講, 不要讓 `already exists` 那句去解釋它。
  IF v_new_n <> 0 THEN
    RAISE EXCEPTION '前置閘②:帶 p_payment_channel 的簽名已經存在(% 支)⇒ 本檔已套用過, forward-only 拒重跑', v_new_n;
  END IF;
END
$pre$;

-- ── 2. 新簽名 ──
CREATE FUNCTION public.create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_payment_channel text, p_notification_email text DEFAULT NULL::text, p_coupon_code text DEFAULT NULL::text)
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
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
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
        notification_email, payment_channel
      ) VALUES (
        v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
        v_subtotal::integer, v_shipping_fee, v_discount_total, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
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

-- ── 3. ACL:照舊那支的形狀給(它是 SECURITY DEFINER, 顧客站以 authenticated 呼叫)──
-- 🔴 **新物件出生就自帶權限** ⇒ 兩道 REVOKE 是物理擋不是慣例
--    (`docs/patterns/revoking-function-execute-in-supabase.md`:「兩道 REVOKE, 少一道都是開的」)。
-- 🔵 而**舊那支的實況我查過**:`proacl = postgres=X/postgres,authenticated=X/postgres`
--    · owner = postgres · secdef = true ⇒ 新的照它給, **不多不少**。
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text)
  FROM anon, authenticated, service_role;
-- 🔴 **為什麼不是 service_role**(`acl-drift-gate` 要求寫出「誰要用、為什麼不是 service_role」):
--   結帳跑在**使用者自己的 session** 裡 —— 這支是 `SECURITY DEFINER`, 而它靠 `auth.uid()`
--   認人(函式體 `v_uid := (select auth.uid())`, 而 `uid IS NULL ⇒ RAISE 未登入`)。
--   ⇒ 🛑 **改成 service_role 會讓 `auth.uid()` 變 NULL ⇒ 每一筆結帳都炸在「未登入」。**
--   🔬 而**舊那支的實況我查過**:`proacl = postgres=X/postgres,authenticated=X/postgres`
--     ⇒ 新簽名**照它給, 不多不少**(事後④ 白名單 + 事後⑤ 各驗一半)。
-- ACL-GATE-EXEMPT: public.create_order -- 顧客站以 authenticated 呼叫、SECDEF 靠 auth.uid 認人;鏡像舊簽名實測 ACL(20260904020000, 2026-09-04)
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text)
  TO authenticated;
ALTER FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text) OWNER TO postgres;

-- ── 3b. COMMENT(codex nit:新 overload 的 `obj_description` 會是 NULL ⇒
--        舊那支的說明沒有隨新入口帶過去)──
COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text) IS
  'M-3/M-4b 顧客站建單(11 參數版, 2026-09-04 段 1-A)。與 10 參數版**並存**, 三步部署的第三步會 DROP 舊的。'
  '🔴 p_payment_channel **必填、無 DEFAULT** —— 那是承重的:兩支靠【名字集合】各自被唯一命中, 而 DEFAULT 會讓同一個名字集合兩支都吃得下(實測 PGRST203)。'
  '🔵 白名單只收 tappay / bank_transfer;cash 是員工手動建單那條路的值、none 今天零寫入端。'
  '🛑 **回退不是對稱的**:部署 TS 之後直接 DROP 本支 ⇒ 新 TS 仍送 p_payment_channel ⇒ PGRST202 結帳全掛 ⇒ 先退 app 再退 DB。'
  '⚠️ 其餘行為與 10 參數版逐 byte 相同(從正式庫 prosrc 抽出只改三處;apply 當下有指紋斷言)。';

-- ── 4. 事後斷言(fail-closed;對不上就 RAISE, 整支回捲)──
DO $post$
DECLARE
  -- 🔴 清單那一行【必須自己一行】—— 靜態閘取清單的 awk 錨是 `^[[:space:]]*v_functions`。
  --    而它不是裝飾:下面就是吃它, 漏列一個 ⇒ 那個物件不會被檢查到。
  --    📌 收權斷言【只檢查你列出來的物件】:它防「忘記收權」, **不防「忘記列」**。
  v_functions text[] := ARRAY['public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text)']::text[];
  v_oid oid; v_extra text; v_acl text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '事後①:新簽名沒建成(簽名打錯?)⇒ 拒繼續';
  END IF;

  -- 🔴 舊那支必須【還在】—— 本片的整個安全性建立在「線上 TS 還命中得到它」
  IF pg_catalog.to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '事後②:舊的 10 參數簽名不見了 ⇒ 線上的 TS 會失去落點, 拒繼續';
  END IF;

  -- 🔴 SECDEF / owner / search_path 三件(沿 pcm_cron 那片的成例)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = v_oid AND p.proowner = 'postgres'::regrole
                    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '事後③:owner / SECURITY DEFINER / search_path 不符;拒繼續';
  END IF;

  -- 🔴 白名單, 不是黑名單:只准 authenticated 與 owner
  SELECT pg_catalog.string_agg(g.grantee, ', ') INTO v_extra
    FROM (SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
            FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) g
   -- 🔴 用 `proowner` 不用 `CURRENT_USER`(codex must-fix):若本檔以 `supabase_admin` 執行
   --    而 owner 是 postgres ⇒ **合法的 owner 會被判成多餘角色** ⇒ 整支誤回捲。
   WHERE g.grantee <> pg_catalog.pg_get_userbyid((SELECT p2.proowner FROM pg_catalog.pg_proc p2 WHERE p2.oid = v_oid))
     AND g.grantee <> 'authenticated';
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '事後④:EXECUTE 清單多出非預期角色(%)—— 只應有 authenticated;拒繼續', v_extra;
  END IF;

  SELECT pg_catalog.array_to_string(p.proacl, ',') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS NULL OR v_acl NOT LIKE '%authenticated=%' THEN
    RAISE EXCEPTION '事後⑤:authenticated 沒有 EXECUTE(收到 %)⇒ 顧客站會呼叫不到, 拒繼續', v_acl;
  END IF;

  -- 🔴🔴 **事後⑥:整個函式體的 prosrc 指紋**(codex 三條 must-fix 合起來的那一個修法)——
  --   ⛔ ~~原本是 `strpos(prosrc, '白名單的字面')`~~ **那把尺被字面打敗**:
  --     · 把 INSERT 改回**不寫** `payment_channel`(或硬寫 tappay)⇒ 六道斷言**全過**,
  --       而輸入 bank_transfer 最後仍存成 tappay
  --     · 把 guard 改成**永不成立**而保留同一個字串(例如條件前加一個恆假式)⇒ ⑥ **仍然通過**
  --   ⇒ 📌 **⇒ 字面在, 不等於那段碼在做事。**(這一片今晚第二次踩同一族:
  --     `20260903080000` 的事後② 也是被自己的註解打敗。)
  --   ✅ 改成逐 byte 指紋 ⇒ **函式體任何一個字元變了它就叫**。
  --   🔬 值是我自己算的:拋棄式 PG 套完本片 ⇒ md5 `8cb6104ecb8b462bbdd75e23246cf51a` / len 17499
  --     🟢 而同一台的**基準線**(套之前)= `a1f521268a77f741251759e11ef0c998` / 16391
  --        ⇒ **與正式庫逐字相同** ⇒ 那同時證明我 dump 的那一份是忠實的。
  --   ⚠️ **代價照實寫**:往後改本檔函式體一個字(連註解)⇒ 這道閘就叫, 而值要重算。**那是刻意的。**
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid)
       <> '8cb6104ecb8b462bbdd75e23246cf51a'
     OR (SELECT pg_catalog.length(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> 17499 THEN
    RAISE EXCEPTION '事後⑥:新函式的 prosrc 指紋不符 ⇒ 它不是我驗過的那一份, 拒繼續';
  END IF;
END
$post$;

COMMIT;
