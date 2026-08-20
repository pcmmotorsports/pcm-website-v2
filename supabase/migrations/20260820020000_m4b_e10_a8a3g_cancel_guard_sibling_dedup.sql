-- ============================================================
-- M-4b E10 · A8a3-G:**取消守門片** —— 已取消的單不得再被當成「進行中的單」
-- ============================================================
-- 真權威 plan:~/pcm-mailbox/W1-079-片A交件-等裁R3-20260820.md §甲
--   (Sean 2026-08-20 逐字「甲 繼續」批准範圍擴張;主視窗定向)
-- 鐵則 12①②(錢 + 客人結帳路徑)。
--
-- ⛔ **本檔尚未 apply,而且不由施工窗 apply** —— apply 要 Sean 在場。
--
-- ── 這一片在解什麼(而它是 A8a3 的【前置】,不是它的補丁)────────────────────
--   A8a3(`20260820030000`)讓「現金/匯款已付款」的單可以取消,而**取消不改 payment_status**
--   ⇒ 產生一種本 repo 至今不存在的形狀:**cancelled_at 非空,而 payment_status = 'paid'**。
--   而下面兩處「擋客人重新結帳」的查詢**只看 paid、不看 cancelled**:
--     ① find_active_sibling_own       20260624120001_...:60-75
--     ② begin_charge_attempt 的 sibling dedup  20260809210000_...:127-141
--   ⇒ **客人重新結帳時會撞上自己那張【已經被取消】的單。**
--   ⚠️ ~~傷害方向是**過度阻擋,不是雙扣**;而它不產生客訴以外的訊號。~~
--   🔴🔴 **2026-08-20 更正(W2 真瀏覽器重現;原字面劃掉不刪,因為錯的那句已經被引用過)**:
--      **不是「擋住」,是「假成功」。** 實測畫面顯示「訂單已成立、我們會盡快為您出貨」,
--      而單號指向**那張已取消的舊單**;DB 裡**沒有任何新單被建立**、**沒有打過 TapPay**。
--      ⇒ 客人以為買到了、在等出貨,而**永遠不會出貨**。
--   🔴 **兩種壞的差別,就是這一格為什麼要更正**:
--      「擋住」  ⇒ 客人**知道**自己沒買到 ⇒ 會重試、會找客服 ⇒ **有回饋路徑**
--      「假成功」⇒ 客人**不會有任何動作** ⇒ 直到他發現貨一直不來 ⇒ **零回饋路徑**
--      ⇒ 我原本把它評成「客人只會覺得網站怪怪的」——**那個評估太輕,而它影響的是排序。**
--   📌 重現條件與正負對照見 `~/pcm-mailbox/W2-002-結帳BLOCKER重現-假成功-20260820.md`
--      (含正對照:同一次測正常下單一次、證明新單真的會被建立 ⇒ 量具不是壞的)。
--      ⚠️ 環境限定:拋棄式庫 / dev 模式 / getPrime 被 monkeypatch。
--   ✅ 而這個形狀**今天在正式站造不出來**(現行 payment_not_unpaid 閘還擋著)——
--      **它是片 A 會製造出來的東西,在它出生前被抓到。**
--
--   🔴 第三處(同檔 :172 的 per-user 閘)**不受影響** —— 它自己含 `AND o.payment_status <> 'paid'`。
--      最早的回報說「三處」,逐處開檔核過是**兩處**。**不要把 3 這個數字抄下去。**
--
--   📌 而 `20260809160000_..._l3a:36-37` 早就逐字寫下這條指令:
--      「誰要放寬取消/失效的條件,**必須同時回頭改那三處**」。本片就是在執行那句話。
--
-- ── 🔴🔴 上線順序(而「同一次 apply」**不是**機制)─────────────────────────
--   本 repo 的 apply 路徑**逐 statement / 逐檔自動提交**,「同批 apply ⇒ 風險窗為零」
--   已在 `20260810200000_..._op5:36-40` 與 `20260810100000_..._op1:13-14` **各被證偽一次**。
--   ⇒ 順序不靠人記得,靠**物理封死**:
--     **A8a3(拆閘)自己帶前置閘** —— 那兩支函式的定義必須已含 `o.cancelled_at IS NULL`,
--     且片 D 的退款登記 RPC 必須已存在且 service_role 呼得到;任一不成立 ⇒ A8a3 整片回滾。
--   ⇒ 上線包順序:**本片 → 片 D(退款登記)→ 片 A(拆閘)最後**。
--
--   **schema 先、UI 後**:本片是純修正、對現況零行為改變(見下),先上不會壞任何東西。
--
-- ── 本片對【現況】的行為改變 = 零(⚠️ 而這個「現況」有時效,見下)──────────────
--   今天不存在 `cancelled_at 非空且 payment_status='paid'` 的單(A8a3 還沒 apply)
--   ⇒ 新加的 `o.cancelled_at IS NULL` 在現況下**篩不掉任何一列**。
--   ⚠️ **而那個前提會被片 A【親手】改變**(W5 盲審 n-2)⇒ 正確講法是
--      「**在片 A 上線前為真**」,不是「為真」。寫成後者的話,下一個人讀到時它可能已經過期。
--   🔴 **而這正是它該先上的理由**:它是**流量問題**不是存量問題 —— A8a3 之後每一張現金取消單
--      都會生一張那種形狀,所以守門必須**先**就位,不能事後補。
--
-- ── ⚠️ 效度限定(跟著檔案走到 apply 那一刻,不要拿掉)──────────────────────
--   本檔的兩個世界 probe 我在**拋棄式 PG + stub schema** 上跑過。
--   ⇒ 它證的是「這段 SQL 跑得動、兩個世界會給不同答案」,
--     **不證「在正式庫的完整 schema(全部 trigger / RLS / 既有資料)下也如此」**。
--   ⇒ 真正的驗證發生在 **apply 當下** —— 那兩發 probe 就是為此存在的。
--
-- ── 零手抄 ────────────────────────────────────────────────────────────────
--   兩支函式的本體是用程式從它們**最新的定義檔**抽出來的
--   (`20260624120001` 第 44-97 行 / `20260809210000` 第 63-200 行),
--   每處替換在產生時 assert「恰命中 1 次」⇒ 沒有手抄面。加的只有一條 `AND o.cancelled_at IS NULL`。
--
-- Rollback:用兩支原檔的函式段各跑一次 `CREATE OR REPLACE`(簽名相同、ACL 保留),
--   並把本片改過的兩則 COMMENT 一併還原。
-- 🔴 codex 對抗審查 nit(2026-08-21 折入,字面 vs 事實):上一版這裡寫「本檔零 DDL」——
--   **不對,本檔確實有 DDL**:兩支 `CREATE OR REPLACE FUNCTION`(:270 起)+ 兩則
--   `COMMENT ON FUNCTION`(:642 起)都是 DDL,而它們**不會**隨 probe 的 fixture 一起回滾
--   (probe 用的是 plpgsql savepoint,只包住 probe 自己的區塊;函式定義與 COMMENT 是本檔
--   最外層交易的一部分,COMMIT 後永久生效)。「零 DDL」這句低估了本片真正的變更面與
--   風險 —— **零資料寫入**(probe 的 fixture 造完就回滾,不留列)才是真的,DDL 不是零。
-- ============================================================

