-- 20260916210000_m4b_mark_order_cancelled_non_card.sql
-- ⟦b4-MARKCANCELNONCARD⟧ 「把這張單結掉」放寬到【不是刷卡收的】單。
--
-- ══ 拍板 ═══════════════════════════════════════════════════════════════════
-- Sean 2026-09-16 逐字:`Q1 ⇒ 甲 = 所有【不是刷卡收的】單, 兩張都救得起來`
--                       `Q2 ⇒ 甲 = 維持現況人工寄, 不動寄信(0 改碼)`
-- plan:`~/pcm-mailbox/plan-把這張單結掉放寬到非刷卡單-0916.md`
--
-- ══ 🔴 它修的是一個【收不掉的狀態】, 不是一個不方便 ═══════════════════════
-- 一張已經全額退完款的非刷卡單, 後台**兩條路都不通**:
--   正常取消 `admin_cancel_order`         ⇒ `payment_refunded` 在 blockReasons ⇒ UI 就擋
--   把單結掉 `admin_mark_order_cancelled` ⇒ 第二道閘要 payment_method = 'tappay'
--                                           而非刷卡單那一欄是【空的】⇒ 永遠過不了
-- ⇒ 帳目上它會一直掛著「未取消」, 而錢早就退完了。
--
-- ══ 改什麼(只有一道閘;另外三道一個字不動)═══════════════════════════════
--   ⛔ 舊 `IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN`
--   ✅ 新 `IF v_order.payment_method IS NOT NULL AND v_order.payment_method <> 'tappay' THEN`
-- 🛑 **不動的三道**:已取消過 · payment_status 必須是 'refunded' · 先前被部分取消過。
-- ══ 🔴🔴 寄信:**本片不碰那條碼, 而【按下去會寄一封信給真客人】** ═══════════
-- ⛔ ~~本檔第一版寫:「`pcm_cancelled_email_pending` 有兩道各自獨立的條件會把這兩張擋掉:
--    ① payment_method = 'tappay' ② 有未作廢的人工退款 ⇒ 整張不寄」~~
-- 🔴 **那兩句【都是錯的】, 而錯法要留著**:我引的是 **2026-09-05** 那一版的判斷,
--    而那支 view **2026-09-12 就被換掉了**(`20260912020000`;`APPLIED.tsv:624` 說當天已貼)。
--    📌 我是 grep 到 `payment_method = 'tappay'` 就收手 —— 而命中的是 **OR 的第一支**。
-- 🟢 **活的庫 `pg_get_viewdef` 實查(2026-09-16, 2094 字元)的 WHERE 是兩支 OR**:
--    ```
--    (payment_method =  'tappay' AND payment_status IN (refunded, partiallyRefunded)
--                                AND NOT EXISTS 未作廢人工退款)
--    OR
--    (payment_method IS DISTINCT FROM 'tappay' AND pcm_order_card_refunded(id) = 0
--                                AND     EXISTS 未作廢人工退款)          ← 非卡那一支
--    ```
--    ⇒ ① 那個 tappay **只是 OR 的一支**, 不是整支 view 的硬閘。
--    ⇒ ② **方向反了** —— 「有未作廢人工退款」在**非卡那一支是【寄的必要條件】**;
--         排除它的那一段只掛在**刷卡**那一支。
-- 🔴 **而匯流是刻意的**(`packages/use-cases/src/enqueue-order-cancelled-emails.ts:7-8` 逐字):
--    「不論哪條路取消(`admin_mark_order_cancelled` / `admin_cancel_order` / **未來新增的**),
--      sweep 自己從 view 撈到 ⇒ 同一個出口」
--    ⇒ 📌 **所以「我不碰寄信 = 0 改碼」並不等於「不會寄」。** 這是本片最重要的一課。
--
-- ══ 逐張代進去算(正式庫唯讀實查, 2026-09-16)═══════════════════════════════
--    ```
--              非卡  卡退=0   有未作廢人工退  還沒寄過  通知信箱  order_source   ⇒ 會寄?
--    4JTJG9     t     t(0列)      t            t       【空】    manual_line    ⇒ 🟢 不會
--    X5F8WG     t     t(0列)      t            t        有       web           ⇒ 🔴 會寄
--    ```
--    🟢 **4JTJG9 是被【手動單留白閘】擋住的** —— `order_source` 是 `manual_line` 而
--       `notification_email` 是空的。📌 **結論碰巧對, 而理由是錯的 —— 一樣要更正。**
--    🔴 **X5F8WG 是 `web` 單、有通知信箱 ⇒ 六個條件全中。**
--    · `order_refunds` 那兩張單**零列**(全表只有 2 列, 都是 C8MYDB 的)⇒ `card_refunded = 0` 是查的不是推的。
--    · 信裡的數字:09-12 版把 `refunded_amount` 改成 **卡退 + 人工退** ⇒ `0 + 10,500 >= total`
--      ⇒ `refund_kind = 'full'` ⇒ **信會寫「已全額退款 NT$10,500」, 而那句話是真的。**
--    ⇒ 📌 **所以這不是「會寄錯信」, 是「會不會多寄一封」** —— 兩種的下一步不同。
--    · `CANCELLED_EMAIL_CUTOFF` 在 production **有設**(主視窗 2026-09-16 核, 只看名稱不看值)
--      ⇒ sweep 會跑 ⇒ **不能靠「沒設所以不會發生」。**
-- ══ 🟢 Sean 的裁示:**知情之後的甲**(2026-09-16 · 不是「維持現況」)═══════════
-- ⛔ ~~第一次他答的甲:「維持現況人工寄, 0 改碼」~~ —— 那一次是在**與事實相反的前提**下拍的
--    (主視窗轉述了本檔第一版那兩句錯的宣稱)。
-- ✅ **把事實端回去之後他重答, 逐字:`A: 甲 = 要, 讓它自動寄`。**
--    端給他的版本明寫了三件事:① 信會寫「訂單已取消, 已退款 NT$10,500」**而那句是真的**
--    ② 風險是他或員工若已自己通知過, 客人會收到**第二封** ③ 乙的代價是以後每張非卡單
--    取消都要記得人工寄、**而沒有東西會提醒**。他看完仍然答甲。
-- 🔴🔴 **要寫成「知情之後的甲」, 不能寫成「維持現況」** —— 📌 那兩句話在三個月後長得一模一樣,
--    而**只有前者擋得住「他當初不知道」這個誤會**。命中 `00-work-rules §2`(對外可見、不可逆)。
-- ⇒ 所以本片**不需要第二支板**:非卡那一支留在掃描面上, 碼的形狀不變。
--
-- ══ 🔵 另一個路口(R1 consider C1;我原本漏了它, 是審查員查的)═══════════════
-- `20260901080000:495` `CREATE TRIGGER order_pending_refund_open_au AFTER UPDATE OF cancelled_at ON orders`
-- (函式最新代 `20260910210000:223`)⇒ **本片這一發寫 `cancelled_at` 會點燃它**, 它做兩件事:
--   · `pcm_pending_refund_open_for` —— 只取 `net > 0` 的軌, 全額退完 ⇒ 零列 ⇒ 不會開出假的待退款。
--   · `coupon_revert_on_full_refund` —— **會真的改資料**(退券)。符合 Sean 2026-09-11 Q5 甲
--     「取消就退券, 不管有沒有退過錢」⇒ 這兩張若用過券, 券會回到客人手上。
-- 📌 **而那個路口的檔頭自己逐字寫著**它蓋得住「每一條把 cancelled_at 從 NULL 改成有值的路,
--    **含還沒被寫出來的那一條**」⇒ 🛑 **「我只查了那一支 view」那個分母, 漏的就是這種路口。**
--
-- ══ 🔴 簽章不動 ⇒ 沒有雙向空窗 ═════════════════════════════════════════════
-- 參數一個都不加不減 ⇒ **不會有**「板先貼舊碼叫不動(PGRST202)/ 碼先推新碼叫不動」那個形狀
-- (2026-09-16 板 199 出貨五支 RPC 改簽章的帳)。
-- ⇒ 而板與碼**仍然當成同一次動作**貼與推, 中間時間壓到最短。
--
-- ══ 這一版是從哪裡抄來的(不是憑記憶)═══════════════════════════════════════
-- `bash scripts/latest-definition-of.sh admin_mark_order_cancelled` ⇒ newest = **20260903093000**
-- 🔴 **不是第一筆 20260902140000** —— 那一版少了 `payment_expired` 保留字那道閘。
-- 🟢 而 20260903093000 的函式本體與**活的正式庫 `pg_proc.prosrc` 逐字相同**
--    (2026-09-16 唯讀 dump 後做 diff, 10,928 vs 10,929 bytes 差一個結尾換行)。
--    ⇒ 📌 **「view / 函式的真相在活的庫」那條這次是【對上了】, 而我是查過才敢這樣說。**
--
-- ══ Rollback ═══════════════════════════════════════════════════════════════
-- 把 `20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql` 的
-- `CREATE OR REPLACE FUNCTION public.admin_mark_order_cancelled(…)` 那一整段原封重貼即可。
-- 🔴 **`CREATE OR REPLACE` 會把 `SET` 子句整組換掉** ⇒ 重貼時 `SET search_path = ''` 與
--    `SET lock_timeout = '5s'` 兩行**必須一起帶回去**, 少一行就是把 SECURITY DEFINER 的
--    search_path 保護拆掉, 而**沒有東西會叫**。
-- 🔵 回滾不需要動資料:本片 0 筆既有資料被改寫。
--
-- ══ 🛑 本檔的事後閘證得了什麼 ═════════════════════════════════════════════
-- 證得了:那道閘的**整句**在不在、舊那句有沒有留著、另外三道在不在、順序在 UPDATE 之前、
--         SECURITY DEFINER + search_path='' 還在、ACL 只有 owner + service_role。
-- **證不到**:那道閘**擋不擋得住**(文字尺答不了「這段碼到得了嗎」)。
--   ⇒ 行為那一層在 `scripts/mark-order-cancelled-verify.sh`(拋棄式 PG), 不在本檔。
--   ⇒ 而「Sean 在後台按下去會怎樣」只有他自己走一遍答得出來。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:確認我要改的就是我抄的那一版 ────────────────────────────────
DO $pre$
DECLARE v_def text; v_oid oid;
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 admin_mark_order_cancelled ⇒ 這個庫不是我以為的那個庫, 停下';
  END IF;
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  -- 🔴 **正對照**:舊那句必須【在】—— 不在就代表有人已經動過, 而我手上這一版會把他的改動蓋掉。
  -- 🔴🔴 **錨帶「換行 + 兩格縮排」, 理由與下面事後閘②【完全相同】** ——
  --    ⛔ 本檔第一版這裡用裸字串, 而新版函式的**註解**裡逐字留著同一串字
  --       ⇒ 貼完再貼一次, 這一格**會通過**, 而訊息裡「(或已貼過本片)」那句是假的。
  --    📌 **那個教訓在事後閘②當場抓到過一次, 而我沒有把它套回這裡** ——
  --       一道守門學到的事, 不會自己走到隔壁那道守門。(R1 N1 抓到。)
  IF pg_catalog.strpos(v_def, E'\n  IF v_order.payment_method IS DISTINCT FROM ''tappay'' THEN') = 0 THEN
    RAISE EXCEPTION '前置閘:舊那道 payment_method 閘【不在碼裡】⇒ 有人先動過, 或本片已經貼過 ⇒ 停下, 不要盲蓋';
  END IF;
  -- 🔴 `payment_expired` 那道(20260903093000 加的)也必須在 ⇒ 證明我抄的是【第二代】不是第一代。
  IF pg_catalog.strpos(v_def, 'IF v_detail = ''payment_expired'' THEN') = 0 THEN
    RAISE EXCEPTION '前置閘:現行定義裡沒有 payment_expired 保留字那道閘 ⇒ 庫裡是【第一代】, 而我手上是第二代改的 ⇒ 停下';
  END IF;
