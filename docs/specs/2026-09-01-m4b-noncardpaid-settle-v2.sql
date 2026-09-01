-- 🛑🛑🛑 **已知不對 · 不得貼、不得 apply、不得當交件。** 🛑🛑🛑
--    2026-09-01 23:2x:codex 對抗審查判 **FAIL —— 20 個 must-fix + 2 nit**。
--    三條最重要的:①它把 `expire_unpaid_orders` 的【成功心跳整段刪掉】而自稱只加一句
--    ②第二個 trigger 是【第二個 payment_status 寫入端】(那半 2026-08-23 已有人接)
--    ③cron 腿寫成「有沒有收款列」⇒ 淨額 0 的單會被【永久擋住】。
--    ⚠️ **本檔保留不刪** —— 它是 plan v3/v4 的證物, 而刪掉會讓那兩份 plan 指向不存在的東西。
--    後續在 `…-settle-v3.sql`(亦未完成)與 `docs/plans/…-plan-v4.md`。
-- ════════════════════════════════════════════════════════════════════════
-- ⟦b4-NONCARDPAID1⟧ v2 —— 匯款/現金收款會翻狀態了, 而逾期 cron 不再取消收過錢的單
--
-- 🛑 **本檔在 `docs/specs/`, 不在 `supabase/migrations/` —— 而那是刻意的。**
--    那 26 支 harness 的 provision 會依序 apply `supabase/migrations/` 底下【每一支】
--    ⇒ 一支還沒被 Sean 貼過的檔放進去, 每一發 provision 都會跑它。
--    而檔頭寫「不要 apply」是給人看的, **跑它的是迴圈**。
--
-- ── 給 Sean 的白話(貼之前先讀這一段)──────────────────────────────────
--
-- 【它修什麼】客人匯款或付現, 後台登記了收款 —— 而那張單的狀態【沒有跟著變】,
--   一直停在「未付款」。隔天逾期程式看到「未付款」就把它取消掉。
--   **錢在我們這裡, 而單被系統自己取消了。**
--
-- 【貼了會看到什麼】三件事:
--   ① 登記匯款/現金收款之後, 那張單會自己變成「已付款」(收足)或「部分付款」(沒收足)。
--   ② 逾期程式從今以後【不碰任何收過錢的單】—— 卡片那條路本來就有這個保護, 匯款這條路沒有。
--      這一片是把那個對稱補齊, 不是加一個新規則。
--   ③ 沖銷收款、登記人工退款, 狀態也會跟著重算。
--
-- 【貼錯了怎麼還原】整段還原 SQL 在本檔最後(第 5 節), 直接貼那一段。
--   它只會拿掉本檔加的兩個 trigger 與一支函式, 並把逾期程式改回原樣。
--   🔴 它【不會】把已經被改過的訂單狀態改回去 —— 那些是真實的收款事實, 不該被自動翻回去。
--
-- 【今天有沒有真的踩到】🔴 **未知。**訂單表今早被清空過, 所以「查到 0 筆」沒有判別力 ——
--   那個 0 在「從來沒發生過」與「發生過而資料被清掉了」上是同一個數字。
--
-- ⚠️ 【一件要先知道的】這一片在拋棄式測試庫上全綠, 而**那個庫與正式站不是同一個世界**:
--   測試庫套了所有還沒貼的 migration ⇒ 它上面會改 payment_status 的函式有 4 支,
--   而正式庫今天只有 2 支。**測試綠 ≠ 正式站一定對。**
--
-- ── 給下一個維護者 ────────────────────────────────────────────────────
--
-- 🔴🔴 **不要去改 `admin_compute_order_settlement`(OP6a)。**
--   本檔多算了一個面(`order_manual_refunds`), 而那**不是因為 OP6a 漏了** ——
--   是那張表**不在它的分母裡**:它算的是卡片那條路的結算判定, 而人工退款是另一條帳。
--   實測(2026-09-01, 拋棄式 PG):OP6a 的 prosrc 提到 `order_manual_refunds` **0 次**,
--   🟢 而同一把尺在同一份 prosrc 上找到 `order_payments` **7 次**(⇒ 那個 0 不是尺沒動)。
--   實跑更硬:同一張單登記人工退款 400 之後, OP6a 的答案**一個字都沒變**(settled / net=0)。
--   ⇒ 📌 所以一個只會呼叫 OP6a 的 trigger 掛在那張表上, 會很誠實地跑起來而算出一樣的答案
--     ⇒ **它不是壞掉, 它是一個 no-op。而 no-op 與正確在測試上長得一樣, 只要你沒測那一格。**
--   ⇒ 🛑 **把那個面搬進 OP6a 是另一片、風險大得多(它已 apply、被多處呼叫)。不要順手做。**
--
-- 🎯 **Sean 2026-09-01 拍板(逐字)**:
--   ·「加兩個資料庫觸發器」⇒ 本檔恰好兩個(`order_payments` 一個、`order_manual_refunds` 一個)。
--   ·「錢收了就要記, 不該取決於另一支計算程式跑不跑得動」
--     ⇒ 重算包在 EXCEPTION 裡:計算器炸掉 ⇒ **收款那一列照樣留下, 狀態不動**, 不整筆回滾。
--
-- ⚠️ **順序風險(券那一片)**:券的兌換 trigger 只接受 `OLD.payment_status = 'unpaid'`,
--   而本檔會產生 `partiallyPaid` 中間態 ⇒ 兩片誰後貼誰踩到。
--   🔵 實查:券那一片今天**還沒 apply**(全庫零 coupon/redeem trigger)⇒ 今天貼本檔撞不到。
--   ⇒ 而那條協調已交主視窗 `-0a`(2026-09-01, 它逐字回「券那條線的協調我接」)。
--
-- 驗收:`PORT=<port> bash scripts/noncardpaid-verify.sh all /tmp/nc`
--   —— 兩個世界(修法前缺陷可重現 / 修法後)+ 三發突變證人。**harness 先於本檔寫。**

