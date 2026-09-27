-- 20260928230000_m4b_sale_price_read_paths.sql —— 商品頁乙 P10(P-M4):所有讀一般價的資料庫出口改成「實際一般價」,並在下單時核對單價
-- pcm:idempotent: no
--   ↑ 前置閘比對四樣現役的指紋(create_order、get_effective_prices、三個 view);貼過之後指紋就變了,重跑會被前置閘擋下。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第八節(P-M4、片 P10);讀價出口清單:~/pcm-mailbox/盤點-讀一般價的出口-20260928.md
-- 🔴 前置:P-M1(20260928200000:特價欄 + pcm_effective_general_price)必須已貼。
--
-- ══ 為什麼 ══════════════════════════════════════════
-- 特價存在規格表 sale_price_general(P-M1)。客人付的一般價 = pcm_effective_general_price(一般價, 特價)。
-- 顯示和收錢要在【同一個交易】一起換(計畫 R1-7),否則會出現「畫面顯示特價、結帳收原價」或反過來。
-- 這支貼上後,因為還沒有人能設特價(後台入口 P14 最後才開),顯示和收錢都和今天一樣,只多了單價核對。
--
-- ══ 做什麼(一個交易)══════════════════════════════════
-- ① get_effective_prices:一般會員的商品價 = 代表款的實際一般價;規格價 = 實際一般價。經銷那一半不動(Q-P2 乙)。
-- ② create_order:
--    · 兩處 SELECT … INTO v_variant 補 sale_price_general。
--    · 一般會員單價 = pcm_effective_general_price(price_general, sale_price_general);經銷分支不動。
--    · 每一行有帶 expected_unit_price(不是 JSON null)就比對,不同 ⇒ ERRCODE P2C21、DETAIL price_changed,不建單;
--      沒帶就不比對(前台 P11 上線、連續三天確認都有帶之後,P-M5 才改成沒帶就拒絕)。格式不對(不是 0–999999999 的整數)⇒ 拒絕。
-- ③ products_public / products_list_public / product_variants_public:price_general 改成實際一般價,最後加 original_price。
-- ④ 權限:anon、authenticated 可以讀規格表的 sale_price_general 欄、可以執行 pcm_effective_general_price
--    (三個 view 是 security_invoker,以查詢者的身分讀規格表、叫函式)。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 只換函式和 view,不鎖表;換 create_order 的那一刻正在建的單會等它。避開客人多的時段。
-- · 前台要等 P11(下單帶 expected_unit_price)與 P12(顯示特價)才會用到新欄;先貼這支不影響現在的前台。
-- · 退回:supabase/rollbacks/20260928230000-rollback.sql —— 只退 view 和 get_effective_prices;
--   create_order 的單價核對【不退】(計畫第八節第 5 節、R5-1):沒有特價時它的行為和原本一樣,只多了核對。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘:現役必須是本檔依據的版本 ──
DO $gate$
DECLARE
  v_sp text := pg_catalog.current_setting('search_path');
  v_pp text; v_lp text; v_vp text; v_dp text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '', true);
  v_pp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_public'::regclass, true));
  v_lp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_list_public'::regclass, true));
  v_vp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.product_variants_public'::regclass, true));
  v_dp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_list_dealer'::regclass, true));
  PERFORM pg_catalog.set_config('search_path', v_sp, true);
  IF pg_catalog.to_regprocedure('public.pcm_effective_general_price(integer, integer)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                     WHERE attrelid = 'public.product_variants'::regclass AND attname = 'sale_price_general' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘①:P-M1(20260928200000)還沒貼 ⇒ 停。';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'create_order' AND p.pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION '前置閘②:create_order 不是剛好一支(可能有舊多載)⇒ 停。';
  END IF;
  -- 正式庫 2026-09-28 唯讀實查的現役指紋(= 20260926100000 的 create_order、20260925050000 的 get_effective_prices、
  -- 20260927040000 的兩個 view、20260602135934 的規格 view、20260925050000 的經銷 view)
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure) IS DISTINCT FROM '3c742288d7c733fc73d113f18e9a4a3a'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM 'c40796dbfc8c46a9592ea8ca7bf1701d'
     OR v_pp IS DISTINCT FROM '6ede47501cd538ae12ffb47b1c165baa'
     OR v_lp IS DISTINCT FROM '1ab986467f6a5dcb2f5bf4d884f38fa8'
     OR v_vp IS DISTINCT FROM '2a075a1e6819554553be377f237dbca4'
     OR v_dp IS DISTINCT FROM 'f45a37de325ecd907c3713401c61d14a' THEN
    RAISE EXCEPTION '前置閘③:create_order / get_effective_prices / 四個 view 有一樣不是本檔依據的版本 ⇒ 有人改過或這支已經貼過;停,重新以現役為底。';
  END IF;
  -- CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 屬性也要一樣(同 20260925050000 前置閘③)
  IF (SELECT p.prosecdef::text || '|' || pg_catalog.array_to_string(p.proconfig, ',') || '|' || p.provolatile::text
        FROM pg_catalog.pg_proc p WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure) IS DISTINCT FROM 'true|search_path=""|v'
     OR (SELECT p.prosecdef::text || '|' || pg_catalog.array_to_string(p.proconfig, ',') || '|' || p.provolatile::text
        FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM 'true|search_path=""|s' THEN
    RAISE EXCEPTION '前置閘④:create_order / get_effective_prices 的屬性與預期不同 ⇒ 有人用 ALTER 改過,停。';
  END IF;
END
$gate$;

-- ── 1. get_effective_prices ──
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
  -- ✅ 處置分兩層:①那個 tier 取不到有效金額 ⇒ ~~退回 general~~ D1 起 store 回 NULL(不能買),其他 tier 仍退回 general
  --              ②連 general 都取不到 ⇒ **RAISE** —— 那是資料壞了, 要有人知道。
  RETURN QUERY
  SELECT 'product'::text, p.id,
         CASE
           -- 🔴 2026-09-24 經銷價修正(docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md §3.4):
           --    經銷會員的商品價【不再讀 price_by_tier.store】—— 沒開灌價的供應商那一格是過期舊價
           --    (正式庫 2026-09-24 唯讀:1,086 件比一般價貴)。改讀【基準款變體】的 price_store,
           --    與結帳收錢的 create_order 同一欄;~~取不到退回一般價~~ D1 起取不到回 NULL。
           --    基準款 = 一般價最低、同價 sku 最小(COLLATE "C" 對齊 rpm-transform.ts:448-452 的 JS 比較)。
           -- 🔴 20260925040000(§10.3):再套品牌額外折扣, 與目錄、結帳同一支 dealer_discounted_amount。
           -- 🔴 20260925050000(B2B D1,Sean Q3 甲):缺經銷價 ⇒ NULL(畫面「價格暫時無法取得」、不能買),不再退回一般價。
           WHEN v_tier = 'store' THEN public.dealer_discounted_amount(v_uid, p.brand_id,
             (SELECT bv.price_store
                FROM public.product_variants bv
               WHERE bv.product_id = p.id
               ORDER BY bv.price_general ASC NULLS LAST, bv.sku COLLATE "C" ASC
               LIMIT 1))
           -- 🔴 20260928230000(商品頁乙 P-M4):與 products_public / products_list_public 同一條規則 ——
           --    有任何規格設了特價、或有任何規格一般價是空的 ⇒ 代表款的【實際一般價】(最低那一款、空值排最後、
           --    同價取 sku COLLATE "C" 最小;全部空 ⇒ NULL,不拿商品層價格頂上,計畫 R6-1);其餘 ⇒ 照舊讀 price_by_tier(和今天一樣)。
           --    經銷那一半(上面)不看特價(Q-P2 乙)。
           WHEN EXISTS (SELECT 1 FROM public.product_variants sv
                         WHERE sv.product_id = p.id AND (sv.sale_price_general IS NOT NULL OR sv.price_general IS NULL))
             THEN (SELECT public.pcm_effective_general_price(rv.price_general, rv.sale_price_general)
                     FROM public.product_variants rv
                    WHERE rv.product_id = p.id
                    ORDER BY 1 ASC NULLS LAST, rv.sku COLLATE "C" ASC
                    LIMIT 1)
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
           -- 🔴 20260925040000(§10.3):品牌取【母商品】的 brand_id(變體沒有自己的品牌)。
           WHEN v_tier = 'store' THEN public.dealer_discounted_amount(v_uid, pp.brand_id, v.price_store) -- 20260925050000 D1:缺經銷價 ⇒ NULL
           ELSE public.pcm_effective_general_price(v.price_general, v.sale_price_general) -- 20260928230000:含特價
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

-- ── 2. create_order ──
CREATE OR REPLACE FUNCTION public.create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_payment_channel text, p_notification_email text DEFAULT NULL::text, p_coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid            uuid := (select auth.uid());
  -- 20260926100000:停用的會員不能建單
  v_disabled_at    timestamptz;
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
  v_site           text;  -- 20260925050000 B2B D1:建單請求來自哪個站(網站 server client 的 x-pcm-site 標頭)
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
  -- 🔴 20260925040000(B2B 計畫 §10.3, Codex 計畫 R1/R2):讀等級這一步【搬到下面 1b 那把 advisory lock 之後】,
  --    並用 FOR SHARE 鎖住客人這一列到交易結束。後台存品牌折扣(admin_dealer_brand_discounts_save)與改等級
  --    (admin_set_customer_tier)都要 FOR UPDATE 同一列 ⇒ 兩邊排成一先一後, 一張單裡每一件都用同一版折扣與等級。

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

  -- ── 0aa(20260925040000 起搬到這裡). 🔴🔴 B2c:先問【他是誰】—— 取價、稅、品牌折扣都掛在這個答案上 ──
  --   🛑 **查不到就停, 不得退成 general** —— 退成 general 的後果是**一位經銷商用一般價買走**。
  --   🔴 FOR SHARE:鎖到交易結束, 期間後台改不了這位客人的等級與品牌折扣(見上面 0aa 原位置的說明)。
  SELECT c.tier, c.disabled_at INTO v_tier, v_disabled_at FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'create_order: 查不到 customers.tier(user=%)⇒ 不得以一般價結帳', v_uid;
  END IF;
  -- 20260926100000:停用的會員不能建單。FOR SHARE 與 admin_disable_customer 的 FOR UPDATE 互斥 ⇒ 兩者一先一後,
  --   不會「先讀到沒停用、停用提交、再建出一張單」。網站在建單前已先擋, 這裡擋的是直接拿權杖呼叫資料庫的情況。
  IF v_disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'create_order: pcm_customer_disabled(帳號已停用, user=%)', v_uid USING ERRCODE = '42501';
  END IF;
  IF v_tier = 'store'::public.member_tier THEN
    v_price_tax_mode := 'exclusive';
  END IF;

  -- ── 0ab(20260925050000,B2B D1,主視窗 2026-09-25 裁甲). 依站別擋,用上面鎖住的同一個 v_tier ──
  --   網站 L4 在 placeOrder 之前已擋過一次;這一段關的是「那次檢查之後、這裡讀等級之前,員工改了等級」的空窗。
  --   站別來自網站 server client 的 `x-pcm-site` 標頭(PostgREST 放進 request.headers,鍵名小寫)。
  --   沒有這個標頭(直接呼叫、舊程式)⇒ 不判斷:直接呼叫可偽造標頭,屬計畫 F0 已知風險。
  --   JSON 壞掉就讓它報錯(不吞成「沒標頭」);值不是 retail / b2b ⇒ 拒絕。
  v_site := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-pcm-site';
  -- 記錄只寫受控值(Codex D1 R1 建議:標頭原文可能是任意字串,不進 log)
  RAISE LOG 'create_order: site=% tier=%',
    CASE WHEN v_site IS NULL THEN 'missing' WHEN v_site IN ('retail', 'b2b') THEN v_site ELSE 'invalid' END, v_tier;
  IF v_site IS NOT NULL THEN
    IF v_site NOT IN ('retail', 'b2b') THEN
      RAISE EXCEPTION 'create_order: 站別標頭值非法(pcm_wrong_site)';
    ELSIF v_site = 'b2b' AND v_tier <> 'store'::public.member_tier THEN
      RAISE EXCEPTION 'create_order: 經銷站只收經銷會員(pcm_wrong_site)';
    ELSIF v_site = 'retail' AND v_tier = 'store'::public.member_tier THEN
      RAISE EXCEPTION 'create_order: 一般站不收經銷會員(pcm_wrong_site)';
    END IF;
  END IF;

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
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.sale_price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability, p.brand_id
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.sale_price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability, p.brand_id
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
      -- 🔴 20260925040000(§10.3):單價 = round(經銷價 × (100 − 品牌折扣%) ÷ 100), 先四捨五入再乘數量(下面 v_line_total)。
      --    品牌折扣不寫進 discount_total(那是優惠券的), 免運門檻看的是折後小計(Sean 2026-09-25 拍板)。
      -- 🔴 20260925050000(B2B D1,Sean Q3 甲):缺經銷價 ⇒ 單價 NULL ⇒ 下面「變體無有效單價」拒絕建單,不再改收一般價。
      v_unit_price := public.dealer_discounted_amount(v_uid, v_variant.brand_id, v_variant.price_store);
    ELSE
      -- 🔴 20260928230000(商品頁乙 P-M4):一般會員收【實際一般價】= 一般價與特價取較低;一般價空 ⇒ 空(下面擋單)。
      --    一律呼叫共用函式,不自己取較小值(LEAST 會略過空值,一般價空時會回特價,計畫 R6-1)。經銷分支不吃特價(Q-P2 乙)。
      v_unit_price := public.pcm_effective_general_price(v_variant.price_general, v_variant.sale_price_general);
    END IF;
    -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個
    --   「送」/ 試用品)⇒ 這道閘原本把贈品判成「無有效價格」而擋在結帳。
    --   ⚠️ **`IS NULL` 那半一個字都沒動** —— 它擋的是「查不到價格」, 與「0 元」是兩件事。
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      -- ⛔ ~~訊息原本寫死 `price_general`~~ ⇒ B2c 之後這條路也可能是 `price_store`
      --   ⇒ 一句寫死的欄位名會讓讀 log 的人去查錯的那一欄。
      RAISE EXCEPTION 'create_order: 變體無有效單價(tier=%, variant=%)', v_tier, v_variant.id;
    END IF;

    -- 🔴 20260928230000(商品頁乙 P-M4,計畫 R1-6、R2-1):下單時核對單價。
    --    前台送「畫面上顯示的單價」expected_unit_price,只拿來比對、不當價格。和算出來的單價不同 ⇒ 不建單,
    --    前台請客人確認新金額後再送。比單價不比總額:總額還含運費、優惠券、經銷刷卡的稅,兩邊公式不一定同一套。
    --    這一代【沒帶就不比對】(前台 P11 還沒上線);P-M5 才改成沒帶就拒絕。「有帶」看的是值不是 JSON null:
    --    0 元贈品是合法單價(上面 `< 0` 那道),所以不能用真假值判斷。
    IF v_line ? 'expected_unit_price' AND pg_catalog.jsonb_typeof(v_line -> 'expected_unit_price') <> 'null' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'expected_unit_price') <> 'number'
         OR (v_line ->> 'expected_unit_price') !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'create_order: expected_unit_price 格式不對(variant=%)', v_variant.id;
      END IF;
      IF (v_line ->> 'expected_unit_price')::integer <> v_unit_price THEN
        RAISE EXCEPTION 'create_order: 單價已變更(variant=%, 畫面=%, 現在=%)', v_variant.id, v_line ->> 'expected_unit_price', v_unit_price
          USING ERRCODE = 'P2C21',
                DETAIL = 'price_changed';
      END IF;
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

