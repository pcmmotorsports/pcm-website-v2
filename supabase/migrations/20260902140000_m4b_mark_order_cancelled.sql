-- M-4b · 取消線片②:`orders.cancel_items_untouched` 欄 + `admin_mark_order_cancelled` 函式
--
-- ✅ Sean 2026-09-02 拍板(經主視窗端;原話「依照建議」)——
--    🔴 **引用要帶【檔名 + 該檔的題號】**:正本 `~/pcm-mailbox/拍板-20260902-上午.md`,
--      本片記在該檔的 **Q17**。~~原本寫「Q1/Q2」~~ **作廢** —— 那是我端題當下的臨時編號,
--      而該檔的 `Q1` 是**另一題且未拍板**(付款信印料號)⇒ 照舊字面去查的人會落在錯的一列。
--      📌 **題號是【某一份文件裡的座標】, 不是全域的名字。**
--    · 批動工(新增一個 DB 欄 + 一支函式)⇒ **甲**
--    · 欄名 ⇒ **乙 `cancel_items_untouched`**;⛔ 舊名 ~~`items_untouched`~~ 作廢。
--      ⚠️ **而欄名這一題在正本裡零落點**(只在 `~/pcm-mailbox/plan-片2-…` 本窗自己寫的那份)
--      ⇒ **落檔位置待補**, 不要把「我記得他答了」當成有來源。
--    🎯 改名的理由:乙的意思是「**這一次**取消沒動數量」,而甲會被讀成「這張單從來沒動過」——
--       **而那是假的**(見下面「為什麼斷言比【前後相等】不比【等於 0】」)。
--    四批形狀拍板:只鬆開一個口 / 只開刷卡且已全額退款 / 分兩步(今天=標記+信,一個數量都不碰)/
--    只標記 + 留可辨識的訊號。
--
-- 前置:片① `20260902120000`(event_type 加 `order_cancelled`)—— 兩片互不依賴,可各自 apply。
-- 後續:片③ 模板 · 片④ enqueue + 後台入口。**本片不寄任何信、不碰 outbox。**
--
-- ── 🔴 為什麼需要 `cancel_items_untouched` —— 而理由是量到的,不是設計偏好 ────────────
--    後台顯示對 `cancelled_at` 非空 **直接早退**、兩個軸都回 null
--    (`apps/admin/src/lib/orders/order-status-axes.ts`,錨 `orderStatusView`)
--    ⇒ **畫面上完全看不出底下的數字沒動** ⇒ **那個乾淨的外觀就是它的危險之處。**
--    ⚠️ **而成因我指窄了**(R3 抓):同一支檔還有一個 `paymentStatus === 'refunded'` 分支
--      **也回兩軸 null**,而本片射程要求該單已經是 `refunded`
--      ⇒ **那個乾淨的外觀在「標記」之前就已經是那樣了** —— 不是本片造成的,本片只是沒有改善它。
--    而 SQL 側 **不早退**:`admin_order_list_v.goods_axis` 對已取消單照樣算得出四值之一,
--    且它的分母是 `quantity - cancelled_quantity`
--    (錨:`20260814140000` 檔內「本欄卻仍算得出四值之一」;
--     `20260816050000` 檔內 `GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0)`)
--    ⇒ **只標記的單在那裡會算出【還需要出貨】。**
--    ✅ **這是已知且接受的**(Sean 拍甲時代價已明講)⇒ 片② 的驗收要**釘住這個已知的錯**,不是修它。
--    ⚠️ 後台列表今天看不到那個矛盾,是因為兩處篩選各自帶了 `.is('cancelled_at', null)`
--      (`SupabaseOrderAdapter`,錨 `goodsAxes` 與 `pendingOnly`)——
--      🔴 **那個保護是【逐呼叫點】的,不是集中的 ⇒ 第三個呼叫點要自己帶。**
--
-- ── 🔴 為什麼斷言比【前後相等】,不比【等於 0】(本片最重要的一格)──────────────
--    plan 第一版寫的是「該單 `cancelled_quantity` 合計 = 0」。**開檔量了 ⇒ 那個 0 會擋掉一個合法的單:**
--    `20260805100000_m4b_e10_a8a2_partial_cancel.sql:455-467` —— 部分取消 **只有在關單時**
--    (`v_closed`)才寫 `cancelled_at`。
--    ⇒ 一張**被部分取消過而沒關單**的單:`cancelled_at IS NULL` ✅ 而 `order_cancellation_items` 不是 0。
--    ⇒ 它如果後來被全額退款 ⇒ 本片三道閘全過 ⇒ **而「= 0」會把它擋掉。**
--    📌 **而更重要的不是漏擋一張單** —— 是「= 0」會讓
--      **「我沒有動」這個宣稱,悄悄變成「這張單從來沒有人動過」**。
--    🎯 **⇒ 斷言要證的是【我的非動作】,不是【世界的狀態】。**
--
-- ── 🔴🔴 與 `admin_cancel_order` 的硬不變式 —— **這一節給下一個人,不要跳過** ─────────
--    `20260830020000` 檔內(錨:`IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (`)
--    把這件事當**硬不變式**在驗:**「`cancelled_at` 非空」⟺「每個品項都被取消完」**。
--    🔴 **而本片寫 `cancelled_at` 而一個數量都不動 ⇒ 那個等價從此【全域為假】。**
--
--    ✅ **給下一個人的動作(這是指示,不是一句事實)**:
--       **不要再拿 `orders.cancelled_at` 推論品項狀態。**
--       從本版起有一類單它不成立 —— 要判品項,去讀 `public.order_item_quantity_summary`
--       (或直接 `order_cancellation_items` 對 `order_items.quantity` 加總),不要看抬頭。
--       🔵 而要把「只標記」那一類單撈出來:`WHERE cancelled_at IS NOT NULL AND cancel_items_untouched`。
--
--    🛑 **本片做的是【讓它到不了會炸的那條路】,不是【讓它重新為真】**(步5 第四道閘):
--       拒掉「先前被部分取消過」的單 ⇒ 那類單不會有舊的 `order.cancel` 稽核列可以重放
--       ⇒ 對方步4 的等價斷言撞不到;而對方步5 的「已取消 ⇒ 拒」對乾淨單而言**本來就是對的行為**。
--    ⚠️ **判這一格的是【主視窗】,不是 Sean 拍板**(2026-09-02)——
--       ⇒ **任何人拿出更好的理由都可以推翻它**;而 Sean 的拍板要回去問他。兩者可推翻性不同,別寫混。
--
-- ── 🔴 加欄對 `admin_order_list_v` 的兩格(R3 抓;本片【不修】,只寫明)────────────
--    那支 view 是用 `o.*` 建的(`20260823030000` 檔內,而它旁邊逐字寫著「不要改成逐欄列舉」)。
--    PG 對 view 的 `*` **在建立當下就展開凍結** ⇒
--    (a) 加欄之後那支 view **沒有** `cancel_items_untouched`,而後台列表正是從它讀 `goods_axis`
--        ⇒ 🔴 **本檔 COMMENT 那句「任何讀 `goods_axis` 的消費端必須先看這個欄」,在那條路上做不到。**
--    (b) 日後任何一次重建那支 view(`CREATE OR REPLACE VIEW` + 它的名字)⇒ `o.*` 展開多一欄、
--        落在 `goods_axis` 原本的位置 ⇒ `cannot change name of view column "goods_axis"`。
--    ⚠️ **上面那句話刻意【不把 `CREATE OR REPLACE VIEW` 與那支 view 的名字寫在同一串】** ——
--      `scripts/sql-ts-literal-binding.test.ts` 的 `pickLive()` 掃 migration 找「誰重定義了這支 view」,
--      而它**讀的是原始檔、沒有去 SQL 註解**(該檔的 `stripSqlComments` 只給 P1 的字面抽取用,
--      而它自己的註解逐字寫著「只給 P1 用,別擴用」)
--      ⇒ 🔴 **我第一版把那兩者寫在一起 ⇒ 我的【註解】被算成第 4 個候選 ⇒ 那支測試整組紅**
--      (2026-09-02 兩世界實測:移走本檔 ⇒ 那 4 支測試 48 passed / 0 failed;放回去 ⇒ 5 failed)。
--      📌 **⇒ 一個「誰重定義了 X」的掃描器, 分不出【重定義它】與【提到它】。**
--      🛑 **⇒ 這是那支守門的弱點, 不是本檔的** —— 已回報主視窗;而在它修好之前,
--        **任何 migration 的註解都不要把那兩個字面連著寫。**
--    🔴 **而 `scripts/migration-static-checks.sh` 規則⑤ 逐字就叫「底表加欄後重跑可能炸」——
--       它掃的是【建 view 那支檔】,不是【加欄這支檔】⇒ 對本片結構上零訊號**(實跑 ⇒ ⑤「零命中」)。
--       📌 **那個零命中是誠實的:尺沒壞,是它的分母裡結構上沒有這一片。**
--    ⇒ 處置:**片④ 之前要先 bump 那支 view**。
--    🛑 **而落板狀態要寫成事實, 不要寫成完成式**(code-reviewer 抓;我實查複核了):
--      `grep -c 'cancel_items_untouched\|mark_order_cancelled' docs/launch-todo.md docs/phase-1-backlog.md`
--      ⇒ **兩支都 0**(🔵 正對照:同檔 grep `M-4b` ⇒ 有命中 ⇒ 尺會動)
--      ⇒ ~~「已請主視窗掛進 backlog」~~ **作廢** ⇒ 正確說法是
--        **「已交主視窗、尚未落板」** —— 我發得出訊息, 而落板不是我這個窗做得到的事。
--      📌 **「我交出去了」與「它到了」是兩個宣稱, 而我只看得到前者。**
--
-- ── 🔴 rollback:問「為什麼要改」,不是「改成哪一態」──────────────────────
--    ① `DROP FUNCTION admin_mark_order_cancelled` ⇒ 乾淨,零副作用、零資料變化。
--    ②🔴🔴 `DROP COLUMN cancel_items_untouched` ⇒ **這一刀會刪掉這個欄唯一存在的理由。**
--       撤欄之後那些單的 `cancelled_at` 還在 ⇒ **看起來就是一張正常的已取消單**,
--       而「數量沒被處理」這件事 **沒有任何地方查得到**。
--       📌 **DOWN 不是把系統退回原狀,是退回一個【資訊比原狀更少】的狀態。**
--       ✅ 處置:**先把那批單的 id 匯出**(`SELECT id FROM public.orders WHERE cancel_items_untouched`)
--          再撤欄;而**撤欄本身要 Sean 拍板,不是 DOWN 腳本自己決定**。
--    ③ 已寫下的 `cancelled_at` / `cancelled_reason` ⇒ **不撤**。那是真的業務事實
--       (那些單真的被取消了、錢真的退了)。**沒有理由要改它 ⇒ 就不要改。**
--    🟢 本片**沒有信** ⇒ 沒有「DOWN 會把信寄出去」那一格;而**片④ 的 DOWN 一定要問這一句**。
--    ⚠️ 這個問法借自 `-7d` 今天在**別片**量到的形狀(它的 DOWN 會把信真的寄出去)——
--      **那一發不是我量的,我沒開過那片。我借的是問法,不是它的結論。**
--
-- ── 🔵 本片【不做】什麼(寫出來,免得被讀成「取消功能做好了」)────────────────
--    ✗ 不動任何品項數量、不寫 `order_cancellations` / `order_cancellation_items`
--    ✗ 不碰庫存、不碰退款、不碰 `email_outbox`(信是片④)
--    ✗ **不涵蓋部分退款**、不涵蓋匯款/貨到付款、不涵蓋部分品項取消
--    ✗ 不動任何 TS —— 🔴 所以那張紙條(adapter 逐字「日後真的加第三個事件型別時,要先跑一發真的
--      PostgREST 驗那個 `in` 文法」)**不屬於本片**:`EmailOutboxEventType` 的 union 由**片③** 碰到
--      (模板分派的 `switch` 有 `satisfies never` 窮舉 ⇒ 不加 union 就 typecheck 紅)。
--
-- ── 量測(字面值三來源律)──────────────────────────────────────────
--    · 七值 → 對客文字映射:逐字抄自 `20260830020000`(錨:`WHEN 'customer_request' THEN '依您要求取消'`)
--      🔴 ~~「同一張表, 不另立一份」~~ **這句話不精確**(code-reviewer 抓):
--      **字面是同一份, 而實體現在有兩個** —— 本檔一份、那支一份。
--      ⇒ 而 harness 裡的 `admin_cancel_order` 是空殼 ⇒ **兩份漂移零訊號, 而那是對客文字。**
--      ⇒ 記為合約債:片③ 之後應收斂成單一來源(共用函式或一張表), 由誰做未定。
--      📌 **「抄自」與「同一份」是兩件事, 而前者會漂。**
--    · `payment_method = 'tappay'`:`20260901030000` 檔內逐字「英文代碼, 對齊既有的 `'tappay'`」
--      ⚠️ **而那一行講的是 `zero_total`** ⇒ 它只證得出「`tappay` 是既有代碼」,
--      **證不出「`tappay` 就等於刷卡」**(R3 抓,我開檔核了他是對的)。後者今天**未確認**。
--    · audit 欄位形狀:`20260830020000:543`
--    · 期望字面(`pg_get_functiondef` 相關)本片**不釘** —— 本片是 CREATE 不是 REPLACE,沒有舊值可比。

