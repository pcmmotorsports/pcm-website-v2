-- 2026-09-06-card-success-supersede-ROLLBACK.sql
-- ⟦b4-CARDPENDINGWINDOW⟧ 的還原 —— 把三支刷卡成功入口換回 20260810170000 那一版。
--
-- 🟢 **這是真的 SQL, 不是註解。整支貼上去就會跑。**
--
-- ══ 🔴🔴 災難當天先讀這一段 ═══════════════════════════════════════════════
-- ## 步驟 0:這一片的「止血」就是本檔本身
-- 🔴 與逾期那片不同:**本片不是排程觸發的**, 它在**客人刷卡成功那一刻**跑
--    ⇒ 沒有 `cron.unschedule` 可以按。**要止血就是把這三支換回去**, 也就是貼本檔。
--
-- ## 步驟 1:先看損害範圍(唯讀, 不改任何東西)
-- ```
-- SELECT payment_channel, count(*), min(cancelled_at), max(cancelled_at)
--   FROM public.orders
--  WHERE cancelled_reason = 'superseded_by_card'
--    AND cancelled_at > pg_catalog.now() - interval '6 hours'
--  GROUP BY payment_channel ORDER BY 2 DESC;
-- ```
-- 🛑 **注意 `superseded_by_card` 這個理由【不是本片獨有】** —— `begin_charge_attempt`
--    (`20260904050000`)本來就會寫它。⇒ 📌 **看到這個理由不等於是本片造成的。**
--    要分辨:本片取消的那些, 它們的兄弟單在**同一時刻**才剛 charged/paid;
--    而 `begin_charge_attempt` 那條是在**刷卡開始**那一刻。分不出來就先看時間分佈。
--
-- ## 步驟 2:🛑 **本檔【不會】把已經被取消的訂單改回來**
--    那需要人決定(客人可能已經收到「訂單已取消」的信)。**不要自己 UPDATE cancelled_at = NULL。**
--
-- ## 步驟 3:前置閘擋住你的時候
-- ✅ **逃生口(照這個順序, 一步都不能少)**:
-- ```
-- ROLLBACK;                          ← 🔴 codex R1 #7:上一發被前置閘擋下時, 這個 session 的交易
--                                        已經是 aborted 狀態 ⇒ 不先結束它, 下一句 SET 會直接失敗
--                                        (25P02 current transaction is aborted)。
-- SET pcm.rollback_force = '1';
-- ```
--    然後在**同一個 session** 貼本檔 ⇒ 前置閘印 WARNING 並放行。
-- 🛑 **這個逃生口的射程(codex R1 #8 訂正第一版的宣稱)**:它**只跳過 md5 比對**。
--    ⛔ ~~「前置閘擋住就 force」~~ —— **同名多載數不符那一格【不跳過】**,
--    因為那一格代表「我不知道要換哪一支」, 硬蓋會換錯支。撞到它要人工看過, 不是 force。
-- 🛑 用它之前先把現況抄下來:`SELECT prosrc FROM pg_catalog.pg_proc …`。
-- 🔴🔴 **已知殘留(`-f8` 2026-09-06 裁 Q-cpw1=乙, 不修, 明寫)——`force` 這個開關關不乾淨**:
--    `pcm.rollback_force` 是 **GUC**, 而 **GUC 的變更是交易性的**。
--    本檔在前置閘【讀完當下】就把它清掉 ⇒ **成功那條路是乾淨的**;
--    🛑 而**事故當天最可能的那條路** —— 中途撞 `lock_timeout` / `statement_timeout` ⇒ 整筆回滾
--      ⇒ **那個清除也被回滾掉, force 又回來了**, 而沒有東西會說。
--    ⇒ ✅ **操作紀律**:用完 force 之後, **自己**跑一句
--      `SELECT pg_catalog.set_config('pcm.rollback_force','off',false);` 或直接**換一個連線**。
--    ⇒ 🔵 為什麼不修成 psql 變數(那不受回滾影響):它會把「三行貼上去」的還原變成
--      「照著腳本走」, **在半夜提高操作風險** —— 取捨是刻意的, 不是漏掉。

BEGIN;
-- 🔴 codex R1 #9:止血檔要能【及時失敗】, 不能在事故中無限等鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $rbpre$
DECLARE r record; v_raw text; v_n integer; v_force boolean;
BEGIN
  v_force := coalesce(current_setting('pcm.rollback_force', true), '') = '1';
  -- 🔴 codex R3:**讀完就立刻清掉**, 不要等結尾。
  --    結尾那一句在「中途撞 lock_timeout / statement_timeout」時**跑不到**
  --    ⇒ 同一個 session 會帶著 `force=1` 繼續活著, 而下一次貼還原就會安靜地跳過 md5 那道防線。
  PERFORM pg_catalog.set_config('pcm.rollback_force', 'off', false);
  FOR r IN
    SELECT * FROM (VALUES
      ('mark_charge_attempt_charged',          '13dfcc0a3c7f8e35b53063ca9babf8e5', 'ca2e19c82e3677a4c37f7a33fe6b50c6', 'p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text'),
      ('mark_charge_attempt_charged_fallback', 'ca9a7593ca05b2991d295ce93be692f4', '3cb44e675f2b8f8cbd68482bd5b367c4', 'p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text, p_fallback_token uuid'),
      ('confirm_order_payment',                '184204e35edb0dba1b6d4d0909136f3c', 'bdf6a39b7408d0213b0df833e6073fa5', 'p_order_id uuid, p_amount integer, p_rec_trade_id text')
    ) AS t(fn, old_md5, new_md5, args)
  LOOP
    SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=r.fn;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '還原前置閘①:public.% 有 % 支同名函式(期望 1)⇒ 拒繼續。', r.fn, v_n;
    END IF;
    -- 🔴 codex R2 #7:只按【函式名】數是不夠的 —— 唯一那支若簽章已經被換過,
    --    本檔的 `CREATE OR REPLACE`(簽章寫死在檔面)會**新增一支多載**, 而不是換掉它。
    --    ⇒ 這裡把簽章也釘住;`force` **不跳過這一格**(它跳過的只有 md5)。
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname=r.fn
         AND pg_catalog.pg_get_function_arguments(p.oid) = r.args
    ) THEN
      RAISE EXCEPTION '還原前置閘①b:public.% 的參數列不是預期的那一組 ⇒ 這一貼會【新增一支多載】而不是換掉它, 拒繼續(force 不跳過這一格)。實得 %',
        r.fn, (SELECT pg_catalog.pg_get_function_arguments(p.oid) FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=r.fn);
    END IF;
    SELECT p.prosrc INTO v_raw FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=r.fn;
    IF v_force THEN
      RAISE WARNING '還原前置閘②:pcm.rollback_force=1 ⇒ 跳過版本比對, 直接覆蓋 public.%(現況 md5 = %)。', r.fn, pg_catalog.md5(v_raw);
    ELSIF pg_catalog.md5(v_raw) = r.old_md5 THEN
      RAISE NOTICE '還原前置閘②:public.% 已經是 20260810170000 那一版 ⇒ 同定義覆蓋同定義, 安全。', r.fn;
    ELSIF pg_catalog.md5(v_raw) <> r.new_md5 THEN
      RAISE EXCEPTION '還原前置閘②:public.% 的原始 md5 = %(期望 % = 20260906700000 那一版)⇒ 有人在它之上又改過, 這份還原會把那個改動一起刪掉。要硬蓋 ⇒ 先跑 SET pcm.rollback_force = ''1'';', r.fn, pg_catalog.md5(v_raw), r.new_md5;
    END IF;
  END LOOP;
