-- 20260926100000 退回:把後台刪除 / 停用會員的第一支 migration 還原成貼之前的樣子。
-- 🔴 前置:1. 網站程式已退回並在 dev 與 main 都部署完成(顧客站還在讀 disabled_at 時收權限或刪欄位, 全站會登不進去)。
--          2. 先退 20260926100100(supabase/rollbacks/20260926100100-rollback.sql, 外鍵改回 CASCADE)。
-- 🔴 停用紀錄(customers.disabled_*)會一起消失;admin_audit_log 的停用、恢復、刪除紀錄保留。
-- 五支既有函式與搜尋函式的本體 = 2026-09-26 從正式庫唯讀取出的改動前定義, 逐字未改。
-- 貼完:NOTIFY pgrst, 'reload schema';經 API 呼叫兩參數版 admin_search_customers(客戶列表搜尋、手動建單挑客人),
--       實際跑一次經銷核准與手動建單。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

DO $gate$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conname = 'customer_wallet_ledger_customer_user_id_fkey'
                AND c.conrelid = 'public.customer_wallet_ledger'::regclass AND c.confdeltype <> 'c') THEN
    RAISE EXCEPTION '前置閘:儲值金流水外鍵還不是 CASCADE ⇒ 先退 20260926100100。';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_disable_customer(text, uuid, integer, text, text)') IS NULL THEN
    RAISE EXCEPTION '前置閘:admin_disable_customer 不存在(20260926100000 沒貼過或已經退過)⇒ 停。';
  END IF;
END
$gate$;

-- ── 1. 客戶列表 view:CREATE OR REPLACE 不能刪欄 ⇒ DROP 後照 20260901010000 的 12 欄重建 ──
DROP VIEW public.admin_customer_list_v;
CREATE VIEW public.admin_customer_list_v
  WITH (security_invoker = true) AS
SELECT
  c.user_id,
  c.name,
  c.email,
  c.phone,
  c.tier,
  c.created_at,
  (SELECT count(*)
     FROM public.orders o
    WHERE o.customer_user_id = c.user_id
      AND o.cancelled_at IS NULL)                       AS active_order_count,
  (SELECT coalesce(sum(o.total), 0)
     FROM public.orders o
    WHERE o.customer_user_id = c.user_id
      AND o.cancelled_at IS NULL)                       AS active_spend_total,
  (SELECT max(o.created_at)
     FROM public.orders o
    WHERE o.customer_user_id = c.user_id
      AND o.cancelled_at IS NULL)                       AS last_active_ordered_at,
  c.birthday                                            AS birthday,
  extract(month from c.birthday)::smallint              AS birth_month,
  -- 🔴 新欄。**只給 filter 用, 不給 select 用**(見 §1)。原樣透出代碼, 不轉中文(見 §2)。
  c.gender                                              AS gender
FROM public.customers c;

REVOKE ALL ON public.admin_customer_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_customer_list_v FROM anon, authenticated;
GRANT SELECT ON public.admin_customer_list_v TO service_role;
-- 重建的 view 會吃到預設權限;pcm_readonly 原本被收掉(20260901230000), 這裡照樣收
DO $ro$
BEGIN
  IF pg_catalog.to_regrole('pcm_readonly') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.admin_customer_list_v FROM pcm_readonly';
  END IF;
END
$ro$;

-- 20260816030000 的 view 與三個統計欄註解(之後三次改版都是 CREATE OR REPLACE, 正式庫上仍在)
COMMENT ON VIEW public.admin_customer_list_v IS
  '後台客戶列表(訂單數/消費金額/最後下單)。'
  '🔴 口徑:三欄一律【排除已取消】(cancelled_at IS NOT NULL 者不計)、不扣退款。'
  '三條都是主視窗 2026-08-16 裁(Q-最後下單口徑=A)、Sean 未逐條答 —— 【要改直接改】。'
  '裁的理由=兩欄並排必須共用一條規則,否則員工要學兩套。'
  '想要「他最近有沒有來」那個訊號 ⇒ 那是另一個欄位「最後互動」,不是改這欄。'
  '🔴 寫法契約:customers 欄位逐顆列出(刻意不用 c.* —— 要擋 wallet_balance/total_deposit)、'
  '三個聚合欄一律純量子查詢,不得 GROUP BY/DISTINCT/join orders。customers 加欄要同批重建本 view。'
  '🔴 只給 service_role:本 view 帶全體客戶 email/phone,不得 GRANT 給 anon/authenticated。';

COMMENT ON COLUMN public.admin_customer_list_v.active_order_count IS
  '未取消訂單數(bigint,零訂單=0)。欄名帶 active_ 是刻意的:它不是「總下單次數」。';
COMMENT ON COLUMN public.admin_customer_list_v.active_spend_total IS
  '未取消訂單的 total 加總(bigint 元位、禁浮點;零訂單=0)。不扣退款。';
COMMENT ON COLUMN public.admin_customer_list_v.last_active_ordered_at IS
  '最後一筆未取消訂單的 created_at。🔴 零訂單=NULL(刻意不 coalesce:沒有合理的零日期)。'
  '接線片必須顯示成「從未下單」或「—」,不得留白 —— 留白與載入失敗長得一樣。';

COMMENT ON COLUMN public.admin_customer_list_v.birthday IS
  '客戶生日(date)。🔴 **給 filter 用, 不給 select 用** —— 列表白名單 ADMIN_CUSTOMER_LIST_SELECT '
  '刻意不含它(PII 只在明細頁, customer-repository.ts:14-16)。加進 select 會違反那條既有決定。';
COMMENT ON COLUMN public.admin_customer_list_v.birth_month IS
  '生日的月份 1-12(smallint)。給「這個月生日」篩選 —— PostgREST 的 filter 吃不了運算式, '
  '所以必須先在 view 裡變成欄。🔴 沒填生日 = NULL(刻意不 coalesce):'
  '「另有 N 人沒填生日」那個 N 就是靠這一欄 IS NULL 數出來的, 填掉會讓它永遠是 0。';
COMMENT ON COLUMN public.admin_customer_list_v.gender IS
  '性別代碼 male / female / undisclosed(值域由 customers_gender_chk 管, 20260831150000)。'
  '🔴 **給 filter 用, 不給 select 用** —— 同 birthday 那條理由, 列表投影白名單不含它。'
  '🔴 NULL 刻意不 coalesce:它同時涵蓋「沒被問」與「問了沒填」, 而**多數人會是 NULL** —— '
  '只有【Email 註冊路徑】會填這一欄, Google / LINE 進來的使用者恆 NULL(結構, 不是漏做; '
  '全文在 customers.gender 的 COMMENT)。⇒ 任何「性別分布」統計都只涵蓋 Email 註冊那一群。';

