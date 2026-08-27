-- M-4b E10 A7c:退款帳本改記金額 + 守門(order_refunds / order_refund_items)
--
-- 上位拍板 = Sean 2026-08-01 七拍板(memory `project_a7c-full-refund-only-decisions`):
--   ①換路走帳本式 ②退款一律從自家後台發起 ③**金額層部分退、不追品項** ④不拆單
--   ⑤**資料庫不做「防止超退」**(TapPay 自己擋) ⑥不做自動重試工人 ⑦部分退款隔日不放寬
-- 追加拍板 = Sean 2026-08-01 早 Q1/Q2/Q3(memory `project_a7c-q1-amount-ledger-decisions`):
--   **Q1 = A:帳本改成「記金額」,改形狀摺進本支 migration,不另開檔。**
--   Q2 = A:已結案那筆填錯先不做更正出口。
--   Q3 = A:轉 failed 之前的對帳只寫成營運鐵律,不做 DB 守門。
-- 交接檔 = docs/handoff/2026-08-01-a7c-night-run-handoff.md;結果報告 = 同目錄 -report.md
-- 鐵則:12 ①錢 + ③DB 結構。高風險片、審查不降級。
--
-- 本檔自帶顯式 BEGIN/COMMIT(對齊 20260725130100 與 2026-07-29 D0-1=A 拍板)。
-- 理由:本 repo 已實證 migration 檔**不保證**跑在單一交易內(SET LOCAL 是 no-op)
-- ⇒ 若改形狀成功而後續 trigger/ACL/斷言失敗,會留下「欄位沒了、守門也不在」的半套用破口。
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 為什麼要改形狀(全部是隔離庫實跑的觀察值,不是推論)
-- ════════════════════════════════════════════════════════════════════════════
-- 07-25 建的 `order_refunds` 形狀是「**退了哪幾件商品**」,而拍板③ 要的是「**退了多少錢**」。
-- 兩者在已 apply 的規則下不相容,實測依據:
--
-- P1. 零明細 header 會被擋(`沒有任何品項明細`,20260725130100:223-225)——
--     一致性 trigger 掛在**兩張表**上,header 那支自己會 RAISE
--     ⇒ 「不寫明細」在舊形狀下**物理上不可行**,帳本會完全無法寫入。
--
-- P2. 明細的 `unit_price` 必須逐列等於 `order_items.unit_price`、`quantity ≤` 原始數量,
--     且 `line_amount = unit_price * quantity`、`Σ line_amount = items_amount`
--     ⇒ `items_amount` 的可達值 = 「訂單品項單價 × 整數件數」生成的**離散集合**
--     (bounded subset-sum;常見形狀下一張訂單只有個位數到二十幾個金額可用)。
--
-- P3. 加上 `refund_amount = items_amount - shipping_delta` 這條 CHECK
--     ⇒ 要記「退 300」只有兩條路:誠實填(金額必須剛好落在 P2 那個集合上,做不到),
--     或把差額塞進 `shipping_delta` = **在帳本裡虛構一筆運費變動**(實測可行、無守門)。
--
-- P4. 🔴 **折扣訂單還會多算**:`orders.total = subtotal + shipping_fee - discount_total`,
--     而舊形狀完全沒有折扣的概念 ⇒ 實測反例:subtotal 7311 / 運費 137 / 折扣 100,
--     訂單實收 **7348**,而舊形狀能表示的「整筆退款」被公式逼成 **7448**,**多 100 元**。
--
-- ⇒ Sean 拍 Q1=A:**改形狀**。正式站四張退款表實查 **0 列** ⇒ 現在改零資料風險,
--    且本檔尚未 apply、尚未 commit ⇒ 是改形狀成本最低的視窗。
-- ⇒ 改完之後 P2/P3/P4 三個問題**同時消失**:帳本直接記一個金額,不再用品項去湊。
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 本片**刻意不做**(做了就違反拍板,不是疏忽)
-- ════════════════════════════════════════════════════════════════════════════
-- · **不做任何「防止超退」的守門** —— 拍板⑤。`refund_amount` 只有 `> 0`,**沒有上界**。
--   下方 `pcm_order_refundable_remaining()` 是**顯示用函式**,沒有任何 trigger 讀它。
--   ⚠️ 交接檔 §6 寫的「系統算出還能退多少**並擋住超額登記**」是上一個 session 的設計意見
--      (該節自己註明「非 Sean 拍板」),與拍板⑤ 直接衝突 ⇒ **以拍板為準**。
-- · 不做品項層追蹤、不拆單、不動 `order_refund_jobs`(其 `CHECK(false)` 休眠閘保持原狀)
-- · 不實作 `TapPayChargeAdapter.refund()`、不動後台 UI、不動前台
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 誠實邊界:本片的守門**擋不到什麼**
-- ════════════════════════════════════════════════════════════════════════════
-- 真相來源是 TapPay,不是本帳本。Sean 直接進 TapPay Portal 手動退款時 PCM 全程沒參與
-- ⇒ 錢退掉了、資料庫毫不知情,**本片沒有任何一道守門看得到那條路**。
-- 本片守的只是「**我們自己的紀錄不會寫錯、不會被改、不會被抹掉**」。
-- 任何把本片說成「防止超退」或「保證帳本等於實際退款」的字面都是過度宣稱。
--
-- 🔴 **對 owner 無效**:五支 trigger 都是一般(origin)模式,表擁有者可以
--    `ALTER TABLE ... DISABLE TRIGGER USER` 之後繞過全部守門。PostgreSQL 沒有能阻止
--    owner 這麼做的機制(`ENABLE ALWAYS` 也擋不住 `DISABLE`)。本片的斷言只在 **apply 當下**
--    驗證啟用態 ⇒ 這條要靠「誰有 owner 權限」與稽核來守,不是靠本片。
--
-- 🔴🔴 **會真的退兩次錢的那條路(Sean Q3=A,只寫規則不設守門)**:
--    退款其實**已執行**但沒拿到/沒記到對帳碼 → 操作者把該列轉 failed(我們自己文件寫的
--    更正路徑)→ `pcm_order_refundable_remaining()` 算出的剩餘可退額**回升** → 再退一次
--    → 兩次部分退款的累計仍在原刷卡額之內 ⇒ **TapPay 不會攔**(拍板⑤ 的「TapPay 自己擋」
--    只涵蓋超過原始刷卡金額)。
--    ⇒ **營運鐵律:轉 failed 之前必須先用 TapPay Record API 對帳。**