BEGIN;

-- 鎖與逾時:`ADD COLUMN` 本來就取 ACCESS EXCLUSIVE。完整理由(為什麼單一交易裡 NOT VALID 兩步
-- 拿不到好處、為什麼 lock_timeout 只封「等鎖」)在 `20260830060000:82-101`(錨:「`ALTER TABLE ...
-- ADD CONSTRAINT` 取 **ACCESS EXCLUSIVE** 且全表掃描」)。
-- 🔵 本片加的是「有非 volatile 預設值的欄」⇒ PG 11+ **不重寫全表**。
-- ⚠️ **而我沒有在正式庫量過 `orders` 有幾列** ⇒ 不得寫成「表很小所以沒關係」。
--    替**單句**封頂的是 `statement_timeout`;`lock_timeout` 只封**等鎖**那一段;
--    **兩者都不是整筆交易的總上限。**
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;

-- ── 0. 前置閘(forward-only;已在鎖底下)────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.orders'::regclass
                AND attname = 'cancel_items_untouched' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘①:orders.cancel_items_untouched 已存在 ⇒ forward-only,拒重跑';
  END IF;
  -- 🔴 舊名也要擋:如果哪天有人先建了 `items_untouched`(plan 第一版的名字),
  --    本片會建出**第二個語意重疊的欄**,而兩個欄不會互相矛盾、也不會有人發現。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.orders'::regclass
                AND attname = 'items_untouched' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘②:orders 上有舊名 items_untouched(plan 第一版的名字, Sean 已拍乙作廢)⇒ 停下人工確認,不要建出兩個語意重疊的欄';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'admin_mark_order_cancelled') THEN
    RAISE EXCEPTION '前置閘③:admin_mark_order_cancelled 已存在 ⇒ forward-only,拒重跑';
  END IF;
  -- 🔴 本函式抄 admin_cancel_order 的七值映射表。那支不在 ⇒ 部署態與預期不符。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'admin_cancel_order') THEN
    RAISE EXCEPTION '前置閘④:找不到 admin_cancel_order ⇒ 本片抄它的七值映射表,部署態與預期不符';
  END IF;
