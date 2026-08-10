-- ============================================================
-- M-4b 生命週期 L5b-0:讓路入帳鐵律 — 被讓路的 attempt 永不准被認列成收款(三道閘)
-- ============================================================
-- 真權威:docs/specs/2026-08-10-l5b-0-supersede-charge-reject-plan.md(v6;codex 關卡1 R1/R2 + Fable R3
--          三輪對抗審查,R3 複核 PASS 零 must-fix)。母 plan:docs/specs/2026-08-10-l5b-compensation-refund-plan.md。
--
-- 🔴 拍板(memory project_l5b0-and-op5-five-decisions):
--   ① Sean 2026-08-10 Q1=A:`mark_charge_attempt_charged` 原子拒絕 superseded ——
--      「被讓路的 attempt 永不准確認成收款、唯一出口=退款」。B 案(10 個呼叫端各自加閘)否決。
--   ② Sean 同日 §1-OPEN=A:**閘同時畫進 `confirm_order_payment`** —— 因為 ① 那支**擋不住**拍板要的事:
--      非 3DS 的 confirmPayment 在 markCharged 失敗時**刻意續走**(confirm-payment.ts:107-130 逐字),
--      下一步就把舊單標 paid。範圍升級(動第二支已上線金流 RPC)Sean 已批。
--   ③ 知情代價 Sean 拍 A 認列:被讓路的錢晚到入帳時,原本會自動建的雙扣 anomaly 列(20260624120005:128-152)
--      不再建立 ⇒ 告警的 open_count 對這族不再亮。**這不是訊號消失,但兩個階段的訊號不同,別混講**:
--        · **本片(-m)上線後、L5b-0-s(甲)之前**:靠同一支聚合的 `released_stuck_count`,
--          它要 `released_manual_review_at`(released 滿 12h 才寫)⇒ **延遲約 12h**。
--        · **-s(甲)之後**:被讓路那族回到 ceiling/manual 閘,約 68 分鐘後進 `attempt_manual_review_count`。
--      ⚠️ 兩者都只說「**進得了聚合計數**」;通知真的送不送得出去另有前提(env 已查=true,cron 未驗,plan §8-2)。
--      gap 期間值班查詢寫在 plan §4,**不加 status 條件**
--      (close_released_attempt 會把它翻 failed,任何 status 過濾都會漏掉結案後才發現的讓路款)。
--
-- 🔴 為什麼是**三道**閘(守門畫在不變量成立的面,不是「看到實例的那個檔」):
--   閘一 mark_charge_attempt_charged           = 麵包屑(拍板逐字指定)
--   閘二 mark_charge_attempt_charged_fallback  = 備軌;它只擋 status='pending',對 **pending+superseded** 無守門,
--                                                而「superseded ⇒ 必為 released」是寫入端自律、schema 沒強制
--   閘三 confirm_order_payment                 = **錢的歸屬**;閘一擋不住的那條路由它擋
--   ⇒ 三道**必須同一支 migration、不可分批 apply**:只上閘一二的中間態 = confirm 那個洞原封不動 = 比不做更差。
--
-- ⚠️ **能力天花板(誠實版,不做絕對宣稱)**:本片保證的準確說法是
--   **「經由這三支 RPC 的路徑不會認列讓路款」**,不是 DB 全域不變量。
--   繞得過的:owner/postgres 直接 UPDATE、未來新增的 SECDEF 函式、psql 手動修資料。
--   失效條件:出現第四支會寫 payment_charge_attempts.status='charged' 或 orders.payment_status='paid' 的物件。
--
-- 🔴 零漂移:三支各自以**活本體**為 pre-image 逐字沿用(用 awk 從來源 migration 抽取、非手抄),
--   本片只加「閘」與 SELECT 擴欄、換 COMMENT;其餘(rec 形狀驗 / 雙鍵 + FOR UPDATE 序列化 / charged 同 rec 冪等 /
--   GET DIAGNOSTICS row_count 守 / genesis 區塊 / A8c2 取消守門 / OP3 card 腿與其兩道具名守門 /
--   unique_violation handler / PF-E 通用訊息 / SECDEF + search_path='' / 全識別子 schema-qualified)**逐字不動**。
--   **ACL 一律不改**(閘一/閘三 = payment_confirmer;閘二 = authenticated)。
--   pre-image 出處:閘一 20260624120005:64-161 / 閘二 20260612150000:351-419 / 閘三 20260810160000:328-498。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**;apply 由主視窗執行、Sean 批。
--   apply **前置**:重數 `SELECT count(*) FROM public.payment_charge_attempts
--   WHERE superseded_at IS NOT NULL AND status='charged';`(2026-08-10 17:5x 實數=0,**時點觀察**)。
--   非零 ⇒ 那些是已被認列成收款的讓路款,處置要先講好,**不得靠本片默默改行為**。
--   apply 後:read-back 驗(plan §5.1 十六格)→ 才動任何應用層。
-- Rollback(Supabase forward-only、逆序手動):見檔尾;🔴 CREATE OR REPLACE **不還原 COMMENT**,三支各要配 COMMENT ON。
-- ============================================================


