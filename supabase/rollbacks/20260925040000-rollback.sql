SET LOCAL lock_timeout = '5s';
-- 20260925040000 退回:三處價格換回不讀品牌折扣的版本, 再拿掉 dealer_discounted_amount 與 dealer_discount_apply。
-- 換回的三支是【貼 E2 之前正式庫的現役定義】逐字(2026-09-25 唯讀取出):下架判斷、優惠券、稅、search_path 都是那一版。
-- 🔴 前台窗之後若以 E2 為底又改了這三樣(D1), 要先退 D1, 再跑這支;前置閘會擋(本體不是 E2 那一版就停)。
-- 退完之後, 經銷會員看到與付的都是沒有品牌折扣的經銷價;折扣設定本身留在 dealer_brand_discounts(要一起拿掉請再跑 20260925030000-rollback)。
-- 貼完手動跑 NOTIFY pgrst, 'reload schema'; 並跑 pcm_acl_approve_latest(p_note 帶 20260925040000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';


DO $pre$
DECLARE
  v_sp   text;
  v_vfp  text;
BEGIN
  -- 🔵 view 的指紋:pg_get_viewdef 會隨 search_path 決定要不要寫 schema ⇒ 固定成空字串量, 量完換回來
  --    (不另建暫存函式:同一連線連跑本檔與退回檔會撞名, Codex E2 R2)。
  v_sp := pg_catalog.current_setting('search_path');
  PERFORM pg_catalog.set_config('search_path', '', true);
  v_vfp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_list_dealer'::regclass, true));
  PERFORM pg_catalog.set_config('search_path', v_sp, true);
  IF pg_catalog.to_regprocedure('public.dealer_discounted_amount(uuid, uuid, integer)') IS NULL THEN
    RAISE EXCEPTION '退回前置閘:dealer_discounted_amount 不存在 ⇒ 可能沒貼過或已退過, 停。';
  END IF;
  -- 🔴 三個都要是 E2 寫出來的那一版(Codex E2 R1):任何一個被後來的 migration 換過 ⇒ 先退那一支
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure) IS DISTINCT FROM '77c7ab9cf4dc26404af6dbbe723a1d42' THEN
    RAISE EXCEPTION '退回前置閘:create_order 不是 E2 那一版(可能已被後來的 migration 換掉)⇒ 先退那一支, 停。';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM 'c316058adcad20679d7503b8b0967bb2' THEN
    RAISE EXCEPTION '退回前置閘:get_effective_prices 不是 E2 那一版 ⇒ 先退那一支, 停。';
  END IF;
  IF v_vfp IS DISTINCT FROM '42ddb5f87a1096361f42a6db13255918' THEN
    RAISE EXCEPTION '退回前置閘:products_list_dealer 不是 E2 那一版 ⇒ 先退那一支, 停。';
  END IF;
END
$pre$;

CREATE OR REPLACE VIEW public.products_list_dealer AS
SELECT
  v.id,
  v.title,
  v.subtitle,
  v.handle,
  v.brand_id,
  v.category_id,
  v.availability,
  v.fitments,
  -- 🔴 唯一與 products_list_public 不同的一格。基準款變體沒有經銷價 ⇒ 退回商品一般價(= 今天的行為)。
  coalesce(b.price_store, v.price_general) AS price_general,
  v.supplier_slug,
  v.card_image,
  v.fits,
  v.brand_name,
  v.brand_slug,
  v.category_raw,
  v.created_at
FROM public.products_list_public v
JOIN public.products pr ON pr.id = v.id
LEFT JOIN LATERAL (
  SELECT pv.price_store
    FROM public.product_variants pv
   WHERE pv.product_id = pr.id
   ORDER BY pv.price_general ASC NULLS LAST, pv.sku COLLATE "C" ASC
   LIMIT 1
) b ON true
-- 🔴 RLS policy `products_select_public` 的手抄本(本 view 繞過 RLS)。少了它 = 已下架商品外流。
WHERE pr.delisted_at IS NULL;

