-- ══════════════════════════════════════════════════════════════════
-- M-4b · ⟦0a-CARDCANCELNOREFUND⟧ 片② 補:`refunded` 這個狀態不足以證明錢退完了
-- ══════════════════════════════════════════════════════════════════
-- 真權威 plan:`docs/plans/2026-09-05-card-cancel-blocks-until-refunded-plan.md`
-- 來源:R3(opus adversarial-reviewer, 主視窗派)2026-09-05 F4。鐵則 12①(錢)③(DB)。
-- ⛔ **本檔不由施工窗 apply。**
--
-- ── 這一支修什麼(一條鏈, 三步)────────────────────────────────
--   ① `20260905010000:310` 的同步器:`IF v_ps <> 'refunded' AND v_ps <> v_target`
--      ⇒ **`payment_status` 只升不降**
--   ② `admin_void_manual_refund`(作廢一筆人工退款)**不呼叫那支同步器**
--   ③ ⇒ 🔴 **登記一筆全額人工退款 → 作廢它 → 狀態仍是 `refunded`**
--      ⇒ `admin_mark_order_cancelled` 的第三道閘放行
--      ⇒ ⇒ **一張錢沒退的單被標成已取消。**
--
-- 🛑 **UI 那側擋不掉** —— `AdminOrderDetail` 沒有退款列(逐欄看過)⇒ 只能在 RPC 這裡擋。
--
-- ── 判準 ────────────────────────────────────────────────────
-- **現算一次實際退款額**, 不相信狀態欄。口徑**逐字對齊**同步器(`20260905010000:293-299`):
--   `order_refunds.status = 'confirmed'` + `order_manual_refunds.voided_at IS NULL`
-- ⚠️ **不自創第二種口徑** —— 兩份會分岔, 而分岔時沒有東西會叫。
--
-- 🛑 **它證不到「錢真的到客人手上」** —— 比對的是帳本, 而帳本是人登記的。
--    它擋掉的是「**帳本說沒退完而狀態說退完了**」那個內部矛盾。
--
-- ── 為什麼是 CREATE OR REPLACE ─────────────────────────────────
-- **參數列一個字未動**(仍 5 參)⇒ 取代不是多載 ⇒ ACL 與 `COMMENT ON` 原地保留。
-- 🔬 本體**程式抽出、零手抄**:`20260903093000:604-854` 原樣, 只插兩處
--    (`DECLARE` 加 `v_refunded_now` / 第三道閘之後插第五道)。
--
-- ── Rollback ──────────────────────────────────────────────────
--   把 `20260903093000:604-854` 原樣再貼一次(它也是 `CREATE OR REPLACE`, 5 參)。
--   🛑 **而回滾之後那個洞就回來了** —— 它今天在正式庫上是開著的。
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘 ════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_n integer; v_args text;
BEGIN
  SELECT count(*), string_agg(p.pronargs::text, ',') INTO v_n, v_args
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_mark_order_cancelled';
  IF v_n <> 1 OR v_args <> '5' THEN
    RAISE EXCEPTION '前置閘:admin_mark_order_cancelled 有 % 支(引數數 %)—— 期望剛好 1 支 5 參', v_n, v_args;
  END IF;
  -- 🔴 已套用過就拒(forward-only):本檔的判準字面在不在函式體裡。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='admin_mark_order_cancelled'
                AND p.prosrc LIKE '%v_refunded_now%') THEN
    RAISE EXCEPTION '前置閘:第五道閘已經在裡面了 ⇒ 本檔已套用過, forward-only 拒重跑';
  END IF;
