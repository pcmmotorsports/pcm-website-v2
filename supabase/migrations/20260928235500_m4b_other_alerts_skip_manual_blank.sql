-- 20260928235500_m4b_other_alerts_skip_manual_blank.sql
-- ⟦b4-MANUALBLANKSTUCK⟧ 第二支:未付款取消信的告警也不再把「手動建單留白」算成沒有收件人
-- (2026-09-28 主視窗派工,a0 寫;第一支是 20260928235000 訂單成立信那兩支)。
--
-- 🔴 同一個病:20260905210000 讓未付款取消信、更正單號信的 pending view 排除「manual_* 且 notification_email 空白」
--    ⇒ 那種單不進掃描面、不會有 outbox 列(正式庫唯讀實查:manual_no_recipient 的 skip 列只出現在部分退款信)。
--    而 get_order_unpaid_cancelled_gap_counts 直接讀 orders,no_recipient_count 只看「兩個信箱都空」
--    ⇒ 手動單兩個信箱都空時被永久誤叫(Fable R1 找到)。
-- ✅ 修法:pending_count、no_recipient_count 都加上與 pending view 一字不差的條件
--    (pending_count 是脈絡數字,一起排除才與 view 一致,同第一支的 paid_no_email_count)。
-- ⛔ 不動 get_tracking_corrected_gap_counts(第二版曾一起改,Fable R1 C1 指出):它的 no_recipient_count 讀
--    pcm_tracking_correction_candidates,那個 view 從 20260914090000 起就已排除 manual 留白(正式庫唯讀確認 viewdef 含
--    manual_line)⇒ 那一支沒有這個誤報,加條件只是恆真的重複。
-- 🔴 函式體用腳本從最新一代機械抽出、只插入那一段,其餘逐字不變;前置閘核對正式庫函式體 md5
--    (唯讀實查:1a404283… 與 20260916030000 相同)。
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 照原文保留 SECURITY DEFINER、STABLE、SET search_path = ''。
--    owner 與 EXECUTE 權限(postgres、payment_confirmer)會保留,後置閘核對。
-- 不動任何資料表、不動 view。退回:supabase/rollbacks/20260928235500-rollback.sql。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  v_unp text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_unp FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_order_unpaid_cancelled_gap_counts(timestamptz)');
  IF v_unp IS DISTINCT FROM '1a4042834023367339e5cb656b5a3238' THEN
    RAISE EXCEPTION '前置閘:get_order_unpaid_cancelled_gap_counts 本體 md5 = %,不是 20260916030000 那一代(1a404283…)⇒ 有人改過,停下重看', v_unp;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.get_order_unpaid_cancelled_gap_counts(
  p_cutoff timestamptz
)
RETURNS jsonb
-- 🔴 `plpgsql` 而不是 `sql`:純 SQL 函式沒辦法 RAISE ⇒ NULL 參數只能被安靜吞掉,
--    而 `>= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**, 而 0 正是「一切正常」的樣子。
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 **單一來源** —— 不在這裡寫第三份空白字集。
  --    `20260901070000` 那片的產出逐字是「解法不是加寬那一份, 是**讓只剩一份**」
  --    ⇒ 我手寫一份 = 製造它剛消滅掉的東西。
  JS_WS constant text := public.pcm_js_trim_whitespace();
  v_result jsonb;
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_order_unpaid_cancelled_gap_counts:p_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **脈絡, 不是告警**:未付款、已被員工取消、在起始線之後, 而取消信那一列還沒被建出來。
    --    🛑 **這個數 > 0 是【正常】的** —— 下一輪 scanner 就會把它們排進去。
    --    它存在的理由是:沒有它, 下面那個 `no_recipient` 的 0 在
    --    「一切正常」與「這裡根本沒有取消單」之間分不出來。
    'pending_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_status = 'unpaid'
          AND o.cancelled_at IS NOT NULL
          AND o.cancelled_at >= p_cutoff
          -- ⛔ ~~AND o.created_at >= p_cutoff~~(20260915210000, Sean Q8 甲:看取消時間, 不看成立時間;與 scanner 一致)
          -- 🔴 逾時自動取消不算(與 pcm_unpaid_cancelled_email_pending 同一條, codex R1 MF1)
          AND o.cancelled_reason IS DISTINCT FROM 'payment_expired'
          -- 🔴 **身分判準不讀 cancelled_reason 的值**(20260916030000 起看整單取消稽核列的 after.closed:RPC 寫的布林, 不是員工打的字)。
          --    理由:員工七值裡的 `other` 後面接的是**員工自己打的一段字**
          --    ⇒ 拿 `cancelled_reason` 當身分 = 讓一個人打什麼字決定另一批客人收不收得到信。
          --    ⚠️ 而這個判準有它自己的脆弱點, 全文在
          --      `packages/ports/src/IUnpaidCancelledOrderScanner.ts` 檔頭。
          -- 🔴 20260916030000:身分判準 = 員工整單取消的稽核列(與 pcm_unpaid_cancelled_email_pending 同一條)
          AND EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.action = 'order.cancel'
                   AND a.target = 'order:' || o.id::text
                   AND a.after ->> 'closed' = 'true')
          -- ⟦b4-MANUALBLANKSTUCK⟧ 20260928235500:手動建單留白 = 不寄(Sean 拍板)⇒ 本來就不會有 outbox 列,不算缺口。
          --    條件與 20260905210000 pending view 那一段一字不差。
          AND (
                o.order_source IS NULL
             OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
             OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
              )
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_unpaid_cancelled'
                   -- 🔴 codex R2 MF2:與 pcm_unpaid_cancelled_email_pending 的 anti-join 逐字同一份 skip 清單。
                   --    少了它:排信後兩個信箱被清空 ⇒ 那列落 recipient_stale_at_send ⇒ view 放行而這裡不算 ⇒ 不寄也不告警。
                   AND COALESCE(e.last_error_code, '') NOT IN (
                         'shipment_voided',
                         'tracking_superseded',
                         'bank_order_not_mailable_at_send',
                         'bank_order_snapshot_stale',
                         'recipient_stale_at_send'
                       ))),

    -- 🔴🔴 **這一個才是告警的主詞**:上面那一群裡, **兩個信箱都空**的。
    --    ⇒ scanner 撈到它也 enqueue 不了(use-case 落 `noRecipient` 桶)
    --    ⇒ 📌 **它不會自己好** —— 那張單沒有信箱, 下一輪、下下輪都一樣
    --    ⇒ ✅ 所以「有一封就叫」套在這一格上不會變噪音。
    -- ⚠️ 兩個候選信箱的順序與 adapter 一致:`orders.notification_email` 優先,
    --    退回 `customers.email`(LEFT JOIN ⇒ 沒有 customer 也算「空」)。
    -- 🔴 `NULLIF` 不加 `pg_catalog.` 前綴, 而那不是漏寫 —— 它是**SQL 文法構造**不是函式,
    --    不受 `search_path = ''` 影響、也不能加 schema 前綴(`btrim` / `count` 是真函式 ⇒ 要加)。
    --    📌 姊妹那支的作者踩過這一格, 而抓到它的是【真的餵給 psql】不是靜態檢查。
    'no_recipient_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'unpaid'
          AND o.cancelled_at IS NOT NULL
          AND o.cancelled_at >= p_cutoff
          -- ⛔ ~~AND o.created_at >= p_cutoff~~(20260915210000, Sean Q8 甲:看取消時間, 不看成立時間;與 scanner 一致)
          -- 🔴 逾時自動取消不算(與 pcm_unpaid_cancelled_email_pending 同一條, codex R1 MF1)
          AND o.cancelled_reason IS DISTINCT FROM 'payment_expired'
          -- 🔴 20260916030000:身分判準 = 員工整單取消的稽核列(與 pcm_unpaid_cancelled_email_pending 同一條)
          AND EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.action = 'order.cancel'
                   AND a.target = 'order:' || o.id::text
                   AND a.after ->> 'closed' = 'true')
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          -- ⟦b4-MANUALBLANKSTUCK⟧ 20260928235500:手動建單留白 = 不寄(Sean 拍板)⇒ 本來就不會有 outbox 列,不算缺口。
          --    條件與 20260905210000 pending view 那一段一字不差。
          AND (
                o.order_source IS NULL
             OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
             OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
              )
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_unpaid_cancelled'
                   -- 🔴 codex R2 MF2:與 pcm_unpaid_cancelled_email_pending 的 anti-join 逐字同一份 skip 清單。
                   --    少了它:排信後兩個信箱被清空 ⇒ 那列落 recipient_stale_at_send ⇒ view 放行而這裡不算 ⇒ 不寄也不告警。
                   AND COALESCE(e.last_error_code, '') NOT IN (
                         'shipment_voided',
                         'tracking_superseded',
                         'bank_order_not_mailable_at_send',
                         'bank_order_snapshot_stale',
                         'recipient_stale_at_send'
                       ))),

    -- 🔴 **分母**:沒有它, 上面兩個 0 在「一切正常」與「這裡根本沒有訂單資料 / 讀不到」
    --    之間分不出來。
    -- ⚠️ **用途寫在它旁邊, 免得下一個人拿它去算比率**:它是**全域訂單數**,
    --    含已付款、含起始線以前的。它答的是「**這裡到底有沒有訂單資料**」,
    --    **不是**「這個告警視窗裡有幾筆」。
    'orders_total_count',
      (SELECT pg_catalog.count(*) FROM public.orders)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;
DO $post$
DECLARE
  v_unp text;
  v_needle_o text := 'OR o.order_source NOT IN (''manual_phone'', ''manual_line'', ''manual_other'')';
  v_fn oid;
  v_name text;
BEGIN
  SELECT p.prosrc INTO v_unp FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_order_unpaid_cancelled_gap_counts(timestamptz)');
  IF (pg_catalog.length(v_unp) - pg_catalog.length(pg_catalog.replace(v_unp, v_needle_o, ''))) / pg_catalog.length(v_needle_o) <> 2 THEN
    RAISE EXCEPTION '後置閘:get_order_unpaid_cancelled_gap_counts 排除條件不是剛好兩處';
  END IF;
  FOREACH v_name IN ARRAY ARRAY['public.get_order_unpaid_cancelled_gap_counts(timestamptz)']::text[] LOOP
    v_fn := pg_catalog.to_regprocedure(v_name);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
      RAISE EXCEPTION '%:不再是 SECURITY DEFINER', v_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '%:SET search_path 不是空字串', v_name;
    END IF;
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%:payment_confirmer 失去 EXECUTE', v_name;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%:anon / authenticated 可以 EXECUTE', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 20260928235500:未付款取消信告警排除 manual 留白、SET 子句與權限不變';
END
$post$;

COMMIT;
