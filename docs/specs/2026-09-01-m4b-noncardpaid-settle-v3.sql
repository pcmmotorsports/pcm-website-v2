-- 🛑🛑🛑 **未完成 · 已停工 · 不得貼、不得 apply、不得當交件。** 🛑🛑🛑
--    2026-09-01 23:3x:主視窗 `-0a` 下令停手 —— **形狀第二次變了**
--    (v1 補一段程式 ⇒ v2 兩個 trigger【Sean 批的是這個】⇒ 本檔一個 trigger)
--    ⇒ 鐵則 8:形狀變了要重批。**在 Sean 重批之前這支檔不會往下寫。**
--    本檔目前【只有前半】:前置閘 + 重算器 + 一個 trigger。
--    **還沒有**:cron 那一節(第 2 節)、後置斷言、可執行的還原段。
--    決策題全文見 `docs/plans/2026-09-01-noncardpaid-settle-and-expire-guard-plan-v4.md`。
-- ════════════════════════════════════════════════════════════════════════
-- ⟦b4-NONCARDPAID1⟧ v3 —— 匯款/現金收款會翻狀態了, 而逾期 cron 不再取消【手上還有錢】的單
--
-- 🛑 **本檔在 `docs/specs/`, 不在 `supabase/migrations/`** —— provision 會 apply 那個目錄底下每一支,
--    而檔頭寫「不要 apply」是給人看的, **跑它的是迴圈**。
--
-- ══ 給 Sean 的白話(貼之前先讀這一段)══════════════════════════════════════
--
-- 【它修什麼】客人匯款或付現, 後台登記了收款 —— 而那張單的狀態【沒有跟著變】, 一直停在
--   「未付款」。隔天逾期程式看到「未付款」就把它取消掉。**錢在我們這裡, 而單被系統自己取消了。**
--
-- 【貼了會看到什麼】兩件事:
--   ① 登記匯款/現金收款之後, 那張單會自己變成「已付款」(收足)或「部分付款」(沒收足)。
--   ② 逾期程式從今以後【不碰手上還有錢的單】。卡片那條路本來就有這個保護, 匯款這條沒有 ——
--      這一片是把那個對稱補齊, 不是加一個新規則。
--
-- 🔴🔴 【一件要跟你講清楚的:你說「加兩個觸發器」, 而我交【一個】】
--   不是做不到 —— 是查下去發現**第二個早就有人做好了**:
--   `admin_record_manual_refund`(登記人工退款那支)自 2026-08-23 起就會呼叫
--   `pcm_sync_order_refund_payment_status` 把退款狀態同步好(`20260823020000`, 檔名逐字
--   `record_calls_sync`, 它 :17 寫「只加這一行, 其餘一字未改」)。
--   ⇒ 我再加一個, 會變成**第二個寫入端**, 而它用不同的算法 ——
--     實例:收 1000、人工退 400、卡片再退 600, 兩本帳合計已經退完,
--     而兩個寫入端各自只看自己那半 ⇒ 那張單會**永遠停在「部分退款」**。
--   ⇒ 📌 **所以少的那一個不是漏掉, 是【不該加】。**
--
-- 【貼錯了怎麼還原】第 6 節是**可以直接貼的 SQL**(不是註解)。
--   🔴 它會把逾期程式改回沒有保護的樣子 ⇒ 還原之後原本的缺陷會回來。
--   🔴 它【不會】把已經被改過的訂單狀態改回去 —— 那些是真實的收款事實。
--
-- 【今天有沒有真的踩到】🔴 **未知。**訂單表今早被清空過 ⇒「查到 0 筆」沒有判別力:
--   那個 0 在「從來沒發生過」與「發生過而資料被清掉了」上是同一個數字。
--
-- ⚠️ 【測試綠 ≠ 正式站一定對】驗證是在拋棄式測試庫上跑的, 而那個庫**套了所有還沒貼的 migration**
--   ⇒ 它上面會改 payment_status 的函式有 4 支, 而正式庫今天是 2 支。**兩個不同的世界。**
--
-- ══ 給下一個維護者 ════════════════════════════════════════════════════════
--
-- 本檔是 v2 被 codex 對抗審查判 **FAIL(20 must-fix)** 之後重寫的。三條最重要的:
--   🔴 ① v2 把 `expire_unpaid_orders` 的**成功心跳整段刪掉**了, 而它自稱「只加一句」。
--        成因:我從拋棄式庫抄函式體, 而**那個庫刻意跳過了 `20260828060000`(心跳那一代)**
--        ⇒ 抄到的是 `20260809160000` 的舊身體。
--        ⇒ 📌 **本檔改從 `20260828060000:189` 抄。動 DB 函式之前跑 `scripts/latest-definition-of.sh`。**
--   🔴 ② v2 的第二個 trigger 是第二個寫入端(見上面給 Sean 那段)⇒ **拿掉**。
--   🔴 ③ v2 的 cron 腿寫成「有沒有收款列」⇒ 收 1000 再全額沖銷(淨額 0)的單會被**永久擋住**,
--        它再也不會被取消。⇒ 本檔改成**淨額 > 0**。
--
-- 🔴 **本檔【不寫】任何退款狀態**(`refunded` / `partiallyRefunded`)——
--    那兩個值屬於退款管線(`pcm_sync_order_refund_payment_status`)。
--    而只要那張單有任何退款活動, 本檔的重算器**直接交還**、一個字都不碰。
--    ⇒ 這條是「只有一個寫入端負責一個值域」的具體形狀, 不要為了「順手也處理一下」而放寬。
--
-- 驗收:`PORT=<port> bash scripts/noncardpaid-verify.sh all /tmp/nc`