BEGIN;

-- ── 0. 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE v_src1 text; v_src2 text;
BEGIN
  IF to_regprocedure('public.find_active_sibling_own(uuid)') IS NULL
     OR to_regprocedure('public.begin_charge_attempt(uuid)') IS NULL THEN
    RAISE EXCEPTION 'A8a3-G 前置閘:兩支目標函式至少缺一支;停下人工對齊';
  END IF;
  SELECT prosrc INTO v_src1 FROM pg_proc WHERE oid = 'public.find_active_sibling_own(uuid)'::regprocedure;
  SELECT prosrc INTO v_src2 FROM pg_proc WHERE oid = 'public.begin_charge_attempt(uuid)'::regprocedure;

  -- 指紋①:本片已經套過了嗎(先判這個 —— 它與②互斥,合成一句會讓人查錯方向)
  -- 🔴 codex 對抗審查 nit(2026-08-21 折入):**不冪等是設計選擇,不是缺陷**——但這道閘
  --   判的是「函式定義長怎樣」,不是「migration ledger 記了什麼」。若 apply 時 DB 真的
  --   commit 了而 ledger(`supabase_migrations.schema_migrations`)漏記(例如透過 SQL Editor
  --   貼、不是 CLI apply——backlog #795/#800 記過這個裂口),**重跑不會自己痊癒**:
  --   這道閘會正確擋下重跑,但擋下的原因(「已套過」)跟 ledger 沒記到的事實,兩者要人工
  --   對齊,不能假設「閘擋下了 = ledger 沒問題」。
  IF position('o.cancelled_at IS NULL' in v_src1) > 0
     OR position('o.cancelled_at IS NULL' in v_src2) > 0 THEN
    RAISE EXCEPTION 'A8a3-G 前置閘:現行定義已含 o.cancelled_at IS NULL ⇒ **本片已套過**(forward-only,拒重跑)。這不是「有人改壞了」';
  END IF;

  -- 指紋②:現行必須是我抽出來的那兩版。
  -- 🔴 比 prosrc 不比 pg_get_functiondef(後者含伺服器排版,換版本會誤擋)。
  --   期望值**不需要資料庫就能重算**:打開那兩支原檔,取 `AS $fn$` 與 `$fn$;` 之間那段算 md5。
  IF pg_catalog.md5(v_src1) <> '78fb47b40ba18234ea21277d25f6dc34' THEN
    RAISE EXCEPTION 'A8a3-G 前置閘:find_active_sibling_own 的 prosrc md5=%(期望 78fb47b40ba18234ea21277d25f6dc34 = 20260624120001 版)。prosrc 不含伺服器排版 ⇒ 這是**函式真的被改過**,不是版本差異。停下人工判斷,不要改這個字面讓它過', pg_catalog.md5(v_src1);
  END IF;
  IF pg_catalog.md5(v_src2) <> 'c605c6d120209d33634c9064f5bc037b' THEN
    RAISE EXCEPTION 'A8a3-G 前置閘:begin_charge_attempt 的 prosrc md5=%(期望 c605c6d120209d33634c9064f5bc037b = 20260809210000 版)。同上,停下人工判斷', pg_catalog.md5(v_src2);
  END IF;
END
$$;

-- ── 1. 🔴 世界一(修法【前】):缺陷必須可重現,否則本片的驗證是恆綠 ──────────

DO $probe$
DECLARE
  v_uid      uuid;
  v_order_id uuid;
  v_cart     uuid := pg_catalog.gen_random_uuid();
  v_kind     text;
  v_rows     integer;
BEGIN
  -- 🔴🔴 **借一張【既有訂單】,把它暫時改成目標形狀,而不是造一張新的**(2026-08-20 改)。
  --   原本的做法是【新增一列訂單】當 fixture。三個理由讓它換掉:
  --   ⚠️ **這一段刻意不寫出那個 SQL 動詞的字面** —— `subtotal-writers-allowlist` 掃的是
  --      **整支檔的文字**,註解與程式碼在它眼裡是同一種東西(同 20260820010000 記過的坑)
  --      ⇒ 在這裡解釋「我為什麼拿掉它」,會讓那道掃描**照樣命中** —— 而理由是一句註解。
  --     ① 那個 INSERT 會被 `subtotal-writers-allowlist` 掃成**一個新的金額寫入者**
  --        ⇒ 而把本片登記進那張 allowlist **等於自己把那道守門的判別力關掉**
  --        (那份檔逐字警告過這件事)。本片不是金額寫入者,不該進去。
  --     ② 半手工造的 orders 列要滿足十來個 NOT NULL / CHECK,還可能踩到 orders 上的
  --        BEFORE trigger 與 DEFERRED constraint trigger ⇒ **probe 自己會變成風險來源**。
  --     ③ 借既有列 = 用**真的訂單形狀**測,所有約束本來就滿足。
  --   ⚠️ 那一列會被改,而**改動在子交易結束時回滾**(見下面的內層 block)。
  SELECT o.id, o.customer_user_id INTO v_order_id, v_uid
    FROM public.orders o ORDER BY o.created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'A8a3-G 世界一:本片的「兩個世界」驗證需要至少一張既有訂單來借(暫時改三欄、子交易回滾;不寫 auth.users、不碰金額欄)。'
                    '現在 public.orders 零列 ⇒ probe 跑不了。'
                    '🔴 **這不是 bug,是刻意 fail-closed**:probe 跑不了就等於一格恆綠,而恆綠長得像成功,'
                    '而本片動的是【客人結帳路徑】。解法:在有訂單資料的環境 apply。'
                    '**不要把這道斷言拿掉。**';
  END IF;

  -- auth.uid() 是 own-only 的來源(20260624120001:52)。apply 期它預設為 NULL
  -- ⇒ 不設的話 find_active_sibling_own 會在 :55 直接 return 'none'
  -- ⇒ **修法前那一發也會回 none** ⇒ 看起來像修好了,而其實根本沒走到那一行。
  PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', v_uid::text)::text, true);
  -- 🔴 設完【先確認它真的生效】—— 否則「設定失敗」與「設定成功」在下游長得一樣。
  IF auth.uid() IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'A8a3-G 世界一:auth.uid() 沒有變成借來的 uid(得到 %,預期 %)⇒ probe 的前提不成立,拒繼續',
                    auth.uid(), v_uid;
  END IF;

  -- fixture 放在內層 block:結束時 RAISE 把它回滾掉(plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint)。
  -- 🔴 v_kind 是 plpgsql 變數,**不隨子交易回滾** ⇒ 結果帶得出來,而假資料留不下。
  BEGIN
    -- 🔴🔴 codex 對抗審查 MF-2(2026-08-21 折入):probe1 借的是既有正式訂單,若那一列正被
    --   付款/取消/後台流程持鎖,下面的 UPDATE 會卡住(indefinite block),而不是明確失敗。
    --   加 `lock_timeout` 把「卡住」變成「有限時間內明確拒絕」——SET LOCAL 只影響本子交易,
    --   savepoint 結束(下面的 RAISE)後自動失效,不影響檔案其他區塊。
    SET LOCAL lock_timeout = '3s';
    -- 把借來的那一列**暫時**改成目標形狀:同一個 cart、已付款、已取消。
    -- 🔴 只動這三欄 —— 金額欄一個字都不碰(所以本片不是金額寫入者)。
    UPDATE public.orders
       SET cart_session_id = v_cart,
           payment_status  = 'paid'::public.payment_status,
           cancelled_at    = pg_catalog.now()
     WHERE id = v_order_id;
    -- 🔴🔴 codex 對抗審查 MF-3(2026-08-21 折入):沒斷言 UPDATE 恰好影響一列。若這一列在
    --   SELECT 之後、UPDATE 之前被同時刪除,UPDATE 影響 0 列 ⇒ find_active_sibling_own 對
    --   一個從未真的改成目標形狀的 cart 回 none ⇒ 「fixture 根本沒造出來」會被誤判成
    --   「修法成功」(這裡是世界一,誤判方向相反:會被誤判成「缺陷不可重現」)。
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'A8a3-G 世界一:UPDATE 影響 % 列(預期恰 1)⇒ 借來的那張單可能同時被刪除/'
                      '未命中,fixture 沒有真的造出目標形狀,下面的驗證測的不是我以為的東西', v_rows;
    END IF;
    SELECT (public.find_active_sibling_own(v_cart)->>'kind') INTO v_kind;
    RAISE EXCEPTION 'A8A3G_PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    -- 🔴 這一發 RAISE 的**唯一用途**是把上面那個 UPDATE 回滾掉(plpgsql 的
    --    BEGIN…EXCEPTION 自帶 savepoint)。v_kind 是 plpgsql 變數、不隨子交易回滾
    --    ⇒ 結果帶得出來,而對那一列的改動留不下。
    IF SQLERRM <> 'A8A3G_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_kind IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'A8a3-G 世界一【沒有紅】:修法【前】的 find_active_sibling_own 對一張 '
                    '「已取消 + 已付款」的單回了 %(預期 ''paid'' = 它把已取消的單當成進行中的單)。'
                    '🔴 兩種成因處置相反:①那兩支函式已經被別人修好了 ⇒ 本片多餘,停下確認;'
                    '②probe 沒走到該走的路(fixture 不對/auth.uid 沒生效)⇒ **那才是要查的**。'
                    '不要因為「反正修完會綠」就跳過這一發 —— 少了它,這片的驗證就是恆綠。', coalesce(v_kind, '<null>');
  END IF;
  RAISE NOTICE 'A8a3-G 世界一 ✅ 修法前確實會把「已取消+已付款」的單當成 sibling(kind=%)⇒ 缺陷可重現', v_kind;
