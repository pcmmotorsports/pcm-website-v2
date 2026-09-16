-- 20260916210000-rollback.sql —— 退回 20260916210000_m4b_mark_order_cancelled_non_card.sql
--
-- 做什麼:把 `admin_mark_order_cancelled` 的本體換回**貼板前那一代**(`20260903093000`),
--         把附加上去的那段 COMMENT 切掉,並把授權再收一次。
--
-- 🔴 **為什麼這支檔會遲到**:2026-09-16 同日其他 21 支 migration 都有還原檔,**獨缺這一支**。
--    主視窗貼板時另外做了一份 `~/pcm-mailbox/貼板-0912/200r_20260916210000_還原_災難用.sql`,
--    ⇒ 📌 **而要回滾的人會先來 `supabase/rollbacks/` 找,那裡當時是空的。**
--
-- ══ 🛑 它保證什麼 / 不保證什麼(先讀這一段)═════════════════════════════════
-- ✅ **保證**:函式本體逐字回到 `20260903093000` 那一代(用 md5 釘住,退完自己驗)。
-- ❌ **不保證**是一支冪等的「退回腳本」—— 它是**貼前定義的快照**。
--    ⇒ 對一個**已經退過**的庫再跑一次,前置閘會擋(md5 已經不是新那一代)⇒ 那是刻意的。
-- ❌ **不保證**資料 —— 本片 0 筆資料被改寫,所以沒有資料要退;
--    而**退之後,放寬期間已經被結掉的單【不會】跟著復原**(`cancelled_at` 已經寫下去了)。
--    🔴 **而那是真的會發生的事**:放寬的用途就是讓人去按那顆鈕。退回去只是把**門關上**,
--       不是把**已經走出去的人叫回來**。⇒ 退之前先查 `orders` 有哪幾張是這期間被結掉的。
-- ❌ **不保證**信 —— 那些單若已經進了 `pcm_cancelled_email_pending` 並寄出,**信收不回來**。
--
-- ══ 🔴 貼回去會失敗的那四種,逐條核過(不是照抄素材檔那段)═══════════════════
--   ① 新版替 view 尾端加欄     ⇒ **不中**:本片改的是**函式**,不是 view。
--   ② 新版替參數加 DEFAULT     ⇒ **不中**:本片**一個參數都沒動**(簽章逐字相同)。
--   ③ 新版新增 overload        ⇒ **不中**:同上,簽章相同 ⇒ 是覆蓋不是新增。
--   ④ 同片另改 OWNER / GRANT / REVOKE ⇒ 🔴 **可能中,所以本檔自己處理**:
--      `20260916210000` 第 4 節有一段 REVOKE + GRANT(縱深,內容與原本相同)。
--      貼回本體**不會**把權限帶回去 ⇒ 本檔把那三行原樣再跑一次,並在後置閘驗 ACL。
--   ⑤ 🔴 **素材檔那四種【沒有列到】的第五種:COMMENT。**
--      `20260916210000` 是 `v_old || '…'` **附加**上去的 ⇒ **貼回本體不會把它切掉**。
--      ⇒ 本檔用 `strpos` 找到那一段的起點切回去,並在後置閘驗它真的不見了。
--      📌 **一份「四種」的清單,不等於只有四種** —— 照抄就會漏掉這一種。
--
-- ══ 順序 ═══════════════════════════════════════════════════════════════════
-- 🔵 **簽章沒動 ⇒ 兩個方向都沒有空窗** —— 碼先退或板先退都不會 PGRST202。
--    (與 `20260916190000-rollback` 不同:那一支改了簽章,必須先退 TS。)
--    ⇒ 本檔可以單獨跑。跑完那顆鈕對非刷卡單就會回到「按了必被拒」。
-- 🔴 退完同批跑 `pcm_acl_approve_latest`,`p_note` 帶 `20260916210000` 與「rollback」。
--
-- ══ 舊本體從哪裡來(不是憑記憶)═════════════════════════════════════════════
-- `supabase/migrations/20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql` 的函式段,
-- 而該版在貼板前**與正式庫 `pg_proc.prosrc` 做過 diff、逐字相同**(2026-09-16,10,929 bytes)。
-- ⇒ 退完 `md5(prosrc)` 應該是 `a76039fbe9be95715c069a5b3c4dc630`(長度 10929)——**後置閘釘的就是它**。

-- ══ 🔴 本檔【真的在拋棄式 PG 上跑過一次】, 而第一版跑不起來 ═════════════════
--   第一版寫 `pg_catalog.position(x in y)` 與 `pg_catalog.substring(x from a for b)`
--   ⇒ **這兩個都是 SQL 特殊語法,
--   不能加 schema 前綴** ⇒ `ERROR: syntax error at or near "v_old"`。四處全中。
--   ⇒ ✅ 改成 `pg_catalog.strpos(y, x)`(注意兩個參數的順序**相反**)。
--   📌 **一份沒有被跑過的還原檔, 與沒有還原檔的差別只有「你以為有」。**
--      而它會在最壞的時刻才第一次被跑。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  -- 前置閘①:必須**正在** 20260916210000 那一代 —— 釘 2026-09-16 貼完當場量到的 md5。
  --   🔴 它同時擋掉「已經退過」與「有人後來又改過」兩種:兩種都不該盲貼。
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)');
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '退回前置閘①:找不到 admin_mark_order_cancelled ⇒ 這個庫不是我以為的那個庫';
  END IF;
  IF v_md5 IS DISTINCT FROM '404f0aac6444d1f425ae19bc16d22ecb' THEN
    RAISE EXCEPTION '退回前置閘①:現行不是 20260916210000 那一代(實得 %)⇒ 停下對齊, 不要盲退', v_md5;
  END IF;
