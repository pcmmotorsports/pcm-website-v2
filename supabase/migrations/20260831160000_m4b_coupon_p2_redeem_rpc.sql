-- 20260831160000_m4b_coupon_p2_redeem_rpc.sql
-- 優惠券片 2:驗券 + 原子兌換的 SECURITY DEFINER RPC。
--
-- ══ 🔵 2026-09-01 改動:成功時多回一格 `coupon_id`(三處 `'valid', true` 全改)═══════
-- **為什麼**:3b 的 `create_order`(`20260901021000`)要把券的身分寫進 `orders.coupon_id`
-- (那一欄 `20260901020000` 剛加),而它**只有券碼**,沒有券的 id。
-- 🔴 **而另一條路是讓 `create_order` 自己 `SELECT id FROM coupons WHERE code = 正規化(...)`**
--    ⇒ 那會把本檔 `:105-108` 那組空白字元正規化(含 U+00A0 / U+200B / U+FEFF 等)**再抄一份**。
--    ⇒ 📌 **兩個地方各自算同一件事, 它們不一致時沒有人在比** ——
--       這正是本片 3b 甲那顆 commit(`8bca4bd1`)剛踩到的病:我當時假設下游讀的是上游那個值,
--       而它自己重算。**不要在同一條線上犯第二次。**
-- ✅ 安全性:多回一個 uuid 不洩漏任何東西 —— 呼叫者本來就知道自己送了哪個券碼,
--    而 id 對它沒有額外用途(`coupons` 表對 `authenticated` 是 REVOKE ALL, 拿到 id 也讀不到)。
-- ✅ 就地改而不另開一支的理由:本檔**還沒 apply**(`supabase/APPLIED.tsv` 命中 `^20260831160000` ⇒ 0;
--    🟢 正對照 `^20260829150000` ⇒ 1)⇒ 改它不會讓帳本上任何一列變孤兒。
--
-- ══ 為什麼這件事只能在這裡做 ═══════════════════════════════════════════════
-- 🔴 片 1(`20260829150000`)把 `coupons` 與 `coupon_redemptions` 對
--    `PUBLIC / anon / authenticated / service_role` **REVOKE ALL**(該檔 `:208-209`),
--    同檔 `:203-204` 逐字「讀寫唯一路 = SECURITY DEFINER RPC」⇒ **app 層碰不到那兩張表。**
-- 🔴 而 `max_redemptions`(限量券)要在**同一個交易**裡先鎖券那一列再數再寫 ——
--    兩個人同時結帳時, app 層各自看到的都是「還有一張」。
--
-- ══ 🔴 一支函式, 兩種模式(刻意的)═════════════════════════════════════════
-- `p_order_id IS NULL` ⇒ **試算**(唯讀, 不寫 redemption, 不鎖列)
-- `p_order_id` 有值    ⇒ **兌換**(`FOR UPDATE` 鎖券那一列 + 寫一列 redemption)
-- 📌 **為什麼不拆兩支**:那七條規則會有兩份, 而它們分岔時「試算說可以、兌換說不行」
--    **不會有任何東西叫**。一份規則, 兩個出口。
-- 🛑 **而試算的結果【本質上】只是參考**:它沒鎖列 ⇒ 它回 valid 之後、客人按下結帳之前,
--    最後一張券可能已被別人拿走。**權威永遠是兌換那一次。**
--
-- ══ 拒絕理由的【順序】—— 我判的, 不是 Sean 拍的 ═══════════════════════════
-- `not_found → inactive → expired → tier_conflict → already_used_by_account
--  → exhausted → below_min_spend`
-- 🔴 `below_min_spend` 排最後:它是唯一一個**客人做得了事**的理由(去湊金額)。
--    一張**已過期**的券若先回「金額不足」, 客人會去湊, 然後發現它根本不能用。
-- ⛔ ~~原句寫「只有它回一個【可行動】的數字」~~(codex nit)—— **那個數字今天不回**:
--    `shortfall` 依 `packages/domain/src/order/coupon.ts:84` **預設不回**(Sean 未答)。
--    ⇒ 可行動的是**那個理由**, 不是一個數字。字面改掉, 舊句留著加刪除線。
-- ⚠️ `already_used_by_account` 與 `exhausted` 誰先兩個都說得通:我選前者(與這位客人有關)。
--    **這一格可以被推翻。**
--
-- ══ 🛑 這支函式【答不出】的, 具名 ═══════════════════════════════════════════
-- ✅ ① **折抵算出 0 元** —— **2026-08-31 Sean 拍【甲:最低折 1 元】, 已落地(見 1e)。**
--    ⛔ ~~本函式丟例外, 那是佔位不是答案~~ ⇒ 已移除。
--    ⚠️ 而**他沒有被問到 0 元小計那個邊界** ⇒ 那一格是我判的,
--       寫在 1d 的 `greatest(min_spend, 1)` 旁邊。**那一格可以被推翻。**
-- ② **券碼含零寬字元(U+200B 等)的券查不到** —— 片1 `:113` 的 CHECK 用 `[[:space:]]`,
--    而那個字集**不含零寬字元** ⇒ 這種碼存得進去, 而本函式的正規化會把它從輸入剝掉
--    ⇒ 存得進去、永遠查不到。🔵 **而它今天打不到**:`coupons` 目前**零寫入端**
--    (建券 RPC 還沒做)⇒ 沒有路徑製造那一列。**耐久的修法在建券那一側, 不在這裡。**
--    (論證形狀照抄片1 `:352-354` 對缺口① 的處置 —— 那不是我發明的。)
-- ③ **會員價衝突怎麼判** —— 本函式只讀 `p_has_tier_price` 這個布林, **它不自己算**。
--
-- ══ 🔴🔴 R3 抓到的三格:**這支 RPC 只做了半件事**(具名, 不假裝沒有)═════════════
-- 🔴 ④ **`p_subtotal` / `p_has_tier_price` 完全信任呼叫端。**
--    傳一個舊的小計 ⇒ 繞過低消;傳錯 `false` ⇒ 繞過會員價衝突。**兩種都回 `valid:true`,
--    而不會有任何東西叫。**⇒ 真正的修法是「函式自己從 `order_items` 算小計」,
--    而那要讀既有的錢相關表 ⇒ **命中鐵則 8/12 ⇒ 要 plan + Sean 批, 不是一個窗自己加。**
-- 🔴 ⑤ **兌換成功【不會】動 `orders.discount_total` / `orders.total`。**
--    ⇒ 「已付款、已記一列 redemption、而訂單金額一毛沒少」是一個**寫得出來的狀態**。
--    ⇒ 那是片3(接進結帳)的工作, 而在片3 落地之前, **這支函式單獨呼叫是不安全的**。
-- 🔴🔴 ⑦ **「這張單還算不算數」的真相散在【至少六個地方】, 而本函式只問得到三個。**
--    codex 五輪, 而 R3/R4/R5 全部落在這一層 —— 那不是三個 bug, 是一個結構:
--      **每一條會讓訂單失效的路徑, 都【不更新 `orders.payment_status`】。**
--    ✅ 本函式已問(且各有一發突變證明在承重):
--      `orders.customer_user_id` · `orders.payment_status = 'paid'` · `orders.cancelled_at IS NULL`
--      · `order_cancellations` 有沒有列(部分取消只寫這裡)
--    🛑 **本函式【沒有】問, R5 具名的三個**:
--      · `order_refunds.status`(`20260823010000_..._extract_sync_fn.sql:356-369`)
--        —— 退款已受理而金額不符時停在 `processing`, 訂單仍 `paid`
--      · `order_manual_refunds.voided_at / refund_amount`(`20260823020000_..._record_calls_sync.sql:447-478`)
--        —— `admin_record_manual_refund` 寫入有效非卡退款, 而同步 helper 不計此表
--      · `order_payments.amount / reverses_payment_id`(`20260812150000_..._payment_audit.sql:426-430`)
--        —— `admin_reverse_manual_payment` 寫負數沖銷卻不改 `payment_status`
--
-- 🛑🛑 **為什麼我【不】把那三個也加成 `count(*) > 0`** —— 這是判斷, 寫出來讓人推翻:
--    ① **那是打地鼠**:每多一條退款/取消路徑就多一張表, 而漏掉的那一次不會有東西叫。
--       R3 抓 1 個、R4 抓 1 個、R5 一次抓 3 個 ⇒ **這條路上的數字在變大, 不是變小。**
--    ② **誤擋的風險是真的**:`order_payments` 每張正常的單都有列(要只數沖銷那種)、
--       `order_refunds` 有多個狀態 ⇒ **寫錯條件 = 擋掉正常兌券**, 而那比漏擋更快被客人撞到。
--       而我**沒有這三張表的測試資料**, 加了也驗不了 ⇒ 那會是「寫了而沒接上」的守門。
--    ③ **真正的修法是【一個單一真相】** —— 一支「這張單現在還算不算數」的 predicate,
--       由訂單那條線擁有, 六個地方共用。而那是**新 DB 物件 + 跨線** ⇒ 鐵則 8, 要 plan + Sean 批。
--    🔵 **而今天這三格打不到**:兌換發生在【付款成功那一步】(片1 `:11` Sean 拍乙),
--       那一刻退款/沖銷/部分取消**都還不存在**。⇒ 代價今天是零, 而它會隨片3 上線變成非零。
-- 📌 **⇒ 這一條不是「未做」, 是「做法錯了要換」** —— 已交主視窗端成決策題。
--
-- 🔴 ⑥ **`reverted_at` 全 repo 零寫入端**(codex 掃 2,107 檔:revert writer 0 / INSERT writer 1)。
--    ⇒ 退款 / 取消 / 客服手改單之後, 那一列**永遠算數**, 持續吃掉總量與每人上限。
--    ⇒ 片1 `:186` 早就警告過「每一個數次數的地方都要帶 `reverted_at IS NULL`」——
--      我照做了, **而沒有人在寫那個欄位** ⇒ 那道條件今天恆真。
-- 🛑 **⇒ 這三格是【範圍】不是【bug】** —— 本片交付後, 這支 RPC **沒有呼叫端**,
--    而上面三個缺口都要有呼叫端才打得到。**但它們必須在片3 開工前就被讀到**,
--    所以寫在這裡, 不寫在別人不會開的檔裡。