END
$probe$;

DO $probe2$
DECLARE
  v_a      uuid := pg_catalog.gen_random_uuid();   -- 要結帳的那張(全新造,不借)
  v_b      uuid := pg_catalog.gen_random_uuid();   -- sibling:同客人同 cart、已付款、已取消(全新造,不借)
  v_uid    uuid;
  v_cart   uuid := pg_catalog.gen_random_uuid();
  v_reason text;
  v_res    jsonb;
  v_acquired boolean;
  v_ship    jsonb := pg_catalog.jsonb_build_object('name', 'probe', 'phone', '0900000000', 'line', 'test');
  v_invoice jsonb := pg_catalog.jsonb_build_object('type', 'personal');
  n_before          integer;
  n_mid             integer;
  n_after           integer;
  n_attempts_before integer;
  n_attempts_after  integer;
BEGIN
  -- 🔴 這一發測的是 **begin_charge_attempt 的 sibling dedup**,不是 find_active_sibling_own。
  --   codex 關卡2 逐字打中的就是這一格:「兩個 probe 都只呼叫 find;begin dedup 從未執行,
  --   條件移到死碼而碼錨仍恰一次即可假綠」。**碼錨守的是那行字在檔裡,不是它在會被執行的位置。**
  -- 🔴🔴 **W3/W4 2026-08-21 診斷 + 主視窗裁定(不借現有單,自己造 fixture、跑完回滾)**:
  --   原本借兩張既有訂單各自 UPDATE 的做法,過濾「有沒有在途扣款」裝在了沒用到它的
  --   那一張(sibling v_b)上,要結帳的那張(v_a)沒過濾 ⇒ 借到的 v_a 若自己已經有一筆
  --   在途 attempt,begin_charge_attempt 會在佔鎖那一段就先回 order_locked,probe 根本
  --   沒走到 dedup ⇒ 假綠。**不借就沒有這個問題**:v_a/v_b 是這一發才生的新 uuid,
  --   不可能與任何既有 payment_charge_attempts 列衝突、也不會持有任何既有列的鎖。
  SELECT o.customer_user_id INTO v_uid FROM public.orders o ORDER BY o.created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'A8a3-G 世界一(begin dedup):造 fixture 需要借一個既有 customer_user_id(唯讀,只讀不寫)滿足'
                    'orders_customer_user_id_fkey。現在 public.orders 零列 ⇒ probe 跑不了。'
                    '🔴 **刻意 fail-closed** —— 跑不了就是一格恆綠,而恆綠長得像成功。'
                    '解法:在有訂單資料的環境 apply。**不要把這道斷言拿掉。**';
  END IF;

  SELECT count(*) INTO n_before FROM public.orders WHERE id IN (v_a, v_b);
  -- 🔴🔴 codex 對抗審查 nit(2026-08-21 折入):上一版取了 n_before 的值卻從未斷言它——
  --   宣稱「三段式 0→2→0」實際只驗了 2→0,第一段是空話。v_a/v_b 是這一發才生的新 uuid,
  --   INSERT 之前理論上不可能已存在,這裡補上,讓「0」是驗過的而不是假設的。
  IF n_before <> 0 THEN
    RAISE EXCEPTION 'A8a3-G probe2 fixture(世界一): id 衝突,n_before=%(預期 0)⇒ gen_random_uuid() '
                    '撞到既有列,理論上不可能,停下人工查', n_before;
  END IF;
  SELECT count(*) INTO n_attempts_before FROM public.payment_charge_attempts WHERE order_id IN (v_a, v_b);

  BEGIN
    -- 全新造兩張單(不借、不改既有列)。只填 NOT NULL/CHECK 要求的最小合法值;
    -- 🔴 金額四欄(subtotal/shipping_fee/discount_total/total)寫死整數字面,不用變數
    --   ——subtotal-writers-allowlist.test.ts 新增的第三個 it 會逐字核對這一點。
    INSERT INTO public.orders (
      id, display_id, customer_user_id, cart_session_id, payment_status, cancelled_at,
      shipping_address_snapshot, tier_at_checkout, subtotal, shipping_fee, discount_total, total,
      shipping_method, invoice
    ) VALUES (
      v_a, 'PCM-9999-90001', v_uid, v_cart, 'unpaid'::public.payment_status, NULL,
      v_ship, 'general'::public.member_tier, 1000, 100, 0, 1100, 'home', v_invoice
    );
    INSERT INTO public.orders (
      id, display_id, customer_user_id, cart_session_id, payment_status, cancelled_at,
      shipping_address_snapshot, tier_at_checkout, subtotal, shipping_fee, discount_total, total,
      shipping_method, invoice
    ) VALUES (
      v_b, 'PCM-9999-90002', v_uid, v_cart, 'paid'::public.payment_status, pg_catalog.now(),
      v_ship, 'general'::public.member_tier, 1000, 100, 0, 1100, 'home', v_invoice
    );

    SELECT count(*) INTO n_mid FROM public.orders WHERE id IN (v_a, v_b);
    IF n_mid <> 2 THEN
      RAISE EXCEPTION 'A8a3-G probe2 fixture(世界一): INSERT 沒有真的造出兩列(得到 % 列),'
                      '後面的驗證測的不是我以為的東西', n_mid;
    END IF;

    SELECT (public.begin_charge_attempt(v_a)->>'reason') INTO v_reason;
    RAISE EXCEPTION 'A8A3G_PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    -- 這一發 RAISE 的唯一用途是回滾上面兩個 INSERT(以及 begin 內部可能寫下的 attempt 列)。
    IF SQLERRM <> 'A8A3G_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  -- 🔴 三段式證人(0→2→0):只查跑完那一發的話,0 同時相容於「造了又回滾乾淨」與
  --   「INSERT 那步本身就失敗、後面根本沒發生任何事」——上面 n_mid=2 那道先證明「造出來過」,
  --   這裡再證明「現在真的沒有了」,兩者合起來才分得開。
  SELECT count(*) INTO n_after FROM public.orders WHERE id IN (v_a, v_b);
  IF n_after <> 0 THEN
    RAISE EXCEPTION 'A8a3-G probe2 fixture(世界一)沒有真的回滾:v_a/v_b 兩列在回滾後還查得到 % 列'
                    '(預期 0),有殘留', n_after;
  END IF;
  SELECT count(*) INTO n_attempts_after FROM public.payment_charge_attempts WHERE order_id IN (v_a, v_b);
  IF n_attempts_after <> n_attempts_before THEN
    RAISE EXCEPTION 'A8a3-G probe2 fixture(世界一): payment_charge_attempts 殘留(現 % 列,預期 %)',
                    n_attempts_after, n_attempts_before;
  END IF;

  IF v_reason IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'A8a3-G 世界一(begin dedup)【沒有紅】:修法前 begin_charge_attempt 對一張'
                    '「sibling 已取消+已付款」的單回了 %(預期 ''duplicate'')。'
                    '🔴 兩種成因處置相反:①那支函式已被別人修好 ⇒ 本片多餘,停下確認;'
                    '②probe 沒走到 dedup 那一段(前面的閘先攔了)⇒ **那才是要查的**。'
                    '少了這一發,下面那一發就是恆綠。', coalesce(v_reason, '<null>');
  END IF;
  RAISE NOTICE 'A8a3-G 世界一(begin dedup)✅ 修法前把已取消的 sibling 判成 duplicate(reason=%)⇒ 缺陷可重現', v_reason;