END
$rbpre$;

-- ── 三支本體:逐字抄自 20260810170000(sed -n '127,234p' / '241,320p' / '328,520p')──
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged(
  p_attempt_id   uuid,
  p_order_id     uuid,
  p_rec_trade_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row             record;
  v_n               integer;
  v_cart_session_id uuid;      -- 🔴 R1b1c genesis:取自 orders、anomaly.cart_session_id NOT NULL 來源
  v_amount          integer;   -- 🔴 R1b1c genesis:取 orders.total(integer 快照、禁浮點)
  v_generic_msg constant text := 'mark_charge_attempt_charged: 付款處理失敗';  -- PF-E
BEGIN
  -- rec 形狀驗(基線逐字不動;TapPay rec_trade_id 英數、上限 64)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;  -- 輸入驗同通用訊息(付款軌 RAISE 全收斂)
  END IF;

  -- 雙鍵驗(attempt_id + order_id 配對)+ FOR UPDATE 序列化雙軌並發重試(基線 WHERE/FOR UPDATE 逐字不動;
  -- 🔴 R1b1c 擴 SELECT 欄位〔order_id / customer_user_id / released_at〕供 genesis 取值;
  --    🔴 L5b-0 再擴 〔superseded_at〕供本片的閘取值。述詞與鎖**兩次都不變**)
  SELECT id, order_id, customer_user_id, status, rec_trade_id, released_at, superseded_at
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴🔴 L5b-0 讓路入帳鐵律(Sean 2026-08-10 拍板 A):被讓路的 attempt **永不准**被認列成收款。
  --    被讓路 = L5a-1 蓋上 superseded_at(20260810010000:261)= 客人已改走新單,這筆錢的唯一出口是**退款**。
  --    位置刻意在「charged 冪等分支之前」:那個分支的 RETURN 對上游是**成功語意**,
  --    settlePaid 會續呼 confirm(settle-charge.ts:437)⇒ 讓它提前成功等於沒擋。
  --    通用訊息(PF-E)、不另給專屬 SQLSTATE:上游 catch 只回 record_unreachable、專屬碼觀測不到(plan §3.4)。
  IF v_row.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 冪等:已 charged 且同 rec → no-op(基線逐字不動;雙軌×重試安全;不刷 updated_at;同 rec 不重建 anomaly)
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;  -- charged 但異 rec = 異常(不覆寫)
  END IF;

  -- 🔴 R1b1c 轉移放寬:pending / released → charged(基線僅 pending;released = late success 對帳收斂)
  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status IN ('pending', 'released');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 R1b1c genesis:released→charged = late success「雙扣明確化」→ 同交易建 open anomaly(§2.6 / §4 R1b1c / PRD §5)
  IF v_row.status = 'released' THEN
    -- cart_session_id + amount 同交易取自 order(orders.total integer 禁浮點;orders.cart_session_id 為主要來源)
    SELECT cart_session_id, total
      INTO v_cart_session_id, v_amount
      FROM public.orders
     WHERE id = p_order_id;

    -- 🔴 所有 NOT NULL 欄齊填;缺則 INSERT not_null_violation RAISE(不被下方 unique_violation handler 攔 → 整交易回滾)
    --    → markCharged 失敗、attempt 維持 released、anomaly 不建 → 寧可不收斂也不漏記雙扣(§7 主訊號、PRD §1.3/§5)。
    -- ON CONFLICT (old_attempt_id) DO NOTHING:冪等(same-rec 重呼 / 並發二次 markCharged 皆不重複建)。
    INSERT INTO public.payment_double_charge_anomalies (
      old_attempt_id,
      old_order_id,
      user_id,
      cart_session_id,
      rec_trade_id,
      refund_target_rec_trade_id,
      released_at,
      charged_at,
      amount,
      status
    )
    VALUES (
      v_row.id,                  -- old_attempt_id
      v_row.order_id,            -- old_order_id
      v_row.customer_user_id,    -- user_id
      v_cart_session_id,         -- cart_session_id(取自 order)
      p_rec_trade_id,            -- rec_trade_id = 本次 released→charged 寫入 old attempt 的 rec
      p_rec_trade_id,            -- refund_target_rec_trade_id = 同上(舊 attempt rec、絕不指向重刷新單)
      v_row.released_at,         -- released_at(R1a3 COALESCE write-once)
      pg_catalog.now(),          -- charged_at
      v_amount,                  -- amount = orders.total(integer 快照)
      'open'                     -- status genesis = open
    )
    ON CONFLICT (old_attempt_id) DO NOTHING;
  END IF;

EXCEPTION
  -- 跨單重複 rec 撞 rec_unique_idx → 通用訊息(PF-E、不洩約束名/rec;基線逐字不動)
  -- 🔴 注意:genesis 之 not_null_violation 非 unique_violation → 不被此攔、向上傳播 → fail-closed(漏記雙扣寧失敗)。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged_fallback(
  p_attempt_id     uuid,
  p_order_id       uuid,
  p_rec_trade_id   text,
  p_fallback_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_uid         uuid := (SELECT auth.uid());
  v_n           integer;
  v_generic_msg constant text := 'mark_charge_attempt_charged_fallback: 付款處理失敗';  -- PF-E(token 對錯不可區分)
BEGIN
  -- rec 形狀驗(同主軌)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 護欄②前置:未登入(無 JWT)直接拒
  IF v_uid IS NULL OR p_fallback_token IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 雙鍵驗 + FOR UPDATE
  SELECT id, status, rec_trade_id, customer_user_id, fallback_token_hash, superseded_at
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 護欄①:token hash 比對(同 helper 單一真相;不符 = 非本 server 流程發出 → 拒)
  IF public.charge_attempt_token_hash(p_fallback_token) <> v_row.fallback_token_hash THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 護欄②:本人歸屬(auth.uid() 對 attempt 反正規化 customer_user_id)
  IF v_uid <> v_row.customer_user_id THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴🔴 L5b-0 讓路入帳鐵律(Sean 2026-08-10 拍板 A):被讓路的 attempt **永不准**被認列成收款。
  --    被讓路 = L5a-1 蓋上 superseded_at(20260810010000:261)= 客人已改走新單,這筆錢的唯一出口是**退款**。
  --    位置刻意在「charged 冪等分支之前」:那個分支的 RETURN 對上游是**成功語意**,
  --    settlePaid 會續呼 confirm(settle-charge.ts:437)⇒ 讓它提前成功等於沒擋。
  --    通用訊息(PF-E)、不另給專屬 SQLSTATE:上游 catch 只回 record_unreachable、專屬碼觀測不到(plan §3.4)。
  --    🔴 備軌為什麼也要:它只擋 status='pending'(本檔基線),對 **pending+superseded** 完全沒守門;
  --       而「superseded ⇒ 必為 released」是**寫入端自律、schema 沒強制**(L5a-M 五條 CHECK 沒有這條)。
  IF v_row.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 護欄③:僅 pending→charged;charged 同 rec 冪等 no-op;其餘(failed / charged 異 rec)拒
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id     uuid,
  p_amount       integer,
  p_rec_trade_id text
)
RETURNS jsonb                 -- {confirmed boolean, idempotent boolean};禁回 total/價結構(PF-G)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_n           integer;
  v_generic_msg constant text := 'confirm_order_payment: 付款確認失敗';  -- 🔴 PF-E:業務拒絕單一通用訊息、不洩內部狀態
BEGIN
  -- 🔴 A8c2 隔離閘(fail-closed;A8c1 同款、A2b1 教訓):非 READ COMMITTED 下 FOR UPDATE 等鎖
  --    醒來後快照仍舊、部分取消不動 orders 列 ⇒ EXISTS 看不到已 commit 取消。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'confirm_order_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- ── 輸入驗:rec_trade_id 非空(server 自供參數、非訂單內部狀態 → 可具體)──
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'confirm_order_payment: 交易識別碼缺失';
  END IF;

  -- ── PF-B:FOR UPDATE 鎖臨界區 ──
  SELECT id, total, payment_status, tappay_rec_trade_id, cancelled_at
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  -- ── PF-D(1):訂單不存在 → 拒(通用、不洩存在與否)──
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 A8c2 取消守門(master plan row 35;R8 守門先於取消):存在任何取消紀錄 ⇒ 拒確認。
  --    位置=paid 冪等樹之前:已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功。
  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約);通用訊息=PF-E。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴🔴 L5b-0 閘三(§1-OPEN Sean 拍 A):**這裡才是「錢的歸屬」那道閘**。
  --    閘一/二 擋的是麵包屑;而非 3DS 的 confirmPayment 在 markCharged 失敗時**刻意續走**
  --    (confirm-payment.ts:107-130 逐字「log critical 續走」)⇒ 下一步就是這支 RPC 把舊單標 paid。
  --    位置=A8c2 取消守門之後、paid 冪等樹之前,理由與取消守門同款:
  --    冪等樹的提前 RETURN 也是「成功」,讓它先跑等於沒擋。
  -- 🔴 `status IN (...)` 那條**不可省**:少了它,凡是「曾經有過讓路 attempt」的訂單就**永遠**
  --    不能再被確認收款,包含客人日後合法重付(L5a-2 重付鈕)。
  --    這組 status 與 per-order 鎖 UNIQUE index 的 predicate 同源(20260624120000:62-64)
  --    ⇒ 語意=「**仍持有這張單付款權**的那顆 attempt 是被讓路的」。單一真相、不另立一套。
  --    close_released_attempt 把它翻 failed 之後(20260624120010:121-127)即離開此集合、該單可正常收款。
  -- ⚠️ 能力天花板(plan §3.3):本閘判的是「這張單有沒有活的讓路 attempt」,**不是**「這次的錢
  --    來自哪顆 attempt」。舊 attempt 結案後若有人拿**舊 rec** 呼本 RPC,本閘放行。今天走不到
  --    (兩個呼叫端的 rec 都取自當前 active attempt),失效條件見 plan §8-4。
  IF EXISTS (
    SELECT 1 FROM public.payment_charge_attempts a
     WHERE a.order_id = p_order_id
       AND a.superseded_at IS NOT NULL
       AND a.status IN ('pending', 'charged', 'released')
  ) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(3):paid 且 rec_trade_id+amount 雙等 → no-op 冪等成功(真 RETURN、不 UPDATE、不刷時間戳)──
  -- 🔴 OP3:這棵樹的位置**不得下移到 card 腿之後** —— 它提前 RETURN 正是「同 rec 重放不落第二列」
  --    的唯一機制(重放根本到不了 INSERT)。檔尾順序錨釘住它在 INSERT 之前。
  IF v_order.payment_status = 'paid'::public.payment_status THEN
    IF v_order.tappay_rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id
       AND p_amount IS NOT NULL AND v_order.total = p_amount THEN
      RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true);
    END IF;
    -- PF-D(4):paid 但 rec 或 amount 任一不等(疑重複扣款/竄改)→ 拒
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(4):refunded / partiallyPaid(非 unpaid)→ 拒(同 rec 也不復活成 paid)──
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(5):unpaid 且金額相符 → 翻 paid;金額不符/NULL → 拒(整數比對、不洩 total)──
  IF p_amount IS NULL OR p_amount <> v_order.total THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 `total <= 0` 守門(Fable 實跑抓到;可達性趨零但後果不對稱):
  --    total=0 且 p_amount=0 時上面的相等檢查**會過**,然後 card 腿撞
  --    `order_payments.amount CHECK (amount <> 0)` ⇒ 噴 **raw 23514**,PG 的 DETAIL 會把
  --    **整列值**帶出來(繞過 PF-E 的不洩內部狀態),而 app 層又把非 P0001 標成「可重試」。
  --    ⇒ 收斂成 PF-E 通用訊息;這條**不改任何合法路徑**(合法訂單 total 恆正)。
  IF v_order.total <= 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── cross-order rec_trade_id 重用序列 pre-check(優雅通用訊息;UNIQUE 並發 backstop 見 EXCEPTION)──
  PERFORM 1 FROM public.orders
   WHERE tappay_rec_trade_id = p_rec_trade_id AND id <> p_order_id;
  IF FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-G:翻 paid、僅 5 欄、零 fulfillment_status;WHERE 帶 payment_status='unpaid' 條件式 ──
  UPDATE public.orders
     SET payment_status      = 'paid'::public.payment_status,
         tappay_rec_trade_id = p_rec_trade_id,
         paid_at             = pg_catalog.now(),
         payment_method      = 'tappay',
         updated_at          = pg_catalog.now()
   WHERE id = p_order_id
     AND payment_status = 'unpaid'::public.payment_status;

  -- ── PF-C:row_count 守(防 FORCE RLS 靜默 0 列=收錢沒翻單)──
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ══ 🔴 OP3 card 腿:與翻 paid **同一筆交易**寫收款帳本 ══════════════════════
  -- 🔴 執行期的 actor 守門(檔頭前置閘 ③ 的另一半):`actor` 是 NOT NULL FK 到 staff,
  --    而 `session_user` 記的是**登入角色**。以「沒有對應 staff 列」的角色呼叫本 RPC,
  --    原本會噴一個 raw 23503 並把約束名 `order_payments_actor_fkey` 洩出去,
  --    而現場完全看不出「這是部署設定問題、不是訂單問題」。⇒ 先問一次、給可診斷的訊息。
  -- ⚠️ 這條**刻意不用** PF-E 通用訊息:PF-E 是為了不洩**訂單狀態**;這裡洩的是我方的角色設定,
  --    與客人的訂單無關,而把它壓成「付款確認失敗」會讓一次部署事故變成查不出來的謎。
  -- 🔴🔴 **codex 關卡2 must-fix:第一版只問「有沒有同名 staff 列」,那擋不住錯的身分。**
  --    失敗情境:apply 之後有人給角色 `ops` EXECUTE、而 staff 恰好也有一列 `ops`
  --    ⇒ 舊守門**全綠**,card 腿的 actor 被寫成 `ops`,錢帳上的經手人從此是錯的,
  --      而且每一格斷言都看不出來(列有落、FK 也過)。
  --    ⇒ 守門要釘的是**身分本身**,不是「這個名字在 staff 表裡找得到」。
  -- 🔴 為什麼可以硬釘 `payment_confirmer` 這個字面:本片的 actor 政策就是
  --    「card 腿只由 TapPay 付款確認這條機器軌寫」(Sean 拍 A′),而那條軌的登入角色就是它。
  --    日後若真要多開一條機器軌,那是**新的拍板**,應該同時改這裡與檔頭政策 —— 讓它在這裡紅,
  --    比讓它靜默寫進一個沒人決定過的 actor 好。
  IF session_user <> 'payment_confirmer' THEN
    RAISE EXCEPTION 'confirm_order_payment: 呼叫端的 DB 角色是 [%],不是 payment_confirmer ⇒ 拒絕落 card 腿。'
                    '這是部署設定問題、不是訂單問題:本 RPC 的 actor 記的是 DB session role(非真人),'
                    '正式路徑必須「就是」payment_confirmer 登入,不是繼承它、也不是別的有 EXECUTE 的角色', session_user
      USING ERRCODE = 'P2B36', CONSTRAINT = 'pcm_op3_actor_wrong_role';
  END IF;
  -- 角色對了還要真的有那一列:seed 被刪掉時 FK 會噴 raw 23503(洩約束名且不可診斷)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = session_user) THEN
    RAISE EXCEPTION 'confirm_order_payment: DB 角色 [%] 在 staff 沒有對應列 ⇒ card 腿的 actor 寫不進去。'
                    '這是部署設定問題、不是訂單問題:OP3 seed 的那一列被刪了或沒 apply 到', session_user
      USING ERRCODE = 'P2B36', CONSTRAINT = 'pcm_op3_actor_not_in_staff';
  END IF;

  -- 位置=PF-C 之後、RETURN 之前。放在 PF-C 之後才有意義:翻單沒成功就不該落帳。
  -- · rail='card';`bank_reference` / `request_id` 必須 NULL(OP1 rail_fields 的 card 分支)。
  -- · amount = v_order.total —— **不是 p_amount**。兩者在這一行已被上面的守門證明相等
  --   (`p_amount <> v_order.total` 就 RAISE 了),取 DB 側的值是因為它是**帳本該記的那個事實**,
  --   而 p_amount 是呼叫端送進來的參數。等價但來源不同,選不會被外部影響的那個。
  -- · received_at = pg_catalog.now():理由與代價見檔頭 OP-A11 那段(帳上收款時點=我方確認時點)。
  -- · actor = session_user:見檔頭 actor 那段(DB session role、非真人)。
  -- · 冪等:同 rec 重放走上面的 paid 冪等樹提前 RETURN,到不了這裡;真並發撞
  --   `order_payments_card_idem_uniq` / `order_payments_rec_trade_global_uniq` 由下方既有的
  --   `WHEN unique_violation` handler 收成通用訊息(PF-E)。
  -- 🔴 search_path='' ⇒ 表名與函式名一律 schema-qualified;`session_user` 是**關鍵字不是函式**,
  --    不加 pg_catalog 前綴(加了會 42P01,實跑踩過)。
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (p_order_id, 'card', v_order.total, pg_catalog.now(), p_rec_trade_id, session_user);

  -- 🔴🔴 **PF-C 的第二道(codex 關卡2 must-fix)**:我抄了 UPDATE 那道 row_count 守,
  --    卻沒替自己新增的 INSERT 補同一道。BEFORE INSERT trigger **回 NULL 會把那一列靜默吞掉**
  --    —— INSERT 影響 0 列、**不報任何錯**,函式照樣往下 RETURN 成功,而 orders 已翻成 paid
  --    並隨本交易 commit ⇒ 帳面顯示已收款、收款帳本查無此筆,**正是本片存在的理由本身**,
  --    而且沒有任何守門會叫。
  -- ⚠️ 這條擋的是「靜默 0 列」,不是「INSERT 報錯」—— 後者會直接拋例外、整筆 rollback,本來就安全;
  --    真正危險的是不報錯的那條路。負測 = op3-verify.sh G10(裝一支回 NULL 的 BEFORE INSERT trigger)。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'confirm_order_payment: card 腿落帳 % 列(期望恰 1)⇒ 翻單成功但收款帳本沒收到這筆。'
                    '成因通常是 order_payments 上有 BEFORE INSERT trigger 回了 NULL(靜默吞列)。'
                    '本交易整筆回滾,訂單狀態與錢帳都不會半套', v_n
      USING ERRCODE = 'P2B37', CONSTRAINT = 'pcm_op3_card_leg_row_count';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════

  RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false);

