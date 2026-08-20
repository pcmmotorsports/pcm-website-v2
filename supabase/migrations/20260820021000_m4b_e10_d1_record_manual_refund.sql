-- ============================================================
-- M-4b E10 · D1:非卡退款【登記】RPC + 冪等鍵欄 + 唯一索引
-- ============================================================
-- 真權威 plan:~/pcm-mailbox/W1-081-片D退款登記-plan-20260820.md(§7 = W5 盲審折入 + 主視窗裁定)
-- 體積來源:~/pcm-mailbox/W4-008-片D退款登記缺口體積-20260820.md
-- 鏡像先例(皆已 apply、形狀照抄不自創):
--   admin_record_manual_payment   20260810200000_…_op5    548 行
--   admin_reverse_manual_payment  20260810210000_…_opa12  480 行
-- 鐵則 12①②③(錢 + 權限 + schema)。
--
-- ⛔ **本檔尚未 apply,而且不由施工窗 apply** —— apply 要 Sean 在場。
--
-- ── 🔴🔴 為什麼兩道 REVOKE 必須在【本片】,而不是留給 D2 ─────────────────────
--   分期開權的設計是:D1 建函式但**不開權**,EXECUTE 由 D2 與沖銷 RPC 一起開
--   ⇒ 在那之前登記路徑呼不到 ⇒ 不可能出現「能登記、不能更正」的窗口。
--   **而那個設計有一個預設會直接打穿它**:
-- ```
--   實測(拋棄式 PG **17.10**,2026-08-20;數字會被複製走、前後文不會,所以環境寫在數字旁邊):
--     建一支【完全不 REVOKE】的新 SECDEF 函式,量 has_function_privilege:
--       service_role = true / anon = true / authenticated = true / proacl = <NULL>
--     跑完兩道 REVOKE 之後:
--       service_role = false / anon = false
-- ```
--   ⇒ ① 片 A 的前置閘(「service_role 呼得到登記 RPC 嗎」)**在 D1 落地那一刻就已經是 true**
--        ⇒ 那道封印**封不住**,D1-only + 片 A 會通過。
--   ⇒ ② 🔴 更嚴重:D1→D2 之間,這支**動錢的 SECDEF RPC 對 anon / authenticated 開著**
--        ⇒ **鐵則 12②,一個會真的存在的權限缺口**,與分期開權的用意完全相反。
--   ⇒ ⇒ 所以本片自己 REVOKE,並在 §7 **斷言** `has_function_privilege('service_role', …) = false`。
--      **那個缺口被關掉要有一發斷言,不是一句註解。**(主視窗 2026-08-20 裁定逐字)
--
-- ── 🔴 為什麼「表是空的」寫成斷言,不是寫成前提 ────────────────────────────
--   `ADD COLUMN … NOT NULL`(無 DEFAULT)只在表為空時安全。
--   而「列數 0」是 **2026-08-20 apply `20260820010000` 當下**量到的事實,
--   本片可能**幾天後**才 apply ⇒ **兩個時點,而那句話沒帶座標。**
--   ⇒ §0 有一道 `IF EXISTS (SELECT 1 …) THEN RAISE`。**不要把它拿掉改成「我確認過是空的」。**
--
-- ── ⚠️ 一件會誤導下一個讀者的,寫在這裡因為那邊已經寫不了 ──────────────────
--   `order_manual_refunds` 的 TABLE COMMENT **列舉了它「刻意沒有」的欄**
--   (status / bank_refund_id / rec_trade_id,各附理由)。那份 COMMENT 已隨該片 apply **凍結**
--   ⇒ 它**不會提到本片新增的 `request_id`**。
--   ⇒ 讀那張表的人會看到一份「刻意沒有」的清單,而**清單本身已經過期**。
--   ⇒ 本片的處置:給 `request_id` 一則 COLUMN COMMENT,寫明它是誰加的、為什麼。
--   📌 `request_id` **不在**那份「刻意沒有」的清單裡 —— 那份清單講的是 **provider 的**冪等鍵
--      (「沒有 provider,就沒有 provider 的冪等鍵」),而 `request_id` 是**呼叫端產生**的,
--      與 op5 用的是同一種。**兩者不是同一件事。**
--
-- ── 這一片做的三件(同片,缺一則守門會反咬)────────────────────────────────
--   ① ADD COLUMN request_id uuid NOT NULL(表為空才安全 ⇒ §0 斷言)
--   ② CREATE UNIQUE INDEX (order_id, request_id) ⇒ **真冪等**
--      ⚠️ 射程:它擋的是「**同一次互動被重送**」,**不擋**「同一筆錢被人用不同 request_id 登兩次」
--         —— 後者靠對帳,與 op5 的限定相同。**不要把它讀成防重複入帳。**
--   ③ CREATE FUNCTION admin_record_manual_refund(7 入參)+ 兩道 REVOKE + 零 GRANT
--
-- ── 🔴 RPC 是唯一的守門點 ────────────────────────────────────────────────
--   `20260820010000:62-63` 逐字:「零寫入 GRANT 之下唯一寫得進來的是 owner,
--   而 owner 本來就繞得過 trigger ⇒ 那道 trigger 在這一片是裝飾」⇒ **該表零 trigger。**
--   而表的 COMMENT 逐字「只有 > 0、**沒有上界**(A7c 拍板⑤:DB 不做防超退)」。
--   ⇒ ⇒ **額度守門、rail 值域、actor 檢查 —— 全部只存在於本 RPC 裡,DB 沒有第二道。**
--     所以 §6 的負測**不是補完整性,它們是那些守門唯一的證據**。
--
-- Rollback:DROP FUNCTION admin_record_manual_refund(…) / DROP INDEX 那道 UNIQUE /
--   ALTER TABLE … DROP COLUMN request_id。⚠️ 最後一項會**丟資料** ⇒ 只有在本片剛 apply、
--   尚未有人登記過任何一筆時才安全。**回退前先數列數。**
-- ============================================================