-- 🔴 關卡2 R2 must-fix:本檔原本**沒有包交易、也沒有三道 timeout** —— 與 repo 既有慣例不符
--    (OP3 20260810160000:143-149 / OP2b 20260810130000:145-151 都是 BEGIN + 三 timeout + COMMIT)。
--    autocommit 之下若第三支 CREATE 或尾端 assert 失敗,前兩支**已經生效**而 migration 未記帳
--    ⇒ 正式庫落在「閘一二在、閘三不在」那個中間態,正是檔頭說的「比不做更差」。全綠 provision 測不到這條路。
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';


-- ── 0. 前置閘(fail-closed):pre-image 沒漂移才准覆蓋 ──────────────────
-- 🔴 為什麼要這道:本片用 CREATE OR REPLACE 覆蓋三支**已上線**的函式。若有人在我取 pre-image 之後
--    改過它們,本片會**靜默把那個改動倒掉**。⇒ 先驗每支 live 定義的 md5 與 pre-image 相符,不符就停下人工對齊。
DO $l5b0_preflight$
DECLARE
  v_def text; v_code text; v_md5 text;
  -- pre-image md5(**本機 PG17.10 Homebrew** 拋棄式叢集量得,2026-08-10;來源=各自的活本體 migration)
  -- 🔴 這三顆綁 `pg_get_functiondef` 的輸出格式,而那是**伺服器版本相依**的:
  --    對不上時先 `SHOW server_version;` 比對大版本,再判「是格式差異還是行為差異」——
  --    **格式差異可以重算常數;行為差異一律停下**(那代表有人改過函式,不是環境問題)。
  c_md5_g1 constant text := '7334ef0e2ee7f89a093bd8a7bda98828';  -- 20260624120005:64-161
  c_md5_g2 constant text := '1eeab1094efa6049859d5e3cec84416b';  -- 20260612150000:351-419
  c_md5_g3 constant text := '8d535491b7922b56dca09bdf6a3ff821';  -- 20260810160000:328-498