END
$$;

-- ── 1. 新欄 ───────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN cancel_items_untouched boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.cancel_items_untouched IS
  'true = 這一次的取消是【只標記】—— 抬頭寫了 cancelled_at, 而【這一次】沒有動任何品項數量。
🔴 **它說的是「本次取消沒動數量」, 不是「這張單從來沒有人動過數量」** ——
   一張先前被部分取消過(而沒關單)的單, 它的 order_cancellation_items 本來就不是 0。
   ⇒ 這正是欄名從 items_untouched 改成 cancel_items_untouched 的理由(Sean 2026-09-02 拍乙)。
🔴 **為什麼需要這個欄**(沒有這一段, 下一個人會覺得它多餘):
   後台顯示對 cancelled_at 非空【直接早退】、兩個軸都回 null
   (apps/admin/src/lib/orders/order-status-axes.ts, 錨字串 `orderStatusView`)
   ⇒ 畫面上完全看不出底下的數字沒動 ⇒ **那個乾淨的外觀就是它的危險之處。**
🔴 **而 SQL 側【不早退】**:admin_order_list_v.goods_axis 對已取消單照樣算得出四值之一,
   且它的分母是 quantity - cancelled_quantity
   ⇒ **只標記的單在那裡會算出【還需要出貨】。這是已知且接受的**(Sean 2026-09-02 拍甲, 代價已明講)。