BEGIN;

-- 改形狀要 ACCESS EXCLUSIVE lock;5 秒等不到就整支放棄(對齊 20260725130100:72)。
SET LOCAL lock_timeout = '5s';

-- ══ 0. 前置斷言:現況必須是本片設計時看到的形狀 ═══════════════════════════════
DO $$
DECLARE
  v_cnt integer;
BEGIN
  -- 0a. 兩張表必須是空的 —— 下面要砍欄位、還要 ADD COLUMN ... NOT NULL 且不給 DEFAULT。
  --     正式站實查 0 列;若日後有列,本片必須改寫成搬遷流程,不可盲目重跑。
  SELECT count(*) INTO v_cnt FROM public.order_refunds;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — order_refunds 已有 % 列,改形狀會遺失資料;需改寫為搬遷流程,拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.order_refund_items;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — order_refund_items 已有 % 列,而本片要把它凍結;拒繼續', v_cnt;
  END IF;

  -- 0b. 要砍的東西必須真的在(缺任一 = schema 已漂移,本片的前提不成立)。
  --     🔴 不用 IF EXISTS:少了什麼要**大聲失敗**,不要靜默跳過。
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass
     AND conname IN ('order_refunds_amount_balances', 'order_refunds_shipping_delta_balances');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — 要砍的兩條金額等式 CHECK 應存在(實 % 條);拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname IN ('order_refunds_ledger_consistency_ac', 'order_refund_items_ledger_consistency_ac')
     AND NOT tgisinternal;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — 要砍的兩支一致性 trigger 應存在(實 % 支);拒繼續', v_cnt;
  END IF;

  -- 0c. 要留的東西也必須在,而且**未被停用**(只數存在會被 DISABLE TRIGGER 騙過)。
  -- 🔴 三個收緊(R4 must-fix):①**綁表** —— 只按名字全庫計數的話,同名 trigger 掛在
  --    別張表上也會過關 ②`tgenabled` 必須是 `O`(origin)或 `A`(always);
  --    原本寫 `<> 'D'` 會**接受 `R`(replica-only)**,而 replica-only 在正常寫入時
  --    根本不觸發 = 守門實際缺席卻通過斷言 ③逐支點名,不靠總數。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE NOT tgisinternal AND tgenabled IN ('O', 'A')
     AND ( (tgname = 'order_refunds_status_transition_bu'    AND tgrelid = 'public.order_refunds'::regclass)
        OR (tgname = 'order_refunds_block_truncate_bt'       AND tgrelid = 'public.order_refunds'::regclass)
        OR (tgname = 'order_refund_items_block_truncate_bt'  AND tgrelid = 'public.order_refund_items'::regclass) );
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — 要保留的三支 trigger 應各自掛在對的表上、且為 origin/always 啟用態(實 % 支);拒繼續', v_cnt;
  END IF;

  -- 🔴 R4 must-fix:本片把「金額合理性」整個交給既有的 `refund_amount > 0`,
  --    而改形狀砍掉了它周圍所有等式 ⇒ 它現在是**唯一**擋住 0 元與負數退款的東西。
  --    負數退款會讓 pcm_order_refundable_remaining 的剩餘額**上升**。必須確認它還在。
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass
     AND conname = 'order_refunds_refund_amount_check'
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%refund_amount > 0%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — 既有 CHECK (refund_amount > 0) 不存在或已漂移,而本片仰賴它擋 0 元與負數退款;拒繼續';
  END IF;

  -- 0d. orders.tappay_rec_trade_id 必須存在(rec_trade_id 綁定的對照來源)。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.orders'::regclass
     AND attname = 'tappay_rec_trade_id' AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 前置失敗 — orders.tappay_rec_trade_id 不存在;拒繼續';
  END IF;
END $$;

-- ══ 1. 改形狀:帳本從「記品項」改成「記金額」(Sean Q1=A)═══════════════════════
-- 1a. 先砍兩條把金額綁死在品項與運費上的等式(P3 / P4 的根源)。
--     🔴 顯式砍、不靠 DROP COLUMN 的連帶效果 —— 讓「砍掉了什麼」在檔案裡看得見。
ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_amount_balances;
ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_shipping_delta_balances;

-- 1b. 砍掉主從一致性的兩支 CONSTRAINT TRIGGER 與其函式。
--     它們存在的唯一理由是「header 金額 = Σ 明細、且至少一列明細」——
--     在不追品項的帳本上,這條不變式**沒有對應物**(P1)。留著只會讓帳本寫不進去。
DROP TRIGGER order_refunds_ledger_consistency_ac      ON public.order_refunds;
DROP TRIGGER order_refund_items_ledger_consistency_ac ON public.order_refund_items;
DROP FUNCTION public.pcm_assert_refund_ledger_consistent();

-- 1c. 砍掉四個在金額層退款下沒有語意的欄位。
--     🔴 選擇「砍掉」而不是「留著設 NULL」:留著等於在金流帳本上放四個**沒有意義但看起來
--        很有意義**的數字,下一個人一定會去讀它。連帶會自動移除只依賴它們的 CHECK
--        (items_amount > 0 / shipping_fee_* >= 0 / shipping_fee_sane)。
ALTER TABLE public.order_refunds
  DROP COLUMN items_amount,
  DROP COLUMN shipping_fee_before,
  DROP COLUMN shipping_fee_after,
  DROP COLUMN shipping_delta;

-- 1d. 保留但**凍結** order_refund_items(守門在 §5)。
--     不 DROP TABLE 的理由:它是既有結構、正式站 0 列、且被 A7b-M 引用為形狀樣板;
--     砍表不可逆,而「凍結」達到同樣效果又可逆。
--     ⇒ 「不追品項」這個拍板從此在 DB 層有實體,不只是口頭約定。

