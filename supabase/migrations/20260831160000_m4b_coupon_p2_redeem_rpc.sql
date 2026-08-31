-- 20260831160000_m4b_coupon_p2_redeem_rpc.sql
-- 優惠券片 2:驗券 + 原子兌換的 SECURITY DEFINER RPC。
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
-- 🔴 `below_min_spend` 排最後:只有它回一個【可行動】的數字。一張**已過期**的券若先回
--    「還差 NT$50」, 客人會去湊金額, 然後發現它根本不能用。
-- ⚠️ `already_used_by_account` 與 `exhausted` 誰先兩個都說得通:我選前者(與這位客人有關)。
--    **這一格可以被推翻。**
--
-- ══ 🛑 這支函式【答不出】的, 具名 ═══════════════════════════════════════════
-- ① **折抵算出 0 元要怎麼辦** —— 片1 `:357-361` 逐字把它列為片2 要先決定的三選一
--    (拒券 / 最低折 1 元 / 允許 0), 而且逐字「**它是【錢】那一層 ⇒ Sean 拍, 不是我挑**」。
--    ⇒ 🔴 **本函式丟例外, 而那【不是】那三個選項的任何一個** —— 它是一個「還沒決定」的佔位。
--      端給 Sean 的題已交主視窗。**在他答之前, 一張會算出 0 元的券會讓這條路 500。**
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
  v_paystat   text;
  v_used      integer;
  v_by_acct   integer;
  v_discount  integer;
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
    SELECT o.customer_user_id, o.payment_status::text
      INTO v_owner, v_paystat
      FROM public.orders o WHERE o.id = p_order_id
      FOR UPDATE;
    IF NOT FOUND OR v_owner IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'redeem_coupon: 訂單不存在或不屬於這個帳號(order_id=%)', p_order_id;
    END IF;
    -- 🔵 **寫成「不等於 paid 就擋」而不是「列出哪幾種要擋」是刻意的**:
    --    `payment_status` 這個 ENUM **已經被長過一次**
    --    (`20260725130000_..._add_partially_refunded:45` 加了 `partiallyRefunded`)
    --    ⇒ 白名單只有一個值, 它不需要知道未來會多出什麼;
    --      黑名單則會在下一個人加值的那天**安靜地放行**, 而三綠不會紅。
    --    (欄位形狀:`20260604120000_..._orders_order_items.sql:99`
    --      `payment_status payment_status NOT NULL DEFAULT 'unpaid'`)
    IF v_paystat IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION
        'redeem_coupon: 這張單還沒付款(payment_status=%)—— 片1 :7 Sean 拍乙「付款成功才算」', v_paystat;
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
        RETURN jsonb_build_object('valid', true, 'discount_applied', v_prev.discount_applied);
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

  IF p_subtotal < v_c.min_spend THEN
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
  v_discount := CASE v_c.discount_type
    WHEN 'fixed'   THEN v_c.discount_value
    WHEN 'percent' THEN round(p_subtotal::numeric * v_c.discount_value::numeric / 100)::integer
  END;
  -- 🛑 上限 = 小計(算術, 不是政策 —— 見檔頭)。
  v_discount := least(v_discount, p_subtotal);
  IF v_discount <= 0 THEN
    -- 🛑 **這裡丟例外【不是】一個決定, 是一個佔位** —— 見檔頭 ①。
    --    片1 `:357-361` 把三選一(拒券 / 最低折 1 元 / 允許 0)指名為 **Sean 拍**。
    RAISE EXCEPTION
      'redeem_coupon: 折抵算出 %(subtotal=%, code=%)—— 片1 :357-361 的三選一尚未拍板, 本函式暫不決定',
      v_discount, p_subtotal, v_code;
  END IF;

  IF v_dry_run THEN
    RETURN jsonb_build_object('valid', true, 'discount_applied', v_discount);
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

  RETURN jsonb_build_object('valid', true, 'discount_applied', v_discount);
END;
$$;

COMMENT ON FUNCTION public.redeem_coupon(text, uuid, integer, boolean, uuid) IS
  'M-4b 券片2:驗券 + 原子兌換。p_order_id NULL = 試算(不鎖不寫);有值 = 兌換(FOR UPDATE + 寫一列)。'
  '回 jsonb {valid, reason?, discount_applied?}(**shortfall 今天不回**, 見 coupon.ts:84)。reason 為 coupon_reject_reason 七值之一。'
  '同單同券同人重送 = 冪等回上次結果。訂單歸屬在函式內驗(片1 :349-356 指定)。'
  '🛑 答不出:①折抵算出 0 元的三選一未拍板(片1 :357-361)⇒ 本函式丟例外, 那是佔位不是答案 '
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
    IF pg_catalog.pg_has_role('anon', 'service_role', 'USAGE')
       OR pg_catalog.pg_has_role('authenticated', 'service_role', 'USAGE') THEN
      RAISE EXCEPTION '片2 fail-closed:anon/authenticated 繼承得到 service_role ⇒ 它們執行得了 %', v_fn;
    END IF;
  END LOOP;

  -- 🟢 負對照:上面那把尺若對【任何東西】都回同一個答案, 它就沒有判別力。
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_9137(text)') IS NOT NULL THEN
    RAISE EXCEPTION '片2 自檢:負對照命中了一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $$;

COMMIT;
