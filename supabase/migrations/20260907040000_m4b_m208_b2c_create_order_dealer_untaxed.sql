-- 20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql
-- ⟦auth-DEALERTIERPRICING⟧ / ⟦auth-TIERTOTALBYPAYMENT⟧ B2c(貼板 71)
--
-- 這一支做兩件事, 而**它們缺一更糟**:
--   ① 經銷(store)單改收【經銷價】—— `coalesce(price_store, price_general)`
--   ② 經銷單寫 `price_tax_mode='exclusive'` + 算 `tax_total`(刷卡 5% / 匯款 0)
-- 🛑 **只做 ② ⇒ 那張單自稱未稅而收的是含稅價** ⇒ 帳、發票、退款全錯。
-- 🛑 **只做 ① ⇒ 收未稅價卻標 inclusive** ⇒ 少收 5% 而單據說它含稅。
--
-- 🔬 依據(Sean 逐字, 正本 `~/pcm-mailbox/端Sean-0905早上佇列.md`):
--   `:1589` 「Q24 經銷會員看到的價:甲=未稅 但是不標未稅, 單純 刷卡+5%, 匯款不用」
--   `:1699` 「經銷商在網頁都是未稅,刷卡+5%(就是含稅) 運費就是105這樣沒錯」
--   `:441`  「甲 = 稅基含運費(小計 + 運費 × 5%)」 · `:440` 「一律填未稅, 系統算稅」
--   `:442`  「既有的單不回頭重算」⇒ 🔵 **本檔零 UPDATE、零回填** —— 只改函式。
--
-- 🔴 **為什麼是 DROP + CREATE 而不是 CREATE OR REPLACE**:
--   `CREATE OR REPLACE` 會把 `SET` 子句**整組換掉**(memory `reference_create-or-replace-resets-set-clause`)
--   ⇒ 漏寫 `SET search_path = ''` 就是一次安全弱化, 而 body md5 可能一模一樣 ⇒ 錨印綠。
--   ⇒ 本檔**兩支都自己寫全** `SECURITY DEFINER` + `SET search_path = ''`, 並在事後斷言 `proconfig`。
--
-- 🔬 **底稿來源 = live, 不是 repo 的印象**(2026-09-07 唯讀量, `scripts/readonly-prod-sql.sh`):
--   11 參 body md5 `962dd03f767074a57335b05415edf3e3` · 461 行 · proconfig `search_path=""`
--   10 參 body md5 `c37b74c2efdda336e6d588ecf66aa3ca` · 442 行 · proconfig `search_path=""`
--   ⇒ 與 repo `20260906500000` 那兩處**逐字相同** ⇒ 以它為底成立。
--   兩支 prosecdef = true;三角色 EXECUTE = authenticated t / anon f / service_role f。
--   `orders.price_tax_mode` 預設 `'inclusive'` NOT NULL · `tax_total` integer 預設 0 NOT NULL。
--   🔵 今天正式庫 `price_tax_mode='exclusive'` 的單 = **0** 張(正對照 orders 總筆數 4)。
--
-- 🔴 **改了什麼(逐處, 兩支各一遍)**:
--   ①DECLARE 加 `v_tier` / `v_tax` / `v_price_tax_mode`
--   ②開頭查 `customers.tier`, **查不到就 RAISE**(不得退成 general —— 那是「經銷商用一般價買走」)
--   ③variant SELECT 補 `pv.price_store`(兩處 × 兩支 = 4 處)
--   ④取價改 `CASE tier`;那道「無有效價」的 RAISE 訊息不再寫死 `price_general`
--   ⑤11 參:算稅 + total 加稅;10 參:**經銷單直接擋**(它沒有 `p_payment_channel`, 算不出稅)
--   ⑥INSERT 補 `tax_total` / `price_tax_mode`, `tier_at_checkout` 由寫死 `'general'` 改成 `v_tier`
--
-- ⚠️ **一般會員這條路的行為:零改動。** 唯一的例外是 ② —— 他現在也要查得到 `customers.tier`。
--    🔵 那不是新的失敗點:同一個 `v_uid` 在本函式後面本來就會被 `customers` 相關的路徑用到。
--
-- 🛑 **本檔【不】改前台碼** —— B2a/B2b 已 commit(`93e9b78e4` / `7e78da5e`), 三顆同一批推。

BEGIN;