BEGIN
  -- superseded_at 欄(L5a-M 20260809230000:109)必須存在,否則三道閘的述詞根本編譯不過
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.payment_charge_attempts'::regclass
       AND attname = 'superseded_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'L5b-0 前置閘:payment_charge_attempts.superseded_at 不存在 ⇒ L5a-M 未 apply,停下';
  END IF;

  -- 🔴🔴 **關卡2 must-fix 1**:第一版只驗「幾個特徵錨還在」——**那證不了 pre-image 沒漂移**。
  --    失敗情境逐字:線上被加了一支 hotfix、而我挑的那幾個舊錨剛好都還在 ⇒ 前置閘照過 ⇒ hotfix 被靜默蓋掉。
  --    ⇒ 改成**釘三支 live 定義的完整 md5**(形制照 A8c1 20260804120000:58 的既有先例)。
  -- ⚠️ **誠實邊界(apply 前必須知道)**:三顆 md5 是在**本機 PG17(Homebrew)拋棄式叢集**量的,
  --    **沒有對正式庫驗過**。pg_get_functiondef 的輸出理論上可能因環境而有格式差異 ⇒
  --    若正式庫格式不同,本閘會**擋下 apply**(fail-closed、方向正確),但那是白跑一趟。
  --    ⇒ 錯誤訊息一律把**實際 md5 印出來**:對齊只要把印出來的值貼回來、並確認差異純為格式(非行為)。
  v_md5 := md5(pg_get_functiondef('public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure));
  IF v_md5 <> c_md5_g1 THEN
    RAISE EXCEPTION 'L5b-0 前置閘:mark_charge_attempt_charged 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。⇒ 有人在我取 pre-image 之後改過它,'
                    '本片若照跑會**靜默把那個改動蓋掉**。停下人工對齊(先 diff 兩版定義再決定)', v_md5, c_md5_g1;
  END IF;

  v_md5 := md5(pg_get_functiondef('public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure));
  IF v_md5 <> c_md5_g2 THEN
    RAISE EXCEPTION 'L5b-0 前置閘:mark_charge_attempt_charged_fallback 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。停下人工對齊', v_md5, c_md5_g2;
  END IF;

  v_md5 := md5(pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure));
  IF v_md5 <> c_md5_g3 THEN
    RAISE EXCEPTION 'L5b-0 前置閘:confirm_order_payment 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。⚠️ 這支今天才被 OP3(20260810160000)改過,'
                    '若又有人動它,本片會蓋掉 card 腿或 A8c2 守門。停下人工對齊', v_md5, c_md5_g3;
  END IF;

  -- 🔴 關卡2 R2 nit(字面 vs 事實):原註解寫「md5 不符時供診斷」是**假的** ——
  --    md5 不符在上面就 RAISE 了,根本走不到這裡。這段錨真正的作用只有一個:
  --    **md5 相符但特徵錨不見** ⇒ 代表我寫死的 md5 常數本身就抄錯了。註解照這個事實寫。
  v_def  := pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure);
  v_code := pg_catalog.regexp_replace(v_def, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  IF pg_catalog.strpos(v_code, 'INSERT INTO public.order_payments') = 0        -- OP3 card 腿
     OR pg_catalog.strpos(v_code, 'public.order_cancellations') = 0            -- A8c2 取消守門
     OR pg_catalog.strpos(v_code, 'P8C01') = 0 THEN                            -- A8c2 隔離閘
    RAISE EXCEPTION 'L5b-0 前置閘:confirm_order_payment 的 md5 相符但特徵錨不見(OP3 card 腿 / A8c2 守門 / 隔離閘)'
                    ' ⇒ 這代表 pre-image 常數本身就是錯的,不要改 md5 常數,回頭查 pre-image 出處';
  END IF;
END
$l5b0_preflight$;


-- ── 1. 閘一 · 主軌 mark_charge_attempt_charged(pre-image = 20260624120005:64-161)──
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

COMMENT ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) IS
  'M-3 3DS R1b1c + M-4b L5b-0 PF-X1 麵包屑主軌。🔴 **L5b-0 讓路入帳鐵律(閘一)**:superseded_at 非 NULL(=L5a-1 判定讓路、客人已改走新單)⇒ **一律 RAISE、永不轉 charged**;那筆錢的唯一出口是退款(Sean 2026-08-10 拍板 A)。閘位在 charged 冪等分支**之前**(該分支的 RETURN 對上游是成功語意、會讓 settlePaid 續呼 confirm)。⚠️ 本閘只是縱深,錢的歸屬由 confirm_order_payment 的同族閘(L5b-0 閘三)守;且**繞得過 owner 直寫**(非 DB 全域不變量)。以下為 R1b1c 既有行為、逐字不動:status IN (pending,released)→charged + rec_trade_id;released = late success 對帳收斂 → 同交易建 open anomaly(payment_double_charge_anomalies、ON CONFLICT old_attempt_id DO NOTHING、所有 NOT NULL 欄齊填、缺則 RAISE fail-closed;refund_target=舊 attempt rec、amount=orders.total integer);基線雙鍵驗 + FOR UPDATE + charged 同 rec 冪等 no-op + 跨單重複 rec 通用 RAISE。只 payment_confirmer 可呼(ACL 沿用基線、本片不改)。';


-- ── 2. 閘二 · 備軌 mark_charge_attempt_charged_fallback(pre-image = 20260612150000:351-419)──
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

COMMENT ON FUNCTION public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid) IS
  'M-3-S2-d + M-4b L5b-0 PF-X1 麵包屑備軌(第二 transport、authenticated PostgREST)。🔴 **L5b-0 讓路入帳鐵律(閘二)**:superseded_at 非 NULL ⇒ 一律 RAISE。**備軌為什麼也要**:它的轉移閘只擋 status=''pending'',對 **pending+superseded** 完全沒守門;而「superseded ⇒ 必為 released」是**寫入端(L5a-1)自律、schema 沒強制**(L5a-M 五條 CHECK 沒有這條)⇒ 不得把不變量押在另一支 RPC 的實作上。閘位在 token/歸屬兩道護欄**之後**(先認身分再談業務規則)。既有三重護欄逐字不動:① token hash 比對 ② auth.uid() 歸屬 ③ 僅 pending→charged 緊縮轉移、永不釋鎖/標 failed;charged 同 rec 冪等 no-op。token 明文只在 server 記憶體。ACL 沿用基線(authenticated)、本片不改。';


-- ── 3. 閘三 · confirm_order_payment(pre-image = 20260810160000:328-498)──
--    🔴 這一支才是「錢的歸屬」那道閘 —— 也是本片範圍升級的理由(§1-OPEN Sean 拍 A)。
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


-- ── 4. 結構 assert(fail-closed):三道閘真的在 code 裡、位置對、ACL 沒被本片動到 ──
-- 🔴 全部對「剝掉行註解之後的 code」比對(OP3 20260810160000:190-193 教訓:pg_get_functiondef 含註解
--    ⇒ 把 code 刪掉、字面留在註解裡就能騙過存在性錨)。**位置錨也一樣**,否則註解位置會冒充 code 位置。
DO $l5b0_asserts$
DECLARE v_code text; v_gate integer; v_idem integer; v_who text; v_acl text;
BEGIN
  -- 閘一:述詞在 code 裡,且在 charged 冪等分支之前
  v_code := pg_catalog.regexp_replace(
              pg_get_functiondef('public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure),
              '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  -- 🔴 關卡2 must-fix 2:第一版只剝行註解、**沒剝塊註解** ⇒ `/* … */` 裡的字面照樣能冒充 code。
  v_code := pg_catalog.regexp_replace(v_code, '/\*.*?\*/', '', 'gs');
  v_gate := pg_catalog.strpos(v_code, 'v_row.superseded_at IS NOT NULL');
  v_idem := pg_catalog.strpos(v_code, 'IF v_row.status = ''charged'' THEN');
  IF v_gate = 0 THEN RAISE EXCEPTION 'L5b-0 assert:閘一述詞不在 code 裡'; END IF;
  IF v_idem = 0 THEN RAISE EXCEPTION 'L5b-0 assert:閘一找不到 charged 冪等分支(pre-image 漂移?)'; END IF;
  IF v_gate > v_idem THEN
    RAISE EXCEPTION 'L5b-0 assert:閘一位置錯 —— 閘(%)排在 charged 冪等分支(%)之後,'
                    '該分支會提前 RETURN 成功、等於沒擋', v_gate, v_idem;
  END IF;
  -- 閘一的 SELECT 必須真的把 superseded_at 讀進來(否則述詞讀到的是舊 record 的欄、編譯期不報)
  IF pg_catalog.strpos(v_code, 'rec_trade_id, released_at, superseded_at') = 0 THEN
    RAISE EXCEPTION 'L5b-0 assert:閘一的 SELECT 沒有擴 superseded_at 欄';
  END IF;

  -- 閘二
  v_code := pg_catalog.regexp_replace(
              pg_get_functiondef('public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure),
              '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  -- 🔴 關卡2 must-fix 2:第一版只剝行註解、**沒剝塊註解** ⇒ `/* … */` 裡的字面照樣能冒充 code。
  v_code := pg_catalog.regexp_replace(v_code, '/\*.*?\*/', '', 'gs');
  v_gate := pg_catalog.strpos(v_code, 'v_row.superseded_at IS NOT NULL');
  v_idem := pg_catalog.strpos(v_code, 'IF v_row.status = ''charged'' THEN');
  IF v_gate = 0 OR pg_catalog.strpos(v_code, 'fallback_token_hash, superseded_at') = 0 THEN
    RAISE EXCEPTION 'L5b-0 assert:閘二述詞或 SELECT 擴欄不在 code 裡';
  END IF;
  -- 🔴 關卡2 must-fix 2:第一版**閘二完全沒驗位置** —— 把真閘搬到冪等 RETURN 之後、
  --    前面留一行同字串,存在性錨照過而閘實際失效。三支都要有位置錨,不能只有兩支。
  IF v_idem = 0 THEN RAISE EXCEPTION 'L5b-0 assert:閘二找不到 charged 冪等分支(pre-image 漂移?)'; END IF;
  IF v_gate > v_idem THEN
    RAISE EXCEPTION 'L5b-0 assert:閘二位置錯 —— 閘(%)排在 charged 冪等分支(%)之後,等於沒擋', v_gate, v_idem;
  END IF;

  -- 閘三:述詞在 code 裡、在 paid 冪等樹之前;且 status 那條**必須在**(少了它會擋死 L5a-2 重付)
  v_code := pg_catalog.regexp_replace(
              pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure),
              '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  -- 🔴 關卡2 must-fix 2:第一版只剝行註解、**沒剝塊註解** ⇒ `/* … */` 裡的字面照樣能冒充 code。
  v_code := pg_catalog.regexp_replace(v_code, '/\*.*?\*/', '', 'gs');
  v_gate := pg_catalog.strpos(v_code, 'a.superseded_at IS NOT NULL');
  v_idem := pg_catalog.strpos(v_code, 'IF v_order.payment_status = ''paid''::public.payment_status THEN');
  IF v_gate = 0 THEN RAISE EXCEPTION 'L5b-0 assert:閘三述詞不在 code 裡'; END IF;
  IF v_idem = 0 THEN RAISE EXCEPTION 'L5b-0 assert:閘三找不到 paid 冪等樹(pre-image 漂移?)'; END IF;
  IF v_gate > v_idem THEN
    RAISE EXCEPTION 'L5b-0 assert:閘三位置錯 —— 閘(%)排在 paid 冪等樹(%)之後,'
                    '冪等樹的提前 RETURN 也是成功、等於沒擋', v_gate, v_idem;
  END IF;
  IF pg_catalog.strpos(v_code, 'a.status IN (''pending'', ''charged'', ''released'')') = 0 THEN
    RAISE EXCEPTION 'L5b-0 assert:閘三少了 status 述詞 ⇒ 曾經有過讓路 attempt 的訂單會**永遠**'
                    '不能再被確認收款(含客人日後合法重付 L5a-2)。這條不可省';
  END IF;

  -- ── ACL:本片一行都不改權限 ──────────────────────────────
  -- 🔴 關卡2 must-fix 3:第一版是**點名式**檢查(只問 anon/service_role 有沒有長出來)——
  --    那是黑名單,對「清單外的角色」全盲。失敗情境逐字:`authenticated` 若已被誤授
  --    `confirm_order_payment`,CREATE OR REPLACE 會**原封保留**那個授權,而第一版照過。
  --    ⇒ 改成 **allowlist**:用 aclexplode 攤平,斷言「**非 owner 的 grantee 集合**恰等於期望」。
  -- ⚠️ 刻意排除 owner:owner 在不同環境不必然叫 postgres(本機=postgres、Supabase 亦然但不押它),
  --    把 owner 算進集合會讓本斷言變成環境相依 ⇒ 只釘「除 owner 外還有誰」。
  -- 🔴🔴 **關卡2 R2 must-fix**:上一版用 `LEFT JOIN pg_roles` 取 grantee 名字 ——
  --    **`PUBLIC` 的 grantee 是 oid 0**,join 不到任何 pg_roles 列 ⇒ rolname 為 NULL
  --    ⇒ `NULL || ':EXECUTE'` = NULL ⇒ **被 string_agg 直接忽略**。
  --    失敗情境逐字:有人對這三支之一下了**顯式** `GRANT EXECUTE TO PUBLIC`(全世界可呼金流 RPC),
  --    集合字串仍會聚合成期望值、本斷言**照過**。⇒ 改用 CASE 把 grantee=0 顯名成 'PUBLIC'。
  --    同時把 `is_grantable`(WITH GRANT OPTION)納入字面 —— 能轉授的權限與不能轉授的不是同一件事。
  FOR v_who, v_acl IN
    SELECT p.oid::regprocedure::text,
           COALESCE(string_agg(DISTINCT
                      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                      || ':' || a.privilege_type
                      || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END),
                      ',' ORDER BY
                      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                      || ':' || a.privilege_type
                      || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END)), '')
      FROM pg_catalog.pg_proc p
      LEFT JOIN LATERAL pg_catalog.aclexplode(p.proacl) a ON a.grantee <> p.proowner
      LEFT JOIN pg_catalog.pg_roles g ON g.oid = a.grantee
     WHERE p.oid IN ('public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure,
                     'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure,
                     'public.confirm_order_payment(uuid,integer,text)'::regprocedure)
     GROUP BY p.oid
  LOOP
    -- 🔴 R3 nit:原本用 `LIKE 'mark_charge_attempt_charged_fallback%'` ——
    --    `mark_charge_attempt_charged` 本身是它的**前綴**,分流靠「先判 fallback」的順序碰運氣;
    --    未來多一支同前綴函式就會靜默落進 ELSE、被拿錯期望值檢查。改精確比對函式名。
    IF v_who LIKE 'mark_charge_attempt_charged_fallback(%' THEN
      IF v_acl <> 'authenticated:EXECUTE' THEN
        RAISE EXCEPTION 'L5b-0 assert:% 的非 owner grantee 集合=[%],期望恰 [authenticated:EXECUTE]', v_who, v_acl;
      END IF;
    ELSE
      IF v_acl <> 'payment_confirmer:EXECUTE' THEN
        RAISE EXCEPTION 'L5b-0 assert:% 的非 owner grantee 集合=[%],期望恰 [payment_confirmer:EXECUTE]', v_who, v_acl;
      END IF;
    END IF;
  END LOOP;
  -- 🔴🔴 **post-image prosrc 指紋(關卡2 R2 must-fix;我上一輪拒絕的理由被實例打穿)**
  --    上一輪我主張「位置錨夠了、post-image 指紋只是對自己的產出再量一次」。**那個理由不成立** ——
  --    審查者給了可構造的反例:把閘一改成 `superseded_at IS NOT NULL AND status <> 'charged'`,
  --    字串錨在、位置錨也在、三格煙霧測全綠,但 **legacy `charged`+superseded 會走冪等分支成功** ⇒ 閘破而全綠。
  --    ⇒ 位置錨管得住「閘搬去哪」,管不住「閘的述詞被加料」。補指紋。
  -- 🔴 用 `prosrc` **不用** `pg_get_functiondef`:prosrc 是 $fn$…$fn$ 之間的**檔內字面**、跨環境穩定;
  --    functiondef 由伺服器重組(前置閘那三顆是它,因此才有環境格式風險)。兩者的取捨不同,不要混用。
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure))
     <> '13dfcc0a3c7f8e35b53063ca9babf8e5' THEN
    RAISE EXCEPTION 'L5b-0 assert:閘一 post-image prosrc 指紋不符 ⇒ 本檔的函式本體被改過(述詞加料/搬位置/其他)';
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure))
     <> 'ca9a7593ca05b2991d295ce93be692f4' THEN
    RAISE EXCEPTION 'L5b-0 assert:閘二 post-image prosrc 指紋不符';
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.confirm_order_payment(uuid,integer,text)'::regprocedure))
     <> '184204e35edb0dba1b6d4d0909136f3c' THEN
    RAISE EXCEPTION 'L5b-0 assert:閘三 post-image prosrc 指紋不符';
  END IF;

  -- proacl 為 NULL = 「預設權限」(PUBLIC 可 EXECUTE)⇒ 上面的 string_agg 會是空字串而不是漏掉,
  -- 但空字串在 NULL proacl 與「有 acl 但只有 owner」兩種情況下同形 ⇒ 另外把 NULL 釘掉。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure,
                     'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure,
                     'public.confirm_order_payment(uuid,integer,text)'::regprocedure)
       AND p.proacl IS NULL
  ) THEN
    RAISE EXCEPTION 'L5b-0 assert:三支之一的 proacl 是 NULL(=PUBLIC 預設可 EXECUTE)⇒ REVOKE 不見了';
  END IF;