-- ══ 2. rec_trade_id:帳本記住「這筆錢退的是哪一筆 TapPay 交易」═══════════════════
-- 為何要存一份而不是每次去讀 orders:帳本是**快照**。若日後該訂單重新授權、
-- orders.tappay_rec_trade_id 被改寫,帳本仍必須說得出當初退的是哪一筆交易。
-- 🔴 NOT NULL 的代價(誠實揭示):**沒有 TapPay 交易的訂單(例如匯款)無法登記退款**。
--    fail-closed 的刻意選擇。⇒ 匯款訂單的退款登記是**未解題**,已列進報告等 Sean 拍板。
-- 🔴 為何**沒有**配 `CHECK (btrim(rec_trade_id) <> '')`:那會是**死規則** ——
--    INSERT 要求本欄等於 orders.tappay_rec_trade_id,而該值已先被驗過非空白 ⇒ 空白進不來;
--    UPDATE 走不可變守門 ⇒ 事後也改不成空白。負測構造不出來 = 永遠不紅
--    (memory `feedback_unconstructible-negative-test-means-noop-guard`;驗收要求 0 死規則)。
-- 🔴 `NOT NULL` **不是**死規則:trigger 內是 `NEW.rec_trade_id <> v_rec_trade_id`,
--    而 `NULL <> 'x'` 求值為 NULL(非 true)⇒ NULL 不會被 trigger 攔下,由本 NOT NULL 接住。
ALTER TABLE public.order_refunds
  ADD COLUMN rec_trade_id text NOT NULL;

COMMENT ON COLUMN public.order_refunds.rec_trade_id IS
  'A7c:本筆退款所針對的 TapPay 交易識別碼快照。INSERT 當下綁定為該訂單的 orders.tappay_rec_trade_id;之後不可變。🔴 是快照不是外鍵 —— 綁定只在 INSERT 那一刻成立,日後 orders 那一欄被改寫本欄不跟著動(刻意)。';

COMMENT ON COLUMN public.order_refunds.refund_amount IS
  'A7c:本筆退款的金額(元,整數)。🔴 這是帳本唯一的金額欄 —— 金額層部分退款(Sean 拍板③),不由品項湊出。只有 > 0、**沒有上界**(拍板⑤:DB 不做防超退)。一經寫入不可 UPDATE。';

-- ══ 3. INSERT 守門:五道 + 一道欄位覆寫 ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pcm_a7c_refund_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_status text;
  v_rec_trade_id   text;