BEGIN;

-- ── 0. 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION 'D1 前置閘:public.order_manual_refunds 不存在 ⇒ 先 apply 20260820010000';
  END IF;
  IF to_regprocedure('public.pcm_order_refundable_remaining(uuid)') IS NULL THEN
    RAISE EXCEPTION 'D1 前置閘:pcm_order_refundable_remaining 不存在 ⇒ 額度守門無處可讀;先 apply 20260820010000';
  END IF;
  IF to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION 'D1 前置閘:public.staff 不存在 ⇒ actor 守門無處可查';
  END IF;

  -- 指紋①:本片已套過了嗎(先判 —— 與②互斥,合成一句會讓人查錯方向)
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.order_manual_refunds'::regclass
                AND attname = 'request_id' AND NOT attisdropped AND attnum > 0) THEN
    RAISE EXCEPTION 'D1 前置閘:request_id 欄已存在 ⇒ **本片已套過**(forward-only,拒重跑)。這不是「有人改壞了」';
  END IF;

  -- 🔴 指紋②:表**仍為空**。ADD COLUMN … NOT NULL(無 DEFAULT)只在表為空時安全,
  --    而「列數 0」是 2026-08-20 apply 上一片當下的事實 —— 本片可能幾天後才跑。
  -- 🔴 W5 盲審 n-1:先取鎖再數。原本是「數完 → ALTER 才取鎖」⇒ 中間有一個(極小、
  --    需 owner 權限的)窗口能塞進一列,而那一列會讓 ADD COLUMN … NOT NULL 炸在半路。成本一行。
  LOCK TABLE public.order_manual_refunds IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO n FROM public.order_manual_refunds;
  IF n <> 0 THEN
    RAISE EXCEPTION 'D1 前置閘:order_manual_refunds 已有 % 列 ⇒ 不能加無預設值的 NOT NULL 欄。'
                    '🔴 這不是 bug:上一片 apply 當下它是空的,而那是【那個時點】的事實。'
                    '解法是人去判斷那些列的 request_id 該填什麼(不能亂填 —— 它是冪等鍵),'
                    '而不是把這道斷言拿掉。', n;
  END IF;
END
$$;

-- ── 1. 加冪等鍵欄(表為空 ⇒ NOT NULL 安全)────────────────────────────────────
ALTER TABLE public.order_manual_refunds ADD COLUMN request_id uuid NOT NULL;