⚠️ 後台列表今天看不到那個矛盾, 是因為兩處篩選各自帶了 .is(cancelled_at, null)
   (packages/adapters/src/supabase/SupabaseOrderAdapter.ts, 錨字串 goodsAxes 與 pendingOnly)——
   🔴 **那個保護是【逐呼叫點】的, 不是集中的 ⇒ 第三個呼叫點要自己帶。**
⇒ 任何直接讀品項數量或 goods_axis 的消費端(含未來的庫存系統), **必須先看這個欄**。
🛑 **而【後台列表那條路上做不到】** —— 它讀的是 admin_order_list_v, 而那支 view 是用 o.* 建的、
   PG 在建立當下就把 * 展開凍結 ⇒ **加欄之後那支 view 沒有這個欄**。
   ⇒ 在有人重建那支 view 之前, 從它讀 goods_axis 的人**看不到這個欄**。
   📌 這句但書刻意寫在 COMMENT 本體裡:migration 檔頭 apply 之後就沒有人會再打開,
      而 COMMENT 是 \d+ 讀得到的那一份。
🔵 **應該**只有 public.admin_mark_order_cancelled 寫 true;沒有任何 UI 讓人手填。
⚠️ **而那不是被強制的**(codex R1 抓;不要把期望寫成事實):今天沒有 constraint 也沒有 trigger
   在擋別的寫入路徑, table owner 或任何拿得到 service_role 的 SQL 都寫得進去。
   ⇒ 它是一個**約定**, 不是一道閘。要變成閘, 得另外加 trigger —— 而那還沒有人拍板。