REVOKE ALL ON TABLE public.products_list_dealer FROM PUBLIC;
REVOKE ALL ON TABLE public.products_list_dealer FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_effective_prices(p_product_ids uuid[] DEFAULT NULL::uuid[], p_variant_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(kind text, id uuid, amount integer, currency text, tier text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tier   text := 'general';
  v_n_prod integer;
  v_n_var  integer;
  v_uid  uuid := auth.uid();
BEGIN
  -- 🔴 輸入上限:防有人一次要十萬個 id 把 definer 權限當成掃表工具。
  -- 🔴 兩個陣列**一起數** —— 分開數會讓「100 + 150」通過一個 200 的上限。
  -- 🔴🔴 `coalesce` 不加 `pg_catalog.` —— **我在同一支檔裡犯了第二次**, 而這次是
  --    【那道強化過的斷言自己抓到的】(它真的叫了一發 ⇒ 立刻紅、apply 失敗)。
  --    📌 上一次是靜態全過 / apply 成功 / 斷言也過, 只有拋棄式 PG 真的叫才紅;
  --      這一次**斷言就是那個叫的人** ⇒ 那次的補強在同一支檔上立刻收到回報。
  v_n_prod := coalesce(pg_catalog.cardinality(p_product_ids), 0);
  v_n_var  := coalesce(pg_catalog.cardinality(p_variant_ids), 0);
  IF v_n_prod + v_n_var = 0 THEN
    RETURN;
  END IF;
  -- 🔴🔴 **`array_length(a, 1)` 只量【第一維】** —— codex R1 must-fix ①:
  --    餵一個 2×200 的陣列, 第一維長度是 **2** ⇒ 上限形同虛設而實際查了 400 個 id。
  --    ✅ `cardinality()` 數的是**總元素數**;而多維陣列本身沒有正當用途 ⇒ 直接拒。
  IF p_product_ids IS NOT NULL AND pg_catalog.array_ndims(p_product_ids) <> 1 THEN
    RAISE EXCEPTION 'get_effective_prices:p_product_ids 只收一維陣列(收到 % 維)',
      pg_catalog.array_ndims(p_product_ids);
  END IF;
  IF p_variant_ids IS NOT NULL AND pg_catalog.array_ndims(p_variant_ids) <> 1 THEN
    RAISE EXCEPTION 'get_effective_prices:p_variant_ids 只收一維陣列(收到 % 維)',
      pg_catalog.array_ndims(p_variant_ids);
  END IF;
  IF v_n_prod + v_n_var > 200 THEN
    RAISE EXCEPTION 'get_effective_prices:一次最多 200 個 id(商品 % + 變體 % = %)',
      v_n_prod, v_n_var, v_n_prod + v_n_var;
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
  SELECT 'product'::text, p.id,
         CASE
           -- 🔴 2026-09-24 經銷價修正(docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md §3.4):
           --    經銷會員的商品價【不再讀 price_by_tier.store】—— 沒開灌價的供應商那一格是過期舊價
           --    (正式庫 2026-09-24 唯讀:1,086 件比一般價貴)。改讀【基準款變體】的 price_store,
           --    與結帳收錢的 create_order 同一欄;取不到退回一般價。
           --    基準款 = 一般價最低、同價 sku 最小(COLLATE "C" 對齊 rpm-transform.ts:448-452 的 JS 比較)。
           WHEN v_tier = 'store' THEN coalesce(
             (SELECT bv.price_store
                FROM public.product_variants bv
               WHERE bv.product_id = p.id
               ORDER BY bv.price_general ASC NULLS LAST, bv.sku COLLATE "C" ASC
               LIMIT 1),
             CASE WHEN (p.price_by_tier -> 'general' ->> 'amount') ~ '^[0-9]+$'
                  THEN (p.price_by_tier -> 'general' ->> 'amount')::integer END)
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
   WHERE p_product_ids IS NOT NULL
     AND p.id = ANY(p_product_ids)
     -- 🔵 下架的不回(與公開投影 `USING (delisted_at IS NULL)` 同一條線)。
     AND p.delisted_at IS NULL;

  -- ══ 變體那一半 ══════════════════════════════════════════════
  -- 🔴 **形狀與商品那一半【不同】, 而那不是我選的** —— `product_variants` 存的是
  --    **兩個整數欄** `price_general` / `price_store`(`20260531142533:31` 逐字),
  --    不是 `price_by_tier` jsonb。⇒ 這裡不能照抄上面那段 `->` 取值。
  -- 🔵 「取不到有效金額 ⇒ 退 general」兩半的**方向**一致(用 coalesce 的順序表達)。
  -- ⛔ ~~而我原本寫「規則兩半**一致**」~~ —— codex R2 推翻:**不一致**。
  --    商品半用 CASE + 正則(它要擋 jsonb 裡的非數字字串);變體半是整數欄, 沒有那個問題。
  --    而「兩價皆 NULL」那個世界**原本只有商品半會出聲** ⇒ 已補變體半的 WARNING(見下)。
  RETURN QUERY
  SELECT 'variant'::text, v.id,
         CASE
           WHEN v_tier = 'store' THEN coalesce(v.price_store, v.price_general)
           ELSE v.price_general
         END,
         'TWD'::text,
         v_tier
    FROM public.product_variants v
    -- 🔴🔴 **母商品下架 ⇒ 變體也不回**(codex R2 must-fix ①)。
    --    ⛔ 我原本只查 `v.id = ANY(...)` ⇒ 母商品下架時**商品半不回價而變體半照回**
    --      ⇒ 📌 **客人買得到一個已經下架的東西, 而畫面上完全正常。**
    --    🛑 而既有的 RLS 過濾**保護不了這條** —— `SECURITY DEFINER` 用 owner 的權限跑。
    JOIN public.products pp ON pp.id = v.product_id AND pp.delisted_at IS NULL
   WHERE p_variant_ids IS NOT NULL
     AND v.id = ANY(p_variant_ids);

  -- 🔴 變體那半的「連 general 都取不到」也要出聲(codex R2 must-fix ②)——
  --    ⛔ 下面那道 WARNING **只查 `products`, 接不到變體** ⇒ 變體兩價皆 NULL 會靜默回空金額。
  IF EXISTS (
    SELECT 1 FROM public.product_variants v
      JOIN public.products pp ON pp.id = v.product_id AND pp.delisted_at IS NULL
     WHERE p_variant_ids IS NOT NULL
       AND v.id = ANY(p_variant_ids)
       AND coalesce(CASE WHEN v_tier = 'store' THEN coalesce(v.price_store, v.price_general)
                         ELSE v.price_general END, -1) < 0
  ) THEN
    RAISE WARNING 'get_effective_prices:有【變體】連 general 都取不到有效金額 ⇒ 那一列的 amount 是 NULL。'
      '這是【資料壞了】不是【沒有折扣】, 要有人去看。';
  END IF;

  -- 🔴 ②那一層:上面那個 CASE 只在「連 general 也壞」時才會留下 NULL ⇒ 這裡把它變成【出聲】。
  --    🛑 分開寫而不寫進 CASE:CASE 裡 RAISE 不了, 而**回一個 NULL 然後假裝成功**正是本條要修的病。
  IF EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.id = ANY(p_product_ids)
       AND p.delisted_at IS NULL
       AND (p.price_by_tier -> 'general' ->> 'amount') !~ '^[0-9]+$'
       -- 🔴 2026-09-24:store 那一格改看基準款變體(與上面 RETURN QUERY 同一個來源), 不再看 price_by_tier.store。
       AND CASE WHEN v_tier = 'store'
                THEN (SELECT bv.price_store
                        FROM public.product_variants bv
                       WHERE bv.product_id = p.id
                       ORDER BY bv.price_general ASC NULLS LAST, bv.sku COLLATE "C" ASC
                       LIMIT 1) IS NULL
                ELSE (p.price_by_tier -> v_tier ->> 'amount') !~ '^[0-9]+$'
           END
  ) THEN
    RAISE WARNING 'get_effective_prices:有商品連 general 都取不到有效金額 ⇒ 那一列的 amount 是 NULL。'
      '這是【資料壞了】不是【沒有折扣】, 要有人去看。';
  END IF;
END;
$function$;

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
  -- ⟦b4-COUPONFIELD⟧ 片 D:券試算的結果與那張券的 id(id 要寫進 orders.coupon_id,
  --   否則 `orders_discount_needs_coupon` 會擋、而付款那一刻的扣券 trigger 也找不到要扣哪一張)。
  v_coupon_res     jsonb;
  v_coupon_id      uuid    := NULL;
  v_coupon_reason  text;
  -- 🔴 券被拒 ⇒ **不當場 RAISE**, 記下來、走完整支、在 RETURN 前一刻才拒(理由見券那一段)。
  v_coupon_rejected boolean := false;
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
    -- 🔴🔴 **本片解除 3a 的封鎖**(`20260907040000:492-521` 那一段 `RAISE EXCEPTION` 就是它)。
    --    3a 的檔頭逐字寫「3b 的第一件事就是把這一段換成那次試算呼叫」,而它要求帶回兩道前置閘 ——
    --    ✅ 那兩道在本檔頂端(redeem_coupon 存在 / 本函式 owner 對它有 EXECUTE)。
    --
    -- 🔴 **試算(p_order_id = NULL)不寫 redemption、不鎖列** —— 真正扣券在付款成功那一刻,
    --    由 `trg_coupon_redeem_on_paid` 拿 `orders.coupon_id` 去呼同一支(`20260901021000:589`)。
    --    ⇒ 📌 所以這裡**只問「這張券現在能不能用、折多少」**,而**同一張券的三道上限由那一刻的呼叫扣**。
    --    ⚠️ 中間那段時間(建單 → 付款)券可能被別人用完 ⇒ 付款那一刻會被拒,而那是既有設計
    --      (3a 檔頭逐字「限量券沒辦法先保留,兩個人同時結帳可能都成功」—— Sean 看過代價才選的)。
    --
    -- 🔴 `p_has_tier_price` = 這張單吃到經銷價沒有(tier <> general)。券的 `stacks_with_tier` 為 false 時
    --    會回 `tier_conflict` ⇒ 與扣券 trigger 的第四個引數逐字同一句(`20260901021000:587`),不自創第二種判準。
    v_coupon_res := public.redeem_coupon(
      pg_catalog.btrim(p_coupon_code),
      v_uid,
      v_subtotal::integer,
      v_tier <> 'general'::public.member_tier,
      NULL
    );
    -- 🔵 每一次帶券嘗試都留一行(不管成敗)—— 下面那道天花板堵不住, 至少看得到有沒有人在掃(Sean 2026-09-15 裁乙)。
    RAISE LOG 'create_order: 帶券嘗試 valid=% user=%', coalesce(v_coupon_res->>'valid', 'null'), v_uid;
    IF v_coupon_res IS NULL OR NOT coalesce((v_coupon_res->>'valid')::boolean, false) THEN
      v_coupon_reason := coalesce(v_coupon_res->>'reason', 'unknown');
      -- 🔴🔴 **被拒的理由【一律】收斂成 `unavailable`, 一個都不細分。**
      --
      -- ⛔ ~~原本只收斂 not_found / inactive / exhausted 三種, 其餘四種照講~~ ——
      --    那是 2026-09-14 跨片審查抓到的 high:**「回得到細分理由」本身就是存在性 oracle**。
      --    `redeem_coupon` 的七種理由裡, expired(`20260831160000:275`)/ tier_conflict(`:279`)/
      --    already_used_by_account(`:289`)/ below_min_spend(`:344`)**全部排在 `:212` 查無那一關之後**
      --    ⇒ 回得到其中任何一種, 就等於告訴對方「這個券碼真的存在」。
      --    ⇒ 而 `create_order` 對 `authenticated` 開著 EXECUTE ⇒ 登入者直打 `/rpc/create_order`
      --      就能用回應差異把有效券碼掃出來, 一行 log 都不留。
      -- 🎯 **⇒ 收斂的是【全部】, 不是三分之一。** 細分理由只進 server log(客人看不到)。
      -- 🔵 **唯一的例外是 `zero_total_unsupported`**(見下)。
      --
      -- 🔴🔴 **而且【不在這裡 RAISE】**(codex R3 must-fix, 2026-09-14):
      --    ⛔ ~~當場 RAISE P2C20~~ ⇒ 被拒的券停在這裡, 有效的券繼續往下走 ⇒ 呼叫端只要**故意讓後段炸**
      --    (例:送一個不存在的 `p_terms_version` ⇒ `order_legal_consents` 外鍵 23503),
      --    就能用「回 P2C20 還是回 23503」分辨券碼能不能用 —— 兩邊都失敗、都回捲、一張單都不留。
      -- 🎯 ⇒ 被拒只記旗標、折抵當 0 繼續走, **在 RETURN 前一刻**才 RAISE(整筆回捲)。
      --    ⇒ 後段任何一種錯, 有效券與無效券走到的是**同一個錯**。
      -- 🛑 ponytail: 這只堵住「錯誤碼不同」, 堵不住「錯誤內容不同」—— 有效券的折抵在 INSERT 之前就算進金額,
      --    ⇒ 故意造錯仍分得出來(codex R4 兩條 must-fix, 拋棄式 PG 實跑確認第一條):
      --      · `p_notification_email = 'bad'` ⇒ 兩邊都 23514, 而 DETAIL「Failing row contains(…)」帶整列
      --        (有效券 discount 100 / total 4140 / coupon_id;查無券 0 / 4240 / null)⇒ 連券 id 都拿得到。
      --      · 溢位訊息帶 total 數字 ⇒ 兩邊都炸而數字不同。
      --    📌 **Sean 2026-09-15 裁乙:收在這裡**(已知風險:今天唯一一張券 REVIEW100 是公開碼)。
      --    升級路 = 甲案:券不在 INSERT 前碰金額 —— 先照沒帶券那條路建單, 最後才試算再 UPDATE 折抵 / 稅 / total。
      RAISE LOG 'create_order: 券被拒(對外一律收斂為 unavailable)reason=% user=%', v_coupon_reason, v_uid;
      v_coupon_rejected := true;
      v_discount_total := 0;
    ELSE
    v_discount_total := coalesce((v_coupon_res->>'discount_applied')::integer, 0);
    v_coupon_id := (v_coupon_res->>'coupon_id')::uuid;
    -- 🛑 券說有效卻沒給 id / 沒給折抵 ⇒ 不猜、直接停:
    --    `orders_discount_needs_coupon` 逐字 `(discount_total > 0) = (coupon_id IS NOT NULL)`,
    --    少一邊就是一張「折了錢而不知道折的是哪張券」的單。
    -- 🔵 試算結果只進 log, 不進對外訊息(codex R3 補核:原本 `(%)` 原樣帶出 v_coupon_res)。
    IF v_coupon_id IS NULL OR v_discount_total <= 0 THEN
      RAISE LOG 'create_order: 券試算回了 valid 但缺欄位 res=%', v_coupon_res;
      RAISE EXCEPTION 'create_order: 券試算回了 valid 但缺 coupon_id/discount_applied';
    END IF;
    -- 🔴🔴 **全額折抵那一格**(codex R1 must-fix ②):折抵上限 = 小計, 所以折完 total = 運費;
    --    而門市自取 / 滿額免運時運費 = 0 ⇒ `total = 0` ⇒ 撞下面既有的零元閘, 客人**結不了帳**,
    --    而那句話對他是誤導的(「請稍後再試」再試一百次都不會成功)。
    -- 🛑 **這一片不打開零元結帳** —— 那要動結清 / 付款 / 寄信三條路(`settle_zero_total_order` 那一包),
    --    是另一片、另一輪審。這裡做的是**把它變成一句講得清楚的拒絕**, 而且理由帶得出去。
    -- ⚠️ 天花板寫在這裡:今天的券是 100 元定額(Sean 09-14 建的那張), 小計 >= 100 就走不到這一格;
    --    真要讓「整筆折到 0」結得掉, 開那一片。
    -- 🔴 用【上面第 7 段已經算好的】`v_shipping_fee`(它看的是**折前**小計)——
    --    ⛔ ~~自己再算一次(而且用折後小計)~~ 是 R2 must-fix ①:小計 5000 折 5000 的宅配單
    --    真運費 = 0(折前 >= 5000 免運)而重算版得 100 ⇒ 漏接 ⇒ 客人又掉回通用「請稍後再試」。
    --    📌 同一個數字算兩次就是兩份真相, 而漂掉的那一次不會有人發現。
    -- ⚠️ **這一句【確實】證明「這張券對這一車可用」**(codex R3 important)—— 產品上接受:
    --    它只在「可用 + 折到 0」時出現, 不揭露過期 / 停用 / 用完那些不可用的券;
    --    而不講會讓客人卡在「請稍後再試」(他需要知道的是拿掉券或多買一件)。
    IF v_subtotal - v_discount_total + v_shipping_fee <= 0 THEN
      RAISE EXCEPTION 'create_order: 這張券會把整筆金額折到 0, 目前不支援零元結帳'
        USING ERRCODE = 'P2C20', DETAIL = 'coupon_rejected:zero_total_unsupported';
    END IF;
    END IF;
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
  IF v_tax > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 稅額溢位(tax=%)', v_tax;
  END IF;
  -- #953 P2(20260915060000):總額等式只住 public.pcm_order_total()(20260915030000), 這裡不再寫第二份。
  --   v_shipping_fee / v_discount_total 本來就是 integer;v_subtotal 在累加時已逐筆擋過 int 上限(上面「訂單小計溢位」那道),
  --   v_tax 上面那道剛擋過 ⇒ 這裡 ::integer 不會炸。
  v_total := public.pcm_order_total(v_subtotal::integer, v_shipping_fee, v_discount_total, v_tax::integer);
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
        notification_email, payment_channel,
        -- ⟦b4-COUPONFIELD⟧ 片 D:沒帶券 ⇒ NULL(而 discount_total 也是 0 ⇒ 過 orders_discount_needs_coupon)。
        coupon_id
      ) VALUES (
        -- ⛔ ~~`'general'::public.member_tier` 寫死~~ ⇒ 🔴 B2c:寫【他真正的】等級。
        --   📌 這一格是**單據上唯一記得「這張單當時用哪一層價」的地方** —— 寫死 general
        --     等於把經銷單偽裝成一般單, 而退款/發票/對帳都會照它走。
        v_display_id, v_uid, p_address_id, v_addr_snapshot, v_tier,
        v_subtotal::integer, v_shipping_fee, v_discount_total, v_tax::integer, v_price_tax_mode, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
        p_notification_email, p_payment_channel,
        v_coupon_id
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
  -- 🔴 ⟦b4-COUPONFIELD⟧ 片 D:被拒的券**在這裡**才拒 —— 前面每一道閘、每一個 INSERT 都走過了,
  --    ⇒ 後段能炸的都炸過了, 走到這一行的無效券與有效券已經分不出來。整筆回捲, 一列都不留。
  IF v_coupon_rejected THEN
    RAISE EXCEPTION 'create_order: 優惠券不能用'
      USING ERRCODE = 'P2C20',
            DETAIL = 'coupon_rejected:unavailable';
  END IF;
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$function$;

DROP FUNCTION public.dealer_discounted_amount(uuid, uuid, integer);
DROP FUNCTION public.dealer_discount_apply(integer, numeric);

DO $post$
DECLARE
  v_sp   text;
  v_vfp  text;
BEGIN
  -- 🔵 view 的指紋:pg_get_viewdef 會隨 search_path 決定要不要寫 schema ⇒ 固定成空字串量, 量完換回來
  --    (不另建暫存函式:同一連線連跑本檔與退回檔會撞名, Codex E2 R2)。
  v_sp := pg_catalog.current_setting('search_path');
  PERFORM pg_catalog.set_config('search_path', '', true);
  v_vfp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_list_dealer'::regclass, true));
  PERFORM pg_catalog.set_config('search_path', v_sp, true);
  IF pg_catalog.to_regprocedure('public.dealer_discounted_amount(uuid, uuid, integer)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.dealer_discount_apply(integer, numeric)') IS NOT NULL
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure) IS DISTINCT FROM '53f803ed322abf33bf1bc31beae7b982'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM 'cc73a38bf5775da7b402c9c1c9fad140'
     OR v_vfp IS DISTINCT FROM '684c5b40c960bdc1a690d33b90add602' THEN
    RAISE EXCEPTION '退回事後閘:沒有換回 E2 之前那一版 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ 20260925040000 已退回。';
END
$post$;

COMMIT;