END
$pre$;

-- ── 2. 函式(整支重貼, 只有第二道閘不同)──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_order_cancelled(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_order       record;
  v_audit       record;
  v_detail      text;
  v_reason_txt  text;
  v_bad         bigint;
  v_q0          text;   -- 🔴 是【摘要】不是筆數(列數 + 每列 id:數量 的 md5)
  v_q1          text;
  v_generic_msg constant text := 'admin_mark_order_cancelled: 標記失敗';
BEGIN
  -- 步1 隔離閘(A8c 家族同款;RR 等鎖醒來舊快照會漏看真相表)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(七值映射逐字同 admin_cancel_order;輸入類=具體訊息)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 冪等鍵缺失';
  END IF;
  v_reason_txt := CASE p_reason_code
    WHEN 'customer_request' THEN '依您要求取消'
    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
    WHEN 'other'            THEN NULL
    ELSE NULL END;
  IF v_reason_txt IS NULL AND p_reason_code IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 未知取消原因碼';
  END IF;
  v_detail := pg_catalog.btrim(p_reason_detail);
  IF v_detail = '' THEN v_detail := NULL; END IF;
  IF p_reason_code = 'other' THEN
    IF v_detail IS NULL THEN
      RAISE EXCEPTION 'admin_mark_order_cancelled: other 需填取消說明';
    END IF;
    -- 🔴🔴 **員工原文不得撞上【機器碼】**(⟦b4-CANCELKINDBYCONTENT⟧, 2026-09-03)。
    --    與 `admin_cancel_order` 同一片、同一道、逐字同一個字面 —— 而**兩支都要有**:
    --    🔴 codex 關卡2 R1 must-fix(2/8)抓到本片第一版**只擋了 admin_cancel_order**,
    --       而 `admin_mark_order_cancelled` 是**第二條寫入路**(本檔 :384 逐字
    --       `cancelled_reason = v_reason_txt`)⇒ 員工從「標記為已取消」那個入口照樣打得進去。
    --    📌 **⇒ 我當時的分母是【一支檔】, 而那一支檔內的結論完全正確。**
    --       量錯的不是那道閘, 是【誰會寫這一欄】那張清單。
    IF v_detail = 'payment_expired' THEN
      RAISE EXCEPTION 'admin_mark_order_cancelled: 取消說明不可使用系統保留字「payment_expired」——'
        ' 那是系統給【未付款自動失效】用的代號, 填它會讓客人在訂單頁看到錯的取消原因。'
        ' 請改用其他說明, 或選擇對應的取消原因碼。';
    END IF;
    v_reason_txt := v_detail;
  ELSIF v_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 非 other 不得填說明';
  END IF;

  -- 步3 鎖單(第一觸表)
  SELECT o.id, o.payment_status, o.payment_method, o.cancelled_at,
         o.cancelled_reason, o.cancel_items_untouched
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步4 冪等格(同 (order_id, key) 且同 action)
  -- 🔴🔴 **`request_id` 是 `text` 不是 `uuid`**(真表 `20260712210000` 檔內
  --    `request_id  text        NOT NULL`)⇒ **一定要 `::text`**。
  --    實測(拋棄式 PG 17.10):`text = uuid` ⇒ `ERROR: operator does not exist: text = uuid`
  --    ⇒ 少了那個 cast,**每一發合法呼叫都會在這一行炸**。
  --    (而 `INSERT` 那一側 uuid → text 有 assignment cast、**不會**炸 ⇒ 兩側行為不同,
  --     所以只看 INSERT 過了不能推論 SELECT 也過。)
  --    🔵 既有的 `admin_cancel_order` 就是這樣寫的(錨:`g.request_id = p_idempotency_key::text`)
  --      —— 我第一版沒照它,而 harness 的 fixture 把欄型別手寫成 uuid ⇒ **它把這個 bug 蓋住了**。
  -- 🔴 **`request_id` 沒有 UNIQUE ⇒ 必須【數恰 1】,不能 `SELECT INTO` 隨便撈一列**
  --    (同一個理由寫在 `20260830020000` 檔內,錨:「request_id 非 UNIQUE ⇒ 必數恰 1」)。
  --    否則兩列互相矛盾的歷史,會被任取一列而認成合法重放。
  SELECT count(*) INTO v_bad
    FROM public.admin_audit_log g
   WHERE g.target = 'order:' || p_order_id::text
     AND g.action = 'order.mark_cancelled'
     AND g.request_id = p_idempotency_key::text;
  IF v_bad > 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_bad = 1 THEN
    SELECT g.actor, g.source_app, g.reason INTO v_audit
      FROM public.admin_audit_log g
     WHERE g.target = 'order:' || p_order_id::text
       AND g.action = 'order.mark_cancelled'
       AND g.request_id = p_idempotency_key::text;
    -- 🔴 fail-loud:只要有一格對不上就炸,不回 idempotent:true。
    --    「同一把鑰匙、不同的手、或不同的結果」= 那不是重放,是別的東西。
    -- 🔴 **`reason` 與最終對客文字也要比**(codex R1 抓):
    --    少了它,第一次送 `customer_request`、第二次改送 `other + 另一段理由`,
    --    **照樣回 `idempotent:true`** ⇒ 呼叫端會以為第二次那個理由生效了,而它一個字都沒寫進去。
    IF v_audit.actor IS DISTINCT FROM p_actor
       OR v_audit.source_app IS DISTINCT FROM 'admin'
       OR v_audit.reason IS DISTINCT FROM p_reason_code
       OR v_order.cancelled_reason IS DISTINCT FROM v_reason_txt
       OR v_order.cancelled_at IS NULL
       OR v_order.cancel_items_untouched IS DISTINCT FROM true THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('marked', true, 'idempotent', true);
  END IF;

  -- 步5 🔴🔴 三道業務閘(Sean 2026-09-02 拍甲:只開刷卡且已全額退款)
  --    **它們住在函式裡, 不只住在 UI** —— UI 只是不顯示, 函式才是閘。
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單已經取消過了';
  END IF;
  -- 🔴🔴 **2026-09-16 Sean 拍甲:放寬到【不是刷卡收的】單。** 舊閘逐字:
  --    ⛔ ~~`IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN`~~(只開刷卡, 2026-09-02 拍甲)
  --    ⇒ 那道閘是一個**上線節奏的節流閥**, 不是安全不變式 —— 真正的保證是下面那道
  --      `payment_status = 'refunded'`(錢已經全額退完)。
  --    🔬 **而推翻它的是實查, 不是道理**(正式庫唯讀, 2026-09-16;全庫訂單分母 10 張):
  --      「已全額退款而還沒取消」的單共 3 張 —— 兩張卡在這道閘上, 一張(刷卡)本來就過得了:
  --        4JTJG9  payment_method NULL · channel bank_transfer · manual_line ·  1,785
  --        X5F8WG  payment_method NULL · channel bank_transfer · **web**     · 10,500
  --        C8MYDB  payment_method 'tappay'                     · web        ·      4  ← 正對照, 行為不得變
  --    🔴 **Sean 原本說的是「放寬到手動單」, 而 X5F8WG 是【顧客自己在網站下的】** ——
  --      照字面用 `order_source` 當閘的話, 那張 10,500 的永遠結不掉。
  --      ⇒ 📌 兩張的共同點不是「手動建的」, 是**不是刷卡收的**。事實端回去之後 Sean 改拍甲。
  -- 🛑 **放寬的是「空的」, 不是全開**:`zero_total` 那種單有自己的結清路徑(20260901030000),
  --    它仍然會被這道閘擋下來 —— 而那是刻意的, 不是漏網。
  IF v_order.payment_method IS NOT NULL AND v_order.payment_method <> 'tappay' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這條路只收刷卡單與非刷卡(匯款/現金)的單, 而這張單的付款方式是 %', v_order.payment_method;
  END IF;
  -- 🔴 **只認 refunded(全額)** —— partiallyRefunded 不算。
  --    Sean 拍甲逐字「只開刷卡且已全額退款」;部分退款是另一題, 沒有人拍過。
  IF v_order.payment_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單還沒有全額退款, 只標記取消還沒開通(部分退款不涵蓋)';
  END IF;
  -- 🔴🔴 **第四道閘(2026-09-02 R3 抓、主視窗判甲 —— 不是 Sean 拍板)**:
  --    先前被【部分取消過】的單, 這條路不收。
  --    理由見檔頭「與 admin_cancel_order 的硬不變式」那一節。一句話:
  --    那類單有舊的 `order.cancel` 稽核列 ⇒ 舊冪等鍵重放會撞上對方的等價斷言而炸,
  --    而 `20260830020000` 步5 的「已取消 ⇒ 拒」會讓**剩下那幾個品項永遠再也取消不了**
  --    (不會有取消 header、不會釋庫存)。
  --    ⇒ 拒掉它 = 傷害歸零;而那類單本來就還有既有的 `admin_cancel_order` 可以走完。
  -- ⚠️ **這道閘與步7/步10 的「前後相等」斷言【不是同一件事】**:
  --    **閘擋的是「進來之前就有」,斷言擋的是「我這一發交易中途有東西插進來」。**
  IF EXISTS (SELECT 1
               FROM public.order_cancellation_items ci
               JOIN public.order_items oi ON oi.id = ci.order_item_id
              WHERE oi.order_id = p_order_id) THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單先前被部分取消過, 只標記那條路不收(請走既有的整單取消)';
  END IF;

  -- 步6 actor 存在且在職
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步7 🔴 量【動之前】的品項取消筆數。
  --    這一格與步10 成對, 它們一起把「我沒有動數量」變成一個**會炸的斷言**, 而不是一句話。
  -- 🔴 **只比【列數】不夠**(codex R1 抓):一個 trigger 可以把既有的 `cancelled_quantity`
  --    由 1 改成 2、或「刪一列再補一列」⇒ **列數前後相等而數量真的變了**
  --    ⇒ 函式會成功,而 `cancel_items_untouched` 會說一句假話。
  --    ⇒ 改成比一個**摘要**:列數 + 每一列的 (id, 數量) 依 id 排序之後的 md5。
  --    🔵 帶 `count(*)` 是為了讓「零列」與「NULL」分得開(`string_agg` 對空集合回 NULL)。
  --    ⚠️ `coalesce` **不加 `pg_catalog.` 前綴** —— 它是 SQL 語法構造(像 CASE),不是 catalog 裡的函式;
  --      加了會炸 `function pg_catalog.coalesce(text, unknown) does not exist`(2026-09-02 實測)。
  --      而它在 `search_path = ''` 底下照樣可用。
  -- 🔴 R2 must-fix:摘要**只含 `ci.id:數量` 還是不夠** ——
  --    ①副作用改 `order_items.quantity` ②把取消量搬到【同一張單的另一個 order_item_id】
  --    ⇒ 兩種摘要都完全相同, 而數量真的變了。
  --    ⇒ 分母改成【從 order_items 出發 LEFT JOIN】, 並把 `oi.id` / `oi.quantity` 放進摘要。
  --      LEFT JOIN 是為了讓「品項存在而沒有取消列」也留下形狀 —— 少了它, 一張**沒有任何取消列**
  --      的單, 摘要前後都是 `0|-` ⇒ 改 `oi.quantity` 完全看不見(逐點突變實測:世界⑰ 由紅轉綠)。
  -- 🔵 **而我原本還把 `ci.order_item_id` 放進摘要, 量完之後拿掉了** ——
  --    逐點突變(**2026-09-02 R2 修完當下、那時的世界集是 23 個**;R3 之後 ⑯⑱ 被宣告不可達而移除,
  --    今天是 21 個)⇒ 只拿掉它 ⇒ **當時那 23 個世界仍然全綠** ⇒ **沒有任何一格需要它**
  --    🔴 **數字帶時點是因為本檔 apply 之後連註解都改不了** —— 一個沒有時點的數字,
  --    下一個人重跑會複現不出來, 而他分不出「我做錯了」與「那個數字本來就是別的世界集量的」。
  --    (「搬到同單另一個品項」那一格是靠 `ORDER BY oi.id` 讓聚合順序變了而抓到的, 不是靠它)。
  --    📌 **一段沒有世界殺得死的保護, 與沒有寫它, 在行為上相同 —— 而它會讓下一個人以為那裡有防護。**
  SELECT count(*)::text || '|' || coalesce(pg_catalog.md5(
           pg_catalog.string_agg(
             oi.id::text || '#' || oi.quantity::text || '#' ||
             coalesce(ci.id::text, '-') || ':' || coalesce(ci.cancelled_quantity::text, '-'),
             ',' ORDER BY oi.id, ci.id NULLS FIRST)), '-')
    INTO v_q0
    FROM public.order_items oi
    LEFT JOIN public.order_cancellation_items ci ON ci.order_item_id = oi.id
   WHERE oi.order_id = p_order_id;

  -- 步8 寫對客欄 + 訊號欄
  UPDATE public.orders
     SET cancelled_at            = pg_catalog.now(),
         cancelled_reason        = v_reason_txt,
         cancel_items_untouched  = true,
         updated_at              = pg_catalog.now()
   WHERE id = p_order_id;
  -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步9 稽核。🔴 action 用 'order.mark_cancelled' **刻意不是 'order.cancel'** ——
  --    既有的冪等格與守門是用 `g.action = 'order.cancel'` 去撈的
  --    (`20260830020000` 檔內,錨字串 `g.action = 'order.cancel'`)
  --    ⇒ 兩支共用同一個 action ⇒ **它們會互相認成對方的冪等紀錄**;
  --    而稽核上也要分得出「有動數量的取消」與「只標記」。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.mark_cancelled', 'order:' || p_order_id::text, p_idempotency_key::text,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', NULL, 'cancel_items_untouched', false),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', pg_catalog.now(), 'cancel_items_untouched', true),
          p_reason_code, 'admin');
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步10 🔴🔴 **【不寫數量】要寫成一道會炸的斷言, 不是一句「我們不寫」。**
  --    ⚠️ 比的是【前後相等】不是【等於 0】——
  --      一張被部分取消過而沒關單的單, 它的 cancellation_items 本來就不是 0
  --      (`20260805100000` 檔內, 錨 `v_closed` —— 部分取消只有關單時才寫 cancelled_at)。
  --    📌 **斷言要證的是【我的非動作】, 不是【世界的狀態】。**
  -- 🔴 R2 must-fix:摘要**只含 `ci.id:數量` 還是不夠** ——
  --    ①副作用改 `order_items.quantity` ②把取消量搬到【同一張單的另一個 order_item_id】
  --    ⇒ 兩種摘要都完全相同, 而數量真的變了。
  --    ⇒ 分母改成【從 order_items 出發 LEFT JOIN】, 並把 `oi.id` / `oi.quantity` 放進摘要。
  --      LEFT JOIN 是為了讓「品項存在而沒有取消列」也留下形狀 —— 少了它, 一張**沒有任何取消列**
  --      的單, 摘要前後都是 `0|-` ⇒ 改 `oi.quantity` 完全看不見(逐點突變實測:世界⑰ 由紅轉綠)。
  -- 🔵 **而我原本還把 `ci.order_item_id` 放進摘要, 量完之後拿掉了** ——
  --    逐點突變(**2026-09-02 R2 修完當下、那時的世界集是 23 個**;R3 之後 ⑯⑱ 被宣告不可達而移除,
  --    今天是 21 個)⇒ 只拿掉它 ⇒ **當時那 23 個世界仍然全綠** ⇒ **沒有任何一格需要它**
  --    🔴 **數字帶時點是因為本檔 apply 之後連註解都改不了** —— 一個沒有時點的數字,
  --    下一個人重跑會複現不出來, 而他分不出「我做錯了」與「那個數字本來就是別的世界集量的」。
  --    (「搬到同單另一個品項」那一格是靠 `ORDER BY oi.id` 讓聚合順序變了而抓到的, 不是靠它)。
  --    📌 **一段沒有世界殺得死的保護, 與沒有寫它, 在行為上相同 —— 而它會讓下一個人以為那裡有防護。**
  SELECT count(*)::text || '|' || coalesce(pg_catalog.md5(
           pg_catalog.string_agg(
             oi.id::text || '#' || oi.quantity::text || '#' ||
             coalesce(ci.id::text, '-') || ':' || coalesce(ci.cancelled_quantity::text, '-'),
             ',' ORDER BY oi.id, ci.id NULLS FIRST)), '-')
    INTO v_q1
    FROM public.order_items oi
    LEFT JOIN public.order_cancellation_items ci ON ci.order_item_id = oi.id
   WHERE oi.order_id = p_order_id;
  IF v_q1 IS DISTINCT FROM v_q0 THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 只標記那條路動到了品項數量(前 % 後 %)⇒ 契約被破壞, 全回滾', v_q0, v_q1;
  END IF;

  RETURN pg_catalog.jsonb_build_object('marked', true, 'idempotent', false);