END
$pre$;

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
  -- 🔴 第五道閘用(2026-09-05):現算一次實際退款額, 不相信 payment_status。
  v_refunded_now bigint;
  v_order_total  bigint;
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
  IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這期只開放刷卡的單, 其他付款方式的取消還沒開通';
  END IF;
  -- 🔴 **只認 refunded(全額)** —— partiallyRefunded 不算。
  --    Sean 拍甲逐字「只開刷卡且已全額退款」;部分退款是另一題, 沒有人拍過。
  IF v_order.payment_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單還沒有全額退款, 只標記取消還沒開通(部分退款不涵蓋)';
  END IF;

  -- ══ 第五道閘:`refunded` 這個狀態【只升不降】, 所以它不足以證明錢真的退完了 ══════
  -- 🔴🔴 **R3(opus)2026-09-05 F4 抓到的鏈, 我核過**:
  --    ① `20260905010000:310` 的同步器 `IF v_ps <> 'refunded' AND v_ps <> v_target` ⇒ **只升不降**
  --    ② `admin_void_manual_refund`(作廢一筆人工退款)**不呼叫那支同步器**
  --    ⇒ 🔴 **登記一筆全額人工退款 → 把它作廢 → `payment_status` 仍然是 `refunded`**
  --      ⇒ 上面那道閘放行 ⇒ **一張錢沒退的單被標成已取消。**
  -- 🛑 **而 UI 那側擋不掉它** —— `AdminOrderDetail` 沒有退款列(我逐欄看過)
  --    ⇒ 📌 **這一格只能在這裡擋。**
  -- ✅ **判準:現算一次「實際退了多少」**, 而不是相信那個狀態欄。
  --    口徑逐字對齊同步器(`20260905010000:293-299`):
  --      `order_refunds` 的 `status = 'confirmed'` + `order_manual_refunds` 的 `voided_at IS NULL`
  --    ⚠️ **不自創第二種口徑** —— 兩份會分岔, 而分岔時沒有東西會叫。
  SELECT COALESCE(pg_catalog.sum(r.refund_amount), 0)
    INTO v_refunded_now
    FROM public.order_refunds r
   WHERE r.order_id = p_order_id AND r.status = 'confirmed';
  SELECT v_refunded_now + COALESCE(pg_catalog.sum(m.refund_amount), 0)
    INTO v_refunded_now
    FROM public.order_manual_refunds m
   WHERE m.order_id = p_order_id AND m.voided_at IS NULL;

  -- 🔴🔴 **不可以寫 `v_order.total`** —— 上面步3 那個 `SELECT … INTO v_order` **沒有選 total**
  --    ⇒ `record "v_order" has no field "total"` **執行期才炸**, 而靜態檢查與編譯都看不到
  --      (plpgsql 的 record 欄位是**執行期**解析的)。
  --    ⇒ 📌 **「編譯過」與「跑得動」是兩個宣稱** —— 今天第二次, 而這次是拋棄式 PG 的**行為**驗證抓到的。
  --    🔵 **自己查一次**, 不去動步3 那個 SELECT:那一段是程式抽出的既有碼, 動它等於改基線。
  SELECT o.total INTO v_order_total FROM public.orders o WHERE o.id = p_order_id;

  IF v_refunded_now < v_order_total THEN
    -- 🔴 **訊息要說人話** —— 員工看到「狀態是已退款而系統說沒退完」會以為系統壞了。
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單的狀態寫著「已退款」, '
                    '而實際退出去的金額只有 %(這張單是 %)—— '
                    '很可能是有一筆退款被作廢了, 而狀態沒有跟著降回來。'
                    '⇒ 請先到「收款 · 退款」把剩下的退完, 或告知系統維護。',
                    v_refunded_now, v_order_total;
  END IF;
  -- 🛑 **這一格證不到「錢真的到客人手上」** —— 它比對的是帳本, 而帳本是人登記的。
  --    ⇒ 它擋掉的是「帳本自己說沒退完而狀態說退完了」那個【內部矛盾】, 不是外部事實。
  -- ══════════════════════════════════════════════════════════════════════════════
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

-- ══ 事後斷言 ══════════════════════════════════════════════════════════
DO $post$
DECLARE v_oid oid; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_mark_order_cancelled';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '斷言①:現在有 % 支 ⇒ 多載', v_n;
  END IF;

  v_oid := pg_catalog.to_regprocedure('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '斷言②:5 參那支不見了';
  END IF;

  -- ③ 判準真的在函式體裡(剝行註解後找可執行形狀, 不是找註解)
  IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
          AND pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g') LIKE '%v_refunded_now < v_order.total%') THEN
    RAISE EXCEPTION '斷言③:函式體(剝註解後)沒有第五道閘的判準 ⇒ 只改到註解';
  END IF;

  -- ④ ACL 沒掉(CREATE OR REPLACE 應該保留, 而這一格證它)
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言④:service_role 叫不動它了';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言④b:anon 或 authenticated 叫得動它';
  END IF;

  -- ⑤ COMMENT 還在
  IF pg_catalog.obj_description(v_oid, 'pg_proc') IS NULL THEN
    RAISE EXCEPTION '斷言⑤:COMMENT 不見了';
  END IF;
END
$post$;

-- 🛑 **五道斷言證不到那道閘會不會真的擋** —— 它們看的是 catalog 與函式體字面。
--    要證它擋, 得真的造一張「登記全退 → 作廢」的單再呼叫一次;而那要 service_role ⇒ 貼後對帳另檔。

-- 🔵 簽名沒變 ⇒ PostgREST 的 schema cache **不需要**重載。仍然送一次, 成本為零而漏掉的代價不對稱。
NOTIFY pgrst, 'reload schema';

COMMIT;