-- ── 3. 三個前台 view:價格欄改成實際一般價,最後加「原價」欄 ──
-- 🔴 只用 CREATE OR REPLACE VIEW、新欄只加在最後:products_list_dealer 讀 products_list_public(20260925050000:76),
--    DROP VIEW 會被它擋住,加 CASCADE 會把經銷目錄一起刪掉。其餘欄逐字照抄 20260927040000 / 20260602135934。
-- 🔵 price_general 欄名、型別(integer)、位置都不變,所以前台與型錄 RPC(search_catalog_by_vehicle 讀 products_list_public 排序、算區間)自動改用實際價。
-- 🔵 商品價:有任何規格設了特價,或有任何規格一般價是空的 ⇒ 代表款的實際一般價(全部空 ⇒ NULL,計畫 R6-1);
--    其餘 ⇒ 照舊用商品層 price_general(同步寫的基準款價格,和今天一模一樣)。
--    🔴 「一般價空」也要走代表款(Codex R1 必修):規格全部空價、沒有特價時,商品層還留著舊價,
--       只看特價的話三個出口會把舊價頂上來(結帳本來就擋,但畫面會顯示一個買不到的價格)。
--       正式庫 2026-09-28 唯讀:一般價空的規格 0 筆;加上這個條件後同一個量法 65 ms。
--    🔴 為什麼不是每件商品都從規格表重算(計畫 R1-4 原本的寫法):正式庫 2026-09-28 唯讀量測,全部上架商品讀一次
--       今天 83 ms,每件都用 LATERAL 重算要 310 ms(還沒算函式呼叫,拋棄式庫量到每次約 1 µs,6.3 萬個規格 × 2 次),
--       計畫說變慢明顯就停、不自己加索引。改成只算有特價(或空價,見下)的商品:同一個量法 63–65 ms。
--       仍然每次直接讀規格表(同步把規格搬到別的商品,下一次讀就算在新商品上),沒有存起來的標記(R5-2 的用意不變)。
--    🔵 附帶效果:正式庫有 3 件上架中的 DBK 商品(CC02、CC03、CCDV17)商品層價格比最便宜的規格貴,
--       沒有特價就維持今天的卡片價,不會因為這支改變。
-- 🔵 original_price = 代表款的一般價,只在它的特價正在生效時有值;沒有特價 ⇒ NULL。
-- 🔵 完全沒有規格的商品(正式庫 2026-09-28 唯讀:708 件、上架中 0 件)不在上面那個集合裡 ⇒ 照舊用商品層 price_general(計畫 R7-1)。
-- 🔵 不重下 GRANT:CREATE OR REPLACE VIEW 保留既有 ACL(同 20260927040000 的理由);新欄吃得到 view 層的 SELECT。
CREATE OR REPLACE VIEW public.products_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.external_id,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'title', E' \t\r\n　'), ''), p.title) AS title,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'subtitle', E' \t\r\n　'), ''), p.subtitle) AS subtitle,
  p.description,
  p.handle,
  p.fitments,
  p.images,
  p.availability,
  p.brand_id,
  p.category_id,
  p.created_at,
  p.updated_at,
  CASE WHEN rep.product_id IS NULL THEN p.price_general ELSE rep.price END AS price_general,
  p.supplier_slug,
  COALESCE(NULLIF(p.staff_overrides -> 'highlights', '[]'::jsonb), p.highlights) AS highlights,
  p.manuals,
  p.video_url,
  CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
    'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
    'nw', t.natural_width, 'nh', t.natural_height) END AS card_image_trim,
  p.sound_clips,
  p.content_changed_at,
  rep.original_price
