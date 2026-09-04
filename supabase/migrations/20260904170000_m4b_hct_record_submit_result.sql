-- M-4b · 把新竹的回應寫進 `shipments` 的三欄 + 一道 write-once 守門
-- ⟦ship-HCTAPI⟧ 片 C-1 · 2026-09-04 · 線【後台·列印與出貨文件】`-ship`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 **本支【依賴】`20260904140000`(hct_status 值域加 unknown)。**
--    ⚠️ 而那支**已經在正式庫**(2026-09-04 Sean 貼、線 `-ship` 唯讀複驗過)
--    ⇒ 所以實務上本支可以直接貼;而下面前置閘①會**自己去確認**, 不靠這句話。
--    🛑 **與今天另一支(`-front` 的)沒有順序關係。**
-- ══════════════════════════════════════════════════════════════════════════
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **為什麼 RPC 與守門在【同一支】** —— 這是本檔最重要的一個結構決定
-- ══════════════════════════════════════════════════════════════════════════
--    分兩支會有一段「**寫得進去而沒有守門**」的時間, 而 🛑 **那段時間沒有東西會叫。**
--    ⇒ 🔴 而那段時間的**長度不由我們決定** —— 它是「下一支什麼時候被貼」
--      ⇒ 📌 **一個由別人的行程決定長度的風險窗口, 等於一個沒有上界的窗口。**
--
--    🎯 **而守門為什麼是【現在】才需要**:
--      `hct_request_id` / `hct_raw_response` / `hct_status` 三欄從建表(`20260805170000`)起
--      **一道守門都沒有** —— `frozen_after_ship` 只擋收件三欄、`immutable_guard` 只擋身分四欄、
--      `write_once` 只擋 `shipped_at`(`20260805170100:129/157/177`)。
--      而**今天沒事, 只因為【沒有任何碼在寫它們】**(片 B 只回不寫)。
--      ⇒ 📌 **一個「沒有人在用」的欄位, 它的零缺陷紀錄是【零流量】不是【零風險】。**
--      ⇒ ⇒ **而本支正是那個「有人開始寫它」** ⇒ 🎯 **守門的需求是在【第一個寫入端出現】那一刻誕生的,**
--        **不是在建表那一刻。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 重送 —— 而**新竹那端的語意與我們以為的不一樣**(規格第 8 頁逐字)
-- ══════════════════════════════════════════════════════════════════════════
--    `新竹貨號+訂單編號 -> 當日重複上傳, 視同【更正】資料內容`
--    `訂單編號 -> 同一個 ESDATE 不可重複` · `新竹貨號 -> 100 天不可重複`
--    ⇒ 🎯 **「重送」在新竹那端不是「再試一次」, 是「改掉那張單」。**
--    ⇒ 🔴 而更正要帶**新竹貨號**, 那只有第一次送成功才拿得到
--      ⇒ **在 `unknown` 狀態下我們連「更正」都做不到。**
--
--    ⚠️ **`ESDATE` 我們今天【沒有在送】**(片 A 的 `esdate` 是選填、預設今天)
--    ⇒ 而「同一個 ESDATE 不可重複」表示 **跨日重送是合法的**
--    ⇒ 📌 那是一個**今天用不到、而明天會用到**的性質 —— 寫在這裡, 因為改重送規則的人會打開這支檔。

BEGIN;

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  -- ① 值域必須已經有 unknown(= `20260904140000` 已套)。
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'shipments_hct_status_domain'
     AND conrelid = 'public.shipments'::regclass;
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'unknown') = 0 THEN
    RAISE EXCEPTION
      '前置閘①:hct_status 值域裡沒有 unknown ⇒ 20260904140000 還沒貼。本支會寫入 unknown, 先貼那一支。現況 = %',
      COALESCE(v_def, '(找不到那條 CHECK)');
  END IF;

  -- ② forward-only:本支的 writer 已經在 ⇒ 拒重跑。
  --    🔵 這個訊息比 Postgres 的 `already exists` 好 —— 它說得出「為什麼不讓你跑」。
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:admin_record_hct_submit 已經存在 ⇒ 本檔已套用過, forward-only 拒重跑';
  END IF;

  -- ③ 那張表與三欄必須在(否則我在對一個我沒看過的世界動手)。
  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.shipments ⇒ 這不是我以為的那個世界';
  END IF;