-- ══ 前置閘 ═══════════════════════════════════════════════════════════
DO $precondition$
BEGIN
  -- ⓪ 欄位在不在(它由 20260905360000 建;不在 ⇒ 那支沒貼 ⇒ 本檔的 INSERT 會炸在半路)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='orders' AND column_name='price_tax_mode') THEN
    RAISE EXCEPTION '前置閘⓪:orders 沒有 price_tax_mode ⇒ 20260905360000 沒貼';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='orders' AND column_name='tax_total') THEN
    RAISE EXCEPTION '前置閘⓪b:orders 沒有 tax_total';
  END IF;

  -- ① forward-only:本檔已套用過 ⇒ 拒重跑(判準 = 新 body 特徵字)
  --   🔴 **它必須排在 md5 那道【前面】**(codex 2026-09-07 nit ⑦):套用成功之後 body 已經變了
  --     ⇒ 再跑一次會先撞 md5 那道, 而它的訊息說的是「有人動過底稿」——
  --     📌 **一句正確的錯誤訊息, 指向錯的原因。**
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='create_order'
       AND pg_catalog.strpos(p.prosrc, 'v_price_tax_mode') > 0) THEN
    RAISE EXCEPTION '前置閘①:create_order 已含 v_price_tax_mode ⇒ 本檔已套用過, forward-only 拒重跑';
  END IF;

  -- ② 底稿還是不是我量的那一版 —— **這是本檔最重要的一道閘**
  --   🔴 我改的是【我讀到的那一版】。它若已經被別人動過, 我的 DROP 會把那個人的改動丟掉,
  --     而 diff 上看不出來(整支重建, 每一行都是「新的」)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='create_order' AND p.pronargs=11
       AND md5(p.prosrc) = '962dd03f767074a57335b05415edf3e3') THEN
    RAISE EXCEPTION '前置閘②:11 參 create_order 的 body 不是我量的那一版(期望 md5 962dd03f767074a57335b05415edf3e3)⇒ 停, 重量再改';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='create_order' AND p.pronargs=10
       AND md5(p.prosrc) = 'c37b74c2efdda336e6d588ecf66aa3ca') THEN
    RAISE EXCEPTION '前置閘②b:10 參 create_order 的 body 不是我量的那一版(期望 md5 c37b74c2efdda336e6d588ecf66aa3ca)⇒ 停, 重量再改';
  END IF;

  -- ③ member_tier 這個 enum 認不認得 store(取價與稅都掛在它上面)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='member_tier' AND e.enumlabel='store') THEN
    RAISE EXCEPTION '前置閘③:member_tier 沒有 store 這個值';
  END IF;

  -- ③b 🔴🔴 **owner 要對** —— `SECURITY DEFINER` 是【以 owner 的身分】執行。
  --   🛑 codex 2026-09-07 must-fix ②:`DROP` + `CREATE` 之後 **owner 變成【執行這支 migration 的人】**。
  --     ⇒ 若那個人不是原本的 owner, **這支函式從此以另一個身分跑** —— 而 body md5 一模一樣、
  --       三綠不紅、我原本的九道斷言一格都不會叫。📌 **那是一次靜悄悄的權限位移。**
  --   ✅ 本檔的處置:①這裡先**斷言現值** ②抄進暫存表 ③建完**明寫 ALTER … OWNER TO** 還原 ④再斷言一次。
  --   🔬 現值量來的(2026-09-07 唯讀):兩支 owner 皆 `postgres`;
  --      proacl 皆 `{postgres=X/postgres,authenticated=X/postgres}`。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='create_order'
       AND pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres') THEN
    RAISE EXCEPTION '前置閘③b:create_order 的 owner 不是 postgres ⇒ 停(DROP+CREATE 會把它換成執行者)';
  END IF;

  -- ④ price_store 那一欄在不在(取價要讀它)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='product_variants' AND column_name='price_store') THEN
    RAISE EXCEPTION '前置閘④:product_variants 沒有 price_store';
  END IF;
END
$precondition$;

-- ══ 🔴 DROP 之前先把【DROP 會帶走的東西】抄下來 ════════════════════
--   codex 2026-09-07 must-fix ② / nit ⑥:`DROP FUNCTION` 會一併丟掉
--   **owner**(改成執行者)· **ACL** · **COMMENT**。前兩者是安全, 第三者是給下一個人的話。
--   ⇒ 抄進一張 **本交易內的暫存表**, 建完逐項還原並斷言 —— 不憑我記得的值。
CREATE TEMP TABLE pcm_b2c_prev ON COMMIT DROP AS
SELECT p.pronargs AS nargs,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
       p.proacl::text AS acl_text,
       pg_catalog.obj_description(p.oid, 'pg_proc') AS cmt,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS idargs
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'create_order';