BEGIN;

-- ── 1. 函式本體 ────────────────────────────────────────────────
-- 🔴 **裸 `CREATE FUNCTION`, 不用 `OR REPLACE`**(codex must-fix;`scripts/migration-static-checks.sh:460-463`
--    會擋):新物件用 OR REPLACE ⇒ 撞名時**靜靜蓋掉**, 而 REVOKE 與斷言照樣綠
--    ⇒ 拿到綠燈, 卻蓋掉一個你不知道存在的東西。
CREATE FUNCTION public.redeem_coupon(
  p_code           text,
  p_user_id        uuid,
  p_subtotal       integer,
  p_has_tier_price boolean,
  p_order_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

COMMENT ON FUNCTION public.redeem_coupon(text, uuid, integer, boolean, uuid) IS
  'M-4b 券片2:驗券 + 原子兌換。p_order_id NULL = 試算(不鎖不寫);有值 = 兌換(FOR UPDATE + 寫一列)。'
  '回 jsonb {valid, reason?, discount_applied?, coupon_id?}(**shortfall 今天不回**, 見 coupon.ts:84)。reason 為 coupon_reject_reason 七值之一。'
  '🔴 `coupon_id` 在【每一條 valid=true 的路徑】都必回(三處), 而 `create_order`(20260901021000)'
  '   拿它寫 orders.coupon_id ⇒ **回不出來的話那支會 RAISE「契約破了」**。刪它之前先讀那支。'
  '同單同券同人重送【且算出來的折抵與已記錄的相同】= 冪等回上次結果(不同 ⇒ 丟例外)。訂單歸屬在函式內驗(片1 :349-356 指定)。'
  '折抵下限 1 元(Sean 2026-08-31 拍甲), 上限 = 小計;0 元小計走 below_min_spend(作者判, 非拍板)。'
  '🛑 答不出:'
  '②券碼含零寬字元者存得進去卻查不到(片1 :113 的 CHECK 不含零寬字集;今天無寫入端 ⇒ 打不到) '
  '③會員價衝突只讀 p_has_tier_price, 本函式不自己算。';

-- ── 2. 權限 ───────────────────────────────────────────────────
-- 🔴 新函式出生就帶 PUBLIC EXECUTE ⇒ REVOKE 是必要的, 不是保險。
REVOKE ALL ON FUNCTION public.redeem_coupon(text, uuid, integer, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_coupon(text, uuid, integer, boolean, uuid)
  FROM anon, authenticated;
-- 🔴🔴 **R2-must-fix:`service_role` 自己也要先收乾淨再重發** —— `REVOKE … FROM PUBLIC`
--    **不會動到具名角色**;若 default privilege 早就給了 `service_role`
--    **WITH GRANT OPTION**, 下面那道普通 GRANT **不會把它降級**
--    ⇒ 它留著轉授給別人的能力, 而自檢只問「有沒有 EXECUTE」⇒ 全綠。
REVOKE ALL ON FUNCTION public.redeem_coupon(text, uuid, integer, boolean, uuid)
  FROM service_role;
-- ⚠️ **只開給 `service_role`** —— 兌換一定經過我們的 server(它要先確定這張單是這個客人的)。
GRANT EXECUTE ON FUNCTION public.redeem_coupon(text, uuid, integer, boolean, uuid) TO service_role;

-- ── 3. apply 當下的自檢(fail-closed)──────────────────────────
DO $$
DECLARE
  -- 🔴 **清單不可空**(codex must-fix;`scripts/migration-static-checks.sh:572-575`):
  --    收權斷言【只檢查你列出來的物件】—— 它防「忘記收權」, 不防「忘記列」。
  v_functions text[] := ARRAY['public.redeem_coupon(text, uuid, integer, boolean, uuid)'];
  v_fn        text;
  v_oid       oid;
  v_acl       aclitem[];
  v_grantees  text[];
  v_extra     text[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '片2 fail-closed:% 沒建成', v_fn;
    END IF;

    -- 🔴🔴 **不再只點名三個角色**(codex must-fix):只問 anon/authenticated 有沒有 EXECUTE,
    --    抓不到「別的 grantee 也拿到了」那一種。⇒ 改成**列出實際的 grantee 集合**再比。
    SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_acl IS NULL THEN
      -- 🔴 ACL 是 NULL = 走預設 = **PUBLIC 看得見** ⇒ 那正是我們 REVOKE 要關掉的狀態。
      RAISE EXCEPTION '片2 fail-closed:% 的 proacl 是 NULL(預設 ACL ⇒ PUBLIC 可執行)', v_fn;
    END IF;
    -- 🔴🔴 **`LEFT JOIN` 不是 `JOIN`** —— 這是我自己實測撞到的:
    --    `aclexplode` 給 **PUBLIC 的 grantee 是 oid `0`**, 而 `pg_roles` 裡**沒有 0**
    --    ⇒ 用內部 JOIN 會把 PUBLIC 那一列**靜靜丟掉** ⇒ 這把尺看不到它唯一要防的那一種。
    -- 📌 實測(正對照):把上面兩行 REVOKE 整段拿掉再 apply ⇒ **本自檢 rc=0、一句都沒叫**。
    --    改成 LEFT JOIN + 把 0 具名成 'PUBLIC' 之後, 同一發突變才紅。
    SELECT coalesce(array_agg(DISTINCT g), ARRAY[]::text[]) INTO v_grantees
      FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
      LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid
      CROSS JOIN LATERAL (SELECT coalesce(r.rolname::text, 'PUBLIC') AS g) y;
    -- 允許集合 = service_role + owner(建這支函式的角色, 它本來就有)。
    SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
      FROM unnest(v_grantees) AS gr
     WHERE gr NOT IN ('service_role', (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                                         JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                                        WHERE p2.oid = v_oid));
    IF array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION '片2 fail-closed:% 的 EXECUTE 還開給了預期外的角色:%', v_fn, v_extra;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '片2 fail-closed:service_role 拿不到 % 的 EXECUTE', v_fn;
    END IF;

    -- 🔴🔴 **R2-must-fix:還要問 `is_grantable`** —— 一個帶 GRANT OPTION 的 EXECUTE
    --    表示持有者可以【自己把它轉發出去】⇒ 今天的 grantee 集合是對的,
    --    而明天它可以不經過任何 migration 就變。**「現在誰有」與「誰能給別人」是兩個宣稱。**
    IF EXISTS (SELECT 1 FROM (SELECT (aclexplode(v_acl)).* ) a WHERE a.is_grantable) THEN
      RAISE EXCEPTION '片2 fail-closed:% 有人拿到帶 GRANT OPTION 的權限(可自行轉授)', v_fn;
    END IF;

    -- 🔴🔴 **R2-must-fix:ACL 只答【直接授權】** —— 若 `anon` / `authenticated` 是
    --    `service_role` 的成員(或繼承得到它), 它們**照樣執行得了這支 SECURITY DEFINER RPC**,
    --    而 `v_extra` 仍然是空的 ⇒ 上面那把尺對這一種**完全沒有動作**。
    -- 🛑 這道問的是【角色圖】, 不是這支函式 —— 它會因為別人改角色而紅, 那是刻意的。
    -- 🔴🔴 **`MEMBER` 不是 `USAGE`**(codex R4 must-fix):`USAGE` 只答「繼承得到」,
    --    而 **NOINHERIT 的成員仍可 `SET ROLE`** ⇒ `USAGE` 對那條路回 false。
    -- 🛑 **我在 predicate 那支改對了, 而【這一支忘了】** —— 兩支檔同一個病, 我只修了一支。
    --    📌 一個修法只套用在你當下打開的那個檔, 而同族的另一處沒有東西會提醒你。
    IF pg_catalog.pg_has_role('anon', 'service_role', 'MEMBER')
       OR pg_catalog.pg_has_role('authenticated', 'service_role', 'MEMBER') THEN
      RAISE EXCEPTION '片2 fail-closed:anon/authenticated 繼承得到 service_role ⇒ 它們執行得了 %', v_fn;
    END IF;
  END LOOP;

  -- 🟢 負對照:上面那把尺若對【任何東西】都回同一個答案, 它就沒有判別力。
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_9137(text)') IS NOT NULL THEN
    RAISE EXCEPTION '片2 自檢:負對照命中了一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $$;

COMMIT;