EXCEPTION
  -- 🔴 PF-E:cross-order rec_trade_id 真並發撞 orders.tappay_rec_trade_id UNIQUE → 通用訊息(不洩 raw 23505/約束名)
  -- 🔴 OP3:本 handler 自本片起**多了一個觸發來源** —— card 腿撞 order_payments 的兩道 partial
  --    unique 也會走到這裡(OP3 之前只可能由 orders 那道 UNIQUE 觸發)。行為相同(通用訊息),
  --    但這句話要寫下來,否則下一個人會以為這條 handler 只管 orders。負測=op3-verify.sh G7。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;


-- ── 🔴 COMMENT 也要還原(codex R2 #6)────────────────────────────────────
-- 本片的 forward 換掉了三支的 catalog COMMENT(在結尾加了一句 supersede 副作用)。
-- ⇒ 📌 只還原函式本體而不還原 COMMENT ⇒ **catalog 上會繼續宣稱一個已經被移除的副作用**。
-- 下面三段逐字取自 20260810170000:236-237 / 322-323 / 522-539。
COMMENT ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) IS
  'M-3 3DS R1b1c + M-4b L5b-0 PF-X1 麵包屑主軌。🔴 **L5b-0 讓路入帳鐵律(閘一)**:superseded_at 非 NULL(=L5a-1 判定讓路、客人已改走新單)⇒ **一律 RAISE、永不轉 charged**;那筆錢的唯一出口是退款(Sean 2026-08-10 拍板 A)。閘位在 charged 冪等分支**之前**(該分支的 RETURN 對上游是成功語意、會讓 settlePaid 續呼 confirm)。⚠️ 本閘只是縱深,錢的歸屬由 confirm_order_payment 的同族閘(L5b-0 閘三)守;且**繞得過 owner 直寫**(非 DB 全域不變量)。以下為 R1b1c 既有行為、逐字不動:status IN (pending,released)→charged + rec_trade_id;released = late success 對帳收斂 → 同交易建 open anomaly(payment_double_charge_anomalies、ON CONFLICT old_attempt_id DO NOTHING、所有 NOT NULL 欄齊填、缺則 RAISE fail-closed;refund_target=舊 attempt rec、amount=orders.total integer);基線雙鍵驗 + FOR UPDATE + charged 同 rec 冪等 no-op + 跨單重複 rec 通用 RAISE。只 payment_confirmer 可呼(ACL 沿用基線、本片不改)。';