FROM public.products p
LEFT JOIN public.product_image_trim t ON t.url = p.images ->> 0 AND t.status = 'ok'
LEFT JOIN (
  -- 代表款(只算「有規格設了特價」或「有規格一般價是空的」商品):實際一般價最低(空值排最後),同價取 sku COLLATE "C" 最小
  -- (與經銷站挑基準款同一種寫法,20260925050000:82)。每次都直接讀規格表的特價欄,不用存起來的標記(計畫 R5-2)。
  SELECT DISTINCT ON (pv.product_id) pv.product_id,
         public.pcm_effective_general_price(pv.price_general, pv.sale_price_general) AS price,
         CASE WHEN public.pcm_effective_general_price(pv.price_general, pv.sale_price_general) < pv.price_general
              THEN pv.price_general END AS original_price
    FROM public.product_variants pv
   WHERE pv.product_id IN (SELECT sv.product_id FROM public.product_variants sv
                            WHERE sv.sale_price_general IS NOT NULL OR sv.price_general IS NULL)
   ORDER BY pv.product_id, 2 ASC NULLS LAST, pv.sku COLLATE "C" ASC
) rep ON rep.product_id = p.id;

COMMENT ON VIEW public.products_public IS
  'Detail projection(22 欄):20260928230000 起 price_general = 代表款的實際一般價(含特價;無規格的商品照舊用商品層價格),最後一欄 original_price = 代表款特價生效時的原價,否則 NULL。title / subtitle / highlights 取 staff_overrides 優先。security_invoker=true;不含 price_store、price_by_tier、metadata、delisted_at、staff_overrides 原欄。';