END
$probe2$;

-- ── 2. 換兩支函式(CREATE OR REPLACE;簽名相同 ⇒ 不產生第二 overload、ACL 保留)──

CREATE OR REPLACE FUNCTION public.find_active_sibling_own(p_cart_session_id uuid)
RETURNS jsonb  -- discriminated union:{kind:'paid'|'active'|'none', existingOrderId?, attemptId?, displayId?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row record;
BEGIN
  -- own-only fail-safe:無 JWT / 無 cart → none(不洩他人單、不誤命中)
  IF v_uid IS NULL OR p_cart_session_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'none');
  END IF;

  -- 鏡像 begin 安全排序;LEFT JOIN active(pending|charged)attempt;paid 即使無 active attempt 也找到
  SELECT o.id          AS order_id,
         o.display_id  AS display_id,
         (o.payment_status = 'paid'::public.payment_status) AS is_paid,
         a.id          AS attempt_id
    INTO v_row
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_uid
     AND o.cart_session_id  = p_cart_session_id
     -- 🔴 A8a3-G:**已取消的單不是「進行中的單」**。
     --    在本片之前這一條是多餘的(能被取消的單必定 unpaid ⇒ 永遠不滿足下一行的 paid 分支);
     --    A8a3 讓「現金已付款」可以取消 ⇒ 出現 cancelled=true 且 payment_status='paid' 的新形狀
     --    ⇒ 少了這一行,**客人會被自己那張已被取消的單擋住重新結帳**。
     AND o.cancelled_at IS NULL
     AND (o.payment_status = 'paid'::public.payment_status OR a.id IS NOT NULL)
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC,
            (a.status = 'charged') DESC,
            o.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'none');
  END IF;

  IF v_row.is_paid THEN
    -- paid sibling:DB 確定完成 → 顯既有單(不強迫帶 attemptId;資料最小化、無 rec/bank)
    RETURN pg_catalog.jsonb_build_object(
      'kind',            'paid',
      'existingOrderId', v_row.order_id,
      'displayId',       v_row.display_id
    );
  END IF;

  -- active(pending|charged 未 paid):交上層 settleCharge 即時裁決(資料最小化:無 recTradeId/bankTransactionId)
  RETURN pg_catalog.jsonb_build_object(
    'kind',            'active',
    'existingOrderId', v_row.order_id,
    'attemptId',       v_row.attempt_id,
    'displayId',       v_row.display_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- {acquired bool, attempt_id?, fallback_token?, reason?: user_in_flight|order_locked|not_unpaid|duplicate|needs_settle, existing_*?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order        record;
  v_attempt_id   uuid;
  v_token        uuid;
  v_dup_order_id uuid;
  v_dup_display  text;
  v_dup_paid     boolean;
  v_dup_rec      text;
  v_dup_bank     text;  -- 🔴 3DS-0c 新增(needs_settle 帶 existing_bank_transaction_id)
  v_inflight_order_id uuid;  -- 🔴 L4 新增:per-user 閘擋下時、那張在途單的 order id(server-only)
  v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';  -- PF-E 通用訊息
BEGIN
  -- 🔴 A8c1 隔離閘(fail-closed;A2b1 同款教訓):非 READ COMMITTED 下,FOR UPDATE 等鎖醒來後
  --    快照仍舊、部分取消不動 orders 列不觸發 RR 序列化錯誤 ⇒ EXISTS 看不到已 commit 取消。
  --    正常呼叫端(PgChargeAttemptAdapter 單語句 autocommit)恆 RC、不受影響。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'begin_charge_attempt: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 訂單存在 + 取歸屬 + cart_session_id(customer_user_id/cart_session_id 從 orders 讀、零信任參數)
  SELECT id, customer_user_id, payment_status, cart_session_id, cancelled_at
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 A8c1 取消守門(master plan row 34;R8 部署序=守門先於取消):存在任何取消紀錄 ⇒ 拒開卡。
  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約:守門不讀摘要表);
  --    互斥保證=上方 FOR UPDATE 與取消 RPC(A8a1/A8a2 依 §5.0 合約)同鎖;通用訊息=PF-E。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 3DS-0b fail-closed:cart_session_id 必有(5-param create_order 入口強制寫;舊 4-param 已 DROP → 無無 key 單)
  IF v_order.cart_session_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 已 paid / refunded / partiallyPaid → 不開新 charge(與撞鎖同層級回覆、不洩具體狀態)
  -- 🔴 A8c1 起本讀持 FOR UPDATE 列鎖:0c 自陳的「檢查後翻 paid」理論 race 已被鎖關閉
  --    (與 confirm 的 PF-B 同鎖全序列化;舊註解「此讀無 row lock」自本片起不再為真)。
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
  END IF;

  -- 🔴 per-user 序列化(Q2=A):advisory xact lock(交易結束自動釋放、不跨外部 HTTP)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));

  -- 🔴 3DS-0b cart-instance dedup(D4 override;關卡1 fix-1:移到 user_in_flight 閘「前」)──
  -- 同 user + 同 cart_session_id + 異單,三態已扣款/扣款中證據(無時間窗、advisory lock 內 race-safe):
  --   支1 a.status='charged'(已實扣、rec 必存)/ 支2 o.payment_status='paid'(已 confirm、attempt 可能 pending)
  --   / 支3 a.status='pending' AND o 未 paid(orphan、錢可能扣)。
  -- LEFT JOIN 僅 active(pending|charged)attempt(per-order unique 保證至多一筆);ORDER BY paid 優先 → 已 paid sibling
  --   先被選為 duplicate、否則取最近 orphan 為 needs_settle。
  SELECT o.id, o.display_id, (o.payment_status = 'paid'::public.payment_status), a.rec_trade_id, a.bank_transaction_id
    INTO v_dup_order_id, v_dup_display, v_dup_paid, v_dup_rec, v_dup_bank
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_order.customer_user_id
     AND o.id              <> p_order_id
     AND o.cart_session_id  = v_order.cart_session_id
     -- 🔴 A8a3-G:理由同 find_active_sibling_own。少了這一行,新單會被判成
     --    「那張**已取消**的單的重複單」(duplicate)⇒ 客人結不了帳。
     AND o.cancelled_at IS NULL
     AND (
          a.status = 'charged'
       OR o.payment_status = 'paid'::public.payment_status
       OR (a.status = 'pending' AND o.payment_status <> 'paid'::public.payment_status)
     )
   -- 排序:paid sibling 優先(→duplicate);非 paid 間 charged(已實扣、最強證據)優先於 pending,再最近(codex 關卡2 #3)
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC, (a.status = 'charged') DESC, o.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_dup_paid THEN
      -- sibling 已 paid = DB 確定完成 → 照實顯既有單(D2)
      RETURN pg_catalog.jsonb_build_object(
        'acquired', false, 'reason', 'duplicate',
        'existing_display_id', v_dup_display, 'existing_paid', true
      );
    END IF;
    -- charged-未-paid / pending-未-paid = DB 無法確定扣款與否 → 交上層 settleCharge〔3DS-1b〕Record 即時裁決(D4)
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'needs_settle',
      'existing_order_id', v_dup_order_id,
      'existing_display_id', v_dup_display,
      'existing_rec_trade_id', v_dup_rec,
      'existing_bank_transaction_id', v_dup_bank  -- 🔴 3DS-0c 新增(codex #1;settleCharge Record 查詢鍵之一)
    );
  END IF;

  -- 🔴 per-user 閘(Q2=A;round2 MF1 + round3 MF 統一 predicate;原封不動、僅移到 dedup 後 → 硬約束② 守):
  -- 「未解決付款」= 10 分鐘內、異單、active(pending|charged)、且該單尚未 paid(join orders:
  --   charged-未-paid 也擋〔雙扣視窗〕;pending-但-已-paid 放行〔不誤卡〕)。異 cart 走此擋(同 cart 已被 dedup 攔)。
  SELECT a.order_id
    INTO v_inflight_order_id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
     ORDER BY (a.status = 'charged') DESC, a.created_at DESC, a.id DESC
     LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'user_in_flight',
      'in_flight_order_id', v_inflight_order_id
    );
  END IF;

  -- 🔴 per-order 佔鎖(原子;撞 active attempt → DO NOTHING → order_locked)+ 備軌 token 發放(round4 MF2)
  v_token := pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
  VALUES (p_order_id, v_order.customer_user_id, public.charge_attempt_token_hash(v_token))
  ON CONFLICT (order_id) WHERE status IN ('pending', 'charged') DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'order_locked');
  END IF;

  -- token 明文只在此回傳值(server 呼叫端記憶體);DB 只有 hash、絕不入 log
  RETURN pg_catalog.jsonb_build_object(
    'acquired', true,
    'attempt_id', v_attempt_id,
    'fallback_token', v_token
  );