BEGIN
  -- ── 3.1 初態必須是 processing ────────────────────────────────────────────
  -- 狀態機 trigger 只有 BEFORE UPDATE、對 INSERT 完全不觸發(20260725130100:308-310),
  -- 而 shape CHECK 允許 INSERT 即 confirmed ⇒ 可憑空生出一列「已完成」的退款。
  IF NEW.status <> 'processing' THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:初態必須是 processing(收到的是 %);confirmed/failed 只能由狀態機從 processing 轉入', NEW.status
      USING ERRCODE = 'P7C01', CONSTRAINT = 'a7c_insert_status_must_be_processing';
  END IF;

  -- ── 3.2 訂單必須真的收過錢 ───────────────────────────────────────────────
  -- 🔴 **FOR SHARE**:純 SELECT 在 READ COMMITTED 下不產生任何持續約束 ⇒ T1 讀到
  --    paid/REC-A 之後,T2 可在 T1 commit 前把訂單改成 unpaid 或換掉 rec_trade_id,
  --    兩者都 commit ⇒ 帳本落地當下就與訂單現況不一致。用 FOR SHARE 而非 FOR KEY SHARE:
  --    要擋的兩欄**不是**鍵欄位,FOR KEY SHARE 擋不住對它們的 UPDATE。
  --    鎖順序約定:**orders(FOR SHARE)→ order_refunds**。
  --    🔴 另一條約定:**登記交易不得跨「人到 Portal 操作」的往返持鎖** ——
  --    登記與結案必須是兩個各自短命的交易,否則該訂單的 settleCharge 會被卡住數分鐘。
  SELECT o.payment_status::text, o.tappay_rec_trade_id
    INTO v_payment_status, v_rec_trade_id
    FROM public.orders o
   WHERE o.id = NEW.order_id
     FOR SHARE;

  -- 🔴 **allowlist,不是 denylist**:黑名單對**日後新增的 enum 值 fail-open**,
  --    而 payment_status 這個 enum 六天前才剛被 `20260725130000` 加過第 5 個值。
  -- 🔴 `IS NULL` 必須顯式擋:訂單不存在時 SELECT INTO 給 NULL,而 `NULL NOT IN (...)`
  --    求值為 NULL(非 true)⇒ 少了這半句,不存在的訂單會**靜默通過**本道。
  --    (原本有一道獨立的「訂單不存在」守門,突變實測證明被本道嚴格蘊含 = 死規則,已移除;
  --     最終防線仍有 order_id 那條 FK。)
  -- 🔴 值域沿用 Sean 2026-08-01 Q1=A 拍板:放行 {paid, partiallyRefunded, refunded}、
  --    擋 {unpaid, partiallyPaid};`refunded` **刻意放行**,逐字理由:「全額退完之後還能不能
  --    再登記」取決於尚未存在的程式,現在擋等於拿沒寫的程式當前提。
  -- ⚠️ 這道擋的是「這張單從沒收過錢」,**不是**「這張單還能退多少」(後者=拍板⑤,不做)。
  IF v_payment_status IS NULL
     OR v_payment_status NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:訂單 % 的 payment_status = % 不在可退款白名單,不得登記退款', NEW.order_id, COALESCE(v_payment_status, '<訂單不存在>')
      USING ERRCODE = 'P7C02', CONSTRAINT = 'a7c_insert_order_payment_not_captured';
  END IF;

  -- ── 3.3 rec_trade_id 必須綁定到該訂單自己的交易 ──────────────────────────
  -- 🔴 承重、關錢:送錯 rec_trade_id 給 TapPay,它會乖乖退**別人**的錢,且無從得知。
  -- 🔴 兩個**不同的失敗模式**必須各有各的 constraint 名:共用一個的話,突變 harness
  --    只會替換掉第一個 RAISE、第二個仍攔得住 ⇒ 該守門被誤判成死規則(實際踩過)。
  IF v_rec_trade_id IS NULL OR btrim(v_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:訂單 % 沒有 tappay_rec_trade_id(非信用卡交易?),無法登記退款', NEW.order_id
      USING ERRCODE = 'P7C03', CONSTRAINT = 'a7c_insert_order_has_no_rec_trade_id';
  END IF;

  IF NEW.rec_trade_id <> v_rec_trade_id THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:rec_trade_id(%)與訂單 % 自己的交易識別碼(%)不符;拒繼續', NEW.rec_trade_id, NEW.order_id, v_rec_trade_id
      USING ERRCODE = 'P7C03', CONSTRAINT = 'a7c_insert_rec_trade_id_mismatch';
  END IF;

  -- ── 3.4 結案欄在 INSERT 當下必須是空的 ───────────────────────────────────
  -- 🔴 實測繞道:INSERT 時就把 tappay_refund_id 填成假碼、狀態仍是 processing;
  --    之後轉 confirmed 時**值沒有變動** ⇒ write-once 的 `IS DISTINCT FROM` 為 false
  --    ⇒ 守門完全不觸發,一組**從未向 TapPay 取得過**的假對帳碼就永久落帳。
  IF NEW.tappay_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:tappay_refund_id 必須留空(它只能在結案那一次 UPDATE 由 NULL 寫入);收到 %', NEW.tappay_refund_id
      USING ERRCODE = 'P7C08', CONSTRAINT = 'a7c_insert_settlement_fields_must_be_empty';
  END IF;

  -- ── 3.5 created_at 由 DB 決定,不接受呼叫端指定 ──────────────────────────
  -- 只把它釘成「不可 UPDATE」是不夠的:呼叫端可以在 INSERT 時填任意時間,
  -- 那樣凍結的是一個本來就能造假的值,「帳本的時間證據」不成立。
  -- DEFAULT now() 對「顯式傳值」的 INSERT 沒有保護力 ⇒ 直接覆寫。
  NEW.created_at := now();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.pcm_a7c_refund_insert_guard() IS
  'A7c 帳本 INSERT 五道守門 + 一道覆寫:①初態必須 processing ②訂單 payment_status 必須在白名單 {paid, partiallyRefunded, refunded} 內、NULL(訂單不存在)一併擋 ③訂單必須有 tappay_rec_trade_id(匯款單擋在此)④rec_trade_id 必須等於該訂單的那一筆 ⑤tappay_refund_id 必須留空。覆寫:created_at 一律改成 now()。🔴 讀 orders 取 FOR SHARE 列鎖(TOCTOU);鎖順序 orders→order_refunds。🔴 **不含任何超退檢查**(拍板⑤)。';

CREATE TRIGGER order_refunds_a7c_insert_guard_bi
  BEFORE INSERT ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7c_refund_insert_guard();

-- ══ 4. UPDATE 守門:五道 + 一道欄位覆寫 ══════════════════════════════════════
-- 交接檔 §2-1 逐字:「帳本列寫進去之後,金額類欄位任何 UPDATE 一律拒絕」。
-- 🔴 營運代價(誠實揭示):登記時金額打錯**不能改**,只能把該列轉 failed(附 failed_reason)
--    再開新的一列。這是刻意的 —— 金流帳本可改金額 = 帳本失去證據力。
--    ⚠️ 但 confirmed 是終態、轉不出去 ⇒ **已結案那筆填錯沒有出口**(Sean Q2=A:先不做)。
CREATE OR REPLACE FUNCTION public.pcm_a7c_refund_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── 4.1 金額欄 ───────────────────────────────────────────────────────────
  -- 改形狀之後帳本只有**一個**金額欄。實測(舊形狀):可把已落帳的金額從 100 UPDATE
  -- 成 100000,只要 header 內部算式自洽 —— 現在連算式都沒有了,更要直接釘死。
  IF NEW.refund_amount IS DISTINCT FROM OLD.refund_amount THEN
    RAISE EXCEPTION 'A7c 帳本:金額欄不可變(退款 %);如需更正請將該列轉 failed 後另開一列', OLD.id
      USING ERRCODE = 'P7C04', CONSTRAINT = 'a7c_update_money_columns_immutable';
  END IF;

  -- ── 4.2 身分與稽核欄 ─────────────────────────────────────────────────────
  -- bank_refund_id 是冪等鍵(實測原本可被改 ⇒ 冪等保證形同虛設);
  -- actor / request_id / reason 是「誰按的、為什麼退、對應哪條 correlation」的稽核證據。
  IF NEW.order_id       IS DISTINCT FROM OLD.order_id
  OR NEW.bank_refund_id IS DISTINCT FROM OLD.bank_refund_id
  OR NEW.rec_trade_id   IS DISTINCT FROM OLD.rec_trade_id
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  OR NEW.actor          IS DISTINCT FROM OLD.actor
  OR NEW.request_id     IS DISTINCT FROM OLD.request_id
  OR NEW.reason         IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'A7c 帳本:身分/稽核欄(order_id / bank_refund_id / rec_trade_id / created_at / actor / request_id / reason)不可變(退款 %)', OLD.id
      USING ERRCODE = 'P7C05', CONSTRAINT = 'a7c_update_identity_columns_immutable';
  END IF;

  -- ── 4.3 結案欄 write-once ────────────────────────────────────────────────
  -- 🔴 `tappay_refund_id` 是交接檔 §6 逐字稱為「**唯一的對帳點**」的那個 DR 識別碼。
  --    留成全可變 ⇒ 結案之後還能把對帳點改掉或抹成 NULL,而金額欄卻不可變 —— 兩者的
  --    證據力應該一致。允許 NULL→值(結案),禁止改成別的值、也禁止抹回 NULL。
  IF (OLD.tappay_refund_id IS NOT NULL AND NEW.tappay_refund_id IS DISTINCT FROM OLD.tappay_refund_id)
  OR (OLD.confirmed_at     IS NOT NULL AND NEW.confirmed_at     IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'A7c 帳本:結案欄 write-once(退款 %)—— tappay_refund_id / confirmed_at 一經寫入不得再改或抹除', OLD.id
      USING ERRCODE = 'P7C07', CONSTRAINT = 'a7c_update_settlement_fields_write_once';
  END IF;

  -- ── 4.4 結案必須帶對帳碼 ─────────────────────────────────────────────────
  -- 🔴 前兩輪審查都在問「填了之後改不改得掉」,**沒有人問「可不可以不填」**。
  --    既有 CHECK 只把 confirmed_at 綁到 confirmed、tappay_refund_id 全程可為 NULL
  --    ⇒ 一個只填 status + confirmed_at 的 UPDATE 會讓「已結案但沒有唯一對帳點」的
  --    退款永久落帳,而全部守門都放行。
  IF NEW.status = 'confirmed' AND NEW.tappay_refund_id IS NULL THEN
    RAISE EXCEPTION 'A7c 帳本:結案(confirmed)必須同時回填 tappay_refund_id —— 那是這筆退款唯一的對帳點(退款 %)', OLD.id
      USING ERRCODE = 'P7C09', CONSTRAINT = 'a7c_confirm_requires_tappay_refund_id';
  END IF;

  -- ── 4.5 processing 期間不得預填對帳碼 ────────────────────────────────────
  -- 少了這道,「只能在結案那一刻由 NULL 寫入」就只是願望:INSERT 擋住了預填,
  -- 但 processing→processing 的 UPDATE 仍可先塞假碼,之後結案時值沒變動 ⇒ write-once 不觸發。
  IF NEW.status = 'processing' AND NEW.tappay_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'A7c 帳本:processing 期間不得填 tappay_refund_id(它只能在轉 confirmed 的那一次 UPDATE 寫入;退款 %)', OLD.id
      USING ERRCODE = 'P7C10', CONSTRAINT = 'a7c_processing_must_not_have_tappay_refund_id';
  END IF;

  -- ── 4.6 confirmed_at 由 DB 決定 ──────────────────────────────────────────
  -- §3.5 對 created_at 的論證逐字適用於 confirmed_at:它原本仍由呼叫端自由指定
  -- 再被 write-once 凍結 = 凍結了一個本來就能造假的時間。
  -- 拍板⑦「部分退款隔日」日後若讀這個時間軸,讀到的必須是 DB 的時間。
  IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN
    NEW.confirmed_at := now();
  END IF;

  -- 刻意留可變:status / failed_reason,以及**尚未填過**的 confirmed_at / tappay_refund_id
  -- —— 交接檔 §6 的三步流程(登記意圖 → Portal 退 → 回填 DR 識別碼結案)靠這條路完成。
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.pcm_a7c_refund_immutable_guard() IS
  'A7c 帳本 UPDATE 五道守門 + 一道覆寫:①refund_amount 不可變 ②身分/稽核七欄(order_id / bank_refund_id / rec_trade_id / created_at / actor / request_id / reason)不可變 ③結案二欄(tappay_refund_id / confirmed_at)write-once ④結案必須帶 tappay_refund_id ⑤processing 期間不得預填 tappay_refund_id。覆寫:轉 confirmed 時 confirmed_at 一律改成 now()。刻意留可變:status / failed_reason(§6 回填結案路徑要用)。';

CREATE TRIGGER order_refunds_a7c_immutable_guard_bu
  BEFORE UPDATE ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7c_refund_immutable_guard();

-- ══ 5. DELETE 守門 + order_refund_items 凍結 ═════════════════════════════════
-- 實測:單刪明細會被舊的「零明細」不變式擋、單刪 header 會被 FK 擋,**但兩個放在同一交易
-- 一起刪就整個通過**(刪光後 header 已不存在 ⇒ 舊一致性函式的 CONTINUE WHEN NOT FOUND
-- 直接跳過)。TRUNCATE 早就擋了,DELETE 沒擋。改形狀後那支函式已移除 ⇒ 更需要這道。
CREATE OR REPLACE FUNCTION public.pcm_a7c_refund_block_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A7c:退款帳本禁止 DELETE(%)—— 帳本是唯一的退款紀錄,刪掉就沒了;如需作廢請將該列轉 failed(🔴 轉 failed 前必先用 TapPay Record API 對帳,否則剩餘可退額會回升、可能導致同一筆錢退兩次)', TG_TABLE_NAME
    USING ERRCODE = 'P7C06', CONSTRAINT = 'a7c_ledger_delete_forbidden';
END;
$$;

COMMENT ON FUNCTION public.pcm_a7c_refund_block_delete() IS
  'A7c:order_refunds / order_refund_items 皆禁止 DELETE。作廢走 status = failed,不刪列。🔴 訊息內含「轉 failed 前必先對帳」的營運鐵律(Sean Q3=A:只寫規則不設守門)。';

CREATE TRIGGER order_refunds_a7c_block_delete_bd
  BEFORE DELETE ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7c_refund_block_delete();

CREATE TRIGGER order_refund_items_a7c_block_delete_bd
  BEFORE DELETE ON public.order_refund_items
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7c_refund_block_delete();

-- 🔴 凍結 order_refund_items:拍板③「不追品項」從此在 DB 層有實體。
--    不 DROP TABLE(不可逆、且它被 A7b-M 引用為形狀樣板);改成任何寫入都擋。
CREATE OR REPLACE FUNCTION public.pcm_a7c_refund_items_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A7c:order_refund_items 已凍結 —— 退款改記金額、不追品項(Sean 拍板③ / Q1=A),本表不再有任何寫入端;若要恢復品項層追蹤必須另開 migration 並重新設計不變式'
    USING ERRCODE = 'P7C11', CONSTRAINT = 'a7c_refund_items_frozen';
END;
$$;

COMMENT ON FUNCTION public.pcm_a7c_refund_items_frozen() IS
  'A7c:order_refund_items 凍結守門(禁 INSERT / UPDATE;DELETE 與 TRUNCATE 由另兩支擋)。改形狀後帳本記金額不記品項 ⇒ 本表無寫入端,保留純為歷史結構與 A7b-M 的形狀樣板參照。';

CREATE TRIGGER order_refund_items_a7c_frozen_biu
  BEFORE INSERT OR UPDATE ON public.order_refund_items
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7c_refund_items_frozen();

-- 🔴 R4 nit:既有 `pcm_refund_ledger_block_truncate` 的錯誤訊息逐字叫操作者
--    「請逐列 DELETE 並讓 trigger 逐筆驗證」,但 A7c 之後兩張表的 DELETE **一律失敗**
--    ⇒ 復原指示互相矛盾、會把人導向一條走不通的路。只換訊息、行為完全不動。
CREATE OR REPLACE FUNCTION public.pcm_refund_ledger_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '退款帳本禁止 TRUNCATE(%)—— 帳本是唯一的退款紀錄。🔴 A7c 之後 DELETE 也一律被擋,**沒有**逐列刪除這條路;要作廢某筆請將該列 status 轉 failed(轉之前必先用 TapPay Record API 對帳)', TG_TABLE_NAME;
END;
$$;

REVOKE ALL ON FUNCTION public.pcm_refund_ledger_block_truncate() FROM PUBLIC, anon, authenticated, service_role;

-- ══ 6. 顯示用函式:這張訂單「照我們的帳本」還能退多少 ═══════════════════════════
-- 🔴🔴 **這不是守門**(拍板⑤)。沒有任何 trigger 呼叫它。
--     它存在的理由是 UX 事實:TapPay Portal 第二次退款的確認框顯示的是**原始總額**,
--     不是**剩餘可退額** ⇒ 人會看著錯的數字按下去。剩餘額只有我們算得出來。
--
-- 🔴 改形狀之後這個數字才是對的:直接用 orders.total 減掉已登記的金額,
--    不再經過「品項湊金額」那層 ⇒ **折扣訂單的高估問題(P4)自動消失**。
--
-- 🔴 誠實邊界(不得在 UI 上把這個數字說成「還能退的錢」):
--   · 它是「**我們帳本裡**還沒登記掉的額度」,Sean 直接進 Portal 退的錢完全不在裡面
--     ⇒ 真實剩餘可退額 ≤ 本函式回傳值。要真相請打 TapPay Record API。
--   · processing 也算進已用額度(fail-closed):一筆登記了但還沒去 Portal 執行的退款,
--     寧可先佔住額度,也不要讓它被重複登記一次。
--   · failed 不算 —— 🔴🔴 **這是一個「假設」,不是事實**:它假設「標成 failed 的那筆錢
--     沒有退出去」。若退款其實**已經執行**、只是沒拿到或沒記到對帳碼,操作者把它轉成
--     failed 之後本函式算出的剩餘可退額會**回升**,照著那個數字再退一次 = **同一筆錢退兩次**。
--     ⚠️ 拍板⑤「TapPay 自己擋」**不涵蓋這條**(它只擋累計超過原始刷卡金額)。
--     ⇒ **營運鐵律:轉 failed 之前必須先用 TapPay Record API 對帳。**(Sean Q3=A)
-- 🔴 回傳 **bigint**:`SUM(integer)` 在 PostgreSQL 回 bigint,而 refund_amount 沒有上界
--    ⇒ integer 回傳型別會溢位(22003),顯示路徑整個炸掉。
-- 🔴 SUM() 對零列回 NULL ⇒ 必須 COALESCE,否則零退款訂單會回 NULL 而非全額。
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.total::bigint - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status <> 'failed'), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.pcm_order_refundable_remaining(uuid) IS
  'A7c 顯示用:orders.total 減去本帳本已登記(processing + confirmed,不含 failed)的退款金額。🔴 **不是守門、沒有任何 trigger 讀它**(拍板⑤:DB 不做防超退)。🔴 只反映**我們帳本內**的登記;Sean 直接在 TapPay Portal 手動退的錢不在其中 ⇒ 真實剩餘額 ≤ 本值,要真相請打 TapPay Record API。🔴 「failed 不算」是假設不是事實 —— 轉 failed 前必先對帳,否則剩餘額回升會導致同一筆錢退兩次。查無訂單回 NULL。';

-- ══ 7. 函式 EXECUTE 收斂 ════════════════════════════════════════════════════
-- PostgreSQL 新建 function **預設 GRANT EXECUTE TO PUBLIC**;兩支守門是 SECURITY DEFINER
-- ⇒ PUBLIC 可執行 = 多一個以 owner 權限起跑的入口。
REVOKE ALL ON FUNCTION public.pcm_a7c_refund_insert_guard()    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7c_refund_immutable_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7c_refund_block_delete()    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7c_refund_items_frozen()    FROM PUBLIC, anon, authenticated, service_role;

-- 顯示用函式:service_role 需要能呼叫(後台顯示路徑),client 角色一律零。
REVOKE ALL ON FUNCTION public.pcm_order_refundable_remaining(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pcm_order_refundable_remaining(uuid) TO service_role;

-- ══ 8. fail-closed 驗收斷言 ═════════════════════════════════════════════════
DO $$
DECLARE
  v_cnt  integer;
  v_ok   boolean;
  v_tbl  text;
  v_priv text;
BEGIN
  -- 8a. 改形狀真的生效:四個欄位不在了、等式 CHECK 不在了、兩支一致性 trigger 與函式不在了。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass
     AND attnum > 0 AND NOT attisdropped
     AND attname IN ('items_amount', 'shipping_fee_before', 'shipping_fee_after', 'shipping_delta');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 四個品項時代的金額欄應已移除,實剩 % 欄;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass
     AND conname IN ('order_refunds_amount_balances', 'order_refunds_shipping_delta_balances',
                     'order_refunds_shipping_fee_sane');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 品項時代的金額等式 CHECK 應已移除,實剩 % 條;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname IN ('order_refunds_ledger_consistency_ac', 'order_refund_items_ledger_consistency_ac')
     AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 兩支主從一致性 trigger 應已移除,實剩 % 支;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_assert_refund_ledger_consistent';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — pcm_assert_refund_ledger_consistent 應已移除;拒繼續';
  END IF;

  -- 8b. refund_amount 仍在且仍 NOT NULL(它現在是帳本唯一的金額欄)。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass
     AND attname = 'refund_amount' AND attnotnull AND NOT attisdropped;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — refund_amount 應存在且 NOT NULL;拒繼續';
  END IF;

  -- 8c. rec_trade_id 屬性:text / NOT NULL。
  --     🔴 刻意不驗「非空白 CHECK」—— 本片明文決定不加那條(它是死規則,見 §2)。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass
     AND attname = 'rec_trade_id' AND attnotnull
     AND format_type(atttypid, atttypmod) = 'text';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — rec_trade_id 應為 text NOT NULL;拒繼續';
  END IF;

  -- 8d. 五支新 trigger 全在、綁對表與事件、且處於啟用態。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger t
   WHERE t.tgname = 'order_refunds_a7c_insert_guard_bi'
     AND t.tgrelid = 'public.order_refunds'::regclass
     AND NOT t.tgisinternal AND (t.tgtype & 4) <> 0 AND (t.tgtype & 2) <> 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — INSERT 守門應恰 1 支 BEFORE INSERT on order_refunds,實 %;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger t
   WHERE t.tgname = 'order_refunds_a7c_immutable_guard_bu'
     AND t.tgrelid = 'public.order_refunds'::regclass
     AND NOT t.tgisinternal AND (t.tgtype & 16) <> 0 AND (t.tgtype & 2) <> 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — UPDATE 守門應恰 1 支 BEFORE UPDATE on order_refunds,實 %;拒繼續', v_cnt;
  END IF;

  -- 🔴 UPDATE trigger 不得帶欄位限定(UPDATE OF ...):帶了就只有列出的欄位會觸發,
  --    其餘欄位的竄改靜默放行。tgattr 非空 = 有欄位限定。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname = 'order_refunds_a7c_immutable_guard_bu'
     AND NOT tgisinternal
     AND COALESCE(array_length(string_to_array(tgattr::text, ' '), 1), 0) > 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 不可變守門帶了欄位限定(UPDATE OF ...),未列出的欄位會靜默放行;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger t
   WHERE t.tgname IN ('order_refunds_a7c_block_delete_bd', 'order_refund_items_a7c_block_delete_bd')
     AND NOT t.tgisinternal AND (t.tgtype & 8) <> 0 AND (t.tgtype & 2) <> 0;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — DELETE 守門應恰 2 支,實 %;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger t
   WHERE t.tgname = 'order_refund_items_a7c_frozen_biu'
     AND t.tgrelid = 'public.order_refund_items'::regclass
     AND NOT t.tgisinternal AND (t.tgtype & 4) <> 0 AND (t.tgtype & 16) <> 0 AND (t.tgtype & 2) <> 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 凍結守門應恰 1 支 BEFORE INSERT OR UPDATE on order_refund_items,實 %;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE tgname IN ('order_refunds_a7c_insert_guard_bi', 'order_refunds_a7c_immutable_guard_bu',
                    'order_refunds_a7c_block_delete_bd', 'order_refund_items_a7c_block_delete_bd',
                    'order_refund_items_a7c_frozen_biu')
     AND NOT tgisinternal AND tgenabled = 'O';
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 五支守門 trigger 應全為啟用態(tgenabled=O),實 % 支;拒繼續', v_cnt;
  END IF;

  -- 8e. 保留下來的三支既有 trigger 仍在且未被停用。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger
   WHERE NOT tgisinternal AND tgenabled IN ('O', 'A')
     AND ( (tgname = 'order_refunds_status_transition_bu'    AND tgrelid = 'public.order_refunds'::regclass)
        OR (tgname = 'order_refunds_block_truncate_bt'       AND tgrelid = 'public.order_refunds'::regclass)
        OR (tgname = 'order_refund_items_block_truncate_bt'  AND tgrelid = 'public.order_refund_items'::regclass) );
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 保留的三支既有 trigger 應各自掛對表且為 origin/always,實 % 支;拒繼續', v_cnt;
  END IF;

  -- 8e-2. 既有的金額合理性 CHECK 仍在(改形狀後它是唯一擋 0 元/負數退款的東西)。
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass
     AND conname = 'order_refunds_refund_amount_check'
     AND pg_get_constraintdef(oid) ILIKE '%refund_amount > 0%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — CHECK (refund_amount > 0) 應仍存在;拒繼續';
  END IF;

  -- 8f. 四支守門函式 EXECUTE 零外授。
  --     🔴 用 has_function_privilege 不用 proacl IS NULL(後者代表「沿用預設」= PUBLIC 有
  --        EXECUTE,把 NULL 當乾淨會靜默放行)。
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_a7c_refund_insert_guard', 'pcm_a7c_refund_immutable_guard',
                       'pcm_a7c_refund_block_delete', 'pcm_a7c_refund_items_frozen')
     AND (
       has_function_privilege('public',        p.oid, 'EXECUTE')
       OR has_function_privilege('anon',          p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR has_function_privilege('service_role',  p.oid, 'EXECUTE')
     );
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — 守門函式仍可被 PUBLIC/anon/authenticated/service_role 執行(% 支);拒繼續', v_cnt;
  END IF;

  -- 8g. 顯示函式:service_role 可執行、client 角色不可。
  SELECT has_function_privilege('service_role', 'public.pcm_order_refundable_remaining(uuid)', 'EXECUTE') INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — service_role 應可執行 pcm_order_refundable_remaining;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM (SELECT unnest(ARRAY['public', 'anon', 'authenticated']) AS r) x
   WHERE has_function_privilege(x.r, 'public.pcm_order_refundable_remaining(uuid)', 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7c 斷言失敗 — pcm_order_refundable_remaining 不應可被 PUBLIC/anon/authenticated 執行(% 個角色可);拒繼續', v_cnt;
  END IF;

  -- 8h. 表級 ACL 未被本片放寬(本片完全沒動 GRANT;被動了就是回歸)。
  --     🔴 同時擋 grant option —— service_role 若拿到 `SELECT WITH GRANT OPTION`,
  --        它就能把讀取權再轉授出去,而只比對 grantee 身分的斷言會照樣通過。
  FOR v_cnt IN
    SELECT count(*)
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
     WHERE c.oid IN ('public.order_refunds'::regclass, 'public.order_refund_items'::regclass)
       AND (
         (a.grantee <> c.relowner AND a.grantee <> 'service_role'::regrole::oid)
         OR (a.grantee = 'service_role'::regrole::oid AND a.is_grantable)
       )
  LOOP
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7c 斷言失敗 — 帳本 relacl 出現非預期 grantee 或 grant option(% 筆);拒繼續', v_cnt;
    END IF;
  END LOOP;

  -- 8i. service_role 對兩張表只能有 SELECT(種類驗證;8h 只回答「有誰」)。
  FOREACH v_tbl IN ARRAY ARRAY['order_refunds', 'order_refund_items'] LOOP
    IF NOT has_table_privilege('service_role', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION 'A7c 斷言失敗 — service_role 應保有 % 的 SELECT(後台顯示路徑);拒繼續', v_tbl;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('service_role', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION 'A7c 斷言失敗 — service_role 不應有 % 的 %;拒繼續', v_tbl, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'A7c 驗收全數通過(改形狀生效 + 5 支守門 trigger + 保留的 3 支既有 trigger + rec_trade_id 屬性 + 函式 ACL + 表 ACL 未放寬)';
END $$;

-- ══ 9. COMMENT ══════════════════════════════════════════════════════════════
COMMENT ON TABLE public.order_refunds IS
  'M-3 RF2a 退款帳本 + M-4b A7c(2026-08-01 Sean Q1=A 改形狀:**記金額,不記品項**)。一次退款登記一列。金額 = 單一欄 refund_amount(只有 > 0、**無上界** —— 拍板⑤ DB 不做防超退)。冪等鍵 = bank_refund_id;rec_trade_id = 所退 TapPay 交易的快照,INSERT 時綁定該訂單、之後不可變。金額欄與身分/稽核欄一經寫入不可 UPDATE;結案二欄 write-once 且結案必須帶 tappay_refund_id;兩表皆禁止 DELETE/TRUNCATE;order_refund_items 已凍結(無寫入端)。🔴 **真相來源是 TapPay 不是本帳本** —— Sean 直接在 Portal 退款時 PCM 全程未參與、本帳本毫不知情;本表守的只是「我們自己的紀錄不會寫錯/被改/被抹掉」。🔴 **轉 failed 前必先用 Record API 對帳**,否則剩餘可退額回升會導致同一筆錢退兩次(拍板⑤ 的 TapPay 側防護不涵蓋這條)。';

COMMENT ON TABLE public.order_refund_items IS
  'M-3 RF2a 退款明細 —— 🔴 **2026-08-01 A7c 起已凍結,無任何寫入端**(Sean 拍板③「不追品項」/ Q1=A 帳本改記金額)。保留原因:既有結構、正式站 0 列、且被 A7b-M 的 order_refund_job_items 引用為形狀樣板。禁 INSERT/UPDATE(a7c_refund_items_frozen)、禁 DELETE(a7c_ledger_delete_forbidden)、禁 TRUNCATE(既有)。🔴 原 COMMENT 稱跨次累積超退的防線在「RF2b」—— **該線已於 2026-08-01 換路停止,那道防線不存在也不會做**。若要恢復品項層追蹤,必須另開 migration 並重新設計不變式。';

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- rollback(forward-only;需另開 migration。🔴 改形狀是**破壞性**的:四個欄位與兩支
-- 一致性 trigger 被砍掉,rollback 只能重建結構、**無法還原資料**——本片的前置斷言
-- 要求兩張表為空正是為了讓這件事在 apply 當下不可能造成資料損失):
--   DROP TRIGGER IF EXISTS order_refund_items_a7c_frozen_biu       ON public.order_refund_items;
--   DROP TRIGGER IF EXISTS order_refund_items_a7c_block_delete_bd  ON public.order_refund_items;
--   DROP TRIGGER IF EXISTS order_refunds_a7c_block_delete_bd       ON public.order_refunds;
--   DROP TRIGGER IF EXISTS order_refunds_a7c_immutable_guard_bu    ON public.order_refunds;
--   DROP TRIGGER IF EXISTS order_refunds_a7c_insert_guard_bi       ON public.order_refunds;
--   DROP FUNCTION IF EXISTS public.pcm_a7c_refund_items_frozen();
--   DROP FUNCTION IF EXISTS public.pcm_a7c_refund_block_delete();
--   DROP FUNCTION IF EXISTS public.pcm_a7c_refund_immutable_guard();
--   DROP FUNCTION IF EXISTS public.pcm_a7c_refund_insert_guard();
--   DROP FUNCTION IF EXISTS public.pcm_order_refundable_remaining(uuid);
--   ALTER TABLE public.order_refunds DROP COLUMN IF EXISTS rec_trade_id;
--   -- 之後若真要退回品項形狀,需重建四欄 + 兩條等式 CHECK + 兩支一致性 trigger 與其函式
--   -- (逐字來源 = 20260725130100:90-131、:185-274)。
-- ⚠️ 本檔**不冪等**(零 IF NOT EXISTS,刻意)⇒ 重放會在第一句 DROP CONSTRAINT 失敗並整支
--    回滾,不會留下半套用狀態;§0 的前置斷言也會先擋下。
-- ────────────────────────────────────────────────────────────────────────────