-- ── 2. 搜尋函式回到兩參數版 ──
DROP FUNCTION public.admin_search_customers(text, integer, text);
CREATE OR REPLACE FUNCTION public.admin_search_customers(p_query text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_txt       text;
  v_txt_like  text;
  v_num       text;
  v_num_like  text;
  v_limit     integer;
  v_ids       uuid[];
  v_truncated boolean;
BEGIN
  -- ① 修剪:字元集**顯式**含 tab / U+3000 / NBSP / U+202F / U+200B / BOM
  --    (逐字對齊 `admin_search_orders`;`btrim` 預設只吃 ASCII 空白,中文輸入法常帶全形空白)。
  v_txt := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(p_query, ''), E' \t\n\r　  ​﻿')
  );

  -- ② 空 / 過長 → 回空清單,**不擲例外**(錯誤訊息會含輸入原文 = PII)。
  --    120 與 `MAX_ORDER_KEYWORD_LENGTH` 同值,刻意:兩軸的 UI 上限一致,員工不用記兩套。
  IF v_txt = '' OR pg_catalog.length(v_txt) > 120 THEN
    RETURN jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ③ 上限:NULL / <=0 → 100;硬夾 100(對齊下游 `.in()` 的 URL 長度上限)。
  v_limit := LEAST(COALESCE(NULLIF(p_limit, 0), 100), 100);
  IF v_limit <= 0 THEN v_limit := 100; END IF;

  -- ④ 逃逸:`LIKE` 的萬用字元。**這是在 SQL 內對 literal 做逃逸,與 `.or()` 的結構性風險無關**
  --    —— 值永遠是參數、永遠不參與語法。
  v_txt_like := pg_catalog.replace(
                  pg_catalog.replace(
                    pg_catalog.replace(v_txt, '\', '\\'),
                  '%', '\%'),
                '_', '\_');

  -- ⑤ 數字類 needle(電話):去掉所有非數字後比對 ⇒ `0912-345-678` 與 `0912345678` 互相搜得到。
  v_num := pg_catalog.regexp_replace(v_txt, '[^0-9]', '', 'g');
  v_num_like := v_num;  -- 純數字,無 LIKE 元字元可逃

  -- ⑥ 三軸 UNION(**不是一大坨 OR**)—— 逐字對齊 `admin_search_orders` 的形狀理由:
  --    OR 形狀下規劃器拿不到各軸的索引。`UNION`(非 `UNION ALL`)天然去重,
  --    一位客人同時命中兩軸只算一筆,不吃掉別人的名額。
  --    🔴 **各軸各自檢查 needle 非空**:搜 `-` 時數字類變空字串 ⇒ 該軸整組跳過,
  --       否則 `LIKE '%%'` 會**撈回全部客人**(fail-open)。
  WITH hits AS (
    -- #1 姓名(文字)
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_txt <> ''
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name, ''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
    UNION
    -- #2 Email(文字)
    -- 🔴 **LINE 合成位址刻意【搜得到】**(C 窗 2026-08-16 判、主視窗核):
    --    那串仍是該客人的登入帳號;後台把它藏起來是為了**畫面不顯示雜訊**,不是讓紀錄找不到。
    --    員工手上有那串的唯一來源是**後台以外**(Supabase 後台 / 錯誤紀錄 / LINE 客服),
    --    而那種時候他正需要用它反查是誰。⇒ 本軸不排除 `@line.pcmmotorsports.local`。
    --    ⚠️ 代價:搜到之後畫面 Email 欄顯示「LINE 帳號登入,無 Email」⇒ **搜 X 卻看不到 X**。
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_txt <> ''
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(c.email, ''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
    UNION
    -- #3 電話(數字;正規化後子字串)
    -- 🔴 **`lower()` 不可省(codex R1 must-fix 5)**:既有索引 `idx_customers_phone_trgm` 的表達式是
    --    `regexp_replace(pg_catalog.lower(COALESCE(phone,'')), '[^0-9]', '', 'g')`
    --    (`20260812130000:436-438` 逐字)。電話只有數字,**加不加 `lower()` 結果完全相同** ——
    --    但 **expression index 比對的是【表達式樹】不是【結果】** ⇒ 少一個 `lower()` 規劃器就用不到它,
    --    症狀是**功能完全正常、只是全表掃**,而**沒有任何測試會紅**。
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_num <> ''
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(c.phone, '')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
  ),
  ranked AS (
    -- 多撈一筆:用來分辨「剛好觸頂」與「超過」。UI 不得改用 `ids.length >= 上限` 的啟發式。
    -- 🔴 `user_id` 是**穩定的第二排序鍵**(codex R1 nit):只用 `created_at DESC` 時,
    --    兩位客人時間相同又剛好卡在上限邊界 ⇒ 回誰隨執行計畫改變 = 不可重現。
    SELECT user_id, created_at FROM hits ORDER BY created_at DESC, user_id LIMIT v_limit + 1
  )
  -- 🔴 **`array_agg` 必須自帶 `ORDER BY`(codex R2 must-fix 6)**:
  --    子查詢的 `ORDER BY` **不會**傳遞到聚合的輸入順序(PG 明文:aggregate 的輸入順序未指定)
  --    ⇒ 下面 `v_ids[1:v_limit]` 切掉的**可能不是第 101 筆**,邊界那一位隨執行計畫改變。
  --    症狀:同一組資料、同一個搜尋詞,兩次回不同的人 —— 而**兩次都「看起來正常」**。
  SELECT pg_catalog.array_agg(user_id ORDER BY created_at DESC, user_id) INTO v_ids FROM ranked;

  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  v_truncated := pg_catalog.array_length(v_ids, 1) > v_limit;
  IF v_truncated THEN
    v_ids := v_ids[1:v_limit];
  END IF;

  RETURN jsonb_build_object(
    'ids', COALESCE(pg_catalog.to_jsonb(v_ids), '[]'::jsonb),
    'truncated', COALESCE(v_truncated, false)
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_customers(text, integer) TO service_role;

COMMENT ON FUNCTION public.admin_search_customers(text, integer) IS
  'M-4b #525:後台客戶搜尋。**三維度**(會員姓名 / Email / 會員電話),回 {"ids": uuid[], "truncated": bool}，ids = customers.user_id（該表 PK）。'
  '🔴 只回 id —— PII 只在 SQL 內比對，不進讀模型、不進 RSC payload。'
  '🔴 **走 RPC(POST body)而不是 PostgREST `.or()`**：`.or()` 把值內插進 GET query string ⇒ 值裡的字元會改變 filter 結構；'
  '訂單側不需要字元集守門正是因為它走 `.rpc()`（理由全文 packages/domain/src/order/keyword-search.ts:20-28），'
  '而那兩支有守門的維度已連同威脅面一起刪除 ⇒ 用 `.or()` 等於把威脅面裝回來而守門不在。'
  '字元集守門在本軸不能補：員工要搜的正是中文姓名。'
  '🔴 **從 customers 出發、不 join orders**：orders join 會讓零訂單的客人整個消失（2026-08-16 實查 11 位中 7 位零訂單），那正是本函式存在的理由。'
  '🔴 三軸 UNION（非一大坨 OR，非 UNION ALL）：OR 形狀下規劃器拿不到各軸索引；UNION 去重讓同時命中兩軸的客人只算一筆。'
  '🔴 各軸各自檢查 needle 非空：搜「-」時數字類變空字串 ⇒ 該軸跳過，否則 LIKE ''%%'' 會撈回全部客人（fail-open）。'
  '🔴 LINE 合成位址**刻意搜得到**（C 窗判、主視窗核）：那串仍是登入帳號，藏是為了畫面不顯示雜訊、不是讓紀錄找不到。'
  '🔴 本函式無任何 RAISE —— 搜尋詞是 PII、不得落 server log；空／全空白／長度 >120 一律回空清單，不擲例外（錯誤訊息會含輸入原文）。'
  '長度上限 120 與 MAX_ORDER_KEYWORD_LENGTH 同值（兩軸 UI 上限一致）。p_limit：NULL/<=0 → 100，硬夾 100；命中超過時只回前 p_limit 筆並 truncated=true（UI 必須顯示「結果太多請更精確」；不得改用 ids.length >= 上限 的啟發式）。'
  '除 owner 與 superuser 外，僅 service_role 可執行。';

-- ── 3. 五支既有函式回到改動前 ──
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
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'create_order: 查不到 customers.tier(user=%)⇒ 不得以一般價結帳', v_uid;
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
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability, p.brand_id
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
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
$function$
;

CREATE OR REPLACE FUNCTION public.dealer_application_submit(p_company_name text, p_tax_id text, p_store_name text, p_region text, p_contact_name text, p_contact_phone text, p_contact_email text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  -- 空白字元集照抄 admin_set_customer_tier(20260914130000):btrim() 預設只剝 ASCII 空格,
  --   tab / 全形空白 / 零寬字元會讓「必填」與「婉拒原因」被一串看不見的字元騙過(Codex R1)。
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'dealer_application_submit:沒有登入身分' USING ERRCODE = '28000';
  END IF;
  -- 🔴 空白一律剝掉再存;格式由表上的 CHECK 判(違反 ⇒ 23514, 前台逐格先驗過, 這裡是最後一道)
  INSERT INTO public.dealer_applications
    (user_id, company_name, tax_id, store_name, region, contact_name, contact_phone, contact_email, note)
  VALUES (
    v_uid,
    pg_catalog.btrim(coalesce(p_company_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_tax_id, ''), v_ws),
    pg_catalog.btrim(coalesce(p_store_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_region, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_phone, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_email, ''), v_ws),
    pg_catalog.btrim(coalesce(p_note, ''), v_ws)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dealer_application_update_mine(p_id uuid, p_company_name text, p_tax_id text, p_store_name text, p_region text, p_contact_name text, p_contact_phone text, p_contact_email text, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  -- 空白字元集照抄 admin_set_customer_tier(20260914130000):btrim() 預設只剝 ASCII 空格,
  --   tab / 全形空白 / 零寬字元會讓「必填」與「婉拒原因」被一串看不見的字元騙過(Codex R1)。
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'dealer_application_update_mine:沒有登入身分' USING ERRCODE = '28000';
  END IF;
  UPDATE public.dealer_applications
     SET company_name  = pg_catalog.btrim(coalesce(p_company_name, ''), v_ws),
         tax_id        = pg_catalog.btrim(coalesce(p_tax_id, ''), v_ws),
         store_name    = pg_catalog.btrim(coalesce(p_store_name, ''), v_ws),
         region        = pg_catalog.btrim(coalesce(p_region, ''), v_ws),
         contact_name  = pg_catalog.btrim(coalesce(p_contact_name, ''), v_ws),
         contact_phone = pg_catalog.btrim(coalesce(p_contact_phone, ''), v_ws),
         contact_email = pg_catalog.btrim(coalesce(p_contact_email, ''), v_ws),
         note          = pg_catalog.btrim(coalesce(p_note, ''), v_ws),
         updated_at    = pg_catalog.now()
   WHERE id = p_id
     AND user_id = v_uid
     AND status = 'pending';
  RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_dealer_application_decide(p_application_id uuid, p_decision text, p_note text, p_actor text, p_request_id text, p_expected_tier text, p_expected_updated_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_app      public.dealer_applications%ROWTYPE;
  v_tier     text;
  v_note     text;
  v_result   text;
  -- 空白字元集照抄 admin_set_customer_tier(20260914130000):btrim() 預設只剝 ASCII 空格,
  --   tab / 全形空白 / 零寬字元會讓「必填」與「婉拒原因」被一串看不見的字元騙過(Codex R1)。
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  v_note := pg_catalog.btrim(coalesce(p_note, ''), v_ws);
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:decision 只能是 approve 或 reject';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:缺 request_id';
  END IF;
  IF p_decision = 'reject' AND v_note = '' THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:婉拒要填原因';
  END IF;

  SELECT * INTO v_app FROM public.dealer_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_app.status <> 'pending' THEN
    RETURN 'ALREADY_DECIDED';
  END IF;
  -- 🔴 員工核准的必須是【他看過的那一版】(Codex R1):他打開之後客人又改了公司名 / 統編 ⇒ STALE、零寫入。
  --   p_expected_updated_at 原樣回傳資料庫給的值(微秒), 不要先轉成 JS Date(只剩毫秒 ⇒ 每次都 STALE)。
  IF p_expected_updated_at IS DISTINCT FROM v_app.updated_at THEN
    RETURN 'STALE';
  END IF;

  -- 婉拒也讀等級, 稽核紀錄的快照才是真的(Codex R1:原本婉拒寫成 tier=null)
  SELECT c.tier::text INTO v_tier FROM public.customers c WHERE c.user_id = v_app.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  IF p_decision = 'approve' THEN
    IF p_expected_tier IS DISTINCT FROM v_tier THEN
      RETURN 'STALE';
    END IF;
    IF v_tier = 'premiumStore' THEN
      RETURN 'WOULD_DOWNGRADE';
    END IF;
    v_result := public.admin_set_customer_tier(
      v_app.user_id, 'store', '經銷商申請核准 #' || v_app.id::text, p_actor, p_request_id, v_tier);
    IF v_result NOT IN ('UPDATED', 'NO_CHANGE') THEN
      -- 前面已鎖住並比對過 ⇒ 理論上到不了;到了就整筆回滾, 不留半套
      RAISE EXCEPTION 'admin_dealer_application_decide:改等級回 %(預期 UPDATED / NO_CHANGE)', v_result;
    END IF;
  END IF;

  UPDATE public.dealer_applications
     SET status      = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by  = p_actor,
         decided_at  = pg_catalog.now(),
         decide_note = v_note,
         updated_at  = pg_catalog.now()
   WHERE id = v_app.id;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'dealer_application.decide',
    'dealer_application:' || v_app.id::text,
    pg_catalog.jsonb_build_object('status', 'pending', 'tier', v_tier),
    pg_catalog.jsonb_build_object('status', CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
                                  'tier', CASE WHEN p_decision = 'approve' THEN 'store' ELSE v_tier END),
    nullif(v_note, ''),
    p_request_id,
    'admin'
  );

  RETURN CASE WHEN p_decision = 'approve' THEN 'APPROVED' ELSE 'REJECTED' END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_create_manual_order(p_customer_user_id uuid, p_manual_request_id uuid, p_actor text, p_order_source text, p_payment_channel text, p_shipping_method text, p_ship_to jsonb, p_invoice jsonb, p_shipping_fee integer, p_lines jsonb, p_notification_email text DEFAULT NULL::text, p_tier text DEFAULT NULL::text, p_vehicle jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- 第 9 代:白名單重組後的車輛快照(只收 kind / brand / model / raw / year;source 由本函式決定)。
  v_vehicle     jsonb := NULL;
  v_veh_year    integer;
  v_veh_key     text;
  v_veh_brand   text;
  v_veh_model   text;
  v_veh_raw     text;
  v_line        jsonb;
  v_qty         integer;
  v_unit_price  integer;
  v_sku         text;
  v_title       text;
  v_spec        jsonb;
  v_variant_id  uuid;
  v_line_total  bigint;
  v_subtotal    bigint := 0;
  v_total       bigint;
  -- 🔴 **第 6 代新增**:稅額。`bigint` 與 `v_subtotal`/`v_total` 同族, 溢位在同一道閘擋。
  v_tax         bigint;
  -- 🔴 **這個值出現在兩個地方**(INSERT 的值列 + audit payload)⇒ 收成一個變數。
  --    兩份字面會分岔, 而分岔時**沒有東西會叫** —— audit 說 inclusive 而資料是 exclusive。
  -- 🔴🔴 **第 7 代:它不再是 `constant`**(⟦b4-INVOICE5PCT⟧, Sean 2026-09-04 逐字
  --    「那如果我沒有勾選開發票價錢都不加」)⇒ 由 `v_invoice_requested` 決定, 見下方稅那一段。
  --    🛑 **拿掉 `constant` 這件事本身沒有守門** —— 它只是讓賦值合法;
  --       真正釘住「兩個世界各是什麼」的是那一段 `IF`, 與事後斷言③。
  v_price_tax_mode text;
  v_items       jsonb := '[]'::jsonb;
  -- 🔴🔴 **第 7 代新增:員工在每一列選的「未稅 / 含稅」—— 只為了記進稽核。**
  --    codex R3(2026-09-09 換模型換角度)打出來的那一條:沒勾開發票時兩種稅基**都不換算**
  --    ⇒ 「填 1,050 選含稅」與「填 1,050 選未稅」在資料庫裡**長得一模一樣**
  --    ⇒ 📌 三個月後退款爭議, 查不到他當初的意思。🛑 **不是 log 難找, 是那個資訊沒有被存下來。**
  --    ✅ Sean 2026-09-09 拍甲逐字:「先上, 而同一片多做一件:把他選的『未稅/含稅』記進稽核紀錄」。
  v_line_basis  text;
  v_line_bases  jsonb := '[]'::jsonb;
  -- 🔴🔴 **稽核要對得回 `order_items` 的【那一列】, 而唯一穩定的身分是它的 id。**
  --    ⛔ ~~第一版記 `line_key`(去重用的那把:料號|品名|單價|規格)~~ **codex R5 打掉它**:
  --      🔬 失敗情境逐字可構造:兩列合法代購, 料號品名規格相同而單價 1,000 / 1,200
  --      ⇒ 兩把 key 不同;而未開發票未付款的單**合法**可用 `admin_update_order_item_amount`
  --        把第一列改成 1,200 ⇒ 📌 **原本 1,000 那把對不到任何列, 原本 1,200 那把同時命中兩列。**
  --      🎯 **⇒ 它把一個【可以被改的值】當成身分的一部分。**
  --    ⛔ 而 `line_key` 還有第二個病:它明文含品名與規格(自由文字)⇒ 把員工輸入
  --      **多抄一份**進 append-only 的稽核表, 而那與本函式 G9 那段「少抄一份 = 少一個
  --      會過期、會外洩的副本」直接衝突。**我當時寫「不含敏感值」是錯的** —— 規格是自由文字。
  --    ✅ ⇒ 改成**自己生 id、明確寫進 `order_items`**, 稽核只記那個 id + 稅基 + 單價。
  --      🔵 **不動表結構**(`order_items.id` 本來就是 uuid 主鍵, 只是原本走 DEFAULT)。
  --      🔵 **不進冪等指紋** —— 它不進 `v_items`(那是指紋的來源);重送在指紋比對那一步就
  --        早退了, 根本走不到這個 INSERT。
  v_item_id     uuid;
  v_item_ids    jsonb := '[]'::jsonb;
  v_ship_to     jsonb;
  v_invoice     jsonb;
  -- 🔴 第④代新增(`⟦b4-INVOICE5PCT⟧` 第 2 步):**這張單開不開發票**。
  --    🛑 與 `v_invoice` 是兩件事:那個講「開的話抬頭寫誰」, 本欄講「開不開」。
  v_invoice_requested boolean;
  -- 🔴 ⟦b4-INVOICE5PCT⟧二:含稅那一列的【原值】與【殘差】。
  v_line_taxed     integer;
  v_taxed_key      text;
  v_taxed_residual bigint := 0;
  v_untaxed_base   bigint := 0;
  v_tier        public.member_tier;
  v_display_id  text;
  v_order_id    uuid;
  v_existing    record;
  v_attempt     integer;
  v_cname       text;
  v_n           integer;
  -- codex R1 `:186`:跨列去重的累積器(形狀照 `create_order` `20260730120100:322-325`)
  v_seen        text[] := ARRAY[]::text[];
  v_key         text;
  -- codex R1 `:143`/`:248`:正規化後的整包輸入 + 它的指紋
  v_canonical   jsonb;
  v_payload_sha text;
  -- 🔴 `''` 必須收斂成 NULL:`orders_notification_email_valid`(`20260718120000:125-127`)的
  --    `~ '^[!-~]+$'` 對空字串**不成立** ⇒ 直接寫 `''` 會被 CHECK 擋、整張單建不出來。
  --    而員工「留白」送過來的就是 `''`(HTML 表單的空欄不是 NULL)。
  v_notification_email text;
  -- codex R1 `:138`:兩個**業務上限**。
  -- 🔴 **這兩個數字是我挑的,Sean 沒有拍過。** 挑法=比實務用量大一個數量級、
  --    又小到擋得住「一發打爆」:電話單實務上個位數筆、單筆數量兩位數。
  --    ⇒ 撞到它們的時候要**改這裡並問 Sean**,不要在呼叫端拆單繞過去。
  c_max_lines   constant integer := 50;
  c_max_qty     constant integer := 9999;
BEGIN
  -- ── G1 輸入:每一格各自一道,訊息講【哪一格】不講「輸入有誤」 ──────────────
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定客人(customer_user_id 是 NULL);拒絕建出無主單';
  END IF;
  IF p_manual_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 缺冪等鍵(manual_request_id);沒有它,重送會建出第二張單';
  END IF;
  -- 🔴🔴 F1(R3 f5):**憑空建單卻記不住是誰做的** —— 而「憑空建單」正是本片新增的能力。
  --    對照:退款登記那支(`20260820021000`)提到 actor **29 次**;本檔上一版**零次**。
  --    f5 的框架句(收下,不改寫):兩片一起上線之後,能力邊界變成
  --    「**有後台密碼的人可以造出一條完整的假金流鏈,而鏈上第一環查不出是誰做的**」
  --    (建單 → 灌假收款 → 退款,三片各自都說「那不歸我管」,而沒有一片說錯)。
  --    ⇒ 走 `admin_audit_log`,**不在 `orders` 加欄**(那張表本來就沒有 actor 欄,
  --      而 audit 是這個 repo 既有的、對的載體)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定經手人(actor);'
                    '手動單是憑空建出來的,**不知道是誰建的單不准建**';
  END IF;
  -- 🔴 FK 只擋「不存在」,**擋不到已停用的** ⇒ 這一道查 is_active(逐字同 `20260820021000:198-199`)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = pg_catalog.btrim(p_actor, E' \t\r\n') AND s.is_active) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 經手人 [%] 不是啟用中的員工 ⇒ 拒絕建單。'
                    '🔴 手動建單的失敗模式是【人】,而 actor 是唯一的線索 —— '
                    '拿一個查不到的名字建單,等於這張單沒有來源。', p_actor;
  END IF;
  IF p_order_source IS NULL OR p_order_source NOT IN ('manual_phone', 'manual_line', 'manual_other') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 來源 [%] 不是手動三值之一', p_order_source;
  END IF;
  -- 🔴 具名拒 tappay:刷卡那條路由 TapPay 那一側寫,人工建單不得宣稱一筆卡片交易。
  IF p_payment_channel = 'tappay' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 手動單不得標記為線上刷卡(tappay);那條路由付款確認寫入';
  END IF;
  IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金流管道 [%] 不是 bank_transfer 或 cash', p_payment_channel;
  END IF;
  -- 第 8 代:會員等級白名單(Sean 2026-09-14 逐字「手動建立訂單的時候可以選擇車行會員還是經銷的選項才對」)。
  --    只改這張單的 tier_at_checkout, 客人帳號的等級不動(那只有 tier-edit 能改)。
  IF p_tier IS NOT NULL AND p_tier NOT IN ('general', 'store', 'premiumStore') THEN
    RAISE EXCEPTION USING MESSAGE =
      'admin_create_manual_order: 會員等級 [' || p_tier || '] 不是 general / store / premiumStore 之一';
  END IF;
  -- 第 9 代(#956 乙):車輛一格。形狀逐字沿用 order_items.vehicle_snapshot 的判別式(20260716180000):
  --   {kind:'dict', brand, model, year?} ⇒ 字典帶入;{kind:'free', raw, year?} ⇒ 員工照打(字典沒有)。
  --   🔴 白名單重組:只收那幾個鍵;`source` 不信 client, 由本函式寫 manual_dict / manual_text(後台看得出「這台不在字典」, 主視窗 2026-09-14 補點 (2))。
  --   year:省略 / NULL 可;有值必須是 1900-2100 的整數(字典年份不強制在 year_start-year_end 內, 08-28 plan 同句「年份維持自由填」)。
  IF p_vehicle IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_vehicle) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 車輛不是物件(%)', pg_catalog.jsonb_typeof(p_vehicle);
    END IF;
    -- 🔴 codex R1 must-fix ①③④:三個文字欄先驗【非 null 的值必須是 string】(->> 會把陣列 / 物件 / 數字文字化, `raw:123` 與 `raw:"123"` 會合成同一個指紋;缺 / null 由下面 dict·free 分支再驗必填),
    --    再修剪空格 / tab / CR / LF(btrim 預設只吃空格), 再驗非空 + 長度 ≤ 200(沿用顧客站車輛主閘那個上限);驗完的值同時進落表與指紋。
    FOR v_veh_key IN SELECT pg_catalog.unnest(ARRAY['brand', 'model', 'raw']) LOOP
      IF p_vehicle ? v_veh_key AND pg_catalog.jsonb_typeof(p_vehicle -> v_veh_key) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'admin_create_manual_order: 車輛 % 要是字串(收到 %)', v_veh_key, pg_catalog.jsonb_typeof(p_vehicle -> v_veh_key);
      END IF;
    END LOOP;
    v_veh_brand := NULLIF(pg_catalog.btrim(p_vehicle ->> 'brand', E' \t\r\n'), '');
    v_veh_model := NULLIF(pg_catalog.btrim(p_vehicle ->> 'model', E' \t\r\n'), '');
    v_veh_raw   := NULLIF(pg_catalog.btrim(p_vehicle ->> 'raw',   E' \t\r\n'), '');
    IF pg_catalog.length(COALESCE(v_veh_brand, '')) > 200 OR pg_catalog.length(COALESCE(v_veh_model, '')) > 200 OR pg_catalog.length(COALESCE(v_veh_raw, '')) > 200 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 車輛欄位超過 200 字';
    END IF;
    v_veh_year := NULL;
    IF p_vehicle ? 'year' AND pg_catalog.jsonb_typeof(p_vehicle -> 'year') <> 'null' THEN
      IF pg_catalog.jsonb_typeof(p_vehicle -> 'year') <> 'number'
         OR (p_vehicle ->> 'year') !~ '^[0-9]{4}$'
         OR (p_vehicle ->> 'year')::integer NOT BETWEEN 1900 AND 2100 THEN
        RAISE EXCEPTION 'admin_create_manual_order: 車輛年份要是 1900-2100 的整數(收到 %)', p_vehicle -> 'year';
      END IF;
      v_veh_year := (p_vehicle ->> 'year')::integer;
    END IF;
    IF COALESCE(p_vehicle ->> 'kind', '') = 'dict' THEN
      IF v_veh_brand IS NULL OR v_veh_model IS NULL THEN
        RAISE EXCEPTION 'admin_create_manual_order: 字典車輛缺 brand / model';
      END IF;
      v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'kind', 'dict',
        'brand', v_veh_brand,
        'model', v_veh_model,
        'year', v_veh_year,
        'source', 'manual_dict'));
    ELSIF COALESCE(p_vehicle ->> 'kind', '') = 'free' THEN
      IF v_veh_raw IS NULL THEN
        RAISE EXCEPTION 'admin_create_manual_order: 照打的車輛缺 raw';
      END IF;
      v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'kind', 'free',
        'raw', v_veh_raw,
        'year', v_veh_year,
        'source', 'manual_text'));
    ELSE
      RAISE EXCEPTION 'admin_create_manual_order: 車輛 kind 要是 dict 或 free(收到 %)', COALESCE(p_vehicle ->> 'kind', '(缺)');
    END IF;
  END IF;
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 運費必須是 0 或正整數(收到 %)', p_shipping_fee;
  END IF;
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有品項;一張單至少要有一個品項';
  END IF;
  -- 🔴 codex R1 `:138`:**沒有上限的迴圈**。舊版靠「總額 > integer 上限」兜底,而那道
  --    對 `unit_price = 0` 的品項**零判別力** ⇒ 幾萬筆零元品項可以整包穿過去。
  IF pg_catalog.jsonb_array_length(p_lines) > c_max_lines THEN
    RAISE EXCEPTION 'admin_create_manual_order: 一張單最多 % 個品項(收到 %);超過請拆單,'
                    '或這個上限要調整 ⇒ 找系統維護(它是保守預設值、未經拍板)',
                    c_max_lines, pg_catalog.jsonb_array_length(p_lines);
  END IF;

  -- 🔴🔴 **冪等格搬到 G6 之後了**(codex R1 `:143`)。
  --    原本它在這裡 = 「鍵在就回成功」,**完全不看內容** ⇒ 同鍵裝不同內容時,
  --    員工以為新單建好了,實際拿到的是**舊那張單**。
  --    ⇒ 要比對內容,就必須**先把內容正規化完**(G4/G5/G6 做那件事)⇒ 冪等格只能排在它們之後。
  --    ⚠️ 排序安全性:重送同一包輸入時,G3-G6 全部是**決定性**的(同輸入同結果)
  --       ⇒ 不存在「完全相同的重試被前面某道閘誤擋」那個坑
  --       (退款 RPC `20260820021000:238-242` 踩過的正是那個坑,方向相反)。

  -- ── G3 客人必須存在(FK 也會擋,而這裡先擋是為了給員工看得懂的訊息) ────────
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = p_customer_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_create_manual_order: 找不到這位客人(user_id=%);請先建立客人資料',
                    p_customer_user_id;
  END IF;
  -- 第 8 代:員工替這張單選的等級蓋過客人現在的;沒選(NULL)= 照客人現在的。上面那段查詢保留(兼客人存不存在的閘)。
  v_tier := COALESCE(p_tier::public.member_tier, v_tier);

  -- ── G4 收件快照:逐鍵白名單重組,**不收員工原樣的 jsonb** ───────────────────
  -- 🔴 表上有 exact-key CHECK(`20260604120000` orders_ship_addr_whitelist)
  --    ⇒ 多一個鍵就整筆回滾。這裡自己組,壞掉的輸入在這裡就講清楚。
  IF p_ship_to IS NULL OR pg_catalog.jsonb_typeof(p_ship_to) <> 'object'
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'name', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'phone', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'line', '')) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 收件資料要有收件人 / 電話 / 地址三格,不得留空';
  END IF;
  v_ship_to := pg_catalog.jsonb_build_object(
    'name',  pg_catalog.btrim(p_ship_to ->> 'name'),
    'phone', pg_catalog.btrim(p_ship_to ->> 'phone'),
    'line',  pg_catalog.btrim(p_ship_to ->> 'line'));

  -- ── G5 發票:同樣逐鍵白名單 ────────────────────────────────────────────────
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR COALESCE(p_invoice ->> 'type', '') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 發票類型要是 personal / company / donate 之一';
  END IF;
  -- 🔴 codex R2 `N1`:上一版這裡**沒有 trim** ⇒ 載具打成 `" ABC "` 與 `"ABC"` 會被算成
  --    兩包不同的內容 ⇒ 合法重送被拒。`NULLIF(btrim(…), '')` 讓「只打了空白」與「沒填」歸位到同一個值。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,那不是漏掉的,是唯一寫得對的寫法。**
  --    本函式其他每一個呼叫都寫成 `pg_catalog.xxx(...)`(因為 `SET search_path = ''`)
  --    ⇒ 照著那個風格會很自然地把這裡寫成 `pg_catalog.nullif(...)` —— **我自己就是這樣寫的。**
  --    而 `NULLIF` / `COALESCE` / `CASE` 是 **SQL 的語法構造,不是 `pg_catalog` 裡的函式**
  --    ⇒ `pg_catalog.nullif(...)` 會在**執行期**炸「function does not exist」。
  --    🔴 **那一發:靜態閘四道 + typecheck + lint + build + 本檔的 apply 斷言 —— 全綠。**
  --       plpgsql 的函式本體到**被呼叫**那一刻才解析名稱 ⇒ 上面每一道對它都是零判別力。
  --    ⚠️ ⇒ 誰要「統一風格」把前綴加回去:**請先跑一次真的呼叫**,不要只看它有沒有 apply 成功。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       pg_catalog.btrim(p_invoice ->> 'type'),
    'carrier',    NULLIF(pg_catalog.btrim(p_invoice ->> 'carrier'), ''),
    'title',      NULLIF(pg_catalog.btrim(p_invoice ->> 'title'), ''),
    'taxId',      NULLIF(pg_catalog.btrim(p_invoice ->> 'taxId'), ''),
    'donateCode', NULLIF(pg_catalog.btrim(p_invoice ->> 'donateCode'), '')));

  -- 🔴🔴 **第④代:`p_invoice.requested` = 這張單開不開發票**(`⟦b4-INVOICE5PCT⟧` 第 2 步;
  --    Sean 2026-09-04 第十八題拍甲)。
  --
  --    🛑 **為什麼搭 `p_invoice` 的順風車而不另開參數**:不動簽名 ⇒ 不會多出一個 overload,
  --       呼叫端不必 `DROP + CREATE`。⛔ ~~我原本在 TS 那邊寫「多一個參數必然 PGRST203」~~ ——
  --       **那句是錯的**(codex R1 查 PostgREST 官方打掉);真正的理由只是**不動簽名比較便宜**。
  --
  --    🔴 **`NULL`(這個鍵不在)必須【拒絕】, 不得當成 `true` 或 `false`** ——
  --       第③代以前的呼叫端不送這個鍵, 而它們建的單靠 `orders.invoice_requested` 的
  --       DEFAULT `true` 落地。⇒ 若這裡把 NULL 當 `true`, **舊呼叫端與「員工勾了要開」
  --       會落在同一個值上而分不出來**;若當 `false`, 那是**替他做一個他沒做的決定**。
  --       ⇒ 📌 而本函式**只有一個呼叫端**(後台建單), 而它與本片同一顆 commit 開始送這個鍵
  --       ⇒ **拒絕是安全的, 而且它會【立刻】叫** —— 不是一個要等很久才顯形的洞。
  -- 🔴🔴 **相容期設計:缺這個鍵【不是錯誤】, 而是「照舊」**(codex R3 must-fix #1/#2 改的)。
  --
  --    ⛔ ~~我第一版寫「缺鍵 ⇒ RAISE(必填)」~~ —— **那個設計讓上線這件事沒有安全順序**:
  --      · 先貼 migration、碼還沒部署 ⇒ 舊碼不送這個鍵 ⇒ 🔴 **每一張手動單都建不出來**
  --      · 先部署碼、migration 還沒貼 ⇒ 沒勾的單靜靜落成 `true`
  --      ⇒ 📌 **兩個方向都壞, 只是壞法不同** ⇒ 那不是「順序寫清楚就好」, 是設計本身有問題。
  --
  --    ✅ **改成:缺鍵 ⇒ `true`, 而 `true` 正是 `orders.invoice_requested` 今天的 DEFAULT**
  --      ⇒ 🎯 **兩個部署順序的最壞情況都變成「與今天一模一樣」** ——
  --         先貼 migration ⇒ 舊碼照常建單, 行為零改變;先部署碼 ⇒ 舊函式忽略該鍵, 行為零改變。
  --      ⇒ 那不是把問題往後推, 是**把一個必須協調的上線, 換成一個不必協調的上線**。
  --
  --    ⚠️ **代價寫出來, 不藏**:相容期裡「舊呼叫端沒送」與「員工明確勾了要開」
  --      **在資料上是同一個 `true`, 分不出來**。
  --      ✅ 而它為什麼可接受:本函式**今天只有一個呼叫端**(後台建單 `manual-order-repository.ts`),
  --         而它與本片**同一顆 commit** 開始送這個鍵 ⇒ 分不出來的那段期間 = **部署的那幾分鐘**。
  --      🛑 而**要真的關掉它**, 需要之後另一支 migration 把缺鍵改回 RAISE。
  --         ⇒ 📌 那支**還沒有人排** —— 這是一個**已知未關的缺口**, 不是「做完了」。
  --
  --    🔵 **而「送了但不是 boolean」仍然要叫** —— 那是呼叫端寫錯, 不是舊版本。
  --      實測(PG 17, 2026-09-04):鍵不存在 ⇒ `jsonb_typeof` 回 **SQL NULL**;
  --      鍵是 JSON null ⇒ 回字串 `'null'`。⇒ 兩者要分開處理, 而 `?` 運算子分得出來。
  --      🔵 **六個世界逐一在 PG 17 上量過**(不是推的):
  --         鍵不存在 ⇒ true · 鍵=true ⇒ true · 鍵=false ⇒ **false** ·
  --         鍵=JSON null ⇒ RAISE · 鍵=字串 ⇒ RAISE · 鍵=數字 ⇒ RAISE
  --      ⇒ 📌 中間那個 `false` 是重點:**它證明這道閘不是恆真的** ——
  --         有一個真實的輸入會讓它印出與其他五個不同的東西。
  -- 🔴🔴 本代(20260915170000, Sean 2026-09-16 批 Q10 plan docs/plans/2026-09-15-invoice5pct-missing-key-raise-plan.md):
  --    **相容期結束 ⇒ 缺鍵改回 RAISE。** 上面那段「相容期設計」講的是 2026-09-04 的部署順序問題;
  --    唯一呼叫端(manual-order-repository.ts:307)自那天起一律送 boolean, 早已上線 ⇒ 兩個部署順序都不會壞。
  --    ⛔ ~~缺鍵 ⇒ COALESCE 成 true~~ —— 那會替員工決定開發票 +5%, 而且與「員工勾了要開」在資料上分不出來。
  --    ⚠️ 畫面那顆勾選預設不勾(Sean 2026-09-05 / 09-16 兩次拍), 而沒勾時表單靠同名 hidden 送 'off' ⇒ TS 送 false ⇒ 本道不會誤擋。
  --    p_invoice 本身在 :846 已驗過是 object ⇒ 這裡的 `?` 一定有值(不會因 NULL 短路放行)。
  IF NOT (p_invoice ? 'requested') THEN
    RAISE EXCEPTION 'admin_create_manual_order: p_invoice.requested 必填(true / false)—— 沒送就猜 true 會替員工決定開發票 +5%%'
                    USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.jsonb_typeof(p_invoice -> 'requested') <> 'boolean' THEN
    RAISE EXCEPTION 'admin_create_manual_order: p_invoice.requested 送了但不是 true / false'
                    '(收到型別:%)。',
                    pg_catalog.jsonb_typeof(p_invoice -> 'requested')
                    USING ERRCODE = 'P0001';
  END IF;
  v_invoice_requested := (p_invoice ->> 'requested')::boolean;

  -- ── G6 品項:逐筆驗 + 自算金額(**價錢不信 client 送的合計**) ──────────────
  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    v_sku   := pg_catalog.btrim(COALESCE(v_line ->> 'sku', ''));
    v_title := pg_catalog.btrim(COALESCE(v_line ->> 'title', ''));
    IF v_sku = '' OR v_title = '' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 每個品項都要有料號與品名(收到 sku=[%] title=[%])',
                      v_sku, v_title;
    END IF;
    v_qty := NULLIF(v_line ->> 'qty', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量要是正整數', v_sku;
    END IF;
    -- 🔴 codex R1 `:138`:`qty = 2147483647` 配 `unit_price = 0` ⇒ 金額守門**不會紅**
    --    (0 × 任何數還是 0)⇒ 一張「兩億件、零元」的單會真的建出來。
    IF v_qty > c_max_qty THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量 % 超過單筆上限 %;'
                      '真的要這個量 ⇒ 找系統維護(這個上限是保守預設值、未經拍板)',
                      v_sku, v_qty, c_max_qty;
    END IF;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::integer;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的單價要是 0 或正整數', v_sku;
    END IF;
    -- 🔴 代購品項:`variant_id` 允許 NULL(`20260604120000:143`)⇒ 網站上沒有的商品也建得起來。
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::uuid;
    -- 🔵 ⟦b4-SPEC1⟧ 的權威 spec **不在這裡取** —— 見下方 G8 的 INSERT。
    --    🔴 **本檔第一版取在這裡, 而 codex R1 must-fix 1 打穿它**:
    --       這裡在 G6.5 冪等比對【之前】⇒ `v_items` 進指紋 ⇒ 指紋會跟著
    --       `product_variants.spec` 這個**可變的外部狀態**跑。
    --       ⇒ 首次成功之後那個變體的 spec 被改過 ⇒ **同鍵同內容的合法重送算出不同指紋**
    --          ⇒ 被判成「同鍵不同內容」而拒絕;變體被刪掉 ⇒ 直接 RAISE, **連既有那張單都回不了**。
    --    📌 而本函式檔頭 `:207` 自己寫著「重送同一包輸入時 G3-G6 全部是**決定性**的」——
    --       **我那一版把那句話變成假的, 而三綠 / 四個世界 / 四發突變全部沒有紅。**
    --    ⇒ ✅ 分成兩個問題:**指紋回答「這是不是同一個請求」(看呼叫端送什麼);
    --       快照回答「真相是什麼」(看權威)。** 兩者不該共用同一份值。
    -- 🔴 `spec` 只收物件,而且**每個值都必須是字串**(表上 CHECK 會擋,這裡先講清楚)。
    v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb);
    IF pg_catalog.jsonb_typeof(v_spec) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格要是物件', v_sku;
    END IF;
    -- 🔴🔴 codex R1 `:203`:舊版**只驗到這裡為止**,底下三句話是靠
    --    `order_items_snapshot_whitelist` 這道表上的 CHECK 幫我擋的。
    --    ⇒ 那是**別人家的守門**:正式庫若缺它或它漂移了,**本檔的 apply 斷言不會紅**,
    --      而經銷價 / cost 會直接寫進快照裡。⇒ **自己驗一遍**(判準逐字對齊 `20260604120000:157-165`)。
    --    ⚠️ 這不是重複勞動:表上那道是**縱深**,這一道是**訊息** —— CHECK 紅的時候
    --       員工看到的是一串約束名,這裡紅的時候他看得到是哪一個品項的哪一種問題。
    IF NOT public.m3_jsonb_values_all_string(v_spec) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格裡有不是字串的值(數字 / 巢狀物件 / 陣列);'
                      '規格只收「字串對字串」,那是為了擋價格欄藏在巢狀值裡', v_sku;
    END IF;
    IF v_spec ?| ARRAY['price_store', 'price_by_tier', 'cost'] THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格出現價格欄名(price_store / price_by_tier / cost);'
                      '訂單快照**絕不放經銷價與成本**', v_sku;
    END IF;
    -- 🔴 codex R2 `N1`:規格的鍵與值也要 trim —— 它們**進指紋**,而空白差異會讓合法重送被拒。
    --    ⚠️ 順序有意義:**先驗全值皆字串**(上面那道)**才能** `jsonb_each_text`,
    --       否則數字會被靜靜轉成字串、把該紅的那一發變綠。
    v_spec := COALESCE((SELECT pg_catalog.jsonb_object_agg(pg_catalog.btrim(k), pg_catalog.btrim(val))
                          FROM pg_catalog.jsonb_each_text(v_spec) AS t(k, val)), '{}'::jsonb);

    -- 🔴🔴 codex R1 `:186`:舊版**沒有任何跨列比對** ⇒ 員工手滑送兩列同一個變體,
    --    兩列各自計價 ⇒ `subtotal` / `total` **與退款分母**直接加倍。
    --    既有 `create_order` 明文要求同變體合併數量(`20260730120100:323` 逐字:「同變體應合併 qty」)。
    --    ⚠️ **代購品項(`variant_id` 是 NULL)怎麼去重**:它沒有變體可比 ⇒ 退而用 `料號 + 品名` 當鍵。
    --       兩列**料號與品名都一樣**幾乎只會是重送;真的是兩個不同東西 ⇒ 品名寫得出差別。
    -- 🔴🔴 codex R2 `N3`:上一版的代購鍵**只有 sku + 品名** ⇒ 兩個病一起犯:
    --    ① **太窄**:同料號同品名、但**規格或單價不同**的兩個代購品 ⇒ 被錯誤拒絕。
    --       ⚠️ 這一格的後果是**擋到合法的**(這裡是拒絕、不是合併)
    --       ⇒ 修的方向必須是**讓鍵更寬**,不是更嚴。
    --    ② **太鬆**:把品名中間的空白改一下 ⇒ 換一把鑰匙 ⇒ 真正的重複列繞過去。
    --    ⇒ 兩個方向一起修:**加進規格與單價**(變寬)+ **內部連續空白壓成一個**(變嚴)。
    -- 🔴🔴 ⟦b4-INVOICE5PCT⟧二:這一列是不是【員工打含稅價】那一種。
    --    🛑 **缺鍵 = 舊版表單** ⇒ 不 RAISE(先貼 migration 再上碼, 中間那段窗口要活著)。
    v_line_taxed := NULL;
    IF v_line ? 'unit_price_taxed' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'unit_price_taxed') <> 'number' THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_create_manual_order: 品項 [' || v_sku || '] 的 unit_price_taxed 不是數字';
      END IF;
      v_line_taxed := (v_line ->> 'unit_price_taxed')::integer;
      IF v_line_taxed IS NULL OR v_line_taxed < 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_create_manual_order: 品項 [' || v_sku || '] 的 unit_price_taxed 要是 0 或正整數';
      END IF;
    END IF;
    -- 🔵 去重鍵用的【正規化原值】:缺鍵而稅基是 taxed ⇒ 補回舊 app 隱含的那個值。
    -- 🔴🔴 **缺鍵一律補, 不看 `tax_basis`**(codex R3 must-fix 一)——
    --    ⛔ ~~只在 `tax_basis = 'taxed'` 時才補~~ ⇒ 出事世界:同料號同品名同規格、
    --      `unit_price` 都是 1000, 一列 untaxed 一列 taxed 而兩列都缺新鍵
    --      ⇒ 鑰匙一個是 `-` 一個是 `1050` ⇒ **兩列都放行, 成立一張 2,000 的單**,
    --      而**修改前那兩列的鑰匙一模一樣、是被拒的**。
    --      📌 已在拋棄式 PG 上重現:修改前 RAISE「重複品項 [X]」, 修改後回 display_id。
    --    🎯 判準是**「這一列真正的錢」**, 不是它宣告哪個稅基:
    --      · untaxed 1000 與 taxed-缺鍵 1000 ⇒ 庫裡都存 1000、都走正推 ⇒ **同一筆錢** ⇒ 要撞。
    --      · taxed-缺鍵 1000 與 taxed-送 1050 ⇒ 1000 + 正推 50 vs 1000 + 殘差 50 ⇒ **同一筆錢** ⇒ 要撞。
    --      · 含稅 31 與 32(未稅都 30)⇒ **不同筆錢** ⇒ 要分得開。
    --      ⇒ 三個要求同時成立的寫法只有一個:**有鍵用鍵, 沒鍵一律補 `unit_price × 21/20`。**
    v_taxed_key := CASE
      WHEN v_line_taxed IS NOT NULL THEN v_line_taxed::text
      ELSE (v_unit_price::bigint * 21 / 20)::text END;
    -- 🔴🔴 **這一段必須待在 `v_key` 的【上面】**(codex R2 must-fix 三的真正修法)——
    --    ⛔ 出事世界:`v_taxed_key` 在下面才指派 ⇒ 第一圈是 NULL、第二圈拿到**上一列**的值
    --      ⇒ 兩列一模一樣的代購也會拿到兩把不同的鑰匙 ⇒ 📌 **修改前擋得住的重複列, 修改後放行。**
    --    ✅ 先解析 `unit_price_taxed`、先算正規化原值, 鑰匙才拿得到這一列自己的值。
    v_key := COALESCE('variant:' || v_variant_id::text,
                      'custom:' || pg_catalog.lower(pg_catalog.regexp_replace(v_sku,   '\s+', ' ', 'g'))
                        || '|' || pg_catalog.lower(pg_catalog.regexp_replace(v_title, '\s+', ' ', 'g'))
                        || '|' || v_unit_price::text
                        -- 🔴 **含稅原值也要進這把鑰匙**(codex R1 must-fix 四:含稅 31 與 32
                        --    換算後都是未稅 30 ⇒ 舊鑰匙撞在一起, 而它們是兩個不同的應收金額)。
                        -- 🔴🔴 **而它必須【正規化】**(codex R2 must-fix 三)——
                        --    ⛔ ~~直接用 `COALESCE(那個鍵, '-')`~~ ⇒ 出事世界:兩列同料號同品名同規格、
                        --      `unit_price` 都是 1000、`tax_basis` 都是 taxed, 而第一列【缺新鍵】、
                        --      第二列送 1050 ⇒ 鑰匙一個是 `-` 一個是 `1050` ⇒ **兩列都放行**,
                        --      而它們是【同一個 1,050 元的東西】⇒ 📌 **修改前擋得住, 修改後擋不住。**
                        --    ✅ 缺鍵的舊形狀**補回它隱含的原值**:舊 app 那道整除閘只放行除得盡的值
                        --      ⇒ 原值必然是 `unit_price × 21/20` ⇒ 兩邊正規化到同一個數。
                        --    🔵 而 31 與 32 仍然分得開(它們都有鍵, 而值不同)⇒ **兩個要求同時成立。**
                        || '|' || COALESCE(v_taxed_key, '-')
                        || '|' || v_spec::text);
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 重複品項 [%];同一個東西請**合併數量**寫成一列,'
                      '不要送兩列 —— 送兩列會讓總額與**可退金額**都變成兩倍', v_sku;
    END IF;
    v_seen := v_seen || v_key;

    v_line_total := v_unit_price::bigint * v_qty::bigint;
    v_subtotal := v_subtotal + v_line_total;
    IF v_invoice_requested AND v_line_taxed IS NOT NULL THEN
      -- 🔴 **不信 client 送的數**:本函式自己再算一次並比對, 不合就拒。
      IF v_unit_price <> pg_catalog.round((v_line_taxed::numeric) * 20 / 21)::integer THEN
        RAISE EXCEPTION USING MESSAGE = '品項 [' || v_sku || '] 的含稅 ' || v_line_taxed::text || ' 換算回未稅應為 ' || pg_catalog.round((v_line_taxed::numeric) * 20 / 21)::integer::text || ', 而送來的是 ' || v_unit_price::text;
      END IF;
      -- 🎯 殘差【跟著這一列走、乘以數量】⇒ 員工打的含稅數乘以數量剛好回得來。
      v_taxed_residual := v_taxed_residual + (v_line_taxed - v_unit_price)::bigint * v_qty::bigint;
    ELSE
      -- 🔴🔴 **沒勾發票【也要驗一致】**(codex R2 must-fix 二)——
      --    ⛔ ~~沒勾就完全不看那個鍵~~ ⇒ 出事世界:送 `unit_price=1` 配 `unit_price_taxed=1050`
      --      ⇒ 型別與範圍都過、換算比對被跳過 ⇒ 📌 **成立一張 1 元的單, 而稽核留著 1,050。**
      --      而**修改前那組矛盾輸入是被拒的**。
      --    ✅ 沒勾 ⇒ 他打的數字即總額 ⇒ 那兩個數**必須相等**, 不相等就是呼叫端壞了。
      IF v_line_taxed IS NOT NULL AND v_line_taxed <> v_unit_price THEN
        RAISE EXCEPTION USING MESSAGE = '品項 [' || v_sku || '] 沒有勾開發票, 而送來的含稅原值 ' || v_line_taxed::text || ' 與單價 ' || v_unit_price::text || ' 不一樣 ⇒ 沒勾發票時他打的數字即總額, 兩者必須相同';
      END IF;
      -- 🔵 未稅那些列(與沒勾發票的每一列)才進【正推】的稅基。
      v_untaxed_base := v_untaxed_base + v_line_total;
    END IF;
    -- 🔴 **括號在這裡是承重的**:`v_items` 是【陣列】而 `||` 對它是「加一個元素」,
    --    對兩個 jsonb 物件則是「合併」⇒ 沒有括號的話 `v_items || A || B` 會**加兩個元素**
    --    ⇒ 📌 本函式自己那道「三個陣列長度不一致」的斷言當場抓到了(items 4 / ids 2 / bases 2)。
    v_items := v_items || (pg_catalog.jsonb_build_object(
      'variant_id', v_variant_id,
      'variant_sku', v_sku,
      -- 🔴 exact-key 白名單:title / sku / spec 三鍵,**不得把員工輸入原樣塞進去**
      --    (`order_items_snapshot_whitelist`:多一鍵整筆回滾)。
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_title, 'sku', v_sku, 'spec', v_spec),
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'line_total', v_line_total)
      -- 🔴🔴 **含稅原值要進 `v_items`, 因為冪等指紋是從它算的**(codex R1 must-fix 一):
      --    含稅 31 與 32(未稅都 30)否則指紋一模一樣 ⇒ 第二次回第一張 31 元的單。
      -- 🔴🔴 **而【缺鍵時絕對不能加一個 null 進去】**(codex R2 must-fix 一)——
      --    出事世界:貼之前建單成功而回應遺失;貼之後舊表單拿同一顆 request_id、
      --    **完全相同的內容**重送(而它根本沒送這個鍵)⇒ 若這裡塞 `"unit_price_taxed": null`,
      --    指紋就變了 ⇒ 📌 **回 P858B, 那張已經成立的單再也取不回來。**
      --    ⇒ ✅ **有鍵才加** ⇒ 舊形狀的指紋與貼之前【逐位元相同】, 而 31/32 仍分得開。
      || CASE WHEN v_line_taxed IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('unit_price_taxed', v_line_taxed) END);

    -- ══ 第 7 代:把這一列的稅基收起來, 等一下寫進 audit ═══════════════════════
    -- 🔵 **缺鍵 ⇒ NULL, 不是報錯** —— 部署順序是「先貼 migration、再上碼」
    --    ⇒ 中間那段窗口裡, **舊版表單不會送這個鍵**。報錯的話那段窗口所有手動單都建不出來。
    --    ⇒ 📌 而 NULL 在 audit 裡是誠實的:它的意思是「這一筆沒有人告訴我」。
    -- 🛑 **已知未關的缺口**:窗口過後「舊呼叫端沒送」與「真的缺」仍然都是 NULL, 分不出來。
    --    要關掉需要**之後另一支 migration** 把缺鍵改成 RAISE ⇒ 那支還沒有人排, 所以寫在這裡。
    -- 🔴 **第三種值一律拒** —— 同本函式對 order_source / payment_channel 的做法:
    --    「看不懂就當未稅」會讓一個壞掉的表單靜默送出一個**沒有人宣告過**的稅基。
    -- 🔴🔴 **「缺鍵」與「送了一個空的」要分得開**(codex R4 2026-09-09 must-fix ④, 它對)。
    --    ⛔ ~~`v_line_basis := NULLIF(v_line ->> 'tax_basis', '');`~~ —— 那一版有兩條路悄悄變成 NULL:
    --      `{"tax_basis": ""}` 被 `NULLIF` 轉成 NULL · `{"tax_basis": null}` 經 `->>` 也是 NULL
    --      ⇒ 📌 **兩者都跳過下面那道 RAISE, 留下與「舊版沒送鍵」一模一樣的紀錄。**
    --      而它們的意思完全不同:一個是「那個版本還沒有這一格」, 另一個是**表單壞了**。
    --    ✅ 改成先用 `?` 問【鍵在不在】, 只有**缺鍵**才准是 NULL。
    --    🔵 `?` 是 jsonb 的存在運算子;運算子住在 `pg_catalog`, 而 `pg_catalog` 永遠隱含可見
    --      ⇒ `SET search_path = ''` 之下照樣解析得到(與本函式其他 `->>` / `||` 同理)。
    IF v_line ? 'tax_basis' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'tax_basis') <> 'string'
         OR (v_line ->> 'tax_basis') NOT IN ('untaxed', 'taxed') THEN
        RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的稅基 [%] 不是 untaxed / taxed',
                        v_sku, COALESCE(v_line ->> 'tax_basis', '<null>');
      END IF;
      v_line_basis := v_line ->> 'tax_basis';
    ELSE
      -- 🔵 **只有這一條路允許 NULL** —— 部署順序是「先貼 migration、再上碼」,
      --    中間那段窗口舊版表單不送這個鍵。報錯的話那段窗口所有手動單都建不出來。
      v_line_basis := NULL;
    END IF;
    -- 🔵 **`unit_price` 一起記** —— 它是【送進來的那個值】(表單那一側已經換算過了)。
    --    配上這一列的 `tax_basis` 與這張單的 `invoice_requested`, 三個湊起來就答得出
    --    「他當初打的是哪個數字、當成什麼」:
    --      勾了 + taxed ⇒ 他打的是 unit_price × 21/20   ·   沒勾 ⇒ 他打的就是 unit_price
    -- ✅ **這一列的 id 在這裡就決定**, 下面的 INSERT 明確寫它, 稽核記同一個。
    --    ⇒ 📌 **稽核那一列與 `order_items` 那一列從此靠【同一個 uuid】綁著, 不靠任何會變的值。**
    --    🔵 只記三樣:id + 稅基 + **建單當下**的單價。單價記的是「那一刻是多少」——
    --      它日後可能被 `admin_update_order_item_amount` 改掉, 而**那正是要留一份原值的理由**。
    --    🛑 **不記品名 / 規格 / 料號** —— 那些是自由文字, 抄進 append-only 的表就是多一份
    --      會過期、會外洩的副本(本函式 G9 那段逐字)。要看它們 ⇒ 拿 id 去 `order_items` 查。
    v_item_id := pg_catalog.gen_random_uuid();
    v_item_ids := v_item_ids || pg_catalog.to_jsonb(v_item_id);
    v_line_bases := v_line_bases || pg_catalog.jsonb_build_object(
      'order_item_id', v_item_id,
      'tax_basis',     v_line_basis,
      'unit_price',    v_unit_price,
      -- 🔴🔴 **原始含稅價要留下來**(codex R1 must-fix 三):A/B 兩列含稅 31/32 與 32/31
      --    在庫裡長得一模一樣(單價 30/30)⇒ 事後分不出哪一列原本收多少,
      --    而 `30 × 21/20 = 31.5` **還原不回去** ⇒ 📌 那是資料遺失。
      -- 🛑 **而【舊資料沒有這一格】** —— 貼之前建的單只有未稅價, 那些單的原值
      --    **不能用乘法還原**(codex R2 nit 三)。有這個鍵才讀它, 沒有就是沒有。
      'unit_price_taxed', v_line_taxed);
  END LOOP;

  -- ══ 第 6 代:稅在這裡算(Sean 2026-09-05 拍甲)═══════════════════════════════
  -- 🔴 **稅基 = 小計 + 運費 − 折扣**。而 `discount_total` 在本函式**寫死成 0**(見下面 INSERT)
  --    ⇒ 折扣那一項今天**恆為 0**, 而算式仍然把它寫出來:它天生正確, 且折扣功能上線那天不必再改一次。
  --    ⚠️ **而那也代表「折扣在稅前」這條規則今天走不到任何一條路** ⇒ 它未被任何測試涵蓋。
  -- 🔴 **先轉 `numeric` 再 `ROUND`** —— `numeric` 的 `ROUND` 對 `.5` 是**遠離零**(四捨五入),
  --    而 `double precision` 是銀行家捨入(進偶數)。營業稅尾數依財政部法規是四捨五入
  --    ⇒ 📌 **型別決定了合不合法, 那不是風格。**
  IF (v_subtotal + p_shipping_fee - 0) < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稅基是負的(小計 % + 運費 % − 折扣 0)⇒ 拒絕建單。'
                    '請檢查品項金額與運費。', v_subtotal, p_shipping_fee;
  END IF;
  -- ══ 第 7 代:**稅只有在「這張單要開發票」時才加**(⟦b4-INVOICE5PCT⟧)══════════
  -- 🔴 **Sean 2026-09-04 16:2x 逐字**(`~/pcm-mailbox/Sean拍板-20260904-七題.md:363`):
  --    「我們傾向於我輸入單價，然後勾選開發票自己幫我+5 %上去，
  --      **那如果我沒有勾選開發票價錢都不加**」
  --    ⇒ 同一份檔 `:367-369` 已整理成規格:勾了 ⇒ +5%;**沒勾 ⇒ 價錢都不加**。
  -- 🛑 **第 6 代的 `v_tax :=` 是無條件的** ⇒ 沒勾也加了 5%, 而那顆勾選**預設不勾**
  --    (`manual-order-form-body.tsx:234` 逐字「預設不勾選,也就是預設不開發票」)
  --    ⇒ 📌 **不加稅才是常態路徑, 而它一直在加。** 本段就是那一格。
  -- 🔴 **沒勾那一邊為什麼是 `inclusive` 而不是 `exclusive` + 稅 0**:
  --    Sean 同段逐字「**沒勾就是他打的數字即總額**」⇒ 那張單沒有另計的稅
  --    ⇒ `inclusive` 正是 `orders.price_tax_mode` 的 DEFAULT、也是第 6 代之前每一張單的語意
  --    ⇒ 🎯 **沒勾那條路 = 回到第 6 代之前的行為, 一個位元都沒有多。**
  --    🛑 **而寫成 `exclusive` + 稅 0 會有一個看不見的副作用**:
  --       `admin_update_order_item_amount` 的 `pcm_e13_no_edit_when_taxed`(本檔下游, 未改)
  --       判準逐字是 `price_tax_mode = 'exclusive' OR tax_total <> 0`
  --       ⇒ 一張**沒有稅**的單會被擋著不給改金額, 而員工看到的是一句在講稅的錯誤訊息。
  -- ⚠️ **這一格是【判斷】不是拍板** —— Sean 說的是「價錢都不加」, 沒有說欄位填什麼。
  --    理由寫在上面兩點, 而 `⟦b4-INVOICE5PCT⟧` 那一列要記著它可翻。
  -- 🔵 **負稅基閘與溢位閘刻意留在 IF 外面** —— 它們是這張單的不變式, 不是稅的附屬品;
  --    沒勾那一邊 `v_tax = 0`, 兩道閘照樣成立而且零成本。
  IF v_invoice_requested THEN
    -- 🔴🔴 ⟦b4-INVOICE5PCT⟧二:【混單】要分開算(整包正推會讓員工打的含稅數字回不來)。
    --    ⚠️ **運費永遠進正推那一邊** —— 本函式收不到運費的稅基(見本片 migration 檔頭)。
    v_tax := pg_catalog.round(((v_untaxed_base + p_shipping_fee - 0)::numeric) * 0.05)::bigint
             + v_taxed_residual;
    v_price_tax_mode := 'exclusive';
  ELSE
    v_tax := 0;
    v_price_tax_mode := 'inclusive';
  END IF;
  -- 🔴 **溢位那道連 `v_tax` 一起看** —— 照 `20260604130000:229` 同一種寫法, 不自創第二種。
  --   #953 P2(20260915060000):拆成兩段 —— 元件先驗(要 ::integer 餵函式), 總額後驗;訊息同一句。
  IF v_subtotal > 2147483647 OR v_tax > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;
  -- #953 P2:總額等式只住 public.pcm_order_total()(20260915030000)。手動單沒有折扣 ⇒ 第三項明寫 0,
  --   與下面 INSERT 那一行顯式寫的 discount_total 0 同一個事實。
  v_total := public.pcm_order_total(v_subtotal::integer, p_shipping_fee, 0, v_tax::integer);
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════════

  -- ── G6.5 冪等格(codex R1 `:143`;形狀照退款 RPC `20260820021000:245-270`)─────
  -- 🔴🔴 **這一段的上一版是一句假話,而它讀起來像一句保證**(codex R2 `N1` 抓到):
  --    ~~「多打一個空白、鍵的順序不同、發票欄位給了 NULL,都不會被誤判成不同內容」~~
  --    R1 當下的實情是:**發票與規格根本沒有 trim,品項也照原順序進指紋**
  --    ⇒ 那三件事**每一件都會**讓合法重送被拒。
  --    ⚠️ 這句話的危害不只是錯:**它會讓下一個人不去測那三件事** —— 我自己就沒測。
  --    ⇒ R2 把碼補齊之後,下面這句話**現在才成立**,而它成立是因為有三件事真的做了:
  --      ① 收件 / 發票 / 規格的鍵與值**全部 btrim**(空白只打了空白 ⇒ 等於沒填)
  --      ② 品項**排序後**才進指紋(順序不再影響指紋)
  --      ③ `jsonb` 本身把鍵排序、重複鍵消掉(這一件是 PG 給的,不是我做的)
  --    ⇒ 多打一個空白、品項換順序、鍵的順序不同、發票欄位給了 NULL,**都不會**被誤判成「不同內容」。
  --    📌 三件事各有一格負測釘著(`docs/probes/2026-08-24-858-manual-order-rpc-r2-negatives.sql` 的 R2-1b/1c/1e),不是只有這段話。
  -- ⚠️ **上限(誠實揭示)**:比的是**指紋**,所以只答得出「一樣 / 不一樣」,
  --    答不出**哪一欄**不一樣 —— 退款 RPC 那支比得出來,因為它比的是欄位。
  --    這裡的輸入是一整包(含品項陣列),逐欄比會隨著欄位增加而**靜靜漏掉新欄**;
  --    指紋不會漏,代價就是訊息比較鈍。**這是選擇,不是疏忽。**
  -- ⚠️ 另一格上限:`jsonb::text` 的輸出在**同一個 PG 大版本內**是決定性的(鍵已排序、
  --    重複鍵已消)。跨大版本若渲染改變 ⇒ 舊指紋對不上 ⇒ 會被判成「內容不同」而**拒絕**
  --    ⇒ 方向是 fail-closed(擋下來、不是放行)。
  -- 🔴 **`p_actor` 刻意【不進指紋】** —— 這是與 `20260820021000` 的**有意分歧**,不是漏掉:
  --    那支把 actor 放進逐欄比對,結果它必須為此寫一整段訊息教人怎麼辦
  --    (`:262-264` 逐字:「若你是在重送同一筆(**例如原經手人已停用而你換了人**)
  --     ⇒ 不要用新的 request_id」)。
  --    ⇒ 指紋要回答的問題是「**這是不是同一張單**」,而**誰按下送出不會改變那張單**。
  --      同事幫忙重送同一包內容 ⇒ 應該拿到 idempotent,不該被判成「內容不同」。
  --    ⇒ 「**誰建的**」由 `admin_audit_log` 那一列回答,那才是它該住的地方。
  --    ⚠️ **代價講明(2026-08-24 擴寫:我原本只寫了併發那一半,而它比那寬)**:
  --       **任何重送**,audit 都只會有**最初建單那一位**。
  --       · 併發:後到那發拿 `P858A`、不落 audit(它什麼都沒建)。
  --       · **非併發**:A 建單、B 一小時後拿同一顆 id 重送 ⇒ 回 `idempotent` ⇒ **B 這次操作零紀錄**。
  --    🔴 而**後者正是本設計自己舉的主要使用情境**(「原經手人已停用而你換了人」)
  --       ⇒ 它是**常態,不是邊角**。~~原本寫「併發時」~~ 那個限定把常態寫成了例外。
  --    ✅ 而這**不是缺陷**:B 沒有建單。`admin_audit_log` 記的是「**建單**」事件,不是「**請求**」事件
  --       ⇒ 不記 B 是**一致的**。⚠️ 但「誰碰過這張單」這條線索**確實不在系統裡** —— 要就得另立事件。
  -- 🔴🔴 **正規化要在指紋【之前】** —— 否則 `'a@b.c'` 與 `' a@b.c '` 會算出兩個指紋,
  --    而它們是**同一個請求** ⇒ 合法重送被判成「同鍵不同內容」而被拒。
  --    📌 這與同檔 `:420` 對規格鍵值做 trim 的理由**逐字是同一條**(codex R2 `N1`)。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴 —— 它是【SQL 語法構造】, 不是函式。**
  --    ⚠️ **本檔 `:245-247` 逐字警告過這一格, 而我照樣寫成了 `pg_catalog.nullif(...)`**
  --       ⇒ code-reviewer 2026-09-05 抓到(must-fix 1)。它會在**執行期**炸
  --         `function pg_catalog.nullif(text, unknown) does not exist` —— 而 **apply 全綠**。
  --    📌 **一段寫在同一支檔裡、講得完全正確的警告, 沒有阻止寫它的那個人再犯一次。**
  --       ⇒ 擋住它的不是那段字, 是一發【真的呼叫】(§7b)。
  -- 🔵 `btrim` 的字元集對齊同檔 `p_actor`(`:163`/`:168`)—— 只剝空格會讓
  --    貼上時帶進來的尾端換行留著, 而 CHECK 的 `~ '^[!-~]+$'` 不成立 ⇒ 整張單被擋、
  --    訊息只有約束名。fail-closed, 而那不是我們要給員工看的訊息。(nit 3)
  v_notification_email := NULLIF(pg_catalog.btrim(p_notification_email, E' \t\r\n'), '');

  v_canonical := pg_catalog.jsonb_build_object(
    'customer_user_id', p_customer_user_id,
    'order_source',     p_order_source,
    'payment_channel',  p_payment_channel,
    'shipping_method',  p_shipping_method,
    'shipping_fee',     p_shipping_fee,
    'ship_to',          v_ship_to,
    'invoice',          v_invoice,
    -- 🔴 第④代:**開不開發票要進指紋** —— 少了它, 「只改了這一格再送一次」會被
    --    判成「內容相同」⇒ 回上一張單 ⇒ **員工以為改掉了而其實沒有**。
    -- ⚠️ **代價寫出來**:指紋多一個鍵 ⇒ apply 之後算出來的 sha 與 apply 之前**不同**。
    --    ⛔ ~~我原本寫「窗口 = 貼這支的那幾秒」~~ —— **那句話寫窄了**(codex R2 must-fix):
    --    🔴 **apply 之前建立的每一顆 `manual_request_id`, 它的 sha 是用【舊指紋】算的,
    --       而那個值已經落表、永遠不會重算** ⇒ 那些單**在任何時候**被原樣重送, 都會算出新 sha
    --       ⇒ 判成 `P858B`(內容不同)。⇒ **不是幾秒, 是【所有舊單, 永久】。**
    --    ✅ **而它為什麼仍可接受**:重送只發生在「員工按了送出而沒看到結果」那一刻的補救,
    --       而那是**當下**的動作 —— 沒有人會去重送一張三天前的單。⇒ 影響面 = apply 那一刻
    --       正在飛的請求, 而 Sean 手動在安靜時段貼。
    --    🛑 **但那是一個【業務面的判斷】, 不是資料面的保證** —— 真的撞到 `P858B` 的人看到的
    --       是「內容不同」而他明明沒改東西 ⇒ 📌 那句錯誤訊息在這個情境下會誤導他。已知, 未修。
    'invoice_requested', v_invoice_requested,
    'notification_email', v_notification_email,
    -- 第 8 代:等級進指紋(主視窗裁, 理由同第④代 invoice_requested:它改變落表內容, 「只改了這一格再送」不可以被判成同內容)。
    --    代價同上面那段:apply 之前建立的舊 request_id 原樣重送會被判 P858B。
    -- 🔴 進指紋的是【員工送來的值 p_tier】不是算出來的 v_tier(codex 2026-09-14 R1 must-fix ①):
    --    v_tier 在沒帶 tier 時 = 客人【當下】的等級 ⇒ 建單成功而回應斷掉、客人等級中間被改、同鍵原樣重送 ⇒ P858B。
    --    p_tier 是請求本身的一部分, NULL 就是 NULL, 重送恆等。
    'tier',             p_tier,
    -- 🔴🔴 codex R2 `N1`:上一版直接把 `v_items` **照員工送來的順序**丟進指紋
    --    ⇒ 同樣的品項換個順序 ⇒ 指紋不同 ⇒ **合法重放被判成「內容不同」而拒絕**。
    --    ⇒ 排序後再算。排序鍵用 `x::text`:jsonb 轉文字時鍵已排序、重複鍵已消
    --      ⇒ 同一個 jsonb 值恆得同一個字串 ⇒ 是個穩定的鍵。
    --    ⚠️ **只有指紋排序,落表的 `order_items` 仍照員工原順序** —— 那是他要看的順序。
    'items',            (SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x::text), '[]'::jsonb)
                           FROM pg_catalog.jsonb_array_elements(v_items) AS x));
  -- 第 9 代:車輛進指紋【只在有填時】(codex R1 must-fix ②):沒填就一個鍵都不加 ⇒ 第 8 代建的單、回應斷掉、原樣重送舊 12 參
  --    ⇒ 指紋與落表的 sha 相同 ⇒ 仍回 idempotent, 不會被判 P858B。用重組後的 v_vehicle(由 p_vehicle 決定, 與客人狀態無關, 重送恆等)。
  IF v_vehicle IS NOT NULL THEN
    v_canonical := v_canonical || pg_catalog.jsonb_build_object('vehicle', v_vehicle);
  END IF;
  v_payload_sha := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8')), 'hex');

  SELECT o.id, o.display_id, o.manual_request_payload_sha256 INTO v_existing
    FROM public.orders o
   WHERE o.manual_request_id = p_manual_request_id;
  IF FOUND THEN
    IF v_existing.manual_request_payload_sha256 IS NOT DISTINCT FROM v_payload_sha THEN
      -- 同一顆鍵、同一包內容 ⇒ 這就是重送。回既有那張單。
      RETURN pg_catalog.jsonb_build_object(
        'order_id', v_existing.id, 'display_id', v_existing.display_id, 'idempotent', true);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**(合約逐字對齊 `20260820021000:257`)
    -- 🔴 codex R2 `N2` 連帶:這一條與上面那條的**下一步完全相反**
    --    (那條要「原樣重送」,這條是「**不准重送**」)⇒ 呼叫端必須分得出來
    --    ⇒ 兩條都給代碼,不能只給一條。
    RAISE EXCEPTION 'admin_create_manual_order: 這個建單請求的編號已經用過了,而**內容不一樣** ⇒ 拒絕。'
                    '🔴 **呼叫端合約**:SQLSTATE P858B / constraint pcm_858_manual_order_payload_mismatch ⇒ '
                    '**不要重送**(重送幾次都會是同一個答案)。'
                    '🔴 這不是「重複建單」的警告 —— 系統裡那張單(%)與你這次送來的至少有一處不同'
                    '(客人 / 品項 / 數量 / 單價 / 運費 / 收件資料 / 發票 / 來源 / 付款方式)。'
                    '⚠️ **先確認你要的是哪一件事**:'
                    '① 要**改**那張既有的單 ⇒ 去那張單上改,不要用建單重送(這裡不會幫你覆蓋它);'
                    '② 這是**另一張**單 ⇒ 請重新開一張建單表單(它會產一顆新編號),'
                    '   不要把舊表單改一改再送 —— 那顆編號綁的是**上一次那包內容**。',
                    v_existing.display_id
                    USING ERRCODE = 'P858B',
                          CONSTRAINT = 'pcm_858_manual_order_payload_mismatch';
  END IF;

  -- 🔴 稽核 P0-2(20260915233000):客人層級 advisory lock —— key 與 create_order(20260915100000:262)、
  --    begin_charge_attempt(20260904050000)逐字同一個算法。補登記收款判「客人是否已另下新單」時拿同一把,
  --    兩邊序列化:補登先拿到 ⇒ 這裡等它 commit 再建;這裡先拿到 ⇒ 補登等這張單 commit 之後才看得到它。
  --    位置:G7 之前的輸入驗證與冪等早退之後、INSERT 之前 ⇒ G7 之前被拒的呼叫與同鍵重送不排隊
  --    (G7 之後仍有規格驗證,那種失敗會先等到鎖才被拒)。本函式拿鎖之後不再鎖任何既有訂單列。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_user_id::text, 0));

  -- ── G7 建單(display_id 有界重試;形狀照 create_order `:432-463`) ───────────
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();
      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
        invoice_requested,
        -- 🔴 **`tax_total` 顯式寫 0(片 B2丙, 2026-08-29)** —— 不是「忘了寫所以走 DEFAULT」。
        --
        -- 🔴🔴 **而這個 0 是一個【假設】, 不是一個保證。codex 2026-08-29 must-fix, 它是對的。**
        --    ~~我原本寫「為什麼 0 是對的:單價來自 `price_general`, 而它含稅」~~ **那句話太寬**:
        --    **那是【今天唯一那個呼叫端】的性質, 不是【本函式的契約】。**
        --    本函式**直接收** `p_lines.unit_price`, 而它:
        --      · **不查也不驗** `price_general`
        --      · 代購品項(`variant_id` 是 NULL)的單價是**員工自己打的**
        --      · `p_shipping_fee` 同樣沒有任何「已含稅」的保證
        --      · 其他 service_role 呼叫端可以送任意合法非負單價
        --    ⇒ **有人送未稅價進來時, `tax_total = 0` 會少收稅。**
        --
        --    **⇒ 所以這一行的正確講法是**:
        --      「**假設**送進來的每一筆單價與運費都是【含稅】的 ⇒ 稅已內含在 `total` 裡 ⇒ `tax_total = 0`。
        --        而**本函式不強制那個假設**。」
        --    ✅ **今天那個假設成立**, 因為唯一的呼叫端是後台建單, 而它的目錄
        --       **只讀 `price_general`**(`apps/admin/src/lib/orders/manual-order-catalog.ts:84` 欄位表逐字),
        --       而 `price_general` 是含稅的(Sean 2026-08-29 逐字:
        --       「網站售價都含稅沒問題, 但是經銷價都是未稅。」)
        --    ⚠️ **而代購品項那一格【今天就已經沒有保證】** —— 它的單價是人打的。
        --       本片**沒有**擋它, 也沒有替它算稅 ⇒ **那是一個已知缺口, 寫在這裡而不是被靜靜帶過。**
        --
        -- 🔴 **⇒ 契約落地之前, 不得無條件宣稱這個 0 是對的。**
        --    要讓它變成保證, 需要下面「下一片」清單裡的第 1、2 項(價格基礎欄位 + 參數)。
        --    🔴 **而【那一天】要改這裡**:後台建單那顆兩段切換([定價][經銷])一旦做出來,
        --       經銷價(**未稅**)就會第一次變成訂單金額
        --       ⇒ 那一刻本行要開始**真的算稅**
        --       (進位依據:營業稅法 §14 第一項「尾數不滿通用貨幣一元者, 按四捨五入計算」)
        --    ⚠️ **而【不要】把它讀成 `ROUND(未稅小計 × 0.05)` 就好**(codex 2026-08-29 consider):
        --       那個式子**沒有處理**:應稅運費(營業稅法 §16:價額外收取的一切費用都進銷售額)、
        --       折扣怎麼分攤、代購品項的稅制、免稅品項。
        --       ⇒ **真正的算式要等【價格基礎與稅基契約】落地之後才寫得出來**
        --       ⇒ **這段註解不是規格。**
        --    ⚠️ **而本函式今天沒有任何參數說得出「這張是定價單還是經銷單」** ——
        --       那顆切換要加參數 ⇒ 而 `CREATE OR REPLACE` 加不了參數 ⇒ 要 `DROP + CREATE`。
        tax_total,
        order_source, payment_channel, manual_request_id, manual_request_payload_sha256,
        notification_email,
        -- 第 9 代:這張單一台車(顧客站的單這欄恆 NULL, 它的車在品項上)。
        vehicle_snapshot,
        -- 🔴 **第 6 代新增**:這張單的單價是【未稅】的 ⇒ 顯式寫 'exclusive'。
        --    🛑 **不可以靠 DEFAULT** —— DEFAULT 是 'inclusive'(顧客站與所有既有單),
        --       走 DEFAULT 等於讓這張單**自稱含稅**, 而它的 `subtotal` 是未稅的。
        price_tax_mode
      ) VALUES (
        v_display_id, p_customer_user_id, NULL, v_ship_to, v_tier,
        v_subtotal::integer, p_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice,
        v_invoice_requested,  -- 🔴 顯式寫入,**不是走 DEFAULT** —— 走 DEFAULT 就等於忽略員工那一勾。
        v_tax::integer,  -- 🔴 **第 6 代:這裡不再是 0** —— ⛔ ~~顯式的 0,不是預設的 0~~
                         --    舊字面留刪除線:搜「顯式的 0」的人要同一發撞到這裡。
        -- 🔴 這兩欄顯式寫。不寫的後果見檔頭 §2。
        p_order_source, p_payment_channel, p_manual_request_id, v_payload_sha,
        v_notification_email,
        v_vehicle,
        v_price_tax_mode
      )
      RETURNING id INTO v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴🔴 codex R1 `:248`:**這條路不得回 `idempotent: true`。**
      --    舊版在這裡直接把既有那張單回出去 —— 而**它從來沒有比對過對方寫了什麼**
      --    ⇒ 上面 G6.5 那道逐內容比對,在「兩發並行」這條路上等於不存在。
      --    ⇒ 處置逐字沿用退款 RPC 對同一條路的定位(`20260820021000:311-316`):
      --      **拒絕本次、請呼叫端重試一次** —— 重試時 G6.5 就看得到那一列,也就會比對內容。
      --    ⚠️ 走到這裡只有一種情況:兩發並行、兩發都在 G6.5 查無、其中一發先寫進去。
      IF v_cname = 'orders_manual_request_id_uniq' THEN
        -- 🔴🔴 codex R2 `N2`:**上一版這裡是一顆沒有代碼的 RAISE,而它對呼叫端說「請重送」。**
        --    那句話有一個致命前提:**重送的人要用同一顆 request id。**
        --    而**今天 repo 裡沒有任何呼叫端實作那件事** ⇒ 前端最可能的行為是
        --    「這次失敗了 ⇒ 開新表單 ⇒ 產一顆新 id ⇒ 再送」
        --    ⇒ 🔴 **第一張單其實已經建好了,於是變成兩張真訂單、要出兩次貨。**
        --    ⇒ 病灶不是訊息寫得不夠清楚:**是我把一個決定交給了一個還沒被寫出來的呼叫端**,
        --      而它的預設行為剛好是錯的那一邊。
        --    ⇒ 修法=給它**機器讀得懂的把手**(SQLSTATE + CONSTRAINT token,體例照 repo 既有
        --      `P2B02` 那族),而不是只給人看的字。
        RAISE EXCEPTION 'admin_create_manual_order: 同一個建單請求正在被並行送出 ⇒ 拒絕本次。'
                        '🔴 **呼叫端合約(這一句是給程式看的,不是給人看的)**:'
                        '收到 SQLSTATE P858A / constraint pcm_858_manual_order_concurrent_request ⇒ '
                        '**保留同一顆 manual_request_id 原樣重送**,'
                        '⚠️ **絕對不要產生新的 manual_request_id** —— '
                        '這一刻另一發很可能已經成功建好那張單了,換新 id 會建出【第二張真訂單】。'
                        '重送時會走內容比對:內容相同 ⇒ 回那張已建好的單(idempotent:true);'
                        '內容不同 ⇒ 回 P858B。'
                        USING ERRCODE = 'P858A',
                              CONSTRAINT = 'pcm_858_manual_order_concurrent_request';
      END IF;
      -- 🔴 只吞 display_id 的碰撞;其他 unique violation 原樣上拋(重試會把語意訊號吃掉)。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        RAISE EXCEPTION 'admin_create_manual_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 建單迴圈離開時沒有訂單 id;拒絕繼續';
  END IF;

  -- ── G8 品項落表 + 筆數守 ───────────────────────────────────────────────────
  -- ══ 🔴🔴 ⟦b4-SPEC1⟧ codex R2 MF1:**真正落表的是 `pv.spec`, 而上面三道驗證驗的是呼叫端那一份** ══
  --   G6 那三道(值全字串 / 不得含價格欄 / 是物件)跑在迴圈裡, 吃的是 `v_line -> 'spec'`。
  --   而本片把落表的值換成了 `pv.spec` ⇒ **被驗的與被寫的不再是同一個東西。**
  --   📌 這正是本片自己製造的:改之前它們是同一份, 所以那三道涵蓋得到;改之後就不是了,
  --      **而那三道一個字都不用改就會繼續全綠。**
  --   ⚠️ 今天 `order_items_snapshot_whitelist` 那道表上的 CHECK 仍會擋 ⇒ 不是立即可利用;
  --      🔴 而那是**別人家的守門** —— 正式庫若缺它或它漂移了, 經銷價 / cost 會直接寫進快照。
  --      (本函式檔頭 codex R1 `:203` 講過同一句話, 而本片讓它重新成立。)
  --   ⇒ 自己驗一遍, 判準逐字對齊上面那兩道。
  --
  --   🛑🛑 **codex R3:這一道【不是原子的】, 而我原本沒有講。**
  --      這個 `EXISTS` 與下面那個 `INSERT` 是**兩個 statement**;本函式跑在 READ COMMITTED
  --      ⇒ 兩者各自取一次快照 ⇒ **供應商同步若剛好夾在中間, 會「驗 A 而寫 B」。**
  --      📌 ⇒ 所以這一道的正確定位是**訊息**, 不是防線 —— 它讓員工看得懂哪裡不對,
  --         而**原子的保證來自 `order_items_snapshot_whitelist` 那道表上的 CHECK**
  --         (同一句 INSERT 裡求值 ⇒ 沒有中間狀態)。
  --      ⚠️ **而那正好是本函式檔頭 codex R1 `:203` 說的「別人家的守門」** ——
  --         ⇒ 兩句話一起讀才是完整的:**它是別人家的, 而它是這裡唯一原子的那一道。**
  --      🔴 **我沒有把這道合進 INSERT** —— 那要嘛用 CTE 重寫整段、要嘛在 SQL 裡想辦法 RAISE,
  --         兩條都會把一支「只加一個覆蓋」的 migration 變成重寫 G8。**那是另一片。**
  --         ⇒ 已明寫, 不假裝這裡是原子的。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_items) AS it
      JOIN public.product_variants AS pv
        ON pv.id = NULLIF(it ->> 'variant_id', '')::uuid
     WHERE NOT public.m3_jsonb_values_all_string(pv.spec)
        OR pv.spec ?| ARRAY['price_store', 'price_by_tier', 'cost']
  ) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 權威規格本身不合格(有非字串值, 或出現價格欄名)'
                    ' —— 這不是員工送錯, 是 product_variants.spec 那一列要先修好';
  END IF;

  -- ══ 🔴 三個陣列必須等長, 不等長就停(codex R6 2026-09-09 nit)═══════════════
  --   `v_items`(要插的列)· `v_item_ids`(它們的 id)· `v_line_bases`(稽核那一份)
  --   是**同一個迴圈裡平行 append 的三份**, 而下面靠「第 n 筆對第 n 筆」把它們接起來。
  -- 🛑 **今天走不到這一格** —— 迴圈裡沒有 `CONTINUE`、沒有早退, 三個一定同步。
  --   ⇒ 📌 **所以它不是在修一個現在的 bug, 是在釘住一個【維護時很容易破壞】的不變式**:
  --     未來有人在「append id」與「append v_items」之間插一個 `CONTINUE`,
  --     多出來的 id 會被 INSERT **靜靜忽略**, 而稽核那一份已經 append
  --     ⇒ 留下一筆**指向不存在品項**的稽核紀錄。
  -- 🔴 **而那個世界【今天沒有任何東西會叫】**:短的那一邊會撞主鍵 NOT NULL 而紅,
  --   **長的那一邊不會** —— 兩個方向的傷害不對稱, 而不會叫的那個方向才是安靜的那個。
  IF pg_catalog.jsonb_array_length(v_item_ids) <> pg_catalog.jsonb_array_length(v_items)
     OR pg_catalog.jsonb_array_length(v_line_bases) <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 內部三個陣列長度不一致(items % / ids % / bases %)'
                    ' ⇒ 稽核會指到不存在的品項, 整筆停下。',
                    pg_catalog.jsonb_array_length(v_items),
                    pg_catalog.jsonb_array_length(v_item_ids),
                    pg_catalog.jsonb_array_length(v_line_bases);
  END IF;

  -- 🔴 **`id` 改成明確寫**(原本走欄位 DEFAULT)—— 稽核那一列要指得回這一列。
  --    對位靠 `WITH ORDINALITY`:`v_item_ids` 是在同一個迴圈裡、同一個順序 append 的,
  --    而 `jsonb_array_elements` 依陣列順序展開 ⇒ 第 n 個元素配第 n 個 id。
  --    🛑 **不靠 `RETURNING` 的回傳順序** —— 那個順序 SQL 標準沒有保證。
  INSERT INTO public.order_items (
    id, order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT (v_item_ids ->> (it.ord - 1)::integer)::uuid,
         v_order_id,
         NULLIF(it.val ->> 'variant_id', '')::uuid,
         it.val ->> 'variant_sku',
         -- ══ 🔴🔴 ⟦b4-SPEC1⟧:規格【不信呼叫端】—— 在這裡用權威那一份覆蓋 ═══════════
         --   病:這份快照是**不可變**的 ⇒ 送錯一次就永遠錯, 客人訂單明細上的顏色/尺寸補不回來。
         --   🔴 應用層 `284ee4cf`(2026-08-24)已修, 而**那顆 commit 動的檔在 `supabase/` 底下是 0 支**
         --      ⇒ 修法整個在應用層 ⇒ **任何不走那支 repository 的 `service_role` 呼叫端仍然繞得過。**
         --   ⇒ 本片是 DB 那一半。
         --   🔴 **為什麼取在這裡而不是迴圈裡**(codex R1 MF1):這裡在冪等比對【之後】
         --      ⇒ 指紋仍然只吃呼叫端送的東西 ⇒ 檔頭 `:207` 那句「決定性」保住;
         --      而重送時走的是上面那條 early return, **根本不會跑到這一行**
         --      ⇒ 變體事後被改被刪都不影響既有那張單。
         --   🛑 代購品項(`variant_id` 是 NULL)⇒ `LEFT JOIN` 不命中 ⇒ 走 `it -> 'product_snapshot'` 原樣,
         --      它恆 `{}` 是**既有的刻意限制**(`manual-order-repository.ts:265` 同款判斷), 不是本片要解的。
         --   ⚠️ 變體不存在(被刪)而 `variant_id` 非 NULL ⇒ `pv.spec` 是 NULL ⇒ `COALESCE` 成 `{}`;
         --      **而那一列的 FK 會在同一句 INSERT 裡擋下整筆** ⇒ 不會留下空規格的真訂單。
         --   ⚠️ `SET search_path = ''` ⇒ 表名寫全 `public.product_variants`。
         --   📎 權威來源:`20260531142533_init_product_variants.sql:43`(`spec jsonb NOT NULL DEFAULT '{}'`)
         --      · `:62` CHECK 只保證 object · `:40` `id uuid PRIMARY KEY` ⇒ 一個 variant 恰一份 spec。
         -- ══ 🔴🔴 Sean 2026-09-01 12:0x 拍【甲】—— 原話一個字:「甲」 ══════════════
         --   題目逐字:「員工手動建單選了網站上有的商品, 而那個商品在我們目錄裡沒有填規格。
         --             員工自己打了規格。訂單上要留哪一份?」
         --     甲 留員工打的(目錄有填才用目錄的)  ← **他選這個**
         --     乙 一律用目錄的(目錄空的就寫空的)  ← ⛔ **本檔原本的行為, 已被推翻**
         --     丙 擋下來, 叫員工先去補目錄
         --   落點 `~/pcm-mailbox/決策-手動建單目錄沒填規格時用誰的-20260901.md`
         --
         --   🔴 **為什麼**(端題時給他的那一句):目錄是空的時候, 它**不是一個更可信的真相,
         --      它是【沒有值】** ⇒ 拿沒有值去蓋掉有值, 不是取權威, 是**把資料弄丟**,
         --      而且丟得很安靜 —— 員工打了字、按了送出、單子成立了, 而那格是空的, 畫面零訊號。
         --   🔴 **而它踩得到多少**:`product_variants` 54,000 列 / 空規格 **13,112(24%)**
         --      (2026-08-31 主視窗唯讀跑正式庫, 數字與範圍見本檔 `:31`)。
         --
         --   ══ 「空」的定義:三種都處理, 而只有第三種在今天可達 ═══════════════════
         --     ① `pv.spec IS NULL`  ⇒ 🔵 **今天不可達**:欄位是 `NOT NULL DEFAULT '{}'`
         --        (`20260531142533_init_product_variants.sql:43`)。仍然寫進條件, 理由是
         --        **它今天不可達的依據是【另一支檔的欄位定義】** —— 那支哪天放寬了,
         --        這裡會安靜地把 NULL 當成「有值」丟進 `jsonb_set` ⇒ 整格變 NULL。
         --     ② 空字串 `''` ⇒ 🔵 **結構上不可達**:`pv_spec_is_object` CHECK 要求
         --        `jsonb_typeof(spec) = 'object'`(同檔 `:62`)⇒ 字串進不了這一欄。
         --        ⇒ 所以**不為它寫條件** —— 寫了會是一句永遠為假的死碼, 而死碼讀起來像防護。
         --     ③ `pv.spec = '{}'::jsonb` ⇒ 🔴 **這才是那 13,112 列** ⇒ 本片真正要擋的那一種。
         --   ⛔ ~~我原本寫「`{"a": null}` 算有值, 會贏過員工那份, 那是刻意的」~~ **作廢**
         --      (codex R1 抓的):`{"a": null}` **根本走不到這裡** ——
         --      上面 `m3_jsonb_values_all_string` 那道(`:549` 一族)要求值全部是字串,
         --      `null` 不是 ⇒ **整張單直接 RAISE**。⇒ 我描述了一個不存在的行為。
         --      📌 而它讀起來完全合理, 因為它在講一個**看起來會發生**的情境。
         --
         --   ══ 🔴🔴 **「空」在這一格有【兩個意思】, 而 Sean 分開答了兩次** ══════════
         --      ① **空的 jsonb `{}`**(整個規格沒有任何鍵)⇒ **留員工打的**
         --         依據:Sean 2026-09-01 12:0x 原話一個字「甲」。
         --      ② **鍵在、而值是空字串**(`{"color": ""}`)⇒ 🔴 **用目錄的那個空白**
         --         依據:Sean 2026-09-01 12:1x 原話逐字「**算有填(用目錄的空白)**」。
         --      ⇒ ✅ 所以本 CASE 只判 `{}`, 是**對的**, 不是漏掉 ②。
         --
         --      🔵 **這一格的來歷寫下來, 因為它差一點被我自己決定掉**:
         --      codex R1 舉了 `{"color": ""}` 當 must-fix 反例(「用空字串蓋掉員工打的紅」)。
         --      🛑 而我判它**不是 bug, 是一格沒有被問到的業務規則** ⇒ 沒有自行擴張拍板, 端上去問。
         --      ⇒ 他花一行答完, 而答案是 ②(與我原本猜的方向相反 —— 我以為他會想保住員工那份)。
         --      📌 **⇒ 我猜錯了, 而因為我沒有把猜的東西寫成碼, 那個錯不需要任何人來修。**
         --      ⇒ ⇒ 若當時自己決定, 他永遠不會知道有這一格,
         --         而它會變成一個沒有人記得為什麼的行為。
         CASE WHEN pv.id IS NULL
                OR pv.spec IS NULL
                OR pv.spec = '{}'::jsonb
              THEN it.val -> 'product_snapshot'
              ELSE pg_catalog.jsonb_set(it.val -> 'product_snapshot', '{spec}', pv.spec)
         END,
         (it.val ->> 'quantity')::integer,
         (it.val ->> 'unit_price')::integer,
         (it.val ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS it(val, ord)
    LEFT JOIN public.product_variants AS pv
           ON pv.id = NULLIF(it.val ->> 'variant_id', '')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 品項落 % 列、期望 %;整筆回滾',
                    v_n, pg_catalog.jsonb_array_length(v_items);
  END IF;

  -- ── G9 稽核落列(F1;形狀逐字對齊 `20260804180000:251-260`)────────────────
  -- 🔴 `before` 是 NULL 而不是 `{}` —— **這張單建立之前不存在**,那不是「空的狀態」是「沒有狀態」。
  -- 🔴 `after` 只放**訂單層**的欄與**筆數**,不逐品項展開:
  --    ① 品項細節在 `order_items`,`target` 指得到那張單 ⇒ 查得到,不必抄一份
  --    ② 稽核表是 append-only、永久留存 ⇒ **少抄一份 = 少一個會過期、會外洩的副本**
  --    ⚠️ 零經銷價、零 cost(本函式從頭到尾不查價,見檔頭 §4)。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (pg_catalog.btrim(p_actor, E' \t\r\n'), 'order.manual_create',
          -- ⚠️ **`request_id` 這一欄的語意在這裡與別的 admin 操作不同源**(f5 R3 nit,記一筆):
          --    建表註解(`20260712210000:51`)說它是「correlation id(貫穿 admin 寫入→audit→DB→外部服務 log)」,
          --    而本函式填的是**本片自己的冪等鍵** `manual_request_id`。
          --    ✅ 它**串得回那一次操作**(那正是 correlation 要的),所以合理、不改。
          --    ⚠️ 但**它不是別處那個 request_id 的同一條血脈** ⇒ 拿它跨操作做關聯查詢時要知道這件事。
          'order:' || v_order_id::text, p_manual_request_id::text,
          NULL,
          pg_catalog.jsonb_build_object(
            'display_id',       v_display_id,
            'customer_user_id', p_customer_user_id,
            'order_source',     p_order_source,
            'payment_channel',  p_payment_channel,
            'shipping_method',  p_shipping_method,
            -- 🔴 **第 6 代加這兩格**(codex 2026-09-05 must-fix #3):
            --    audit 記了 subtotal/total 卻沒記稅與價別 ⇒ **事後從建立事件看不出這張單是哪一種**,
            --    而 `tax_total = 0` 時尤其分不出(免稅 vs 含稅價)。
            'tax_total',        v_tax,
            'price_tax_mode',   v_price_tax_mode,
            'subtotal',         v_subtotal,
            'shipping_fee',     p_shipping_fee,
            'total',            v_total,
            'item_count',       pg_catalog.jsonb_array_length(v_items),
            -- 🔴🔴 **第 7 代加這一格** —— 它是本片唯一「事後查得到員工原始意思」的落點。
            --    🛑 而它**只在 audit**:不進 `order_items`(那要動表結構, 不在 Sean 拍的範圍)、
            --      不進冪等指紋(🔴 加進去會在部署窗製造真的失敗:舊版表單不送這個鍵
            --      ⇒ 新舊兩版對同一筆重送算出不同指紋 ⇒ 被判「同鍵不同內容」而拒;
            --      而它不影響「這是不是同一個請求」的答案 —— **錢一模一樣**)。
            --    🔬 **怎麼查**(寫在這裡, 因為三個月後那個人不會回頭讀 migration):
            --      SELECT after -> 'line_tax_bases'
            --        FROM public.admin_audit_log
            --       WHERE action = 'order.manual_create'
            --         AND target = 'order:' || '<那張單的 id>';
            'line_tax_bases',   v_line_bases,
            -- 第 8 代:這張單存的等級 + 是不是員工手選的(事後分得出「客人本來就是經銷」與「員工替這張單改成經銷」)。
            'tier_at_checkout', v_tier,
            'tier_overridden',  (p_tier IS NOT NULL),
            -- 第 9 代:車輛怎麼來的(manual_dict / manual_text / NULL = 沒填);整包不進 audit, 進 orders 那欄就查得到。
            'vehicle_source',   v_vehicle ->> 'source'),
          NULL, 'admin');
  -- 🔴 筆數守:trigger 抑制 / FORCE RLS ⇒ **零稽核的成功建單**,而那正是 F1 要擋的東西
  --    ⇒ 落不進去就整筆回滾,**不接受「單建好了但沒人知道是誰建的」**。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稽核落 % 列(期望恰 1)⇒ 整筆回滾;'
                    '這張單不准在沒有經手人紀錄的情況下存在', v_n;
  END IF;

  -- ⚠️ **重送(idempotent)那條路【不落 audit】** —— 它在 G6.5 就 return 了。
  --    理由:那一發**什麼都沒建**,而 audit 記的是「發生了什麼」不是「誰按過按鈕」。
  --    ⇒ 一張單 = 恰一列 `order.manual_create`。查「誰建的」不會查到兩個人。

  -- 🔴 **刻意不寫 `order_legal_consents`** —— 手動單沒有客人的同意動作,偽造它是錯的。
  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order_id, 'display_id', v_display_id, 'idempotent', false);
END;
$function$
;

-- ── 4. 新函式、欄位權限、欄位 ──
DROP FUNCTION public.admin_delete_customer(text, uuid, text, text);
DROP FUNCTION public.admin_enable_customer(text, uuid, integer, text, text);
DROP FUNCTION public.admin_disable_customer(text, uuid, integer, text, text);
DROP FUNCTION public.admin_customer_delete_eligibility(uuid);
DROP FUNCTION public.pcm_customer_delete_blockers(uuid);
REVOKE SELECT (disabled_at) ON public.customers FROM authenticated;
ALTER TABLE public.customers
  DROP COLUMN disabled_at,
  DROP COLUMN disabled_by,
  DROP COLUMN disabled_reason,
  DROP COLUMN disabled_version;

-- ── 5. 事後閘:六支函式與 view 的指紋回到貼之前 ──
DO $post$
DECLARE
  v_sp text := pg_catalog.current_setting('search_path');
  r    record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('create_order', '74716d30da57db777cd319ee48652a03'),
      ('dealer_application_submit', 'e9578fa9e96290f498bfbb29bbcfaea6'),
      ('dealer_application_update_mine', '784b0badc796a092423aeb20789d13d6'),
      ('admin_dealer_application_decide', 'd97f50e5de5bcbd9d56f44477f3219ee'),
      ('admin_create_manual_order', 'c280e7e6f35660fc454e1754833c3981'),
      ('admin_search_customers', '77a953d8734500dc56f6b914051b638b')
    ) AS t(n, fp)
  LOOP
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p WHERE p.proname = r.n AND p.pronamespace = 'public'::regnamespace) <> 1
       OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.proname = r.n AND p.pronamespace = 'public'::regnamespace) IS DISTINCT FROM r.fp THEN
      RAISE EXCEPTION '事後閘:% 沒有回到貼之前的版本', r.n;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('search_path', '', true);
  IF pg_catalog.md5(pg_catalog.pg_get_viewdef('public.admin_customer_list_v'::regclass, true)) IS DISTINCT FROM '52a26f8ee89b33789c1eeb0942bcdf19' THEN
    RAISE EXCEPTION '事後閘:admin_customer_list_v 沒有回到 12 欄那一版';
  END IF;
  PERFORM pg_catalog.set_config('search_path', v_sp, true);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'public.admin_customer_list_v'::regclass AND 'security_invoker=true' = ANY (c.reloptions)) THEN
    RAISE EXCEPTION '事後閘:admin_customer_list_v 的 security_invoker 不見了';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.admin_customer_list_v', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.admin_customer_list_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘:admin_customer_list_v 權限不對';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'public.admin_search_customers(text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘:authenticated 可以執行 admin_search_customers';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.customers'::regclass
               AND a.attname LIKE 'disabled%' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '事後閘:customers 還有停用欄位';
  END IF;
END
$post$;

COMMIT;