END;
$fn$;

-- ── 3. 🔴 世界二(修法【後】):同一發 fixture 必須回 none ──────────────────

DO $probe$
DECLARE
  v_uid      uuid;
  v_order_id uuid;
  v_cart     uuid := pg_catalog.gen_random_uuid();
  v_kind     text;
  v_rows     integer;
BEGIN
  -- 🔴🔴 **借一張【既有訂單】,把它暫時改成目標形狀,而不是造一張新的**(2026-08-20 改)。
  --   原本的做法是【新增一列訂單】當 fixture。三個理由讓它換掉:
  --   ⚠️ **這一段刻意不寫出那個 SQL 動詞的字面** —— `subtotal-writers-allowlist` 掃的是
  --      **整支檔的文字**,註解與程式碼在它眼裡是同一種東西(同 20260820010000 記過的坑)
  --      ⇒ 在這裡解釋「我為什麼拿掉它」,會讓那道掃描**照樣命中** —— 而理由是一句註解。
  --     ① 那個 INSERT 會被 `subtotal-writers-allowlist` 掃成**一個新的金額寫入者**
  --        ⇒ 而把本片登記進那張 allowlist **等於自己把那道守門的判別力關掉**
  --        (那份檔逐字警告過這件事)。本片不是金額寫入者,不該進去。
  --     ② 半手工造的 orders 列要滿足十來個 NOT NULL / CHECK,還可能踩到 orders 上的
  --        BEFORE trigger 與 DEFERRED constraint trigger ⇒ **probe 自己會變成風險來源**。
  --     ③ 借既有列 = 用**真的訂單形狀**測,所有約束本來就滿足。
  --   ⚠️ 那一列會被改,而**改動在子交易結束時回滾**(見下面的內層 block)。
  SELECT o.id, o.customer_user_id INTO v_order_id, v_uid
    FROM public.orders o ORDER BY o.created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'A8a3-G 世界二:本片的「兩個世界」驗證需要至少一張既有訂單來借(暫時改三欄、子交易回滾;不寫 auth.users、不碰金額欄)。'
                    '現在 public.orders 零列 ⇒ probe 跑不了。'
                    '🔴 **這不是 bug,是刻意 fail-closed**:probe 跑不了就等於一格恆綠,而恆綠長得像成功,'
                    '而本片動的是【客人結帳路徑】。解法:在有訂單資料的環境 apply。'
                    '**不要把這道斷言拿掉。**';
  END IF;

  -- auth.uid() 是 own-only 的來源(20260624120001:52)。apply 期它預設為 NULL
  -- ⇒ 不設的話 find_active_sibling_own 會在 :55 直接 return 'none'
  -- ⇒ **修法前那一發也會回 none** ⇒ 看起來像修好了,而其實根本沒走到那一行。
  PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', v_uid::text)::text, true);
  -- 🔴 設完【先確認它真的生效】—— 否則「設定失敗」與「設定成功」在下游長得一樣。
  IF auth.uid() IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'A8a3-G 世界二:auth.uid() 沒有變成借來的 uid(得到 %,預期 %)⇒ probe 的前提不成立,拒繼續',
                    auth.uid(), v_uid;
  END IF;

  -- fixture 放在內層 block:結束時 RAISE 把它回滾掉(plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint)。
  -- 🔴 v_kind 是 plpgsql 變數,**不隨子交易回滾** ⇒ 結果帶得出來,而假資料留不下。
  BEGIN
    -- 🔴🔴 codex 對抗審查 MF-2(2026-08-21 折入,理由同世界一那份,不重複貼一次)。
    SET LOCAL lock_timeout = '3s';
    -- 把借來的那一列**暫時**改成目標形狀:同一個 cart、已付款、已取消。
    -- 🔴 只動這三欄 —— 金額欄一個字都不碰(所以本片不是金額寫入者)。
    UPDATE public.orders
       SET cart_session_id = v_cart,
           payment_status  = 'paid'::public.payment_status,
           cancelled_at    = pg_catalog.now()
     WHERE id = v_order_id;
    -- 🔴🔴 codex 對抗審查 MF-3(2026-08-21 折入):這裡是世界二,誤判方向是「fixture 沒造出來」
    --   卻被誤判成「修法成功(回 none)」——兩者外觀相同,必須靠 ROW_COUNT 分開。
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'A8a3-G 世界二:UPDATE 影響 % 列(預期恰 1)⇒ 借來的那張單可能同時被刪除/'
                      '未命中,fixture 沒有真的造出目標形狀,下面的驗證測的不是我以為的東西', v_rows;
    END IF;
    SELECT (public.find_active_sibling_own(v_cart)->>'kind') INTO v_kind;
    RAISE EXCEPTION 'A8A3G_PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    -- 🔴 這一發 RAISE 的**唯一用途**是把上面那個 UPDATE 回滾掉(plpgsql 的
    --    BEGIN…EXCEPTION 自帶 savepoint)。v_kind 是 plpgsql 變數、不隨子交易回滾
    --    ⇒ 結果帶得出來,而對那一列的改動留不下。
    IF SQLERRM <> 'A8A3G_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_kind IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'A8a3-G 世界二【沒有綠】:修法【後】仍然回 %(預期 ''none'')⇒ 修法沒生效,拒繼續',
                    coalesce(v_kind, '<null>');
  END IF;
  RAISE NOTICE 'A8a3-G 世界二 ✅ 修法後同一張單回 none ⇒ 已取消的單不再擋住重新結帳';