END;
$fn$;

-- ── 3. COMMENT 附加(forward-only;不覆蓋既有那幾句)──────────────────────
DO $c$
DECLARE v_old text;
BEGIN
  v_old := pg_catalog.obj_description('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:讀不到既有 COMMENT ⇒ 停下';
  END IF;
  IF pg_catalog.strpos(v_old, '20260916210000') > 0 THEN
    RAISE EXCEPTION 'COMMENT 附加:看起來已經附加過 ⇒ forward-only, 拒重跑';
  END IF;
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.admin_mark_order_cancelled(uuid,uuid,text,text,text) IS %L',
    v_old || ' 🔴 2026-09-16(⟦b4-MARKCANCELNONCARD⟧;Sean 拍甲):第二道閘從'
          || ' 「payment_method 必須是 tappay」放寬成「payment_method 是空的或 tappay」——'
          || ' 非刷卡(匯款/現金)的單也收, 而 zero_total 那種仍然擋。'
          || ' 🛑 上面那句「三道閘住在函式裡:… payment_method = tappay …」**已經過期**, 以本句為準。'
          || ' 🛑 寄信那條路(pcm_cancelled_email_pending)**沒有跟著放寬**(Sean Q2 甲)⇒'
          || ' 這類單的取消信仍然是人工寄。落點 20260916210000。');