BEGIN;

-- ── 1. 重算器 ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status   public.payment_status;
  v_res      jsonb;
  v_verdict  text;
  v_received bigint;
  v_manual   bigint;
  v_new      public.payment_status;
BEGIN
  -- 鎖住那一列:同一張單的兩筆收款同時進來時, 兩發重算不會互相蓋掉。
  SELECT o.payment_status INTO v_status FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN;   -- 單不見了(理論上不會, 但 trigger 不該為此讓收款回滾)
  END IF;

  -- 🔴 可判定集:只有這三個值本片才動。`refunded` / `partiallyRefunded` 是退款領域的終態,
  --    它們一旦寫上去就交給人 —— 本片不把它們翻回來。
  --    (這三個值與 OP6a 的前提 P1 逐字相同 ⇒ 兩邊本來就對齊, 不是我另外挑的。)
  IF v_status NOT IN ('unpaid'::public.payment_status,
                      'paid'::public.payment_status,
                      'partiallyPaid'::public.payment_status) THEN
    RETURN;
  END IF;

  -- 🎯 Sean 拍的那一條:計算器跑不動【不得】讓收款那一列跟著回滾。
  --    plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有重算, 不含外面那筆 INSERT。
  BEGIN
    v_res := public.admin_compute_order_settlement(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[pcm_noncard_settle] order=% 重算失敗(%), 收款事實保留、狀態不動', p_order_id, SQLERRM;
    RETURN;
  END;
  v_verdict := v_res ->> 'verdict';

  SELECT coalesce(pg_catalog.sum(p.amount), 0) INTO v_received
    FROM public.order_payments p WHERE p.order_id = p_order_id;

  -- 🔴 OP6a 看不到這一張表(理由見檔頭)⇒ 本檔【只】多算這一個面。
  --    voided_at 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不計。
  SELECT coalesce(pg_catalog.sum(m.refund_amount), 0) INTO v_manual
    FROM public.order_manual_refunds m
   WHERE m.order_id = p_order_id AND m.voided_at IS NULL;

  IF v_manual > 0 THEN
    -- 有人工退款 ⇒ 進退款領域。與卡片那條路的 `pcm_sync_order_refund_payment_status`
    -- 同一個形狀(全退 ⇒ refunded、部分 ⇒ partiallyRefunded), 這一片是把對稱補齊。
    IF v_manual >= v_received THEN
      v_new := 'refunded'::public.payment_status;
    ELSE
      v_new := 'partiallyRefunded'::public.payment_status;
    END IF;
  ELSIF v_verdict = 'settled' THEN
    v_new := 'paid'::public.payment_status;
  ELSIF v_verdict = 'underpaid' THEN
    -- 收了一部分 ⇒ partiallyPaid;一毛都沒收(或被沖銷光)⇒ 回到 unpaid
    IF v_received > 0 THEN
      v_new := 'partiallyPaid'::public.payment_status;
    ELSE
      v_new := 'unpaid'::public.payment_status;
    END IF;
  ELSE
    -- 🔴 `overpaid` 與 `needs_human` 一律【不翻】。
    --    overpaid:payment_status 的值域裡【沒有】對應的值(unpaid/paid/partiallyPaid/
    --      refunded/partiallyRefunded 共 5 個)⇒ 開一列給人看, 不猜一個最接近的。
    --    needs_human:它自己宣告算不清 ⇒ 不該由它決定終態。
    --    🛑 而「不翻是安全的」這句話【依賴第 3 節那條 cron 腿】—— 沒有它, 這兩種單
    --      仍然是 unpaid ⇒ 隔天照樣被取消 ⇒ 缺陷的形狀與今天一模一樣, 只是變窄。
    RAISE LOG '[pcm_noncard_settle] order=% verdict=% ⇒ 不翻狀態(值域無對應值或算不清)', p_order_id, v_verdict;
    RETURN;
  END IF;

  IF v_new IS DISTINCT FROM v_status THEN
    UPDATE public.orders SET payment_status = v_new, updated_at = pg_catalog.now()
     WHERE id = p_order_id;
    RAISE LOG '[pcm_noncard_settle] order=% % -> % (verdict=% received=% manual=%)',
              p_order_id, v_status, v_new, v_verdict, v_received, v_manual;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM anon, authenticated, authenticator, service_role;

-- ── 2. 兩個掛點 ──────────────────────────────────────────────────────────
-- 🔴 為什麼是 AFTER INSERT 而不是 AFTER INSERT OR UPDATE OR DELETE:
--    `order_payments` 是 append-only —— `order_payments_immutable_bu` 擋 UPDATE、
--    `order_payments_no_delete_bd` 擋 DELETE(2026-09-01 實查兩支都在且啟用)。
--    ⇒ 沖銷是【插一列負數】, 不是改舊列 ⇒ AFTER INSERT 就涵蓋了三條路裡的兩條。
--    ⇒ 📌 寫 UPDATE/DELETE 進去不會更安全, 只會是兩段永遠不執行的碼 —— 而死碼會被
--       後人讀成「這裡有處理」。

CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $tg$
BEGIN
  PERFORM public.pcm_noncard_settle_recompute(NEW.order_id);
  RETURN NULL;   -- AFTER trigger 的回傳值被忽略
END
$tg$;

CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_after_manual_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $tg$
BEGIN
  PERFORM public.pcm_noncard_settle_recompute(NEW.order_id);
  RETURN NULL;
END
$tg$;

REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_manual_refund() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_manual_refund() FROM anon, authenticated, authenticator, service_role;

DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
CREATE TRIGGER pcm_noncard_settle_after_payment_ai
  AFTER INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_noncard_settle_after_payment();

DROP TRIGGER IF EXISTS pcm_noncard_settle_after_manual_refund_ai ON public.order_manual_refunds;
CREATE TRIGGER pcm_noncard_settle_after_manual_refund_ai
  AFTER INSERT ON public.order_manual_refunds
  FOR EACH ROW EXECUTE FUNCTION public.pcm_noncard_settle_after_manual_refund();

-- ── 3. 逾期 cron:補上匯款那條腿 ─────────────────────────────────────────
-- 🔴 本節【只加一句】。其餘每一行逐字取自現行定義(pg_get_functiondef 讀出來的那一份),
--    連註解都沒有動 —— 因為那些註解裡住著別人的拍板紀錄與誠實邊界。
--    加的那一句在下面用 `np` 這個別名, 而 harness 的突變證人 M3 就以它當錨。
CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 誠實邊界(codex 關卡2):本函式**完全信任 `orders.created_at`**,而那一欄沒有不可變守門 ——
  --    owner / migration 把它回填成舊日期,新單會提早被取消;改成未來,則永遠掃不到。
  --    不加守門的理由:owner 本來就能繞過任何 DB 層防線,為此加欄位級 trigger 的代價大於收益。
  -- p_limit fail-safe:NULL / <=0 一律退回 1(不接受「無上限」;0-worker 會靜默不處理)。
  -- ⚠️ 誠實邊界(codex 關卡2 nit):`LIMIT` 限的是**改幾列**,不是**掃幾列** —— 歷史 paid/failed 單一多,
  --    找候選的掃描成本仍會長,且本函式沒有 statement_timeout。現況存量 0、每小時一次 ⇒ 可接受;
  --    真的長起來時的修法 = 對 (payment_status, cancelled_at, created_at) 加部分索引 + 設 statement_timeout。
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  WITH target AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.payment_status = 'unpaid'::public.payment_status
       AND o.cancelled_at IS NULL                                    -- 已取消/已失效 → 不重複寫(冪等)
       AND o.created_at < pg_catalog.now() - interval '1 day'        -- 🔴 1 天 = Sean 2026-08-09 逐字「1天」(落 memory project_m4b-b2-shipments-db-decisions:79;
       --    ⚠️ 那份 memory 內部編號 Q2 指的是天數,與本 plan §6 的 Q2「失效單不復活」是**不同的兩題**,別混)。
       --    重估觸發見檔頭。
       -- 🔴 安全核心:有任何非終態 attempt = 錢可能在途 ⇒ 一律不碰(留給對帳/人工)。
       --    條件與 admin_cancel_order 步7 逐字相同 ⇒ 兩個寫入端維持同一條不變量。
       --    ⚠️ 代價(code-reviewer N7):`released` 也被這條擋住 ⇒ **帶 released attempt 的單永遠不會被失效**。
       --    這是保守的正確選擇(released = 鎖已釋、仍在低頻對帳到 terminal),但它意味著那類單
       --    **在本片之後仍然沒有終點** —— 那正是 Q7/L5 要處理的「放棄型」殭屍,不在件① 範圍。
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_charge_attempts a
              WHERE a.order_id = o.id
                AND a.status <> 'failed'
           )
       -- 🔴🔴 ⟦b4-NONCARDPAID1⟧ 2026-09-01 新增:**匯款/現金那條腿**。
       --    上面那一句是卡片那條路的保護, 而匯款這條路一直沒有對應的那一句
       --    ⇒ 客人匯了款、後台登記了, 而這支函式看不到那筆錢 ⇒ 隔天把單取消掉。
       --    ⇒ 📌 所以本片不是「加一個新保護」, 是【補齊一個已經存在的對稱】——
       --      而那自帶正對照:改完之後兩條腿的形狀要長得一樣。
       --    ⚠️ 這裡刻意**不篩金額、不篩 rail**:有任何一列收款紀錄(含沖銷用的負數列)
       --      就交給人 —— 一張錢進出過的單, 不該由排程決定它的終點。
       AND NOT EXISTS (
             SELECT 1 FROM public.order_payments np
              WHERE np.order_id = o.id
           )
     ORDER BY o.created_at                                            -- 最舊的先處理(可預期、便於分批)
     LIMIT p_limit
     -- 🔴 字面精確(codex 關卡2 nit):SKIP LOCKED 只保證**本函式**跳過已被別人鎖住的列;
     --    若本函式先拿到鎖,後來的 admin 仍會等。稱「互不阻塞」不實,實際是「本函式不等別人」。
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'payment_expired',
         updated_at       = pg_catalog.now()
    FROM target t
   WHERE o.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- 🔴 觀測點(plan §4-6 驗收條件):每次執行都留一行,零 PII(只有筆數與上限)。
  --    沒有它的話,「掃到 0 筆」與「這支根本沒被呼叫」在 DB 側分不出來 ——
  --    而 cron.job_run_details 的 return_message 對 SELECT 只會記 command tag、不記筆數。
  RAISE LOG '[expire_unpaid_orders] expired=% limit=%', v_count, p_limit;
  RETURN v_count;