COMMENT ON COLUMN public.order_manual_refunds.request_id IS
  '呼叫端產生的冪等鍵(M-4b D1 於 2026-08-20 新增;**不在本表 TABLE COMMENT 那份「刻意沒有」的清單裡** —— '
  '那份清單講的是 provider 的冪等鍵,而本欄與 op5 的 request_id 同種,由呼叫端產生)。'
  '🔴 射程:配合 UNIQUE (order_id, request_id),它擋的是【同一次互動被重送】,'
  '**不擋**【同一筆錢被人用不同 request_id 登兩次】—— 後者靠對帳,與 op5 的限定相同。';

-- ── 2. 唯一索引 = 真冪等 ─────────────────────────────────────────────────────
CREATE UNIQUE INDEX order_manual_refunds_idem_uniq
  ON public.order_manual_refunds (order_id, request_id);

-- ── 3. 登記 RPC ──────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_record_manual_refund(
  p_order_id      uuid,
  p_request_id    uuid,
  p_actor         text,
  p_rail          text,
  p_refund_amount integer,
  p_reason        text,
  p_occurred_at   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order      record;
  v_existing   record;
  v_remaining  bigint;
  v_id         uuid;
  v_n          integer;
  -- 業務拒絕用單一通用訊息(不洩「這張單存不存在」);輸入類與政策類另給具體訊息。
  -- 🔴 **全檔只有步4 那一處 RAISE 用它**(W5 盲審 n-2 實查)——
  --   而下面的負測③ 正是靠這件事才分得出「紅在步4」與「紅在別處」。
  --   ⇒ 哪天有人讓第二道守門也用這個通用訊息,**負測③ 會失去判別力而不會有東西紅**。
  v_generic_msg constant text := 'admin_record_manual_refund: 退款登記失敗';
BEGIN
  -- 步1 隔離閘(同族慣例;RR 等鎖醒來會拿到舊快照)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(缺值各自具體訊息)
  IF p_order_id      IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 訂單識別碼缺失'; END IF;
  IF p_request_id    IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 冪等鍵 request_id 缺失'; END IF;
  IF p_rail          IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 退款管道缺失'; END IF;
  IF p_refund_amount IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 金額缺失'; END IF;
  IF p_occurred_at   IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 退款時點缺失'; END IF;

  -- 🔴 card 單獨給訊息:它不是「打錯字」,是走錯帳本(卡片退款走 order_refunds)
  IF p_rail = 'card' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: card 軌不得由人工登記(卡片退款走 order_refunds 與它自己的狀態機)';
  END IF;
  IF p_rail NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款管道 [%] 不是 bank_transfer 或 cash', p_rail;
  END IF;
  IF p_refund_amount <= 0 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 金額必須為正整數(實得 %)', p_refund_amount;
  END IF;
  -- 🔴 btrim 顯式給字集 —— 預設字集只有一般空格,`E'\n\t'` 會穿過去
  --    (該表的 CHECK 自己就是這樣寫的,本 RPC 對齊它,不留一個比 DB 寬的入口)
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款原因不得為空白';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 經手人不得為空白';
  END IF;

  -- 步3 actor 必須是啟用中的 staff(FK 只擋不存在;停用的擋不到)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    -- 🔴🔴 這則訊息**必須帶一句「不要換人重送」**(W5 盲審 R2 MF-1;失敗鏈我實測重現過):
    --   員工 A 登記後離職 ⇒ **逐位元相同的重送**撞在這裡 ⇒ 而訊息說的是「人的問題」
    --   ⇒ 操作者照訊息換成在職的 B 重送 ⇒ 過了本道、到步4.5 判「內容不同」
    --   ⇒ 而**那則訊息原本無條件地叫人「用新的 request_id」**
    --   ⇒ ⇒ **同一筆實際退款在帳本上變成兩列,可退餘額被重複扣 —— 錢錯了。**
    --   📌 兩則訊息各自都對,而**它們聯手把人導向登第二筆**。修在訊息、不在順序:
    --      actor 排在冪等格之前是 op5 的設計(擋守門序 oracle),移動它會重新打開那個洞。
    RAISE EXCEPTION 'admin_record_manual_refund: 經手人 [%] 不存在或已停用 ⇒ 拒絕登記退款。'
                    '🔴 現金退款的失敗模式是【人】,而 actor 是唯一的線索。'
                    '⚠️ **若這是一次重送:不要換人重送,也不要換 request_id** —— '
                    '那會讓同一筆退款在帳本上變成兩列。請先用原本的 request_id 查那筆是否已登記'
                    '(查得到就代表已經登記過了,不必再送)。', p_actor;
  END IF;

  -- 步4 鎖單(第一觸表動作;與同族一致的鎖序)
  SELECT id, created_at INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 occurred_at 兩道(W5 盲審 n-2:它原本是唯一沒被守的入參,而本 RPC 是唯一守門點
  --    ⇒ 遺漏是永久的)
  IF p_occurred_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款時點不得晚於現在(退款時點=%,現在=%)',
                    p_occurred_at, pg_catalog.now();
  END IF;
  IF p_occurred_at < v_order.created_at THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款時點早於訂單成立(退款時點=%,下限=%)',
                    p_occurred_at, v_order.created_at;
  END IF;

  -- 步4.5 🔴🔴 冪等格 —— **必須在額度守門【之前】**,而且要**逐欄比對**
  --   兩個缺陷都是實測出來的(拋棄式 PG 17.10,2026-08-20),不是推的:
  --   ① 原本只有 `EXCEPTION WHEN unique_violation` 而**零比對** ⇒
  --      同鍵送 (100) 再送 (50) ⇒ 第二發回 `{recorded:true, idempotent:true}`,
  --      **而帳本裡是 100** ⇒ 呼叫端相信 50 已登記。rail 換成 bank_transfer 也一樣穿過去。
  --      🔴 而 `pcm_order_refundable_remaining` 是減帳本算的 ⇒ 那個差額會靜靜留在「還可退」裡
  --        ⇒ **帳面上我們還欠客人,而系統認為已經登記過了。沒有東西會紅。**
  --   ② 冪等若排在額度守門【之後】,**完全相同的重試會被誤擋**:
  --      total 500、第一發退 500 ⇒ 剩餘 0 ⇒ 相同重試撞「超過可退餘額 0」
  --      ⇒ 實測訊息逐字如此 —— **一個誤導的訊息:它說錢不夠,而其實是同一次請求。**
  --   ⇒ 形狀照 op5(它的 COMMENT 逐字:「G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回
  --     idempotent(NULL-safe)」),而它的 unique_violation handler 自標「**backstop,不是主要路徑**」。
  SELECT r.id, r.rail, r.refund_amount, r.reason, r.actor, r.occurred_at
    INTO v_existing
    FROM public.order_manual_refunds r
   WHERE r.order_id = p_order_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.rail          IS NOT DISTINCT FROM p_rail
       AND v_existing.refund_amount IS NOT DISTINCT FROM p_refund_amount
       AND v_existing.reason     IS NOT DISTINCT FROM pg_catalog.btrim(p_reason, E' \t\r\n')
       AND v_existing.actor      IS NOT DISTINCT FROM pg_catalog.btrim(p_actor,  E' \t\r\n')
       AND v_existing.occurred_at IS NOT DISTINCT FROM p_occurred_at THEN
      RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', true, 'refund_id', v_existing.id);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**,而且要讓呼叫端分得出來這不是「錢不夠」也不是「重送」
    RAISE EXCEPTION 'admin_record_manual_refund: 同一個 request_id 帶了不同的內容 ⇒ 拒絕。'
                    '🔴 這不是重送,也不是額度問題:帳本裡那一筆與這次送來的至少有一欄不同'
                    '(rail / 金額 / 原因 / 經手人 / 退款時點)。'
                    '⚠️ **先確認這是不是同一筆錢**:'
                    '若你是在重送同一筆(例如原經手人已停用而你換了人)⇒ **不要用新的 request_id**,'
                    '那會讓同一筆退款在帳本上變成兩列、可退餘額被重複扣。'
                    '只有在你確定這是**另一筆實際退款**時,才用新的 request_id;'
                    '要更正既有那筆請走沖銷(D2)。';
  END IF;

  -- 步5 🔴🔴 額度守門 —— **IS NULL 必須單獨分流**
  --   pcm_order_refundable_remaining 是 LANGUAGE sql + `WHERE o.id = p_order_id`
  --   ⇒ 訂單不存在 ⇒ 無列 ⇒ **回 NULL**。
  --   實測(拋棄式 PG 17.10,2026-08-20):`IF 999999 > NULL THEN RAISE` ⇒ **守門沒有開火 ⇒ 放行**。
  --   而穿過去之後**沒有第二道**(該表零 trigger、CHECK 只有 > 0、無上界)⇒ 那一發會真的寫進去。
  --   ⇒ 兩種成因**分開訊息**:它們的下一步完全不同。
  --   🔴🔴 **而這一道今天【不可達】,我用突變測出來的,不是推的**:
  --     步4 的 `IF NOT FOUND THEN RAISE` 已經先把「查無此單」擋掉了(實測:拿掉本分流之後
  --     用不存在的 order_id 呼叫,紅在步4 的通用訊息、不是這裡)。
  --   ⇒ 所以本分流是**縱深,而它沒有可構造的負測** —— 依本 repo 的紀律
  --     (`feedback_unconstructible-negative-test-means-noop-guard`:沒有測試證得了的縱深
  --      不是縱深,是一句宣稱),我把話講白而不是留一句好聽的:
  --     **下面的負測③ 測的是步4,不是這一道。突變拿掉這一道,負測不會紅 —— 那是預期的。**
  --   ⇒ **什麼會讓它變成活的**:任何人把步4 的 FOR UPDATE 查詢或它的 NOT FOUND 分支挪走/放寬。
  --     那時這一道就是最後一道,而 `999999 > NULL` 不為 true(拋棄式 PG 17.10 實測)⇒ 靜靜放行。
  v_remaining := public.pcm_order_refundable_remaining(p_order_id);
  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 算不出可退餘額(查無此單或帳本讀不到)⇒ fail-closed 拒絕。'
                    '🔴 這與「額度不足」不同:那是金額問題,這是**看不到帳本**';
  END IF;
  IF p_refund_amount > v_remaining THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款金額 % 超過可退餘額 %(帳本未登記額)',
                    p_refund_amount, v_remaining;
  END IF;

  -- 步6 寫入(冪等由 UNIQUE (order_id, request_id) 保證;撞鍵 = 同一次互動被重送)
  BEGIN
    INSERT INTO public.order_manual_refunds
      (order_id, request_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES
      (p_order_id, p_request_id, p_rail, p_refund_amount,
       pg_catalog.btrim(p_reason, E' \t\r\n'), pg_catalog.btrim(p_actor, E' \t\r\n'), p_occurred_at)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- 🔴 **這條 handler 是 backstop,不是主要路徑**(逐字沿用 op5 對它的定位)。
    --   主要路徑是上面的步4.5 冪等格。走到這裡只有一種情況:**兩發並行**,
    --   兩發都在步4.5 查無、然後其中一發先寫進去。
    --   ⇒ 這時**不能回 idempotent** —— 我們沒有比對過對方寫了什麼。**拒絕,讓呼叫端重試一次**,
    --     重試時步4.5 就看得到那一列、也就會逐欄比對。
    RAISE EXCEPTION 'admin_record_manual_refund: 同一個 request_id 正在被並行寫入 ⇒ 拒絕本次,請重試。'
                    '(重試時會走冪等格逐欄比對;這條路徑不回 idempotent,因為它沒有比對過對方寫了什麼)';
  END;

  -- 落帳筆數守(trigger 抑制單列 ⇒ 靜默漏寫;本表零 trigger,而這道是給未來的人)
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 落帳 % 列(期望恰 1)⇒ 退款帳本沒收到這筆', v_n;
  END IF;

  RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', false, 'refund_id', v_id);
END;
$fn$;

COMMENT ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz) IS
  'M-4b E10 D1:非卡退款【登記】(SECURITY DEFINER、search_path=''''、鏡像 op5/opa12 形狀)。'
  '記的是【一件已經發生的事】—— 錢是人交回去的,系統沒有動作可做(該表 COMMENT 逐字)。'
  '🔴 **本 RPC 是那些守門唯一的存在位置**:該表零 trigger、CHECK 只有 refund_amount > 0 且**無上界**'
  '(A7c 拍板⑤:DB 不做防超退)⇒ 額度守門 / rail 值域 / actor 啟用 / occurred_at 兩道,'
  'DB 沒有第二道會接住。改本函式時,拿掉任何一道都不會有東西紅。'
  '🔴 額度守門對 `pcm_order_refundable_remaining` 回 NULL(查無此單)**單獨分流** —— '
  '實測(拋棄式 PG 17.10,2026-08-20):`999999 > NULL` 不為 true ⇒ 不分流就是靜靜放行。'
  '🔴 冪等:UNIQUE (order_id, request_id);撞鍵回既有那筆、不多寫一列。'
  '**射程**:它擋的是【同一次互動被重送】,**不擋**【同一筆錢被人用不同 request_id 登兩次】——'
  '後者靠對帳,與 op5 的限定相同。**不要把它讀成防重複入帳。**'
  '⚠️ 本片**零 GRANT**(分期開權):EXECUTE 由 D2 與沖銷 RPC 一起開。'
  '在那之前正式路徑呼不到 ⇒ 不可能出現「能登記、不能更正」的窗口。'
  'rail 不含 card(卡片退款走 order_refunds)。回 {recorded, idempotent, refund_id}。';

-- ── 4. ACL:兩道 REVOKE + **零 GRANT**(分期開權;EXECUTE 由 D2 與沖銷 RPC 一起開)──
-- 🔴 兩道都必須在【本片】。實測(拋棄式 PG 17.10,2026-08-20):不 REVOKE 的新 SECDEF 函式
--    ⇒ service_role / anon / authenticated **全為 true**、proacl = NULL。
--    ⇒ 少了這兩行,①片 A 的前置閘在本片落地那一刻就已為真(封印失效)
--                ②這支動錢的 RPC 在 D1→D2 之間對 anon 開著(鐵則 12②)。
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz) FROM anon, authenticated, authenticator, service_role;

-- ── 5. 🔴 apply 期負測:每一發都**必須紅**,而且要紅在對的訊息上 ─────────────
-- 本 RPC 是那些守門【唯一】的存在位置(表零 trigger、CHECK 只有 > 0 無上界)
-- ⇒ 這一節不是補完整性,它是那些守門唯一的證據。只跑 happy path = 那些守門等於不存在。
DO $probe$
DECLARE
  v_order uuid; v_actor text; v_created timestamptz; v_remaining bigint;
  v_err text; v_res jsonb;
  v_req uuid := pg_catalog.gen_random_uuid();
  PROBE_ROLLBACK constant text := 'D1_PROBE_ROLLBACK';
BEGIN
  SELECT o.id, o.created_at INTO v_order, v_created FROM public.orders o ORDER BY o.created_at LIMIT 1;
  SELECT s.id INTO v_actor FROM public.staff s WHERE s.is_active LIMIT 1;
  IF v_order IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'D1 負測:需要至少一張既有訂單與一位啟用中的 staff 來借。現在借不到 ⇒ 負測跑不了。'
                    '🔴 **刻意 fail-closed** —— 跑不了就是一格恆綠,而本 RPC 是那些守門唯一的位置。'
                    '**不要把這道斷言拿掉。**';
  END IF;
  v_remaining := public.pcm_order_refundable_remaining(v_order);
  IF v_remaining IS NULL OR v_remaining < 1 THEN
    RAISE EXCEPTION 'D1 負測:借到的那張單可退餘額 =%(需 >= 1 才跑得了正向那一發);換一張或在有資料的環境 apply',
                    coalesce(v_remaining::text, '<NULL>');
  END IF;

  BEGIN
    -- ① rail = card ⇒ 必須紅(走錯帳本,不是打錯字)
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, pg_catalog.gen_random_uuid(), v_actor,
                'card', 1, '負測', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('card 軌不得由人工登記' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測① 沒有紅在對的地方(rail=card)。實得:%', coalesce(v_err, '<沒有紅>');
    END IF;

    -- ② 金額 0 ⇒ 必須紅
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, pg_catalog.gen_random_uuid(), v_actor,
                'cash', 0, '負測', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('金額必須為正整數' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測② 沒有紅在對的地方(金額 0)。實得:%', coalesce(v_err, '<沒有紅>');
    END IF;

    -- ③ 不存在的 order_id ⇒ 必須紅。
    --    🔴 **正名(2026-08-20,突變 Ma 測出來的)**:這一發**測的是步4 的「查無此單」**,
    --    **不是**上面那道 NULL 分流 —— 拿掉 NULL 分流之後這一發照樣紅(紅在步4 的通用訊息)。
    --    原本我把它寫成「這一發守的是 NULL 分流」,那是**一句沒有被驗證的歸因**。
    --    ⇒ 那道 NULL 分流沒有可構造的負測,理由與代價寫在它自己旁邊。
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(),
                v_actor, 'cash', 999999, '負測', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('退款登記失敗' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測③ 沒有紅在對的地方(不存在的 order_id ⇒ 應紅在步4 的通用訊息)。實得:%',
                      coalesce(v_err, '<沒有紅>');
    END IF;

    -- ④ 超額 ⇒ 必須紅
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, pg_catalog.gen_random_uuid(), v_actor,
                'cash', (v_remaining + 1)::integer, '負測', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('超過可退餘額' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測④ 沒有紅在對的地方(超額)。實得:%', coalesce(v_err, '<沒有紅>');
    END IF;

    -- ⑤ actor 不存在 ⇒ 必須紅
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, pg_catalog.gen_random_uuid(),
                'zzz_not_a_real_staff', 'cash', 1, '負測', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('不存在或已停用' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測⑤ 沒有紅在對的地方(actor)。實得:%', coalesce(v_err, '<沒有紅>');
    END IF;

    -- ⑥ reason 只有空白字元 ⇒ 必須紅(btrim 顯式字集才擋得住)
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, pg_catalog.gen_random_uuid(), v_actor,
                'cash', 1, E'\n\t ', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('退款原因不得為空白' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測⑥ 沒有紅在對的地方(reason 全空白)。實得:%', coalesce(v_err, '<沒有紅>');
    END IF;

    -- ⑦ occurred_at 晚於現在 ⇒ 必須紅
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, pg_catalog.gen_random_uuid(), v_actor,
                'cash', 1, '負測', pg_catalog.now() + interval '1 day');
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('不得晚於現在' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測⑦ 沒有紅在對的地方(未來時點)。實得:%', coalesce(v_err, '<沒有紅>');
    END IF;

    -- ⑧ 正向:合法登記一次 ⇒ recorded=true / idempotent=false
    v_res := public.admin_record_manual_refund(v_order, v_req, v_actor, 'cash', 1, '正向對照', pg_catalog.now());
    IF coalesce((v_res->>'idempotent')::boolean, true) THEN
      RAISE EXCEPTION 'D1 正向對照:第一次登記回 idempotent=true ⇒ 不合理。實得 %', v_res;
    END IF;

    -- ⑨ 🔴 冪等:**同 request_id 再送一次** ⇒ 必須回 idempotent=true,而且不得多一列
    v_res := public.admin_record_manual_refund(v_order, v_req, v_actor, 'cash', 1, '正向對照', pg_catalog.now());
    IF NOT coalesce((v_res->>'idempotent')::boolean, false) THEN
      RAISE EXCEPTION 'D1 冪等:同 request_id 重送沒有回 idempotent=true。實得 %', v_res;
    END IF;
    IF (SELECT count(*) FROM public.order_manual_refunds r
         WHERE r.order_id = v_order AND r.request_id = v_req) <> 1 THEN
      RAISE EXCEPTION 'D1 冪等:同 request_id 重送之後不是恰 1 列 ⇒ UNIQUE 沒有生效';
    END IF;

    -- ⑩ 🔴 **同 request_id、不同內容 ⇒ 必須紅**(這一發守的是步4.5 的逐欄比對樹)
    --    少了它,把比對樹換成 `IF true` 也不會有東西紅 —— 而那正是本片修掉的那個錢的缺陷:
    --    呼叫端送 50、帳本裡是 100,而它收到 `recorded:true`。
    --    ⚠️ 金額刻意挑**預算內**的(v_remaining 夠大)—— 用超額的金額會被額度守門先擋掉,
    --       那樣這一發就變成在測額度守門、不是在測比對樹(實測踩過:100 → 500 被額度先擋)。
    v_err := NULL;
    BEGIN
      PERFORM public.admin_record_manual_refund(v_order, v_req, v_actor, 'cash', 2, '正向對照', pg_catalog.now());
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR position('帶了不同的內容' in v_err) = 0 THEN
      RAISE EXCEPTION 'D1 負測⑩【沒有紅在對的地方】—— 同 request_id 送不同金額被當成重送。'
                      '🔴 那正是「呼叫端相信 X 已登記,而帳本裡是 Y」的症狀,而差額會靜靜留在可退餘額裡。實得:%',
                      coalesce(v_err, '<沒有紅>');
    END IF;
    IF (SELECT count(*) FROM public.order_manual_refunds r
         WHERE r.order_id = v_order AND r.request_id = v_req) <> 1 THEN
      RAISE EXCEPTION 'D1 負測⑩:同鍵不同內容之後帳本不是恰 1 列';
    END IF;

    RAISE EXCEPTION '%', PROBE_ROLLBACK;
  EXCEPTION WHEN OTHERS THEN
    -- 🔴 只吞我們自己那一發;其餘一律往上拋(否則負測失敗會被自己吃掉 ⇒ 恆綠)
    IF SQLERRM <> PROBE_ROLLBACK THEN RAISE; END IF;
  END;

  RAISE NOTICE 'D1 驗收:八發負測各自紅在對的訊息上(⚠️ ③ 測的是步4 的查無此單,**不是** NULL 分流 —— 後者今天不可達、無可構造負測,理由寫在它旁邊) / 正向登記 1 列 / 同 request_id 重送回 idempotent 且仍恰 1 列 ⇒ 全數回滾,零留痕';
END
$probe$;

-- ── 6. 結構 assert ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n integer; v_bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.order_manual_refunds'::regclass
                    AND attname = 'request_id' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'D1 結構 assert:request_id 欄不存在或可為 NULL;拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE i.indrelid = 'public.order_manual_refunds'::regclass
                    AND c.relname = 'order_manual_refunds_idem_uniq' AND i.indisunique) THEN
    RAISE EXCEPTION 'D1 結構 assert:冪等唯一索引不存在或不是 UNIQUE ⇒ 重送擋不住;拒繼續';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)'::regprocedure) THEN
    RAISE EXCEPTION 'D1 結構 assert:prosecdef=false(SECURITY DEFINER 遺失);拒繼續';
  END IF;

  -- 🔴🔴 ACL 極性:本片**零 GRANT** ⇒ service_role 也必須是 false
  --   這一道就是「分期開權真的成立」的證據。它為真時,片 A 的前置閘才封得住。
  IF has_function_privilege('service_role',
        'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D1 ACL 極性:service_role 已經呼得到本 RPC ⇒ 分期開權失效,而片 A 的前置閘會在此刻就為真;拒繼續';
  END IF;
  IF has_function_privilege('anon',
        'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated',
        'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D1 ACL:anon 或 authenticated 呼得到這支動錢的 RPC ⇒ 鐵則 12②;拒繼續';
  END IF;
  SELECT string_agg(DISTINCT g.grantee::regrole::text, ',') INTO v_bad
    FROM pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
   WHERE p.oid = 'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)'::regprocedure
     AND g.grantee <> 0 AND g.grantee <> p.proowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'D1 ACL:owner 以外還有 grantee(%)⇒ 本片應為零 GRANT;拒繼續', v_bad;
  END IF;

  RAISE NOTICE 'D1 結構驗收通過:request_id NOT NULL / 冪等 UNIQUE 在 / SECURITY DEFINER / ACL 零 GRANT(service_role 亦為 false = 分期開權成立)';
END
$$;

COMMIT;