END
$c$;

-- ── 4. 收權(縱深;`CREATE OR REPLACE` 本來就保留 ACL, 這幾行是再做一次)───
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) TO service_role;

-- ── 5. 事後閘 ──────────────────────────────────────────────────────────────
-- 🔴 **它讀的是【庫裡那支函式的定義】, 不是本檔的字面** —— 拿本檔驗本檔是恆真。
DO $gate$
DECLARE
  v_sig  constant text := 'public.admin_mark_order_cancelled(uuid,uuid,text,text,text)';
  v_oid  oid;
  v_def  text;
  v_cfg  text;
  v_p_if int;
  v_p_up int;
  v_r    text;
  v_bad  text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(v_sig);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '事後閘:找不到 % ⇒ 本閘沒有接上', v_sig;
  END IF;
  v_def := pg_catalog.pg_get_functiondef(v_oid);

  -- ① 新閘的【整句】在。🔴 錨是整句 `IF … THEN` 不是裸條件 —— 20260903093000 R2 F3 那一課:
  --    `IF NOT (…) THEN` / `… AND false THEN` 會讓語意整個反過來, 而裸條件那把尺印綠。
  IF pg_catalog.strpos(v_def,
       'IF v_order.payment_method IS NOT NULL AND v_order.payment_method <> ''tappay'' THEN') = 0 THEN
    RAISE EXCEPTION '事後閘①:新的 payment_method 閘整句不在 ⇒ 沒裝上, 或條件被改寫過';
  END IF;

  -- ② 舊閘【不得】留著。兩道一起在 = 舊那道先擋 ⇒ 放寬等於沒發生, 而 ① 照樣綠。
  -- 🔴🔴 **錨要帶「換行 + 兩格縮排」, 不能用裸字串** —— 而這是本閘【當場抓到我自己】才改的:
  --    `pg_get_functiondef` 回的是**含註解的整支本體**, 而本檔上面那段把舊那句
  --    逐字重貼在 `⛔ ~~…~~` 裡當歷史紀錄 ⇒ 裸字串版本命中【我自己的註解】⇒ 本閘在拋棄式 PG 上直接炸。
  --    ⇒ 📌 **那不是誤報, 是這把尺量錯了東西** —— 它要量的是「還有沒有那一行【碼】」,
  --      而它量成了「這個檔案裡有沒有這串【字】」。改成錨在行首縮排的那個形狀。
  --    ⚠️ 天花板寫明:有人把舊那行改成別的縮排(四格 / Tab)本閘就看不到了。
  --      文字尺只能做到這裡;真正答「哪一道先擋」的是行為層(scripts/mark-order-cancelled-verify.sh)。
  IF pg_catalog.strpos(v_def, E'\n  IF v_order.payment_method IS DISTINCT FROM ''tappay'' THEN') > 0 THEN
    RAISE EXCEPTION '事後閘②:舊那道 payment_method 閘【還在碼裡】(不是註解)⇒ 它會先擋 ⇒ 放寬沒有生效';
  END IF;

  -- ③ 另外三道閘逐字還在(本片宣稱「只動一道」—— 這一格就是在驗那句宣稱)。
  FOREACH v_r IN ARRAY ARRAY[
    '這張單已經取消過了',
    '這張單還沒有全額退款',
    '這張單先前被部分取消過'
  ] LOOP
    IF pg_catalog.strpos(v_def, v_r) = 0 THEN
      RAISE EXCEPTION '事後閘③:另外三道閘裡的「%」不見了 ⇒ 本片宣稱只動一道, 而它動到別道', v_r;
    END IF;
  END LOOP;

  -- ④ 順序:那道閘必須在把 cancelled_at 寫下去【之前】。
  --    只驗「字串在」的話,「閘被搬到 UPDATE 之後」與「閘還在原位」印同一個綠。
  v_p_if := pg_catalog.strpos(v_def, 'IF v_order.payment_method IS NOT NULL');
  v_p_up := pg_catalog.strpos(v_def, 'SET cancelled_at            = pg_catalog.now()');
  IF v_p_up = 0 THEN
    RAISE EXCEPTION '事後閘④:找不到寫 cancelled_at 那一段 ⇒ 這一格量不到順序(而不是順序對了)';
  END IF;
  IF v_p_if > v_p_up THEN
    RAISE EXCEPTION '事後閘④:那道閘跑在寫 cancelled_at 之後 ⇒ 它擋不住任何東西';
  END IF;

  -- ⑤ SECURITY DEFINER + search_path='' 沒有被 CREATE OR REPLACE 洗掉(踩過的那一條)。
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION '事後閘⑤:% 不再是 SECURITY DEFINER', v_sig;
  END IF;
  SELECT pg_catalog.array_to_string(p.proconfig, ',') INTO v_cfg
    FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  -- 🔴🔴 **比對【整個元素】, 不是「有沒有 search_path= 這個字」**(R1 consider C2 抓到)。
  --    ⛔ 本檔第一版用 `strpos(v_cfg,'search_path=')` ⇒ **`search_path=public` 也會過**,
  --       而那一格的訊息說的是「`search_path=''` 被洗掉了」⇒ 📌 **宣稱比它做得到的寬。**
  --    🔵 形狀照 repo 既有的硬寫法 `20260910210000:287` 與 `:295`:`proconfig @> ARRAY['search_path=""']`
  --       —— 🛑 **字面就是 `search_path=""`(帶雙引號)**, 那是 PG 存空字串的樣子, 不是打錯。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = v_oid AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '事後閘⑤:% 的 search_path 不是空字串(實際 %)⇒ SECURITY DEFINER 的提權面被打開了', v_sig, coalesce(v_cfg, '(NULL)');
  END IF;
  -- 🔵 `lock_timeout` 同一組 SET 子句, 一起問 —— 它也是 CREATE OR REPLACE 會整組換掉的東西。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = v_oid AND p.proconfig @> ARRAY['lock_timeout=5s']
  ) THEN
    RAISE EXCEPTION '事後閘⑤:% 的 lock_timeout 不是 5s(實際 %)', v_sig, coalesce(v_cfg, '(NULL)');
  END IF;

  -- ⑥ ACL:零 PUBLIC / anon / authenticated,且 service_role 有 EXECUTE。
  IF pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑥:PUBLIC / anon / authenticated 其中之一拿得到 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑥:service_role 拿不到 EXECUTE ⇒ 後台會整個叫不動這支';
  END IF;

  RAISE NOTICE '事後閘通過(六格):①新閘整句在 ②舊閘已移除(錨在行首縮排, 不會命中註解)③另外三道還在 ④順序在寫 cancelled_at 之前 ⑤SECURITY DEFINER + proconfig 逐元素相符(search_path="" 與 lock_timeout=5s, 不是「有設就算」)⑥ACL 只有 service_role。🛑 **六格都是【文字尺與目錄尺】** —— 它們證不到那道閘【擋不擋得住】(把真閘包進一個到不了的分支, 這六格仍然全綠)。行為在 scripts/mark-order-cancelled-verify.sh;而「Sean 按下去會怎樣」只有他走一遍答得出來。';
END
$gate$;

COMMIT;