END
$pre$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. write-once 守門:`hct_request_id` 一旦有值就不可再改
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 **它守的是一個【不可回收的動作留下的證據】**:
--    那個 id 代表「我們對新竹送出過一張單」。改掉它 = 把那次送出從紀錄裡抹掉,
--    而**那張單在新竹那邊還在**。
-- 🛑 **而它【不擋】從 NULL 變成有值**(那正是本支的 writer 要做的事),
--    也**不擋 `hct_raw_response` / `hct_status` 跟著更新**
--    ⇒ 因為 `unknown ⇒ 查到貨號 ⇒ 補寫成 submitted` 是一條**合法的路**。
--    ⇒ 📌 **守門要擋的是「改掉一個已經發生的事實」, 不是「補記一個事實」。**
CREATE FUNCTION public.pcm_b2_shipments_hct_request_id_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF OLD.hct_request_id IS NOT NULL
     AND NEW.hct_request_id IS DISTINCT FROM OLD.hct_request_id THEN
    RAISE EXCEPTION
      '新竹請求識別值 write-once,不可改也不可清空(shipment=%)。'
      ' 它代表「我們對新竹送出過一張單」—— 改掉它等於把那次送出從紀錄裡抹掉,'
      ' 而那張單在新竹那邊還在。要更正內容請走新竹的更正流程(帶新竹貨號重送)。',
      OLD.shipment_reference
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_hct_request_id_write_once';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_hct_request_id_write_once()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shipments_hct_request_id_write_once_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_b2_shipments_hct_request_id_write_once();