END;
$function$;

-- ── 4. 後置斷言(貼完看到這些 NOTICE 才算成功)────────────────────────────
DO $post$
DECLARE v_n integer; v_src text;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname LIKE 'pcm_noncard%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '後置:本片 trigger 共 % 支(預期恰 2 —— Sean 逐字說的是兩個)', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.order_payments'::regclass
                    AND t.tgname = 'pcm_noncard_settle_after_payment_ai' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '後置:order_payments 那支 trigger 不在或未啟用';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.order_manual_refunds'::regclass
                    AND t.tgname = 'pcm_noncard_settle_after_manual_refund_ai' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '後置:order_manual_refunds 那支 trigger 不在或未啟用';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'payment_charge_attempts') = 0 THEN
    RAISE EXCEPTION '後置:卡片那條腿不見了 ⇒ 本片把既有保護弄掉了, 拒繼續';
  END IF;
  IF pg_catalog.strpos(v_src, 'np.order_id = o.id') = 0 THEN
    RAISE EXCEPTION '後置:匯款那條腿不在 ⇒ 這一片最重要的那一半沒有落地';
  END IF;

  -- 🔴 ACL 閉世界:三支函式對 anon/authenticated/authenticator/service_role 都應為零。
  --    它們只被 trigger 呼叫, 沒有任何呼叫端需要 EXECUTE。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_proc p, unnest(ARRAY['anon','authenticated','authenticator','service_role']) r
   WHERE p.proname IN ('pcm_noncard_settle_recompute','pcm_noncard_settle_after_payment',
                       'pcm_noncard_settle_after_manual_refund')
     AND pg_catalog.has_function_privilege(r, p.oid, 'EXECUTE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '後置:本片三支函式仍有 % 項具名 EXECUTE ⇒ 兩道 REVOKE 沒收乾淨', v_n;
  END IF;

  RAISE NOTICE '⟦b4-NONCARDPAID1⟧ 後置斷言全過:兩支 trigger 啟用中 / cron 兩條腿都在 / 三支函式零具名 EXECUTE';
  RAISE NOTICE '⟦b4-NONCARDPAID1⟧ ⚠️ 看到上面那一行 = 貼成功。沒看到 = 有問題, 不要當成功。';
END
$post$;

COMMIT;

-- ── 5. 還原(貼錯了就貼這一段)──────────────────────────────────────────
-- 🔴 它【不】把已經被改過的訂單狀態改回去 —— 那些是真實的收款事實。
-- 🛑 而它會把逾期 cron 改回【沒有匯款那條腿】的版本 ⇒ 還原之後, 原本的缺陷會回來。
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
-- DROP TRIGGER IF EXISTS pcm_noncard_settle_after_manual_refund_ai ON public.order_manual_refunds;
-- DROP FUNCTION IF EXISTS public.pcm_noncard_settle_after_payment();
-- DROP FUNCTION IF EXISTS public.pcm_noncard_settle_after_manual_refund();
-- DROP FUNCTION IF EXISTS public.pcm_noncard_settle_recompute(uuid);
-- -- 而 pcm_cron.expire_unpaid_orders 要改回 20260828060000 那一版:
-- -- 直接重貼 supabase/migrations/20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql
-- COMMIT;
