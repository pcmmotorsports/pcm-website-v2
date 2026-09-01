-- ⟦b4-MANREFUNDNOOWNER⟧ 人工退款之後,訂單狀態終於會跟著改
--
-- 🛑 **本檔在 `docs/specs/`,不在 `supabase/migrations/`** —— 那個目錄底下每一支都會被
--    26 支 harness 的 provision 依序 apply;而檔頭寫「不要 apply」是給人看的,**跑它的是迴圈**。
--
-- ══ 給 Sean 的白話(貼之前先讀這一段)══════════════════════════════════════
--
-- 【它修什麼】你在後台登記一筆「現金/匯款退款」之後,那張訂單**還是寫著「已付款」**。
--   退了 400 的單,畫面上看起來像一毛都沒退。
--   🔴 **這不是未來式** —— 今天按下去就是這樣。
--
-- 【貼了會看到什麼】登記人工退款之後,那張單會自己變成:
--   · 退款金額 **等於或超過** 訂單總額 ⇒ 「已退款」
--   · 退了一部分 ⇒ 「部分退款」
--   而卡片退款那條路**完全沒有改變** —— 它本來就會這樣做,本檔只是讓人工退款也走同一條規則。
--
-- 【貼錯了怎麼還原】還原 SQL 在另一支檔:`2026-09-02-m4b-manual-refund-status-owner-ROLLBACK.sql`
--   (桌面上的 `還原-人工退款狀態-20260902.sql`)。**整支貼下去就對,不用挑段落。**
--   🔴 還原之後,人工退款又會變成不改狀態 —— 也就是今天的樣子。
--   🔴 它【不會】把已經被改對的訂單狀態改回去。
--
-- 【它會不會弄壞現在能用的東西】這一格我特別驗過,因為它差一點就會:
--   🛑 今天有一種單是「客人匯了款、後台登記了收款,而系統仍寫著**未付款**」
--     (那是另一件事 `⟦b4-NONCARDPAID1⟧`,還沒修)。
--   而這種單如果被人工退款,**照最直覺的寫法會直接報錯、整筆登記不進去**。
--   ⇒ 所以本檔多寫了一個分支:那種單**照舊不改狀態、也不報錯**。
--   ⇒ 📌 **它只多做「該做的那一半」,不順手去動另一件還沒修好的事。**
--
-- ══ 給下一個維護者 ════════════════════════════════════════════════════════
--
-- 🔴🔴 **檔名會騙人,而它是誠實的騙**:
--    `20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql` —— 檔名逐字 `record_calls_sync`,
--    而它 `:17` 逐字寫「只加這一行,其餘一字未改」。**它真的呼叫了那支同步器。**
--    🛑 而它呼叫的那支 **讀的是另一張表**:`pcm_sync_order_refund_payment_status` 只加總
--    `order_refunds`(`status='confirmed'`),而人工退款寫的是 `order_manual_refunds`。
--    ⇒ 實測(抽出函式體 48 行):`order_manual_refunds` **0 次**,
--      🟢 正對照 `order_refunds` **1 次** ⇒ 那個 0 不是尺沒動。
--    ⇒ 📌 **「A 呼叫了 B」與「B 做了那件事」是兩個宣稱,而檔名只答得出前一個。**
--    ⇒ ⇒ **任何用「有沒有接線」當判準的稽核,都會把這一格算成已修。**
--
-- 🔵 **為什麼是「同步器加總兩張表」,不是「把兩張表合併」**:
--    `order_manual_refunds` 的 `COMMENT`(`20260820010000:185-192`)逐字列出它**刻意沒有**
--    `status` / `bank_refund_id` / `rec_trade_id` 三樣,而每一樣都寫著「這不是還沒加」。
--    Sean 2026-08-20 `Q8=乙` 逐字「那只是記一筆帳」。
--    ⇒ **兩張表本來就該分開。要合的是【誰去加總它們】,不是表。**
--
-- ⚠️ **本檔動的是共用函式** —— `pcm_sync_order_refund_payment_status` 的呼叫端(實查):
--    `20260823020000` 內 **5 處**(`admin_record_manual_refund` 的步6 之後那一行是其中之一);
--    `apps/` 與 `packages/` 底下的產線碼 **0 處**(只有 `database.types.ts` 的型別宣告與一支測試提到名字)。
--    ⇒ 所以改它會同時改變**卡片退款**那條路的行為嗎?**不會** —— 卡片那半的算式一個字都沒動。

BEGIN;