-- ══════════════════════════════════════════════════════════════════════════
-- 3. writer:把新竹的回應寫進那三欄
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 **重送規則寫在這裡, 不寫在 TS** —— TS 那一層可以被繞過(有人直接呼叫 RPC),
--    而這一層是**每一條路都會經過的地方**。
CREATE FUNCTION public.admin_record_hct_submit(
  p_shipment_reference text,
  p_status             text,
  p_request_id         text,
  p_raw                jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_old_status text;
  v_deleted    timestamptz;
BEGIN
  IF p_status NOT IN ('submitted', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'admin_record_hct_submit:狀態只收 submitted / failed / unknown(收到 %)', p_status;
  END IF;

  SELECT hct_status, deleted_at INTO v_old_status, v_deleted
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_record_hct_submit:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  -- 🔴 **已作廢的箱不得再寫新竹欄位。**
  --    作廢的意思是「這張箱單在我們系統裡撤銷了」, 而**我們對貨運零呼叫**
  --    ⇒ 對它記一筆「送出去了」會讓紀錄與現實各說各話。
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_record_hct_submit:這張出貨單已作廢(%), 不得再寫新竹狀態', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴🔴 **重送規則。而它擋的不是「重複呼叫」, 是【對一個不該再送的世界送出】。**
  --    · submitted ⇒ 已經成立。再送在新竹那端是【更正】, 那是另一個動作。
  --    · unknown   ⇒ 🛑 **絕不自動重送。**「查無」有兩個世界(真的沒進去 / 新竹查詢與建單不同步),
  --      而**我們分不出來** ⇒ 📌 **在分不出來的時候重送, 等於用一個我們沒有的知識**
  --      **去做一個不可回收的動作。** 唯一出路 = 先查(`QueryEDELNO`), 查到才補寫。
  --    ✅ 而 `unknown ⇒ submitted` 是**允許**的 —— 那不是重送, 是**補記一個已經發生的事實**。
  IF v_old_status = 'submitted' THEN
    RAISE EXCEPTION
      'admin_record_hct_submit:這張單已經是 submitted(%), 不得再寫。'
      ' 要改內容 = 新竹那端的【更正】流程(帶新竹貨號重送), 不是再送一次。', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_old_status = 'unknown' AND p_status = 'unknown' THEN
    RAISE EXCEPTION
      'admin_record_hct_submit:這張單已經是 unknown(%), 再寫一次 unknown 不會讓我們更知道。'
      ' 先跑 QueryEDELNO:查到貨號 ⇒ 補寫 submitted;查無 ⇒ 停下來給人看, 不要自動重送。',
      p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.shipments
     SET hct_status       = p_status,
         hct_request_id   = COALESCE(p_request_id, hct_request_id),
         hct_raw_response = p_raw
   WHERE shipment_reference = p_shipment_reference;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_record_hct_submit(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.admin_record_hct_submit(text,text,text,jsonb) IS
  '把新竹 TransData 的回應寫進 shipments 的三欄。重送規則在【這一層】不在 TS ——'
  ' TS 那一層可以被繞過, 而這一層是每一條路都會經過的地方。'
  ' unknown 不得自動重送:查無有兩個世界而我們分不出來。';

-- ── 4. 後置閘 ────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_n int;
  -- 🔴 **本支建的【每一個可授權物件】都要列在這裡, 一個都不能少。**
  --    📌 收權斷言**只檢查你列出來的物件** ⇒ 它防「忘記收權」, **不防「忘記列」**
  --    ⇒ 而漏列的症狀是**這一段安靜地通過**(`scripts/migration-static-checks.sh:556-565` 那道靜態閘
  --      正是為了這個而數兩邊 —— 它今天當場抓到我列了 0 個)。
  v_functions text[] := ARRAY[
    'public.admin_record_hct_submit(text,text,text,jsonb)',
    'public.pcm_b2_shipments_hct_request_id_write_once()'
  ]::text[];
  v_fn text;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '後置閘①:writer 沒有建起來 ⇒ 這一支沒有做到它宣稱的事';
  END IF;

  -- 🔴 後置閘②:**守門與 writer 必須【同時】在。**
  --    那正是它們寫在同一支的理由 —— 少了這一格, 一個「只建了 writer」的世界會安靜地通過。
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass
     AND tgname = 'shipments_hct_request_id_write_once_bu'
     AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      '後置閘②:write-once trigger 不在(實得 %)⇒ 那三欄會變成「誰都改得了」, 而寫入端已經建好了', v_n;
  END IF;

  -- 🔴🔴 後置閘③:**收權真的生效了** —— 而收權斷言【只檢查你列出來的物件】。
  --    本支建了【兩個】可授權物件, 所以下面【兩個都要驗】:
  --      · `pcm_b2_shipments_hct_request_id_write_once()` —— trigger 函式, 誰都不該叫得動
  --      · `admin_record_hct_submit(text,text,text,jsonb)` —— 寫入端, anon 一定不該叫得動
  --    📌 **它防「忘記收權」, 不防「忘記列」** ⇒ 而漏列的症狀是**這一段安靜地通過**。
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘③a:anon 叫得動 % ⇒ 匿名連線寫得了新竹狀態', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘③b:authenticated 叫得動 % ⇒ 任何登入的【客人】寫得了新竹狀態', v_fn;
    END IF;

    -- 🔵 **負對照:上面兩個 false 要有判別力。**
    --    少了這一格, 一個「`has_function_privilege` 對誰都回 false」的世界(例如簽名打錯)
    --    會讓上面兩格**全部安靜通過** ⇒ 🎯 那正是「零命中」最常見的假綠形狀。
    IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION
        '後置閘③d:連 owner 都叫不動 % ⇒ 上面那兩個 false 沒有判別力(很可能是簽名打錯了)', v_fn;
    END IF;
  END LOOP;

  -- 🟢 後置閘④:那個 trigger 是**啟用**的。
  --    ⚠️ 建起來與啟用是兩件事 —— 一個 tgenabled='D' 的 trigger 在 count 上與正常的一模一樣。
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass
     AND tgname = 'shipments_hct_request_id_write_once_bu'
     AND tgenabled <> 'D';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '後置閘④:那個 trigger 存在但被停用 ⇒ 它在 count 上與正常的長得一樣';
  END IF;
END
$post$;

COMMIT;