BEGIN;

-- ── 0. 前置閘(fail-closed)────────────────────────────────────────────────
-- 🔴 codex A:59:貼檔身分若不是 owner, 三支 SECURITY DEFINER 會以錯的身分建立,
--    而它們要呼叫的 OP6a 是零 GRANT ⇒ 呼叫失敗被 EXCEPTION 吞掉
--    ⇒ **表面收款成功, 而狀態功能整片是 no-op** —— 那正是本片最怕的形狀。
DO $pre$
DECLARE v_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION '前置:找不到 admin_compute_order_settlement(uuid)(OP6a 還沒 apply)⇒ 拒繼續';
  END IF;
  IF pg_catalog.current_user::text <> v_owner THEN
    RAISE EXCEPTION '前置:本檔要以 % 的身分貼(現在是 %)。'
                    '理由:本檔三支 SECURITY DEFINER 要呼叫零 GRANT 的 OP6a —— '
                    '身分不對時它們建得起來、跑起來會被例外吞掉 ⇒ 表面成功而整片 no-op。拒繼續',
                    v_owner, pg_catalog.current_user;
  END IF;
  IF to_regclass('public.sweeper_heartbeat') IS NULL THEN
    RAISE EXCEPTION '前置:public.sweeper_heartbeat 不在 ⇒ 本檔重建的 cron 會寫不了心跳。'
                    '先套 20260817070000 與 20260828060000。拒繼續';
  END IF;
  IF pg_catalog.strpos(
       (SELECT p.prosrc FROM pg_catalog.pg_proc p
         WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure),
       'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '前置:正式庫的 expire_unpaid_orders【還沒接心跳】⇒ 它不是 20260828060000 那一代。'
                    '本檔重建的版本含心跳 ⇒ 貼下去等於順便把那一片也上了, 而那不是本片的授權範圍。'
                    '先確認要對哪一代下手(scripts/latest-definition-of.sh expire_unpaid_orders)。拒繼續';
  END IF;
END
$pre$;

-- ── 1. 重算器 ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_status   public.payment_status;
  v_res      jsonb;
  v_verdict  text;
  v_received bigint;
  v_new      public.payment_status;
BEGIN
  -- 🔴🔴 codex A:88 —— **整段包在一個 EXCEPTION 裡, 不是只包 OP6a 那一發。**
  --    v2 只包了 OP6a ⇒ 之後的 SUM / UPDATE / 下游 trigger 任一拋錯, 例外都在保護區外面
  --    ⇒ AFTER trigger 冒錯 ⇒ **外層那筆真實收款 INSERT 一起 rollback**。
  --    ⇒ 📌 那不符合 Sean 那句「錢收了就要記, 不該取決於另一支計算程式跑不跑得動」——
  --      而 v2 的碼看起來完全像在遵守它。
  BEGIN
    SELECT o.payment_status INTO v_status FROM public.orders o WHERE o.id = p_order_id;
    IF v_status IS NULL THEN RETURN; END IF;

    -- 🔴 可判定集:只有這三個值本片才動。(與 OP6a 的前提 P1 逐字相同, 不是我另外挑的。)
    IF v_status NOT IN ('unpaid'::public.payment_status,
                        'paid'::public.payment_status,
                        'partiallyPaid'::public.payment_status) THEN
      RETURN;
    END IF;

    -- 🔴🔴 **有任何退款活動 ⇒ 交還給退款管線, 本片一個字都不碰。**
    --    理由不是保守, 是【一個值域只能有一個寫入端】:
    --    `pcm_sync_order_refund_payment_status` 已經是退款狀態的寫入端,
    --    而 `admin_record_manual_refund` 自 20260823020000 起就會呼叫它。
    --    本片若也寫, 兩邊會用不同的分母 ⇒ codex 演過:收 1000、人工退 400、卡片退 600,
    --    兩本帳合計退完而狀態永遠停在 partiallyRefunded。
    IF EXISTS (SELECT 1 FROM public.order_manual_refunds m
                WHERE m.order_id = p_order_id AND m.voided_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.order_refunds r WHERE r.order_id = p_order_id) THEN
      RAISE LOG '[pcm_noncard_settle] order=% 有退款活動 ⇒ 交還退款管線, 本片不動', p_order_id;
      RETURN;
    END IF;

    v_res := public.admin_compute_order_settlement(p_order_id);
    v_verdict := v_res ->> 'verdict';

    SELECT pg_catalog.coalesce(pg_catalog.sum(p.amount), 0) INTO v_received
      FROM public.order_payments p WHERE p.order_id = p_order_id;

    IF v_verdict = 'settled' THEN
      v_new := 'paid'::public.payment_status;
    ELSIF v_verdict = 'underpaid' THEN
      IF v_received > 0 THEN
        v_new := 'partiallyPaid'::public.payment_status;
      ELSE
        v_new := 'unpaid'::public.payment_status;   -- 收款被沖銷光 ⇒ 回到原點
      END IF;
    ELSE
      -- `overpaid`:payment_status 值域裡沒有對應的值(恰 5 個)⇒ 開一列給人看, 不猜。
      -- 其餘(needs_human 等):它自己宣告算不清 ⇒ 不該由它決定終態。
      -- 🛑 而「不翻是安全的」依賴第 2 節那條 cron 腿 —— 沒有它, 這種單隔天照樣被取消。
      RAISE LOG '[pcm_noncard_settle] order=% verdict=% ⇒ 不翻狀態', p_order_id, v_verdict;
      RETURN;
    END IF;

    -- 🔴 codex A:73 —— **不用 `SELECT … FOR UPDATE`。**
    --    子表 INSERT 會因 FK 先持有父列 KEY SHARE;AFTER trigger 再升成 FOR UPDATE
    --    ⇒ 兩個 session 同時進來可形成鎖升級死結 ⇒ 其中一筆真實收款被 abort。
    --    ⇒ 改成【條件式 UPDATE】:不先讀後寫, 由 WHERE 自己守住可判定集。
    --    ⚠️ 代價明寫:兩發並行時是「後寫的贏」, 而兩發都讀完整的 SUM ⇒ 最後一發是對的。
    --      這不是序列化保證, 是收斂性 —— 不要把它讀成前者。
    UPDATE public.orders o
       SET payment_status = v_new, updated_at = pg_catalog.now()
     WHERE o.id = p_order_id
       AND o.payment_status IN ('unpaid'::public.payment_status,
                                'paid'::public.payment_status,
                                'partiallyPaid'::public.payment_status)
       AND o.payment_status IS DISTINCT FROM v_new;
  EXCEPTION WHEN OTHERS THEN
    -- 🎯 Sean 拍的那一條落在這裡:任何一步炸掉 ⇒ 收款那一列照樣留下, 狀態不動。
    RAISE LOG '[pcm_noncard_settle] order=% 重算整段失敗(%), 收款事實保留、狀態不動', p_order_id, SQLERRM;
    RETURN;
  END;
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM anon, authenticated, authenticator, service_role;

-- 🔴 只有一個掛點(理由見檔頭給 Sean 那段)。
-- 🔵 為什麼是 AFTER INSERT 而不是 INSERT OR UPDATE OR DELETE:`order_payments` 是 append-only
--    (`order_payments_immutable_bu` 擋 UPDATE、`order_payments_no_delete_bd` 擋 DELETE)
--    ⇒ 沖銷是插一列負數。寫 UPDATE/DELETE 進去只會是死碼, **而死碼會被後人讀成「這裡有處理」**。
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $tg$
BEGIN
  PERFORM public.pcm_noncard_settle_recompute(NEW.order_id);
  RETURN NULL;
END
$tg$;

REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM anon, authenticated, authenticator, service_role;

DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
CREATE TRIGGER pcm_noncard_settle_after_payment_ai
  AFTER INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_noncard_settle_after_payment();