END
$l5b0_asserts$;


COMMIT;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行)
-- 🔴 三支都要「函式本體 + COMMENT」兩件一起還原 —— `CREATE OR REPLACE FUNCTION` **不還原 COMMENT**,
--    只換本體會留下一段描述著已不存在行為的 COMMENT(字面 vs 事實)。
--   1. mark_charge_attempt_charged          → 回 20260624120005:64-161 全文 + COMMENT 回 20260804120000:212 字面
--   2. mark_charge_attempt_charged_fallback → 回 20260612150000:351-419 全文 + COMMENT 回 20260612150000:421 字面
--   3. confirm_order_payment                → 回 20260810160000:328-498 全文 + COMMENT 回 20260810160000:501-509 字面
--      (🔴 關卡2 nit:先前誤寫 :174 —— 那是我抽取片段裡的相對位移,不是檔案絕對行號;照 :174 會落到無關區塊)
-- 🔴 rollback 會讓被讓路的 attempt 恢復「可入帳」⇒ **必須連 plan §4 的值班查詢一起恢復**,否則兩邊都沒人看。
-- 🔴 rollback 後要跑一次反向 read-back(證明舊行為真的回來了,不是只換了函式本文)。
-- ⚠️ 已由本片擋下而未入帳的錢**不會**因 rollback 自動補記 —— 那些走 plan §4 的值班查詢人工處理。
-- ============================================================