-- ── 0. 前置閘:確認要改的是我以為的那一版 ────────────────────────────────
-- 🔴 不比 md5(那會被一個空白打敗),比**行為指紋**:那三個決定性的字面在不在。
DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置:找不到 pcm_sync_order_refund_payment_status(uuid) ⇒ 20260823010000/020000 還沒 apply,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'order_manual_refunds') > 0 THEN
    RAISE EXCEPTION '前置:那支函式【已經】讀 order_manual_refunds ⇒ 有人先做了或本檔已貼過。'
                    '重貼會把對方的版本蓋掉 ⇒ 停下來確認,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'AND status = ''confirmed''') = 0 THEN
    RAISE EXCEPTION '前置:卡片那半的算式不是我以為的形狀(找不到 status = confirmed)⇒ 有人動過它,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'domain 轉移表') = 0 THEN
    RAISE EXCEPTION '前置:那道 domain 閘的字面不見了 ⇒ 有人動過它,拒繼續';
  END IF;
END
$pre$;

-- ── 1. 同步器:加總兩本帳 ────────────────────────────────────────────────
-- 🔴 除了下面三處標了 ⟦b4-MANREFUNDNOOWNER⟧ 的地方,其餘逐字取自 `20260823020000:239`。
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_card   bigint;   -- ⟦b4-MANREFUNDNOOWNER⟧ 新增:卡片那半, 單獨留著給下面那個分支用
  v_manual bigint;   -- ⟦b4-MANREFUNDNOOWNER⟧ 新增:人工那半
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  SELECT COALESCE(SUM(refund_amount), 0) INTO v_card
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  -- ⟦b4-MANREFUNDNOOWNER⟧ 新增:人工退款那本帳。
  -- 🔴 `voided_at` 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不計。
  -- 🔵 這張表【刻意沒有 status】(它的 COMMENT 逐字寫著那不是還沒加)⇒ 沒有值域可篩,
  --    作廢那一欄是它唯一的「不算數」訊號。
  SELECT COALESCE(SUM(refund_amount), 0) INTO v_manual
    FROM public.order_manual_refunds
   WHERE order_id = p_order_id AND voided_at IS NULL;

  v_moved := v_card + v_manual;

  IF v_moved <= 0 THEN
    RETURN v_ps;
  END IF;

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    -- 🔴🔴 ⟦b4-MANREFUNDNOOWNER⟧ 新增分支 —— **而它是本檔最重要的一格**:
    --    今天有一種單是「客人匯款、後台登記了收款,而 payment_status 仍是 unpaid」
    --    (⟦b4-NONCARDPAID1⟧,未修)。那種單被人工退款時:
    --      · 改本檔【之前】:v_moved 恆為 0(同步器看不到人工那本帳)⇒ 提早 return ⇒ 不拋錯
    --      · 改本檔【之後】若沒有這個分支:v_moved > 0 ⇒ 撞下面那道 RAISE
    --        ⇒ 🛑 **整筆人工退款登記失敗** ⇒ 一個今天能用的流程被我弄壞。
    --    ⇒ 📌 所以:**只有人工那半有值時,照舊不改狀態、也不拋錯。**
    --    ⇒ 而卡片那半有值時,那道 RAISE 一個字都沒動 —— 它守的東西沒有變窄。
    IF v_card = 0 THEN
      RAISE LOG 'pcm_sync_order_refund_payment_status: 訂單 % 狀態 % 不在退款域, 而本次只有人工退款 ⇒ 不改狀態也不拋錯(⟦b4-MANREFUNDNOOWNER⟧;那種單的狀態本身是 ⟦b4-NONCARDPAID1⟧ 的缺口, 不是本檔的)', p_order_id, v_ps;
      RETURN v_ps;
    END IF;
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  IF v_ps <> 'refunded' AND v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

-- ── 2. 後置斷言(貼完看到最後那兩行 NOTICE 才算成功)──────────────────────
DO $post$
DECLARE v_src text; v_bare text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  -- 🔴 剝掉 `--` 註解再比對:否則「把碼刪掉、留下解釋它的註解」照樣通過。
  v_bare := pg_catalog.regexp_replace(v_src, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');

  IF pg_catalog.strpos(v_bare, 'order_manual_refunds') = 0 THEN
    RAISE EXCEPTION '後置:人工那本帳沒有被加總 ⇒ 本檔最重要的那一半沒有落地,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'voided_at IS NULL') = 0 THEN
    RAISE EXCEPTION '後置:少了「作廢的不算」那道篩 ⇒ 作廢過的退款會被算成錢真的退出去了,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'AND status = ''confirmed''') = 0 THEN
    RAISE EXCEPTION '後置:卡片那半的算式不見了 ⇒ 本檔把既有行為弄掉了,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'domain 轉移表') = 0 THEN
    RAISE EXCEPTION '後置:那道 domain 閘不見了 ⇒ 本檔把一道既有守門弄掉了,拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'v_card = 0') = 0 THEN
    RAISE EXCEPTION '後置:少了「只有人工退款時不拋錯」那個分支 ⇒ 貼下去會讓今天能用的登記流程開始失敗,拒繼續';
  END IF;

  RAISE NOTICE '⟦b4-MANREFUNDNOOWNER⟧ 後置斷言全過:兩本帳都加總 / 作廢不計 / 卡片算式與 domain 閘都還在 / 保護分支在';
  RAISE NOTICE '⟦b4-MANREFUNDNOOWNER⟧ ⚠️ 看到上面那一行 = 貼成功。沒看到 = 有問題, 不要當成功。';
END
$post$;

COMMIT;