CREATE OR REPLACE VIEW public.products_list_public WITH (security_invoker = true) AS
SELECT
  p.id,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'title', E' \t\r\n　'), ''), p.title) AS title,
  COALESCE(NULLIF(pg_catalog.btrim(p.staff_overrides ->> 'subtitle', E' \t\r\n　'), ''), p.subtitle) AS subtitle,
  p.handle,
  p.brand_id,
  p.category_id,
  p.availability,
  p.fitments,
  CASE WHEN rep.product_id IS NULL THEN p.price_general ELSE rep.price END AS price_general,
  p.supplier_slug,
  p.images ->> 0 AS card_image,
  COALESCE(
    NULLIF(
      concat_ws(' ', p.fitments -> 0 ->> 'motoBrand', p.fitments -> 0 ->> 'modelCode'),
      ''
    ),
    '通用款'
  ) AS fits,
  b.name AS brand_name,
  b.slug AS brand_slug,
  c.raw_path AS category_raw,
  p.created_at,
  rep.original_price
FROM public.products p
JOIN public.brands b ON b.id = p.brand_id
JOIN public.categories c ON c.id = p.category_id
LEFT JOIN (
  -- 代表款(只算「有規格設了特價」或「有規格一般價是空的」商品):實際一般價最低(空值排最後),同價取 sku COLLATE "C" 最小
  -- (與經銷站挑基準款同一種寫法,20260925050000:82)。每次都直接讀規格表的特價欄,不用存起來的標記(計畫 R5-2)。
  SELECT DISTINCT ON (pv.product_id) pv.product_id,
         public.pcm_effective_general_price(pv.price_general, pv.sale_price_general) AS price,
         CASE WHEN public.pcm_effective_general_price(pv.price_general, pv.sale_price_general) < pv.price_general
              THEN pv.price_general END AS original_price
    FROM public.product_variants pv
   WHERE pv.product_id IN (SELECT sv.product_id FROM public.product_variants sv
                            WHERE sv.sale_price_general IS NOT NULL OR sv.price_general IS NULL)
   ORDER BY pv.product_id, 2 ASC NULLS LAST, pv.sku COLLATE "C" ASC
) rep ON rep.product_id = p.id;