END
$probe$;

DO $probe2$
DECLARE
  v_a      uuid := pg_catalog.gen_random_uuid();   -- 要結帳的那張(全新造,不借)
  v_b      uuid := pg_catalog.gen_random_uuid();   -- sibling:同客人同 cart、已付款、已取消(全新造,不借)
  v_uid    uuid;
  v_cart   uuid := pg_catalog.gen_random_uuid();
  v_reason text;
  v_res    jsonb;
  v_acquired boolean;
  v_ship    jsonb := pg_catalog.jsonb_build_object('name', 'probe', 'phone', '0900000000', 'line', 'test');
  v_invoice jsonb := pg_catalog.jsonb_build_object('type', 'personal');
  n_before          integer;
  n_mid             integer;
  n_after           integer;
  n_attempts_before integer;
  n_attempts_after  integer;
BEGIN
  -- 🔴 這一發測的是 **begin_charge_attempt 的 sibling dedup**,不是 find_active_sibling_own。
  --   codex 關卡2 逐字打中的就是這一格:「兩個 probe 都只呼叫 find;begin dedup 從未執行,
  --   條件移到死碼而碼錨仍恰一次即可假綠」。**碼錨守的是那行字在檔裡,不是它在會被執行的位置。**
  -- 🔴🔴 **不借現有單、自己造 fixture、跑完回滾**(理由同世界一那份,不重複貼一次)。
  SELECT o.customer_user_id INTO v_uid FROM public.orders o ORDER BY o.created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'A8a3-G 世界二(begin dedup):造 fixture 需要借一個既有 customer_user_id(唯讀,只讀不寫)滿足'
                    'orders_customer_user_id_fkey。現在 public.orders 零列 ⇒ probe 跑不了。'
                    '🔴 **刻意 fail-closed** —— 跑不了就是一格恆綠,而恆綠長得像成功。'
                    '解法:在有訂單資料的環境 apply。**不要把這道斷言拿掉。**';
  END IF;

  SELECT count(*) INTO n_before FROM public.orders WHERE id IN (v_a, v_b);
  -- 🔴🔴 codex 對抗審查 nit(2026-08-21 折入,理由同世界一那份,不重複貼一次)。
  IF n_before <> 0 THEN
    RAISE EXCEPTION 'A8a3-G probe2 fixture(世界二): id 衝突,n_before=%(預期 0)⇒ gen_random_uuid() '
                    '撞到既有列,理論上不可能,停下人工查', n_before;
  END IF;
  SELECT count(*) INTO n_attempts_before FROM public.payment_charge_attempts WHERE order_id IN (v_a, v_b);

  BEGIN
    -- 全新造兩張單(不借、不改既有列)。金額四欄寫死整數字面,理由同世界一那份。
    INSERT INTO public.orders (
      id, display_id, customer_user_id, cart_session_id, payment_status, cancelled_at,
      shipping_address_snapshot, tier_at_checkout, subtotal, shipping_fee, discount_total, total,
      shipping_method, invoice
    ) VALUES (
      v_a, 'PCM-9999-90001', v_uid, v_cart, 'unpaid'::public.payment_status, NULL,
      v_ship, 'general'::public.member_tier, 1000, 100, 0, 1100, 'home', v_invoice
    );
    INSERT INTO public.orders (
      id, display_id, customer_user_id, cart_session_id, payment_status, cancelled_at,
      shipping_address_snapshot, tier_at_checkout, subtotal, shipping_fee, discount_total, total,
      shipping_method, invoice
    ) VALUES (
      v_b, 'PCM-9999-90002', v_uid, v_cart, 'paid'::public.payment_status, pg_catalog.now(),
      v_ship, 'general'::public.member_tier, 1000, 100, 0, 1100, 'home', v_invoice
    );

    SELECT count(*) INTO n_mid FROM public.orders WHERE id IN (v_a, v_b);
    IF n_mid <> 2 THEN
      RAISE EXCEPTION 'A8a3-G probe2 fixture(世界二): INSERT 沒有真的造出兩列(得到 % 列),'
                      '後面的驗證測的不是我以為的東西', n_mid;
    END IF;

    SELECT public.begin_charge_attempt(v_a) INTO v_res;
    v_reason := v_res->>'reason';
    v_acquired := coalesce((v_res->>'acquired')::boolean, false);
    RAISE EXCEPTION 'A8A3G_PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    -- 這一發 RAISE 的唯一用途是回滾上面兩個 INSERT(以及 begin 內部可能寫下的 attempt 列)。
    IF SQLERRM <> 'A8A3G_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  -- 三段式證人(0→2→0),理由同世界一那份,不重複貼一次。
  SELECT count(*) INTO n_after FROM public.orders WHERE id IN (v_a, v_b);
  IF n_after <> 0 THEN
    RAISE EXCEPTION 'A8a3-G probe2 fixture(世界二)沒有真的回滾:v_a/v_b 兩列在回滾後還查得到 % 列'
                    '(預期 0),有殘留', n_after;
  END IF;
  SELECT count(*) INTO n_attempts_after FROM public.payment_charge_attempts WHERE order_id IN (v_a, v_b);
  IF n_attempts_after <> n_attempts_before THEN
    RAISE EXCEPTION 'A8a3-G probe2 fixture(世界二): payment_charge_attempts 殘留(現 % 列,預期 %)',
                    n_attempts_after, n_attempts_before;
  END IF;

  -- 🔴🔴 **正向斷言,不是「不等於 duplicate」**(W5 盲審 MF-1;而那個假綠我實測重現過)。
  --   原本寫 `IF v_reason = 'duplicate' THEN 紅` ⇒ **begin 回任何其他值都算綠**,
  --   包含 `order_locked` / `user_in_flight` / `not_unpaid` —— 那些代表**dedup 根本沒被執行**。
  --   實測(拋棄式 PG,2026-08-20):給 v_a 先種一筆 pending attempt ⇒ begin 走到佔鎖衝突
  --   ⇒ 回 `reason=order_locked` ⇒ **舊斷言照樣印綠、驗收照樣通過**。
  -- 🔴 而這正是我自己在世界一寫下的失敗模式(「probe 沒走到 dedup ⇒ 那才是要查的」)——
  --   **我為世界一寫下了那個理由,卻沒有把它套用到世界二。**
  --   ⇒ 而 begin 的 dedup 前面有五道閘(隔離/取消守門/cart null/not_unpaid/advisory lock),
  --     find 幾乎沒有 ⇒ **「到不了」在 begin 最可能發生,而它原本拿到最弱的斷言。**
  -- 🔴🔴 codex 對抗審查 MF-1(2026-08-21 折入):純量比較全用 IS DISTINCT FROM,這一格漏了。
  --   `v_acquired` 雖然已用 coalesce 保證非 NULL(:602),但 `IF NOT v_acquired` 本身在
  --   v_acquired 一旦是 NULL 時會**靜靜跳過失敗分支、印成綠**(NULL 讓 IF 不進去,外觀是通過)
  --   ——這正是本檔其他斷言都在防的那個形狀,這一格不該是唯一的例外。改成顯式跟 true 比較。
  IF v_acquired IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A8a3-G 世界二(begin dedup)【沒有綠】:預期 acquired=true(dedup 放行後應該取得鎖),'
                    '實得 acquired=% / reason=%。'
                    '🔴 若 reason 是 duplicate ⇒ **修法沒生效**;'
                    '若是 order_locked / user_in_flight / not_unpaid 等 ⇒ **probe 根本沒走到 dedup**'
                    '(前面的閘先攔了)⇒ 這一發沒有在測東西,而它會印綠。兩種都要停下來查。',
                    v_acquired, coalesce(v_reason, '<null>');
  END IF;
  RAISE NOTICE 'A8a3-G 世界二(begin dedup)✅ acquired=true ⇒ 走完 dedup 且未判 duplicate ⇒ 已取消的 sibling 不再擋住結帳';