END
$pre$;

-- ── 本體:換回 20260903093000 那一代(逐字)────────────────────────────────
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
  IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這期只開放刷卡的單, 其他付款方式的取消還沒開通';
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

-- ── COMMENT:把 20260916210000 附加的那一段切掉(第五種, 素材檔沒列)──────────
DO $c$
DECLARE v_old text; v_pos int; v_new text;
BEGIN
  v_old := pg_catalog.obj_description('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION '退回 COMMENT:讀不到既有 COMMENT ⇒ 停下';
  END IF;
  v_pos := pg_catalog.strpos(v_old, ' 🔴 2026-09-16(⟦b4-MARKCANCELNONCARD⟧');
  IF v_pos = 0 THEN
    RAISE EXCEPTION '退回 COMMENT:找不到 20260916210000 附加的那一段 ⇒ 它可能已經被切過或被改寫 ⇒ 停下人判';
  END IF;
  -- 🔴 `substring(x from a for b)` 與 `position(x in y)` 同一族:**特殊語法, 不能加 schema 前綴**。
  --    用 `substr(x, a, b)` 那個一般函式形式才加得了。(2026-09-16 實跑各撞一次。)
  v_new := pg_catalog.substr(v_old, 1, v_pos - 1);
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.admin_mark_order_cancelled(uuid,uuid,text,text,text) IS %L', v_new);
END
$c$;

-- ── 授權再收一次(第四種:貼回本體【不會】把權限帶回去)──────────────────────
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) TO service_role;

DO $post$
DECLARE
  v_oid  oid := pg_catalog.to_regprocedure('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)');
  v_md5  text;
  v_def  text;
  v_cmt  text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '退回後置閘①:函式不見了';
  END IF;

  -- ① 本體真的回到那一代(md5 釘死 —— 比「某個字串在不在」硬得多)
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_md5 IS DISTINCT FROM 'a76039fbe9be95715c069a5b3c4dc630' THEN
    RAISE EXCEPTION '退回後置閘①:本體不是 20260903093000 那一代(實得 %)⇒ 沒退乾淨', v_md5;
  END IF;

  -- ② 舊那道閘回來了、新那道走了。🔴 錨帶「換行 + 兩格縮排」——
  --    裸字串會命中函式註解裡那份刪除線副本(2026-09-16 R1/R2 各抓過一次同一個病)。
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_def, E'\n  IF v_order.payment_method IS DISTINCT FROM ''tappay'' THEN') = 0 THEN
    RAISE EXCEPTION '退回後置閘②:舊那道 payment_method 閘沒回來';
  END IF;
  IF pg_catalog.strpos(v_def, E'\n  IF v_order.payment_method IS NOT NULL AND v_order.payment_method <> ''tappay'' THEN') > 0 THEN
    RAISE EXCEPTION '退回後置閘②:放寬後那道還在碼裡 ⇒ 沒退乾淨';
  END IF;

  -- ③ SET 子句沒被 CREATE OR REPLACE 洗掉(逐元素比,不是「有設就算」)
  IF NOT (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) @> ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '退回後置閘③:search_path 不是空字串 ⇒ SECURITY DEFINER 的提權面被打開了';
  END IF;
  IF NOT (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) @> ARRAY['lock_timeout=5s'] THEN
    RAISE EXCEPTION '退回後置閘③:lock_timeout 不是 5s';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION '退回後置閘③:不再是 SECURITY DEFINER';
  END IF;

  -- ④ ACL
  IF pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '退回後置閘④:PUBLIC / anon / authenticated 其中之一拿得到 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '退回後置閘④:service_role 拿不到 EXECUTE ⇒ 後台會整個叫不動這支';
  END IF;

  -- ⑤ COMMENT 那一段真的切掉了(第五種)
  v_cmt := pg_catalog.obj_description(v_oid, 'pg_proc');
  IF pg_catalog.strpos(coalesce(v_cmt, ''), '20260916210000') > 0 THEN
    RAISE EXCEPTION '退回後置閘⑤:COMMENT 裡 20260916210000 那一段還在 ⇒ 本體退了而說明沒退';
  END IF;

  RAISE NOTICE '退回完成(五格):①本體 md5 = 20260903093000 那一代 ②舊閘回來/新閘走了 ③SECURITY DEFINER + proconfig 逐元素相符 ④ACL 只有 service_role ⑤COMMENT 那一段已切掉。🛑 **它們證不到的**:放寬期間【已經被結掉的單不會復原】、【已經寄出的信收不回來】。退之前要先查那幾張單。';
END
$post$;

COMMIT;