COMMENT ON VIEW public.products_list_public IS
  'P4 list projection (17 cols). 20260928230000: price_general = representative variant effective general price (sale-aware; products with no variants keep the product-level price); last column original_price = that variant''s general price while its sale is active, else NULL. title / subtitle prefer staff_overrides. security_invoker=true; excludes price_store, price_by_tier, metadata, detail content, delisted_at and the raw staff_overrides column.';

CREATE OR REPLACE VIEW public.product_variants_public WITH (security_invoker = true) AS
SELECT
  id,
  product_id,
  sku,
  spec,
  public.pcm_effective_general_price(price_general, sale_price_general) AS price_general,
  availability,
  images,
  sort_order,
  created_at,
  updated_at,
  supplier_slug,
  CASE WHEN public.pcm_effective_general_price(price_general, sale_price_general) < price_general
       THEN price_general END AS original_price
FROM public.product_variants;

COMMENT ON VIEW public.product_variants_public IS
  '20260928230000:price_general = 實際一般價(含特價,一般價空 ⇒ 空);最後一欄 original_price = 特價生效時的原價,否則 NULL。security_invoker=true;不含 price_store、sale_price_general 原欄。';

-- ── 4. 權限:三個 view 是 security_invoker,查詢者要讀得到特價欄、叫得動共用函式 ──
-- ACL-GATE-EXEMPT: public.product_variants -- 前台三個 view 是 security_invoker,訪客讀價要讀得到特價欄;只開這一欄(計畫 R1-3,20260928230000,事後閘⑧斷言 price_store 仍關)
-- ACL-GATE-EXEMPT: public.pcm_effective_general_price -- 三個 view 以訪客身分呼叫這支算實際一般價;純計算、不讀表(計畫 R1-3,20260928230000,事後閘⑧斷言)
GRANT SELECT (sale_price_general) ON public.product_variants TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_effective_general_price(integer, integer) TO anon, authenticated;