射程:只涵蓋【刷卡(payment_method = tappay) 且 已全額退款(payment_status = refunded)】的整單取消。
**部分退款不涵蓋**、部分品項取消不涵蓋、匯款/貨到付款不涵蓋。
🛑 撤欄之前先讀本欄所屬 migration 檔頭的 rollback 那一節 ——
   撤欄會刪掉這個欄唯一存在的理由, 而那些單看起來會變成一張正常的已取消單。';

-- ── 2. 只標記函式 ─────────────────────────────────────────────────────
-- 🔴 **它沒有 p_items —— 而那個缺席本身就是契約。**
--    既有的 admin_cancel_order 有 `p_items jsonb`,而本支**沒有那個參數**
--    ⇒ 呼叫端**連「想傳數量」都做不到**,不是「我們決定不傳」。
CREATE FUNCTION public.admin_mark_order_cancelled(
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

COMMENT ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) IS
  '只標記取消(SECURITY DEFINER、search_path='''';service_role only)。Sean 2026-09-02 拍甲:
退款完成之後人工判斷要不要把這張單標成「已取消」⇒ 後台狀態變更 + 客人訂單狀態變更 + 取消信(信在片④)。
🔴 **它一個品項數量都不會動**, 而那件事由步7/步10 的【前後相等】斷言強制(不是等於 0 —— 見那一段註解)。
🔴 三道閘住在函式裡:cancelled_at IS NULL · payment_method = tappay · payment_status = refunded。
   **部分退款(partiallyRefunded)不涵蓋** —— 那是另一題, 沒有人拍過。
🔴 **沒有 p_items 參數, 而那個缺席本身就是契約** —— 呼叫端連「想傳數量」都做不到。
🔴 稽核 action = order.mark_cancelled, **刻意不是 order.cancel**:既有冪等格是用後者去撈的,
   共用會讓兩支互相認成對方的重放。
⚠️ 它寫下的單, 在 admin_order_list_v.goods_axis 上會算出【還需要出貨】(cancelled_quantity 沒動)——
   **已知且接受**;要找出這批單看 orders.cancel_items_untouched。';

-- ── 3. 收權(照 A8a3 那三行再做一次;新物件出生自帶 PUBLIC EXECUTE)────────────
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) TO service_role;

-- 收權斷言(repo 慣例形狀;`scripts/migration-static-checks.sh` 第③道會數這張清單)
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_mark_order_cancelled(uuid,uuid,text,text,text)'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 service_role 沒有 EXECUTE(收太多)⇒ 呼叫端會被 42501 擋掉', r;
    END IF;
  END LOOP;
  -- 🔴 **這道斷言【不夠】, 所以下面第 4 節還有一道全稱 ACL 閘** ——
  --    `has_function_privilege` 是**逐個角色去問**, 它答不出「有沒有第三個角色被授權」,
  --    也答不出 `WITH GRANT OPTION`。⇒ 兩道各擋一半, 不要以為有這一道就夠了。
  RAISE NOTICE '✅ 收權斷言過:% 支函式 —— anon/authenticated 零 EXECUTE、service_role 有。⚠️ 它【不答】有沒有第三個角色被授權、也不答 WITH GRANT OPTION —— 那一格在事後閘④。',
    cardinality(v_functions);
END
$grant_assert$;

-- ── 4. 事後閘 ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_atttypid  text;
  v_notnull   boolean;
  v_default   text;
  v_com       text;
  v_secdef    boolean;
  v_cfg       text[];
  v_acl       text;
  v_oid       oid;
  v_owner     text;
BEGIN
  -- ① 欄:型別 / NOT NULL / 預設值
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_atttypid, v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname = 'cancel_items_untouched' AND NOT a.attisdropped;
  IF v_atttypid IS NULL THEN
    RAISE EXCEPTION '事後閘①:找不到 orders.cancel_items_untouched';
  END IF;
  IF v_atttypid <> 'boolean' OR NOT v_notnull OR v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '事後閘①:欄的形狀不對(型別 % / notnull % / 預設 %),預期 boolean / true / false',
      v_atttypid, v_notnull, v_default;
  END IF;

  -- ② COMMENT:三句缺一不可(它們各自擋一種「以後被讀錯」的方式)
  v_com := pg_catalog.col_description('public.orders'::regclass,
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.orders'::regclass AND attname = 'cancel_items_untouched'));
  IF v_com IS NULL
     OR pg_catalog.strpos(v_com, '本次取消沒動數量') = 0
     OR pg_catalog.strpos(v_com, '還需要出貨') = 0
     OR pg_catalog.strpos(v_com, '逐呼叫點') = 0 THEN
    RAISE EXCEPTION '事後閘②:COMMENT 少了三句其中之一(本次取消沒動數量 / 還需要出貨 / 逐呼叫點)⇒ 契約與碼分岔了';
  END IF;

  -- ③ 函式:存在 · SECURITY DEFINER · search_path=''
  SELECT p.oid, p.prosecdef, p.proconfig INTO v_oid, v_secdef, v_cfg
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_mark_order_cancelled';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '事後閘③:找不到 admin_mark_order_cancelled';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION '事後閘③:admin_mark_order_cancelled 不是 SECURITY DEFINER';
  END IF;
  -- 🔴 `proconfig` 存的是 **`search_path=""`**(帶兩個雙引號), 不是 `search_path=`。
  --    (2026-09-02 拋棄式 PG 17.10 實測:本閘第一版寫 `'search_path=' = ANY(v_cfg)` ⇒ **它紅了**,
  --     而印出來的實際值是 `{"search_path=\"\"",lock_timeout=5s}`。)
  --    📌 **而那個紅是【對的】—— 錯的是我的期望字面。一把新尺的第一個讀數不是結論, 是它的自檢。**
  --    ⇒ 兩種形狀都收(不同 PG 版本的引號處理未逐版驗過, 這裡刻意寬一格、寧可漏報也不假紅)。
  IF v_cfg IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_cfg) e
                     WHERE e IN ('search_path=', 'search_path=""')) THEN
    RAISE EXCEPTION '事後閘③:admin_mark_order_cancelled 沒有 SET search_path = ''''(實際 %)', v_cfg;
  END IF;

  -- ④ ACL 全稱斷言(照 20260830020000 那道:除 owner 與 service_role 不准有任何 grantee)
  --    🔴 proacl IS NULL = 從未被 GRANT/REVOKE 過 = **預設 PUBLIC 可執行** ⇒ 必炸。
  SELECT p.proacl::text INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '事後閘④:admin_mark_order_cancelled 的 proacl 是 NULL = 從未收權 = PUBLIC 可執行';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_oid)) a
     WHERE a.grantee <> 0                                        -- 0 = PUBLIC(見下)
       AND pg_catalog.pg_get_userbyid(a.grantee) NOT IN ('service_role',
             (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid = v_oid))
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_oid)) a
     WHERE a.grantee = 0 OR a.is_grantable                       -- PUBLIC 或 WITH GRANT OPTION
  ) THEN
    RAISE EXCEPTION '事後閘④:ACL 有不該有的授權(PUBLIC / WITH GRANT OPTION / 第三個角色)⇒ %', v_acl;
  END IF;

  -- 🔴 R2 must-fix ③(誠實處理, 不是「驗了」):
  --    這支是 SECURITY DEFINER ⇒ **它以【owner】的身分跑**。而 owner 是誰,由「誰 apply 這支 migration」
  --    決定, 不由本檔決定 ⇒ 本檔**斷言不了它應該是誰**。
  --    ⇒ 能做的是【把它印出來】, 讓 apply 當下的人看得到, 而不是假裝驗過。
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  RAISE NOTICE '📌 admin_mark_order_cancelled 的 owner = %(SECURITY DEFINER 以這個身分跑)。⚠️ 本檔【不斷言】它應該是誰 —— 那由「誰 apply」決定。如果它不是預期的那個角色, 現在停下來。', v_owner;
  RAISE NOTICE '事後閘通過(四格):①欄形狀 boolean/NOT NULL/預設 false ②COMMENT 三句都在 ③函式存在且 SECURITY DEFINER + search_path='''' ④ACL 只有 owner + service_role、零 PUBLIC、零 WITH GRANT OPTION。🛑 **它們證不到的**:(a)**不驗行為** —— 三道業務閘擋不擋得住、前後相等斷言會不會炸,那一層在 scripts/mark-order-cancelled-verify.sh(拋棄式 PG);(b)②是**字串有沒有出現**不是語意 —— 一句「本次取消沒動數量【這句話是錯的】」照樣過;(c)④只看 pg_proc.proacl —— 欄級/schema 級授權與 RLS 不在它的分母裡。';
END
$$;

-- ── 5. 行為那一層【刻意不在本檔做】────────────────────────────────────
-- 🔴 上面四道閘驗的是【定義】。**一個函式建起來了, 與它擋不擋得住東西, 是兩個宣稱。**
--
-- 🛑🛑 **【已知未驗】—— 兩格, 明寫出來不吞掉**(codex R2 must-fix ③ 提出;本窗判它超出本片射程):
--    ① **RLS**:本片不建表、不動任何 policy。而 `orders` / `order_items` /
--       `order_cancellation_items` / `admin_audit_log` 上的 RLS 對這支 SECURITY DEFINER 函式
--       生不生效,**本檔沒有驗**。harness 的拋棄式庫**全部由 postgres 建、零 policy**
--       ⇒ **42501 與「讀不到列」那一族在那裡結構上不可能出現**。
--    ② **表的 owner 與有效權限**:同理,拋棄式庫裡 owner 全是 postgres ⇒ 量不到真實部署的形狀。
--    ⇒ 📌 **所以這一片可以全綠, 而正式庫上【第一次呼叫】才炸。**
--    ⇒ ⇒ **這一格要在 apply 之前由人看一眼**(或另開一片專門驗它)—— 已端 `-0a` 判,
--      **不要因為它寫在這裡就當成已經處理了。**
-- 🛑 **不要在這裡加「對真表寫一列再回捲」的探針** —— Sean 2026-08-30 拍板【甲】把同族的那一道
--    拿掉了,完整理由在 `20260830060000` 檔內(錨:「它存在的理由與它的危險是同一個前提」)。
-- ✅ 行為驗證落點:`scripts/mark-order-cancelled-verify.sh`(拋棄式 PG,本片同時新增)。
COMMIT;