DO $snapshot$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pcm_b2c_prev;
  -- 🔴 **抄了幾筆要對得上** —— 抄到 0 筆而後面「還原成功」會印一樣的綠。
  IF v_n <> 2 THEN RAISE EXCEPTION '快照:抄到 % 筆(期望 2)⇒ 後面的還原沒有依據', v_n; END IF;
  -- ⛔ ~~原本這裡寫「有 N 支沒有 COMMENT ⇒ 停」~~ ——
  --   🔴 那是**把「正式庫今天長這樣」寫成了「任何庫都必須長這樣」**:拋棄式 PG 上
  --     從 body 重建的那兩支【本來就沒有 COMMENT】⇒ 本檔在那裡一貼就炸, 而那不是缺陷。
  --   ✅ 改成:**有就還原, 沒有就跳過** —— 本檔的責任是「不要弄丟」, 不是「規定它必須有」。
  SELECT count(*) INTO v_n FROM pcm_b2c_prev WHERE cmt IS NOT NULL;
  RAISE NOTICE '快照:2 支中有 % 支帶 COMMENT(正式庫 2026-09-07 量到 2 支都有)', v_n;
END
$snapshot$;

-- ══ DROP(兩支多載, 各自指名參數型別)═══════════════════════════════
DROP FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text);
DROP FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text);

CREATE FUNCTION public.create_order(
  p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
  p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text,
  p_payment_channel text, p_notification_email text DEFAULT NULL::text,
  p_coupon_code text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
$fn$;

CREATE FUNCTION public.create_order(
  p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
  p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text,
  p_notification_email text DEFAULT NULL::text,
  p_coupon_code text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
$fn$;

-- ══ 權限(DROP 把 ACL 一起帶走了 ⇒ 這裡不是「順手加」, 是【必須重建】)══
-- 🔴 新建的函式**出生就自帶 PUBLIC EXECUTE** ⇒ 兩道 REVOKE 都要, 少一道 anon 就叫得動。
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text) FROM anon, service_role;
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) FROM anon, service_role;
-- ACL-GATE-EXEMPT: public.create_order -- 重建 DROP 前就有的授權, 非新開路(20260907040000, 2026-09-07)
--   🔬 貼前唯讀實測:兩支 proacl 皆 `{postgres=X/postgres,authenticated=X/postgres}`
--     ⇒ authenticated=t / anon=f / service_role=f。**貼後要一模一樣, 而那不是靠這行豁免背書** ——
--     背書的是同檔事後斷言 ③/③b/③c/③d/③e:③e 用 `aclexplode` 逐筆比對 DROP 前抄下來的那一份,
--     判準是「**沒有人拿到他原本沒有的**」(允許變窄、不允許變寬)。
--   🛑 這行豁免說的只有一件事:**這兩句 GRANT 不是新開一條路, 是把 DROP 帶走的那條放回去。**
-- ACL-GATE-EXEMPT: public.create_order -- 同上, 10 參那支多載(20260907040000, 2026-09-07)
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) TO authenticated;

-- 🔴 **`position(x IN y)` 是 SQL 特殊語法, 加了 `pg_catalog.` 前綴會 syntax error**
--   (實測:`ERROR: syntax error at or near "p"`, 指的是 `in p.prosrc` 那個 `p`)。
--   ✅ 本檔一律用 `pg_catalog.strpos(y, x)` —— 那是真函式, 前綴合法。
--   ⚠️ 而 repo 裡另有 migration 寫成 `pg_catalog.position('X' in v_def)`
--     ⇒ **那一支若真的跑過, 它應該也炸過** —— 不在本片射程, 只留這句給下一個人。
-- ══ 🔴 還原 DROP 帶走的三樣:owner / COMMENT(ACL 上面已重建)════════
DO $restore$
DECLARE r record; v_n integer := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_b2c_prev LOOP
    -- owner:`SECURITY DEFINER` 以它的身分執行 ⇒ 這一行是安全, 不是整潔。
    EXECUTE pg_catalog.format('ALTER FUNCTION public.create_order(%s) OWNER TO %I', r.idargs, r.owner_name);
    -- COMMENT:DROP 帶走了它, 而它是上一個人留給下一個人的話。
    IF r.cmt IS NOT NULL THEN
      EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.create_order(%s) IS %L', r.idargs, r.cmt);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 2 THEN RAISE EXCEPTION '還原:只跑了 % 支(期望 2)', v_n; END IF;
END
$restore$;