COMMENT ON FUNCTION public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid) IS
  'M-3-S2-d + M-4b L5b-0 PF-X1 麵包屑備軌(第二 transport、authenticated PostgREST)。🔴 **L5b-0 讓路入帳鐵律(閘二)**:superseded_at 非 NULL ⇒ 一律 RAISE。**備軌為什麼也要**:它的轉移閘只擋 status=''pending'',對 **pending+superseded** 完全沒守門;而「superseded ⇒ 必為 released」是**寫入端(L5a-1)自律、schema 沒強制**(L5a-M 五條 CHECK 沒有這條)⇒ 不得把不變量押在另一支 RPC 的實作上。閘位在 token/歸屬兩道護欄**之後**(先認身分再談業務規則)。既有三重護欄逐字不動:① token hash 比對 ② auth.uid() 歸屬 ③ 僅 pending→charged 緊縮轉移、永不釋鎖/標 failed;charged 同 rec 冪等 no-op。token 明文只在 server 記憶體。ACL 沿用基線(authenticated)、本片不改。';

COMMENT ON FUNCTION public.confirm_order_payment(uuid, integer, text) IS
  'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。'
  '🔴 E10-OP3 card 腿:PF-C 之後、RETURN 之前,**同一筆交易**往 order_payments insert 一列 '
  '(rail=card、amount=orders.total、received_at=now()、rec_trade_id=本次交易號、actor=session_user)⇒ 翻單與落帳同生共死。'
  'actor 記的是 **DB session role 不是真人**(照 3DS 線慣例);正式路徑必須「就是」payment_confirmer 登入,'
  '沒有對應 staff 列時走 P2B36 具名守門(可診斷訊息,刻意不壓成 PF-E 通用訊息 —— 那是部署問題不是訂單問題)。'
  'received_at 記的是**我方確認時點**、不是發卡行授權時點(外部時鐘 OP2a 的 A8 閘擋不到,見 OP1 檔頭 OP-A11);'
  '同 rec 重放由 paid 冪等樹提前 RETURN 擋住、到不了 INSERT ⇒ 不落第二列;'
  '並發撞 card 兩道 partial unique 由 WHEN unique_violation 收成通用訊息。歷史資料的回填是 OP4,不在本片。'
  '🔴 M-4b L5b-0 讓路入帳鐵律(閘三、本片):A8c2 取消守門之後、paid 冪等樹之前 —— 該單只要還有一顆 '
  '**活的**讓路 attempt(superseded_at 非 NULL 且 status IN (pending,charged,released))⇒ 一律拒絕確認收款,'
  '那筆錢的唯一出口是退款(Sean 2026-08-10 拍板 A)。**這一支才是錢的歸屬那道閘** —— 麵包屑那支 '
  '(mark_charge_attempt_charged)擋不住非 3DS 路徑:confirmPayment 在 markCharged 失敗時刻意續走。'
  '🔴 status 那條不可省:少了它,凡曾有過讓路 attempt 的訂單將**永遠**不能再被確認收款(含客人日後合法重付);'
  '該組 status 與 per-order 鎖 index predicate 同源 ⇒ 語意=「仍持有這張單付款權的那顆 attempt 是被讓路的」,'
  'close_released_attempt 翻 failed 後即離開此集合、該單可正常收款。'
  '⚠️ 天花板:本閘判的是「這張單有沒有活的讓路 attempt」,不是「這次的錢來自哪顆 attempt」;'
  '且繞得過 owner 直寫(非 DB 全域不變量)。失效條件見 plan §8。';