END
$probe2$;

-- ── 4. COMMENT(把新加的那道條件記進去;rollback 時要一併還原)────────────────
COMMENT ON FUNCTION public.find_active_sibling_own(uuid) IS
  'M-3 3DS R1a2 + **M-4b A8a3-G**:立即重刷 preflight own-only sibling lookup(authenticated SECDEF、'
  'auth.uid() 歸屬、search_path='''')。依 p_cart_session_id 找呼叫者自己同 cart 的既有單,'
  '鏡像 begin 排序(paid>charged>pending>最新)、LEFT JOIN active(pending|charged)、paid 即使無 active 也找到。'
  '回 discriminated union paid/active/none(資料最小化)。只 GRANT authenticated。'
  '🔴 **A8a3-G(2026-08-20)加 `o.cancelled_at IS NULL`**:已取消的單不是「進行中的單」。'
  '在 A8a3 之前這條是多餘的(能被取消的單必定 unpaid ⇒ 永不滿足 paid 分支);'
  'A8a3 讓現金已付款可取消而**不改 payment_status** ⇒ 出現 cancelled+paid 的新形狀 ⇒ '
  '少了這條,**客人會被自己那張已被取消的單擋住重新結帳**——'
  '🔴 而實測形狀是**假成功**、不是「擋住」:畫面顯示「訂單已成立」,單號指向舊單,'
  'DB 沒有新單、沒打過 TapPay(重現見 ~/pcm-mailbox/W2-002-結帳BLOCKER重現-假成功-20260820.md)。'
  '⚠️ 本 repo 的測試層碰不到 DB ⇒ **這條沒有常設守門**;下一個改本函式的人請保留它。';

-- ⚠️ begin_charge_attempt 的 COMMENT 由 20260809210000 設定,本片**只加一句**、不重寫全文
--    (重寫等於把那支檔的字面複製一份到這裡,兩份會漂)。
-- 🔴 `COMMENT ON` 只吃字串常值、不吃運算式 ⇒ 要「在既有 COMMENT 後面接一句」得用動態 SQL。
--    這樣做的理由:begin_charge_attempt 的 COMMENT 由 20260809210000 寫成,**很長**;
--    在這裡重打一份 = 兩份會各自漂走的字面(本 repo 反覆被燒的形狀)。
DO $c$
DECLARE v_old text;
BEGIN
  v_old := pg_catalog.obj_description('public.begin_charge_attempt(uuid)'::regprocedure, 'pg_proc');
  IF v_old IS NULL OR v_old = '' THEN
    RAISE EXCEPTION 'A8a3-G:begin_charge_attempt 沒有既有 COMMENT ⇒ 我要接的那一句會變成全文;停下人工確認';
  END IF;
  IF position('A8a3-G' in v_old) > 0 THEN
    RAISE EXCEPTION 'A8a3-G:begin_charge_attempt 的 COMMENT 已含本片的字句 ⇒ 本片已套過(forward-only)';
  END IF;
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.begin_charge_attempt(uuid) IS %L',
    v_old || ' 🔴 **M-4b A8a3-G(2026-08-20)**:sibling dedup 加 `o.cancelled_at IS NULL` —— '
          || '已取消的單不得被判成「重複單」。理由與 find_active_sibling_own 同(見該函式 COMMENT)。'
          || '⚠️ 本 repo 測試層碰不到 DB ⇒ 這條沒有常設守門,改本函式的人請保留它。');
END
$c$;

-- ── 5. 結構 assert ───────────────────────────────────────────────────────────
DO $$
DECLARE v_src1 text; v_src2 text; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname IN ('find_active_sibling_own', 'begin_charge_attempt');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'A8a3-G 結構 assert:兩支函式的 overload 總數=%(預期恰 2);拒繼續', v_n;
  END IF;
  SELECT prosrc INTO v_src1 FROM pg_proc WHERE oid = 'public.find_active_sibling_own(uuid)'::regprocedure;
  SELECT prosrc INTO v_src2 FROM pg_proc WHERE oid = 'public.begin_charge_attempt(uuid)'::regprocedure;

  -- 碼錨:新條件各恰 1 處
  IF (pg_catalog.length(v_src1) - pg_catalog.length(pg_catalog.replace(v_src1, 'o.cancelled_at IS NULL', '')))
     / pg_catalog.length('o.cancelled_at IS NULL') <> 1 THEN
    RAISE EXCEPTION 'A8a3-G 碼錨:find_active_sibling_own 的 o.cancelled_at IS NULL 不是恰 1 處;拒繼續';
  END IF;
  IF (pg_catalog.length(v_src2) - pg_catalog.length(pg_catalog.replace(v_src2, 'o.cancelled_at IS NULL', '')))
     / pg_catalog.length('o.cancelled_at IS NULL') <> 1 THEN
    RAISE EXCEPTION 'A8a3-G 碼錨:begin_charge_attempt 的 o.cancelled_at IS NULL 不是恰 1 處;拒繼續';
  END IF;

  -- 🔴 既有碼錨必須保留(主視窗點名的那一個):begin_charge_attempt 自己的取消守門
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_src2) = 0 THEN
    RAISE EXCEPTION 'A8a3-G 碼錨:begin_charge_attempt 自己的取消守門(v_order.cancelled_at)不見了 ⇒ 我把它抄掉了;拒繼續';
  END IF;
  -- per-user 閘不得被動到(它本來就不受影響,而「不受影響」要有東西守著)
  IF position('AND o.payment_status <> ''paid''::public.payment_status' in v_src2) = 0 THEN
    RAISE EXCEPTION 'A8a3-G 碼錨:per-user 閘的 payment_status <> paid 不見了(本片不得動它);拒繼續';
  END IF;

  -- ACL:CREATE OR REPLACE 保留既有 proacl,而「保留」要驗過才算
  IF has_function_privilege('anon', 'public.find_active_sibling_own(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a3-G ACL:anon 執行得到其中一支;拒繼續';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.find_active_sibling_own(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a3-G ACL:authenticated 執行不到 find_active_sibling_own(客人的 preflight 會整條壞掉);拒繼續';
  END IF;

  RAISE NOTICE 'A8a3-G 驗收通過:prosrc 前置指紋符 / 兩支各恰 1 處 o.cancelled_at IS NULL / begin 自己的取消守門與 per-user 閘皆在 / ACL 保留(anon 零、authenticated 有)/ **四發 probe 皆過**(兩支函式 × 兩個世界;第四次修這句 —— 守門與它的自我描述是兩份會各自漂走的東西)';
END
$$;

COMMIT;