-- ── 5. 事後閘 ──
DO $post$
DECLARE
  r text;
  v_cfg text;
  v_sp text := pg_catalog.current_setting('search_path');
  v_dp text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '', true);
  v_dp := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.products_list_dealer'::regclass, true));
  PERFORM pg_catalog.set_config('search_path', v_sp, true);
  FOREACH r IN ARRAY ARRAY['public.get_effective_prices(uuid[], uuid[])', 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)']::text[] LOOP
    SELECT pg_catalog.array_to_string(p.proconfig, ',') || CASE WHEN p.prosecdef THEN '' ELSE '|NOT-DEFINER' END
      INTO v_cfg FROM pg_catalog.pg_proc p WHERE p.oid = r::regprocedure;
    IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後閘①:% 的設定是 %(期望 DEFINER + search_path 空字串)⇒ 停。', r, v_cfg;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②:create_order 的 EXECUTE 變了 ⇒ 停。';
  END IF;
  -- 經銷目錄 view 沒被動到、也沒被打開
  IF v_dp IS DISTINCT FROM 'f45a37de325ecd907c3713401c61d14a' THEN
    RAISE EXCEPTION '事後閘③:products_list_dealer 的定義變了 ⇒ 停。';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.products_list_dealer', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.products_list_dealer', 'SELECT') THEN
    RAISE EXCEPTION '事後閘④:products_list_dealer 被開了 SELECT ⇒ 停。';
  END IF;
  -- 三個 view:仍是 security_invoker、最後一欄是 original_price、公開身分讀得到
  FOREACH r IN ARRAY ARRAY['public.products_public', 'public.products_list_public', 'public.product_variants_public']::text[] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = r::regclass AND 'security_invoker=true' = ANY(c.reloptions)) THEN
      RAISE EXCEPTION '事後閘⑤:% 不再是 security_invoker ⇒ 停。', r;
    END IF;
    IF (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid = r::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum DESC LIMIT 1) IS DISTINCT FROM 'original_price' THEN
      RAISE EXCEPTION '事後閘⑥:% 最後一欄不是 original_price ⇒ 停。', r;
    END IF;
    IF NOT pg_catalog.has_column_privilege('anon', r, 'original_price', 'SELECT')
       OR NOT pg_catalog.has_column_privilege('authenticated', r, 'original_price', 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑦:anon / authenticated 讀不到 %.original_price ⇒ 停。', r;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_column_privilege('anon', 'public.product_variants', 'sale_price_general', 'SELECT')
     OR NOT pg_catalog.has_function_privilege('anon', 'public.pcm_effective_general_price(integer, integer)', 'EXECUTE')
     OR pg_catalog.has_column_privilege('anon', 'public.product_variants', 'price_store', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑧:公開身分的特價欄 / 共用函式權限不對,或經銷價欄被打開 ⇒ 停。';
  END IF;
  -- 三個出口都真的呼叫共用函式、核對真的接上
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure), 'pcm_effective_general_price(v_variant.price_general, v_variant.sale_price_general)') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure), 'P2C21') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure), 'pcm_effective_general_price(v.price_general, v.sale_price_general)') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.product_variants_public'::regclass, true), 'pcm_effective_general_price') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.products_list_public'::regclass, true), 'pcm_effective_general_price') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_viewdef('public.products_public'::regclass, true), 'pcm_effective_general_price') = 0 THEN
    RAISE EXCEPTION '事後閘⑨:有出口沒有改讀實際一般價,或單價核對沒接上 ⇒ 停。';
  END IF;
  -- 寫出來的本體指紋(退回檔的前置閘比這兩個與三個 view 的指紋)
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)'::regprocedure) IS DISTINCT FROM '79e253857b6b2757b8823a6740e7107b'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_effective_prices(uuid[], uuid[])'::regprocedure) IS DISTINCT FROM '636409bea9cff799d5636805809f177d' THEN
    RAISE EXCEPTION '事後閘⑩:寫出來的本體指紋與預期不同 ⇒ 停(退回檔會對不上)。';
  END IF;
  RAISE NOTICE '✅ 20260928230000:create_order / get_effective_prices / 三個 view 改讀實際一般價,單價核對已接上,經銷目錄不變';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