-- ── 事後斷言:真的還原了 ────────────────────────────────────────────────
DO $rb$
DECLARE r record; v_raw text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('mark_charge_attempt_charged',          '13dfcc0a3c7f8e35b53063ca9babf8e5'),
      ('mark_charge_attempt_charged_fallback', 'ca9a7593ca05b2991d295ce93be692f4'),
      ('confirm_order_payment',                '184204e35edb0dba1b6d4d0909136f3c')
    ) AS t(fn, old_md5)
  LOOP
    SELECT p.prosrc INTO v_raw FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=r.fn;
    IF pg_catalog.strpos(v_raw, 'SUPERSEDE-BLOCK-BEGIN') > 0 THEN
      RAISE EXCEPTION '還原失敗:public.% 裡的 supersede 區塊還在 ⇒ 這一貼沒生效。', r.fn;
    END IF;
    IF pg_catalog.md5(v_raw) <> r.old_md5 THEN
      RAISE EXCEPTION '還原失敗:public.% 還原後的原始 md5 = %(期望 %)⇒ 貼回去的不是 20260810170000 那一版。',
        r.fn, pg_catalog.md5(v_raw), r.old_md5;
    END IF;
    -- 🔴 codex R2 #7:事後也要數多載, 否則「新增了一支」這種結果會假綠
    IF (SELECT count(*) FROM pg_catalog.pg_proc p2 JOIN pg_catalog.pg_namespace n2 ON n2.oid=p2.pronamespace
         WHERE n2.nspname='public' AND p2.proname=r.fn) <> 1 THEN
      RAISE EXCEPTION '還原失敗:public.% 還原後有多於一支同名函式 ⇒ 這一貼新增了多載。', r.fn;
    END IF;
  END LOOP;
  -- 🔵 這把尺的正對照:同一個 md5 算法對現造字串必須回別的值
  IF pg_catalog.md5('QXRBPROBE5581') = '13dfcc0a3c7f8e35b53063ca9babf8e5' THEN
    RAISE EXCEPTION '還原失敗:md5 對現造字串也回同一個值 ⇒ 這把尺壞了。';
  END IF;
  RAISE NOTICE '[ROLLBACK] 三支都還原成 20260810170000 那一版, supersede 區塊已移除, COMMENT 也換回。';
END
$rb$;

-- 🔵 `pcm.rollback_force` 已在前置閘【讀完當下】就清掉了(codex R3)——
--    這裡不再重複, 留這段字是為了讓搜「rollback_force」的人知道它在哪裡被清的。

COMMIT;