-- ══ 事後斷言(每一格都印【兩個世界會不同】的東西)═══════════════════
DO $verify$
DECLARE
  v_n integer;
  -- 🔴 **收權斷言要【列出它檢查了誰】** —— 那道靜態閘數的是這個清單, 而它防的是
  --   「你收了權而忘了把某個物件寫進來檢查」。⇒ 兩支多載各一列, 用完整簽章分辨。
  v_functions text[] := ARRAY[
    'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)',
    'public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text)'
  ]::text[];
  v_fn text;
BEGIN
  -- ⓪ 逐一對清單裡的每一支問三個角色 —— 🔴 **迴圈跑幾圈要對得上清單長度**,
  --   否則「清單列了兩支而只檢查了一支」在輸出上與「都檢查了」長得一樣。
  v_n := 0;
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言⓪:authenticated 對 % 沒有 EXECUTE', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '斷言⓪b:anon 或 service_role 對 % 叫得動', v_fn;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> pg_catalog.array_length(v_functions, 1) THEN
    RAISE EXCEPTION '斷言⓪c:清單有 % 支而只檢查了 %', pg_catalog.array_length(v_functions, 1), v_n;
  END IF;

  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order';
  IF v_n <> 2 THEN RAISE EXCEPTION '斷言①:create_order 應有 2 支多載, 實得 %', v_n; END IF;

  -- ② SET 子句 —— DROP+CREATE 之後它【不會自己回來】, 而漏了它 body 也可能一模一樣
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND p.prosecdef
     -- 🔬 **這個字面是量來的, 不是猜的**:`SET search_path = ''` 在 `pg_proc.proconfig` 裡
     --   存成 `search_path=""`(帶兩個引號), 不是 `search_path=`。
     --   ⛔ ~~我第一版寫 `'search_path=' = ANY(proconfig)`~~ ⇒ 拋棄式 PG 上當場判 0 ⇒ 斷言自己紅了。
     --   📌 **一個寫錯的斷言與一個沒過的檢查, 在 rc 上是同一個東西** —— 所以先量再寫。
     AND pg_catalog.array_to_string(p.proconfig, ',') = 'search_path=""';
  IF v_n <> 2 THEN RAISE EXCEPTION '斷言②:兩支都要 SECURITY DEFINER + search_path 空字串, 實得 %', v_n; END IF;

  -- ③ 權限:authenticated 叫得動、anon 與 service_role 叫不動
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_n <> 2 THEN RAISE EXCEPTION '斷言③:authenticated 應對兩支都有 EXECUTE, 實得 %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF v_n <> 0 THEN RAISE EXCEPTION '斷言③b:anon/service_role 不得叫得動, 實得 %', v_n; END IF;
  -- 🔴 proacl 是 NULL 時 PUBLIC 看得見, 而 has_*_privilege 對它會回 true ⇒ 這一格不能省
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order' AND p.proacl IS NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION '斷言③c:有 % 支 proacl 是 NULL(PUBLIC 看得見)', v_n; END IF;

  -- ③d 🔴🔴 **owner / ACL / COMMENT 逐支比對【抄下來的那一份】**(codex must-fix ② / nit ⑥)
  --   📌 不是比「我以為的值」, 是比 **DROP 之前這個庫上真正的值** ⇒ 這一格在任何庫上都成立。
  -- owner 與 COMMENT:**要一模一樣**(它們是「還原」)
  SELECT count(*) INTO v_n
    FROM pcm_b2c_prev q
    JOIN pg_catalog.pg_proc p ON p.pronargs = q.nargs
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
   WHERE p.proname = 'create_order'
     AND pg_catalog.pg_get_userbyid(p.proowner) = q.owner_name
     AND pg_catalog.obj_description(p.oid,'pg_proc') IS NOT DISTINCT FROM q.cmt;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '斷言③d:owner/COMMENT 與 DROP 前相同的只有 % 支(期望 2)⇒ 有一樣沒還原', v_n;
  END IF;

  -- 🔴 **ACL 的不變量【不是「一模一樣」】, 是「沒有人拿到他原本沒有的」。**
  --   ⛔ ~~我第一版斷言 `proacl::text = 快照`~~ —— 那在**任何一個預設權限比較寬的庫**上必炸,
  --     而它「炸」的原因正是本檔**做對了事**(兩道 REVOKE 把 PUBLIC / anon / service_role 收掉)。
  --     🔬 拋棄式 PG 實測:貼前 acl 是 `{=X/postgres,...,anon=X/postgres}`(預設就給 PUBLIC),
  --        貼後收窄 ⇒ 與快照不等 ⇒ 我的斷言把**收緊**判成了**沒還原**。
  --   ✅ 正確的問法:**新 ACL 的每一個 grantee, 貼前是不是也有**(允許變窄, 不允許變寬)。
  SELECT count(*) INTO v_n
    FROM pcm_b2c_prev q
    JOIN pg_catalog.pg_proc p ON p.pronargs = q.nargs
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname='public'
   CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS a
   WHERE p.proname = 'create_order'
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(q.acl_text::aclitem[]) AS b
        WHERE b.grantee = a.grantee AND b.privilege_type = a.privilege_type);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '斷言③e:有 % 筆權限是【貼後才有的】⇒ DROP+CREATE 把權限放寬了', v_n;
  END IF;

  -- ④ 新 body 真的含新邏輯(存在性對 DROP+CREATE 有判別力 —— 舊版沒有這些字)
  --   ⚠️ **codex 2026-09-07 nit ④ 說得對, 照抄不改**:它只查字串存在 ——
  --     「取價改回 general」與「稅率改成 50%」**都通得過這一格**。
  --     ⇒ 📌 **行為對不對【不由這裡背書】**, 由拋棄式 PG 那四個世界 + 三發源頭突變背書
  --       (讀數寫在 commit body)。這一格只答「這支檔真的換過了嗎」。
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND pg_catalog.strpos(p.prosrc, 'v_price_tax_mode') > 0
     AND pg_catalog.strpos(p.prosrc, 'price_store') > 0;
  IF v_n <> 2 THEN RAISE EXCEPTION '斷言④:兩支都要含 v_price_tax_mode 與 price_store, 實得 %', v_n; END IF;

  -- ⑤ 🔴 **正對照:函式要【真的叫得動】** —— 前四格全是「看得到」, 而看得到不等於跑得起來。
  --   ⚠️ **codex 2026-09-07 nit ⑤ 的限定照抄**:它在最前面那道 NULL cart 閘就退出來了
  --     ⇒ **後面的取價 SQL / 稅式 / INSERT 壞掉, 這一格仍然會過**(PL/pgSQL 的 SQL 是首次執行才分析)。
  --     ⇒ 📌 它證的是「這支函式編得起來、進得去」, **不是「它算得對」**。後者在拋棄式 PG 那四個世界。
  --   餵一個必定被前面的閘擋下的輸入(cart_session_id = NULL)⇒ 期望它丟【那一句】例外;
  --   丟別的(例如 `coalesce` 不存在 / 欄位打錯)⇒ 那是編譯期沒抓到的錯, 本閘要紅。
  BEGIN
    PERFORM public.create_order(
      '[]'::jsonb, NULL::uuid, 'home', '{}'::jsonb, NULL::uuid, 'v1', '127.0.0.1', 'ua', 'tappay', NULL, NULL);
    RAISE EXCEPTION '斷言⑤:餵 NULL cart_session_id 竟然沒有丟例外';
  EXCEPTION
    WHEN others THEN
      IF pg_catalog.strpos(SQLERRM, '缺 cart_session_id') = 0 THEN
        RAISE EXCEPTION '斷言⑤:11 參那支丟的不是預期的那一句, 而是「%」⇒ body 有執行期錯誤', SQLERRM;
      END IF;
  END;
  BEGIN
    -- 🔴 **具名參數, 不是位置參數** —— 位置參數會撞多載歧義:
    --   11 參那支有兩個 DEFAULT ⇒ 它**也接得住 10 個位置參數**
    --   ⇒ 實測 `function public.create_order(..., unknown, unknown) is not unique`。
    --   ✅ 用名字:11 參的 `p_payment_channel` 沒有 DEFAULT ⇒ 不給它就配不上那一支。
    --   📌 這正是 `20260906500000` 檔頭那段「分辨器不是參數個數, 是【名字集合】」在說的事,
    --     而我第一版仍然用位置參數 —— **讀過那段話, 而寫的時候沒有用上它。**
    PERFORM public.create_order(
      p_lines => '[]'::jsonb, p_address_id => NULL::uuid, p_shipping_method => 'home',
      p_invoice => '{}'::jsonb, p_cart_session_id => NULL::uuid, p_terms_version => 'v1',
      p_client_ip => '127.0.0.1', p_client_ua => 'ua',
      p_notification_email => NULL::text, p_coupon_code => NULL::text);
    RAISE EXCEPTION '斷言⑤b:10 參 餵 NULL cart_session_id 竟然沒有丟例外';
  EXCEPTION
    WHEN others THEN
      IF pg_catalog.strpos(SQLERRM, '缺 cart_session_id') = 0 THEN
        RAISE EXCEPTION '斷言⑤b:10 參那支丟的不是預期的那一句, 而是「%」', SQLERRM;
      END IF;
  END;
END
$verify$;

COMMIT;
